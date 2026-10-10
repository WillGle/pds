import { NextRequest, NextResponse } from "next/server";
import { asRecord, formatIsoDate, objects, parseCount } from "@/lib/scrape";

export const runtime = "nodejs";
export const maxDuration = 30;

export interface YouTubeScrapedItem {
  url: string;
  id?: string;
  title?: string;
  author: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  postDate: string | null;
  error?: string;
}

function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const clean = url.trim();
  const match = clean.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?(?:[^#]*?&)?v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function extractBalancedJson(html: string, varName: string): Record<string, unknown> | null {
  const assignment = new RegExp(`\\b${varName}\\s*=\\s*\\{`).exec(html);
  if (!assignment) return null;
  const start = html.indexOf("{", assignment.index);
  if (start === -1) return null;
  let depth = 0;
  let end = start;
  // Track string context so braces inside JSON string values don't skew the depth count
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

function exactCountText(value: unknown): number | null {
  const text = asRecord(value);
  const runs = Array.isArray(text?.runs) ? text.runs : [];
  const label = typeof value === "string" ? value : text?.simpleText ?? text?.content ??
    runs.map((run) => asRecord(run)?.text || "").join("");
  if (typeof label !== "string") return null;
  const match = label.trim().match(/^(\d+(?:,\d{3})*)(?:\s+(?:comments?|views?))?$/i);
  return match ? parseCount(match[1].replace(/,/g, "")) : null;
}

function readViews(value: unknown): number | null {
  const renderer = asRecord(value);
  const original = parseCount(renderer?.originalViewCount);
  if (original !== null && original > 0) return original;
  // YouTube can send originalViewCount="0" alongside a nonzero visible counter.
  const visible = exactCountText(renderer?.viewCount);
  if (visible !== null) return visible;
  return asRecord(renderer?.viewCount)?.simpleText === "No views" ? 0 : null;
}

function readLikes(data: unknown): number | null {
  // Prefer the current count; the text for the toggled button can include an extra like.
  for (const record of objects(data)) {
    const count = parseCount(asRecord(record.likeCountEntity)?.likeCountIfIndifferentNumber);
    if (count !== null) return count;
  }
  for (const record of objects(data)) {
    // Exact accessibility text: "like this video along with 19,481,334 other people".
    const label = record.accessibilityText;
    const match = typeof label === "string"
      ? label.match(/^like this video along with ([0-9,]+)\s*other people$/i) : null;
    const count = match ? exactCountText(match[1]) :
      record.iconName === "LIKE" ? exactCountText(record.title) : null;
    if (count !== null) return count;
  }
  return null;
}

function readComments(data: unknown) {
  let count: number | null = null;
  let disabled = false;
  const tokens = new Set<string>();
  for (const record of objects(data)) {
    const header = asRecord(record.commentsHeaderRenderer) ??
      asRecord(record.commentsEntryPointHeaderRenderer) ?? asRecord(record.commentsHeaderViewModel);
    if (header) {
      count ??= exactCountText(header.countText ?? header.commentCount ?? header.commentsCount);
    }
    const section = asRecord(record.itemSectionRenderer);
    if (!section || (section.sectionIdentifier !== "comment-item-section" &&
      section.targetId !== "comments-section" && section.targetId !== "engagement-panel-comments-section")) continue;
    for (const child of objects(section)) {
      const token = asRecord(child.continuationCommand)?.token;
      if (typeof token === "string" && token) tokens.add(token);
      if (child.commentsDisabled === true || JSON.stringify(child.messageRenderer || "").includes("Comments are turned off")) {
        disabled = true;
      }
    }
  }
  return { count, disabled, tokens: [...tokens] };
}

async function scrapeSingleYouTube(
  rawUrl: string,
  deadline = Date.now() + 25000
): Promise<YouTubeScrapedItem> {
  const videoId = extractYouTubeId(rawUrl);
  const result: YouTubeScrapedItem = {
    url: rawUrl,
    author: "",
    views: null,
    likes: null,
    comments: null,
    shares: null,
    postDate: null,
  };

  if (!videoId) {
    result.error = "Could not resolve YouTube Video ID from URL";
    return result;
  }

  result.id = videoId;
  const signal = (ms: number) =>
    AbortSignal.timeout(Math.max(1, Math.min(ms, deadline - Date.now())));
  // Leave time for HTML extraction and a comments request if the API attempts fail.
  const apiDeadline = deadline - 11000;
  const apiSignal = (ms: number) =>
    AbortSignal.timeout(Math.max(1, Math.min(ms, apiDeadline - Date.now())));

  const headers = {
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };

  let isCommentsDisabled = false;

  // Load player and watch metadata concurrently, preserving player field precedence.
  const playerPromise = (async () => {
    const result: YouTubeScrapedItem = {
      url: rawUrl, id: videoId, author: "", views: null, likes: null,
      comments: null, shares: null, postDate: null,
    };
    // Tier 1: YouTube Innertube Player Endpoint
    // On datacenter IPs (like Vercel / AWS), MWEB client successfully bypasses bot verification / PO-token challenges.
    // We try MWEB first, then WEB client.
    const innertubeClients = [
      { clientName: "MWEB", clientVersion: "2.20240401.00.00", hl: "en", gl: "US" },
      { clientName: "WEB", clientVersion: "2.20240401.00.00", hl: "en", gl: "US" },
    ];

    for (const client of innertubeClients) {
      if (Date.now() >= apiDeadline) break;
      try {
        const playerResp: Response = await fetch("https://www.youtube.com/youtubei/v1/player", {
          method: "POST",
          headers,
          body: JSON.stringify({ context: { client }, videoId }),
          signal: apiSignal(5000),
          cache: "no-store",
        });

        if (playerResp.ok) {
          const playerData = await playerResp.json();
          if (playerData.videoDetails?.videoId !== videoId) continue;
          if (playerData.videoDetails) {
            result.title ||= playerData.videoDetails.title || "";
            result.author ||= playerData.videoDetails.author || "";
            if (playerData.videoDetails.viewCount && result.views === null) {
              const views = parseCount(playerData.videoDetails.viewCount);
              if (views !== 0 || playerData.playabilityStatus?.status === "OK") result.views = views;
            }
          }

          const rawDate =
            playerData.microformat?.playerMicroformatRenderer?.publishDate ||
            playerData.microformat?.playerMicroformatRenderer?.uploadDate;
          if (rawDate && !result.postDate) {
            result.postDate = formatIsoDate(rawDate);
          }

          if (result.views !== null && result.author && result.postDate) {
            break;
          }
        }
      } catch {
        // Continue to next client
      }
    }

    return result;
  })();

  // Tier 1 (continued): YouTube Innertube Next Endpoint for Likes & Comments Token
  // WEB client provides desktop comments tree and exact likes. MWEB is used as fallback.
  const nextClients = [
    { clientName: "WEB", clientVersion: "2.20240401.00.00", hl: "en", gl: "US", timeZone: "Asia/Ho_Chi_Minh", utcOffsetMinutes: 420 },
    { clientName: "MWEB", clientVersion: "2.20240401.00.00", hl: "en", gl: "US", timeZone: "Asia/Ho_Chi_Minh", utcOffsetMinutes: 420 },
  ];

  const continuations: { token: string; client: typeof nextClients[number] }[] = [];
  const attemptedTokens = new Set<string>();
  const applyComments = (data: unknown, client: typeof nextClients[number]) => {
    const comments = readComments(data);
    result.comments ??= comments.count;
    isCommentsDisabled ||= comments.disabled;
    if (isCommentsDisabled && result.comments === null) result.comments = 0;
    for (const token of comments.tokens) {
      if (!continuations.some((entry) => entry.token === token && entry.client.clientName === client.clientName)) {
        continuations.push({ token, client });
      }
    }
  };

  const fetchComments = async (stageDeadline: number) => {
    for (const { token, client } of continuations) {
      const key = `${client.clientName}:${token}`;
      if (result.comments !== null || isCommentsDisabled || Date.now() >= stageDeadline) break;
      if (attemptedTokens.has(key)) continue;
      attemptedTokens.add(key);
      try {
        const response = await fetch("https://www.youtube.com/youtubei/v1/next", {
          method: "POST",
          headers,
          body: JSON.stringify({ context: { client }, continuation: token }),
          signal: signal(Math.min(5000, stageDeadline - Date.now())),
          cache: "no-store",
        });
        if (response.ok) applyComments(await response.json(), client);
      } catch {
        // Try the other comments section while the request still has time.
      }
    }
  };

  for (const client of nextClients) {
    if (Date.now() >= apiDeadline) break;
    try {
      const nextResp: Response = await fetch("https://www.youtube.com/youtubei/v1/next", {
        method: "POST",
        headers,
        body: JSON.stringify({ context: { client }, videoId }),
        signal: apiSignal(5000),
        cache: "no-store",
      });

      if (nextResp.ok) {
        const nextData = await nextResp.json();
        const returnedId = nextData.currentVideoEndpoint?.watchEndpoint?.videoId;
        if (returnedId !== videoId) continue;
        const nextStr = JSON.stringify(nextData);

        // The player can be blocked on serverless IPs while the watch metadata is available.
        if (nextData.currentVideoEndpoint?.watchEndpoint?.videoId === videoId) {
          const contents = nextData.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
          for (const item of contents) {
            const owner = item.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer;
            result.author ||= owner?.title?.simpleText || owner?.title?.runs?.[0]?.text || "";
            const primary = item.videoPrimaryInfoRenderer;
            if (!primary) continue;
            result.views ??= readViews(primary.viewCount?.videoViewCountRenderer);
            const date = primary.dateText?.simpleText;
            if (!result.postDate && typeof date === "string" && /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(date)) {
              // The client timezone makes this a Vietnam calendar date, without a time component.
              result.postDate = formatIsoDate(`${date} UTC`);
            }
          }
        }

        applyComments(nextData, client);

        result.likes ??= readLikes(nextData);

        if (!result.author) {
          const authorMatch = nextStr.match(
            /"owner":\{"videoOwnerRenderer":\{[^}]*?"title":\{"runs":\[\{"text":"([^"]+)"/
          );
          if (authorMatch) result.author = authorMatch[1];
        }

        if (result.views !== null && result.postDate && result.author && result.likes !== null &&
          (result.comments !== null || continuations.length > 0)) {
          break;
        }
      }
    } catch {
      // Continue
    }
  }

  const playerResult = await playerPromise;
  result.title = playerResult.title || result.title;
  result.author = playerResult.author || result.author;
  if (playerResult.views !== null && (playerResult.views > 0 || result.views === null)) {
    result.views = playerResult.views;
  }
  result.postDate = playerResult.postDate || result.postDate;

  await fetchComments(apiDeadline);

  // Tier 2: In-source HTML fallback for any missing public metric.
  if ((result.views === null || result.likes === null || result.comments === null || !result.author || !result.postDate) && Date.now() < deadline) {
    try {
      const htmlResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          "Cookie": "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg;",
        },
        signal: signal(6000),
        cache: "no-store",
      });

      if (htmlResp.ok) {
        const html = await htmlResp.text();
        const playerObj = extractBalancedJson(html, "ytInitialPlayerResponse");
        if (playerObj) {
          const details = playerObj.videoDetails as Record<string, unknown> | undefined;
          if (details && details.videoId === videoId) {
            result.title ||= String(details.title || "");
            result.author ||= String(details.author || "");
            if (result.views === null && details.viewCount) {
              const views = parseCount(details.viewCount);
              if (views !== 0 || asRecord(playerObj.playabilityStatus)?.status === "OK") result.views = views;
            }
          }
          const microformat = (playerObj.microformat as Record<string, unknown> | undefined)
            ?.playerMicroformatRenderer as Record<string, unknown> | undefined;
          if (details?.videoId === videoId && !result.postDate && microformat) {
            const raw = microformat.publishDate || microformat.uploadDate;
            if (raw) result.postDate = formatIsoDate(String(raw));
          }
        }

        const initialObj = extractBalancedJson(html, "ytInitialData");
        const initialId = asRecord(asRecord(initialObj?.currentVideoEndpoint)?.watchEndpoint)?.videoId;
        if (initialObj && initialId === videoId) {
          const watch = asRecord(asRecord(initialObj.contents)?.twoColumnWatchNextResults);
          const contents = asRecord(asRecord(watch?.results)?.results)?.contents;
          if (Array.isArray(contents)) {
            for (const item of contents) {
              const primary = asRecord(asRecord(item)?.videoPrimaryInfoRenderer);
              result.views ??= readViews(asRecord(primary?.viewCount)?.videoViewCountRenderer);
            }
          }
          applyComments(initialObj, nextClients[0]);
          result.likes ??= readLikes(initialObj);
        }
      }
    } catch {
      // Continue
    }
  }

  await fetchComments(deadline);

  // Tier 3: Official oEmbed fallback for author & title
  if ((!result.author || !result.title) && Date.now() < deadline) {
    try {
      const oembedResp = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
        { signal: signal(3000), cache: "no-store" }
      );
      if (oembedResp.ok) {
        const oembed = await oembedResp.json();
        result.title ||= oembed.title || "";
        result.author ||= oembed.author_name || "";
      }
    } catch {
      // Ignore
    }
  }

  const requiredFields = ["views", "likes", "comments", "postDate", "author"] as const;
  const missing = requiredFields.filter((f) => result[f] === null);
  if (!result.author) {
    missing.push("author");
  }

  if (missing.length > 0 && !result.error) {
    result.error = `Unavailable: ${missing.join(", ")}`;
  }

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, url } = body;

    // Single URL mode
    if (url && typeof url === "string" && url.trim()) {
      const result = await scrapeSingleYouTube(url.trim());
      return NextResponse.json({
        success: !result.error,
        data: result,
      });
    }

    // Batch mode
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: "urls array or single url is required" }, { status: 400 });
    }

    const cleanUrls = Array.from(
      new Set(urls.map((u: string) => (typeof u === "string" ? u.trim() : "")).filter(Boolean))
    );
    if (cleanUrls.length === 0) {
      return NextResponse.json({ error: "No valid URLs provided" }, { status: 400 });
    }

    if (cleanUrls.length > 50) {
      return NextResponse.json({ error: "Send at most 50 URLs per request" }, { status: 400 });
    }

    const deadline = Date.now() + 25000;
    // Run up to 3 URLs concurrently — each is a pure HTTP scrape, no shared state.
    const concurrency = Math.min(3, cleanUrls.length);
    const results: YouTubeScrapedItem[] = new Array(cleanUrls.length);
    let nextIdx = 0;

    const worker = async () => {
      while (nextIdx < cleanUrls.length) {
        const i = nextIdx++;
        results[i] =
          Date.now() < deadline
            ? await scrapeSingleYouTube(cleanUrls[i], deadline)
            : {
                url: cleanUrls[i],
                views: null,
                likes: null,
                comments: null,
                shares: null,
                author: "",
                postDate: null,
                error: "Request time limit reached; retry this URL individually",
              };
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return NextResponse.json({
      success: results.every((item) => !item.error),
      complete: results.filter((item) => !item.error).length,
      total: results.length,
      data: results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

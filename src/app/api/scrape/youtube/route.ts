import { NextRequest, NextResponse } from "next/server";
import { formatIsoDate, parseCount, parseFormattedCount } from "@/lib/scrape";

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

export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const clean = url.trim();
  const match = clean.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+?&v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function extractBalancedJson(html: string, varName: string): Record<string, unknown> | null {
  const idx = html.indexOf(varName + " = ");
  if (idx === -1) return null;
  const start = html.indexOf("{", idx);
  if (start === -1) return null;
  let depth = 0;
  let end = start;
  for (let i = start; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

export async function scrapeSingleYouTube(
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

  const clientContext = {
    client: {
      clientName: "WEB",
      clientVersion: "2.20240401.00.00",
      hl: "en",
      gl: "US",
    },
  };

  const headers = {
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };

  let commentContinuationToken: string | null = null;
  let isCommentsDisabled = false;

  // Tier 1: YouTube Innertube Web Client (Player Endpoint)
  if (Date.now() < deadline) {
    try {
      const playerResp = await fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers,
        body: JSON.stringify({ context: clientContext, videoId }),
        signal: signal(6000),
        cache: "no-store",
      });

      if (playerResp.ok) {
        const playerData = await playerResp.json();
        const playability = playerData.playabilityStatus;
        if (playability && playability.status && playability.status !== "OK" && !playerData.videoDetails) {
          result.error = playability.reason || "Video is unavailable or private";
          return result;
        }

        result.title = playerData.videoDetails?.title || "";
        result.author = playerData.videoDetails?.author || "";
        if (playerData.videoDetails?.viewCount) {
          result.views = parseCount(playerData.videoDetails.viewCount);
        }

        const rawDate =
          playerData.microformat?.playerMicroformatRenderer?.publishDate ||
          playerData.microformat?.playerMicroformatRenderer?.uploadDate;
        if (rawDate) {
          result.postDate = formatIsoDate(rawDate);
        }
      }
    } catch {
      // Continue to next steps and fallbacks
    }
  }

  // Tier 1 (continued): YouTube Innertube Next Endpoint for Likes & Comments Token
  if (Date.now() < deadline) {
    try {
      const nextResp = await fetch("https://www.youtube.com/youtubei/v1/next", {
        method: "POST",
        headers,
        body: JSON.stringify({ context: clientContext, videoId }),
        signal: signal(6000),
        cache: "no-store",
      });

      if (nextResp.ok) {
        const nextData = await nextResp.json();
        const nextStr = JSON.stringify(nextData);

        // Check if comments disabled
        if (nextStr.includes("Comments are turned off") || nextStr.includes("commentsDisabled")) {
          isCommentsDisabled = true;
          result.comments = 0;
        }

        // Extract Likes (exact accessibility text: "like this video along with 19,481,334 other people")
        const likeAccMatches = [
          ...nextStr.matchAll(
            /"accessibilityText":\s*"like this video along with ([0-9,.]+)\s*other people"/gi
          ),
        ];
        if (likeAccMatches.length > 0) {
          result.likes = parseFormattedCount(likeAccMatches[0][1]);
        } else {
          // Fallback like count string
          const shortLikeMatch = nextStr.match(
            /"iconName":\s*"LIKE"[^}]*?"title":\s*"([0-9.]+[KMBkmb]?)"/
          );
          if (shortLikeMatch) {
            result.likes = parseFormattedCount(shortLikeMatch[1]);
          }
        }

        if (!result.author) {
          const authorMatch = nextStr.match(
            /"owner":\{"videoOwnerRenderer":\{[^}]*?"title":\{"runs":\[\{"text":"([^"]+)"/
          );
          if (authorMatch) result.author = authorMatch[1];
        }

        // Find continuation token for comments-section
        const tokenMatch = nextStr.match(
          /"continuationCommand":\s*\{\s*"token":\s*"([^"]+)"[^{}]*?"request":\s*"CONTINUATION_REQUEST_TYPE_WATCH_NEXT"/
        );
        if (tokenMatch) {
          commentContinuationToken = tokenMatch[1];
        }
      }
    } catch {
      // Continue
    }
  }

  // Fetch comments via continuation token if available
  if (commentContinuationToken && !isCommentsDisabled && Date.now() < deadline) {
    try {
      const commResp = await fetch("https://www.youtube.com/youtubei/v1/next", {
        method: "POST",
        headers,
        body: JSON.stringify({ context: clientContext, continuation: commentContinuationToken }),
        signal: signal(6000),
        cache: "no-store",
      });

      if (commResp.ok) {
        const commData = await commResp.json();
        const commStr = JSON.stringify(commData);
        const countMatch = commStr.match(
          /"countText":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([0-9,.]+)"\s*\}/
        );
        if (countMatch) {
          result.comments = parseFormattedCount(countMatch[1]);
        } else {
          const shortCountMatch = commStr.match(
            /"commentsCount":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([0-9.]+[KMBkmb]?)"\s*\}/
          );
          if (shortCountMatch) {
            result.comments = parseFormattedCount(shortCountMatch[1]);
          }
        }
      }
    } catch {
      // Continue
    }
  }

  // Tier 2: In-source HTML fallback if views or likes are still missing
  if ((result.views === null || result.likes === null || !result.author) && Date.now() < deadline) {
    try {
      const htmlResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: signal(6000),
        cache: "no-store",
      });

      if (htmlResp.ok) {
        const html = await htmlResp.text();
        const playerObj = extractBalancedJson(html, "ytInitialPlayerResponse");
        if (playerObj) {
          const details = playerObj.videoDetails as Record<string, unknown> | undefined;
          if (details) {
            result.title ||= String(details.title || "");
            result.author ||= String(details.author || "");
            if (result.views === null && details.viewCount) {
              result.views = parseCount(details.viewCount);
            }
          }
          const microformat = (playerObj.microformat as Record<string, unknown> | undefined)
            ?.playerMicroformatRenderer as Record<string, unknown> | undefined;
          if (!result.postDate && microformat) {
            const raw = microformat.publishDate || microformat.uploadDate;
            if (raw) result.postDate = formatIsoDate(String(raw));
          }
        }

        const initialObj = extractBalancedJson(html, "ytInitialData");
        if (initialObj && result.likes === null) {
          const initStr = JSON.stringify(initialObj);
          const likeAccMatches = [
            ...initStr.matchAll(
              /"accessibilityText":\s*"like this video along with ([0-9,.]+)\s*other people"/gi
            ),
          ];
          if (likeAccMatches.length > 0) {
            result.likes = parseFormattedCount(likeAccMatches[0][1]);
          }
        }
      }
    } catch {
      // Continue
    }
  }

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

  const requiredFields = ["views", "likes", "postDate"] as const;
  const missing = requiredFields.filter((f) => result[f] === null);
  if (result.comments === null && !isCommentsDisabled) {
    missing.push("comments" as unknown as typeof requiredFields[number]);
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
    const results: YouTubeScrapedItem[] = [];

    for (let i = 0; i < cleanUrls.length; i++) {
      const item =
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
      results.push(item);
      if (i < cleanUrls.length - 1 && deadline - Date.now() > 500) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

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

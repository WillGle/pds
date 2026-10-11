export interface CommentTableRow {
  id: number;
  Comment: string;
}

export interface TikTokCommentsResult {
  success: boolean;
  url: string;
  total: number;
  data: CommentTableRow[];
  error?: string;
}

export interface ScrapeTikTokCommentsOptions {
  maxComments?: number;
  expandReplies?: boolean;
  timeoutMs?: number;
}

function sanitizeTikTokUrl(url: string): string {
  if (!url) return "";
  let clean = url.trim();
  if (clean.includes("?")) {
    clean = clean.split("?")[0];
  }
  return clean.replace(/\/$/, "");
}

async function resolveRedirectUrl(url: string, deadline: number): Promise<string> {
  if (!url) return "";
  if (url.includes("vt.tiktok.com") || url.includes("vm.tiktok.com") || url.includes("/t/")) {
    try {
      const resp = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(Math.max(1000, Math.min(4000, deadline - Date.now()))),
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        cache: "no-store",
      });
      if (resp.url && resp.url.includes("tiktok.com")) {
        return sanitizeTikTokUrl(resp.url);
      }
    } catch {
      // Fallback to original
    }
  }
  return sanitizeTikTokUrl(url);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RawTikWMComment {
  id: string;
  video_id?: string;
  text?: string;
  reply_total?: number;
  [key: string]: unknown;
}

export async function scrapeTikTokComments(
  rawUrl: string,
  options: ScrapeTikTokCommentsOptions = {}
): Promise<TikTokCommentsResult> {
  const maxComments = Math.min(options.maxComments ?? 100, 500);
  const expandReplies = options.expandReplies ?? true;
  const timeoutMs = options.timeoutMs ?? 50000;
  const deadline = Date.now() + timeoutMs;

  const rawClean = rawUrl.trim();
  if (!rawClean) {
    return {
      success: false,
      url: rawUrl,
      total: 0,
      data: [],
      error: "URL cannot be empty",
    };
  }

  const cleanUrl = await resolveRedirectUrl(rawClean, deadline);
  let videoId = cleanUrl.match(/\/(?:video|v)\/(\d+)/)?.[1] || "";

  // If videoId could not be extracted directly, resolve via TikWM base info API
  if (!videoId && Date.now() < deadline) {
    try {
      const baseResp = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`, {
        signal: AbortSignal.timeout(Math.max(1000, Math.min(5000, deadline - Date.now()))),
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (baseResp.ok) {
        const baseJson = await baseResp.json();
        if (baseJson?.data?.id) {
          videoId = String(baseJson.data.id);
        }
      }
    } catch {
      // Continue with cleanUrl
    }
  }

  const collectedTexts: string[] = [];
  const seenTexts = new Set<string>();
  const commentsToFetchReplies: RawTikWMComment[] = [];

  let cursor = 0;
  let hasMore = true;
  let pageAttempts = 0;

  // 1. Fetch top-level comments
  while (hasMore && collectedTexts.length < maxComments && Date.now() < deadline - 5000 && pageAttempts < 10) {
    pageAttempts++;
    let successPage = false;

    for (let retry = 0; retry < 3 && Date.now() < deadline - 5000; retry++) {
      try {
        const apiUrl = `https://www.tikwm.com/api/comment/list?url=${encodeURIComponent(cleanUrl)}&count=50&cursor=${cursor}`;
        const resp = await fetch(apiUrl, {
          signal: AbortSignal.timeout(Math.max(1000, Math.min(6000, deadline - Date.now()))),
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/json",
          },
          cache: "no-store",
        });

        if (!resp.ok) throw new Error(`TikWM HTTP ${resp.status}`);
        const resJson = await resp.json();

        if (resJson?.code === 0 && resJson.data) {
          const list: RawTikWMComment[] = resJson.data.comments || [];
          if (!videoId && list[0]?.video_id) {
            videoId = String(list[0].video_id);
          }

          for (const item of list) {
            let text = (item.text || "").trim();
            // Clean leading mention tag if present (e.g. @username)
            text = text.replace(/^@\S+\s+/, "").trim();

            if (text && !seenTexts.has(text)) {
              seenTexts.add(text);
              collectedTexts.push(text);
            }

            if (expandReplies && item.reply_total && item.reply_total > 0) {
              commentsToFetchReplies.push(item);
            }
          }

          hasMore = Boolean(resJson.data.hasMore) && list.length > 0;
          cursor = typeof resJson.data.cursor === "number" ? resJson.data.cursor : cursor + list.length;
          successPage = true;
          break;
        }

        const msg = String(resJson?.msg || "");
        if (msg.includes("Free Api Limit")) {
          await sleep(1500 * (retry + 1));
          continue;
        }
        break;
      } catch {
        await sleep(1000);
      }
    }

    if (!successPage) break;
  }

  // 2. Fetch replies (sub-comments) if enabled and within limit
  if (expandReplies && videoId && Date.now() < deadline - 5000) {
    for (const parent of commentsToFetchReplies) {
      if (collectedTexts.length >= maxComments || Date.now() >= deadline - 4000) break;

      try {
        const replyUrl = `https://www.tikwm.com/api/comment/reply?video_id=${videoId}&comment_id=${parent.id}&count=50`;
        const resp = await fetch(replyUrl, {
          signal: AbortSignal.timeout(Math.max(1000, Math.min(5000, deadline - Date.now()))),
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/json",
          },
          cache: "no-store",
        });

        if (resp.ok) {
          const resJson = await resp.json();
          if (resJson?.code === 0 && resJson.data?.comments) {
            const replies: RawTikWMComment[] = resJson.data.comments;
            for (const r of replies) {
              if (collectedTexts.length >= maxComments) break;

              let text = (r.text || "").trim();
              text = text.replace(/^@\S+\s+/, "").trim();

              if (text && !seenTexts.has(text)) {
                seenTexts.add(text);
                collectedTexts.push(text);
              }
            }
          }
        }
      } catch {
        // Continue fetching remaining replies
      }
    }
  }

  const rows: CommentTableRow[] = collectedTexts.slice(0, maxComments).map((text, idx) => ({
    id: idx + 1,
    Comment: text,
  }));

  return {
    success: true,
    url: rawClean,
    total: rows.length,
    data: rows,
  };
}

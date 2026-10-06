import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

interface TikTokScrapedItem {
  url: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  author: string;
  error?: string;
}

function sanitizeTikTokUrl(url: string): string {
  if (!url) return "";
  let clean = url.trim();
  if (clean.includes("?")) {
    clean = clean.split("?")[0];
  }
  return clean.replace(/\/$/, "");
}

async function resolveRedirectUrl(url: string): Promise<string> {
  if (!url) return "";
  if (url.includes("vt.tiktok.com") || url.includes("vm.tiktok.com") || url.includes("/t/")) {
    try {
      const resp = await fetch(url, {
        method: "HEAD",
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
      // Fallback
    }
  }
  return sanitizeTikTokUrl(url);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeSingleTikTok(rawUrl: string, maxRetries = 4): Promise<TikTokScrapedItem> {
  const cleanUrl = await resolveRedirectUrl(rawUrl);

  const result: TikTokScrapedItem = {
    url: rawUrl,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    author: "",
  };

  if (!cleanUrl) {
    result.error = "Invalid or empty TikTok URL";
    return result;
  }

  // Tier 1: TikWM Public API with retry on rate limit
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);

      const resp = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        cache: "no-store",
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const resJson = await resp.json();
        const code = resJson?.code;
        const msg = String(resJson?.msg || "");

        if (code === 0 && resJson.data) {
          const d = resJson.data;
          result.views = typeof d.play_count === "number" ? d.play_count : null;
          result.likes = typeof d.digg_count === "number" ? d.digg_count : null;
          result.comments = typeof d.comment_count === "number" ? d.comment_count : null;
          result.shares = typeof d.share_count === "number" ? d.share_count : null;
          result.saves = typeof d.collect_count === "number" ? d.collect_count : null;
          result.author = d.author?.nickname || d.author?.unique_id || "";
          result.error = undefined;
          return result;
        } else if (msg.includes("Free Api Limit") || code === -1) {
          await sleep(1300 * (attempt + 1));
          continue;
        } else {
          result.error = msg || "TikWM extraction failed";
          break;
        }
      }
    } catch {
      await sleep(1000);
    }
  }

  // Tier 2: Official TikTok oEmbed fallback for author
  try {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(oembedUrl, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    if (resp.ok) {
      const oembed = await resp.json();
      if (!result.author && (oembed.author_name || oembed.author_unique_id)) {
        result.author = oembed.author_name || oembed.author_unique_id;
      }
    }
  } catch {
    // ignore
  }

  // Tier 3: In-source HTML Regex fallback
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(cleanUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const html = await resp.text();
      const mPlay = html.match(/["']playCount["']:\s*(\d+)/);
      const mDigg = html.match(/["']diggCount["']:\s*(\d+)/);
      const mComm = html.match(/["']commentCount["']:\s*(\d+)/);
      const mShare = html.match(/["']shareCount["']:\s*(\d+)/);
      const mSave = html.match(/["']collectCount["']:\s*(\d+)/);

      if (mPlay && result.views === null) result.views = parseInt(mPlay[1], 10);
      if (mDigg && result.likes === null) result.likes = parseInt(mDigg[1], 10);
      if (mComm && result.comments === null) result.comments = parseInt(mComm[1], 10);
      if (mShare && result.shares === null) result.shares = parseInt(mShare[1], 10);
      if (mSave && result.saves === null) result.saves = parseInt(mSave[1], 10);

      if (result.views !== null || result.likes !== null) {
        result.error = undefined;
      }
    }
  } catch (err: unknown) {
    if (!result.error) {
      result.error = err instanceof Error ? err.message : "TikTok scraping failed";
    }
  }

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, url } = body;

    // Single URL mode
    if (url && typeof url === "string" && url.trim()) {
      const result = await scrapeSingleTikTok(url.trim());
      return NextResponse.json({
        success: true,
        data: result,
      });
    }

    // Batch mode with rate-limit spacing
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: "urls array or single url is required" }, { status: 400 });
    }

    const cleanUrls = Array.from(new Set(urls.map((u: string) => (typeof u === "string" ? u.trim() : "")).filter(Boolean)));
    if (cleanUrls.length === 0) {
      return NextResponse.json({ error: "No valid URLs provided" }, { status: 400 });
    }

    const batch = cleanUrls.slice(0, 50);
    const results: TikTokScrapedItem[] = [];

    for (let i = 0; i < batch.length; i++) {
      const item = await scrapeSingleTikTok(batch[i]);
      results.push(item);
      if (i < batch.length - 1) {
        await sleep(1150);
      }
    }

    return NextResponse.json({
      success: true,
      total: results.length,
      data: results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

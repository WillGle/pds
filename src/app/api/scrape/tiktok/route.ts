import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

interface TikTokScrapedItem {
  url: string;
  cleanUrl: string;
  id: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  totalInteractions: number | null;
  author: string;
  title: string;
  postDate: string;
  thumbnail: string;
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

function extractTikTokId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:video|v)\/(\d+)/);
  return m ? m[1] : null;
}

async function scrapeSingleTikTok(rawUrl: string): Promise<TikTokScrapedItem> {
  const cleanUrl = await resolveRedirectUrl(rawUrl);
  const videoId = extractTikTokId(cleanUrl);

  const result: TikTokScrapedItem = {
    url: rawUrl,
    cleanUrl,
    id: videoId,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    totalInteractions: null,
    author: "",
    title: "",
    postDate: "N/A",
    thumbnail: "",
  };

  if (!cleanUrl) {
    result.error = "Invalid or empty TikTok URL";
    return result;
  }

  // Tier 1: TikWM Public API
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
      next: { revalidate: 0 },
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const resJson = await resp.json();
      if (resJson.code === 0 && resJson.data) {
        const d = resJson.data;
        const ts = d.create_time;
        if (ts && typeof ts === "number") {
          const dObj = new Date(ts * 1000);
          result.postDate = dObj.toISOString().split("T")[0];
        }

        result.views = typeof d.play_count === "number" ? d.play_count : null;
        result.likes = typeof d.digg_count === "number" ? d.digg_count : null;
        result.comments = typeof d.comment_count === "number" ? d.comment_count : null;
        result.shares = typeof d.share_count === "number" ? d.share_count : null;
        result.saves = typeof d.collect_count === "number" ? d.collect_count : null;

        const metrics = [result.likes, result.comments, result.shares, result.saves].filter(
          (x): x is number => typeof x === "number"
        );
        result.totalInteractions = metrics.length > 0 ? metrics.reduce((a, b) => a + b, 0) : null;

        result.title = d.title || "";
        result.author = d.author?.nickname || d.author?.unique_id || "";
        result.thumbnail = d.cover || d.origin_cover || "";
        return result;
      }
    }
  } catch {
    // If TikWM fails, proceed to Tier 2 HTML metadata fallback
  }

  // Tier 2: HTML OpenGraph metadata fallback
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
      next: { revalidate: 0 },
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const html = await resp.text();
      const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
      const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
      const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";

      result.title = ogDesc || ogTitle;
      result.thumbnail = ogImage;

      // Extract like count from og:description if present
      const likesMatch = ogDesc.match(/([\d.,]+[kKmM]?)\s*(?:Likes|likes|lượt thích)/i);
      if (likesMatch) {
        result.likes = parseInt(likesMatch[1].replace(/[^\d]/g, ""), 10) || null;
      }

      const commentsMatch = ogDesc.match(/([\d.,]+[kKmM]?)\s*(?:Comments|comments|bình luận)/i);
      if (commentsMatch) {
        result.comments = parseInt(commentsMatch[1].replace(/[^\d]/g, ""), 10) || null;
      }
    }
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : "TikTok scraping failed";
  }

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls } = body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: "urls array is required and must not be empty" }, { status: 400 });
    }

    const cleanUrls = Array.from(new Set(urls.map((u: string) => (typeof u === "string" ? u.trim() : "")).filter(Boolean)));
    if (cleanUrls.length === 0) {
      return NextResponse.json({ error: "No valid URLs provided" }, { status: 400 });
    }

    // Limit batch size
    const batch = cleanUrls.slice(0, 50);
    const results = await Promise.all(batch.map((url) => scrapeSingleTikTok(url)));

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

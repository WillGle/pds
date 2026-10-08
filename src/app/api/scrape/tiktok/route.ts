import { NextRequest, NextResponse } from "next/server";
import { asRecord, embeddedJson, objects, parseCount } from "@/lib/scrape";

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

async function resolveRedirectUrl(url: string, deadline: number): Promise<string> {
  if (!url) return "";
  if (url.includes("vt.tiktok.com") || url.includes("vm.tiktok.com") || url.includes("/t/")) {
    try {
      const resp = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(Math.max(1, Math.min(4000, deadline - Date.now()))),
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

async function scrapeSingleTikTok(rawUrl: string, deadline = Date.now() + 25000, maxRetries = 4): Promise<TikTokScrapedItem> {
  const cleanUrl = await resolveRedirectUrl(rawUrl, deadline);
  const videoId = cleanUrl.match(/\/(?:video|v)\/(\d+)/)?.[1];
  const result: TikTokScrapedItem = {
    url: rawUrl,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    author: "",
  };
  const fields = ["views", "likes", "comments", "shares", "saves"] as const;
  const complete = () => fields.every((field) => result[field] !== null);
  let fetchError = "";
  const signal = (milliseconds: number) => AbortSignal.timeout(Math.max(1, Math.min(milliseconds, deadline - Date.now())));

  if (!cleanUrl) {
    result.error = "Invalid or empty TikTok URL";
    return result;
  }

  // Tier 1: TikWM Public API with retry on rate limit
  for (let attempt = 0; attempt < maxRetries && deadline - Date.now() > 10000; attempt++) {
    try {
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`;
      const resp = await fetch(apiUrl, {
        signal: signal(Math.min(5000, deadline - Date.now() - 10000)),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!resp.ok) throw new Error(`TikWM returned HTTP ${resp.status}`);
      const resJson = await resp.json();
      const msg = String(resJson?.msg || "");
      if (resJson?.code === 0 && resJson.data) {
        const d = resJson.data;
        if (videoId && d.aweme_id && String(d.aweme_id) !== videoId) {
          throw new Error("TikWM returned a different video");
        }
        result.views = parseCount(d.play_count);
        result.likes = parseCount(d.digg_count);
        result.comments = parseCount(d.comment_count);
        result.shares = parseCount(d.share_count);
        result.saves = parseCount(d.collect_count);
        result.author = d.author?.nickname || d.author?.unique_id || "";
        if (complete()) return result;
        break;
      }
      fetchError = msg || "TikWM extraction failed";
      if (!msg.includes("Free Api Limit")) break;
    } catch (err: unknown) {
      fetchError = err instanceof Error ? err.message : "TikWM extraction failed";
    }
    const delay = 1300 * (attempt + 1);
    if (attempt + 1 < maxRetries && deadline - Date.now() > delay + 10000) await sleep(delay);
    else break;
  }

  // Tier 2: Official TikTok oEmbed fallback for author (after metric extraction below).
  // Tier 3: In-source HTML fallback, restricted to the requested video object.
  if (videoId && Date.now() < deadline) {
    try {
      const resp = await fetch(cleanUrl, {
        signal: signal(8000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        cache: "no-store",
      });
      if (!resp.ok) throw new Error(`TikTok returned HTTP ${resp.status}`);
      const html = await resp.text();
      for (const root of embeddedJson(html)) {
        for (const record of objects(root)) {
          if (String(record.id) !== videoId) continue;
          const stats = asRecord(record.stats);
          const statsV2 = asRecord(record.statsV2);
          if (!stats && !statsV2) continue;
          result.views ??= parseCount(statsV2?.playCount) ?? parseCount(stats?.playCount);
          result.likes ??= parseCount(statsV2?.diggCount) ?? parseCount(stats?.diggCount);
          result.comments ??= parseCount(statsV2?.commentCount) ?? parseCount(stats?.commentCount);
          result.shares ??= parseCount(statsV2?.shareCount) ?? parseCount(stats?.shareCount);
          result.saves ??= parseCount(statsV2?.collectCount) ?? parseCount(stats?.collectCount);
          const author = asRecord(record.author);
          result.author ||= String(author?.nickname || author?.uniqueId || "");
        }
      }
    } catch (err: unknown) {
      fetchError = err instanceof Error ? err.message : "TikTok scraping failed";
    }
  }

  if (!result.author && Date.now() < deadline) {
    try {
      const resp = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`, {
        signal: signal(3000), cache: "no-store",
      });
      if (resp.ok) {
        const oembed = await resp.json();
        result.author = oembed.author_name || oembed.author_unique_id || "";
      }
    } catch {
      // Author metadata cannot supply missing metric counts.
    }
  }

  const missing = fields.filter((field) => result[field] === null);
  if (missing.length) result.error = `Unavailable: ${missing.join(", ")}${fetchError ? ` (${fetchError})` : ""}`;
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

    if (cleanUrls.length > 50) {
      return NextResponse.json({ error: "Send at most 50 URLs per request" }, { status: 400 });
    }
    const batch = cleanUrls;
    const deadline = Date.now() + 25000;
    const results: TikTokScrapedItem[] = [];

    for (let i = 0; i < batch.length; i++) {
      const item = Date.now() < deadline
        ? await scrapeSingleTikTok(batch[i], deadline)
        : { url: batch[i], views: null, likes: null, comments: null, shares: null, saves: null, author: "", error: "Request time limit reached; retry this URL individually" };
      results.push(item);
      if (i < batch.length - 1 && deadline - Date.now() > 1150) {
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

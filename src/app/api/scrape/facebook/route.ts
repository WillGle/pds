import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

interface FacebookScrapedItem {
  url: string;
  id: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  author: string;
  title: string;
  postDate: string;
  thumbnail: string;
  error?: string;
}

function decodeHtmlEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00A0/g, " ");
}

function parseNumberString(str: string | null | undefined): number | null {
  if (!str) return null;
  const cleaned = str.trim().toLowerCase();
  const match = cleaned.match(/([\d.,]+)\s*([a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]+)?/i);
  if (!match) return null;

  let numPart = match[1];
  const unit = (match[2] || "").toLowerCase();

  let multiplier = 1;
  if (unit.startsWith("k") || unit.includes("nghìn") || unit.includes("ngàn")) {
    multiplier = 1000;
  } else if (unit.startsWith("m") || unit.startsWith("tr") || unit.includes("triệu")) {
    multiplier = 1000000;
  } else if (unit.startsWith("b") || unit.startsWith("t") || unit.includes("tỉ") || unit.includes("tỷ")) {
    multiplier = 1000000000;
  }

  // Handle dot vs comma decimal notation
  if (numPart.includes(",") && numPart.includes(".")) {
    numPart = numPart.replace(/,/g, "");
  } else if (numPart.includes(",")) {
    const parts = numPart.split(",");
    if (multiplier === 1 && parts[parts.length - 1].length === 3) {
      numPart = numPart.replace(/,/g, "");
    } else {
      numPart = numPart.replace(/,/g, ".");
    }
  } else if (numPart.includes(".")) {
    const parts = numPart.split(".");
    if (multiplier === 1 && parts[parts.length - 1].length === 3) {
      numPart = numPart.replace(/\./g, "");
    }
  }

  const val = parseFloat(numPart);
  return isNaN(val) ? null : Math.round(val * multiplier);
}

function extractId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|reels?\/|videos\/)(\d+)/);
  return m ? m[1] : null;
}

function parseTitleAndAuthor(ogTitle: string, ogDesc: string): { author: string; title: string } {
  const parts = ogTitle
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  // Pop trailing Facebook brand word
  if (parts.length > 0 && parts[parts.length - 1].toLowerCase() === "facebook") {
    parts.pop();
  }

  let author = "";
  let caption = "";

  if (parts.length >= 3) {
    // Structure: [Stats, Caption..., Author]
    author = parts[parts.length - 1];
    caption = parts.slice(1, parts.length - 1).join(" | ");
  } else if (parts.length === 2) {
    if (parts[0].match(/(?:views|lượt xem|cảm xúc|reactions)/i)) {
      caption = parts[1];
    } else {
      caption = parts[0];
      author = parts[1];
    }
  } else if (parts.length === 1) {
    caption = parts[0];
  }

  return {
    author: author || "Facebook Creator",
    title: caption || ogDesc.substring(0, 160) || ogTitle,
  };
}

async function scrapeSingleFacebook(url: string): Promise<FacebookScrapedItem> {
  const videoId = extractId(url);
  const result: FacebookScrapedItem = {
    url,
    id: videoId,
    views: null,
    likes: null,
    comments: 0,
    shares: 0,
    author: "",
    title: "",
    postDate: "N/A",
    thumbnail: "",
  };

  if (!videoId) {
    result.error = "Could not extract Facebook Reel / Video ID from URL";
    return result;
  }

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const resp = await fetch(`https://www.facebook.com/reel/${videoId}`, {
      signal: controller.signal,
      headers,
      next: { revalidate: 0 },
    });
    clearTimeout(timeout);

    const html = await resp.text();

    const rawOgTitle =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
      "";
    const ogTitle = decodeHtmlEntities(rawOgTitle);

    const rawOgDesc =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1] ||
      "";
    const ogDesc = decodeHtmlEntities(rawOgDesc);

    const rawOgImage =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
      "";
    result.thumbnail = decodeHtmlEntities(rawOgImage);

    // 1. Extract Views & Likes from ogTitle (handles "1,3 triệu lượt xem", "126K lượt xem", etc.)
    const viewsMatch = ogTitle.match(
      /([\d.,]+)\s*([a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]+)?\s*(?:lượt xem|views)/i
    );
    if (viewsMatch) {
      result.views = parseNumberString(`${viewsMatch[1]} ${viewsMatch[2] || ""}`);
    }

    const likesMatch = ogTitle.match(
      /([\d.,]+)\s*([a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]+)?\s*(?:cảm xúc|lượt thích|reactions|likes)/i
    );
    if (likesMatch) {
      result.likes = parseNumberString(`${likesMatch[1]} ${likesMatch[2] || ""}`);
    }

    // 2. Anchored JSON extraction around videoId occurrences in page source
    const indices = [...html.matchAll(new RegExp(videoId, "g"))].map((m) => m.index);
    let commentsFound: number | null = null;
    let sharesFound: number | null = null;

    for (const idx of indices) {
      const chunk = html.substring(Math.max(0, idx - 1500), Math.min(html.length, idx + 3500));

      if (result.likes === null) {
        const lm =
          chunk.match(/["'](?:likers|unified_reactors|reaction_count)["']\s*:\s*\{["']count["']\s*:\s*(\d+)/i) ||
          chunk.match(/["']like_count["']\s*:\s*\{["']total_count["']\s*:\s*(\d+)/i);
        if (lm) result.likes = parseInt(lm[1], 10);
      }

      if (commentsFound === null) {
        const cm =
          chunk.match(/"total_comment_count":\s*(\d+)/i) ||
          chunk.match(/"comment_count":\s*\{"total_count":\s*(\d+)/i);
        if (cm) commentsFound = parseInt(cm[1], 10);
      }

      if (sharesFound === null) {
        const sm =
          chunk.match(/"share_count_reduced":\s*"(\d+)"/i) ||
          chunk.match(/"share_count":\s*\{"count":\s*(\d+)/i);
        if (sm) sharesFound = parseInt(sm[1], 10);
      }

      if (result.postDate === "N/A") {
        const tm = chunk.match(/"(?:creation_time|publish_time|upload_time)":\s*(\d{9,10})/i);
        if (tm) {
          result.postDate = new Date(parseInt(tm[1], 10) * 1000).toISOString().split("T")[0];
        }
      }
    }

    // Fallback general regex across entire HTML
    if (commentsFound === null) {
      const cm = html.match(/"total_comment_count":\s*(\d+)/i);
      if (cm) commentsFound = parseInt(cm[1], 10);
    }
    if (sharesFound === null) {
      const sm = html.match(/"share_count_reduced":\s*"(\d+)"/i);
      if (sm) sharesFound = parseInt(sm[1], 10);
    }
    if (result.likes === null) {
      const lm = html.match(/["'](?:likers|unified_reactors|reaction_count)["']\s*:\s*\{["']count["']\s*:\s*(\d+)/i);
      if (lm) result.likes = parseInt(lm[1], 10);
    }
    if (result.postDate === "N/A") {
      const tm = html.match(/"(?:creation_time|publish_time|upload_time)":\s*(\d{9,10})/i);
      if (tm) {
        result.postDate = new Date(parseInt(tm[1], 10) * 1000).toISOString().split("T")[0];
      }
    }

    result.comments = commentsFound ?? 0;
    result.shares = sharesFound ?? 0;

    // 3. Fallback to watch_url if views is still missing
    if (result.views === null) {
      try {
        const wResp = await fetch(`https://www.facebook.com/watch/?v=${videoId}`, {
          headers,
          next: { revalidate: 0 },
        });
        const wHtml = await wResp.text();
        const vm = wHtml.match(/"(?:play_count|video_view_count|view_count)":\s*(\d+)/i);
        if (vm) result.views = parseInt(vm[1], 10);

        if (result.likes === null) {
          const wLm = wHtml.match(
            /["'](?:reaction_count|like_count|likers)["']\s*:\s*\{["'](?:count|total_count)["']\s*:\s*(\d+)/i
          );
          if (wLm) result.likes = parseInt(wLm[1], 10);
        }
      } catch {
        // Ignore fallback failure
      }
    }

    // Parse Author & Title
    const { author, title } = parseTitleAndAuthor(ogTitle, ogDesc);
    result.author = author;
    result.title = title;
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : "Scraping failed";
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

    const cleanUrls = Array.from(
      new Set(urls.map((u: string) => (typeof u === "string" ? u.trim() : "")).filter(Boolean))
    );
    if (cleanUrls.length === 0) {
      return NextResponse.json({ error: "No valid URLs provided" }, { status: 400 });
    }

    // Limit batch size to prevent serverless timeout
    const batch = cleanUrls.slice(0, 50);
    const results = await Promise.all(batch.map((url) => scrapeSingleFacebook(url)));

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

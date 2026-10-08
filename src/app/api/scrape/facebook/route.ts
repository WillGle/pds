import { NextRequest, NextResponse } from "next/server";
import { asRecord, embeddedJson, objects, parseCount } from "@/lib/scrape";

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
  if (unit === "k" || unit.includes("nghìn") || unit.includes("ngàn")) {
    multiplier = 1000;
  } else if (unit === "m" || unit === "tr" || unit.includes("triệu")) {
    multiplier = 1000000;
  } else if (unit === "b" || unit.includes("tỉ") || unit.includes("tỷ")) {
    multiplier = 1000000000;
  }

  // Handle dot vs comma decimal notation
  if ((numPart.match(/\./g) || []).length > 1) numPart = numPart.replace(/\./g, "");
  if ((numPart.match(/,/g) || []).length > 1) numPart = numPart.replace(/,/g, "");
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

function extractVideoMetrics(html: string, videoId: string, result: FacebookScrapedItem) {
  const matchesId = (record: Record<string, unknown>) =>
    [record.id, record.video_id, record.videoId, record.legacy_fbid].some((id) => String(id) === videoId);

  const count = (value: unknown) => {
    const record = asRecord(value);
    return parseCount(record ? record.total_count ?? record.count : value);
  };

  const apply = (record: Record<string, unknown>) => {
    result.views ??= count(record.play_count) ?? count(record.video_view_count) ?? count(record.view_count);
    result.likes ??= count(record.reaction_count) ?? count(record.like_count) ?? count(record.likers) ?? count(record.unified_reactors);
    result.comments ??= count(record.total_comment_count) ?? count(record.comment_count) ?? count(record.comments_count);
    result.shares ??= count(record.share_count) ?? count(record.shares_count) ?? parseCount(record.share_count_reduced);
    const timestamp = parseCount(record.creation_time ?? record.publish_time ?? record.upload_time);
    if (result.postDate === "N/A" && timestamp !== null && timestamp >= 100000000 && timestamp <= 9999999999) {
      result.postDate = new Date(timestamp * 1000).toISOString().split("T")[0];
    }
  };

  const roots = [...embeddedJson(html)];
  const originalStoryIds = new Set<string>();
  for (const root of roots) {
    for (const record of objects(root)) {
      if (!matchesId(record)) continue;
      apply(record);
      const feedback = asRecord(record.feedback);
      if (feedback) apply(feedback);
      const story = asRecord(record.creation_story);
      if (story) {
        if (story.id) originalStoryIds.add(String(story.id));
        const storyFeedback = asRecord(story.feedback);
        if (storyFeedback) apply(storyFeedback);
      }
    }
  }
  // Shared posts can attach the same video but have separate engagement counts.
  for (const root of roots) {
    for (const record of objects(root)) {
      if (!originalStoryIds.has(String(record.id))) continue;
      const feedback = asRecord(record.feedback);
      if (feedback) apply(feedback);
    }
  }
}

function metaContent(html: string, name: string): string {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const property = tag[0].match(/(?:property|name)=["']([^"']+)["']/i)?.[1];
    if (property === name) {
      return decodeHtmlEntities(tag[0].match(/content=(["'])([\s\S]*?)\1/i)?.[2] || "");
    }
  }
  return "";
}

async function scrapeSingleFacebook(url: string): Promise<FacebookScrapedItem> {
  const videoId = extractId(url);
  const result: FacebookScrapedItem = {
    url,
    id: videoId,
    views: null,
    likes: null,
    comments: null,
    shares: null,
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

  let ogTitle = "";
  let ogDesc = "";
  let fetchError = "";
  // Try both pages for exact, video-specific counts before using rounded metadata.
  for (const pageUrl of [`https://www.facebook.com/reel/${videoId}`, `https://www.facebook.com/watch/?v=${videoId}`]) {
    try {
      const resp = await fetch(pageUrl, { headers, signal: AbortSignal.timeout(9000), cache: "no-store" });
      if (!resp.ok) throw new Error(`Facebook returned HTTP ${resp.status}`);
      if (resp.url && extractId(resp.url) !== videoId) throw new Error("Facebook redirected away from the requested video");
      const html = await resp.text();
      extractVideoMetrics(html, videoId, result);
      const canonical = metaContent(html, "og:url");
      if (!canonical || extractId(canonical) === videoId) {
        ogTitle ||= metaContent(html, "og:title");
        ogDesc ||= metaContent(html, "og:description");
        result.thumbnail ||= metaContent(html, "og:image");
      }
      if ([result.views, result.likes, result.comments, result.shares].every((value) => value !== null)) break;
    } catch (err: unknown) {
      fetchError = err instanceof Error ? err.message : "Scraping failed";
    }
  }

  // Metadata is a last resort; abbreviated values are explicitly marked approximate.
  const approximate: string[] = [];
  for (const [field, label] of [["views", "lượt xem|views"], ["likes", "cảm xúc|lượt thích|reactions|likes"]] as const) {
    if (result[field] !== null) continue;
    const match = ogTitle.match(new RegExp(`([\\d.,]+)\\s*([a-zA-Z\\u00C0-\\u024F\\u1EA0-\\u1EF9]+)?\\s*(?:${label})`, "i"));
    if (match) {
      result[field] = parseNumberString(`${match[1]} ${match[2] || ""}`);
      if (result[field] !== null && match[2]) approximate.push(field);
    }
  }

  const { author, title } = parseTitleAndAuthor(ogTitle, ogDesc);
  result.author = author;
  result.title = title;
  const missing = (["views", "likes", "comments", "shares"] as const).filter((field) => result[field] === null);
  const messages = [];
  if (approximate.length) messages.push(`Approximate ${approximate.join(", ")} from page metadata`);
  if (missing.length) messages.push(`Unavailable: ${missing.join(", ")}${fetchError ? ` (${fetchError})` : ""}`);
  if (messages.length) result.error = messages.join("; ");
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
    if (cleanUrls.length > 50) {
      return NextResponse.json({ error: "Send at most 50 URLs per request" }, { status: 400 });
    }
    const batch = cleanUrls;
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

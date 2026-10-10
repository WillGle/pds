import { NextRequest, NextResponse } from "next/server";
import { renderFacebookPages } from "@/lib/facebook-browser";
import { asRecord, embeddedJson, formatPostDate, objects, parseCount } from "@/lib/scrape";

export const runtime = "nodejs";
export const maxDuration = 60;

interface FacebookScrapedItem {
  url: string;
  id: string | null;
  views: number | null;
  viewsText: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  author: string;
  title: string;
  postDate: string | null;
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

function extractVideoMetrics(html: string, videoId: string, result: FacebookScrapedItem, source: "watch" | "reel", viewsText: string | null) {
  const normalizeLabel = (value: unknown) => typeof value === "string"
    ? value.toLowerCase().replace(/nghìn/g, "k").replace(/triệu/g, "m").replace(/tỷ/g, "b").replace(/\s/g, "").replace(/,/g, ".") : "";
  if (source === "watch" && viewsText && /^\d+(?:[.,]\d+)?\s*(?:[KMB]|nghìn|triệu|tỷ)?$/i.test(viewsText)) result.viewsText = viewsText;
  const matchesId = (record: Record<string, unknown>) =>
    [record.id, record.video_id, record.videoId, record.legacy_fbid, asRecord(record.associated_video)?.id].some((id) => String(id) === videoId);

  const count = (value: unknown) => {
    const record = asRecord(value);
    return parseCount(record ? record.total_count ?? record.count : value);
  };
  let sourceComments: number | null = null;
  let sourceShares: number | null = null;

  const apply = (record: Record<string, unknown>) => {
    if (source === "watch" && result.views === null) {
      // Match the visible Watch counter: this page can expose different play/view totals.
      if (viewsText) {
        const candidates = [
          [record.play_count_reduced, count(record.play_count)],
          [record.video_view_count_reduced, count(record.video_view_count)],
        ].filter(([label, value]) => value !== null && normalizeLabel(label) === normalizeLabel(viewsText));
        const values = new Set(candidates.map(([, value]) => value as number));
        if (values.size === 1) result.views = [...values][0];
        else if (!/[a-zà-ỹ]/i.test(viewsText)) result.views = parseCount(viewsText);
      } else {
        result.views = count(record.play_count) ?? count(record.video_view_count);
      }
      if (result.views !== null) result.viewsText ||= String(result.views);
    }
    result.likes ??= count(record.reaction_count) ?? count(record.like_count) ?? count(record.likers) ?? count(record.unified_reactors);
    // Keep each source's counters separate so fallback values cannot override the preferred page.
    sourceComments ??= count(record.total_comment_count) ?? count(record.comment_count) ?? count(record.comments_count);
    sourceShares ??= count(record.share_count) ?? count(record.shares_count) ?? parseCount(record.share_count_reduced);
  };

  const applyDate = (record: Record<string, unknown>) => {
    result.postDate ??= formatPostDate(record.publish_time) ?? formatPostDate(record.creation_time) ?? formatPostDate(record.upload_time);
  };

  const roots = [...embeddedJson(html)];
  const originalStoryIds = new Set<string>();
  const originalFeedbackIds = new Set<string>();
  const applyFeedback = (value: unknown) => {
    const feedback = asRecord(value);
    if (!feedback) return;
    if (feedback.id) originalFeedbackIds.add(String(feedback.id));
    apply(feedback);
  };
  for (const root of roots) {
    for (const record of objects(root)) {
      if (!matchesId(record)) continue;
      apply(record);
      applyDate(record);
      applyFeedback(record.feedback);
      const story = asRecord(record.creation_story) || asRecord(record.story);
      if (story) {
        applyDate(story);
        if (story.id) originalStoryIds.add(String(story.id));
        applyFeedback(story.feedback);
      }
    }
  }
  // Shared posts can attach the same video but have separate engagement counts.
  for (const root of roots) {
    for (const record of objects(root)) {
      if (!originalStoryIds.has(String(record.id))) continue;
      applyDate(record);
      applyFeedback(record.feedback);
    }
  }
  for (const root of roots) {
    for (const record of objects(root)) {
      if (originalFeedbackIds.has(String(record.id))) apply(record);
    }
  }
  result.comments = source === "watch" ? sourceComments ?? result.comments : result.comments ?? sourceComments;
  result.shares = source === "reel" ? sourceShares ?? result.shares : result.shares ?? sourceShares;
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
    viewsText: null,
    likes: null,
    comments: null,
    shares: null,
    author: "",
    title: "",
    postDate: null,
    thumbnail: "",
  };

  if (!videoId) {
    result.error = "Could not extract Facebook Reel / Video ID from URL";
    return result;
  }

  let ogTitle = "";
  let ogDesc = "";
  let fetchError = "";
  try {
    // HTTP metadata can report reactions as views. Read the JavaScript-populated pages.
    for (const page of await renderFacebookPages(videoId)) {
      if (page.error) { fetchError = page.error; continue; }
      extractVideoMetrics(page.html, videoId, result, page.source, page.viewsText);
      const canonical = metaContent(page.html, "og:url");
      if (!canonical || extractId(canonical) === videoId) {
        ogTitle ||= metaContent(page.html, "og:title");
        ogDesc ||= metaContent(page.html, "og:description");
        result.thumbnail ||= metaContent(page.html, "og:image");
      }
    }
  } catch (err: unknown) {
    fetchError = err instanceof Error ? err.message : "Scraping failed";
  }

  const { author, title } = parseTitleAndAuthor(ogTitle, ogDesc);
  result.author = author;
  result.title = title;
  const missing = (["views", "likes", "comments", "shares", "postDate"] as const).filter((field) => result[field] === null && !(field === "views" && result.viewsText));
  if (missing.length) result.error = `Unavailable: ${missing.join(", ")}${fetchError ? ` (${fetchError})` : ""}`;
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
    if (cleanUrls.length > 1) {
      return NextResponse.json({ error: "Send one Facebook URL per request" }, { status: 400 });
    }
    const batch = cleanUrls;
    const results = await Promise.all(batch.map((url) => scrapeSingleFacebook(url)));

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

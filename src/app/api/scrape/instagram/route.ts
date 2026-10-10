import { NextRequest, NextResponse } from "next/server";
import { asRecord, embeddedJson, formatIsoDate, formatPostDate, objects, parseCount } from "@/lib/scrape";
import { renderInstagramPage } from "@/lib/instagram-browser";

export const runtime = "nodejs";
export const maxDuration = 60;

interface InstagramItem {
  platform: "instagram";
  url: string;
  author: string;
  postDate: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  error?: string;
}

function instagramUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) ||
      !["instagram.com", "www.instagram.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
    const match = url.pathname.match(/^\/(?:[\w.]+\/)?(reel|p|tv)\/([\w-]{5,40})\/?$/);
    return match ? { shortcode: match[2], url: `https://www.instagram.com/${match[1]}/${match[2]}/` } : null;
  } catch {
    return null;
  }
}

function shortcodeId(shortcode: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let id = BigInt(0);
  for (const char of shortcode) id = id * BigInt(64) + BigInt(alphabet.indexOf(char));
  return id.toString();
}

function* htmlData(html: string) {
  yield* embeddedJson(html);
  // Public embeds store the media object in a JSON string inside an executable script.
  for (const match of html.matchAll(/"contextJSON"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
    try { yield JSON.parse(JSON.parse(match[1])); } catch { /* Ignore malformed embed data. */ }
  }
}

function applyMedia(data: unknown, shortcode: string, result: InstagramItem) {
  const id = shortcodeId(shortcode);
  for (const media of objects(data)) {
    const mediaId = media.pk ?? media.id;
    const matches = media.shortcode === shortcode || media.code === shortcode ||
      (typeof mediaId === "string" && mediaId.split("_")[0] === id);
    if (!matches) continue;
    if (media.is_video === false || media.media_type === 1 || media.__typename === "GraphImage" ||
      media.__typename === "GraphSidecar" || media.media_type === 8) {
      result.error = "Only Instagram Reels and video posts are supported";
      continue;
    }
    const owner = asRecord(media.owner) ?? asRecord(media.user);
    if (typeof owner?.username === "string") result.author ||= owner.username;
    const date = formatPostDate(media.taken_at_timestamp ?? media.taken_at) || formatIsoDate(media.timestamp);
    if (date) result.postDate = date;
    result.views ??= parseCount(media.video_view_count) ?? parseCount(media.video_play_count) ?? parseCount(media.play_count);
    if (media.like_and_view_counts_disabled !== true && media.hide_like_and_view_counts !== true) {
      result.likes ??= parseCount(media.like_count) ?? parseCount(asRecord(media.edge_media_preview_like)?.count) ??
        parseCount(asRecord(media.edge_liked_by)?.count);
    }
    result.comments ??= parseCount(media.comment_count) ?? parseCount(asRecord(media.edge_media_to_parent_comment)?.count) ??
      parseCount(asRecord(media.edge_media_to_comment)?.count);
    result.shares ??= parseCount(media.share_count) ?? parseCount(media.shares_count);
    result.saves ??= parseCount(media.save_count) ?? parseCount(media.saved_count);
  }
}

function applyHtml(html: string, shortcode: string, result: InstagramItem) {
  for (const data of htmlData(html)) applyMedia(data, shortcode, result);
  const meta = (name: string) => {
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
      if (match[0].match(/(?:property|name)=["']([^"']*)["']/i)?.[1] !== name) continue;
      return match[0].match(/content=["']([^"']*)["']/i)?.[1] || "";
    }
    return "";
  };
  if (instagramUrl(meta("og:url"))?.shortcode !== shortcode) return;
  // Only full integer counters in metadata for the requested post; never expand 5K.
  const description = meta("og:description") || meta("description");
  const match = description.match(/^(?:(.*?) likes?, (.*?) comments? - )?([\w.]+) on ([A-Z][a-z]+ \d{1,2}, \d{4}):/);
  if (match) {
    const exact = (label?: string) => label && /^\d+(?:,\d{3})*$/.test(label)
      ? parseCount(label.replace(/,/g, "")) : null;
    result.likes ??= exact(match[1]);
    result.comments ??= exact(match[2]);
    result.author ||= match[3];
    // Metadata gives a calendar date only; preserve it without inventing a timestamp.
    result.postDate ||= formatIsoDate(`${match[4]} UTC`);
  }
}

function missingFields(result: InstagramItem) {
  const missing = (["views", "likes", "comments", "postDate"] as const).filter((field) => result[field] === null);
  return [...missing, ...(!result.author ? ["author"] : [])];
}

async function scrapeInstagram(rawUrl: string): Promise<InstagramItem> {
  const result: InstagramItem = {
    platform: "instagram", url: rawUrl, author: "", postDate: null,
    views: null, likes: null, comments: null, shares: null, saves: null,
  };
  const target = instagramUrl(rawUrl);
  if (!target) {
    result.error = "Enter an Instagram Reel or video post URL";
    return result;
  }
  const deadline = Date.now() + 45000;
  let fetchError = "";
  const headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept-Language": "en-US,en;q=0.9",
  };
  for (const url of [target.url, `${target.url}embed/captioned/`]) {
    if (!missingFields(result).length || result.error || Date.now() >= deadline) break;
    try {
      const response = await fetch(url, {
        headers, cache: "no-store",
        signal: AbortSignal.timeout(Math.max(1, Math.min(6000, deadline - Date.now()))),
      });
      if (!response.ok) throw new Error(`Instagram returned HTTP ${response.status}`);
      if (instagramUrl(response.url.replace(/embed\/captioned\/$/, ""))?.shortcode !== target.shortcode) {
        throw new Error("Instagram redirected away from the requested post");
      }
      applyHtml(await response.text(), target.shortcode, result);
    } catch (error) {
      fetchError = error instanceof Error ? error.message : "Instagram request failed";
    }
  }
  if (missingFields(result).length && !result.error && deadline - Date.now() > 3000) {
    try {
      const { html, payloads } = await renderInstagramPage(target.url, Math.min(deadline, Date.now() + 25000));
      applyHtml(html, target.shortcode, result);
      for (const data of payloads) applyMedia(data, target.shortcode, result);
    } catch (error) {
      fetchError = error instanceof Error ? error.message : "Instagram browser failed";
    }
  }
  const missing = missingFields(result);
  if (missing.length && !result.error) {
    result.error = `Unavailable: ${missing.join(", ")}${fetchError ? ` (${fetchError})` : ""}`;
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    const result = await scrapeInstagram(url.trim());
    return NextResponse.json({ success: !result.error, data: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Instagram extraction failed" }, { status: 500 });
  }
}

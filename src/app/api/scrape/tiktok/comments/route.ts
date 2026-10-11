import { NextRequest, NextResponse } from "next/server";
import { scrapeTikTokComments, type CommentTableRow } from "@/lib/tiktok-comments";

export const runtime = "nodejs";
export const maxDuration = 60;

function generateCsv(rows: CommentTableRow[]): string {
  const header = "id,Comment\n";
  const lines = rows.map((r) => `${r.id},"${r.Comment.replace(/"/g, '""')}"`);
  // Prepend UTF-8 BOM so spreadsheet viewers render accents properly
  return "\uFEFF" + header + lines.join("\n");
}

function generateTsv(rows: CommentTableRow[]): string {
  const header = "id\tComment\n";
  const lines = rows.map((r) => `${r.id}\t${r.Comment.replace(/[\r\n\t]+/g, " ")}`);
  return header + lines.join("\n");
}

function handleResponse(rows: CommentTableRow[], format?: string | null) {
  const fmt = (format || "").toLowerCase();
  if (fmt === "csv") {
    return new NextResponse(generateCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="tiktok_comments_sentiment.csv"',
      },
    });
  }
  if (fmt === "tsv") {
    return new NextResponse(generateTsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": 'attachment; filename="tiktok_comments_sentiment.tsv"',
      },
    });
  }

  // Default: Direct 2-column array for multimodal sentiment analysis
  return NextResponse.json(rows, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { url, maxComments, expandReplies, format } = body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return NextResponse.json(
        { error: "Field 'url' is required and must be a valid TikTok video URL" },
        { status: 400 }
      );
    }

    const parsedMaxComments = typeof maxComments === "number" && maxComments > 0 ? maxComments : 100;
    const shouldExpandReplies = expandReplies !== false;

    const result = await scrapeTikTokComments(url, {
      maxComments: parsedMaxComments,
      expandReplies: shouldExpandReplies,
      timeoutMs: 50000,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Failed to scrape TikTok comments" }, { status: 500 });
    }

    return handleResponse(result.data, format);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");

    if (!url || !url.trim()) {
      return NextResponse.json(
        { error: "Query parameter 'url' is required (e.g. ?url=https://www.tiktok.com/...)" },
        { status: 400 }
      );
    }

    const maxCommentsParam = searchParams.get("maxComments");
    const parsedMaxComments = maxCommentsParam ? parseInt(maxCommentsParam, 10) : 100;
    const expandReplies = searchParams.get("expandReplies") !== "false";
    const format = searchParams.get("format");

    const result = await scrapeTikTokComments(url, {
      maxComments: isNaN(parsedMaxComments) ? 100 : parsedMaxComments,
      expandReplies,
      timeoutMs: 50000,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Failed to scrape TikTok comments" }, { status: 500 });
    }

    return handleResponse(result.data, format);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { scrapeFacebookComments } from "@/lib/facebook-comments";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { url, maxComments, expandReplies, maxIterations } = body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return NextResponse.json(
        { error: "Field 'url' is required and must be a valid Facebook post URL" },
        { status: 400 }
      );
    }

    const parsedMaxComments = typeof maxComments === "number" && maxComments > 0 ? maxComments : 100;
    const shouldExpandReplies = expandReplies !== false;
    const parsedIterations = typeof maxIterations === "number" && maxIterations > 0 ? maxIterations : 8;

    const result = await scrapeFacebookComments(url, {
      maxComments: parsedMaxComments,
      expandReplies: shouldExpandReplies,
      maxIterations: parsedIterations,
      timeoutMs: 50000,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
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
        { error: "Query parameter 'url' is required (e.g. ?url=https://www.facebook.com/...)" },
        { status: 400 }
      );
    }

    const maxCommentsParam = searchParams.get("maxComments");
    const parsedMaxComments = maxCommentsParam ? parseInt(maxCommentsParam, 10) : 50;
    const expandReplies = searchParams.get("expandReplies") !== "false";

    const result = await scrapeFacebookComments(url, {
      maxComments: isNaN(parsedMaxComments) ? 50 : parsedMaxComments,
      expandReplies,
      maxIterations: 6,
      timeoutMs: 50000,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

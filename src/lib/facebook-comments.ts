import chromium from "@sparticuz/chromium";
import puppeteer, { TimeoutError, type Page, type HTTPRequest } from "puppeteer-core";

export interface FacebookCommentItem {
  id: string;
  text: string;
  author: string;
  time: string;
  likes: number | null;
  isReply: boolean;
  replyTo?: string | null;
}

export interface FacebookCommentsResult {
  success: boolean;
  url: string;
  total: number;
  comments: FacebookCommentItem[];
  error?: string;
}

export interface ScrapeCommentsOptions {
  maxComments?: number;
  expandReplies?: boolean;
  maxIterations?: number;
  timeoutMs?: number;
}

export async function scrapeFacebookComments(
  rawUrl: string,
  options: ScrapeCommentsOptions = {}
): Promise<FacebookCommentsResult> {
  const maxComments = Math.min(options.maxComments ?? 100, 300);
  const expandReplies = options.expandReplies ?? true;
  const maxIterations = options.maxIterations ?? 10;
  const timeoutMs = options.timeoutMs ?? 50000;
  const deadline = Date.now() + timeoutMs;

  const cleanUrl = rawUrl.trim();
  if (!cleanUrl) {
    return {
      success: false,
      url: rawUrl,
      total: 0,
      comments: [],
      error: "URL cannot be empty",
    };
  }

  const isLocal =
    !process.env.VERCEL &&
    !process.env.AWS_LAMBDA_FUNCTION_NAME &&
    Boolean(process.env.CHROME_EXECUTABLE_PATH);

  const executablePath = isLocal
    ? process.env.CHROME_EXECUTABLE_PATH!
    : (await chromium.executablePath());

  const browser = await puppeteer.launch({
    executablePath,
    args: isLocal
      ? [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--blink-settings=imagesEnabled=false",
          "--disable-remote-fonts",
          "--disable-background-networking",
          "--mute-audio",
        ]
      : [
          ...chromium.args,
          "--blink-settings=imagesEnabled=false",
          "--disable-remote-fonts",
          "--mute-audio",
        ],
    headless: true,
    timeout: 10000,
    defaultViewport: { width: 1440, height: 1080 },
  });

  const timer = setTimeout(() => {
    browser.process()?.kill("SIGKILL");
  }, Math.max(1000, deadline - Date.now()));

  let page: Page | null = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    // Abort heavy media, images, and fonts to maximize speed
    await page.setRequestInterception(true);
    page.on("request", (req: HTTPRequest) => {
      const type = req.resourceType();
      if (["image", "media", "font"].includes(type)) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });

    // If URL is a reel, also prepare watch URL as possible fallback
    const reelMatch = cleanUrl.match(/(?:reels?\/)(\d+)/);
    const targetUrl = reelMatch
      ? `https://www.facebook.com/watch/?v=${reelMatch[1]}`
      : cleanUrl;

    try {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(25000, Math.max(5000, deadline - Date.now() - 10000)),
      });
    } catch (err: unknown) {
      if (!(err instanceof TimeoutError)) throw err;
    }

    // Give DOM a short moment to initialize client components
    await new Promise((r) => setTimeout(r, 2000));

    // Handle initial login dialog without closing the post modal
    await page.evaluate(() => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      dialogs.forEach((dialog) => {
        const text = (dialog as HTMLElement).innerText || "";
        // Only remove if it's purely a login wall and not the post itself
        const isLoginWall =
          (text.includes("Xem thêm trên Facebook") || text.includes("Đăng nhập")) &&
          !text.includes("bình luận") &&
          !text.includes("Bình luận") &&
          !text.includes("chia sẻ");

        if (isLoginWall) {
          const closeBtn = dialog.querySelector<HTMLElement>(
            'div[aria-label="Đóng"], div[aria-label="Close"]'
          );
          if (closeBtn) {
            closeBtn.click();
          } else {
            dialog.remove();
          }
        }
      });
    });

    // If comments are hidden (e.g. on watch/reel view), attempt to click comment trigger button
    await page.evaluate(() => {
      const hasComments = document.querySelectorAll('div[role="article"]').length > 1;
      if (!hasComments) {
        const commentBtn = document.querySelector<HTMLElement>(
          'div[aria-label="Bình luận"], div[aria-label="Comment"], div[role="button"][aria-label*="bình luận"], div[role="button"][aria-label*="comment"]'
        );
        if (commentBtn) commentBtn.click();
      }
    });

    await new Promise((r) => setTimeout(r, 1500));

    // Iteratively expand more comments and replies until maxComments or deadline
    for (let iter = 0; iter < maxIterations; iter++) {
      if (Date.now() >= deadline - 4000) break;

      const currentCount = await page.evaluate(() => {
        return document.querySelectorAll(
          'div[role="article"][aria-label*="bình luận" i], div[role="article"][aria-label*="comment" i], div[role="article"][aria-label*="phản hồi" i], div[role="article"][aria-label*="reply" i]'
        ).length;
      });

      if (currentCount >= maxComments) break;

      const clickedCount = await page.evaluate((shouldExpandReplies: boolean) => {
        let count = 0;

        // Click 'Xem thêm bình luận' / 'View more comments'
        const moreButtons = Array.from(
          document.querySelectorAll<HTMLElement>('div[role="button"], span[role="button"]')
        ).filter((b) =>
          /xem thêm.*bình luận|view more.*comments|xem các bình luận trước|view previous comments/i.test(
            b.innerText?.trim() || ""
          )
        );

        for (const btn of moreButtons) {
          btn.click();
          count++;
        }

        // Click 'Xem tất cả ... phản hồi' / 'View ... replies'
        if (shouldExpandReplies) {
          const replyButtons = Array.from(
            document.querySelectorAll<HTMLElement>('div[role="button"], span[role="button"]')
          ).filter((b) =>
            /xem.*phản hồi|view.*replies/i.test(b.innerText?.trim() || "")
          );

          for (const btn of replyButtons) {
            btn.click();
            count++;
          }
        }

        return count;
      }, expandReplies);

      if (clickedCount === 0) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Extract all comments from DOM
    const rawComments = await page.evaluate((limit: number) => {
      const articles = Array.from(document.querySelectorAll<HTMLElement>('div[role="article"]')).filter((a) => {
        const aria = a.getAttribute("aria-label") || "";
        return /bình luận|comment|phản hồi|reply/i.test(aria);
      });

      return articles.slice(0, limit).map((art, index) => {
        const aria = art.getAttribute("aria-label") || "";
        const isReply = /phản hồi|reply/i.test(aria);

        // Extract author
        const authorSpan = art.querySelector('span[dir="auto"]');
        const author = authorSpan?.textContent?.trim() || "";

        // Extract replyTo if applicable from aria-label
        let replyTo: string | null = null;
        if (isReply) {
          const replyMatch = aria.match(/phản hồi bình luận của (.*?) dưới tên/i) ||
                             aria.match(/reply to (.*?)'s comment by/i);
          if (replyMatch) replyTo = replyMatch[1].trim();
        }

        // Extract comment text: prefer div[dir="auto"] inside the article
        const dirAutos = Array.from(art.querySelectorAll<HTMLElement>('div[dir="auto"]'));
        let text = "";
        if (dirAutos.length > 0) {
          text = dirAutos[0].innerText?.trim() || "";
        } else {
          text = art.innerText?.trim() || "";
        }

        // Extract comment ID and timestamp
        const timeLink = Array.from(art.querySelectorAll<HTMLAnchorElement>("a")).find((a) => {
          const href = a.getAttribute("href") || "";
          return href.includes("comment_id=") || href.includes("reply_comment_id=");
        });
        let timeText = timeLink?.textContent?.trim() || "";
        if (!timeText) {
          const ariaTimeMatch = aria.match(/(?:vào|at)\s+(.*?)(?:\s+trước|\s+ago)?$/i);
          if (ariaTimeMatch) timeText = ariaTimeMatch[1].trim();
        }

        const href = timeLink?.href || "";
        let id = "";
        const rawIdMatch = href.match(/(?:reply_comment_id|comment_id)=([^&]+)/);
        if (rawIdMatch) {
          const val = decodeURIComponent(rawIdMatch[1]);
          if (/^\d+$/.test(val)) {
            id = val;
          } else {
            try {
              const decoded = atob(val);
              const subMatch = decoded.match(/_(\d+)$/);
              if (subMatch) id = subMatch[1];
            } catch {
              // Ignore decoding failure
            }
          }
        }
        if (!id) id = `cmt_${index + 1}`;

        // Extract likes / reaction count
        const fullText = art.innerText || "";
        const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean);
        let likes: number | null = null;
        for (const line of lines) {
          if (/^\d+$/.test(line) && line !== timeText && line !== author) {
            likes = parseInt(line, 10);
          }
        }

        return {
          id,
          text,
          author,
          time: timeText,
          likes,
          isReply,
          replyTo,
        };
      });
    }, maxComments);

    return {
      success: true,
      url: cleanUrl,
      total: rawComments.length,
      comments: rawComments,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to scrape Facebook comments";
    return {
      success: false,
      url: cleanUrl,
      total: 0,
      comments: [],
      error: errorMsg,
    };
  } finally {
    clearTimeout(timer);
    if (page) {
      await page.close().catch(() => {});
    }
    const closeTimer = setTimeout(() => {
      browser.process()?.kill("SIGKILL");
    }, 2000);
    try {
      await browser.close();
    } catch {
      // Browser might have already stopped
    } finally {
      clearTimeout(closeTimer);
    }
  }
}

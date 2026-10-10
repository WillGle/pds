import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export async function renderFacebookPages(videoId: string) {
  const deadline = Date.now() + 45000;
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
      ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
      : chromium.args,
    headless: true,
    timeout: 8000,
    defaultViewport: { width: 1440, height: 1080 },
  });
  const timer = setTimeout(() => { browser.process()?.kill("SIGKILL"); }, Math.max(1, deadline - Date.now()));
  const pages: { source: "watch" | "reel"; html: string; viewsText: string | null; error?: string }[] = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7" });
    // Keep scripts and styles that populate counters; skip video downloads and artwork.
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const action = ["media", "image", "font"].includes(request.resourceType()) ? request.abort() : request.continue();
      void action.catch(() => {});
    });
    for (const source of ["watch", "reel"] as const) {
      try {
        const url = source === "watch"
          ? `https://www.facebook.com/watch/?v=${videoId}`
          : `https://www.facebook.com/reel/${videoId}`;
        if (Date.now() >= deadline) throw new Error("Request time limit reached");
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.max(1, Math.min(8000, deadline - Date.now())) });
        if (!response?.ok()) throw new Error(`Facebook returned HTTP ${response?.status()}`);
        if (!new RegExp(`(?:v=|reels?\\/|videos\\/)${videoId}(?:[/?&#]|$)`).test(page.url())) {
          throw new Error("Facebook redirected away from the requested video");
        }
        await page.waitForFunction((isWatch) => isWatch
          ? /\d/.test(document.querySelector("._26fq")?.textContent || "")
          : document.documentElement.innerHTML.includes('"share_count_reduced"'),
        { timeout: Math.max(1, Math.min(5000, deadline - Date.now())) }, source === "watch").catch(() => {});
        const viewsText = source === "watch" ? await page.evaluate(() => {
          const counters = [...document.querySelectorAll("._26fq")].filter((element) => (element as HTMLElement).offsetParent !== null);
          return counters.length === 1 ? (counters[0].textContent || "").replace(/\s*(?:lượt xem|views)\s*$/i, "").trim() : null;
        }) : null;
        pages.push({ source, html: await page.content(), viewsText });
      } catch (err: unknown) {
        pages.push({ source, html: "", viewsText: null, error: err instanceof Error ? err.message : "Facebook page failed" });
      }
    }
    return pages;
  } finally {
    clearTimeout(timer);
    const closeTimer = setTimeout(() => { browser.process()?.kill("SIGKILL"); }, 2000);
    try { await browser.close(); } catch { /* The deadline may already have stopped this browser. */ }
    finally { clearTimeout(closeTimer); }
  }
}

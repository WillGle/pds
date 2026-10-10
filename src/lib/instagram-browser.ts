import chromium from "@sparticuz/chromium";
import puppeteer, { TimeoutError } from "puppeteer-core";

export async function renderInstagramPage(url: string, deadline: number) {
  const isLocal = !process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME &&
    Boolean(process.env.CHROME_EXECUTABLE_PATH);
  const browser = await puppeteer.launch({
    executablePath: isLocal ? process.env.CHROME_EXECUTABLE_PATH! : await chromium.executablePath(),
    args: isLocal
      ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--mute-audio"]
      : [...chromium.args, "--mute-audio"],
    headless: true,
    timeout: Math.max(1, Math.min(8000, deadline - Date.now())),
    defaultViewport: { width: 1440, height: 1080 },
  });
  const timer = setTimeout(() => browser.process()?.kill("SIGKILL"), Math.max(1, deadline - Date.now()));
  try {
    const page = await browser.newPage();
    const payloads: unknown[] = [];
    const pending: Promise<void>[] = [];
    await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const action = ["media", "image", "font"].includes(request.resourceType())
        ? request.abort() : request.continue();
      void action.catch(() => {});
    });
    page.on("response", (response) => {
      const source = new URL(response.url());
      if (pending.length >= 10 || !source.hostname.endsWith(".instagram.com") ||
        !/\/(?:graphql|api\/v1\/media)\//.test(source.pathname) ||
        !response.headers()["content-type"]?.includes("json")) return;
      pending.push(response.json().then((data: unknown) => { payloads.push(data); }).catch(() => {}));
    });
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: Math.max(1, Math.min(15000, deadline - Date.now() - 4000)),
      });
      if (!response?.ok()) throw new Error(`Instagram returned HTTP ${response?.status()}`);
    } catch (error) {
      if (!(error instanceof TimeoutError)) throw error;
    }
    const shortcode = new URL(url).pathname.split("/").filter(Boolean).at(-1)!;
    const loaded = new URL(page.url());
    if (!["instagram.com", "www.instagram.com"].includes(loaded.hostname) ||
      !new RegExp(`^/(?:[\\w.]+/)?(?:reel|p|tv)/${shortcode}/?$`).test(loaded.pathname)) {
      throw new Error("Instagram redirected away from the requested post");
    }
    await page.waitForNetworkIdle({ idleTime: 300, timeout: Math.max(1, Math.min(3000, deadline - Date.now())) })
      .catch(() => {});
    const html = await page.content();
    await Promise.allSettled(pending);
    return { html, payloads };
  } finally {
    clearTimeout(timer);
    const closeTimer = setTimeout(() => browser.process()?.kill("SIGKILL"), 2000);
    try { await browser.close(); } catch { /* The deadline may already have stopped this browser. */ }
    finally { clearTimeout(closeTimer); }
  }
}

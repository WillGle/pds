"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

interface FacebookItem {
  url: string;
  viewsText?: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  author: string;
  postDate: string | null;
  error?: string;
}

interface TikTokItem {
  url: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  author: string;
  postDate: string | null;
  error?: string;
}

interface YouTubeItem {
  url: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  author: string;
  title?: string;
  postDate: string | null;
  error?: string;
}

const SAMPLE_FB_URLS = [
  "https://www.facebook.com/reel/1075481022014849",
  "https://www.facebook.com/reel/1085809004361213",
  "https://www.facebook.com/reel/1094098730205969",
  "https://www.facebook.com/reel/1098367839472334",
  "https://www.facebook.com/reel/1121302183629169",
  "https://www.facebook.com/reel/1155814413543744",
  "https://www.facebook.com/reel/1615474403926532",
  "https://www.facebook.com/reel/1633654028138840",
  "https://www.facebook.com/reel/1724886005273564",
  "https://www.facebook.com/reel/1832143117797405",
  "https://www.facebook.com/reel/27844529595221374",
  "https://www.facebook.com/reel/28789946150636717",
  "https://www.facebook.com/reel/3863934517086937",
].join("\n");

const SAMPLE_TT_URLS = [
  "https://www.tiktok.com/@anhchongcongnghe/video/7690930227022761223",
  "https://www.tiktok.com/@anhchongcongnghe/video/7692367995011747090",
  "https://www.tiktok.com/@bep_nho_mymy/video/7691999188082494772",
  "https://www.tiktok.com/@chutunghamvui66988/video/7690560348079901960",
  "https://www.tiktok.com/@chuyennhalinhbi/video/7690544641992592641",
  "https://www.tiktok.com/@duyen_chill/video/7692416790378384660",
  "https://www.tiktok.com/@hienthaydoi68/video/7691297165037063425",
  "https://www.tiktok.com/@hnhu2000/video/7691226356893453569",
  "https://www.tiktok.com/@hoangnga_home/video/7691183589144202503",
  "https://www.tiktok.com/@hoangnga_home/video/7693138486311800072",
  "https://www.tiktok.com/@ngocvy190893/video/7692046416558034194",
  "https://www.tiktok.com/@phamnhuquynh0225/video/7691168794345065735",
  "https://www.tiktok.com/@taydayroi/video/7691682458538118420",
  "https://www.tiktok.com/@thanhtatdaily/video/7693155206737054984",
  "https://www.tiktok.com/@tibeoheothi/video/7692308595119115526",
  "https://www.tiktok.com/@wydanhdu/video/7692438786533297426",
  "https://www.tiktok.com/@yenthichanvat/video/7692031939166915858",
].join("\n");

const SAMPLE_YT_URLS = [
  "https://www.youtube.com/shorts/LCIdTSsXFvU",
  "https://www.youtube.com/shorts/Hdck1z1aXcg",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtu.be/kJQP7kiw5Fk",
].join("\n");

function formatShortLink(url: string): string {
  if (!url) return "";
  const withoutProtocol = url.replace(/^https?:\/\/(?:www\.)?/, "");
  const base = withoutProtocol.split("?")[0].replace(/\/$/, "");
  // Preserve ?v= for YouTube watch URLs so distinct videos aren't shown as the same link
  const videoId = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1];
  return videoId ? `${base}?v=${videoId}` : base;
}

function hasCompleteMetrics(item: FacebookItem | TikTokItem | YouTubeItem): boolean {
  if (item.error || !item.postDate || !/^\d{4}-\d{2}-\d{2}$/.test(item.postDate)) {
    return false;
  }
  const compactViews =
    "viewsText" in item &&
    typeof item.viewsText === "string" &&
    /^\d+(?:[.,]\d+)?\s*(?:[KMB]|nghìn|triệu|tỷ)?$/i.test(item.viewsText);

  if (!compactViews && (item.views === null || !Number.isSafeInteger(item.views) || item.views < 0)) {
    return false;
  }
  if (item.likes === null || !Number.isSafeInteger(item.likes) || item.likes < 0) {
    return false;
  }
  if (item.comments === null || !Number.isSafeInteger(item.comments) || item.comments < 0) {
    return false;
  }
  if ("saves" in item && (item.saves === null || !Number.isSafeInteger(item.saves) || item.saves < 0)) {
    return false;
  }
  // Facebook (has viewsText) and TikTok (has saves) expose public share counts; YouTube does not.
  const sharesRequired = "saves" in item /* TikTok */ || "viewsText" in item /* Facebook */;
  if ("shares" in item && sharesRequired) {
    if (item.shares === null || !Number.isSafeInteger(item.shares) || item.shares < 0) {
      return false;
    }
  }
  return true;
}

function facebookViews(item: FacebookItem): number | string {
  return item.views ?? (item.viewsText ? `${item.viewsText} (rounded)` : "");
}

function mergeRows<T extends { url: string }>(previous: T[], incoming: T[], retry: boolean): T[] {
  if (!retry) return [...previous, ...incoming];
  const replacements = new Map(incoming.map((item) => [item.url, item]));
  const merged = previous.map((item) => replacements.get(item.url) ?? item);
  // Append any incoming URLs that weren't already in the previous list (defensive for future refactors)
  const previousUrls = new Set(previous.map((i) => i.url));
  const appended = incoming.filter((i) => !previousUrls.has(i.url));
  return [...merged, ...appended];
}

type PlatformKey = "facebook" | "tiktok" | "youtube";
type ScrapedItem = FacebookItem | TikTokItem | YouTubeItem;

const PLATFORMS = {
  facebook: {
    key: "facebook" as const,
    name: "Facebook",
    tabLabel: "Facebook Reels",
    icon: "📘",
    badgeClass: "fb" as const,
    textareaId: "fb-url-input",
    startBtnId: "fb-start-btn",
    stopBtnId: "fb-stop-btn",
    placeholder: "https://www.facebook.com/reel/1075481022014849",
    showShares: true,
    showSaves: false,
  },
  tiktok: {
    key: "tiktok" as const,
    name: "TikTok",
    tabLabel: "TikTok Videos",
    icon: "🎵",
    badgeClass: "tt" as const,
    textareaId: "tt-url-input",
    startBtnId: "tt-start-btn",
    stopBtnId: "tt-stop-btn",
    placeholder: "https://www.tiktok.com/@user/video/1234567890",
    showShares: true,
    showSaves: true,
  },
  youtube: {
    key: "youtube" as const,
    name: "YouTube",
    tabLabel: "YouTube Videos / Shorts",
    icon: "▶️",
    badgeClass: "yt" as const,
    textareaId: "yt-url-input",
    startBtnId: "yt-start-btn",
    stopBtnId: "yt-stop-btn",
    placeholder: "https://www.youtube.com/shorts/LCIdTSsXFvU",
    showShares: false,
    showSaves: false,
  },
};

function getStatusInfo(item: ScrapedItem): {
  type: "complete" | "rounded" | "incomplete" | "error";
  label: string;
  tooltip?: string;
} {
  if (item.error) {
    return {
      type: "error",
      label: item.error,
      tooltip: item.error,
    };
  }
  if (hasCompleteMetrics(item)) {
    if ("viewsText" in item && item.views === null && item.viewsText) {
      return {
        type: "rounded",
        label: "Complete (rounded views)",
        tooltip: `Views estimated from compact string: ${item.viewsText}`,
      };
    }
    return {
      type: "complete",
      label: "Complete",
    };
  }
  return {
    type: "incomplete",
    label: "Incomplete",
    tooltip: "Missing or unverified counts or post date",
  };
}

function ResultsTable({
  platform,
  items,
  searchQuery,
}: {
  platform: PlatformKey;
  items: ScrapedItem[];
  searchQuery: string;
}) {
  const showShares = platform !== "youtube";
  const showSaves = platform === "tiktok";
  const totalCols = 7 + (showShares ? 1 : 0) + (showSaves ? 1 : 0);

  return (
    <table className="custom-table">
      <thead>
        <tr>
          <th style={{ width: "38px", textAlign: "center" }}>#</th>
          <th style={{ width: "160px" }}>Author</th>
          <th style={{ width: "310px" }}>Link</th>
          <th style={{ width: "110px" }} title="Posting date in Vietnam time (UTC+7)">
            Post Date
          </th>
          <th className="th-num" style={{ width: "95px" }}>Views</th>
          <th className="th-num" style={{ width: "85px" }}>Likes</th>
          <th className="th-num" style={{ width: "85px" }}>Comments</th>
          {showShares && <th className="th-num" style={{ width: "85px" }}>Shares</th>}
          {showSaves && <th className="th-num" style={{ width: "85px" }}>Saves</th>}
          <th style={{ width: "auto" }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <td colSpan={totalCols} className="table-empty">
              {searchQuery ? `No items match "${searchQuery}"` : "No scraped data yet"}
            </td>
          </tr>
        ) : (
          items.map((item, idx) => {
            const status = getStatusInfo(item);
            const authorTitle =
              "title" in item && item.title ? `${item.author} (${item.title})` : item.author;
            return (
              <tr key={item.url + idx}>
                <td className="td-index">{idx + 1}</td>
                <td className="table-author" title={authorTitle}>
                  {item.author || "—"}
                </td>
                <td className="table-link">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="short-link"
                    title={item.url}
                  >
                    {formatShortLink(item.url)}
                  </a>
                </td>
                <td className="td-date">
                  {item.postDate || <span className="text-dim">N/A</span>}
                </td>
                <td className="td-num">
                  {item.views !== null ? (
                    <span>{item.views.toLocaleString()}</span>
                  ) : "viewsText" in item && item.viewsText ? (
                    <span>{facebookViews(item as FacebookItem)}</span>
                  ) : (
                    <span className="text-dim">N/A</span>
                  )}
                </td>
                <td className="td-num">
                  {item.likes !== null ? (
                    item.likes.toLocaleString()
                  ) : (
                    <span className="text-dim">N/A</span>
                  )}
                </td>
                <td className="td-num">
                  {item.comments !== null ? (
                    item.comments.toLocaleString()
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
                {showShares && (
                  <td className="td-num">
                    {item.shares !== null ? (
                      item.shares.toLocaleString()
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                )}
                {showSaves && (
                  <td className="td-num">
                    {"saves" in item && item.saves !== null ? (
                      item.saves.toLocaleString()
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                )}
                <td className="table-status">
                  <span
                    className={`status-badge status-${status.type}`}
                    title={status.tooltip}
                  >
                    <span className="status-dot" />
                    {status.label}
                  </span>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<PlatformKey>("facebook");

  // Facebook state
  const [fbInput, setFbInput] = useState(SAMPLE_FB_URLS);
  const [fbResults, setFbResults] = useState<FacebookItem[]>([]);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbElapsed, setFbElapsed] = useState<number | null>(null);
  const [fbProgress, setFbProgress] = useState<{ current: number; total: number } | null>(null);
  const abortFbRef = useRef<boolean>(false);

  // TikTok state
  const [ttInput, setTtInput] = useState(SAMPLE_TT_URLS);
  const [ttResults, setTtResults] = useState<TikTokItem[]>([]);
  const [ttLoading, setTtLoading] = useState(false);
  const [ttElapsed, setTtElapsed] = useState<number | null>(null);
  const [ttProgress, setTtProgress] = useState<{ current: number; total: number } | null>(null);
  const abortTtRef = useRef<boolean>(false);

  // YouTube state
  const [ytInput, setYtInput] = useState(SAMPLE_YT_URLS);
  const [ytResults, setYtResults] = useState<YouTubeItem[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytElapsed, setYtElapsed] = useState<number | null>(null);
  const [ytProgress, setYtProgress] = useState<{ current: number; total: number } | null>(null);
  const abortYtRef = useRef<boolean>(false);

  // Search filter
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedType, setCopiedType] = useState<string | null>(null);

  // Per-tab live timers — isolated so each tab's counter never affects another
  const [fbTimer, setFbTimer] = useState(0);
  const [ttTimer, setTtTimer] = useState(0);
  const [ytTimer, setYtTimer] = useState(0);
  useEffect(() => {
    if (!fbLoading) return;
    const interval = setInterval(() => setFbTimer((p) => +(p + 0.1).toFixed(1)), 100);
    return () => clearInterval(interval);
  }, [fbLoading]);
  useEffect(() => {
    if (!ttLoading) return;
    const interval = setInterval(() => setTtTimer((p) => +(p + 0.1).toFixed(1)), 100);
    return () => clearInterval(interval);
  }, [ttLoading]);
  useEffect(() => {
    if (!ytLoading) return;
    const interval = setInterval(() => setYtTimer((p) => +(p + 0.1).toFixed(1)), 100);
    return () => clearInterval(interval);
  }, [ytLoading]);

  // Handle Facebook scrape
  const handleScrapeFacebook = async (retryUrls?: string[]) => {
    const urls =
      retryUrls ??
      Array.from(
        new Set(
          fbInput
            .split("\n")
            .map((u) => u.trim())
            .filter(Boolean)
        )
      );
    if (urls.length === 0) return;

    abortFbRef.current = false;
    setFbLoading(true);
    setFbTimer(0);
    if (!retryUrls) setFbResults([]);
    setFbElapsed(null);
    setFbProgress({ current: 0, total: urls.length });
    const start = performance.now();

    try {
      let completed = 0;
      let nextIdx = 0;
      const concurrency = Math.min(3, urls.length);

      const worker = async () => {
        while (nextIdx < urls.length && !abortFbRef.current) {
          const i = nextIdx++;
          const currentUrl = urls[i];
          try {
            const resp = await fetch("/api/scrape/facebook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ urls: [currentUrl] }),
            });
            const data = await resp.json();
            if (!resp.ok || !Array.isArray(data.data)) throw new Error(data.error || "Facebook extraction failed");
            const returned = new Map<string, FacebookItem>(data.data.map((item: FacebookItem) => [item.url, item]));
            const item = returned.get(currentUrl);
            const incoming: FacebookItem = {
              url: currentUrl,
              views: item?.views ?? null,
              viewsText: item?.viewsText ?? null,
              likes: item?.likes ?? null,
              comments: item?.comments ?? null,
              shares: item?.shares ?? null,
              author: item?.author || "—",
              postDate: item?.postDate ?? null,
              error: item?.error || (!item ? "No result returned for this URL" : undefined),
            };
            setFbResults((prev) => mergeRows(prev, [incoming], !!retryUrls));
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Request failed";
            setFbResults((prev) =>
              mergeRows(
                prev,
                [
                  {
                    url: currentUrl,
                    views: null,
                    likes: null,
                    comments: null,
                    shares: null,
                    author: "—",
                    postDate: null,
                    error: message,
                  },
                ],
                !!retryUrls
              )
            );
          } finally {
            completed += 1;
            setFbProgress({ current: completed, total: urls.length });
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      if (!retryUrls) {
        setFbResults((prev) => {
          const returned = new Map(prev.map((item) => [item.url, item]));
          return urls.map(
            (url) =>
              returned.get(url) || {
                url,
                views: null,
                likes: null,
                comments: null,
                shares: null,
                author: "—",
                postDate: null,
                error: "Not processed; retry this URL",
              }
          );
        });
      }
      setFbLoading(false);
      setFbProgress(null);
      setFbElapsed(+((performance.now() - start) / 1000).toFixed(2));
    }
  };

  // Handle TikTok scrape
  const handleScrapeTikTok = async (retryUrls?: string[]) => {
    const urls =
      retryUrls ??
      Array.from(
        new Set(
          ttInput
            .split("\n")
            .map((u) => u.trim())
            .filter(Boolean)
        )
      );
    if (urls.length === 0) return;

    abortTtRef.current = false;
    setTtLoading(true);
    setTtTimer(0);
    if (!retryUrls) setTtResults([]);
    setTtElapsed(null);
    setTtProgress({ current: 0, total: urls.length });
    const start = performance.now();

    try {
      for (let i = 0; i < urls.length; i++) {
        if (abortTtRef.current) break;
        const currentUrl = urls[i];
        setTtProgress({ current: i + 1, total: urls.length });

        try {
          const resp = await fetch("/api/scrape/tiktok", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: currentUrl }),
          });
          const resJson = await resp.json();
          if (resp.ok && resJson.data) {
            const d = resJson.data;
            setTtResults((prev) =>
              mergeRows(
                prev,
                [
                  {
                    url: currentUrl,
                    views: d.views ?? null,
                    likes: d.likes ?? null,
                    comments: d.comments ?? null,
                    shares: d.shares ?? null,
                    saves: d.saves ?? null,
                    author: d.author || "—",
                    postDate: d.postDate ?? null,
                    error: d.error,
                  },
                ],
                !!retryUrls
              )
            );
          } else {
            setTtResults((prev) =>
              mergeRows(
                prev,
                [
                  {
                    url: currentUrl,
                    views: null,
                    likes: null,
                    comments: null,
                    shares: null,
                    saves: null,
                    author: "—",
                    postDate: null,
                    error: resJson.error || "Extraction failed",
                  },
                ],
                !!retryUrls
              )
            );
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Request failed";
          setTtResults((prev) =>
            mergeRows(
              prev,
              [
                {
                  url: currentUrl,
                  views: null,
                  likes: null,
                  comments: null,
                  shares: null,
                  saves: null,
                  author: "—",
                  postDate: null,
                  error: msg,
                },
              ],
              !!retryUrls
            )
          );
        }

        if (i < urls.length - 1 && !abortTtRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 1150));
        }
      }
    } finally {
      if (!retryUrls) {
        setTtResults((prev) => {
          const returned = new Map(prev.map((item) => [item.url, item]));
          return urls.map(
            (url) =>
              returned.get(url) || {
                url,
                views: null,
                likes: null,
                comments: null,
                shares: null,
                saves: null,
                author: "—",
                postDate: null,
                error: "Not processed; retry this URL",
              }
          );
        });
      }
      setTtLoading(false);
      setTtProgress(null);
      setTtElapsed(+((performance.now() - start) / 1000).toFixed(2));
    }
  };

  // Handle YouTube scrape
  const handleScrapeYouTube = async (retryUrls?: string[]) => {
    const urls =
      retryUrls ??
      Array.from(
        new Set(
          ytInput
            .split("\n")
            .map((u) => u.trim())
            .filter(Boolean)
        )
      );
    if (urls.length === 0) return;

    abortYtRef.current = false;
    setYtLoading(true);
    setYtTimer(0);
    if (!retryUrls) setYtResults([]);
    setYtElapsed(null);
    setYtProgress({ current: 0, total: urls.length });
    const start = performance.now();

    try {
      let completed = 0;
      let nextIdx = 0;
      const concurrency = Math.min(3, urls.length);

      const worker = async () => {
        while (nextIdx < urls.length && !abortYtRef.current) {
          const i = nextIdx++;
          const currentUrl = urls[i];
          try {
            const resp = await fetch("/api/scrape/youtube", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: currentUrl }),
            });
            const resJson = await resp.json();
            if (resp.ok && resJson.data) {
              const d = resJson.data;
              setYtResults((prev) =>
                mergeRows(
                  prev,
                  [
                    {
                      url: currentUrl,
                      views: d.views ?? null,
                      likes: d.likes ?? null,
                      comments: d.comments ?? null,
                      shares: d.shares ?? null,
                      author: d.author || "—",
                      title: d.title || "",
                      postDate: d.postDate ?? null,
                      error: d.error,
                    },
                  ],
                  !!retryUrls
                )
              );
            } else {
              setYtResults((prev) =>
                mergeRows(
                  prev,
                  [
                    {
                      url: currentUrl,
                      views: null,
                      likes: null,
                      comments: null,
                      shares: null,
                      author: "—",
                      postDate: null,
                      error: resJson.error || "Extraction failed",
                    },
                  ],
                  !!retryUrls
                )
              );
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Request failed";
            setYtResults((prev) =>
              mergeRows(
                prev,
                [
                  {
                    url: currentUrl,
                    views: null,
                    likes: null,
                    comments: null,
                    shares: null,
                    author: "—",
                    postDate: null,
                    error: msg,
                  },
                ],
                !!retryUrls
              )
            );
          } finally {
            completed += 1;
            setYtProgress({ current: completed, total: urls.length });
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      if (!retryUrls) {
        setYtResults((prev) => {
          const returned = new Map(prev.map((item) => [item.url, item]));
          return urls.map(
            (url) =>
              returned.get(url) || {
                url,
                views: null,
                likes: null,
                comments: null,
                shares: null,
                author: "—",
                postDate: null,
                error: "Not processed; retry this URL",
              }
          );
        });
      }
      setYtLoading(false);
      setYtProgress(null);
      setYtElapsed(+((performance.now() - start) / 1000).toFixed(2));
    }
  };

  const handleClear = () => {
    if (fbLoading || ttLoading || ytLoading) return;
    if (activeTab === "facebook") {
      setFbInput("");
      setFbResults([]);
      setFbElapsed(null);
      setFbProgress(null);
    } else if (activeTab === "tiktok") {
      setTtInput("");
      setTtResults([]);
      setTtElapsed(null);
      setTtProgress(null);
    } else {
      setYtInput("");
      setYtResults([]);
      setYtElapsed(null);
      setYtProgress(null);
    }
    setSearchQuery("");
  };

  // Filtered results
  const filteredFb = useMemo(() => {
    if (!searchQuery.trim()) return fbResults;
    const q = searchQuery.toLowerCase();
    return fbResults.filter(
      (item) => item.author.toLowerCase().includes(q) || item.url.toLowerCase().includes(q)
    );
  }, [fbResults, searchQuery]);

  const filteredTt = useMemo(() => {
    if (!searchQuery.trim()) return ttResults;
    const q = searchQuery.toLowerCase();
    return ttResults.filter(
      (item) => item.author.toLowerCase().includes(q) || item.url.toLowerCase().includes(q)
    );
  }, [ttResults, searchQuery]);

  const filteredYt = useMemo(() => {
    if (!searchQuery.trim()) return ytResults;
    const q = searchQuery.toLowerCase();
    return ytResults.filter(
      (item) =>
        item.author.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        (item.title && item.title.toLowerCase().includes(q))
    );
  }, [ytResults, searchQuery]);

  // Aggregate stats
  const fbStats = useMemo(() => {
    const total = fbResults.length;
    const totalViews = fbResults.reduce((sum, r) => sum + (r.views || 0), 0);
    const totalLikes = fbResults.reduce((sum, r) => sum + (r.likes || 0), 0);
    return { total, totalViews, totalLikes };
  }, [fbResults]);

  const ttStats = useMemo(() => {
    const total = ttResults.length;
    const totalViews = ttResults.reduce((sum, r) => sum + (r.views || 0), 0);
    const totalLikes = ttResults.reduce((sum, r) => sum + (r.likes || 0), 0);
    return { total, totalViews, totalLikes };
  }, [ttResults]);

  const ytStats = useMemo(() => {
    const total = ytResults.length;
    const totalViews = ytResults.reduce((sum, r) => sum + (r.views || 0), 0);
    const totalLikes = ytResults.reduce((sum, r) => sum + (r.likes || 0), 0);
    return { total, totalViews, totalLikes };
  }, [ytResults]);

  const activeResults =
    activeTab === "facebook" ? fbResults : activeTab === "tiktok" ? ttResults : ytResults;
  const isLoading = fbLoading || ttLoading || ytLoading;
  const incompleteCount = activeResults.filter((item) => !hasCompleteMetrics(item)).length;
  const canExport = activeResults.length > 0 && incompleteCount === 0 && !isLoading;

  const escapeHtml = (str: string) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const writeDualClipboard = async (tsv: string, htmlTable: string) => {
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard && navigator.clipboard.write) {
        const textBlob = new Blob([tsv], { type: "text/plain" });
        const htmlBlob = new Blob([htmlTable], { type: "text/html" });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": textBlob,
            "text/html": htmlBlob,
          }),
        ]);
        return;
      }
    } catch (err) {
      console.warn("ClipboardItem write failed, fallback to writeText:", err);
    }
    await navigator.clipboard.writeText(tsv);
  };

  const copyAuthorLinkNumbers = async (withHeaders: boolean) => {
    if (!canExport) return;
    const isFb = activeTab === "facebook";
    const isTt = activeTab === "tiktok";

    const headers = isFb
      ? ["Author", "Link", "Post Date", "Views", "Likes", "Comments", "Shares"]
      : isTt
      ? ["Author", "Link", "Post Date", "Views", "Likes", "Comments", "Shares", "Saves"]
      : ["Author", "Link", "Post Date", "Views", "Likes", "Comments"];

    const rawRows = isFb
      ? filteredFb.map((item) => ({
          author: item.author || "—",
          linkUrl: item.url,
          linkText: formatShortLink(item.url),
          postDate: item.postDate || "",
          nums: [facebookViews(item), item.likes ?? "", item.comments ?? "", item.shares ?? ""],
        }))
      : isTt
      ? filteredTt.map((item) => ({
          author: item.author || "—",
          linkUrl: item.url,
          linkText: formatShortLink(item.url),
          postDate: item.postDate || "",
          nums: [
            item.views ?? "",
            item.likes ?? "",
            item.comments ?? "",
            item.shares ?? "",
            item.saves ?? "",
          ],
        }))
      : filteredYt.map((item) => ({
          author: item.author || "—",
          linkUrl: item.url,
          linkText: formatShortLink(item.url),
          postDate: item.postDate || "",
          nums: [item.views ?? "", item.likes ?? "", item.comments ?? ""],
        }));

    const tsvRows = rawRows.map((r) => [r.author, r.linkUrl, r.postDate, ...r.nums.map(String)].join("\t"));
    const tsvContent = (withHeaders ? [headers.join("\t"), ...tsvRows] : tsvRows).join("\r\n");

    let htmlTable = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:13px;border:1px solid #cbd5e1;">`;
    if (withHeaders) {
      htmlTable += `<thead><tr style="background:#f1f5f9;font-weight:bold;">`;
      for (const h of headers) {
        const isNum = !["Author", "Link", "Post Date"].includes(h);
        htmlTable += `<th style="padding:6px 12px;border:1px solid #cbd5e1;${isNum ? "text-align:right;" : "text-align:left;"}">${escapeHtml(h)}</th>`;
      }
      htmlTable += `</tr></thead>`;
    }
    htmlTable += `<tbody>`;
    for (const r of rawRows) {
      htmlTable += `<tr>`;
      htmlTable += `<td style="padding:6px 12px;border:1px solid #cbd5e1;font-weight:500;">${escapeHtml(r.author)}</td>`;
      htmlTable += `<td style="padding:6px 12px;border:1px solid #cbd5e1;"><a href="${escapeHtml(r.linkUrl)}">${escapeHtml(r.linkText)}</a></td>`;
      htmlTable += `<td style="padding:6px 12px;border:1px solid #cbd5e1;">${escapeHtml(r.postDate)}</td>`;
      for (const n of r.nums) {
        htmlTable += `<td style="padding:6px 12px;border:1px solid #cbd5e1;text-align:right;">${typeof n === "number" ? n.toLocaleString() : n}</td>`;
      }
      htmlTable += `</tr>`;
    }
    htmlTable += `</tbody></table>`;

    await writeDualClipboard(tsvContent, htmlTable);
    setCopiedType(withHeaders ? "headers" : "values");
    setTimeout(() => setCopiedType(null), 2000);
  };

  const copyNumbersOnly = async () => {
    if (!canExport) return;
    const numRows =
      activeTab === "facebook"
        ? filteredFb.map((item) => [
            facebookViews(item),
            item.likes ?? "",
            item.comments ?? "",
            item.shares ?? "",
          ])
        : activeTab === "tiktok"
        ? filteredTt.map((item) => [
            item.views ?? "",
            item.likes ?? "",
            item.comments ?? "",
            item.shares ?? "",
            item.saves ?? "",
          ])
        : filteredYt.map((item) => [
            item.views ?? "",
            item.likes ?? "",
            item.comments ?? "",
          ]);

    const tsvContent = numRows.map((r) => r.join("\t")).join("\r\n");

    let htmlTable = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:13px;border:1px solid #cbd5e1;"><tbody>`;
    for (const r of numRows) {
      htmlTable += `<tr>`;
      for (const n of r) {
        htmlTable += `<td style="padding:6px 12px;border:1px solid #cbd5e1;text-align:right;">${n}</td>`;
      }
      htmlTable += `</tr>`;
    }
    htmlTable += `</tbody></table>`;

    await writeDualClipboard(tsvContent, htmlTable);
    setCopiedType("numbers-only");
    setTimeout(() => setCopiedType(null), 2000);
  };

  const exportToExcel = () => {
    if (!canExport) return;
    const isFb = activeTab === "facebook";
    const isTt = activeTab === "tiktok";

    const dataToExport = isFb
      ? fbResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          "Post Date": r.postDate || "",
          Views: facebookViews(r),
          Likes: r.likes ?? "",
          Comments: r.comments ?? "",
          Shares: r.shares ?? "",
        }))
      : isTt
      ? ttResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          "Post Date": r.postDate || "",
          Views: r.views ?? "",
          Likes: r.likes ?? "",
          Comments: r.comments ?? "",
          Shares: r.shares ?? "",
          Saves: r.saves ?? "",
        }))
      : ytResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          "Post Date": r.postDate || "",
          Views: r.views ?? "",
          Likes: r.likes ?? "",
          Comments: r.comments ?? "",
        }));

    const sheetName = isFb ? "Facebook" : isTt ? "TikTok" : "YouTube";
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, `${sheetName.toLowerCase()}_data.xlsx`);
  };

  const exportToCsv = () => {
    if (!canExport) return;
    const isFb = activeTab === "facebook";
    const isTt = activeTab === "tiktok";

    const dataToExport = isFb
      ? fbResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          "Post Date": r.postDate || "",
          Views: facebookViews(r),
          Likes: r.likes ?? "",
          Comments: r.comments ?? "",
          Shares: r.shares ?? "",
        }))
      : isTt
      ? ttResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          "Post Date": r.postDate || "",
          Views: r.views ?? "",
          Likes: r.likes ?? "",
          Comments: r.comments ?? "",
          Shares: r.shares ?? "",
          Saves: r.saves ?? "",
        }))
      : ytResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          "Post Date": r.postDate || "",
          Views: r.views ?? "",
          Likes: r.likes ?? "",
          Comments: r.comments ?? "",
        }));

    const sheetName = isFb ? "Facebook" : isTt ? "TikTok" : "YouTube";
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob(["\uFEFF" + csvOutput], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${sheetName.toLowerCase()}_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const currentPlatform = PLATFORMS[activeTab];

  const activeInput =
    activeTab === "facebook" ? fbInput : activeTab === "tiktok" ? ttInput : ytInput;

  const setActiveInput = (val: string) => {
    if (activeTab === "facebook") setFbInput(val);
    else if (activeTab === "tiktok") setTtInput(val);
    else setYtInput(val);
  };

  const activeLoading =
    activeTab === "facebook" ? fbLoading : activeTab === "tiktok" ? ttLoading : ytLoading;

  const activeProgress =
    activeTab === "facebook" ? fbProgress : activeTab === "tiktok" ? ttProgress : ytProgress;

  const activeTimer =
    activeTab === "facebook" ? fbTimer : activeTab === "tiktok" ? ttTimer : ytTimer;

  const activeElapsed =
    activeTab === "facebook" ? fbElapsed : activeTab === "tiktok" ? ttElapsed : ytElapsed;

  const activeStats =
    activeTab === "facebook" ? fbStats : activeTab === "tiktok" ? ttStats : ytStats;

  const filteredActive =
    activeTab === "facebook" ? filteredFb : activeTab === "tiktok" ? filteredTt : filteredYt;

  const avgSpeed = useMemo(() => {
    const time = activeElapsed ?? activeTimer;
    const count = activeStats.total;
    if (!count) return "0.00";
    return (time / count).toFixed(2);
  }, [activeElapsed, activeTimer, activeStats.total]);

  const hasResultsOrLoading = activeResults.length > 0 || activeLoading;
  const urlCount = activeInput.split("\n").filter((l) => l.trim()).length;

  const handleStartScrape = () => {
    if (activeTab === "facebook") void handleScrapeFacebook();
    else if (activeTab === "tiktok") void handleScrapeTikTok();
    else void handleScrapeYouTube();
  };

  const handleStopScrape = () => {
    if (activeTab === "facebook") abortFbRef.current = true;
    else if (activeTab === "tiktok") abortTtRef.current = true;
    else abortYtRef.current = true;
  };

  const handleLoadSample = () => {
    if (activeTab === "facebook") setFbInput(SAMPLE_FB_URLS);
    else if (activeTab === "tiktok") setTtInput(SAMPLE_TT_URLS);
    else setYtInput(SAMPLE_YT_URLS);
  };

  const handleRetryIncomplete = () => {
    const urls = activeResults.filter((item) => !hasCompleteMetrics(item)).map((item) => item.url);
    if (activeTab === "facebook") void handleScrapeFacebook(urls);
    else if (activeTab === "tiktok") void handleScrapeTikTok(urls);
    else void handleScrapeYouTube(urls);
  };

  return (
    <main className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-badge">⚡</div>
          <div>
            <h1 className="brand-title">Social Pulse Analytics</h1>
            <p className="brand-subtitle">
              High-speed serverless scraper for Facebook Reels, TikTok videos &amp; YouTube Shorts
            </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="tabs-nav" aria-label="Social platform tabs">
        <button
          id="tab-fb-btn"
          className={`tab-btn ${activeTab === "facebook" ? "active fb" : ""}`}
          onClick={() => {
            setActiveTab("facebook");
            setSearchQuery("");
          }}
        >
          <span>📘</span> Facebook Reels
        </button>
        <button
          id="tab-tt-btn"
          className={`tab-btn ${activeTab === "tiktok" ? "active tt" : ""}`}
          onClick={() => {
            setActiveTab("tiktok");
            setSearchQuery("");
          }}
        >
          <span>🎵</span> TikTok Videos
        </button>
        <button
          id="tab-yt-btn"
          className={`tab-btn ${activeTab === "youtube" ? "active yt" : ""}`}
          onClick={() => {
            setActiveTab("youtube");
            setSearchQuery("");
          }}
        >
          <span>▶️</span> YouTube Videos / Shorts
        </button>
      </nav>

      {/* Input Section */}
      <section className="glass-card" aria-labelledby="input-section-title">
        <div className="section-header-row">
          <div>
            <h2 id="input-section-title" className="card-title">
              {currentPlatform.icon} Input {currentPlatform.name} URLs
            </h2>
            <p className="card-subtitle">
              Paste links below (one per line). Extract Author, Link, Post Date (UTC+7), and Numbers ready for Google Sheets.
            </p>
          </div>
          <span className={`platform-pill ${currentPlatform.badgeClass}`}>
            {currentPlatform.tabLabel}
          </span>
        </div>

        <textarea
          id={currentPlatform.textareaId}
          className="input-textarea"
          placeholder={currentPlatform.placeholder}
          value={activeInput}
          onChange={(e) => setActiveInput(e.target.value)}
        />

        <div className="action-row">
          <div className="btn-group">
            <button
              id={currentPlatform.startBtnId}
              className={`btn-primary ${currentPlatform.badgeClass}`}
              onClick={handleStartScrape}
              disabled={activeLoading || !activeInput.trim()}
            >
              {activeLoading ? (
                <>
                  <span className="spinner"></span> Scraping{" "}
                  {activeProgress ? `(${activeProgress.current}/${activeProgress.total})` : ""}{" "}
                  ({activeTimer}s)...
                </>
              ) : (
                <>🚀 Start {currentPlatform.name} Scraping</>
              )}
            </button>

            {activeLoading && (
              <button
                id={currentPlatform.stopBtnId}
                className="btn-stop"
                onClick={handleStopScrape}
              >
                ⏹ Stop
              </button>
            )}

            <button
              id="load-sample-btn"
              className="btn-secondary"
              onClick={handleLoadSample}
            >
              📋 Load Sample URLs
            </button>

            <button
              id="clear-input-btn"
              disabled={isLoading}
              className="btn-secondary"
              onClick={handleClear}
            >
              🗑️ Clear
            </button>
          </div>

          <div className="url-counter">
            Count: <strong>{urlCount}</strong> URLs
          </div>
        </div>

        {/* Live progress bar */}
        {activeLoading && activeProgress && (
          <div className="progress-card">
            <div className="progress-header">
              <span className="progress-label">
                <span className="spinner"></span>
                Scraping {currentPlatform.name} data (rate-limit compliant)...
              </span>
              <span className="progress-counter">
                <strong>{activeProgress.current}</strong> / {activeProgress.total} (
                {Math.round((activeProgress.current / activeProgress.total) * 100)}%)
              </span>
            </div>
            <div className="progress-track">
              <div
                className={`progress-bar ${currentPlatform.badgeClass}`}
                style={{
                  width: `${(activeProgress.current / activeProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* KPI Stats Banner */}
      {hasResultsOrLoading && (
        <section className="metrics-grid" aria-label="Performance and Aggregated Metrics">
          <div className="kpi-card">
            <div className="kpi-icon">📋</div>
            <div>
              <div className="kpi-val">{activeStats.total}</div>
              <div className="kpi-label">Total URLs Processed</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">⏱️</div>
            <div>
              <div className="kpi-val">
                {activeElapsed !== null ? activeElapsed : activeTimer}s
              </div>
              <div className="kpi-label">Total Elapsed Time</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">⚡</div>
            <div>
              <div className="kpi-val">{avgSpeed}s</div>
              <div className="kpi-label">Avg Speed / Video</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">👁️</div>
            <div>
              <div className="kpi-val">{activeStats.totalViews.toLocaleString()}</div>
              <div className="kpi-label">Cumulative Views (exact counts only)</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">👍</div>
            <div>
              <div className="kpi-val">{activeStats.totalLikes.toLocaleString()}</div>
              <div className="kpi-label">Cumulative Likes (available)</div>
            </div>
          </div>
        </section>
      )}

      {/* Scraped Results Section */}
      {activeResults.length > 0 && (
        <section className="glass-card" aria-labelledby="results-title">
          <div className="results-header">
            <div>
              <h2 id="results-title" className="card-title">
                📊 Scraped {currentPlatform.name} Data
              </h2>
              <p className="card-subtitle">
                Showing {filteredActive.length} of {activeResults.length} items
              </p>
            </div>

            <div className="results-actions">
              <input
                id="search-input"
                type="text"
                placeholder="🔍 Search author, link..."
                className="search-box"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <button
                id="copy-author-link-values-btn"
                disabled={!canExport}
                className={`btn-primary ${currentPlatform.badgeClass}`}
                onClick={() => copyAuthorLinkNumbers(false)}
                title="Copy formatted table (HTML + TSV) for Google Sheets, Excel, Notion, Docs"
                style={{ fontWeight: 600 }}
              >
                {copiedType === "values" ? "✅ Copied Table!" : "📋 Copy Table"}
              </button>

              <button
                id="copy-author-link-headers-btn"
                disabled={!canExport}
                className="btn-secondary"
                onClick={() => copyAuthorLinkNumbers(true)}
                title="Copy table with header row"
              >
                {copiedType === "headers" ? "✅ Copied (+Headers)!" : "📋 Copy (+Headers)"}
              </button>

              <button
                id="copy-numbers-only-btn"
                disabled={!canExport}
                className="btn-secondary"
                onClick={copyNumbersOnly}
                title="Copy ONLY numbers"
              >
                {copiedType === "numbers-only" ? "✅ Copied Numbers!" : "📋 Numbers Only"}
              </button>

              <button
                id="export-excel-btn"
                disabled={!canExport}
                className="btn-secondary"
                onClick={exportToExcel}
              >
                📊 Excel
              </button>

              <button
                id="export-csv-btn"
                disabled={!canExport}
                className="btn-secondary"
                onClick={exportToCsv}
              >
                📄 CSV
              </button>
            </div>
          </div>

          {incompleteCount > 0 && (
            <div className="alert-card warning" role="status">
              <div className="alert-icon">⚠️</div>
              <div className="alert-content">
                <div className="alert-title">
                  {incompleteCount} URL{incompleteCount > 1 ? "s" : ""} pending or incomplete
                </div>
                <div className="alert-text">
                  Missing or unverified counts or post dates detected. Copy and export will unlock once all URLs are complete.
                </div>
              </div>
              <button
                id="retry-incomplete-btn"
                className="btn-warning"
                disabled={isLoading}
                onClick={handleRetryIncomplete}
              >
                🔄 Retry Incomplete ({incompleteCount})
              </button>
            </div>
          )}

          <div className="table-wrapper">
            <ResultsTable
              platform={activeTab}
              items={filteredActive}
              searchQuery={searchQuery}
            />
          </div>
        </section>
      )}
    </main>
  );
}

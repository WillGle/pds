"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";

export interface CommentRow {
  id: number;
  Comment: string;
}

type PlatformChoice = "auto" | "facebook" | "tiktok";

interface UrlProcessStatus {
  url: string;
  platform: "facebook" | "tiktok" | "unknown";
  status: "pending" | "processing" | "success" | "error";
  commentCount: number;
  error?: string;
}

const SAMPLE_URLS = [
  "https://www.tiktok.com/@do_toc_do/video/7675974583278685461",
  "https://www.tiktok.com/@taotentho94/video/7676040678341709063",
  "https://www.tiktok.com/@maly.gaugau/video/7674580711814335764",
  "https://www.tiktok.com/@laclac.jj/video/7676080656643935496",
  "https://www.tiktok.com/@_conlabong/video/7675962028938267911",
  "https://www.tiktok.com/@quanglanbui/video/7677952752781413653",
  "https://www.tiktok.com/@buibebot/video/7677569626502466836",
  "https://www.tiktok.com/@dntminh/video/7674229412690300167",
  "https://www.tiktok.com/@mn.ba.cheo/video/7677567258536758549",
  "https://www.tiktok.com/@meothugian333/video/7677923929696095508",
  "https://www.tiktok.com/@tragthng/video/7681256304089861394",
  "https://www.tiktok.com/@muoivove/video/7680185227158785301",
  "https://www.tiktok.com/@domdungdinh/video/7677585148757511431",
  "https://www.tiktok.com/@bopdayneeee/video/7677559010320600327",
  "https://www.tiktok.com/@bopdayneeee/video/7682384390277631239",
  "https://www.tiktok.com/@bebosua550/video/7682672407005416712",
  "https://www.tiktok.com/@contenchim/video/7683138610480237845",
  "https://www.tiktok.com/@camthui_2205/video/7683377821397290260",
  "https://www.facebook.com/reel/1751123646230423",
  "https://www.facebook.com/reel/1817348789627621",
  "https://www.facebook.com/reel/1076863841954950",
  "https://www.facebook.com/reel/2548955998859652",
  "https://www.facebook.com/reel/1076545181488229",
  "https://www.facebook.com/reel/1104242182164967",
  "https://www.facebook.com/reel/1829962987992876",
  "https://www.facebook.com/reel/1585487269940928",
  "https://www.facebook.com/reel/927084887122221",
  "https://www.facebook.com/reel/1779820026593617",
];

const SAMPLE_FB_URLS = [
  "https://www.facebook.com/reel/1751123646230423",
  "https://www.facebook.com/reel/1817348789627621",
  "https://www.facebook.com/reel/1076863841954950",
  "https://www.facebook.com/reel/2548955998859652",
  "https://www.facebook.com/reel/1076545181488229",
];

const SAMPLE_TT_URLS = [
  "https://www.tiktok.com/@do_toc_do/video/7675974583278685461",
  "https://www.tiktok.com/@taotentho94/video/7676040678341709063",
  "https://www.tiktok.com/@maly.gaugau/video/7674580711814335764",
  "https://www.tiktok.com/@laclac.jj/video/7676080656643935496",
  "https://www.tiktok.com/@_conlabong/video/7675962028938267911",
];

export function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s)\]"'>]+/gi);
  if (!matches) return [];
  const clean = matches.map((u) => u.replace(/[)\]"'>.,;]+$/, "").trim());
  return Array.from(new Set(clean.filter(Boolean)));
}

function detectUrlPlatform(url: string): "facebook" | "tiktok" | "unknown" {
  const clean = url.trim().toLowerCase();
  if (clean.includes("facebook.com") || clean.includes("fb.watch") || clean.includes("fb.me")) {
    return "facebook";
  }
  if (clean.includes("tiktok.com")) {
    return "tiktok";
  }
  return "unknown";
}

function cleanCommentText(raw: string): string {
  if (!raw) return "";
  let text = raw.replace(/[\u200B-\u200D\uFEFF]/g, "");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export default function CommentsScraper() {
  const [urlsInput, setUrlsInput] = useState<string>("");
  const [platform, setPlatform] = useState<PlatformChoice>("auto");
  const [maxCommentsPerUrl, setMaxCommentsPerUrl] = useState<number>(100);
  const [expandReplies, setExpandReplies] = useState<boolean>(true);
  const [deduplicate, setDeduplicate] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);

  // Batch tracking
  const [batchStatuses, setBatchStatuses] = useState<UrlProcessStatus[]>([]);
  const [showStatusModal, setShowStatusModal] = useState<boolean>(false);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowStatusModal(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Results: strictly [id, Comment]
  const [results, setResults] = useState<CommentRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedType, setCopiedType] = useState<string | null>(null);

  const abortRef = useRef<boolean>(false);

  // Live Timer
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setTimer((prev) => +(prev + 0.1).toFixed(1));
    }, 100);
    return () => clearInterval(interval);
  }, [loading]);

  // Clean URLs list
  const parsedUrls = useMemo(() => {
    return extractUrls(urlsInput);
  }, [urlsInput]);

  // Concurrency Limits (3 TikTok, 2 Facebook)
  const maxTikTokWorkers = 3;
  const maxFacebookWorkers = 2;

  // Worker Pool Batch Execution
  const runBatchScraping = async (urlsToRun: string[], isRetry = false) => {
    if (urlsToRun.length === 0) return;

    setLoading(true);
    setTimer(0);
    setElapsed(null);
    abortRef.current = false;

    if (!isRetry) {
      setResults([]);
      const initialStatuses: UrlProcessStatus[] = urlsToRun.map((u) => {
        let targetPlat = detectUrlPlatform(u);
        if (platform === "facebook") targetPlat = "facebook";
        else if (platform === "tiktok") targetPlat = "tiktok";
        return {
          url: u,
          platform: targetPlat,
          status: "pending",
          commentCount: 0,
        };
      });
      setBatchStatuses(initialStatuses);
    } else {
      setBatchStatuses((prev) =>
        prev.map((item) =>
          urlsToRun.includes(item.url)
            ? { ...item, status: "pending", error: undefined }
            : item
        )
      );
    }

    const startTime = Date.now();

    const queue = urlsToRun.map((u) => {
      let targetPlat = detectUrlPlatform(u);
      if (platform === "facebook") targetPlat = "facebook";
      else if (platform === "tiktok") targetPlat = "tiktok";
      return {
        url: u,
        platform: targetPlat,
      };
    });

    let activeTt = 0;
    let activeFb = 0;
    let queueIdx = 0;

    const executeLink = async (item: { url: string; platform: "facebook" | "tiktok" | "unknown" }) => {
      const { url: currentUrl, platform: targetPlat } = item;

      setBatchStatuses((prev) =>
        prev.map((s) => (s.url === currentUrl ? { ...s, status: "processing" } : s))
      );

      if (targetPlat === "unknown") {
        setBatchStatuses((prev) =>
          prev.map((s) =>
            s.url === currentUrl
              ? { ...s, status: "error", error: "Unsupported platform URL" }
              : s
          )
        );
        return;
      }

      const endpoint =
        targetPlat === "facebook"
          ? "/api/scrape/facebook/comments"
          : "/api/scrape/tiktok/comments";

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(45000),
          body: JSON.stringify({
            url: currentUrl,
            maxComments: maxCommentsPerUrl,
            expandReplies,
          }),
        });

        const data = await res.json();

        if (abortRef.current) return;

        if (!res.ok || data.error) {
          const errDetail = data.error || `HTTP ${res.status}`;
          setBatchStatuses((prev) =>
            prev.map((s) =>
              s.url === currentUrl ? { ...s, status: "error", error: errDetail } : s
            )
          );
          return;
        }

        const incomingRows: CommentRow[] = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
          ? data.data
          : [];

        const cleanedComments = incomingRows
          .map((r) => cleanCommentText(r.Comment))
          .filter(Boolean);

        setResults((prev) => {
          const baseId = prev.length;
          const newRows: CommentRow[] = cleanedComments.map((text, idx) => ({
            id: baseId + idx + 1,
            Comment: text,
          }));
          return [...prev, ...newRows];
        });

        setBatchStatuses((prev) =>
          prev.map((s) =>
            s.url === currentUrl
              ? { ...s, status: "success", commentCount: cleanedComments.length }
              : s
          )
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Connection failed";
        setBatchStatuses((prev) =>
          prev.map((s) =>
            s.url === currentUrl ? { ...s, status: "error", error: msg } : s
          )
        );
      }
    };

    await new Promise<void>((resolve) => {
      const scheduleNext = () => {
        if (abortRef.current) {
          if (activeTt === 0 && activeFb === 0) resolve();
          return;
        }

        while (queueIdx < queue.length) {
          const nextItem = queue[queueIdx];
          const isTt = nextItem.platform === "tiktok";
          const isFb = nextItem.platform === "facebook";

          if (isTt && activeTt < maxTikTokWorkers) {
            activeTt++;
            queueIdx++;
            executeLink(nextItem).finally(() => {
              activeTt--;
              scheduleNext();
            });
          } else if (isFb && activeFb < maxFacebookWorkers) {
            activeFb++;
            queueIdx++;
            executeLink(nextItem).finally(() => {
              activeFb--;
              scheduleNext();
            });
          } else if (!isTt && !isFb) {
            queueIdx++;
            executeLink(nextItem).finally(() => {
              scheduleNext();
            });
          } else {
            break;
          }
        }

        if (queueIdx >= queue.length && activeTt === 0 && activeFb === 0) {
          resolve();
        }
      };

      scheduleNext();
    });

    setLoading(false);
    setElapsed(+((Date.now() - startTime) / 1000).toFixed(2));
  };

  const handleStartScraping = () => {
    runBatchScraping(parsedUrls, false);
  };

  const handleRetryFailed = () => {
    const failedUrls = batchStatuses
      .filter((s) => s.status === "error")
      .map((s) => s.url);
    if (failedUrls.length > 0) {
      runBatchScraping(failedUrls, true);
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    setLoading(false);
  };

  const handleLoadSample = () => {
    if (platform === "facebook") {
      setUrlsInput(SAMPLE_FB_URLS.join("\n"));
    } else if (platform === "tiktok") {
      setUrlsInput(SAMPLE_TT_URLS.join("\n"));
    } else {
      setUrlsInput(SAMPLE_URLS.join("\n"));
    }
  };

  const handleClear = () => {
    setUrlsInput("");
    setResults([]);
    setBatchStatuses([]);
    setElapsed(null);
  };

  // Filtered & deduplicated comments
  const displayResults = useMemo(() => {
    let list = results;

    if (deduplicate) {
      const seen = new Set<string>();
      const deduped: CommentRow[] = [];
      for (const item of list) {
        const norm = item.Comment.toLowerCase().trim();
        if (!seen.has(norm)) {
          seen.add(norm);
          deduped.push({ id: deduped.length + 1, Comment: item.Comment });
        }
      }
      list = deduped;
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.Comment.toLowerCase().includes(query) ||
          String(item.id).includes(query)
      );
    }

    return list;
  }, [results, deduplicate, searchQuery]);

  // Dataset Quick Stats
  const datasetStats = useMemo(() => {
    if (results.length === 0) return null;
    const uniqueSet = new Set(results.map((r) => r.Comment.toLowerCase().trim()));
    const uniquePercent = Math.round((uniqueSet.size / results.length) * 100);
    return { uniquePercent };
  }, [results]);

  // Export handlers
  const handleExportCsv = () => {
    if (displayResults.length === 0) return;
    const bom = "\uFEFF";
    const header = "id,Comment\n";
    const body = displayResults
      .map((r) => `${r.id},"${r.Comment.replace(/"/g, '""')}"`)
      .join("\n");
    const blob = new Blob([bom + header + body], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `comments_sentiment_${displayResults.length}_rows.csv`;
    link.click();
  };

  const handleExportExcel = async () => {
    if (displayResults.length === 0) return;
    try {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(displayResults);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Comments");
      XLSX.writeFile(workbook, `comments_sentiment_${displayResults.length}_rows.xlsx`);
    } catch (e) {
      console.error("Export Excel error:", e);
    }
  };

  const handleExportJsonl = () => {
    if (displayResults.length === 0) return;
    const jsonl = displayResults
      .map((r) => JSON.stringify({ id: r.id, Comment: r.Comment }))
      .join("\n");
    const blob = new Blob([jsonl], { type: "application/x-ndjson;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `comments_dataset_${displayResults.length}.jsonl`;
    link.click();
  };

  const handleCopyTable = (includeHeader = false) => {
    if (displayResults.length === 0) return;
    const header = includeHeader ? "id\tComment\n" : "";
    const body = displayResults
      .map((r) => `${r.id}\t${r.Comment.replace(/[\r\n\t]+/g, " ")}`)
      .join("\n");
    navigator.clipboard.writeText(header + body);
    setCopiedType(includeHeader ? "headers" : "tsv");
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleCopyJson = () => {
    if (displayResults.length === 0) return;
    navigator.clipboard.writeText(JSON.stringify(displayResults, null, 2));
    setCopiedType("json");
    setTimeout(() => setCopiedType(null), 2000);
  };

  const completedLinks = batchStatuses.filter(
    (s) => s.status === "success" || s.status === "error"
  ).length;
  const completedSuccessCount = batchStatuses.filter((s) => s.status === "success").length;
  const failedLinksCount = batchStatuses.filter((s) => s.status === "error").length;
  const activeProcessingCount = batchStatuses.filter((s) => s.status === "processing").length;
  const progressPercent =
    batchStatuses.length > 0
      ? Math.round((completedLinks / batchStatuses.length) * 100)
      : 0;

  return (
    <>
      {/* Input Section - Matched to other tabs */}
      <section className="glass-card" aria-labelledby="input-section-title">
        <div className="section-header-row">
          <div>
            <h2 id="input-section-title" className="card-title">
              💬 Input Comments URLs
            </h2>
            <p className="card-subtitle">
              Paste links below ({platform === "facebook" ? "Facebook" : platform === "tiktok" ? "TikTok" : "Facebook & TikTok"}, one per line). Extract all comments into a single continuous 2-column [id | Comment] table ready for Multimodal Sentiment Analysis.
            </p>
          </div>

          {/* Sleek Segmented Platform Switcher: Auto | FB | TikTok */}
          <div
            style={{
              display: "inline-flex",
              background: "var(--bg-input)",
              padding: "3px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-main)",
              gap: "2px",
              alignSelf: "flex-start",
            }}
          >
            <button
              id="platform-auto-btn"
              type="button"
              onClick={() => setPlatform("auto")}
              style={{
                padding: "0.35rem 0.85rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                borderRadius: "var(--radius-sm)",
                border: platform === "auto" ? "1px solid #10b981" : "1px solid transparent",
                background: platform === "auto" ? "rgba(16, 185, 129, 0.18)" : "transparent",
                color: platform === "auto" ? "#34d399" : "var(--text-muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Tự động nhận diện link Facebook hoặc TikTok"
            >
              🌐 Auto
            </button>
            <button
              id="platform-fb-btn"
              type="button"
              onClick={() => setPlatform("facebook")}
              style={{
                padding: "0.35rem 0.85rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                borderRadius: "var(--radius-sm)",
                border: platform === "facebook" ? "1px solid #3b82f6" : "1px solid transparent",
                background: platform === "facebook" ? "rgba(59, 130, 246, 0.18)" : "transparent",
                color: platform === "facebook" ? "#60a5fa" : "var(--text-muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Chỉ định cào qua Facebook API"
            >
              📘 FB
            </button>
            <button
              id="platform-tiktok-btn"
              type="button"
              onClick={() => setPlatform("tiktok")}
              style={{
                padding: "0.35rem 0.85rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                borderRadius: "var(--radius-sm)",
                border: platform === "tiktok" ? "1px solid #f43f5e" : "1px solid transparent",
                background: platform === "tiktok" ? "rgba(244, 63, 94, 0.18)" : "transparent",
                color: platform === "tiktok" ? "#fb7185" : "var(--text-muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Chỉ định cào qua TikTok API"
            >
              🎵 TikTok
            </button>
          </div>
        </div>

        <textarea
          id="comments-urls-input"
          className="input-textarea"
          placeholder={
            platform === "facebook"
              ? "https://www.facebook.com/reel/1751123646230423"
              : platform === "tiktok"
              ? "https://www.tiktok.com/@do_toc_do/video/7675974583278685461"
              : "https://www.tiktok.com/@do_toc_do/video/7675974583278685461\nhttps://www.facebook.com/reel/1751123646230423"
          }
          value={urlsInput}
          onChange={(e) => setUrlsInput(e.target.value)}
        />

        {/* Subtle Options Bar */}
        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            alignItems: "center",
            marginTop: "0.85rem",
            marginBottom: "0.25rem",
            flexWrap: "wrap",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <label htmlFor="max-comments-input" style={{ fontSize: "0.82rem" }}>
              Max comments / URL:
            </label>
            <input
              id="max-comments-input"
              type="number"
              min="5"
              max="500"
              step="10"
              value={maxCommentsPerUrl}
              onChange={(e) =>
                setMaxCommentsPerUrl(
                  Math.max(1, parseInt(e.target.value, 10) || 50)
                )
              }
              style={{
                width: "70px",
                padding: "0.25rem 0.5rem",
                background: "var(--bg-input)",
                border: "1px solid var(--border-main)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-main)",
                fontSize: "0.85rem",
                textAlign: "center",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.45rem",
              cursor: "pointer",
              color: "var(--text-body)",
              fontSize: "0.82rem",
            }}
          >
            <input
              type="checkbox"
              checked={expandReplies}
              onChange={(e) => setExpandReplies(e.target.checked)}
              style={{ accentColor: "#10b981", width: "15px", height: "15px" }}
            />
            Cào cả bình luận phản hồi (Replies)
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.45rem",
              cursor: "pointer",
              color: deduplicate ? "#34d399" : "var(--text-body)",
              fontSize: "0.82rem",
              fontWeight: deduplicate ? 600 : 400,
            }}
            title="Loại bỏ các bình luận có nội dung trùng lặp"
          >
            <input
              type="checkbox"
              checked={deduplicate}
              onChange={(e) => setDeduplicate(e.target.checked)}
              style={{ accentColor: "#10b981", width: "15px", height: "15px" }}
            />
            Loại bỏ bình luận trùng lặp (Deduplicate)
          </label>
        </div>

        {/* Action Row - IDENTICAL to other tabs */}
        <div className="action-row">
          <div className="btn-group">
            <button
              id="start-comments-btn"
              className={`btn-primary ${
                platform === "facebook" ? "fb" : platform === "tiktok" ? "tt" : "cmts"
              }`}
              onClick={handleStartScraping}
              disabled={loading || parsedUrls.length === 0}
            >
              {loading ? (
                <>
                  <span className="spinner"></span> Scraping (
                  {completedLinks}/{batchStatuses.length}) ({timer}s)...
                </>
              ) : (
                <>
                  🚀 Start {platform === "facebook" ? "Facebook" : platform === "tiktok" ? "TikTok" : "Comments"} Scraping
                </>
              )}
            </button>

            {loading && (
              <button
                id="stop-comments-btn"
                className="btn-stop"
                onClick={handleStop}
              >
                ⏹ Stop
              </button>
            )}

            {!loading && failedLinksCount > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRetryFailed}
                style={{ color: "#f59e0b", borderColor: "#f59e0b" }}
              >
                🔄 Retry {failedLinksCount} Failed
              </button>
            )}

            <button
              id="load-sample-btn"
              className="btn-secondary"
              onClick={handleLoadSample}
              disabled={loading}
            >
              📋 Load Sample URLs
            </button>

            <button
              id="clear-input-btn"
              disabled={loading}
              className="btn-secondary"
              onClick={handleClear}
            >
              🗑️ Clear
            </button>

            {batchStatuses.length > 0 && (
              <button
                id="link-details-btn"
                type="button"
                className="btn-secondary"
                onClick={() => setShowStatusModal(true)}
                title="Xem chi tiết trạng thái từng liên kết trong popup"
              >
                📋 Chi tiết từng link ({completedLinks}/{batchStatuses.length})
              </button>
            )}
          </div>

          <div className="url-counter">
            Count: <strong>{parsedUrls.length}</strong> URLs
          </div>
        </div>

        {/* Live progress bar - IDENTICAL to other tabs */}
        {loading && batchStatuses.length > 0 && (
          <div className="progress-card">
            <div className="progress-header">
              <span className="progress-label">
                <span className="spinner"></span>
                Scraping {platform === "facebook" ? "Facebook" : platform === "tiktok" ? "TikTok" : "Comments"} data ({activeProcessingCount} active)...
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setShowStatusModal(true)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#38bdf8",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: 0,
                  }}
                >
                  Xem chi tiết link ▼
                </button>
                <span className="progress-counter">
                  <strong>{completedLinks}</strong> / {batchStatuses.length} (
                  {progressPercent}%)
                </span>
              </div>
            </div>
            <div className="progress-track">
              <div
                className={`progress-bar ${
                  platform === "facebook" ? "fb" : platform === "tiktok" ? "tt" : "cmts"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* KPI Stats Banner - IDENTICAL to other tabs */}
      {(results.length > 0 || loading) && (
        <section
          className="metrics-grid"
          aria-label="Performance and Aggregated Metrics"
        >
          <div className="kpi-card">
            <div className="kpi-icon">💬</div>
            <div>
              <div className="kpi-val">{displayResults.length.toLocaleString()}</div>
              <div className="kpi-label">Total Comments Extracted</div>
            </div>
          </div>

          <div
            className="kpi-card"
            style={{ cursor: batchStatuses.length > 0 ? "pointer" : "default" }}
            onClick={() => {
              if (batchStatuses.length > 0) setShowStatusModal(true);
            }}
            title={batchStatuses.length > 0 ? "Click để mở popup chi tiết từng link" : ""}
          >
            <div className="kpi-icon">📋</div>
            <div>
              <div className="kpi-val">
                {completedSuccessCount} / {batchStatuses.length || parsedUrls.length}
              </div>
              <div className="kpi-label">
                URLs Processed {batchStatuses.length > 0 ? "(Chi tiết ↗)" : ""}
              </div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">⏱️</div>
            <div>
              <div className="kpi-val">
                {elapsed !== null ? elapsed : timer}s
              </div>
              <div className="kpi-label">Total Elapsed Time</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">✨</div>
            <div>
              <div className="kpi-val">
                {datasetStats ? `${datasetStats.uniquePercent}%` : "100%"}
              </div>
              <div className="kpi-label">Unique Comments Rate</div>
            </div>
          </div>
        </section>
      )}

      {/* Scraped Results Section - IDENTICAL to other tabs */}
      {results.length > 0 && (
        <section className="glass-card" aria-labelledby="results-title">
          <div className="results-header">
            <div>
              <h2 id="results-title" className="card-title">
                📊 Scraped Comments Data
              </h2>
              <p className="card-subtitle">
                Showing {displayResults.length} of {results.length} comments | 2 Columns: [id | Comment]
                {deduplicate && results.length > displayResults.length && (
                  <span style={{ color: "#34d399", marginLeft: "0.5rem" }}>
                    ({results.length - displayResults.length} duplicates filtered)
                  </span>
                )}
              </p>
            </div>

            <div className="results-actions">
              <input
                id="search-input"
                type="text"
                placeholder="🔍 Search comments..."
                className="search-box"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <button
                id="copy-table-btn"
                className={`btn-primary ${
                  platform === "facebook" ? "fb" : platform === "tiktok" ? "tt" : "cmts"
                }`}
                onClick={() => handleCopyTable(false)}
                style={{ fontWeight: 600 }}
                title="Copy formatted table (TSV) for Google Sheets, Excel"
              >
                {copiedType === "tsv" ? "✅ Copied Table!" : "📋 Copy Table"}
              </button>

              <button
                id="copy-headers-btn"
                className="btn-secondary"
                onClick={() => handleCopyTable(true)}
                title="Copy table with header row"
              >
                {copiedType === "headers" ? "✅ Copied (+Headers)!" : "📋 Copy (+Headers)"}
              </button>

              <button
                id="copy-json-btn"
                className="btn-secondary"
                onClick={handleCopyJson}
              >
                {copiedType === "json" ? "✅ Copied JSON!" : "Copy JSON"}
              </button>

              <button
                id="export-jsonl-btn"
                className="btn-secondary"
                onClick={handleExportJsonl}
              >
                📄 JSONL
              </button>

              <button
                id="export-excel-btn"
                className="btn-secondary"
                onClick={handleExportExcel}
              >
                📊 Excel
              </button>

              <button
                id="export-csv-btn"
                className="btn-secondary"
                onClick={handleExportCsv}
              >
                📄 CSV
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table
              className="custom-table"
              style={{ width: "100%", tableLayout: "fixed" }}
            >
              <thead>
                <tr>
                  <th style={{ width: "80px", textAlign: "center" }}>ID</th>
                  <th>COMMENT</th>
                </tr>
              </thead>
              <tbody>
                {displayResults.map((row) => (
                  <tr key={row.id}>
                    <td
                      style={{
                        textAlign: "center",
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-dim)",
                        fontWeight: 600,
                        verticalAlign: "top",
                        paddingTop: "0.75rem",
                      }}
                    >
                      #{row.id}
                    </td>
                    <td
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        lineHeight: 1.6,
                        color: "var(--text-body)",
                        paddingTop: "0.75rem",
                        paddingBottom: "0.75rem",
                        fontSize: "0.9rem",
                      }}
                    >
                      {row.Comment}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Detail Status Modal Popup */}
      {showStatusModal && (
        <div
          className="status-modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
          onClick={() => setShowStatusModal(false)}
        >
          <div
            className="glass-card"
            style={{
              width: "100%",
              maxWidth: "780px",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-panel)",
              border: "1px solid var(--border-main)",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6)",
              borderRadius: "var(--radius-lg)",
              padding: "1.25rem 1.5rem",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: "1rem",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    color: "var(--text-main)",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span>📋</span> Chi tiết trạng thái từng link ({batchStatuses.length})
                </h3>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                  Hoàn tất: <strong style={{ color: "var(--text-main)" }}>{completedLinks}</strong> / {batchStatuses.length} | Thành công: <strong style={{ color: "#34d399" }}>{completedSuccessCount}</strong> | Lỗi: <strong style={{ color: failedLinksCount > 0 ? "#f87171" : "var(--text-muted)" }}>{failedLinksCount}</strong>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                style={{
                  background: "#1e293b",
                  border: "1px solid var(--border-main)",
                  color: "var(--text-muted)",
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  display: "grid",
                  placeContent: "center",
                  cursor: "pointer",
                  fontSize: "1rem",
                  lineHeight: 1,
                  transition: "all 0.15s ease",
                }}
                title="Đóng cửa sổ"
              >
                ✕
              </button>
            </div>

            {/* Modal Scrollable List */}
            <div
              style={{
                overflowY: "auto",
                padding: "0.75rem 0",
                flex: 1,
                fontFamily: "var(--font-mono)",
                fontSize: "0.82rem",
              }}
            >
              {batchStatuses.map((st, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.5rem 0.5rem",
                    borderBottom: "1px dashed #1e293b",
                    gap: "0.75rem",
                    background: st.status === "processing" ? "rgba(56, 189, 248, 0.05)" : "transparent",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      overflow: "hidden",
                      minWidth: 0,
                    }}
                  >
                    <span>{st.platform === "tiktok" ? "🎵" : st.platform === "facebook" ? "📘" : "❓"}</span>
                    <span style={{ color: "var(--text-dim)", width: "30px", flexShrink: 0 }}>
                      #{idx + 1}
                    </span>
                    <span
                      style={{
                        color: "var(--text-main)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={st.url}
                    >
                      {st.url}
                    </span>
                  </div>

                  <div style={{ flexShrink: 0 }}>
                    {st.status === "pending" && (
                      <span style={{ color: "var(--text-dim)", padding: "0.2rem 0.5rem", background: "#1e293b", borderRadius: "4px" }}>
                        Chờ lượt...
                      </span>
                    )}
                    {st.status === "processing" && (
                      <span style={{ color: "#38bdf8", padding: "0.2rem 0.5rem", background: "rgba(56, 189, 248, 0.15)", borderRadius: "4px", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                        <span className="spinner" style={{ width: "10px", height: "10px" }} /> Đang cào...
                      </span>
                    )}
                    {st.status === "success" && (
                      <span style={{ color: "#34d399", padding: "0.2rem 0.5rem", background: "rgba(16, 185, 129, 0.15)", borderRadius: "4px" }}>
                        ✓ +{st.commentCount} cmt
                      </span>
                    )}
                    {st.status === "error" && (
                      <span style={{ color: "#f87171", padding: "0.2rem 0.5rem", background: "rgba(239, 68, 68, 0.15)", borderRadius: "4px" }}>
                        ✕ {st.error || "Lỗi"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingTop: "0.85rem",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <div>
                {!loading && failedLinksCount > 0 && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      handleRetryFailed();
                    }}
                    style={{ color: "#f59e0b", borderColor: "#f59e0b", fontSize: "0.82rem" }}
                  >
                    🔄 Thử lại {failedLinksCount} link lỗi
                  </button>
                )}
              </div>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowStatusModal(false)}
                style={{ fontSize: "0.82rem" }}
              >
                Đóng cửa sổ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

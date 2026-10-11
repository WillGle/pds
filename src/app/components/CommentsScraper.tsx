"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";

export interface CommentRow {
  id: number;
  Comment: string;
}

type PlatformChoice = "auto" | "facebook" | "tiktok";
type ConcurrencyMode = "fast" | "turbo" | "sequential";

interface UrlProcessStatus {
  url: string;
  platform: "facebook" | "tiktok" | "unknown";
  status: "pending" | "processing" | "success" | "error";
  commentCount: number;
  error?: string;
}

const USER_SAMPLE_URLS = [
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

const SAMPLE_SINGLE_FB = "https://www.facebook.com/zuck/posts/pfbid023Anbd22r92VQN9K23DGhd8t6WSK5g8S8cmjKvNogJEYhFQRwHSWdUz6sc5cJjPcYl";
const SAMPLE_SINGLE_TT = "https://www.tiktok.com/@do_toc_do/video/7675974583278685461";

/**
 * Extracts clean URLs from any string, whether separated by newlines, spaces,
 * commas, or formatted as Markdown links `[url](url)` or `<url>`.
 */
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

/**
 * Clean & normalize comment text for NLP Sentiment Analysis
 */
function cleanCommentText(raw: string): string {
  if (!raw) return "";
  // Strip zero-width spaces and control chars
  let text = raw.replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Normalize carriage returns and multiple consecutive blank lines
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export default function CommentsScraper() {
  const [urlsInput, setUrlsInput] = useState<string>("");
  const [platform, setPlatform] = useState<PlatformChoice>("auto");
  const [maxCommentsPerUrl, setMaxCommentsPerUrl] = useState<number>(100);
  const [expandReplies, setExpandReplies] = useState<boolean>(true);
  const [concurrencyMode, setConcurrencyMode] = useState<ConcurrencyMode>("fast");
  const [deduplicate, setDeduplicate] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Batch progress tracking
  const [batchStatuses, setBatchStatuses] = useState<UrlProcessStatus[]>([]);
  const [showStatusLog, setShowStatusLog] = useState<boolean>(false);

  // Aggregated results: strictly [id, Comment]
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

  // Parsed URLs list
  const parsedUrls = useMemo(() => {
    return extractUrls(urlsInput);
  }, [urlsInput]);

  // Counts breakdown
  const urlStats = useMemo(() => {
    let fbCount = 0;
    let ttCount = 0;
    let otherCount = 0;
    for (const u of parsedUrls) {
      const p = detectUrlPlatform(u);
      if (p === "facebook") fbCount++;
      else if (p === "tiktok") ttCount++;
      else otherCount++;
    }
    return { fbCount, ttCount, otherCount, total: parsedUrls.length };
  }, [parsedUrls]);

  // Concurrency Limits based on mode
  const { maxTikTokWorkers, maxFacebookWorkers } = useMemo(() => {
    if (concurrencyMode === "turbo") {
      return { maxTikTokWorkers: 5, maxFacebookWorkers: 2 };
    }
    if (concurrencyMode === "sequential") {
      return { maxTikTokWorkers: 1, maxFacebookWorkers: 1 };
    }
    // "fast" default
    return { maxTikTokWorkers: 3, maxFacebookWorkers: 2 };
  }, [concurrencyMode]);

  // Worker Pool Batch Execution (Adaptive Concurrency)
  const runBatchScraping = async (urlsToRun: string[], isRetry = false) => {
    if (urlsToRun.length === 0) {
      setError("Vui lòng nhập hoặc dán ít nhất 1 link bài viết Facebook hoặc TikTok.");
      return;
    }

    setLoading(true);
    setError(null);
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
      // Mark retrying urls as pending
      setBatchStatuses((prev) =>
        prev.map((item) =>
          urlsToRun.includes(item.url)
            ? { ...item, status: "pending", error: undefined }
            : item
        )
      );
    }

    const startTime = Date.now();

    // Map each url to its status index
    const queue = urlsToRun.map((u) => {
      let targetPlat = detectUrlPlatform(u);
      if (platform === "facebook") targetPlat = "facebook";
      else if (platform === "tiktok") targetPlat = "tiktok";
      return { url: u, platform: targetPlat };
    });

    let activeTt = 0;
    let activeFb = 0;
    let queueIdx = 0;

    const executeLink = async (item: { url: string; platform: "facebook" | "tiktok" | "unknown" }) => {
      const { url: currentUrl, platform: targetPlat } = item;

      // Update status to processing
      setBatchStatuses((prev) =>
        prev.map((s) => (s.url === currentUrl ? { ...s, status: "processing" } : s))
      );

      if (targetPlat === "unknown") {
        setBatchStatuses((prev) =>
          prev.map((s) =>
            s.url === currentUrl
              ? { ...s, status: "error", error: "Không nhận diện được nền tảng" }
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

        // Clean & normalize comment texts
        const cleanedComments = incomingRows
          .map((r) => cleanCommentText(r.Comment))
          .filter(Boolean);

        // Append to results with monotonically increasing ID
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
        const msg = err instanceof Error ? err.message : "Lỗi kết nối";
        setBatchStatuses((prev) =>
          prev.map((s) =>
            s.url === currentUrl ? { ...s, status: "error", error: msg } : s
          )
        );
      }
    };

    // Worker dispatcher loop
    await new Promise<void>((resolve) => {
      const scheduleNext = () => {
        if (abortRef.current) {
          if (activeTt === 0 && activeFb === 0) resolve();
          return;
        }

        // Try to dispatch tasks as long as slots are available
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
            // Unknown platform, fast-fail
            queueIdx++;
            executeLink(nextItem).finally(() => {
              scheduleNext();
            });
          } else {
            // All workers busy for this platform
            break;
          }
        }

        // Check completion condition
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

  // Filtered & deduplicated comments for view & export
  const displayResults = useMemo(() => {
    let list = results;

    // Optional deduplication
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

    // Search query filter
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

  // Sentiment Dataset Quick Stats
  const datasetStats = useMemo(() => {
    if (results.length === 0) return null;
    const totalWords = results.reduce(
      (acc, r) => acc + (r.Comment.split(/\s+/).filter(Boolean).length || 1),
      0
    );
    const avgWords = Math.round(totalWords / results.length);
    const uniqueSet = new Set(results.map((r) => r.Comment.toLowerCase().trim()));
    const uniquePercent = Math.round((uniqueSet.size / results.length) * 100);
    return { avgWords, uniqueCount: uniqueSet.size, uniquePercent };
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
    link.download = `sentiment_comments_${displayResults.length}_rows.csv`;
    link.click();
  };

  const handleExportExcel = async () => {
    if (displayResults.length === 0) return;
    try {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(displayResults);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Comments");
      XLSX.writeFile(workbook, `sentiment_comments_${displayResults.length}_rows.xlsx`);
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
    link.download = `sentiment_dataset_${displayResults.length}.jsonl`;
    link.click();
  };

  const handleCopyTable = (includeHeader = true) => {
    if (displayResults.length === 0) return;
    const header = includeHeader ? "id\tComment\n" : "";
    const body = displayResults
      .map((r) => `${r.id}\t${r.Comment.replace(/[\r\n\t]+/g, " ")}`)
      .join("\n");
    navigator.clipboard.writeText(header + body);
    setCopiedType("tsv");
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleCopyJson = () => {
    if (displayResults.length === 0) return;
    navigator.clipboard.writeText(JSON.stringify(displayResults, null, 2));
    setCopiedType("json");
    setTimeout(() => setCopiedType(null), 2000);
  };

  // Progress metrics
  const completedLinks = batchStatuses.filter(
    (s) => s.status === "success" || s.status === "error"
  ).length;
  const failedLinksCount = batchStatuses.filter((s) => s.status === "error").length;
  const activeProcessingCount = batchStatuses.filter((s) => s.status === "processing").length;
  const progressPercent =
    batchStatuses.length > 0
      ? Math.round((completedLinks / batchStatuses.length) * 100)
      : 0;

  return (
    <div className="comments-scraper-root">
      {/* Input Section */}
      <section className="glass-card" aria-labelledby="comments-input-title">
        <div className="section-header-row">
          <div>
            <h2 id="comments-input-title" className="card-title">
              💬 Multimodal Sentiment Comments Scraper (Ultra-Fast Batch Mode)
            </h2>
            <p className="card-subtitle">
              Cào đồng thời hàng loạt liên kết Facebook &amp; TikTok với cơ chế <strong>Đa luồng song song (Adaptive Concurrency)</strong>. Toàn bộ bình luận được gộp vào <strong>1 bảng duy nhất [id | Comment]</strong> phục vụ huấn luyện và đánh giá mô hình Sentiment Analysis.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span className="platform-pill cmts">
              {platform === "facebook"
                ? "📘 Facebook Only"
                : platform === "tiktok"
                ? "🎵 TikTok Only"
                : "🌐 Tự động nhận diện (Hỗn hợp)"}
            </span>
          </div>
        </div>

        {/* Speed & Platform Selection Toolbar */}
        <div
          style={{
            display: "flex",
            gap: "1.25rem",
            margin: "0.75rem 0",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {/* Platform selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontWeight: 500 }}>
              Nền tảng:
            </span>
            <button
              type="button"
              className={`btn-secondary ${platform === "auto" ? "active" : ""}`}
              style={{
                padding: "0.3rem 0.65rem",
                fontSize: "0.78rem",
                background: platform === "auto" ? "#1e293b" : "transparent",
                borderColor: platform === "auto" ? "#10b981" : "var(--border-main)",
                color: platform === "auto" ? "#34d399" : "var(--text-body)",
              }}
              onClick={() => setPlatform("auto")}
            >
              🌐 Tự động
            </button>
            <button
              type="button"
              className={`btn-secondary ${platform === "facebook" ? "active" : ""}`}
              style={{
                padding: "0.3rem 0.65rem",
                fontSize: "0.78rem",
                background: platform === "facebook" ? "rgba(59, 130, 246, 0.15)" : "transparent",
                borderColor: platform === "facebook" ? "#3b82f6" : "var(--border-main)",
                color: platform === "facebook" ? "#60a5fa" : "var(--text-body)",
              }}
              onClick={() => setPlatform("facebook")}
            >
              📘 Facebook
            </button>
            <button
              type="button"
              className={`btn-secondary ${platform === "tiktok" ? "active" : ""}`}
              style={{
                padding: "0.3rem 0.65rem",
                fontSize: "0.78rem",
                background: platform === "tiktok" ? "rgba(244, 63, 94, 0.15)" : "transparent",
                borderColor: platform === "tiktok" ? "#f43f5e" : "var(--border-main)",
                color: platform === "tiktok" ? "#fb7185" : "var(--text-body)",
              }}
              onClick={() => setPlatform("tiktok")}
            >
              🎵 TikTok
            </button>
          </div>

          {/* Concurrency Speed Mode */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontWeight: 500 }}>
              ⚡ Tốc độ cào:
            </span>
            <button
              type="button"
              className={`btn-secondary ${concurrencyMode === "fast" ? "active" : ""}`}
              style={{
                padding: "0.3rem 0.65rem",
                fontSize: "0.78rem",
                background: concurrencyMode === "fast" ? "rgba(16, 185, 129, 0.15)" : "transparent",
                borderColor: concurrencyMode === "fast" ? "#10b981" : "var(--border-main)",
                color: concurrencyMode === "fast" ? "#34d399" : "var(--text-body)",
              }}
              onClick={() => setConcurrencyMode("fast")}
              title="Chạy song song 3 luồng TikTok, 2 luồng Facebook (Cân bằng tốt nhất)"
            >
              ⚡ Nhanh (Song song x3 TT, x2 FB)
            </button>
            <button
              type="button"
              className={`btn-secondary ${concurrencyMode === "turbo" ? "active" : ""}`}
              style={{
                padding: "0.3rem 0.65rem",
                fontSize: "0.78rem",
                background: concurrencyMode === "turbo" ? "rgba(14, 165, 233, 0.15)" : "transparent",
                borderColor: concurrencyMode === "turbo" ? "#0ea5e9" : "var(--border-main)",
                color: concurrencyMode === "turbo" ? "#38bdf8" : "var(--text-body)",
              }}
              onClick={() => setConcurrencyMode("turbo")}
              title="Chạy song song 5 luồng TikTok, 2 luồng Facebook (Tối đa tốc độ)"
            >
              🚀 Siêu tốc (x5 TT, x2 FB)
            </button>
            <button
              type="button"
              className={`btn-secondary ${concurrencyMode === "sequential" ? "active" : ""}`}
              style={{
                padding: "0.3rem 0.65rem",
                fontSize: "0.78rem",
                background: concurrencyMode === "sequential" ? "#1e293b" : "transparent",
                borderColor: concurrencyMode === "sequential" ? "#64748b" : "var(--border-main)",
                color: concurrencyMode === "sequential" ? "#94a3b8" : "var(--text-body)",
              }}
              onClick={() => setConcurrencyMode("sequential")}
              title="Chạy tuần tự 1 link tại một thời điểm (Tiết kiệm RAM nhất)"
            >
              🛡️ Tuần tự (1-by-1)
            </button>
          </div>
        </div>

        {/* URLs Textarea Input */}
        <div style={{ marginTop: "0.5rem" }}>
          <textarea
            id="comments-urls-input"
            className="input-textarea"
            rows={6}
            style={{ minHeight: "150px" }}
            value={urlsInput}
            onChange={(e) => setUrlsInput(e.target.value)}
            placeholder={`Dán danh sách các link Facebook & TikTok tại đây (hỗ trợ nhiều link cùng lúc, mỗi dòng 1 link hoặc dạng markdown [url](url))...\nVí dụ:\nhttps://www.tiktok.com/@do_toc_do/video/7675974583278685461\nhttps://www.facebook.com/reel/1751123646230423`}
          />
        </div>

        {/* Link Counter & Badges */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "0.5rem",
            fontSize: "0.82rem",
            color: "var(--text-muted)",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <span>
              Đã nhận diện:{" "}
              <strong style={{ color: "var(--text-main)", fontFamily: "var(--font-mono)" }}>
                {urlStats.total}
              </strong>{" "}
              URLs
            </span>
            {urlStats.ttCount > 0 && (
              <span
                style={{
                  background: "rgba(244, 63, 94, 0.12)",
                  color: "#fb7185",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                🎵 TikTok: {urlStats.ttCount}
              </span>
            )}
            {urlStats.fbCount > 0 && (
              <span
                style={{
                  background: "rgba(59, 130, 246, 0.12)",
                  color: "#60a5fa",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                📘 Facebook: {urlStats.fbCount}
              </span>
            )}
            {urlStats.otherCount > 0 && (
              <span
                style={{
                  background: "rgba(239, 68, 68, 0.12)",
                  color: "#f87171",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                ⚠️ Khác: {urlStats.otherCount}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
              onClick={() => {
                setUrlsInput(USER_SAMPLE_URLS.join("\n"));
                setPlatform("auto");
              }}
              title="Tải toàn bộ 28 link mẫu (18 TikTok + 10 Facebook)"
            >
              📋 Mẫu 28 links của bạn (18 TT + 10 FB)
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
              onClick={() => {
                setUrlsInput(SAMPLE_SINGLE_TT);
                setPlatform("tiktok");
              }}
            >
              🎵 1 link TikTok
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
              onClick={() => {
                setUrlsInput(SAMPLE_SINGLE_FB);
                setPlatform("facebook");
              }}
            >
              📘 1 link Facebook
            </button>
            {urlsInput && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                onClick={() => {
                  setUrlsInput("");
                  setBatchStatuses([]);
                }}
              >
                🗑️ Xóa hết
              </button>
            )}
          </div>
        </div>

        {/* Options Row */}
        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            marginTop: "0.85rem",
            alignItems: "center",
            flexWrap: "wrap",
            padding: "0.75rem 1rem",
            background: "var(--bg-panel-secondary)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label
              htmlFor="max-comments-input"
              style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}
            >
              Số bình luận tối đa mỗi link:
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
                width: "80px",
                padding: "0.3rem 0.5rem",
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
              gap: "0.5rem",
              cursor: "pointer",
              fontSize: "0.85rem",
              color: "var(--text-body)",
            }}
          >
            <input
              type="checkbox"
              checked={expandReplies}
              onChange={(e) => setExpandReplies(e.target.checked)}
              style={{ accentColor: "#10b981", width: "16px", height: "16px" }}
            />
            Cào cả bình luận phản hồi (Sub-comments / Replies)
          </label>

          {/* Deduplication option for Sentiment Analysis */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: "pointer",
              fontSize: "0.85rem",
              color: deduplicate ? "#34d399" : "var(--text-body)",
              fontWeight: deduplicate ? 600 : 400,
            }}
            title="Loại bỏ các bình luận trùng lặp nội dung hoàn toàn để tránh thiên kiến tập huấn luyện"
          >
            <input
              type="checkbox"
              checked={deduplicate}
              onChange={(e) => setDeduplicate(e.target.checked)}
              style={{ accentColor: "#10b981", width: "16px", height: "16px" }}
            />
            🧹 Loại bỏ bình luận trùng lặp (Deduplicate)
          </label>
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginTop: "1.25rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {!loading ? (
            <button
              id="start-comments-btn"
              type="button"
              className="btn-primary cmts"
              onClick={handleStartScraping}
              disabled={parsedUrls.length === 0}
              style={{
                padding: "0.65rem 1.75rem",
                fontSize: "0.95rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span>🚀</span> Bắt đầu cào {parsedUrls.length > 0 ? `(${parsedUrls.length} links)` : "bình luận"}
            </button>
          ) : (
            <button
              id="stop-comments-btn"
              type="button"
              className="btn-secondary"
              onClick={handleStop}
              style={{
                padding: "0.65rem 1.75rem",
                fontSize: "0.95rem",
                color: "#f87171",
                borderColor: "#f87171",
              }}
            >
              ⏹ Dừng lại (Giữ dữ liệu đã cào)
            </button>
          )}

          {/* Retry Failed Links Button */}
          {!loading && failedLinksCount > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleRetryFailed}
              style={{
                padding: "0.65rem 1.25rem",
                fontSize: "0.9rem",
                color: "#f59e0b",
                borderColor: "#f59e0b",
                background: "rgba(245, 158, 11, 0.12)",
              }}
            >
              🔄 Thử lại {failedLinksCount} link lỗi
            </button>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span className="spinner" style={{ width: "20px", height: "20px" }} />
              <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>
                Đang cào song song ({activeProcessingCount} link đang chạy, {completedLinks}/{batchStatuses.length} xong) — {timer}s...
              </span>
            </div>
          )}

          {!loading && elapsed !== null && (
            <span
              style={{
                fontSize: "0.85rem",
                color: "#34d399",
                fontFamily: "var(--font-mono)",
              }}
            >
              ⚡ Đã hoàn tất sau {elapsed}s | Thu thập được{" "}
              <strong>{results.length}</strong> bình luận
            </span>
          )}

          {batchStatuses.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              style={{
                marginLeft: "auto",
                fontSize: "0.78rem",
                padding: "0.35rem 0.65rem",
              }}
              onClick={() => setShowStatusLog(!showStatusLog)}
            >
              {showStatusLog ? "Ẩn chi tiết link ▲" : "Xem chi tiết từng link ▼"}
            </button>
          )}
        </div>

        {/* Live Batch Progress Bar */}
        {loading && batchStatuses.length > 0 && (
          <div className="progress-card" style={{ marginTop: "1rem" }}>
            <div className="progress-header">
              <span className="progress-label">
                <span className="spinner" style={{ width: "12px", height: "12px" }} />
                Đang cào đa luồng ({concurrencyMode.toUpperCase()})
              </span>
              <span className="progress-counter">
                {completedLinks} / {batchStatuses.length} ({progressPercent}%)
              </span>
            </div>
            <div className="progress-track">
              <div
                className="progress-bar"
                style={{
                  width: `${progressPercent}%`,
                  background: "linear-gradient(90deg, #10b981, #06b6d4)",
                }}
              />
            </div>
          </div>
        )}

        {/* Per-URL Breakdown Log */}
        {showStatusLog && batchStatuses.length > 0 && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.85rem 1rem",
              background: "var(--bg-input)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              maxHeight: "240px",
              overflowY: "auto",
              fontSize: "0.8rem",
              fontFamily: "var(--font-mono)",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.5rem" }}>
              Tiến trình từng link ({batchStatuses.length}):
            </div>
            {batchStatuses.map((st, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "0.25rem 0",
                  borderBottom: "1px dashed #1e293b",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span>{st.platform === "tiktok" ? "🎵" : st.platform === "facebook" ? "📘" : "❓"}</span>
                  <span style={{ color: "var(--text-main)" }}>#{idx + 1}:</span>
                  <span style={{ color: "var(--text-dim)" }}>{st.url}</span>
                </div>
                <div style={{ flexShrink: 0 }}>
                  {st.status === "pending" && <span style={{ color: "var(--text-dim)" }}>Chờ lượt...</span>}
                  {st.status === "processing" && (
                    <span style={{ color: "#38bdf8" }}>Đang cào...</span>
                  )}
                  {st.status === "success" && (
                    <span style={{ color: "#34d399" }}>✓ +{st.commentCount} cmt</span>
                  )}
                  {st.status === "error" && (
                    <span style={{ color: "#f87171" }}>✕ {st.error || "Lỗi"}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* General Error Message */}
        {error && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              borderRadius: "var(--radius-md)",
              color: "#fca5a5",
              fontSize: "0.88rem",
            }}
          >
            ⚠️ <strong>Lỗi:</strong> {error}
          </div>
        )}
      </section>

      {/* Results Section */}
      {results.length > 0 && (
        <section
          className="glass-card table-card"
          style={{ marginTop: "1.5rem" }}
        >
          <div className="table-header-bar">
            <div>
              <h3
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 600,
                  color: "var(--text-main)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <span>📊</span> Bảng bình luận ({displayResults.length} dòng
                {deduplicate && results.length !== displayResults.length ? ` / ${results.length} gốc` : ""})
              </h3>
              <p
                style={{
                  fontSize: "0.78rem",
                  color: "var(--text-muted)",
                  marginTop: "0.15rem",
                }}
              >
                Chuẩn định dạng 2 cột <code>id | Comment</code> phục vụ Multimodal Sentiment Analysis
              </p>
            </div>

            <div className="results-actions">
              <input
                type="text"
                className="search-box"
                placeholder="🔍 Tìm trong bình luận..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleCopyTable(true)}
                title="Sao chép dạng bảng TSV để dán trực tiếp vào Google Sheets hoặc Excel"
              >
                📋 {copiedType === "tsv" ? "Đã chép!" : "Copy Bảng (TSV)"}
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleCopyJson}
                title="Sao chép mảng JSON để import vào Python/Pandas"
              >
                {copiedType === "json" ? "Đã chép JSON!" : "Copy JSON"}
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportJsonl}
                title="Xuất file JSONL (.jsonl) chuẩn nạp mô hình NLP / Hugging Face Datasets"
              >
                📄 JSONL
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportExcel}
                title="Xuất file bảng tính Excel (.xlsx)"
              >
                📊 Excel (.xlsx)
              </button>

              <button
                type="button"
                className="btn-primary cmts"
                onClick={handleExportCsv}
                title="Xuất file CSV mã hóa chuẩn UTF-8 BOM"
              >
                📥 Xuất CSV
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
                  <th style={{ width: "70px", textAlign: "center" }}>id</th>
                  <th>Comment</th>
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

          {/* Dataset Quality & Metadata Summary */}
          <div
            style={{
              padding: "0.75rem 1.25rem",
              background: "var(--bg-panel-secondary)",
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <span>
              Hiển thị <strong>{displayResults.length}</strong> /{" "}
              <strong>{results.length}</strong> bình luận
              {deduplicate && results.length > displayResults.length && (
                <span style={{ color: "#34d399", marginLeft: "0.5rem" }}>
                  (Đã loại bỏ {results.length - displayResults.length} bình luận trùng)
                </span>
              )}
            </span>

            {datasetStats && (
              <span style={{ display: "flex", gap: "1rem", fontFamily: "var(--font-mono)" }}>
                <span>Độ dài TB: ~{datasetStats.avgWords} từ/cmt</span>
                <span>Tỉ lệ duy nhất: {datasetStats.uniquePercent}%</span>
                <span>Chuẩn format: 2 Columns [id, Comment]</span>
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

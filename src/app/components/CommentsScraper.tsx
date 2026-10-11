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

export default function CommentsScraper() {
  const [urlsInput, setUrlsInput] = useState<string>("");
  const [platform, setPlatform] = useState<PlatformChoice>("auto");
  const [maxCommentsPerUrl, setMaxCommentsPerUrl] = useState<number>(100);
  const [expandReplies, setExpandReplies] = useState<boolean>(true);

  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Batch progress tracking
  const [currentIndex, setCurrentIndex] = useState<number>(0);
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

  // Sequential batch scraping
  const handleStartScraping = async () => {
    if (parsedUrls.length === 0) {
      setError("Vui lòng nhập hoặc dán ít nhất 1 link bài viết Facebook hoặc TikTok.");
      return;
    }

    setLoading(true);
    setError(null);
    setTimer(0);
    setElapsed(null);
    setResults([]);
    setCurrentIndex(0);
    abortRef.current = false;

    // Initialize statuses for all URLs
    const initialStatuses: UrlProcessStatus[] = parsedUrls.map((u) => {
      let targetPlat: "facebook" | "tiktok" | "unknown" = detectUrlPlatform(u);
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

    const startTime = Date.now();
    let accumulatedComments: CommentRow[] = [];

    try {
      for (let i = 0; i < parsedUrls.length; i++) {
        if (abortRef.current) {
          break;
        }

        const currentUrl = parsedUrls[i];
        setCurrentIndex(i);

        const targetPlat = initialStatuses[i].platform;
        if (targetPlat === "unknown") {
          // Update status as error
          setBatchStatuses((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? {
                    ...item,
                    status: "error",
                    error: "Không nhận diện được nền tảng (cần link Facebook hoặc TikTok)",
                  }
                : item
            )
          );
          continue;
        }

        // Mark as processing
        setBatchStatuses((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: "processing" } : item
          )
        );

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

          if (abortRef.current) {
            break;
          }

          if (!res.ok || data.error) {
            const errDetail = data.error || `HTTP ${res.status}`;
            setBatchStatuses((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? { ...item, status: "error", error: errDetail }
                  : item
              )
            );
            continue;
          }

          // Format rows into continuous sequential table
          const incomingRows: CommentRow[] = Array.isArray(data)
            ? data
            : Array.isArray(data.data)
            ? data.data
            : [];

          const currentBaseId = accumulatedComments.length;
          const reindexedRows: CommentRow[] = incomingRows.map((item, itemIdx) => ({
            id: currentBaseId + itemIdx + 1,
            Comment: item.Comment,
          }));

          accumulatedComments = [...accumulatedComments, ...reindexedRows];
          setResults(accumulatedComments);

          setBatchStatuses((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? {
                    ...item,
                    status: "success",
                    commentCount: reindexedRows.length,
                  }
                : item
            )
          );
        } catch (linkErr: unknown) {
          const msg = linkErr instanceof Error ? linkErr.message : "Lỗi kết nối";
          setBatchStatuses((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: "error", error: msg } : item
            )
          );
        }
      }
    } finally {
      setLoading(false);
      setElapsed(+((Date.now() - startTime) / 1000).toFixed(2));
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    setLoading(false);
  };

  // Filtered comments for search
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return results;
    const query = searchQuery.trim().toLowerCase();
    return results.filter(
      (item) =>
        item.Comment.toLowerCase().includes(query) ||
        String(item.id).includes(query)
    );
  }, [results, searchQuery]);

  // Export handlers
  const handleExportCsv = () => {
    if (results.length === 0) return;
    const bom = "\uFEFF";
    const header = "id,Comment\n";
    const body = results
      .map((r) => `${r.id},"${r.Comment.replace(/"/g, '""')}"`)
      .join("\n");
    const blob = new Blob([bom + header + body], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `sentiment_comments_${results.length}_rows.csv`;
    link.click();
  };

  const handleExportExcel = async () => {
    if (results.length === 0) return;
    try {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(results);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Comments");
      XLSX.writeFile(workbook, `sentiment_comments_${results.length}_rows.xlsx`);
    } catch (e) {
      console.error("Export Excel error:", e);
    }
  };

  const handleCopyTable = (includeHeader = true) => {
    if (results.length === 0) return;
    const header = includeHeader ? "id\tComment\n" : "";
    const body = results
      .map((r) => `${r.id}\t${r.Comment.replace(/[\r\n\t]+/g, " ")}`)
      .join("\n");
    navigator.clipboard.writeText(header + body);
    setCopiedType("tsv");
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleCopyJson = () => {
    if (results.length === 0) return;
    navigator.clipboard.writeText(JSON.stringify(results, null, 2));
    setCopiedType("json");
    setTimeout(() => setCopiedType(null), 2000);
  };

  // Progress metrics
  const completedLinks = batchStatuses.filter(
    (s) => s.status === "success" || s.status === "error"
  ).length;
  const progressPercent =
    parsedUrls.length > 0
      ? Math.round((completedLinks / parsedUrls.length) * 100)
      : 0;

  return (
    <div className="comments-scraper-root">
      {/* Input Section */}
      <section className="glass-card" aria-labelledby="comments-input-title">
        <div className="section-header-row">
          <div>
            <h2 id="comments-input-title" className="card-title">
              💬 Multimodal Sentiment Comments Scraper (Batch Mode)
            </h2>
            <p className="card-subtitle">
              Hỗ trợ dán đồng thời nhiều link Facebook &amp; TikTok (mỗi dòng 1 link hoặc dạng markdown). Toàn bộ bình luận sẽ được tổng hợp vào <strong>1 bảng duy nhất với 2 cột [id | Comment]</strong> phục vụ huấn luyện mô hình phân tích cảm xúc đa phương thái.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span className="platform-pill cmts">
              {platform === "facebook"
                ? "📘 Facebook Only"
                : platform === "tiktok"
                ? "🎵 TikTok Only"
                : "🌐 Tự động nhận diện (Hỗn hợp FB & TikTok)"}
            </span>
          </div>
        </div>

        {/* Platform Selection */}
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            margin: "0.75rem 0",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              fontWeight: 500,
            }}
          >
            Chế độ nhận diện:
          </span>
          <button
            type="button"
            className={`btn-secondary ${platform === "auto" ? "active" : ""}`}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.82rem",
              background: platform === "auto" ? "#1e293b" : "transparent",
              borderColor: platform === "auto" ? "#10b981" : "var(--border-main)",
              color: platform === "auto" ? "#34d399" : "var(--text-body)",
            }}
            onClick={() => setPlatform("auto")}
          >
            🌐 Tự động theo từng link (Khuyên dùng)
          </button>
          <button
            type="button"
            className={`btn-secondary ${platform === "facebook" ? "active" : ""}`}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.82rem",
              background:
                platform === "facebook"
                  ? "rgba(59, 130, 246, 0.15)"
                  : "transparent",
              borderColor:
                platform === "facebook" ? "#3b82f6" : "var(--border-main)",
              color: platform === "facebook" ? "#60a5fa" : "var(--text-body)",
            }}
            onClick={() => setPlatform("facebook")}
          >
            📘 Ép Facebook
          </button>
          <button
            type="button"
            className={`btn-secondary ${platform === "tiktok" ? "active" : ""}`}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.82rem",
              background:
                platform === "tiktok"
                  ? "rgba(244, 63, 94, 0.15)"
                  : "transparent",
              borderColor:
                platform === "tiktok" ? "#f43f5e" : "var(--border-main)",
              color: platform === "tiktok" ? "#fb7185" : "var(--text-body)",
            }}
            onClick={() => setPlatform("tiktok")}
          >
            🎵 Ép TikTok
          </button>
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
            placeholder={`Dán danh sách các link Facebook & TikTok tại đây (hỗ trợ nhiều link cùng lúc, cách nhau bằng dấu xuống dòng hoặc khoảng trắng, hoặc định dạng markdown [url](url))...\nVí dụ:\nhttps://www.tiktok.com/@do_toc_do/video/7675974583278685461\nhttps://www.facebook.com/reel/1751123646230423`}
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
              title="Tải toàn bộ 28 link mẫu (18 TikTok + 10 Facebook) theo yêu cầu của bạn"
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

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span className="spinner" style={{ width: "20px", height: "20px" }} />
              <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>
                Đang xử lý link <strong>{currentIndex + 1}</strong>/{parsedUrls.length} ({timer}s)...
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
        {loading && parsedUrls.length > 0 && (
          <div className="progress-card" style={{ marginTop: "1rem" }}>
            <div className="progress-header">
              <span className="progress-label">
                <span className="spinner" style={{ width: "12px", height: "12px" }} />
                Đang cào: {parsedUrls[currentIndex]}
              </span>
              <span className="progress-counter">
                {completedLinks} / {parsedUrls.length} ({progressPercent}%)
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
              maxHeight: "220px",
              overflowY: "auto",
              fontSize: "0.8rem",
              fontFamily: "var(--font-mono)",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.5rem" }}>
              Chi tiết tiến trình từng link ({batchStatuses.length}):
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
                  {st.status === "pending" && <span style={{ color: "var(--text-dim)" }}>Chờ...</span>}
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
                <span>📊</span> Bảng bình luận ({results.length} dòng)
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
                {filteredResults.map((row) => (
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
              gap: "0.5rem",
            }}
          >
            <span>
              Hiển thị <strong>{filteredResults.length}</strong> /{" "}
              <strong>{results.length}</strong> bình luận
            </span>
            <span style={{ fontFamily: "var(--font-mono)" }}>
              Dataset: {parsedUrls.length} URLs | 2 Columns: [id, Comment]
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

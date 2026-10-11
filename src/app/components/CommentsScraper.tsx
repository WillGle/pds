"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";

export interface CommentRow {
  id: number;
  Comment: string;
}

type PlatformChoice = "auto" | "facebook" | "tiktok";

const SAMPLE_URLS = {
  facebook: "https://www.facebook.com/zuck/posts/pfbid023Anbd22r92VQN9K23DGhd8t6WSK5g8S8cmjKvNogJEYhFQRwHSWdUz6sc5cJjPcYl",
  tiktok: "https://www.tiktok.com/@hoangnga_home/video/7691183589144202503",
};

export default function CommentsScraper() {
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState<PlatformChoice>("auto");
  const [maxComments, setMaxComments] = useState<number>(100);
  const [expandReplies, setExpandReplies] = useState<boolean>(true);

  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [results, setResults] = useState<CommentRow[]>([]);
  const [detectedPlatform, setDetectedPlatform] = useState<"facebook" | "tiktok" | null>(null);
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

  // Auto detect platform from URL
  const activePlatform = useMemo<"facebook" | "tiktok" | "unknown">(() => {
    if (platform === "facebook") return "facebook";
    if (platform === "tiktok") return "tiktok";

    const clean = url.trim().toLowerCase();
    if (clean.includes("facebook.com") || clean.includes("fb.watch") || clean.includes("fb.me")) {
      return "facebook";
    }
    if (clean.includes("tiktok.com")) {
      return "tiktok";
    }
    return "unknown";
  }, [url, platform]);

  const handleStartScraping = async () => {
    const targetUrl = url.trim();
    if (!targetUrl) {
      setError("Vui lòng nhập URL bài viết Facebook hoặc video TikTok.");
      return;
    }

    let endpoint = "";
    let detected: "facebook" | "tiktok" | null = null;

    if (platform === "facebook" || activePlatform === "facebook") {
      endpoint = "/api/scrape/facebook/comments";
      detected = "facebook";
    } else if (platform === "tiktok" || activePlatform === "tiktok") {
      endpoint = "/api/scrape/tiktok/comments";
      detected = "tiktok";
    } else {
      setError("Không nhận diện được nền tảng. Vui lòng chọn cụ thể Facebook hoặc TikTok.");
      return;
    }

    setLoading(true);
    setError(null);
    setTimer(0);
    setElapsed(null);
    setResults([]);
    setDetectedPlatform(detected);
    abortRef.current = false;

    const startTime = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          maxComments,
          expandReplies,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || `Lỗi khi cào dữ liệu (HTTP ${response.status})`);
      }

      if (Array.isArray(data)) {
        setResults(data);
      } else if (Array.isArray(data.data)) {
        setResults(data.data);
      } else {
        setResults([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Đã xảy ra lỗi không xác định.";
      setError(msg);
    } finally {
      setLoading(false);
      setElapsed(+((Date.now() - startTime) / 1000).toFixed(2));
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    setLoading(false);
  };

  // Filtered comments
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return results;
    const query = searchQuery.trim().toLowerCase();
    return results.filter((item) =>
      item.Comment.toLowerCase().includes(query) || String(item.id).includes(query)
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
    const blob = new Blob([bom + header + body], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${detectedPlatform || "social"}_comments_sentiment.csv`;
    link.click();
  };

  const handleExportExcel = async () => {
    if (results.length === 0) return;
    try {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(results);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Comments");
      XLSX.writeFile(workbook, `${detectedPlatform || "social"}_comments_sentiment.xlsx`);
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

  return (
    <div className="comments-scraper-root">
      {/* Input Section */}
      <section className="glass-card" aria-labelledby="comments-input-title">
        <div className="section-header-row">
          <div>
            <h2 id="comments-input-title" className="card-title">
              💬 Multimodal Sentiment Comments Scraper
            </h2>
            <p className="card-subtitle">
              Trích xuất toàn bộ bình luận từ bài viết/video Facebook hoặc TikTok thành bảng chuẩn 2 cột [id | Comment] phục vụ huấn luyện và phân tích cảm xúc.
            </p>
          </div>
          <span className="platform-pill cmts">
            {activePlatform === "facebook" ? "📘 Facebook" : activePlatform === "tiktok" ? "🎵 TikTok" : "🌐 Auto Detect"}
          </span>
        </div>

        {/* Platform Selection */}
        <div style={{ display: "flex", gap: "0.5rem", margin: "1rem 0", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 500 }}>Nền tảng:</span>
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
            🌐 Tự động nhận diện
          </button>
          <button
            type="button"
            className={`btn-secondary ${platform === "facebook" ? "active" : ""}`}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.82rem",
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
              padding: "0.35rem 0.75rem",
              fontSize: "0.82rem",
              background: platform === "tiktok" ? "rgba(244, 63, 94, 0.15)" : "transparent",
              borderColor: platform === "tiktok" ? "#f43f5e" : "var(--border-main)",
              color: platform === "tiktok" ? "#fb7185" : "var(--text-body)",
            }}
            onClick={() => setPlatform("tiktok")}
          >
            🎵 TikTok
          </button>
        </div>

        {/* URL Input */}
        <div style={{ marginTop: "0.75rem" }}>
          <input
            id="comments-url-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Dán link bài viết/Reels Facebook hoặc link video TikTok (hỗ trợ vt.tiktok.com)..."
            style={{
              width: "100%",
              padding: "0.75rem 1rem",
              background: "var(--bg-input)",
              border: "1px solid var(--border-main)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-main)",
              fontSize: "0.95rem",
              outline: "none",
              fontFamily: "var(--font-mono)",
            }}
          />
        </div>

        {/* Options Row */}
        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            marginTop: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
            padding: "0.75rem 1rem",
            background: "var(--bg-panel-secondary)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label htmlFor="max-comments-input" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Số bình luận tối đa:
            </label>
            <input
              id="max-comments-input"
              type="number"
              min="10"
              max="500"
              step="10"
              value={maxComments}
              onChange={(e) => setMaxComments(Math.max(1, parseInt(e.target.value, 10) || 50))}
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

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.85rem", color: "var(--text-body)" }}>
            <input
              type="checkbox"
              checked={expandReplies}
              onChange={(e) => setExpandReplies(e.target.checked)}
              style={{ accentColor: "#10b981", width: "16px", height: "16px" }}
            />
            Cào cả bình luận phản hồi (Sub-comments / Replies)
          </label>

          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "0.35rem 0.65rem" }}
              onClick={() => {
                setUrl(SAMPLE_URLS.facebook);
                setPlatform("facebook");
              }}
            >
              📘 Mẫu Facebook
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "0.35rem 0.65rem" }}
              onClick={() => {
                setUrl(SAMPLE_URLS.tiktok);
                setPlatform("tiktok");
              }}
            >
              🎵 Mẫu TikTok
            </button>
            {url && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: "0.78rem", padding: "0.35rem 0.65rem" }}
                onClick={() => setUrl("")}
              >
                🗑️ Xóa
              </button>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "1rem", marginTop: "1.25rem", alignItems: "center", flexWrap: "wrap" }}>
          {!loading ? (
            <button
              id="start-comments-btn"
              type="button"
              className="btn-primary cmts"
              onClick={handleStartScraping}
              disabled={!url.trim()}
              style={{ padding: "0.65rem 1.75rem", fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span>🚀</span> Bắt đầu cào bình luận
            </button>
          ) : (
            <button
              id="stop-comments-btn"
              type="button"
              className="btn-secondary"
              onClick={handleStop}
              style={{ padding: "0.65rem 1.75rem", fontSize: "0.95rem", color: "#f87171", borderColor: "#f87171" }}
            >
              ⏹ Dừng lại
            </button>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span className="spinner" style={{ width: "20px", height: "20px" }} />
              <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>
                Đang cào bình luận ({timer}s)...
              </span>
            </div>
          )}

          {!loading && elapsed !== null && (
            <span style={{ fontSize: "0.85rem", color: "#34d399", fontFamily: "var(--font-mono)" }}>
              ⚡ Hoàn tất sau {elapsed}s
            </span>
          )}
        </div>

        {/* Error message */}
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
        <section className="glass-card table-card" style={{ marginTop: "1.5rem" }}>
          <div className="table-header-bar">
            <div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span>📊</span> Bảng bình luận ({results.length} dòng)
              </h3>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
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
            <table className="custom-table" style={{ width: "100%", tableLayout: "fixed" }}>
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
            }}
          >
            <span>
              Hiển thị <strong>{filteredResults.length}</strong> / <strong>{results.length}</strong> bình luận
            </span>
            <span style={{ fontFamily: "var(--font-mono)" }}>
              Dataset: {detectedPlatform?.toUpperCase()} | 2 Columns: [id, Comment]
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

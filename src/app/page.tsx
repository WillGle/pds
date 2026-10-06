"use client";

import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";

interface FacebookItem {
  url: string;
  id: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  author: string;
  title: string;
  postDate: string;
  thumbnail: string;
  error?: string;
}

interface TikTokItem {
  url: string;
  cleanUrl: string;
  id: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  totalInteractions: number | null;
  author: string;
  title: string;
  postDate: string;
  thumbnail: string;
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
  "https://www.tiktok.com/@nawngs.vlog/video/7573658249547861268",
  "https://www.tiktok.com/@giadinhcamtaoo/video/7568842259982978322",
  "https://www.tiktok.com/@duyluandethuong/video/7578311186408656136",
].join("\n");

export default function Home() {
  const [activeTab, setActiveTab] = useState<"facebook" | "tiktok">("facebook");

  // Facebook state
  const [fbInput, setFbInput] = useState(SAMPLE_FB_URLS);
  const [fbResults, setFbResults] = useState<FacebookItem[]>([]);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbElapsed, setFbElapsed] = useState<number | null>(null);

  // TikTok state
  const [ttInput, setTtInput] = useState(SAMPLE_TT_URLS);
  const [ttResults, setTtResults] = useState<TikTokItem[]>([]);
  const [ttLoading, setTtLoading] = useState(false);
  const [ttElapsed, setTtElapsed] = useState<number | null>(null);

  // Search filter & view preferences
  const [searchQuery, setSearchQuery] = useState("");
  const [showOptionalCols, setShowOptionalCols] = useState(false);
  const [copiedType, setCopiedType] = useState<string | null>(null);

  // Live timer during scraping
  const [timer, setTimer] = useState(0);
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (fbLoading || ttLoading) {
      interval = setInterval(() => {
        setTimer((prev) => +(prev + 0.1).toFixed(1));
      }, 100);
    } else {
      setTimer(0);
    }
    return () => clearInterval(interval);
  }, [fbLoading, ttLoading]);

  // Handle Facebook scrape
  const handleScrapeFacebook = async () => {
    const urls = fbInput
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) return;

    setFbLoading(true);
    setFbResults([]);
    setFbElapsed(null);
    const start = performance.now();

    try {
      const resp = await fetch("/api/scrape/facebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await resp.json();
      if (data.data) {
        setFbResults(data.data);
      }
    } catch (err) {
      console.error("Facebook scraping failed", err);
    } finally {
      setFbLoading(false);
      setFbElapsed(+((performance.now() - start) / 1000).toFixed(2));
    }
  };

  // Handle TikTok scrape
  const handleScrapeTikTok = async () => {
    const urls = ttInput
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) return;

    setTtLoading(true);
    setTtResults([]);
    setTtElapsed(null);
    const start = performance.now();

    try {
      const resp = await fetch("/api/scrape/tiktok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await resp.json();
      if (data.data) {
        setTtResults(data.data);
      }
    } catch (err) {
      console.error("TikTok scraping failed", err);
    } finally {
      setTtLoading(false);
      setTtElapsed(+((performance.now() - start) / 1000).toFixed(2));
    }
  };

  // Filtered Facebook results
  const filteredFb = useMemo(() => {
    if (!searchQuery.trim()) return fbResults;
    const q = searchQuery.toLowerCase();
    return fbResults.filter(
      (item) =>
        item.author.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q)
    );
  }, [fbResults, searchQuery]);

  // Filtered TikTok results
  const filteredTt = useMemo(() => {
    if (!searchQuery.trim()) return ttResults;
    const q = searchQuery.toLowerCase();
    return ttResults.filter(
      (item) =>
        item.author.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q)
    );
  }, [ttResults, searchQuery]);





  // Stats computation
  const fbStats = useMemo(() => {
    const total = fbResults.length;
    const valid = fbResults.filter((r) => !r.error);
    const totalViews = valid.reduce((sum, r) => sum + (r.views || 0), 0);
    const totalLikes = valid.reduce((sum, r) => sum + (r.likes || 0), 0);
    return { total, validCount: valid.length, totalViews, totalLikes };
  }, [fbResults]);

  const ttStats = useMemo(() => {
    const total = ttResults.length;
    const valid = ttResults.filter((r) => !r.error);
    const totalViews = valid.reduce((sum, r) => sum + (r.views || 0), 0);
    const totalLikes = valid.reduce((sum, r) => sum + (r.likes || 0), 0);
    return { total, validCount: valid.length, totalViews, totalLikes };
  }, [ttResults]);

  // Export to Excel
  const exportToExcel = () => {
    const isFb = activeTab === "facebook";
    const dataToExport = isFb
      ? fbResults.map((r) => ({
          URL: r.url,
          "Video ID": r.id || "",
          Author: r.author || "",
          Title: r.title || "",
          Views: r.views || 0,
          Likes: r.likes || 0,
          Comments: r.comments ?? "N/A",
          Shares: r.shares ?? "N/A",
          "Post Date": r.postDate || "N/A",
          Status: r.error ? `Error: ${r.error}` : "OK",
        }))
      : ttResults.map((r) => ({
          URL: r.url,
          "Clean URL": r.cleanUrl || "",
          "Video ID": r.id || "",
          Author: r.author || "",
          Title: r.title || "",
          Views: r.views || 0,
          Likes: r.likes || 0,
          Comments: r.comments || 0,
          Shares: r.shares || 0,
          Saves: r.saves || 0,
          "Total Interactions": r.totalInteractions || 0,
          "Release Date": r.postDate || "N/A",
          Status: r.error ? `Error: ${r.error}` : "OK",
        }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, isFb ? "Facebook Data" : "TikTok Data");

    const timeStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    XLSX.writeFile(workbook, `${isFb ? "facebook" : "tiktok"}_data_${timeStr}.xlsx`);
  };

  // Export to CSV
  const exportToCsv = () => {
    const isFb = activeTab === "facebook";
    const dataToExport = isFb
      ? fbResults.map((r) => ({
          URL: r.url,
          Author: r.author || "",
          Title: (r.title || "").replace(/[\r\n]+/g, " "),
          Views: r.views || 0,
          Likes: r.likes || 0,
          Comments: r.comments ?? 0,
          Shares: r.shares ?? 0,
          Date: r.postDate || "N/A",
        }))
      : ttResults.map((r) => ({
          URL: r.url,
          Author: r.author || "",
          Title: (r.title || "").replace(/[\r\n]+/g, " "),
          Views: r.views || 0,
          Likes: r.likes || 0,
          Comments: r.comments || 0,
          Shares: r.shares || 0,
          Saves: r.saves || 0,
          Date: r.postDate || "N/A",
        }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob(["\uFEFF" + csvOutput], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timeStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    link.setAttribute("download", `${isFb ? "facebook" : "tiktok"}_data_${timeStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy ONLY the 4 key metrics: Views, Likes, Comments, Shares
  const copyMetricsOnly = (withHeaders: boolean) => {
    const isFb = activeTab === "facebook";
    const data = isFb ? filteredFb : filteredTt;
    if (data.length === 0) return;

    const rows = data.map((item) => [
      item.views !== null ? String(item.views) : "0",
      item.likes !== null ? String(item.likes) : "0",
      item.comments !== null ? String(item.comments) : "0",
      item.shares !== null ? String(item.shares) : "0",
    ]);

    const header = "Views\tLikes\tComments\tShares";
    const tsvContent = withHeaders
      ? [header, ...rows.map((r) => r.join("\t"))].join("\n")
      : rows.map((r) => r.join("\t")).join("\n");

    navigator.clipboard.writeText(tsvContent);
    setCopiedType(withHeaders ? "metrics-header" : "metrics-values");
    setTimeout(() => setCopiedType(null), 2000);
  };

  // Copy full table with all fields as TSV
  const copyFullTable = () => {
    const isFb = activeTab === "facebook";
    const data = isFb ? filteredFb : filteredTt;
    if (data.length === 0) return;

    let headers: string[];
    let rows: string[][];

    if (isFb) {
      headers = ["#", "Views", "Likes", "Comments", "Shares", "Author", "Caption / Title", "Post Date", "URL"];
      rows = filteredFb.map((item, idx) => [
        String(idx + 1),
        item.views !== null ? String(item.views) : "0",
        item.likes !== null ? String(item.likes) : "0",
        item.comments !== null ? String(item.comments) : "0",
        item.shares !== null ? String(item.shares) : "0",
        item.author || "",
        (item.title || "").replace(/[\t\r\n]+/g, " ").trim(),
        item.postDate || "",
        item.url || "",
      ]);
    } else {
      headers = ["#", "Views", "Likes", "Comments", "Shares", "Saves", "Total Interactions", "Author", "Title", "Release Date", "URL"];
      rows = filteredTt.map((item, idx) => [
        String(idx + 1),
        item.views !== null ? String(item.views) : "0",
        item.likes !== null ? String(item.likes) : "0",
        item.comments !== null ? String(item.comments) : "0",
        item.shares !== null ? String(item.shares) : "0",
        item.saves !== null ? String(item.saves) : "0",
        item.totalInteractions !== null ? String(item.totalInteractions) : "0",
        item.author || "",
        (item.title || "").replace(/[\t\r\n]+/g, " ").trim(),
        item.postDate || "",
        item.url || "",
      ]);
    }

    const tsvContent = [
      headers.join("\t"),
      ...rows.map((row) => row.join("\t")),
    ].join("\n");

    navigator.clipboard.writeText(tsvContent);
    setCopiedType("full");
    setTimeout(() => setCopiedType(null), 2000);
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
              High-speed serverless scraper for Facebook Reels &amp; TikTok videos on Vercel
            </p>
          </div>
        </div>

        <div className="env-pill">
          <span className="env-dot"></span>
          <span>Vercel Serverless Ready (0s setup)</span>
        </div>
      </header>

      {/* Tabs navigation */}
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
      </nav>

      {/* Input Form Card */}
      <section className="glass-card" aria-labelledby="input-section-title">
        <h2 id="input-section-title" className="card-title">
          {activeTab === "facebook" ? "📘 Input Facebook Video / Reel URLs" : "🎵 Input TikTok Video URLs"}
        </h2>
        <p className="card-subtitle">
          Paste links below (one per line). Processed in parallel via Vercel lightweight HTTP extractors without heavy Selenium browser overhead.
        </p>

        {activeTab === "facebook" ? (
          <textarea
            id="fb-url-input"
            className="input-textarea"
            placeholder="https://www.facebook.com/reel/1075481022014849&#10;https://www.facebook.com/reel/1085809004361213"
            value={fbInput}
            onChange={(e) => setFbInput(e.target.value)}
          />
        ) : (
          <textarea
            id="tt-url-input"
            className="input-textarea"
            placeholder="https://www.tiktok.com/@user/video/1234567890"
            value={ttInput}
            onChange={(e) => setTtInput(e.target.value)}
          />
        )}

        <div className="action-row">
          <div className="btn-group">
            {activeTab === "facebook" ? (
              <button
                id="fb-start-btn"
                className="btn-primary"
                onClick={handleScrapeFacebook}
                disabled={fbLoading || !fbInput.trim()}
              >
                {fbLoading ? (
                  <>
                    <span className="spinner"></span> Scraping ({timer}s)...
                  </>
                ) : (
                  <>🚀 Start Facebook Scraping</>
                )}
              </button>
            ) : (
              <button
                id="tt-start-btn"
                className="btn-primary"
                onClick={handleScrapeTikTok}
                disabled={ttLoading || !ttInput.trim()}
              >
                {ttLoading ? (
                  <>
                    <span className="spinner"></span> Scraping ({timer}s)...
                  </>
                ) : (
                  <>🚀 Start TikTok Scraping</>
                )}
              </button>
            )}

            <button
              id="load-sample-btn"
              className="btn-secondary"
              onClick={() => {
                if (activeTab === "facebook") setFbInput(SAMPLE_FB_URLS);
                else setTtInput(SAMPLE_TT_URLS);
              }}
            >
              📋 Load Sample URLs
            </button>

            <button
              id="clear-input-btn"
              className="btn-secondary"
              onClick={() => {
                if (activeTab === "facebook") setFbInput("");
                else setTtInput("");
              }}
            >
              🗑️ Clear
            </button>
          </div>

          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Count:{" "}
            <strong style={{ color: "var(--text-main)" }}>
              {(activeTab === "facebook" ? fbInput : ttInput).split("\n").filter((l) => l.trim()).length}
            </strong>{" "}
            URLs
          </div>
        </div>
      </section>

      {/* Real-time KPI Stats Banner */}
      {((activeTab === "facebook" && fbResults.length > 0) ||
        (activeTab === "tiktok" && ttResults.length > 0)) && (
        <section className="metrics-grid" aria-label="Performance and Aggregated Metrics">
          <div className="kpi-card">
            <div className="kpi-icon">📋</div>
            <div>
              <div className="kpi-val">
                {activeTab === "facebook" ? fbStats.total : ttStats.total}
              </div>
              <div className="kpi-label">Total URLs Processed</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">⏱️</div>
            <div>
              <div className="kpi-val">
                {(activeTab === "facebook" ? fbElapsed : ttElapsed) || 0}s
              </div>
              <div className="kpi-label">Total Elapsed Time</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">⚡</div>
            <div>
              <div className="kpi-val">
                {(
                  ((activeTab === "facebook" ? fbElapsed : ttElapsed) || 0) /
                  (activeTab === "facebook" ? fbStats.total || 1 : ttStats.total || 1)
                ).toFixed(2)}
                s
              </div>
              <div className="kpi-label">Avg Speed / Video</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">👁️</div>
            <div>
              <div className="kpi-val">
                {(activeTab === "facebook" ? fbStats.totalViews : ttStats.totalViews).toLocaleString()}
              </div>
              <div className="kpi-label">Cumulative Views</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">👍</div>
            <div>
              <div className="kpi-val">
                {(activeTab === "facebook" ? fbStats.totalLikes : ttStats.totalLikes).toLocaleString()}
              </div>
              <div className="kpi-label">Cumulative Likes</div>
            </div>
          </div>
        </section>
      )}





      {/* Main Results Data Table */}
      {((activeTab === "facebook" && fbResults.length > 0) ||
        (activeTab === "tiktok" && ttResults.length > 0)) && (
        <section className="glass-card table-card" aria-label="Scraped Data Table">
          <div className="table-header-bar">
            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                {activeTab === "facebook" ? "📋 Scraped Facebook Data" : "📋 Scraped TikTok Data"}
              </h3>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Showing{" "}
                {activeTab === "facebook" ? filteredFb.length : filteredTt.length} of{" "}
                {activeTab === "facebook" ? fbResults.length : ttResults.length} items
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <input
                id="table-search-input"
                type="text"
                placeholder="🔍 Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-main)",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.5rem 0.8rem",
                  color: "var(--text-main)",
                  fontSize: "0.85rem",
                  outline: "none",
                  width: "180px",
                }}
              />

              <button
                id="copy-metrics-values-btn"
                className="btn-primary"
                onClick={() => copyMetricsOnly(false)}
                title="Copy ONLY numeric values of Views, Likes, Comments, Shares to directly paste into Google Sheets / Excel"
                style={{ fontWeight: 600 }}
              >
                {copiedType === "metrics-values" ? "✅ Copied 4 Metrics!" : "📋 Copy 4 Metrics (Values)"}
              </button>

              <button
                id="copy-metrics-header-btn"
                className="btn-secondary"
                onClick={() => copyMetricsOnly(true)}
                title="Copy Views, Likes, Comments, Shares with header row"
              >
                {copiedType === "metrics-header" ? "✅ Copied (+Headers)!" : "📋 Copy (+Headers)"}
              </button>

              <button
                id="copy-all-btn"
                className="btn-secondary"
                onClick={copyFullTable}
                title="Copy all columns as TSV"
              >
                {copiedType === "full" ? "✅ Copied All Data!" : "📋 Copy All Data"}
              </button>

              <button id="export-excel-btn" className="btn-secondary" onClick={exportToExcel}>
                📊 Excel
              </button>

              <button id="export-csv-btn" className="btn-secondary" onClick={exportToCsv}>
                📄 CSV
              </button>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  fontSize: "0.82rem",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  userSelect: "none",
                  background: "var(--btn-secondary-bg)",
                  padding: "0.45rem 0.75rem",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-main)",
                }}
              >
                <input
                  type="checkbox"
                  checked={showOptionalCols}
                  onChange={(e) => setShowOptionalCols(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                Show extra details (Caption, Media, Date)
              </label>
            </div>
          </div>

          <div className="table-wrapper">
            {activeTab === "facebook" ? (
              <table className="custom-table">
                <thead>
                  <tr>
                    <th style={{ width: "45px", textAlign: "center" }}>#</th>
                    <th className="th-num">Views</th>
                    <th className="th-num">Likes</th>
                    <th className="th-num">Comments</th>
                    <th className="th-num">Shares</th>
                    <th style={{ width: "160px" }}>Author</th>
                    {showOptionalCols && <th>Caption / Title</th>}
                    {showOptionalCols && <th style={{ width: "56px" }}>Media</th>}
                    {showOptionalCols && <th style={{ width: "105px" }}>Post Date</th>}
                    <th style={{ width: "75px", textAlign: "center" }}>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFb.map((item, idx) => (
                    <tr key={item.url + idx}>
                      <td className="td-index">
                        {idx + 1}
                      </td>
                      <td className="td-num">
                        {item.views !== null ? (
                          <span>{item.views.toLocaleString()}</span>
                        ) : (
                          <span className="text-dim">N/A</span>
                        )}
                      </td>
                      <td className="td-num">
                        {item.likes !== null ? item.likes.toLocaleString() : <span className="text-dim">N/A</span>}
                      </td>
                      <td className="td-num">
                        {item.comments !== null ? item.comments.toLocaleString() : <span className="text-dim">—</span>}
                      </td>
                      <td className="td-num">
                        {item.shares !== null ? item.shares.toLocaleString() : <span className="text-dim">—</span>}
                      </td>
                      <td className="table-author">
                        {item.author || "—"}
                      </td>
                      {showOptionalCols && (
                        <td className="table-caption">
                          {item.title ? (
                            <span title={item.title}>
                              {item.title.length > 90 ? item.title.substring(0, 90) + "..." : item.title}
                            </span>
                          ) : (
                            <span className="text-dim">No description</span>
                          )}
                        </td>
                      )}
                      {showOptionalCols && (
                        <td>
                          {item.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.thumbnail} alt="thumbnail" className="video-thumb-mini" />
                          ) : (
                            <div className="video-thumb-mini thumb-fallback">
                              N/A
                            </div>
                          )}
                        </td>
                      )}
                      {showOptionalCols && (
                        <td className="td-date">
                          {item.postDate || "N/A"}
                        </td>
                      )}
                      <td style={{ textAlign: "center" }}>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="link-btn">
                          Open ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="custom-table">
                <thead>
                  <tr>
                    <th style={{ width: "45px", textAlign: "center" }}>#</th>
                    <th className="th-num">Views</th>
                    <th className="th-num">Likes</th>
                    <th className="th-num">Comments</th>
                    <th className="th-num">Shares</th>
                    <th className="th-num">Saves</th>
                    <th className="th-num">Total Int.</th>
                    <th style={{ width: "160px" }}>Author</th>
                    {showOptionalCols && <th>Title</th>}
                    {showOptionalCols && <th style={{ width: "56px" }}>Media</th>}
                    {showOptionalCols && <th style={{ width: "105px" }}>Release Date</th>}
                    <th style={{ width: "75px", textAlign: "center" }}>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTt.map((item, idx) => (
                    <tr key={item.url + idx}>
                      <td className="td-index">
                        {idx + 1}
                      </td>
                      <td className="td-num">
                        {item.views !== null ? (
                          <span>{item.views.toLocaleString()}</span>
                        ) : (
                          <span className="text-dim">N/A</span>
                        )}
                      </td>
                      <td className="td-num">
                        {item.likes !== null ? item.likes.toLocaleString() : <span className="text-dim">N/A</span>}
                      </td>
                      <td className="td-num">
                        {item.comments !== null ? item.comments.toLocaleString() : <span className="text-dim">N/A</span>}
                      </td>
                      <td className="td-num">
                        {item.shares !== null ? item.shares.toLocaleString() : <span className="text-dim">N/A</span>}
                      </td>
                      <td className="td-num">
                        {item.saves !== null ? item.saves.toLocaleString() : <span className="text-dim">N/A</span>}
                      </td>
                      <td className="td-num" style={{ fontWeight: 700 }}>
                        {item.totalInteractions !== null
                          ? item.totalInteractions.toLocaleString()
                          : <span className="text-dim">N/A</span>}
                      </td>
                      <td className="table-author">
                        {item.author || "—"}
                      </td>
                      {showOptionalCols && (
                        <td className="table-caption">
                          {item.title ? (
                            <span title={item.title}>
                              {item.title.length > 85 ? item.title.substring(0, 85) + "..." : item.title}
                            </span>
                          ) : (
                            <span className="text-dim">No title</span>
                          )}
                        </td>
                      )}
                      {showOptionalCols && (
                        <td>
                          {item.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.thumbnail} alt="thumbnail" className="video-thumb-mini" />
                          ) : (
                            <div className="video-thumb-mini thumb-fallback">
                              N/A
                            </div>
                          )}
                        </td>
                      )}
                      {showOptionalCols && (
                        <td className="td-date">
                          {item.postDate || "N/A"}
                        </td>
                      )}
                      <td style={{ textAlign: "center" }}>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="link-btn">
                          Open ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

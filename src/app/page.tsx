"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

interface FacebookItem {
  url: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  author: string;
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

function formatShortLink(url: string): string {
  if (!url) return "";
  return url.replace(/^https?:\/\/(?:www\.)?/, "").split("?")[0].replace(/\/$/, "");
}

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
  const [ttProgress, setTtProgress] = useState<{ current: number; total: number } | null>(null);
  const abortTtRef = useRef<boolean>(false);

  // Search filter
  const [searchQuery, setSearchQuery] = useState("");
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
    const urls = Array.from(
      new Set(
        fbInput
          .split("\n")
          .map((u) => u.trim())
          .filter(Boolean)
      )
    );
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
      if (Array.isArray(data.data)) {
        setFbResults(
          data.data.map((item: any) => ({
            url: item.url,
            views: item.views,
            likes: item.likes,
            comments: item.comments,
            shares: item.shares,
            author: item.author || "—",
            error: item.error,
          }))
        );
      }
    } catch (err) {
      console.error("Facebook scraping failed", err);
    } finally {
      setFbLoading(false);
      setFbElapsed(+((performance.now() - start) / 1000).toFixed(2));
    }
  };

  // Handle TikTok scrape (progressive execution to respect 1 req/sec limit & prevent timeouts)
  const handleScrapeTikTok = async () => {
    const urls = Array.from(
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
    setTtResults([]);
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
          if (resJson.data) {
            const d = resJson.data;
            setTtResults((prev) => [
              ...prev,
              {
                url: d.url || currentUrl,
                views: d.views,
                likes: d.likes,
                comments: d.comments,
                shares: d.shares,
                saves: d.saves,
                author: d.author || "—",
                error: d.error,
              },
            ]);
          } else {
            setTtResults((prev) => [
              ...prev,
              {
                url: currentUrl,
                views: null,
                likes: null,
                comments: null,
                shares: null,
                saves: null,
                author: "—",
                error: resJson.error || "Extraction failed",
              },
            ]);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Request failed";
          setTtResults((prev) => [
            ...prev,
            {
              url: currentUrl,
              views: null,
              likes: null,
              comments: null,
              shares: null,
              saves: null,
              author: "—",
              error: msg,
            },
          ]);
        }

        if (i < urls.length - 1 && !abortTtRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 1150));
        }
      }
    } finally {
      setTtLoading(false);
      setTtProgress(null);
      setTtElapsed(+((performance.now() - start) / 1000).toFixed(2));
    }
  };

  // Immediate Garbage Collection Friendly Clear Handler
  const handleClear = () => {
    if (activeTab === "facebook") {
      setFbInput("");
      setFbResults([]);
      setFbElapsed(null);
    } else {
      setTtInput("");
      setTtResults([]);
      setTtElapsed(null);
      setTtProgress(null);
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

  // Helper to escape HTML characters
  const escapeHtml = (str: string) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // Write both rich text/html Table AND text/plain TSV to clipboard
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

  // Copy Author, Link, then the Numbers (Dual HTML Table + TSV for instant pasting into Sheets, Excel, Docs, Notion)
  const copyAuthorLinkNumbers = async (withHeaders: boolean) => {
    const isFb = activeTab === "facebook";
    const data = isFb ? filteredFb : filteredTt;
    if (data.length === 0) return;

    const headers = isFb
      ? ["Author", "Link", "Views", "Likes", "Comments", "Shares"]
      : ["Author", "Link", "Views", "Likes", "Comments", "Shares", "Saves"];

    const rawRows = isFb
      ? filteredFb.map((item) => ({
          author: item.author || "—",
          linkUrl: item.url,
          linkText: formatShortLink(item.url),
          nums: [
            item.views !== null ? item.views : 0,
            item.likes !== null ? item.likes : 0,
            item.comments !== null ? item.comments : 0,
            item.shares !== null ? item.shares : 0,
          ],
        }))
      : filteredTt.map((item) => ({
          author: item.author || "—",
          linkUrl: item.url,
          linkText: formatShortLink(item.url),
          nums: [
            item.views !== null ? item.views : 0,
            item.likes !== null ? item.likes : 0,
            item.comments !== null ? item.comments : 0,
            item.shares !== null ? item.shares : 0,
            item.saves !== null ? item.saves : 0,
          ],
        }));

    // TSV for spreadsheet cells
    const tsvRows = rawRows.map((r) => [r.author, r.linkUrl, ...r.nums.map(String)].join("\t"));
    const tsvContent = (withHeaders ? [headers.join("\t"), ...tsvRows] : tsvRows).join("\r\n");

    // HTML Table for rich text / documents / Google Sheets
    let htmlTable = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:13px;border:1px solid #cbd5e1;">`;
    if (withHeaders) {
      htmlTable += `<thead><tr style="background:#f1f5f9;font-weight:bold;">`;
      for (const h of headers) {
        const isNum = !["Author", "Link"].includes(h);
        htmlTable += `<th style="padding:6px 12px;border:1px solid #cbd5e1;${isNum ? "text-align:right;" : "text-align:left;"}">${escapeHtml(h)}</th>`;
      }
      htmlTable += `</tr></thead>`;
    }
    htmlTable += `<tbody>`;
    for (const r of rawRows) {
      htmlTable += `<tr>`;
      htmlTable += `<td style="padding:6px 12px;border:1px solid #cbd5e1;font-weight:500;">${escapeHtml(r.author)}</td>`;
      htmlTable += `<td style="padding:6px 12px;border:1px solid #cbd5e1;"><a href="${escapeHtml(r.linkUrl)}">${escapeHtml(r.linkText)}</a></td>`;
      for (const n of r.nums) {
        htmlTable += `<td style="padding:6px 12px;border:1px solid #cbd5e1;text-align:right;">${n.toLocaleString()}</td>`;
      }
      htmlTable += `</tr>`;
    }
    htmlTable += `</tbody></table>`;

    await writeDualClipboard(tsvContent, htmlTable);
    setCopiedType(withHeaders ? "headers" : "values");
    setTimeout(() => setCopiedType(null), 2000);
  };

  // Copy as Markdown Table (for Markdown docs, Obsidian, GitHub, chat)
  const copyMarkdownTable = async () => {
    const isFb = activeTab === "facebook";
    const data = isFb ? filteredFb : filteredTt;
    if (data.length === 0) return;

    const headers = isFb
      ? ["Author", "Link", "Views", "Likes", "Comments", "Shares"]
      : ["Author", "Link", "Views", "Likes", "Comments", "Shares", "Saves"];

    const rawRows = isFb
      ? filteredFb.map((item) => [
          item.author || "—",
          `[${formatShortLink(item.url)}](${item.url})`,
          item.views !== null ? item.views.toLocaleString() : "0",
          item.likes !== null ? item.likes.toLocaleString() : "0",
          item.comments !== null ? item.comments.toLocaleString() : "0",
          item.shares !== null ? item.shares.toLocaleString() : "0",
        ])
      : filteredTt.map((item) => [
          item.author || "—",
          `[${formatShortLink(item.url)}](${item.url})`,
          item.views !== null ? item.views.toLocaleString() : "0",
          item.likes !== null ? item.likes.toLocaleString() : "0",
          item.comments !== null ? item.comments.toLocaleString() : "0",
          item.shares !== null ? item.shares.toLocaleString() : "0",
          item.saves !== null ? item.saves.toLocaleString() : "0",
        ]);

    const headerLine = `| ${headers.join(" | ")} |`;
    const sepLine = `| ${headers.map((h) => (!["Author", "Link"].includes(h) ? "---:" : ":---")).join(" | ")} |`;
    const bodyLines = rawRows.map((r) => `| ${r.join(" | ")} |`);

    const mdContent = [headerLine, sepLine, ...bodyLines].join("\n");
    await navigator.clipboard.writeText(mdContent);
    setCopiedType("markdown");
    setTimeout(() => setCopiedType(null), 2000);
  };

  // Copy ONLY the numbers: Views, Likes, Comments, Shares, Saves
  const copyNumbersOnly = async () => {
    const isFb = activeTab === "facebook";
    const data = isFb ? filteredFb : filteredTt;
    if (data.length === 0) return;

    const numRows = isFb
      ? filteredFb.map((item) => [
          item.views !== null ? item.views : 0,
          item.likes !== null ? item.likes : 0,
          item.comments !== null ? item.comments : 0,
          item.shares !== null ? item.shares : 0,
        ])
      : filteredTt.map((item) => [
          item.views !== null ? item.views : 0,
          item.likes !== null ? item.likes : 0,
          item.comments !== null ? item.comments : 0,
          item.shares !== null ? item.shares : 0,
          item.saves !== null ? item.saves : 0,
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

  // Export to Excel
  const exportToExcel = () => {
    const isFb = activeTab === "facebook";
    const dataToExport = isFb
      ? fbResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          Views: r.views ?? 0,
          Likes: r.likes ?? 0,
          Comments: r.comments ?? 0,
          Shares: r.shares ?? 0,
        }))
      : ttResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          Views: r.views ?? 0,
          Likes: r.likes ?? 0,
          Comments: r.comments ?? 0,
          Shares: r.shares ?? 0,
          Saves: r.saves ?? 0,
        }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, isFb ? "Facebook" : "TikTok");
    XLSX.writeFile(workbook, `${isFb ? "facebook" : "tiktok"}_data.xlsx`);
  };

  // Export to CSV
  const exportToCsv = () => {
    const isFb = activeTab === "facebook";
    const dataToExport = isFb
      ? fbResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          Views: r.views ?? 0,
          Likes: r.likes ?? 0,
          Comments: r.comments ?? 0,
          Shares: r.shares ?? 0,
        }))
      : ttResults.map((r) => ({
          Author: r.author || "",
          Link: r.url,
          Views: r.views ?? 0,
          Likes: r.likes ?? 0,
          Comments: r.comments ?? 0,
          Shares: r.shares ?? 0,
          Saves: r.saves ?? 0,
        }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob(["\uFEFF" + csvOutput], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${isFb ? "facebook" : "tiktok"}_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
              High-speed serverless scraper for Facebook Reels &amp; TikTok videos
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
      </nav>

      {/* Input Section */}
      <section className="glass-card" aria-labelledby="input-section-title">
        <h2 id="input-section-title" className="card-title">
          {activeTab === "facebook" ? "📘 Input Facebook Video / Reel URLs" : "🎵 Input TikTok Video URLs"}
        </h2>
        <p className="card-subtitle">
          Paste links below (one per line). Extract Author, Link, and Numbers ready for Google Sheets.
        </p>

        {activeTab === "facebook" ? (
          <textarea
            id="fb-url-input"
            className="input-textarea"
            placeholder="https://www.facebook.com/reel/1075481022014849"
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
                    <span className="spinner"></span> Scraping {ttProgress ? `(${ttProgress.current}/${ttProgress.total})` : ""} ({timer}s)...
                  </>
                ) : (
                  <>🚀 Start TikTok Scraping</>
                )}
              </button>
            )}

            {activeTab === "tiktok" && ttLoading && (
              <button
                id="tt-stop-btn"
                className="btn-secondary"
                style={{ borderColor: "#ef4444", color: "#f87171" }}
                onClick={() => {
                  abortTtRef.current = true;
                }}
              >
                ⏹ Stop
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
              onClick={handleClear}
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

        {/* Live TikTok progress bar */}
        {activeTab === "tiktok" && ttLoading && ttProgress && (
          <div style={{ marginTop: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
              <span>Scraping TikTok data (rate-limit compliant)...</span>
              <span>
                <strong style={{ color: "var(--text-main)" }}>{ttProgress.current}</strong> / {ttProgress.total} (
                {Math.round((ttProgress.current / ttProgress.total) * 100)}%)
              </span>
            </div>
            <div style={{ width: "100%", height: "5px", backgroundColor: "#1e293b", borderRadius: "999px", overflow: "hidden" }}>
              <div
                style={{
                  width: `${(ttProgress.current / ttProgress.total) * 100}%`,
                  height: "100%",
                  backgroundColor: "#06b6d4",
                  transition: "width 0.25s ease",
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* KPI Stats Banner */}
      {((activeTab === "facebook" && (fbResults.length > 0 || fbLoading)) ||
        (activeTab === "tiktok" && (ttResults.length > 0 || ttLoading))) && (
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
                {(activeTab === "facebook" ? (fbElapsed !== null ? fbElapsed : timer) : (ttElapsed !== null ? ttElapsed : timer))}s
              </div>
              <div className="kpi-label">Total Elapsed Time</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon">⚡</div>
            <div>
              <div className="kpi-val">
                {(
                  ((activeTab === "facebook" ? (fbElapsed || timer) : (ttElapsed || timer)) || 0) /
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

      {/* Scraped Results Section */}
      {((activeTab === "facebook" && fbResults.length > 0) ||
        (activeTab === "tiktok" && ttResults.length > 0)) && (
        <section className="glass-card" aria-labelledby="results-title">
          <div className="results-header">
            <div>
              <h2 id="results-title" className="card-title">
                📊 Scraped {activeTab === "facebook" ? "Facebook" : "TikTok"} Data
              </h2>
              <p className="card-subtitle">
                Showing {(activeTab === "facebook" ? filteredFb : filteredTt).length} of{" "}
                {(activeTab === "facebook" ? fbResults : ttResults).length} items
              </p>
            </div>

            <div className="results-actions">
              <input
                id="search-input"
                type="text"
                placeholder="🔍 Search..."
                className="search-box"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <button
                id="copy-author-link-values-btn"
                className="btn-primary"
                onClick={() => copyAuthorLinkNumbers(false)}
                title="Copy formatted table (HTML + TSV) for Google Sheets, Excel, Notion, Docs"
                style={{ fontWeight: 600 }}
              >
                {copiedType === "values" ? "✅ Copied Table!" : "📋 Copy Table"}
              </button>

              <button
                id="copy-author-link-headers-btn"
                className="btn-secondary"
                onClick={() => copyAuthorLinkNumbers(true)}
                title="Copy table with header row"
              >
                {copiedType === "headers" ? "✅ Copied (+Headers)!" : "📋 Copy (+Headers)"}
              </button>

              <button
                id="copy-markdown-btn"
                className="btn-secondary"
                onClick={copyMarkdownTable}
                title="Copy as GitHub / Markdown table format"
              >
                {copiedType === "markdown" ? "✅ Copied Markdown!" : "📋 Markdown Table"}
              </button>

              <button
                id="copy-numbers-only-btn"
                className="btn-secondary"
                onClick={copyNumbersOnly}
                title="Copy ONLY numbers"
              >
                {copiedType === "numbers-only" ? "✅ Copied Numbers!" : "📋 Numbers Only"}
              </button>

              <button id="export-excel-btn" className="btn-secondary" onClick={exportToExcel}>
                📊 Excel
              </button>

              <button id="export-csv-btn" className="btn-secondary" onClick={exportToCsv}>
                📄 CSV
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            {activeTab === "facebook" ? (
              <table className="custom-table">
                <thead>
                  <tr>
                    <th style={{ width: "38px", textAlign: "center" }}>#</th>
                    <th style={{ width: "160px" }}>Author</th>
                    <th style={{ width: "310px" }}>Link</th>
                    <th className="th-num" style={{ width: "95px" }}>Views</th>
                    <th className="th-num" style={{ width: "85px" }}>Likes</th>
                    <th className="th-num" style={{ width: "85px" }}>Comments</th>
                    <th className="th-num" style={{ width: "85px" }}>Shares</th>
                    <th style={{ width: "auto" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFb.map((item, idx) => (
                    <tr key={item.url + idx}>
                      <td className="td-index">{idx + 1}</td>
                      <td className="table-author">{item.author || "—"}</td>
                      <td className="table-link" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="custom-table">
                <thead>
                  <tr>
                    <th style={{ width: "38px", textAlign: "center" }}>#</th>
                    <th style={{ width: "160px" }}>Author</th>
                    <th style={{ width: "310px" }}>Link</th>
                    <th className="th-num" style={{ width: "95px" }}>Views</th>
                    <th className="th-num" style={{ width: "85px" }}>Likes</th>
                    <th className="th-num" style={{ width: "85px" }}>Comments</th>
                    <th className="th-num" style={{ width: "85px" }}>Shares</th>
                    <th className="th-num" style={{ width: "85px" }}>Saves</th>
                    <th style={{ width: "auto" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTt.map((item, idx) => (
                    <tr key={item.url + idx}>
                      <td className="td-index">{idx + 1}</td>
                      <td className="table-author">{item.author || "—"}</td>
                      <td className="table-link" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                      <td></td>
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

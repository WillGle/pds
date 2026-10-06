# Social Pulse Analytics (Vercel Native)

A high-speed, serverless social media scraper and analytics dashboard for **Facebook Reels** and **TikTok Videos**, designed for 1-click deployment on **Vercel** with zero browser/Selenium overhead.

---

## ✨ Features

- **⚡ Zero-Browser Architecture**: Replaced heavy Selenium/Chromium headless instances with high-speed HTTP extractors running inside Vercel Serverless Functions.
- **🚀 Ultra Fast**: Scrapes 10–20 links in **1–2 seconds** (over **10x faster** than headless Chrome).
- **📘 Facebook Reels Scraper**: Extracts views, reaction counts, author name, video caption/description, release date, and direct thumbnail URLs via mobile OpenGraph metadata.
- **🎵 TikTok Scraper**: Resolves short links (`vt.tiktok.com`, `vm.tiktok.com`), retrieves views, likes, comments, shares, saves, total interactions, author, and thumbnails.
- **🏆 Top 5 Viral Showcase**: Automatically highlights the highest performing videos in interactive cards.
- **📊 Export Options**: 1-click export to formatted Excel (`.xlsx`), CSV (UTF-8 BOM), or raw JSON clipboard.
- **🎨 Glassmorphic Dark UI**: Premium design built with modern CSS tokens, responsive layout, search filter, and live timers.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, Turbopack, TypeScript)
- **Deployment Platform**: [Vercel](https://vercel.com/) (Serverless Node.js Runtime)
- **Styling**: Vanilla CSS with modern tokens & glassmorphism
- **Spreadsheet Generation**: SheetJS (`xlsx`)

---

## 🚀 Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🌐 Deploy to Vercel

### Method 1: Using the Vercel CLI
```bash
npm i -g vercel
vercel
```

### Method 2: Git Push to GitHub / GitLab / Bitbucket
1. Push this repository to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new).
3. Select your repository and click **Deploy**.
4. Vercel automatically detects Next.js and builds the serverless functions with zero configuration required!

---

## 🔌 API Reference

### 1. Facebook Scraper
- **Endpoint**: `POST /api/scrape/facebook`
- **Body**:
  ```json
  {
    "urls": [
      "https://www.facebook.com/reel/1075481022014849",
      "https://www.facebook.com/reel/1085809004361213"
    ]
  }
  ```

### 2. TikTok Scraper
- **Endpoint**: `POST /api/scrape/tiktok`
- **Body**:
  ```json
  {
    "urls": [
      "https://www.tiktok.com/@nawngs.vlog/video/7573658249547861268"
    ]
  }
  ```

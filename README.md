# Social Pulse Analytics (Vercel Native)

A high-speed, serverless social media scraper and analytics dashboard for **Facebook Reels**, **TikTok Videos**, and **YouTube Shorts & Videos**, designed for 1-click deployment on **Vercel** with rendered Facebook counters, HTTP-based TikTok extraction, and fast YouTube Innertube extraction.

---

## ✨ Features

- **Facebook counters**: Chromium reads rendered Watch views/comments and Reel shares. Reactions use Watch first, with Reel as fallback. Exact views must match the visible Watch counter; otherwise its compact label is retained and marked rounded in the table and exports. One URL is processed per serverless request; the UI processes the full list sequentially.
- **Posting dates**: Dates come from the target video timestamp and are displayed/exported in Vietnam time (UTC+7). Incomplete rows can be retried; copy/export waits for a complete table.
- **📘 Facebook Reels Scraper**: Extracts counts and posting dates from the requested video's rendered data, plus author, caption, and thumbnail metadata.
- **🎵 TikTok Scraper**: Resolves short links (`vt.tiktok.com`, `vm.tiktok.com`), retrieves views, likes, comments, shares, saves, total interactions, author, and thumbnails.
- **▶️ YouTube Scraper**: Supports standard videos, YouTube Shorts, and shortlinks (`youtu.be`). Extracts views, likes, exact comment count, author (channel name), and posting date (UTC+7) using lightweight serverless API calls.
- **📊 Export Options**: 1-click export to formatted Excel (`.xlsx`), CSV (UTF-8 BOM), or dual HTML/TSV clipboard for Google Sheets, Excel, Notion, and Docs.
- **🎨 Glassmorphic Dark UI**: Premium design built with modern CSS tokens, responsive layout, search filter, and live timers.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, Turbopack, TypeScript)
- **Deployment Platform**: [Vercel](https://vercel.com/) (Serverless Node.js Runtime)
- **Styling**: Vanilla CSS with modern tokens & glassmorphism
- **Spreadsheet Generation**: SheetJS (`xlsx`)

---

## 🚀 Local Development

Use Node.js 22. For local Facebook scraping, set `CHROME_EXECUTABLE_PATH` to an installed Chromium/Chrome executable. Vercel uses the bundled Chromium binary.

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

### 1. Facebook Video/Reels Scraper

- **Endpoint**: `POST /api/scrape/facebook`
- **Body**:

  ```json
  {
    "urls": [
      "https://www.facebook.com/reel/1075481022014849"
    ]
  }
  ```

### 2. Facebook Comments Scraper (Multimodal Sentiment Analysis)

Trích xuất toàn bộ bình luận dưới bài viết (bao gồm cả replies) thành bảng chuẩn 2 cột: `id` | `Comment`.

- **Endpoint**: `POST /api/scrape/facebook/comments` (hoặc `GET /api/scrape/facebook/comments?url=...&maxComments=100`)
- **Body**:

  ```json
  {
    "url": "https://www.facebook.com/zuck/posts/pfbid023Anbd22r92VQN9K23DGhd8t6WSK5g8S8cmjKvNogJEYhFQRwHSWdUz6sc5cJjPcYl",
    "maxComments": 100,
    "expandReplies": true,
    "format": "json" // tuỳ chọn: "json" (mặc định) | "csv" | "tsv"
  }
  ```

- **Output JSON** (Bảng 2 cột `id` | `Comment`):

  ```json
  [
    {
      "id": 1,
      "Comment": "Ten years of smoking meats! Proof that even in a world of artificial intelligence..."
    },
    {
      "id": 2,
      "Comment": "A decade of dedication and it shows in every bite and probably smelling like smoke for all 10 years"
    }
  ]
  ```

- **Output CSV** (`?format=csv` - Tải trực tiếp hoặc load vào Pandas):

  ```csv
  id,Comment
  1,"Ten years of smoking meats!..."
  2,"A decade of dedication..."
  ```

### 3. TikTok Video Scraper

- **Endpoint**: `POST /api/scrape/tiktok`
- **Body**:

  ```json
  {
    "urls": [
      "https://www.tiktok.com/@nawngs.vlog/video/7573658249547861268"
    ]
  }
  ```

### 4. TikTok Comments Scraper (Multimodal Sentiment Analysis)

Trích xuất toàn bộ bình luận dưới video TikTok (bao gồm cả replies) thành bảng chuẩn 2 cột: `id` | `Comment`.

- **Endpoint**: `POST /api/scrape/tiktok/comments` (hoặc `GET /api/scrape/tiktok/comments?url=...&maxComments=100`)
- **Body**:

  ```json
  {
    "url": "https://www.tiktok.com/@hoangnga_home/video/7691183589144202503",
    "maxComments": 100,
    "expandReplies": true,
    "format": "json" // tuỳ chọn: "json" (mặc định) | "csv" | "tsv"
  }
  ```

- **Output JSON** (Bảng 2 cột `id` | `Comment`):

  ```json
  [
    {
      "id": 1,
      "Comment": "giá mấy ạ?"
    },
    {
      "id": 2,
      "Comment": "Bạn ơi sàn nhà bạn làm gỗ hay sàn gạch vậy"
    }
  ]
  ```

- **Output CSV** (`?format=csv`):

  ```csv
  id,Comment
  1,"giá mấy ạ?"
  2,"Bạn ơi sàn nhà bạn làm gỗ hay sàn gạch vậy"
  ```

### 5. YouTube Scraper

- **Endpoint**: `POST /api/scrape/youtube`
- **Body**:

  ```json
  {
    "urls": [
      "https://www.youtube.com/shorts/LCIdTSsXFvU",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ]
  }
  ```

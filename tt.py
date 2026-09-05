import re
import time
import datetime
import requests
import pandas as pd


def sanitize_tiktok_url(url: str) -> str:
    """Clean tracking params and resolve short URLs (vt.tiktok.com, vm.tiktok.com, etc.)."""
    if not url:
        return ""
    url = url.strip()

    # Expand short links if needed
    if any(domain in url for domain in ["vt.tiktok.com", "vm.tiktok.com", "/t/"]):
        try:
            resp = requests.head(url, allow_redirects=True, timeout=8, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            if resp.url and "tiktok.com" in resp.url:
                url = resp.url
        except Exception:
            pass

    # Strip query parameters (?is_from_webapp=1&sender_device=pc...)
    if "?" in url:
        url = url.split("?")[0]
    return url.rstrip("/")


def extract_tiktok_id(url: str) -> str:
    """Extract numeric video ID from TikTok URL."""
    if not url:
        return ""
    m = re.search(r'/(?:video|v)/(\d+)', url)
    return m.group(1) if m else ""


def scrape_single_tiktok(url: str, max_retries: int = 4) -> dict:
    """
    Scrapes a single TikTok video URL using multi-tier extraction:
    - Tier 1: High-Speed TikWM API with automatic rate-limit backoff.
    - Tier 2: In-source HTML metadata regex fallback.
    Returns dictionary with all requested fields.
    """
    clean_url = sanitize_tiktok_url(url)
    data = {
        "url": url,
        "clean_url": clean_url,
        "View Count": None,
        "Like Count": None,
        "Comment Count": None,
        "Share Count": None,
        "Collection Count": None,
        "Release Time": "N/A",
        "Title": "",
        "Uploader": "",
        "Total Interaction Count": None,
        "Data Retrieval Time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "Error Message": "",
    }

    if not clean_url:
        data["Error Message"] = "Empty or invalid URL"
        return data

    # Tier 1: TikWM API with retry on rate limit
    for attempt in range(max_retries):
        try:
            api_url = f"https://www.tikwm.com/api/?url={clean_url}"
            resp = requests.get(api_url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            if resp.status_code == 200:
                res_json = resp.json()
                code = res_json.get("code")
                msg = res_json.get("msg", "")

                if code == 0:
                    d = res_json.get("data", {})
                    ts = d.get("create_time")
                    date_str = datetime.datetime.fromtimestamp(ts).strftime("%d/%m/%Y") if ts else "N/A"

                    views = d.get("play_count")
                    likes = d.get("digg_count")
                    comments = d.get("comment_count")
                    shares = d.get("share_count")
                    saves = d.get("collect_count")
                    total_interactions = sum([x for x in [likes, comments, shares, saves] if isinstance(x, (int, float))])

                    data.update({
                        "View Count": views,
                        "Like Count": likes,
                        "Comment Count": comments,
                        "Share Count": shares,
                        "Collection Count": saves,
                        "Release Time": date_str,
                        "Title": d.get("title", ""),
                        "Uploader": d.get("author", {}).get("nickname", ""),
                        "Total Interaction Count": total_interactions,
                        "Error Message": "",
                    })
                    return data
                elif "Free Api Limit" in msg:
                    time.sleep(1.3 * (attempt + 1))
                    continue
                else:
                    data["Error Message"] = msg
                    break
        except Exception as e:
            data["Error Message"] = str(e)
            time.sleep(1.0)

    # Tier 2 Fallback: Direct Web Fetch & Regex
    try:
        page_resp = requests.get(clean_url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        })
        if page_resp.status_code == 200:
            html = page_resp.text
            m_play = re.search(r'["\']playCount["\']:\s*(\d+)', html)
            m_digg = re.search(r'["\']diggCount["\']:\s*(\d+)', html)
            m_comm = re.search(r'["\']commentCount["\']:\s*(\d+)', html)
            m_share = re.search(r'["\']shareCount["\']:\s*(\d+)', html)
            m_save = re.search(r'["\']collectCount["\']:\s*(\d+)', html)
            m_time = re.search(r'["\']createTime["\']:\s*["\']?(\d{10})["\']?', html)

            if m_play and data["View Count"] is None:
                data["View Count"] = int(m_play.group(1))
            if m_digg and data["Like Count"] is None:
                data["Like Count"] = int(m_digg.group(1))
            if m_comm and data["Comment Count"] is None:
                data["Comment Count"] = int(m_comm.group(1))
            if m_share and data["Share Count"] is None:
                data["Share Count"] = int(m_share.group(1))
            if m_save and data["Collection Count"] is None:
                data["Collection Count"] = int(m_save.group(1))
            if m_time and data["Release Time"] == "N/A":
                data["Release Time"] = datetime.datetime.fromtimestamp(int(m_time.group(1))).strftime("%d/%m/%Y")

            if any(data[k] is not None for k in ["View Count", "Like Count", "Comment Count"]):
                data["Error Message"] = ""
    except Exception:
        pass

    return data


def scrape_tiktok_full_stats(urls: list, progress_bar=None, metrics_container=None) -> list:
    """
    Scrapes a list of TikTok URLs sequentially with rate-limit spacing (~1.15s)
    to comply with public endpoints and ensure 100% success rate.
    """
    clean_urls = list(dict.fromkeys([u.strip() for u in urls if u and u.strip()]))
    total = len(clean_urls)
    if total == 0:
        return []

    results = []
    start_time = time.time()

    for idx, u in enumerate(clean_urls):
        item = scrape_single_tiktok(u)
        results.append(item)

        completed = idx + 1
        elapsed = time.time() - start_time
        speed = elapsed / completed if completed > 0 else 0

        if progress_bar:
            progress_bar.progress(completed / total)

        if metrics_container:
            with metrics_container.container():
                import streamlit as st
                c1, c2, c3, c4 = st.columns(4)
                c1.metric("📋 Total Tasks", total)
                c2.metric("✅ Completed Tasks", f"{completed} / {total}")
                c3.metric("⏱️ Elapsed Time", f"{elapsed:.1f}s")
                c4.metric("⚡ Speed", f"{speed:.2f}s / task")

        if idx < total - 1:
            time.sleep(1.15)

    return results

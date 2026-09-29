"""Fetch official central-bank/government RSS headlines into Supabase."""

from __future__ import annotations

import email.utils
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser


FEEDS = (
    ("日本銀行", "https://www.boj.or.jp/rss/whatsnew.xml", True),
    ("財務省", "https://www.mof.go.jp/news.rss", True),
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_monetary.xml", False),
)
MAX_ITEMS_PER_FEED = 20
NOTIFY_WINDOW = timedelta(minutes=25)


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    parser = TextExtractor()
    parser.feed(value)
    text = html.unescape(" ".join(parser.parts))
    return re.sub(r"\s+", " ", text).strip()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(element: ET.Element, *names: str) -> str:
    wanted = {name.lower() for name in names}
    for child in element.iter():
        if child is element:
            continue
        if local_name(child.tag) in wanted and child.text:
            return child.text.strip()
    return ""


def item_link(element: ET.Element) -> str:
    for child in element:
        if local_name(child.tag) == "link":
            href = child.attrib.get("href")
            if href:
                return href.strip()
            if child.text:
                return child.text.strip()
    return child_text(element, "link")


def parse_date(value: str) -> str | None:
    if not value:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def fetch_feed(name: str, url: str, japanese: bool) -> list[dict]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "FXSokuhoPersonalDashboard/1.0", "Accept": "application/rss+xml, application/xml, text/xml"},
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        root = ET.fromstring(response.read())

    elements = [node for node in root.iter() if local_name(node.tag) in {"item", "entry"}]
    records: list[dict] = []
    for element in elements[:MAX_ITEMS_PER_FEED]:
        title = clean_text(child_text(element, "title"))
        link = item_link(element)
        if not title or not link.startswith("https://"):
            continue
        description = clean_text(child_text(element, "description", "summary", "encoded", "content"))
        published = child_text(element, "pubdate", "published", "updated", "date")
        records.append({
            "source": name,
            "title": title,
            "original_text": description[:1200] or None,
            "japanese_text": title if japanese else None,
            "summary": description[:1200] or None,
            "url": link,
            "published_at": parse_date(published),
            "category": "公式発表",
            "importance": None,
            "usd_jpy_impact": "未判定",
            "verified": False,
        })
    return records


def api_request(url: str, key: str, data: list[dict]) -> list[dict]:
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=representation",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = response.read()
    return json.loads(result.decode("utf-8")) if result else []


def send_telegram(token: str, chat_id: str, item: dict) -> None:
    message = "\n".join((
        f"📰 {item['source']} 公式速報",
        item["title"],
        f"公開日時：{item['published_at'] or '不明'}",
        item["url"],
        "ドル円への影響：未判定",
    ))
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": message}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not result.get("ok"):
        raise RuntimeError("Telegram API reported that the message was not sent")


def main() -> int:
    project_url = os.environ["SUPABASE_URL"].rstrip("/")
    secret_key = os.environ["SUPABASE_SECRET_KEY"]
    telegram_token = os.environ["TELEGRAM_BOT_TOKEN"]
    telegram_chat_id = os.environ["TELEGRAM_CHAT_ID"]
    now = datetime.now(timezone.utc)

    records: list[dict] = []
    failures: list[str] = []
    for name, url, japanese in FEEDS:
        try:
            records.extend(fetch_feed(name, url, japanese))
            print(f"{name}: feed fetched")
        except Exception as error:  # noqa: BLE001 - continue so one source cannot block all feeds
            failures.append(name)
            print(f"{name}: feed unavailable ({type(error).__name__})", file=sys.stderr)

    if not records and failures:
        raise RuntimeError("No official feeds could be read")

    rest_url = f"{project_url}/rest/v1/news_items?on_conflict=url"
    inserted = api_request(rest_url, secret_key, records) if records else []
    print(f"Supabase: {len(inserted)} new item(s) saved")

    cutoff = now - NOTIFY_WINDOW
    for item in inserted:
        published = parse_date(item.get("published_at") or "")
        if not published:
            continue
        published_at = datetime.fromisoformat(published.replace("Z", "+00:00"))
        if cutoff <= published_at <= now + timedelta(minutes=5):
            send_telegram(telegram_token, telegram_chat_id, item)
            print("Telegram: recent item sent")

    if failures:
        print(f"Some feeds were unavailable: {', '.join(failures)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as error:
        print(f"A service returned HTTP {error.code}; check configuration and permissions.", file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:  # noqa: BLE001 - avoid printing request details or secret-bearing URLs
        print(f"News update failed ({type(error).__name__}). Check Actions logs and settings.", file=sys.stderr)
        raise SystemExit(1)

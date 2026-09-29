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


def classify_release(source: str, title: str, description: str) -> tuple[int, str, str]:
    """Return a cautious keyword-based importance and USD/JPY direction estimate."""
    text = f"{title} {description}".lower()

    yen_strengthening = (
        "利上げ", "政策金利を引き上げ", "金利を引き上げ", "金融引き締め", "国債買入れ減額",
        "円買い介入", "為替介入", "yen-buying intervention", "intervention in the foreign exchange market",
        "raise interest rates", "rate hike", "increase the federal funds rate", "monetary tightening",
        "reduce bond purchases", "quantitative tightening",
    )
    yen_weakening = (
        "利下げ", "政策金利を引き下げ", "金利を引き下げ", "金融緩和", "国債買入れ増額",
        "円売り介入", "yen-selling intervention", "cut interest rates", "rate cut",
        "lower the federal funds rate", "monetary easing", "increase bond purchases",
        "quantitative easing",
    )
    high_impact_terms = (
        "金融政策決定会合", "政策金利", "利上げ", "利下げ", "為替介入", "円買い介入", "円売り介入",
        "fomc", "federal funds rate", "interest rate decision", "monetary policy decision",
        "rate hike", "rate cut", "yen-buying intervention", "yen-selling intervention",
        "intervention in the foreign exchange market",
    )

    # Rate decisions by the Fed move USD/JPY in the opposite direction to
    # equivalent BOJ/MOF actions; do not infer a direction from generic news.
    if any(term in text for term in yen_strengthening):
        if source == "Federal Reserve":
            return 5, "USD/JPY上昇しやすい（ドル高要因）", "金融政策"
        return 5, "USD/JPY下落しやすい（円高要因）", "金融政策・為替"
    if any(term in text for term in yen_weakening):
        if source == "Federal Reserve":
            return 5, "USD/JPY下落しやすい（ドル安要因）", "金融政策"
        return 5, "USD/JPY上昇しやすい（円安要因）", "金融政策・為替"
    if any(term in text for term in high_impact_terms):
        return 5, "方向は内容次第", "金融政策・為替"

    return 2, "方向は内容次第", "公式発表"


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
        importance, impact, category = classify_release(name, title, description)
        records.append({
            "source": name,
            "title": title,
            "original_text": description[:1200] or None,
            "japanese_text": title if japanese else None,
            "summary": description[:1200] or None,
            "url": link,
            "published_at": parse_date(published),
            "category": category,
            "importance": importance,
            "usd_jpy_impact": impact,
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
        f"重要度（キーワード仮判定）：{item.get('importance', '—')}/5",
        f"ドル円への影響目安：{item.get('usd_jpy_impact') or '方向は内容次第'}",
        "※見出し等に基づく簡易判定です。投資判断には使わず、原文をご確認ください。",
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

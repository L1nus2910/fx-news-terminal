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
from datetime import datetime, timezone
from html.parser import HTMLParser


BLOOMBERG_SEARCH = (
    "site:bloomberg.com/jp/news/articles (ドル円 OR USD/JPY OR 円相場 OR 為替介入 OR 円安 OR 円高 OR "
    "日銀 OR 日本銀行 OR 日銀会合 OR FRB OR FOMC OR パウエル OR 金融政策 OR 政策金利 OR 利上げ OR 利下げ OR "
    "米金利 OR 米雇用 OR 雇用統計 OR 非農業部門 OR 米インフレ OR 米CPI OR 米消費者物価 OR PCE OR "
    "米国債 OR 日本国債 OR 米財務省 OR 日米金融 OR 日米貿易 OR 米関税)"
)
BLOOMBERG_RSS = "https://news.google.com/rss/search?" + urllib.parse.urlencode({
    "q": BLOOMBERG_SEARCH,
    "hl": "ja",
    "gl": "JP",
    "ceid": "JP:ja",
})

FEEDS = (
    ("日本銀行", "https://www.boj.or.jp/rss/whatsnew.xml", True),
    ("財務省", "https://www.mof.go.jp/news.rss", True),
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_monetary.xml", False),
    ("FRB要人発言", "https://www.federalreserve.gov/feeds/speeches_and_testimony.xml", False),
    ("ブルームバーグ日本語", BLOOMBERG_RSS, True),
)
MAX_ITEMS_PER_FEED = 20


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
    major_data_terms = (
        "consumer price index", "core cpi", "cpi", "pce", "personal consumption expenditures",
        "nonfarm payroll", "payrolls", "employment situation", "unemployment rate", "jobless claims",
        "producer price index", "ppi", "gross domestic product", "gdp", "ism manufacturing",
        "ism services", "retail sales", "雇用統計", "非農業部門", "失業率", "失業保険",
        "消費者物価", "物価指数", "日銀短観", "鉱工業生産", "小売売上高", "機械受注",
    )

    # Rate decisions by the Fed move USD/JPY in the opposite direction to
    # equivalent BOJ/MOF actions; do not infer a direction from generic news.
    if "円買い介入" in text or "yen-buying intervention" in text:
        return 5, "USD/JPY下落しやすい（円買い要因）", "金融政策・為替"
    if "円売り介入" in text or "yen-selling intervention" in text:
        return 5, "USD/JPY上昇しやすい（円売り要因）", "金融政策・為替"
    if any(term in text for term in yen_strengthening):
        if source in {"Federal Reserve", "FRB要人発言"}:
            return 5, "USD/JPY上昇しやすい（ドル高要因）", "金融政策"
        if source in {"日本銀行", "財務省"}:
            return 5, "USD/JPY下落しやすい（円高要因）", "金融政策・為替"
        return 5, "方向は記事の文脈次第", "金融政策・為替"
    if any(term in text for term in yen_weakening):
        if source in {"Federal Reserve", "FRB要人発言"}:
            return 5, "USD/JPY下落しやすい（ドル安要因）", "金融政策"
        if source in {"日本銀行", "財務省"}:
            return 5, "USD/JPY上昇しやすい（円安要因）", "金融政策・為替"
        return 5, "方向は記事の文脈次第", "金融政策・為替"
    if any(term in text for term in high_impact_terms):
        return 5, "方向は内容次第", "金融政策・為替"
    if any(term in text for term in major_data_terms):
        return 4, "発表内容次第（変動注意）", "重要経済指標"

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
        # Google News RSS is only a discovery layer here; store Bloomberg's
        # headline and link, not its excerpt, to keep the dashboard lightweight.
        if name == "ブルームバーグ日本語":
            description = ""
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


def main() -> int:
    project_url = os.environ["SUPABASE_URL"].rstrip("/")
    secret_key = os.environ["SUPABASE_SECRET_KEY"]

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

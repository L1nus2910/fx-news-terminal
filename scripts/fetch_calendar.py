"""Poll the economic calendar (US / Japan / Australia) and publish it as JSON.

GitHub Actions から一定時間ループで実行し、TradingView の経済指標カレンダーを取得して
`data` ブランチの calendar.json に書き出す（サイトはそれを読み込む）。
重要度「高」の指標は、Telegram の設定があれば発表前と結果を通知する。
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TV_URL = "https://economic-calendar.tradingview.com/events"
X_LIST_ID = os.environ.get("X_LIST_ID", "2104983692594839644")
X_INTERVAL = 120        # Xリストの取得間隔（秒）
COUNTRIES = ("US", "JP", "AU")
DATA_DIR = Path(os.environ.get("DATA_DIR", "data-out"))
RUN_SECONDS = int(os.environ.get("RUN_SECONDS", "0"))  # 0 = 1回だけ
FAST_INTERVAL = 60      # 重要指標の前後
SLOW_INTERVAL = 240     # それ以外
HEARTBEAT = 10 * 60     # 内容が変わらなくても、この間隔で更新時刻を書き出す

FLAGS = {"US": "🇺🇸", "JP": "🇯🇵", "AU": "🇦🇺"}
PREFIX = {"US": "米", "JP": "日本", "AU": "豪"}

# ---------------------------------------------------------------------------
# 日本語名
# ---------------------------------------------------------------------------
NAME_RULES: list[tuple[str, str]] = [
    (r"gdpnow", "アトランタ連銀GDPNow"),
    (r"tokyo cpi ex[- ]food and energy", "東京都区部コアコアCPI"),
    (r"ex[- ]food and energy", "コアコアCPI"),
    (r"tokyo core cpi", "東京都区部コアCPI"),
    (r"tokyo (cpi|inflation)", "東京都区部CPI"),
    (r"core pce", "コアPCEデフレーター"),
    (r"\bpce price|pce index", "PCEデフレーター"),
    (r"personal (income|spending)", "個人所得・支出"),
    (r"non[ -]?farm payrolls?", "雇用統計（非農業部門雇用者数）"),
    (r"adp employment", "ADP雇用者数"),
    (r"average hourly earnings", "平均時給"),
    (r"unemployment rate", "失業率"),
    (r"employment change", "雇用者数（増減）"),
    (r"participation rate", "労働参加率"),
    (r"(initial )?jobless claims", "新規失業保険申請件数"),
    (r"continuing jobless", "失業保険継続受給者数"),
    (r"jolts", "JOLTS求人件数"),
    (r"monthly cpi indicator", "月次CPI"),
    (r"trimmed mean cpi", "トリム平均CPI"),
    (r"weighted median cpi", "加重中央値CPI"),
    (r"core (inflation|cpi)", "コアCPI"),
    (r"(inflation rate|cpi)", "消費者物価指数（CPI）"),
    (r"ppi|producer price", "生産者物価指数（PPI）"),
    (r"wage price index", "賃金価格指数"),
    (r"(fed|fomc) interest rate decision|fed funds", "FOMC政策金利"),
    (r"(fomc|fed) press conference", "FOMC議長会見"),
    (r"fomc minutes", "FOMC議事要旨"),
    (r"boj interest rate decision|boj policy rate", "日銀政策金利"),
    (r"boj press conference", "日銀総裁会見"),
    (r"boj summary of opinions", "日銀主な意見"),
    (r"boj monetary policy statement", "日銀金融政策声明"),
    (r"rba interest rate decision|rba (cash )?rate", "RBA政策金利"),
    (r"rba press conference", "RBA総裁会見"),
    (r"rba (meeting )?minutes", "RBA議事要旨"),
    (r"rba statement on monetary policy", "RBA金融政策報告"),
    (r"retail sales", "小売売上高"),
    (r"gdp", "GDP"),
    (r"ism manufacturing", "ISM製造業景況指数"),
    (r"ism services|ism non-manufacturing", "ISM非製造業景況指数"),
    (r"(s&p global|judo bank|au jibun bank)?.*manufacturing pmi", "製造業PMI"),
    (r"(s&p global|judo bank|au jibun bank)?.*services pmi", "サービス業PMI"),
    (r"michigan consumer sentiment", "ミシガン大消費者信頼感"),
    (r"cb consumer confidence", "コンファレンスボード消費者信頼感"),
    (r"westpac consumer confidence", "ウエストパック消費者信頼感"),
    (r"nab business confidence", "NAB企業信頼感"),
    (r"durable goods", "耐久財受注"),
    (r"housing starts", "住宅着工件数"),
    (r"building permits", "建設許可件数"),
    (r"existing home sales", "中古住宅販売件数"),
    (r"new home sales", "新築住宅販売件数"),
    (r"industrial production", "鉱工業生産"),
    (r"tankan", "日銀短観"),
    (r"household spending", "家計支出"),
    (r"machinery orders", "機械受注"),
    (r"trade balance", "貿易収支"),
    (r"current account", "経常収支"),
    (r"balance of trade", "貿易収支"),
    (r"chicago pmi", "シカゴPMI"),
    (r"midterm elections", "中間選挙"),
    (r"^consumer confidence", "消費者態度指数"),
    (r"import prices", "輸入物価指数"),
    (r"export prices", "輸出物価指数"),
    (r"capacity utilization", "設備稼働率"),
    (r"manufacturing production", "製造業生産"),
    (r"nahb", "NAHB住宅市場指数"),
    (r"composite pmi", "総合PMI"),
    (r"(\d+)-(week|month|year) bill auction", "短期国債入札"),
    (r"bond auction|note auction|jgb auction", "国債入札"),
    (r"eia crude oil stocks", "EIA原油在庫"),
    (r"api crude oil", "API原油在庫"),
    (r"mba mortgage applications", "MBA住宅ローン申請件数"),
    (r"tertiary industry", "第3次産業活動指数"),
    (r"tic flows", "対米証券投資"),
    (r"monthly budget statement", "月次財政収支"),
    (r"(\w+) speech|speaks", "要人発言"),
]
SUFFIX_RULES = [(r"4-week average", "（4週平均）"), (r"\byoy\b", "（前年比）"), (r"\bmom\b", "（前月比）"), (r"\bqoq\b", "（前期比）")]
SPEAKERS = [
    (r"warsh", "ウォーシュFRB議長"), (r"powell", "パウエル氏"), (r"jefferson", "ジェファーソンFRB副議長"),
    (r"bowman", "ボウマンFRB副議長"), (r"waller", "ウォラーFRB理事"), (r"williams", "ウィリアムズNY連銀総裁"),
    (r"ueda", "植田日銀総裁"), (r"himino", "氷見野日銀副総裁"), (r"uchida", "内田日銀副総裁"),
    (r"bullock", "ブロックRBA総裁"), (r"hauser", "ハウザーRBA副総裁"),
]


def japanese_title(country: str, title: str) -> str:
    low = title.lower()
    if re.search(r"speech|speaks|testimony|testifies", low):
        for pattern, name in SPEAKERS:
            if re.search(pattern, low):
                return f"{name} 発言"
        m = re.search(r"\b(fed|rba|boj)\b(?: chair| governor| deputy governor| vice chair)? ([a-z]+)", low)
        if m:
            org = {"fed": "FRB", "rba": "RBA", "boj": "日銀"}[m.group(1)]
            return f"{org} {m.group(2).capitalize()}氏 発言"
    for pattern, name in NAME_RULES:
        if re.search(pattern, low):
            if name in {"要人発言"}:
                break
            prefix = "" if name.startswith(("FOMC", "日銀", "RBA", "東京", "ADP", "JOLTS", "ISM", "ミシガン", "コンファレンス", "ウエストパック", "NAB", "アトランタ", "EIA", "API", "MBA", "シカゴ")) else PREFIX.get(country, "")
            suffix = next((s for p, s in SUFFIX_RULES if re.search(p, low)), "")
            return f"{prefix}{name}{suffix}"
    return title


# ---------------------------------------------------------------------------
# 重要度（3=高 / 2=中 / 1=低）
# ---------------------------------------------------------------------------
TOP = re.compile(
    r"interest rate decision|fed funds|non[ -]?farm|unemployment rate|employment change"
    r"|inflation rate|\bcpi\b|core pce|pce price|fomc press|fed press conference|boj press|rba press|monthly cpi indicator|trimmed mean"
)
SECOND = re.compile(
    r"ppi|producer price|retail sales|gdp|ism |pmi|jobless claims|jolts|adp|wage price|average hourly"
    r"|consumer confidence|consumer sentiment|business confidence|minutes|summary of opinions|tankan"
    r"|trade balance|balance of trade|durable goods|speech|speaks|testimony|statement on monetary|household spending"
)


def level_of(country: str, title: str, importance: int | None) -> int:
    low = title.lower()
    if re.search(r"gdpnow|4-week average|weekly|bill auction|auction|eia |api |mba |baker hughes|redbook|balance sheet|reserve balances", low):
        return 1
    if "employment change" in low and country != "AU" and "non farm" not in low:
        return 2
    if country in COUNTRIES and TOP.search(low) and not re.search(r"\bfinal\b|revised", low):
        # 日本の失業率・雇用は相場への影響が比較的小さいため「中」
        if country == "JP" and re.search(r"unemployment|employment", low):
            return 2
        return 3
    if country in COUNTRIES and SECOND.search(low):
        return 2
    if importance == 1:
        return 2
    return 1


# ---------------------------------------------------------------------------
# 値の整形
# ---------------------------------------------------------------------------
def fmt_value(value, unit: str | None, scale: str | None) -> str | None:
    if value is None or value == "":
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return str(value)
    text = f"{num:,.3f}".rstrip("0").rstrip(".") if abs(num) < 1000 else f"{num:,.1f}".rstrip("0").rstrip(".")
    if unit in ("$", "¥", "A$", "€", "£"):
        sign = "-" if text.startswith("-") else ""
        return f"{sign}{unit}{text.lstrip('-')}{scale or ''}"
    return f"{text}{scale or ''}{unit or ''}"


def surprise(actual, forecast) -> str | None:
    try:
        a = float(actual)
        f = float(forecast)
    except (TypeError, ValueError):
        return None
    if abs(a - f) < 1e-9:
        return "inline"
    return "up" if a > f else "down"


def fetch_tradingview() -> list[dict]:
    now = dt.datetime.now(dt.timezone.utc)
    params = {
        "from": (now - dt.timedelta(days=3)).strftime("%Y-%m-%dT00:00:00.000Z"),
        "to": (now + dt.timedelta(days=15)).strftime("%Y-%m-%dT00:00:00.000Z"),
        "countries": ",".join(COUNTRIES),
    }
    request = urllib.request.Request(
        f"{TV_URL}?{urllib.parse.urlencode(params)}",
        headers={
            "Origin": "https://www.tradingview.com",
            "Referer": "https://www.tradingview.com/",
            "User-Agent": "Mozilla/5.0 (FXSokuhoPersonalDashboard)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        payload = json.loads(response.read())
    rows = payload.get("result", payload) if isinstance(payload, dict) else payload
    events = []
    for row in rows or []:
        country = (row.get("country") or "").upper()
        if country not in COUNTRIES:
            continue
        title = row.get("title") or row.get("indicator") or "Event"
        unit, scale = row.get("unit"), row.get("scale")
        forecast_raw = row.get("forecast") if row.get("forecast") is not None else row.get("teForecast")
        events.append({
            "id": str(row.get("id") or f"{country}-{title}-{row.get('date')}"),
            "country": country,
            "title": title,
            "title_ja": japanese_title(country, title),
            "period": row.get("period") or None,
            "date": row.get("date"),
            "actual": fmt_value(row.get("actual"), unit, scale),
            "forecast": fmt_value(forecast_raw, unit, scale),
            "forecast_is_te": row.get("forecast") is None and row.get("teForecast") is not None,
            "previous": fmt_value(row.get("previous"), unit, scale),
            "surprise": surprise(row.get("actual"), forecast_raw),
            "level": level_of(country, title, row.get("importance")),
            "source": row.get("source") or None,
            "source_url": row.get("source_url") if str(row.get("source_url") or "").startswith("https://") else None,
        })
    events.sort(key=lambda e: e["date"] or "")
    mark_primary(events)
    return events


# 同じ時刻にまとめて出る指標（例：豪CPIは10本以上）から、見出しにする1本を選ぶ
PRIMARY_ORDER = [
    r"interest rate decision", r"non[ -]?farm payrolls$", r"unemployment rate", r"employment change$",
    r"core pce price index mom", r"core inflation rate mom", r"^inflation rate yoy", r"quarterly inflation rate yoy",
    r"monthly cpi indicator", r"tokyo core cpi yoy", r"core inflation rate yoy", r"inflation rate mom", r"trimmed mean cpi qoq",
    r"retail sales mom$", r"gdp growth rate qoq", r"ism manufacturing pmi$", r"ism services pmi$", r"initial jobless claims$",
]


def mark_primary(events: list[dict]) -> None:
    groups: dict[tuple, list[dict]] = {}
    for event in events:
        event["primary"] = True
        event["group_size"] = 1
        if event["level"] >= 2 and event["date"]:
            groups.setdefault((event["country"], event["date"][:16]), []).append(event)
    for members in groups.values():
        if len(members) < 2:
            continue
        def rank(e: dict) -> tuple:
            low = e["title"].lower()
            pos = next((i for i, p in enumerate(PRIMARY_ORDER) if re.search(p, low)), len(PRIMARY_ORDER))
            return (-e["level"], pos)
        best = min(members, key=rank)
        for e in members:
            e["primary"] = e is best
        best["group_size"] = len(members)


# ---------------------------------------------------------------------------
# X の公開リスト（埋め込み用の公開データから最新投稿を取得）
# ---------------------------------------------------------------------------
def fetch_x_list() -> list[dict]:
    url = f"https://syndication.twitter.com/srv/timeline-list/list-id/{X_LIST_ID}?dnt=true&lang=ja"
    request = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
        "Accept-Language": "ja,en;q=0.8",
    })
    with urllib.request.urlopen(request, timeout=25) as response:
        html = response.read().decode("utf-8", "replace")
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not match:
        raise ValueError(f"timeline data not found (len={len(html)}) {html[:160]!r}")
    data = json.loads(match.group(1))
    entries = data.get("props", {}).get("pageProps", {}).get("timeline", {}).get("entries", [])
    posts = []
    for entry in entries:
        tweet = (entry.get("content") or {}).get("tweet") or {}
        if not tweet.get("id_str"):
            continue
        retweet = tweet.get("retweeted_status")
        body = retweet or tweet
        text = body.get("full_text") or body.get("text") or ""
        for link in (body.get("entities") or {}).get("urls", []):
            if link.get("url") and link.get("expanded_url"):
                text = text.replace(link["url"], link["expanded_url"])
        media = ((body.get("extended_entities") or body.get("entities") or {}).get("media") or [])
        for item in media:
            if item.get("url"):
                text = text.replace(item["url"], "").strip()
        user = tweet.get("user") or {}
        original = body.get("user") or {}
        created = body.get("created_at") or tweet.get("created_at")
        try:
            created_iso = dt.datetime.strptime(created, "%a %b %d %H:%M:%S %z %Y").astimezone(dt.timezone.utc).isoformat()
        except (TypeError, ValueError):
            created_iso = None
        posts.append({
            "id": tweet["id_str"],
            "text": html_unescape(text),
            "name": original.get("name") or user.get("name"),
            "handle": original.get("screen_name") or user.get("screen_name"),
            "avatar": original.get("profile_image_url_https"),
            "retweeted_by": user.get("name") if retweet else None,
            "created_at": created_iso,
            "image": next((m.get("media_url_https") for m in media if m.get("type") == "photo"), None),
            "url": f"https://x.com/{original.get('screen_name') or user.get('screen_name')}/status/{body.get('id_str') or tweet['id_str']}",
        })
    return posts[:80]


def html_unescape(text: str) -> str:
    import html as _html
    return _html.unescape(text)


# ---------------------------------------------------------------------------
# Telegram 通知（任意）
# ---------------------------------------------------------------------------
def jst(iso: str) -> str:
    t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(dt.timezone(dt.timedelta(hours=9)))
    return t.strftime("%m/%d %H:%M")


def send_telegram(text: str) -> bool:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat or os.environ.get("TELEGRAM_ALERTS", "on").lower() == "off":
        return False
    data = urllib.parse.urlencode({"chat_id": chat, "text": text, "disable_web_page_preview": "true"}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data), timeout=20) as response:
            return bool(json.loads(response.read()).get("ok"))
    except Exception:  # noqa: BLE001 - 通知失敗でデータ更新を止めない
        print("Telegram: send failed", file=sys.stderr)
        return False


def alerts(events: list[dict], state: dict) -> bool:
    now = dt.datetime.now(dt.timezone.utc)
    changed = False
    for event in events:
        if event["level"] < 3 or not event["date"]:
            continue
        when = dt.datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
        flag = FLAGS.get(event["country"], "")
        key_pre, key_res = f"pre:{event['id']}", f"res:{event['id']}"
        minutes = (when - now).total_seconds() / 60
        if 0 < minutes <= 16 and key_pre not in state:
            text = f"⏰ まもなく発表（{jst(event['date'])}）\n{flag} {event['title_ja']}\n予想 {event['forecast'] or '—'} ／ 前回 {event['previous'] or '—'}"
            if send_telegram(text):
                state[key_pre] = now.isoformat()
                changed = True
        if event["actual"] and -180 <= minutes <= 0 and key_res not in state:
            mark = {"up": "▲ 予想より上振れ", "down": "▼ 予想より下振れ", "inline": "＝ 予想通り"}.get(event["surprise"] or "", "")
            text = f"📊 結果発表 {flag} {event['title_ja']}\n結果 {event['actual']}（予想 {event['forecast'] or '—'} ／ 前回 {event['previous'] or '—'}）\n{mark}".strip()
            if send_telegram(text):
                state[key_res] = now.isoformat()
                changed = True
    cutoff = (now - dt.timedelta(days=7)).isoformat()
    for key in [k for k, v in state.items() if v < cutoff]:
        del state[key]
        changed = True
    return changed


# ---------------------------------------------------------------------------
# data ブランチへの書き出し
# ---------------------------------------------------------------------------
def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=DATA_DIR, capture_output=True, text=True)


def publish(message: str) -> None:
    git("add", "-A")
    if git("diff", "--cached", "--quiet").returncode == 0:
        return
    has_head = git("rev-parse", "--verify", "HEAD").returncode == 0
    commit = git("commit", "-q", "--amend", "-m", message) if has_head else git("commit", "-q", "-m", message)
    if commit.returncode != 0:
        print("git commit failed", file=sys.stderr)
        return
    push = git("push", "-q", "-f", "origin", "HEAD:data")
    print("pushed" if push.returncode == 0 else "push failed", flush=True)


def interval_for(events: list[dict]) -> int:
    now = dt.datetime.now(dt.timezone.utc)
    for event in events:
        if event["level"] < 2 or not event["date"]:
            continue
        minutes = (dt.datetime.fromisoformat(event["date"].replace("Z", "+00:00")) - now).total_seconds() / 60
        if -30 <= minutes <= 20 and not (event["actual"] and minutes < -5):
            return FAST_INTERVAL
    return SLOW_INTERVAL


def main() -> int:
    DATA_DIR.mkdir(exist_ok=True)
    cal_path, state_path = DATA_DIR / "calendar.json", DATA_DIR / "alerts_state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    last_events_json, last_write = None, 0.0
    if cal_path.exists():
        try:
            last_events_json = json.dumps(json.loads(cal_path.read_text()).get("events"), sort_keys=True)
        except ValueError:
            pass

    x_path = DATA_DIR / "x_list.json"
    last_x_fetch, last_x_json = 0.0, None

    started = time.monotonic()
    failures = 0
    while True:
        if time.monotonic() - last_x_fetch >= X_INTERVAL:
            last_x_fetch = time.monotonic()
            try:
                posts = fetch_x_list()
                posts_json = json.dumps(posts, sort_keys=True)
                if posts and posts_json != last_x_json:
                    x_path.write_text(json.dumps({"updated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "list_id": X_LIST_ID, "posts": posts}, ensure_ascii=False, indent=1))
                    publish("Xリストを更新")
                    last_x_json = posts_json
                    print(f"x: {len(posts)} posts written", flush=True)
            except Exception as error:  # noqa: BLE001 - Xが取れなくても指標の取得は続ける
                detail = f"{type(error).__name__}: {getattr(error, 'code', '')} {str(error)[:200]}"
                print(f"x list fetch failed ({detail})", file=sys.stderr, flush=True)
                (DATA_DIR / "x_status.json").write_text(json.dumps({"checked_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "error": detail}, ensure_ascii=False))
                publish("Xリストの取得状況")

        events = None
        try:
            events = fetch_tradingview()
            failures = 0
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"calendar fetch failed ({type(error).__name__})", file=sys.stderr, flush=True)

        if events is not None:
            events_json = json.dumps(events, sort_keys=True)
            changed = events_json != last_events_json
            state_changed = alerts(events, state)
            if changed or state_changed or time.monotonic() - last_write > HEARTBEAT:
                cal_path.write_text(json.dumps({
                    "source": "TradingView Economic Calendar",
                    "countries": list(COUNTRIES),
                    "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                    "events": events,
                }, ensure_ascii=False, indent=1))
                state_path.write_text(json.dumps(state, indent=1))
                publish("経済指標を更新")
                last_events_json, last_write = events_json, time.monotonic()
                print(f"{len(events)} events written (changed={changed})", flush=True)
            wait = min(interval_for(events), X_INTERVAL)
        else:
            wait = SLOW_INTERVAL if failures < 3 else SLOW_INTERVAL * 2

        if not RUN_SECONDS or time.monotonic() - started + wait > RUN_SECONDS:
            break
        time.sleep(wait)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

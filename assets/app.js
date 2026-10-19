/* =========================================================
   FX速報 AI — app script
   ========================================================= */
"use strict";

const SUPABASE_URL = "https://swmbphjtvtkjrnvkytxw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_y2K68m77MF9DYV55qFQorg_nC6DflY4";
const X_LIST_ID = "2104983692594839644";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function icon(id, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (cls) svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}
function safeUrl(value) {
  return typeof value === "string" && /^https:\/\//i.test(value) ? value : "";
}
function store(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 容量不足などは無視 */ }
}

const JST = "Asia/Tokyo";
const fmtTime = new Intl.DateTimeFormat("ja-JP", { timeZone: JST, hour: "2-digit", minute: "2-digit" });
const fmtMD = new Intl.DateTimeFormat("ja-JP", { timeZone: JST, month: "numeric", day: "numeric" });
const fmtDayKey = new Intl.DateTimeFormat("en-CA", { timeZone: JST, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtWeek = new Intl.DateTimeFormat("ja-JP", { timeZone: JST, weekday: "short" });
const dayKey = d => fmtDayKey.format(d);

function relTime(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
  return fmtMD.format(date);
}

let toastTimer;
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2400);
}

/* =========================================================
   テーマ
   ========================================================= */
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const theme = {
  get setting() { return document.documentElement.dataset.theme || "auto"; },
  get effective() {
    const s = this.setting;
    return s === "auto" ? (darkQuery.matches ? "dark" : "light") : s;
  },
  set(value) {
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem("fx-theme", value); } catch {}
    this.sync();
    widgets.rethemeAll();
  },
  sync() {
    const dark = this.effective === "dark";
    document.documentElement.classList.toggle("is-dark", dark);
    $("#theme-toggle").setAttribute("aria-label", dark ? "ライトモードに切り替え" : "ダークモードに切り替え");
    $$("#theme-seg button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.value === this.setting)));
    $$('meta[name="theme-color"]').forEach(m => m.setAttribute("content", dark ? "#0C1322" : "#EEF2F7"));
  }
};
$("#theme-toggle").addEventListener("click", () => {
  theme.set(theme.effective === "dark" ? "light" : "dark");
  toast(theme.effective === "dark" ? "ダークモードにしました" : "ライトモードにしました");
});
darkQuery.addEventListener("change", () => {
  if (theme.setting === "auto") { theme.sync(); widgets.rethemeAll(); }
});
segmented($("#theme-seg"), value => theme.set(value));

/* セグメントボタン共通 */
function segmented(group, onChange) {
  group.addEventListener("click", event => {
    const button = event.target.closest("button[role=radio]");
    if (!button) return;
    setSeg(group, button.dataset.value);
    onChange(button.dataset.value);
  });
}
function setSeg(group, value) {
  $$("button[role=radio]", group).forEach(b => b.setAttribute("aria-checked", String(b.dataset.value === value)));
}
function segValue(group) {
  return $('button[aria-checked="true"]', group)?.dataset.value || "all";
}

/* =========================================================
   TradingView / X ウィジェット
   ========================================================= */
const loadedScripts = new Map();
function loadScript(src, { module = false } = {}) {
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    if (module) s.type = "module";
    s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
  loadedScripts.set(src, promise);
  promise.catch(() => loadedScripts.delete(src));
  return promise;
}

const widgets = {
  marketShown: false,
  chartShown: false,
  xShown: false,
  chartSymbol: store("fx-chart-symbol", "FX:USDJPY"),

  ticker() {
    const host = $("#ticker-host");
    const pairs = [["FX:USDJPY", "USD/JPY"], ["FX:AUDJPY", "AUD/JPY"], ["FX:AUDUSD", "AUD/USD"]];
    host.replaceChildren(...pairs.map(([symbol, label]) => {
      const chart = document.createElement("tv-mini-chart");
      chart.setAttribute("symbol", symbol);
      chart.setAttribute("theme", theme.effective);
      chart.setAttribute("transparent", "");
      chart.setAttribute("line-chart-type", "Baseline");
      chart.setAttribute("time-frame", "1D");
      chart.setAttribute("locale", "ja");
      return el("div", { class: "rate-card" }, chart,
        el("a", { class: "rate-link", href: `#/chart?symbol=${encodeURIComponent(symbol)}`, "aria-label": `${label}のチャートを開く` }));
    }));
    loadScript("https://widgets.tradingview-widget.com/w/en/tv-mini-chart.js", { module: true })
      .catch(() => host.replaceChildren(el("a", { href: "https://www.tradingview.com/symbols/USDJPY/", target: "_blank", rel: "noopener noreferrer", class: "block-link rate-fallback", text: "レートを読み込めません。TradingViewで開く" })));
  },

  market() {
    this.marketShown = true;
    const host = $("#forex-table-host");
    $("#market-status").textContent = "読み込んでいます";
    loadScript("https://widgets.tradingview-widget.com/w/en/tv-forex-table.js", { module: true })
      .then(() => {
        const table = document.createElement("tv-forex-table");
        table.setAttribute("displayed-value", "dailyChange");
        table.setAttribute("heatmap", "");
        table.setAttribute("theme", theme.effective);
        table.setAttribute("force-theme", "");
        table.setAttribute("transparent", "");
        table.setAttribute("locale", "ja");
        host.replaceChildren(table);
        $("#market-status").textContent = "前日比のヒートマップ";
      })
      .catch(() => {
        host.replaceChildren(el("div", { class: "empty" },
          el("strong", { text: "通貨強弱を読み込めませんでした" }),
          "通信環境を確認するか、TradingViewで直接開いてください。",
          el("br"),
          el("a", { class: "ghost-btn", href: "https://www.tradingview.com/heatmap/forex/", target: "_blank", rel: "noopener noreferrer" }, icon("i-ext"), "TradingViewで開く")));
        $("#market-status").textContent = "読み込めませんでした";
      });
  },

  chart() {
    this.chartShown = true;
    const host = $("#chart-host");
    const box = el("div", { class: "tradingview-widget-container" }, el("div", { class: "tradingview-widget-container__widget", style: "height:100%;width:100%" }));
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    const dark = theme.effective === "dark";
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: this.chartSymbol,
      interval: "15",
      timezone: "Asia/Tokyo",
      theme: theme.effective,
      style: "1",
      locale: "ja",
      backgroundColor: dark ? "#141E33" : "#FFFFFF",
      gridColor: dark ? "rgba(125,139,162,0.12)" : "rgba(20,32,46,0.06)",
      allow_symbol_change: true,
      hide_volume: true,
      calendar: false,
      support_host: "https://www.tradingview.com"
    });
    box.append(script);
    host.replaceChildren(box);
    setSeg($("#pair-chips"), null);
    $$("#pair-chips button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.symbol === this.chartSymbol)));
  },

  x() {
    this.xShown = true;
    const host = $("#x-timeline");
    host.replaceChildren(el("div", { class: "empty", text: "リストの投稿を読み込んでいます…" }));
    const fail = () => host.replaceChildren(el("div", { class: "empty" },
      el("strong", { text: "タイムラインを表示できませんでした" }),
      "ブラウザの設定や拡張機能（広告ブロックなど）で埋め込みが止められている可能性があります。上のボタンからXで開けます。"));
    const render = () => {
      const box = el("div");
      host.replaceChildren(box);
      // リストはIDで指定する（URL形式だと正しく読み込めない）
      window.twttr.widgets.createTimeline(
        { sourceType: "list", id: X_LIST_ID },
        box,
        { theme: theme.effective, height: 760, chrome: "noheader nofooter transparent", dnt: true, lang: "ja" }
      ).then(widget => { if (!widget) fail(); }).catch(fail);
    };
    if (window.twttr?.widgets?.createTimeline) { render(); return; }
    loadScript("https://platform.twitter.com/widgets.js")
      .then(() => (window.twttr?.ready ? window.twttr.ready(render) : render()))
      .catch(fail);
  },

  rethemeAll() {
    this.ticker();
    if (this.marketShown) this.market();
    if (this.chartShown) this.chart();
    if (this.xShown) this.x();
  }
};

$("#pair-chips").addEventListener("click", event => {
  const button = event.target.closest("button[data-symbol]");
  if (!button) return;
  widgets.chartSymbol = button.dataset.symbol;
  save("fx-chart-symbol", widgets.chartSymbol);
  widgets.chart();
});

/* =========================================================
   ルーティング（#/news など）
   ========================================================= */
const SCREENS = {
  home: "ドル円・豪ドル ダッシュボード",
  news: "速報ニュース",
  speakers: "要人発言",
  calendar: "経済指標",
  market: "通貨強弱",
  chart: "チャート",
  x: "X投稿",
  saved: "保存した記事",
  menu: "メニュー"
};
const DOCK_FOR = { home: "home", news: "news", chart: "chart", calendar: "calendar", menu: "menu", speakers: "menu", market: "menu", x: "menu", saved: "menu" };

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const name = SCREENS[path] ? path : "home";
  return { name, params: new URLSearchParams(query) };
}

let currentScreen = "";
function route() {
  const { name, params } = parseRoute();
  const changed = name !== currentScreen;
  currentScreen = name;
  $$(".screen").forEach(s => { s.hidden = s.dataset.screen !== name; });
  $$("[data-nav]").forEach(a => {
    if (a.dataset.nav === DOCK_FOR[name]) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#screen-title").textContent = SCREENS[name];
  $("#back-btn").hidden = name === "home";
  document.title = name === "home" ? "FX速報 AI | USD/JPY・AUD" : `${SCREENS[name]} | FX速報 AI`;

  if (name === "news" && params.has("importance")) {
    setSeg($("#news-importance"), params.get("importance"));
    renderNewsList();
  }
  if (name === "calendar" && params.has("scope")) {
    setSeg($("#calendar-scope"), params.get("scope"));
    renderCalendarEvents();
  }
  if (name === "market" && !widgets.marketShown) widgets.market();
  if (name === "chart" && params.has("symbol") && /^[A-Z]+:[A-Z0-9]+$/.test(params.get("symbol"))) {
    widgets.chartSymbol = params.get("symbol");
    save("fx-chart-symbol", widgets.chartSymbol);
    widgets.chart();
  } else if (name === "chart" && !widgets.chartShown) widgets.chart();
  if (name === "x") showX();
  if (name === "saved") renderSaved();
  if (changed) window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}
window.addEventListener("hashchange", route);
let inAppNavs = 0;
window.addEventListener("hashchange", () => { inAppNavs++; });
$("#back-btn").addEventListener("click", () => {
  if (inAppNavs > 0) history.back();
  else location.hash = "#/";
});

/* =========================================================
   ニュース
   ========================================================= */
let newsItems = [];   // 表示用（ニュース＋重要指標）
let rawNews = [];     // Supabase から取得したニュース
let newsUpdatedAt = "";
let savedNews = store("fx-saved-news", {});

const newsSearch = $("#news-search");
const newsSourceFilter = $("#news-source-filter");
const newsImpactFilter = $("#news-impact-filter");
newsSearch.addEventListener("input", renderNewsList);
newsSourceFilter.addEventListener("change", renderNewsList);
newsImpactFilter.addEventListener("change", renderNewsList);
segmented($("#news-importance"), renderNewsList);

function sourceLabel(source) {
  if (source === "日本銀行") return "日銀";
  if (source === "Federal Reserve") return "FRB";
  if (source === "FRB要人発言") return "FRB";
  if (source === "RBA要人発言") return "RBA";
  if (source === "ブルームバーグ日本語") return "ブルームバーグ";
  if (String(source || "").startsWith("要人発言")) return "要人報道";
  return source || "情報源不明";
}
function newsDate(item) {
  const d = new Date(item.published_at || item.fetched_at || 0);
  return Number.isNaN(d.getTime()) || d.getTime() === 0 ? null : d;
}
function impactTone(impact = "") {
  if (/上昇|豪ドル高|上振れ/.test(impact)) return "up";
  if (/下落|豪ドル安|下振れ/.test(impact)) return "down";
  return "";
}
function newsTitle(item) { return item.japanese_text || item.title || "（タイトルなし）"; }

function renderNewsRow(item, { speaker } = {}) {
  const date = newsDate(item);
  const time = el("div", { class: "row-time" });
  if (date) {
    const today = dayKey(date) === dayKey(new Date());
    time.append(el("b", { text: fmtTime.format(date) }), today ? "今日" : fmtMD.format(date));
  } else {
    time.textContent = "—";
  }

  const url = safeUrl(item.url) || (item.isEvent ? "" : "");
  const title = el("h3", { class: "row-title" },
    url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: newsTitle(item) }) : newsTitle(item));

  const body = el("div", { class: "row-body" }, title);
  const summaryText = item.summary || item.original_text;
  if (summaryText && summaryText !== item.title) {
    body.append(el("p", { class: "row-sum", text: summaryText }));
  }

  const chips = el("div", { class: "chips" });
  if (speaker) chips.append(el("span", { class: "chip speaker", text: speaker.name }));
  const importance = Number(item.importance);
  if (Number.isFinite(importance) && importance > 0) {
    const n = Math.max(1, Math.min(5, importance));
    chips.append(el("span", { class: `chip imp-${n}`, title: `重要度 ${n}`, text: `${"★".repeat(n)}` }));
  }
  if (item.usd_jpy_impact) {
    const tone = impactTone(item.usd_jpy_impact);
    chips.append(el("span", { class: `chip ${tone}`, text: tone === "up" ? "▲ " + item.usd_jpy_impact : tone === "down" ? "▼ " + item.usd_jpy_impact : item.usd_jpy_impact }));
  }
  chips.append(el("span", { class: "chip", text: sourceLabel(item.source) }));
  if (item.category) chips.append(el("span", { class: "chip", text: item.category }));
  if (item.verified) chips.append(el("span", { class: "chip up", text: "確認済み" }));
  body.append(chips);

  const key = url || `${item.source}|${item.title}`;
  const isSaved = Boolean(savedNews[key]);
  const saveBtn = el("button", {
    class: "row-save", type: "button", "aria-pressed": String(isSaved),
    "aria-label": isSaved ? "保存を解除" : "あとで読むに保存",
    onclick: () => {
      if (savedNews[key]) { delete savedNews[key]; toast("保存を解除しました"); }
      else { savedNews[key] = { ...item, saved_at: new Date().toISOString() }; toast("あとで読むに保存しました"); }
      save("fx-saved-news", savedNews);
      $$(`.row-save[data-key="${CSS.escape(key)}"]`).forEach(b => {
        const on = Boolean(savedNews[key]);
        b.setAttribute("aria-pressed", String(on));
        b.setAttribute("aria-label", on ? "保存を解除" : "あとで読むに保存");
      });
      if (currentScreen === "saved") renderSaved();
    }
  }, icon("i-bookmark", "off"), icon("i-bookmark-fill", "on"));
  saveBtn.dataset.key = key;

  if (item.isEvent) {
    time.prepend(cflag(item.event.country));
    const released = Boolean(item.event.actual);
    return el("article", { class: `row event lv-${item.event.level}${released ? " done" : " upcoming"}` }, time, body, saveBtn);
  }
  return el("article", { class: "row" }, time, body, saveBtn);
}

function filteredNews() {
  const selectedSource = newsSourceFilter.value;
  const imp = segValue($("#news-importance"));
  const minimumImportance = imp === "all" ? 0 : Number(imp);
  const exactFive = imp === "5";
  const selectedImpact = newsImpactFilter.value;
  const query = newsSearch.value.trim().toLocaleLowerCase("ja-JP");
  return newsItems.filter(item => {
    if (selectedSource !== "all" && sourceLabel(item.source) !== selectedSource) return false;
    const importance = Number(item.importance || 0);
    if (exactFive ? importance !== 5 : importance < minimumImportance) return false;
    const impact = String(item.usd_jpy_impact || "");
    if (selectedImpact === "up" && impactTone(impact) !== "up") return false;
    if (selectedImpact === "down" && impactTone(impact) !== "down") return false;
    if (selectedImpact === "unclear" && !/(方向は内容次第|内容次第|方向は)/.test(impact)) return false;
    if (query) {
      const searchable = [item.source, item.title, item.original_text, item.japanese_text, item.summary, item.category, impact]
        .filter(Boolean).join(" ").toLocaleLowerCase("ja-JP");
      if (!searchable.includes(query)) return false;
    }
    return true;
  });
}

function renderNewsList() {
  const feed = $("#news-feed");
  const all = filteredNews();
  const items = all.slice(0, 60);
  feed.replaceChildren();
  if (!items.length) {
    const filtersActive = newsSearch.value.trim() || newsSourceFilter.value !== "all" || segValue($("#news-importance")) !== "all" || newsImpactFilter.value !== "all";
    feed.append(el("div", { class: "empty" },
      el("strong", { text: newsItems.length ? (filtersActive ? "条件に合うニュースはありません" : "ニュースはまだありません") : "ニュースはまだありません" }),
      filtersActive ? "絞り込みを「すべて」に戻すと表示されます。" : "15分ごとに公式RSSから自動で取得しています。",
      filtersActive ? el("br") : null,
      filtersActive ? el("button", { class: "ghost-btn", type: "button", onclick: resetNewsFilters, text: "絞り込みを解除" }) : null));
  } else {
    items.forEach(item => feed.append(renderNewsRow(item)));
  }
  $("#news-status").textContent = newsItems.length
    ? `${all.length}件 / 全${newsItems.length}件・${newsUpdatedAt}更新`
    : "ニュースを読み込んでいます";
}
function resetNewsFilters() {
  newsSearch.value = "";
  newsSourceFilter.value = "all";
  newsImpactFilter.value = "all";
  setSeg($("#news-importance"), "all");
  if (location.hash.includes("?")) history.replaceState(null, "", "#/news");
  renderNewsList();
}

/* ホーム：速報ピックアップ */
function renderPickup() {
  const track = $("#pickup-track");
  const dots = $("#pickup-dots");
  if (!newsItems.length) return;
  const now = Date.now();
  const recent = newsItems.filter(i => { const d = newsDate(i); return d && now - d.getTime() < 72 * 3600e3 && d.getTime() <= now + 60e3; });
  const pool = (recent.length ? recent : newsItems).slice()
    .sort((a, b) => (Number(b.importance || 0) - Number(a.importance || 0)) || ((newsDate(b)?.getTime() || 0) - (newsDate(a)?.getTime() || 0)))
    .slice(0, 4);

  track.replaceChildren(...pool.map(item => {
    const importance = Number(item.importance || 0);
    const tone = impactTone(item.usd_jpy_impact || "");
    const toneClass = importance >= 5 ? (tone ? `tone-${tone}` : "") : "tone-calm";
    const date = newsDate(item);
    const url = safeUrl(item.url);
    return el("article", { class: `pickup-card ${toneClass}` },
      el("div", { class: "pickup-top" },
        el("span", { class: "pickup-label", text: importance >= 5 ? "重要度★5" : importance >= 4 ? "注目" : "新着" }),
        el("span", { class: "pickup-source", text: sourceLabel(item.source) })),
      el("h3", { class: "pickup-title" },
        url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: newsTitle(item) }) : newsTitle(item)),
      el("div", { class: "pickup-foot" },
        el("span", { class: "pickup-impact", text: item.usd_jpy_impact || "方向は内容次第" }),
        el("span", { class: "pickup-time", text: date ? relTime(date) : "" })));
  }));

  dots.replaceChildren(...pool.map((_, i) => el("button", {
    type: "button", role: "tab", "aria-label": `${i + 1}件目`, "aria-selected": String(i === 0),
    onclick: () => track.scrollTo({ left: track.clientWidth * i + 12 * i, behavior: "smooth" })
  })));
  dots.hidden = pool.length < 2;
}
$("#pickup-track").addEventListener("scroll", event => {
  const track = event.currentTarget;
  const index = Math.round(track.scrollLeft / (track.clientWidth + 12));
  $$("#pickup-dots button").forEach((b, i) => b.setAttribute("aria-selected", String(i === index)));
}, { passive: true });

function renderHomeNews() {
  const host = $("#home-news");
  const items = newsItems.slice(0, 6);
  host.replaceChildren(...(items.length ? items.map(i => renderNewsRow(i)) : [el("div", { class: "empty", text: "ニュースはまだありません" })]));
  host.append(el("a", { class: "block-link", href: "#/news", style: "display:block;text-align:center;padding:12px;border-top:1px solid var(--line)", text: `すべてのニュースを見る（${newsItems.length}件）` }));
  $("#home-news-meta").textContent = newsUpdatedAt ? `${newsUpdatedAt}更新` : "";
  const todays = rawNews.filter(i => { const d = newsDate(i); return d && dayKey(d) === dayKey(new Date()); }).length;
  $("#sub-news").textContent = todays ? `今日 ${todays}件` : "公式・報道";
}

function renderSaved() {
  const host = $("#saved-feed");
  const items = Object.values(savedNews).sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
  $("#saved-status").textContent = items.length ? `${items.length}件・この端末に保存` : "あとで読むニュース";
  host.replaceChildren(...(items.length ? items.map(i => renderNewsRow(i)) : [el("div", { class: "empty" },
    el("strong", { text: "保存した記事はまだありません" }),
    "ニュースの右側にあるしおりボタンを押すと、ここに集まります。")]));
}

async function loadNews() {
  const chip = $("#connection-status");
  chip.className = "status-chip loading";
  const endpoint = new URL(`${SUPABASE_URL}/rest/v1/news_items`);
  endpoint.search = new URLSearchParams({
    select: "source,title,original_text,japanese_text,summary,url,published_at,fetched_at,category,importance,usd_jpy_impact,verified",
    order: "published_at.desc.nullslast,fetched_at.desc",
    limit: "150"
  });
  try {
    const response = await fetch(endpoint, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    rawNews = await response.json();
    newsUpdatedAt = fmtTime.format(new Date());
    chip.className = "status-chip ok";
    $(".status-text", chip).textContent = `${newsUpdatedAt} 更新`;
    chip.title = `最終更新 ${newsUpdatedAt}（タップで更新）`;

  } catch {
    chip.className = "status-chip err";
    $(".status-text", chip).textContent = "接続できません";
    chip.title = "ニュースを取得できませんでした（タップで再試行）";
    if (!newsItems.length) {
      const failed = el("div", { class: "empty" }, el("strong", { text: "ニュースを読み込めませんでした" }), "通信環境を確認して、右上の状態ボタンから再読み込みしてください。");
      $("#news-feed").replaceChildren(failed.cloneNode(true));
      $("#home-news").replaceChildren(failed);
      $("#news-status").textContent = "取得できません";
    }
    return;
  }
  mergeNews();
}

/* ニュースと重要指標（予定・結果）を1本の流れにまとめる */
function mergeNews() {
  newsItems = [...eventNewsItems(), ...rawNews]
    .sort((a, b) => (newsDate(b)?.getTime() || 0) - (newsDate(a)?.getTime() || 0));
  const options = [...new Set(newsItems.map(item => sourceLabel(item.source)))].filter(l => l !== "情報源不明");
  const previous = newsSourceFilter.value;
  newsSourceFilter.replaceChildren(new Option("すべて", "all"), ...options.map(l => new Option(l, l)));
  newsSourceFilter.value = options.includes(previous) ? previous : "all";
  renderNewsList();
  renderSpeakerTracker();
  renderPickup();
  renderHomeNews();
  if (currentScreen === "saved") renderSaved();
}

/* =========================================================
   要人発言
   ========================================================= */
segmented($("#speaker-region"), renderSpeakerTracker);

function speakerProfile(item) {
  if (item.isEvent) return null;
  const text = [item.title, item.original_text, item.japanese_text, item.summary].filter(Boolean).join(" ");
  const source = item.source || "";
  const curated = source.startsWith("要人発言") || ["FRB要人発言", "RBA要人発言", "日本銀行", "財務省", "RBA"].includes(source);
  const macro = /(為替|ドル円|円安|円高|円相場|豪ドル|介入|金融政策|政策金利|利上げ|利下げ|金利|物価|インフレ|雇用|経済|関税|貿易|国債|通貨|景気|currency|foreign exchange|dollar|yen|interest rate|cash rate|monetary policy|inflation|employment|economy|tariff|trade|treasury yield|federal funds|outlook)/i.test(text);
  const speech = /(発言|講演|会見|談話|挨拶|声明|証言|述べ|語っ|語る|示唆|強調|けん制|牽制|言及|表明|指摘|インタビュー|記者団|コメント|speech|remarks|testimony|testifies|press conference|statement|says|said|warns|interview)/i.test(text);
  if (!macro && !curated) return null;
  const profiles = [
    // 豪州
    { match: /ブロック総裁|Bullock|豪中銀総裁|RBA Governor/i, name: "ブロック RBA総裁", region: "au" },
    { match: /ハウザー|Hauser/i, name: "ハウザー RBA副総裁", region: "au" },
    { match: /チャーマーズ|Chalmers|豪財務相|Australian Treasurer/i, name: "チャーマーズ豪財務相", region: "au" },
    { match: /アルバニージー|Albanese|豪首相|Australian Prime Minister/i, name: "アルバニージー豪首相", region: "au" },
    // 米国
    { match: /トランプ|Trump|米大統領|President of the United States/i, name: "トランプ大統領", region: "us" },
    { match: /ベッセント|Bessent|米財務長官|Treasury Secretary/i, name: "ベッセント財務長官", region: "us" },
    { match: /ウォーシュ|Warsh|FRB議長|Fed Chair/i, name: "ウォーシュ FRB議長", region: "fed" },
    { match: /パウエル|Powell/i, name: "パウエル氏（FRB）", region: "fed" },
    { match: /ジェファーソン|Jefferson/i, name: "ジェファーソン FRB副議長", region: "fed" },
    { match: /ボウマン|Bowman/i, name: "ボウマン FRB副議長", region: "fed" },
    { match: /ウォラー|Waller/i, name: "ウォラー FRB理事", region: "fed" },
    { match: /クック理事|Lisa Cook|Lisa D\. Cook/i, name: "クック FRB理事", region: "fed" },
    { match: /ミラン|Miran/i, name: "ミラン FRB理事", region: "fed" },
    { match: /バー理事|Michael S?\.? ?Barr/i, name: "バー FRB理事", region: "fed" },
    { match: /ウィリアムズ|John C?\.? ?Williams/i, name: "ウィリアムズ NY連銀総裁", region: "fed" },
    { match: /連銀総裁|FRB理事|Fed (President|Governor)|Federal Reserve Bank of/i, name: "FRB理事・地区連銀総裁", region: "fed" },
    // 日本
    { match: /高市|Takaichi|(?<![豪米英])首相|総理|Japan(ese)? Prime Minister/i, name: "日本の首相", region: "japan" },
    { match: /片山|Katayama|財務大臣|(?<![豪米英])財務相|Japan(ese)? Finance Minister/i, name: "財務大臣", region: "japan" },
    { match: /三村|Mimura|財務官|Vice[- ]Minister of Finance for International Affairs|top currency diplomat/i, name: "財務官", region: "japan" },
    { match: /官房長官|Chief Cabinet Secretary/i, name: "官房長官", region: "japan" },
    { match: /植田|Ueda|日銀総裁|BOJ Governor|Bank of Japan Governor/i, name: "植田 日銀総裁", region: "japan" },
    { match: /日銀副総裁|氷見野|Himino|内田副総裁|Uchida/i, name: "日銀副総裁", region: "japan" },
    { match: /日銀審議委員|BOJ board member/i, name: "日銀審議委員", region: "japan" }
  ];
  const person = profiles.find(profile => profile.match.test(text));
  if (person) return speech || curated ? person : null;
  if (source === "FRB要人発言") return { name: "FRB理事・地区連銀総裁", region: "fed" };
  if (source === "RBA要人発言") return { name: "RBA要人", region: "au" };
  if (source === "日本銀行" && speech) return { name: "日銀要人", region: "japan" };
  if (source === "財務省" && speech) return { name: "財務省要人", region: "japan" };
  return null;
}

function speakerRows() {
  return newsItems.map(item => ({ item, speaker: speakerProfile(item) })).filter(row => row.speaker);
}

function renderSpeakerTracker() {
  const feed = $("#speaker-feed");
  const region = segValue($("#speaker-region"));
  const all = speakerRows();
  const matches = all.filter(row => region === "all" || row.speaker.region === region).slice(0, 50);
  feed.replaceChildren();
  if (!matches.length) {
    feed.append(el("div", { class: "empty" },
      el("strong", { text: newsItems.length ? "該当する発言はまだありません" : "発言情報を読み込んでいます" }),
      newsItems.length ? "新しい発言が見つかると自動でここに並びます。" : ""));
  } else {
    matches.forEach(({ item, speaker }) => feed.append(renderNewsRow(item, { speaker })));
  }
  $("#speaker-status").textContent = `${matches.length}件・${newsUpdatedAt || "取得中"}更新`;
  $("#sub-speak").textContent = all.length ? `${all.length}件の発言` : "日米豪の要人";
}

/* =========================================================
   経済指標（日本・米国・豪州）
   GitHub Actions が TradingView の経済指標カレンダーを1〜4分ごとに取得し、
   data ブランチの calendar.json に置く。サイトはそれを読み込む。
   ========================================================= */
let calendarEvents = [];
let calendarUpdatedAt = null;
let calendarFromFallback = false;
const CAL_URLS = [
  { url: "https://api.github.com/repos/L1nus2910/fx-news-terminal/contents/calendar.json?ref=data", headers: { Accept: "application/vnd.github.raw+json" } },
  { url: "https://raw.githubusercontent.com/L1nus2910/fx-news-terminal/data/calendar.json", headers: {} }
];
const COUNTRY = {
  US: { key: "us", name: "米国", pairs: "ドル円・豪ドル/米ドル" },
  JP: { key: "japan", name: "日本", pairs: "ドル円・豪ドル円" },
  AU: { key: "au", name: "豪州", pairs: "豪ドル円・豪ドル/米ドル" }
};
const LEVEL_TEXT = { 3: "重要度 高", 2: "重要度 中", 1: "重要度 低" };
const SURPRISE_TEXT = { up: "予想より上振れ", down: "予想より下振れ", inline: "予想通り" };

const calendarRegionFilter = $("#calendar-region-filter");
const calendarImportanceFilter = $("#calendar-importance-filter");
calendarRegionFilter.addEventListener("change", renderCalendarEvents);
calendarImportanceFilter.addEventListener("change", renderCalendarEvents);
segmented($("#calendar-scope"), renderCalendarEvents);
segmented($("#calendar-view"), value => { save("fx-cal-view", value); renderCalendarEvents(); });
setSeg($("#calendar-view"), store("fx-cal-view", "list"));

function cflag(country) {
  return el("span", { class: `cflag ${String(country).toLowerCase()}`, title: COUNTRY[country]?.name || country, "aria-label": COUNTRY[country]?.name || country });
}
function eventRegion(event) { return COUNTRY[event.country]?.key || "other"; }
function val(value) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function eventLink(event) { return safeUrl(event.source_url) || ""; }

function normalizeEvent(raw) {
  const date = raw.date ? new Date(raw.date) : null;
  return {
    id: String(raw.id),
    country: raw.country,
    title: raw.title,
    title_ja: raw.title_ja || raw.title,
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    actual: raw.actual ?? null,
    forecast: raw.forecast ?? null,
    previous: raw.previous ?? null,
    surprise: raw.surprise ?? null,
    level: Number(raw.level) || 1,
    source_url: raw.source_url || null,
    source: raw.source || null,
    primary: raw.primary !== false,
    group_size: Number(raw.group_size) || 1
  };
}

/* 予備：data ブランチがまだ無いときは FinanceCalendar（結果なし）を使う */
async function loadFinanceCalendarFallback() {
  const start = new Date();
  const end = new Date(start.getTime() + 14 * 86400e3);
  const d = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const response = await fetch(`https://www.financecalendar.com/wp-json/fc/v1/calendar?from=${d(start)}&to=${d(end)}&limit=500`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const list = Array.isArray(payload) ? payload : (payload.events || []);
  return list.filter(e => ["US", "JP", "AU"].includes(String(e.country).toUpperCase())).map(e => normalizeEvent({
    id: e.id, country: String(e.country).toUpperCase(), title: e.title || e.name,
    title_ja: `${COUNTRY[String(e.country).toUpperCase()].name.replace("米国", "米").replace("豪州", "豪")} ${e.name || e.title}`,
    date: e.time_utc || e.release_at_utc || e.date, actual: e.actual, forecast: e.consensus, previous: e.prior,
    level: e.impact === "high" ? 3 : e.impact === "medium" ? 2 : 1, source_url: e.url
  }));
}

async function loadCalendar() {
  let loaded = false;
  for (const source of CAL_URLS) {
    try {
      const response = await fetch(source.url, { headers: source.headers, cache: "no-store" });
      if (!response.ok) continue;
      const data = await response.json();
      if (!Array.isArray(data.events)) continue;
      const updated = new Date(data.updated_at);
      if (Number.isNaN(updated.getTime()) || Date.now() - updated.getTime() > 2 * 86400e3) continue;
      calendarEvents = data.events.map(normalizeEvent).sort((a, b) => (a.date || 0) - (b.date || 0));
      calendarUpdatedAt = updated;
      calendarFromFallback = false;
      loaded = true;
      break;
    } catch { /* 次の取得元へ */ }
  }
  if (!loaded) {
    try {
      calendarEvents = (await loadFinanceCalendarFallback()).sort((a, b) => (a.date || 0) - (b.date || 0));
      calendarUpdatedAt = new Date();
      calendarFromFallback = true;
      loaded = true;
    } catch { /* 何も取れない */ }
  }
  if (!loaded) {
    $("#calendar-status").textContent = "取得できません";
    if (!calendarEvents.length) {
      $("#calendar-feed").replaceChildren(el("div", { class: "list-card" }, el("div", { class: "empty" }, el("strong", { text: "経済指標を読み込めませんでした" }), "時間をおいて、右上の状態ボタンから再読み込みしてください。")));
      $("#next-event").replaceChildren(el("div", { class: "empty", text: "指標を読み込めませんでした" }));
    }
  } else {
    $("#calendar-status").textContent = `${calendarEvents.length}件・${fmtTime.format(calendarUpdatedAt)}時点${calendarFromFallback ? "（予備の取得元・結果なし）" : ""}`;
    renderCalendarEvents();
    renderNextEvent();
    mergeNews();
    renderAlerts();
    notifyEvents();
  }
  scheduleCalendar();
}

/* 重要指標の前後は短い間隔で読み直す */
let calendarTimer;
function scheduleCalendar() {
  clearTimeout(calendarTimer);
  const now = Date.now();
  const hot = calendarEvents.some(e => e.level >= 2 && e.date && !e.actual && e.date.getTime() - now < 30 * 60e3 && now - e.date.getTime() < 25 * 60e3);
  calendarTimer = setTimeout(loadCalendar, hot ? 75e3 : 5 * 60e3);
}

function visibleCalendarEvents() {
  const region = calendarRegionFilter.value;
  const min = calendarImportanceFilter.value === "high" ? 3 : calendarImportanceFilter.value === "medium" ? 2 : 0;
  const scope = segValue($("#calendar-scope"));
  const todayKey = dayKey(new Date());
  const weekEnd = Date.now() + 7 * 86400e3;
  const since = Date.now() - 36 * 3600e3;
  return calendarEvents.filter(event => {
    if (region !== "all" && eventRegion(event) !== region) return false;
    if (event.level < min) return false;
    const d = event.date;
    if (scope === "today") return d && dayKey(d) === todayKey;
    if (d && d.getTime() < since) return false;
    if (scope === "week" && (!d || d.getTime() > weekEnd)) return false;
    return true;
  });
}

function renderEventRow(event) {
  const d = event.date;
  const hasActual = event.actual !== null && event.actual !== "";
  const url = eventLink(event);
  const now = Date.now();
  const soon = !hasActual && d && d.getTime() > now && d.getTime() - now < 60 * 60e3;
  const waiting = !hasActual && d && d.getTime() <= now && now - d.getTime() < 60 * 60e3;
  return el("article", { class: `ev lv-${event.level}${hasActual ? " done" : ""}${soon ? " soon" : ""}`, id: `ev-${event.id}` },
    el("div", { class: "ev-time" }, d ? fmtTime.format(d) : "—", el("small", {}, cflag(event.country), COUNTRY[event.country]?.name || "")),
    el("div", {},
      el("h3", { class: "ev-name" }, url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: event.title_ja }) : event.title_ja),
      el("div", { class: "ev-meta" },
        el("span", { class: `lv lv-${event.level}`, text: LEVEL_TEXT[event.level] }),
        hasActual && event.surprise ? el("span", { class: `chip ${event.surprise === "up" ? "up" : event.surprise === "down" ? "down" : ""}`, text: `${event.surprise === "up" ? "▲ " : event.surprise === "down" ? "▼ " : ""}${SURPRISE_TEXT[event.surprise]}` }) : null,
        hasActual && !event.surprise ? el("span", { class: "chip up", text: "発表済み" }) : null,
        soon ? el("span", { class: "chip soon", text: `あと${Math.max(1, Math.round((d.getTime() - now) / 60e3))}分` }) : null,
        waiting ? el("span", { class: "chip soon", text: "結果を待っています" }) : null)),
    el("div", { class: "vals" },
      el("div", { class: "val" }, el("small", { text: "前回" }), el("strong", { text: val(event.previous) })),
      el("div", { class: "val" }, el("small", { text: "予想" }), el("strong", { text: val(event.forecast) })),
      el("div", { class: `val${hasActual ? ` actual ${event.surprise || ""}` : ""}` }, el("small", { text: "結果" }), el("strong", { text: val(event.actual) }))));
}

function groupByDay(events) {
  const groups = new Map();
  events.forEach(event => {
    const key = event.date ? dayKey(event.date) : "未定";
    if (!groups.has(key)) groups.set(key, { date: event.date, events: [] });
    groups.get(key).events.push(event);
  });
  return groups;
}

function renderCalendarEvents() {
  const host = $("#calendar-feed");
  const events = visibleCalendarEvents();
  const view = segValue($("#calendar-view"));
  host.replaceChildren();
  if (!events.length) {
    const scope = segValue($("#calendar-scope"));
    host.append(el("div", { class: "list-card" }, el("div", { class: "empty" },
      el("strong", { text: calendarEvents.length ? "条件に合う指標はありません" : "経済指標を読み込んでいます" }),
      calendarEvents.length ? (scope === "today" ? "今日は対象の指標がありません。期間を「14日間」にすると先の予定が見られます。" : "地域や重要度の絞り込みを広げてください。") : "")));
    return;
  }
  const todayKey = dayKey(new Date());
  const groups = groupByDay(events);

  if (view === "board") {
    const board = el("div", { class: "board" });
    groups.forEach(({ date, events: list }, key) => {
      const col = el("section", { class: `board-col${key === todayKey ? " today" : ""}` },
        el("h3", {}, el("span", {}, el("span", { class: "num", text: date ? fmtMD.format(date) : "未定" }), " ", date ? fmtWeek.format(date) : ""), el("small", { text: `${list.length}件` })));
      list.forEach(event => {
        col.append(el("a", { class: `bcard lv-${event.level}`, href: "#/calendar", onclick: e => { e.preventDefault(); setSeg($("#calendar-view"), "list"); renderCalendarEvents(); document.getElementById(`ev-${event.id}`)?.scrollIntoView({ block: "center" }); } },
          el("time", {}, cflag(event.country), event.date ? fmtTime.format(event.date) : "—"),
          el("b", { text: event.title_ja }),
          event.actual ? el("span", { class: `bres ${event.surprise || ""}`, text: `結果 ${event.actual}（予想 ${val(event.forecast)}）` }) : null));
      });
      board.append(col);
    });
    host.append(board);
    return;
  }

  groups.forEach(({ date, events: list }, key) => {
    const isToday = key === todayKey;
    host.append(el("section", {},
      el("div", { class: `day-head${isToday ? " today" : ""}` },
        el("span", { class: "num", text: date ? fmtMD.format(date) : "日付未定" }),
        el("strong", { text: date ? `${fmtWeek.format(date)}曜日${isToday ? "・今日" : ""}` : "" }),
        el("small", { text: `${list.length}件` })),
      el("div", { class: "list-card" }, ...list.map(renderEventRow))));
  });
}

/* ホーム：次の重要指標 */
let nextEventTimer;
function renderNextEvent() {
  const host = $("#next-event");
  const now = Date.now();
  const upcoming = calendarEvents.filter(e => e.primary && e.date && e.date.getTime() > now - 20 * 60e3 && !(e.actual && e.date.getTime() < now - 20 * 60e3));
  const pick = upcoming.find(e => e.level >= 3 && !e.actual) || upcoming.find(e => e.level >= 3) || upcoming.find(e => e.level >= 2) || upcoming[0];
  clearInterval(nextEventTimer);
  const todayCount = calendarEvents.filter(e => e.date && dayKey(e.date) === dayKey(new Date()) && e.level >= 2).length;
  $("#sub-cal").textContent = todayCount ? `今日 ${todayCount}件` : "日米豪";

  if (!pick) {
    host.replaceChildren(el("div", { class: "empty" }, el("strong", { text: "予定されている重要指標はありません" }), "日本・米国・豪州の指標が見つかると表示されます。"));
    return;
  }
  const d = pick.date;
  const released = Boolean(pick.actual);
  const stage = released ? 3 : 2;
  const countdown = el("span", { class: "countdown" });
  const tick = () => {
    const diff = d.getTime() - Date.now();
    if (released) { countdown.replaceChildren("発表済み"); return; }
    if (diff <= 0) { countdown.replaceChildren("結果待ち"); return; }
    const days = Math.floor(diff / 86400e3);
    const hours = Math.floor(diff % 86400e3 / 3600e3);
    const mins = Math.floor(diff % 3600e3 / 60e3);
    countdown.replaceChildren("あと ",
      ...(days ? [el("b", { text: days }), "日 "] : []),
      ...(days || hours ? [el("b", { text: hours }), "時間 "] : []),
      ...(days ? [] : [el("b", { text: mins }), "分"]));
  };
  tick();
  nextEventTimer = setInterval(tick, 30e3);

  const url = eventLink(pick);
  const step = (n, label, value) => el("div", { class: `step${stage > n ? " done" : stage === n ? " now" : ""}` },
    el("div", { class: "step-dot", text: n }), el("small", { text: label }), el("strong", { text: val(value) }));

  host.replaceChildren(
    el("div", { class: "ne-top" },
      el("span", { class: `lv lv-${pick.level}`, text: LEVEL_TEXT[pick.level] }),
      el("span", { class: "chip" }, cflag(pick.country), COUNTRY[pick.country]?.name || ""),
      countdown),
    el("h3", { class: "ne-name" }, url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: pick.title_ja }) : pick.title_ja),
    el("div", { class: "ne-when", text: `${fmtMD.format(d)}（${fmtWeek.format(d)}）${fmtTime.format(d)} 発表・${COUNTRY[pick.country]?.pairs || ""}に影響` }),
    el("div", { class: "stepper", style: `--progress:${released ? 100 : 50}%` },
      step(1, "前回", pick.previous), step(2, "予想", pick.forecast), step(3, "結果", pick.actual)),
    released && pick.surprise ? el("p", { class: `ne-surprise ${pick.surprise}`, text: `${pick.surprise === "up" ? "▲" : pick.surprise === "down" ? "▼" : "＝"} ${SURPRISE_TEXT[pick.surprise]}` }) : null,
    el("div", { class: "ne-links" },
      el("a", { class: "ghost-btn", href: "#/calendar?scope=today" }, icon("i-cal"), "今日の指標"),
      el("a", { class: "ghost-btn", href: `#/chart?symbol=${pick.country === "AU" ? "FX:AUDJPY" : "FX:USDJPY"}` }, icon("t-chart"), "チャートを見る")));
}

/* 重要指標をニュースの流れに入れる（予定・結果） */
function eventNewsItems() {
  const now = Date.now();
  return calendarEvents.filter(e => e.primary && e.date && e.level >= 2 && (
    (e.actual && now - e.date.getTime() < 3 * 86400e3 && e.date.getTime() <= now + 60e3) ||
    (!e.actual && e.level >= 3 && e.date.getTime() > now - 60 * 60e3 && e.date.getTime() - now < 24 * 3600e3)
  )).map(e => {
    const released = Boolean(e.actual);
    return {
      isEvent: true,
      event: e,
      source: "経済指標",
      title: (released ? `${e.title_ja} 結果 ${e.actual}` : `${e.title_ja} ${fmtTime.format(e.date)} 発表予定`) + (e.group_size > 1 ? `（ほか${e.group_size - 1}件）` : ""),
      summary: `予想 ${val(e.forecast)} ／ 前回 ${val(e.previous)}${released ? "" : `・${COUNTRY[e.country]?.pairs || ""}に影響`}`,
      url: eventLink(e) || "",
      published_at: e.date.toISOString(),
      importance: e.level >= 3 ? 5 : 4,
      usd_jpy_impact: released ? (e.surprise ? SURPRISE_TEXT[e.surprise] : "発表済み") : "発表前",
      category: released ? "指標結果" : "指標予定"
    };
  });
}

/* 速報バナー（重要度「高」の指標の直前・直後に上部へ表示） */
let dismissedAlerts = new Set(store("fx-dismissed-alerts", []));
function renderAlerts() {
  const bar = $("#alert-bar");
  const now = Date.now();
  const items = [];
  const results = calendarEvents
    .filter(e => e.primary && e.level >= 3 && e.actual && e.date && now - e.date.getTime() < 90 * 60e3 && e.date.getTime() <= now + 60e3 && !dismissedAlerts.has(`res:${e.id}`))
    .sort((a, b) => b.date - a.date).slice(0, 2);
  results.forEach(e => items.push({ key: `res:${e.id}`, kind: `res ${e.surprise || ""}`, label: "結果", e,
    text: `${e.actual}（予想 ${val(e.forecast)}）${e.surprise === "up" ? " ▲上振れ" : e.surprise === "down" ? " ▼下振れ" : e.surprise === "inline" ? " 予想通り" : ""}` }));
  const waiting = calendarEvents.find(e => e.primary && e.level >= 3 && !e.actual && e.date && e.date.getTime() <= now && now - e.date.getTime() < 20 * 60e3);
  if (waiting) items.push({ key: `wait:${waiting.id}`, kind: "wait", label: "発表時刻", e: waiting, text: `結果待ち（予想 ${val(waiting.forecast)}）` });
  const soon = calendarEvents.filter(e => e.primary && e.level >= 3 && !e.actual && e.date && e.date.getTime() > now && e.date.getTime() - now <= 60 * 60e3).slice(0, 2);
  soon.forEach(e => items.push({ key: `pre:${e.id}`, kind: "pre", label: `あと${Math.max(1, Math.ceil((e.date.getTime() - now) / 60e3))}分`, e,
    text: `${fmtTime.format(e.date)}発表 予想 ${val(e.forecast)}` }));

  bar.hidden = !items.length;
  bar.replaceChildren(...items.slice(0, 3).map(item => el("div", { class: `alert ${item.kind}` },
    el("a", { class: "alert-main", href: "#/calendar?scope=today" },
      el("span", { class: "alert-label", text: item.label }),
      cflag(item.e.country),
      el("strong", { text: item.e.title_ja }),
      el("span", { class: "alert-text", text: item.text })),
    item.kind.startsWith("res") ? el("button", { class: "alert-close", type: "button", "aria-label": "このお知らせを閉じる", onclick: () => {
      dismissedAlerts.add(item.key);
      save("fx-dismissed-alerts", [...dismissedAlerts].slice(-50));
      renderAlerts();
    } }, icon("i-close")) : null)));
}
setInterval(() => { if (calendarEvents.length) { renderAlerts(); notifyEvents(); } }, 20e3);

/* 端末の通知（アプリを開いている間） */
const notifySetting = { get on() { return store("fx-notify", false) && "Notification" in window && Notification.permission === "granted"; } };
let notified = new Set(store("fx-notified", []));
function notifyEvents() {
  if (!notifySetting.on) return;
  const now = Date.now();
  calendarEvents.forEach(e => {
    if (e.level < 3 || !e.primary || !e.date) return;
    const minutes = (e.date.getTime() - now) / 60e3;
    const pre = `pre:${e.id}`, res = `res:${e.id}`;
    if (!e.actual && minutes > 0 && minutes <= 5 && !notified.has(pre)) {
      new Notification(`まもなく発表：${e.title_ja}`, { body: `${fmtTime.format(e.date)} 発表・予想 ${val(e.forecast)}／前回 ${val(e.previous)}`, tag: pre, icon: "icons/icon-192.png" });
      notified.add(pre);
    }
    if (e.actual && minutes <= 0 && minutes > -90 && !notified.has(res)) {
      new Notification(`結果：${e.title_ja} ${e.actual}`, { body: `予想 ${val(e.forecast)}／前回 ${val(e.previous)}${e.surprise ? "・" + SURPRISE_TEXT[e.surprise] : ""}`, tag: res, icon: "icons/icon-192.png" });
      notified.add(res);
    }
  });
  save("fx-notified", [...notified].slice(-100));
}
function renderNotifySetting() {
  const button = $("#notify-btn");
  if (!button) return;
  if (!("Notification" in window)) { button.disabled = true; button.textContent = "この端末は未対応"; return; }
  button.textContent = notifySetting.on ? "オフにする" : "オンにする";
}
$("#notify-btn")?.addEventListener("click", async () => {
  if (notifySetting.on) { save("fx-notify", false); renderNotifySetting(); toast("通知をオフにしました"); return; }
  const permission = await Notification.requestPermission();
  if (permission === "granted") { save("fx-notify", true); toast("重要指標の通知をオンにしました"); notifyEvents(); }
  else toast("通知が許可されませんでした。ブラウザの設定から許可してください");
  renderNotifySetting();
});
renderNotifySetting();

/* =========================================================
   X投稿（公式リストの埋め込み）
   ========================================================= */
function showX() {
  if (!widgets.xShown) widgets.x();
}

/* =========================================================
   まとめて検索（ホーム）
   ========================================================= */
const globalSearch = $("#global-search");
const globalResults = $("#global-results");
let searchTimer;
globalSearch.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(runGlobalSearch, 120); });
globalSearch.addEventListener("focus", () => { if (globalSearch.value.trim()) runGlobalSearch(); });
globalSearch.addEventListener("keydown", e => { if (e.key === "Escape") { globalSearch.value = ""; globalResults.hidden = true; } });
document.addEventListener("click", e => { if (!e.target.closest(".home-search")) globalResults.hidden = true; });

function highlight(text, query) {
  const node = document.createDocumentFragment();
  const lower = text.toLocaleLowerCase("ja-JP");
  let index = 0;
  let found = lower.indexOf(query, index);
  while (found !== -1 && query) {
    node.append(text.slice(index, found), el("mark", { text: text.slice(found, found + query.length) }));
    index = found + query.length;
    found = lower.indexOf(query, index);
  }
  node.append(text.slice(index));
  return node;
}
function runGlobalSearch() {
  const query = globalSearch.value.trim().toLocaleLowerCase("ja-JP");
  if (!query) { globalResults.hidden = true; return; }
  const hits = (list, fields) => list.filter(item => fields(item).toLocaleLowerCase("ja-JP").includes(query));

  const speakerHits = speakerRows().filter(({ item, speaker }) => [speaker.name, newsTitle(item), item.summary || ""].join(" ").toLocaleLowerCase("ja-JP").includes(query)).slice(0, 4);
  const speakerUrls = new Set(speakerHits.map(r => r.item.url));
  const newsHits = hits(rawNews, i => [newsTitle(i), i.summary || "", i.source || "", i.category || ""].join(" ")).filter(i => !speakerUrls.has(i.url)).slice(0, 6);
  const eventHits = hits(calendarEvents, e => [e.title_ja, e.title || ""].join(" ")).slice(0, 5);

  globalResults.replaceChildren();
  const group = (label, rows) => { if (rows.length) globalResults.append(el("div", { class: "result-group", text: label }), ...rows); };
  group("要人発言", speakerHits.map(({ item, speaker }) => el("a", { class: "result", href: safeUrl(item.url) || "#/speakers", target: safeUrl(item.url) ? "_blank" : null, rel: "noopener noreferrer" },
    highlight(newsTitle(item), query), el("small", { text: `${speaker.name}・${newsDate(item) ? relTime(newsDate(item)) : ""}` }))));
  group("ニュース", newsHits.map(item => el("a", { class: "result", href: safeUrl(item.url) || "#/news", target: safeUrl(item.url) ? "_blank" : null, rel: "noopener noreferrer" },
    highlight(newsTitle(item), query), el("small", { text: `${sourceLabel(item.source)}・${newsDate(item) ? relTime(newsDate(item)) : ""}` }))));
  group("経済指標", eventHits.map(event => { const d = event.date; return el("a", { class: "result", href: "#/calendar" },
    highlight(event.title_ja, query), el("small", { text: `${COUNTRY[event.country]?.name || ""}・${d ? `${fmtMD.format(d)}（${fmtWeek.format(d)}）${fmtTime.format(d)}` : "日時未定"}${event.actual ? `・結果 ${event.actual}` : ""}` })); }));
  if (!globalResults.childElementCount) {
    globalResults.append(el("div", { class: "empty" }, el("strong", { text: `「${globalSearch.value.trim()}」は見つかりませんでした` }), "別の言葉や、英語表記（Powell など）でも試してください。"));
  }
  globalResults.hidden = false;
}

/* =========================================================
   PWA（ホーム画面に追加）
   ========================================================= */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPrompt = e;
  $("#install-row").hidden = false;
});
$("#install-btn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === "accepted") { $("#install-row").hidden = true; toast("ホーム画面に追加しました"); }
  installPrompt = null;
});
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $("#install-ios").hidden = false;
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

/* =========================================================
   起動
   ========================================================= */
$("#connection-status").addEventListener("click", () => { loadNews(); loadCalendar(); toast("最新の情報を取得しています"); });

// 上部バーの高さ（速報バナーで変わる）をレート欄の固定位置に反映
if ("ResizeObserver" in window) {
  new ResizeObserver(([entry]) => document.documentElement.style.setProperty("--topbar-h", `${Math.round(entry.target.getBoundingClientRect().height)}px`)).observe($(".topbar"));
}

theme.sync();
widgets.ticker();
route();
loadNews();
loadCalendar();
setInterval(loadNews, 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadNews();
});

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
    const t = document.createElement("tv-single-ticker");
    t.setAttribute("symbol", "FX:USDJPY");
    t.setAttribute("hide-market-status", "");
    t.setAttribute("size", "large");
    t.setAttribute("theme", theme.effective);
    t.setAttribute("force-theme", "");
    t.setAttribute("locale", "ja");
    t.setAttribute("transparent", "");
    host.replaceChildren(t);
    loadScript("https://widgets.tradingview-widget.com/w/en/tv-single-ticker.js", { module: true })
      .catch(() => host.replaceChildren(el("a", { href: "https://www.tradingview.com/symbols/USDJPY/", target: "_blank", rel: "noopener noreferrer", class: "block-link", text: "レートを読み込めません。TradingViewで開く" })));
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
    const a = el("a", {
      class: "twitter-timeline",
      "data-theme": theme.effective,
      "data-height": "720",
      "data-chrome": "noheader nofooter transparent",
      "data-lang": "ja",
      "data-dnt": "true",
      href: `https://twitter.com/i/lists/${X_LIST_ID}`
    }, "リストの投稿を読み込んでいます…");
    host.replaceChildren(a);
    const render = () => window.twttr?.widgets?.load(host);
    if (window.twttr?.widgets) { render(); return; }
    loadScript("https://platform.twitter.com/widgets.js").then(render).catch(() => {
      host.replaceChildren(el("div", { class: "empty" },
        el("strong", { text: "タイムラインを表示できませんでした" }),
        "ブラウザの設定や拡張機能で埋め込みが止められている可能性があります。上のボタンからXで開けます。"));
    });
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
  home: "ドル円ダッシュボード",
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
  document.title = name === "home" ? "FX速報 AI | USD/JPY" : `${SCREENS[name]} | FX速報 AI`;

  if (name === "news" && params.has("importance")) {
    setSeg($("#news-importance"), params.get("importance"));
    renderNewsList();
  }
  if (name === "calendar" && params.has("scope")) {
    setSeg($("#calendar-scope"), params.get("scope"));
    renderCalendarEvents();
  }
  if (name === "market" && !widgets.marketShown) widgets.market();
  if (name === "chart" && !widgets.chartShown) widgets.chart();
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
let newsItems = [];
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
  if (source === "ブルームバーグ日本語") return "ブルームバーグ";
  return source || "情報源不明";
}
function newsDate(item) {
  const d = new Date(item.published_at || item.fetched_at || 0);
  return Number.isNaN(d.getTime()) || d.getTime() === 0 ? null : d;
}
function impactTone(impact = "") {
  if (impact.includes("上昇")) return "up";
  if (impact.includes("下落")) return "down";
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

  const url = safeUrl(item.url);
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

  const row = el("article", { class: "row" }, time, body, saveBtn);
  return row;
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
    if (selectedImpact === "up" && !impact.includes("上昇")) return false;
    if (selectedImpact === "down" && !impact.includes("下落")) return false;
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
  const recent = newsItems.filter(i => { const d = newsDate(i); return d && now - d.getTime() < 72 * 3600e3; });
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
  const items = newsItems.slice(0, 5);
  host.replaceChildren(...(items.length ? items.map(i => renderNewsRow(i)) : [el("div", { class: "empty", text: "ニュースはまだありません" })]));
  host.append(el("a", { class: "block-link", href: "#/news", style: "display:block;text-align:center;padding:12px;border-top:1px solid var(--line)", text: `すべてのニュースを見る（${newsItems.length}件）` }));
  $("#home-news-meta").textContent = newsUpdatedAt ? `${newsUpdatedAt}更新` : "";
  const todays = newsItems.filter(i => { const d = newsDate(i); return d && dayKey(d) === dayKey(new Date()); }).length;
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
    newsItems = await response.json();
    newsUpdatedAt = fmtTime.format(new Date());
    chip.className = "status-chip ok";
    $(".status-text", chip).textContent = `${newsUpdatedAt} 更新`;
    chip.title = `最終更新 ${newsUpdatedAt}（タップで更新）`;

    const options = [...new Set(newsItems.map(item => sourceLabel(item.source)))].filter(l => l !== "情報源不明");
    const previous = newsSourceFilter.value;
    newsSourceFilter.replaceChildren(new Option("すべて", "all"), ...options.map(l => new Option(l, l)));
    newsSourceFilter.value = options.includes(previous) ? previous : "all";
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
  const text = [item.title, item.original_text, item.japanese_text, item.summary].filter(Boolean).join(" ");
  const source = item.source || "";
  const macro = /(為替|ドル円|円安|円高|円相場|介入|金融政策|政策金利|利上げ|利下げ|金利|物価|インフレ|雇用|経済|関税|貿易|米国債|通貨|currency|foreign exchange|dollar|yen|interest rate|monetary policy|inflation|employment|economy|tariff|trade|treasury yield|federal funds)/i.test(text);
  const speech = /(発言|講演|会見|談話|挨拶|声明|証言|speech|remarks|testimony|testifies|press conference|statement|says|said|warns|outlook)/i.test(text);
  if (!macro) return null;
  const profiles = [
    { match: /Jerome H\. Powell|Jerome Powell|Powell|パウエル/i, name: "パウエル FRB議長", region: "fed" },
    { match: /Michelle W\. Bowman|Michelle Bowman|Bowman|ボウマン/i, name: "ボウマン FRB理事", region: "fed" },
    { match: /Christopher J\. Waller|Christopher Waller|Waller|ウォラー/i, name: "ウォラー FRB理事", region: "fed" },
    { match: /Lisa D\. Cook|Lisa Cook|Cook|クック/i, name: "クック FRB理事", region: "fed" },
    { match: /Philip N\. Jefferson|Philip Jefferson|Jefferson|ジェファーソン/i, name: "ジェファーソン FRB副議長", region: "fed" },
    { match: /Bessent|ベッセント|Treasury Secretary|米財務長官/i, name: "米財務長官", region: "us" },
    { match: /Trump|トランプ|President of the United States|米大統領|大統領/i, name: "米大統領", region: "us" },
    { match: /Ueda|植田|日銀総裁|Bank of Japan Governor/i, name: "日銀総裁", region: "japan" },
    { match: /日銀副総裁|Himino|氷見野|Uchida|内田/i, name: "日銀副総裁", region: "japan" },
    { match: /財務大臣|財務相|Finance Minister|財務官|Vice-Minister of Finance/i, name: "財務大臣・財務官", region: "japan" },
    { match: /首相|総理|Prime Minister/i, name: "日本の首相", region: "japan" }
  ];
  const person = profiles.find(profile => profile.match.test(text));
  if (person) return speech || ["FRB要人発言", "日本銀行", "財務省"].includes(source) ? person : null;
  if (source === "FRB要人発言" && speech) return { name: "FRB理事・地区連銀総裁", region: "fed" };
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
  $("#sub-speak").textContent = all.length ? `${all.length}件の発言` : "FRB・日銀・財務省";
}

/* =========================================================
   経済指標
   ========================================================= */
let calendarEvents = [];
const calendarRegionFilter = $("#calendar-region-filter");
const calendarImportanceFilter = $("#calendar-importance-filter");
calendarRegionFilter.addEventListener("change", renderCalendarEvents);
calendarImportanceFilter.addEventListener("change", renderCalendarEvents);
segmented($("#calendar-scope"), renderCalendarEvents);
segmented($("#calendar-view"), value => { save("fx-cal-view", value); renderCalendarEvents(); });
setSeg($("#calendar-view"), store("fx-cal-view", "list"));

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  const numbers = String(value).match(/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:%|bps?|[KMB])?/gi);
  return numbers?.length ? numbers.map(n => n.replace(/\s+/g, "")).join(" / ") : "—";
}
function eventRegion(event) {
  const region = [event.country, event.country_name, event.country_code, event.currency, event.currency_code].filter(Boolean).join(" ").toLowerCase();
  const title = [event.title, event.name, event.event].filter(Boolean).join(" ").toLowerCase();
  if (/\b(us|usa|united states|u\.s\.|usd)\b|米国|アメリカ|\bfed\b|\bfomc\b|federal reserve/.test(region + " " + title)) return "us";
  if (/\b(japan|jpn|jpy|boj)\b|日本|日銀|日本銀行|bank of japan/.test(region + " " + title)) return "japan";
  return "other";
}
function japaneseEventName(event) {
  const original = event.title || event.name || event.event || "イベント";
  const region = eventRegion(event);
  const cpiPrefix = region === "japan" ? "日本" : "米";
  const rules = [
    [/tokyo.*consumer price|tokyo.*\bcpi\b|東京都区部|東京.*CPI/i, "東京都区部消費者物価指数（東京CPI）"],
    [/core consumer price index|core cpi|コアCPI/i, `${cpiPrefix}コア消費者物価指数（コアCPI）`],
    [/consumer price index|\bcpi\b|消費者物価指数/i, `${cpiPrefix}消費者物価指数（CPI）`],
    [/non[- ]?farm payroll|employment situation|us jobs report/i, "米雇用統計（非農業部門雇用者数）"],
    [/unemployment rate/i, "米失業率"],
    [/average hourly earnings/i, "米平均時給"],
    [/producer price index|\bppi\b/i, "米生産者物価指数（PPI）"],
    [/personal consumption expenditures|\bpce\b/i, "米個人消費支出（PCE）物価指数"],
    [/fomc.*minutes|minutes.*fomc/i, "FOMC議事要旨"],
    [/fomc|federal funds rate|fed.*rate decision/i, "FOMC政策金利発表"],
    [/initial jobless claims|jobless claims/i, "米新規失業保険申請件数"],
    [/retail sales/i, "米小売売上高"],
    [/gross domestic product|\bgdp\b/i, "米国内総生産（GDP）"],
    [/bank of japan|\bboj\b.*(rate|policy)|(rate|policy).*\bboj\b/i, "日銀金融政策"],
    [/interest rate decision|central bank.*rate decision/i, "政策金利発表"]
  ];
  const match = rules.find(([pattern]) => pattern.test(original));
  return match ? match[1] : original;
}
function isFxRelevantEvent(event) {
  const title = [event.title, event.name, event.event].filter(Boolean).join(" ");
  const region = [event.country, event.country_name, event.country_code, event.currency, event.currency_code].filter(Boolean).join(" ").toLowerCase();
  if (/holiday|market open|market closed|stock market|exchange hours|trading hours|bank holiday/i.test(title)) return false;
  const targetRegion = /\b(us|usa|united states|u\.s\.|usd|japan|jpy|jpn)\b|日本|米国|アメリカ/.test(region);
  const otherRegion = /\b(canada|cad|australia|aud|eurozone|europe|eur|china|cny|uk|gbp|india|inr|switzerland|chf)\b|カナダ|豪州|オーストラリア|ユーロ圏|中国|英国|インド/.test(region);
  if (targetRegion) return true;
  if (otherRegion) return false;
  if (/\b(us|usa|united states|u\.s\.|usd|japan|jpy|boj|fomc|fed|federal reserve)\b|日本|米国|アメリカ|日銀|米雇用統計/.test(title)) return true;
  if (/core cpi|consumer price|inflation|\bcpi\b|\bpce\b|personal consumption|producer price|\bppi\b|non[- ]?farm|payroll|employment|jobless claims|unemployment|average hourly|\bgdp\b|gross domestic|\bism\b|\bpmi\b|retail sales|interest rate|rate decision|consumer confidence|durable goods|housing starts|industrial production|trade balance/i.test(title)) return true;
  return false;
}
function eventImportanceScore(event) {
  const value = String(event.impact ?? event.importance ?? "").toLowerCase();
  const sourceScore = value === "high" || value === "3" ? 3 : value === "medium" || value === "med" || value === "2" ? 2 : value === "low" || value === "1" ? 1 : 0;
  const title = [event.title, event.name, event.event].filter(Boolean).join(" ").toLowerCase();
  const region = eventRegion(event);
  const topTier = /consumer price index|\bcpi\b|personal consumption expenditures|\bpce\b|non[- ]?farm payroll|\bnfp\b|employment situation|federal funds rate|fed.*rate decision|fomc.*(rate|statement|decision|press conference)|interest rate decision|policy rate decision|bank of japan.*(rate|policy|meeting)|\bboj\b.*(rate|policy|meeting)|(rate|policy|meeting).*\bboj\b|東京都区部|全国.*消費者物価|日本.*コアcpi/;
  const secondTier = /inflation|producer price index|\bppi\b|gross domestic product|\bgdp\b|retail sales|jobless claims|unemployment|employment|average hourly earnings|wage|\bjolts\b|\badp\b|\bism\b|\bpmi\b|tankan|industrial production|consumer confidence|fomc minutes|meeting minutes|summary of opinions|central bank.*speech|governor.*speech|testimony|intervention/;
  if ((region === "us" || region === "japan") && topTier.test(title)) return 3;
  if ((region === "us" || region === "japan") && secondTier.test(title)) return Math.max(sourceScore, 2);
  return sourceScore;
}
const LEVEL_TEXT = { 3: "重要度 高", 2: "重要度 中", 1: "重要度 低", 0: "重要度 —" };
function eventDate(event) {
  const raw = event.time_utc || event.datetime || event.date;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
function eventValues(event) {
  return {
    prior: event.prior ?? event.previous ?? event.previous_value,
    consensus: event.consensus ?? event.forecast ?? event.estimate,
    actual: event.actual ?? event.actual_value
  };
}
function safeFinanceCalendarUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return ["financecalendar.com", "www.financecalendar.com"].includes(url.hostname) && url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}
function kissFxDailyUrl(date) {
  if (!date) return "";
  const ymd = dayKey(date).replaceAll("-", "");
  return /^\d{8}$/.test(ymd) ? `https://kissfx.com/article/fxdays${ymd}.html` : "";
}

function visibleCalendarEvents() {
  const region = calendarRegionFilter.value;
  const min = calendarImportanceFilter.value === "high" ? 3 : calendarImportanceFilter.value === "medium" ? 2 : 0;
  const scope = segValue($("#calendar-scope"));
  const todayKey = dayKey(new Date());
  const weekEnd = Date.now() + 7 * 86400e3;
  return calendarEvents.filter(event => {
    if (region !== "all" && eventRegion(event) !== region) return false;
    if (eventImportanceScore(event) < min) return false;
    const d = eventDate(event);
    if (scope === "today" && (!d || dayKey(d) !== todayKey)) return false;
    if (scope === "week" && (!d || d.getTime() > weekEnd)) return false;
    return true;
  });
}

function renderEventRow(event) {
  const d = eventDate(event);
  const lv = eventImportanceScore(event);
  const name = japaneseEventName(event);
  const url = safeFinanceCalendarUrl(event.url);
  const v = eventValues(event);
  const region = eventRegion(event);
  const hasActual = displayValue(v.actual) !== "—";

  const links = el("div", { class: "ev-links" });
  const kiss = kissFxDailyUrl(d);
  if (kiss) links.append(el("a", { href: kiss, target: "_blank", rel: "noopener noreferrer", text: "同日の指標ランク（羊飼いのFXブログ）" }));
  links.append(el("a", { href: "https://www.oanda.jp/lab-education/calendar/", target: "_blank", rel: "noopener noreferrer", text: "修正値・結果（OANDA）" }));

  return el("article", { class: `ev lv-${lv}` },
    el("div", { class: "ev-time" }, d && !event.all_day ? fmtTime.format(d) : "終日", el("small", { text: region === "us" ? "米国" : region === "japan" ? "日本" : "" })),
    el("div", {},
      el("h3", { class: "ev-name" }, url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: name }) : name),
      el("div", { class: "ev-meta" },
        el("span", { class: `lv lv-${lv}`, text: LEVEL_TEXT[lv] }),
        hasActual ? el("span", { class: "chip up", text: "発表済み" }) : null)),
    el("div", { class: "vals" },
      el("div", { class: "val" }, el("small", { text: "前回" }), el("strong", { text: displayValue(v.prior) })),
      el("div", { class: "val" }, el("small", { text: "市場予想" }), el("strong", { text: displayValue(v.consensus) })),
      el("div", { class: `val${hasActual ? " actual" : ""}` }, el("small", { text: "結果" }), el("strong", { text: displayValue(v.actual) }))),
    links);
}

function groupByDay(events) {
  const groups = new Map();
  events.forEach(event => {
    const d = eventDate(event);
    const key = d ? dayKey(d) : "未定";
    if (!groups.has(key)) groups.set(key, { date: d, events: [] });
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
      el("strong", { text: calendarEvents.length ? "条件に合うイベントはありません" : "イベントを読み込んでいます" }),
      calendarEvents.length ? (scope === "today" ? "今日はドル円関連の指標がありません。期間を「14日間」にすると先の予定が見られます。" : "地域や重要度の絞り込みを広げてください。") : "")));
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
        const d = eventDate(event);
        const lv = eventImportanceScore(event);
        const url = safeFinanceCalendarUrl(event.url) || "#/calendar";
        col.append(el("a", { class: `bcard lv-${lv}`, href: url, target: url.startsWith("http") ? "_blank" : null, rel: "noopener noreferrer" },
          el("time", { text: d && !event.all_day ? fmtTime.format(d) : "終日" }),
          el("b", { text: japaneseEventName(event) })));
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
  const upcoming = calendarEvents
    .filter(e => { const d = eventDate(e); return d && d.getTime() > now - 30 * 60e3; })
    .sort((a, b) => eventDate(a) - eventDate(b));
  const pick = upcoming.find(e => eventImportanceScore(e) >= 3) || upcoming.find(e => eventImportanceScore(e) >= 2) || upcoming[0];
  clearInterval(nextEventTimer);
  const todayCount = calendarEvents.filter(e => { const d = eventDate(e); return d && dayKey(d) === dayKey(new Date()); }).length;
  $("#sub-cal").textContent = todayCount ? `今日 ${todayCount}件` : "米国・日本";

  if (!pick) {
    host.replaceChildren(el("div", { class: "empty" }, el("strong", { text: "予定されている重要指標はありません" }), "14日以内の米国・日本の指標が見つかると表示されます。"));
    return;
  }
  const d = eventDate(pick);
  const v = eventValues(pick);
  const lv = eventImportanceScore(pick);
  const released = displayValue(v.actual) !== "—";
  const hasForecast = displayValue(v.consensus) !== "—";
  const stage = released ? 3 : d.getTime() <= now ? 2 : hasForecast ? 2 : 1;

  const countdown = el("span", { class: "countdown" });
  const tick = () => {
    const diff = d.getTime() - Date.now();
    if (released) { countdown.replaceChildren("発表済み"); return; }
    if (diff <= 0) { countdown.replaceChildren("発表時刻です"); return; }
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

  const url = safeFinanceCalendarUrl(pick.url);
  const step = (n, label, value) => el("div", { class: `step${stage > n ? " done" : stage === n ? " now" : ""}` },
    el("div", { class: "step-dot", text: n }), el("small", { text: label }), el("strong", { text: displayValue(value) }));

  const stepper = el("div", { class: "stepper", style: `--progress:${stage >= 3 ? 100 : stage === 2 ? 50 : 0}%` },
    step(1, "前回", v.prior), step(2, "市場予想", v.consensus), step(3, "結果", v.actual));

  host.replaceChildren(
    el("div", { class: "ne-top" },
      el("span", { class: `lv lv-${lv}`, text: LEVEL_TEXT[lv] }),
      el("span", { class: "chip", text: eventRegion(pick) === "japan" ? "日本" : "米国" }),
      countdown),
    el("h3", { class: "ne-name" }, url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: japaneseEventName(pick) }) : japaneseEventName(pick)),
    el("div", { class: "ne-when", text: `${fmtMD.format(d)}（${fmtWeek.format(d)}）${pick.all_day ? "終日" : fmtTime.format(d) + " 発表"}` }),
    stepper,
    el("div", { class: "ne-links" },
      el("a", { class: "ghost-btn", href: "#/calendar?scope=today" }, icon("i-cal"), "今日の指標"),
      el("a", { class: "ghost-btn", href: "#/chart" }, icon("t-chart"), "チャートを見る")));
}

async function loadCalendar() {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 14);
  const endpoint = new URL("https://www.financecalendar.com/wp-json/fc/v1/calendar");
  endpoint.search = new URLSearchParams({ from: localDateString(start), to: localDateString(end), limit: "500" });
  try {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const events = Array.isArray(payload) ? payload : (payload.events || payload.data?.events || payload.data || []);
    calendarEvents = (Array.isArray(events) ? events : [])
      .filter(event => isFxRelevantEvent(event) && ["us", "japan"].includes(eventRegion(event)))
      .sort((a, b) => (eventDate(a) || 0) - (eventDate(b) || 0));
    $("#calendar-status").textContent = `${calendarEvents.length}件・${fmtTime.format(new Date())}更新`;
  } catch {
    $("#calendar-status").textContent = "取得できません";
    if (!calendarEvents.length) {
      $("#calendar-feed").replaceChildren(el("div", { class: "list-card" }, el("div", { class: "empty" }, el("strong", { text: "経済イベントを読み込めませんでした" }), "時間をおいて、右上の状態ボタンから再読み込みしてください。")));
      $("#next-event").replaceChildren(el("div", { class: "empty", text: "指標を読み込めませんでした" }));
    }
    return;
  }
  renderCalendarEvents();
  renderNextEvent();
}

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
  const newsHits = hits(newsItems, i => [newsTitle(i), i.summary || "", i.source || "", i.category || ""].join(" ")).filter(i => !speakerUrls.has(i.url)).slice(0, 6);
  const eventHits = hits(calendarEvents, e => [japaneseEventName(e), e.title || ""].join(" ")).slice(0, 5);

  globalResults.replaceChildren();
  const group = (label, rows) => { if (rows.length) globalResults.append(el("div", { class: "result-group", text: label }), ...rows); };
  group("要人発言", speakerHits.map(({ item, speaker }) => el("a", { class: "result", href: safeUrl(item.url) || "#/speakers", target: safeUrl(item.url) ? "_blank" : null, rel: "noopener noreferrer" },
    highlight(newsTitle(item), query), el("small", { text: `${speaker.name}・${newsDate(item) ? relTime(newsDate(item)) : ""}` }))));
  group("ニュース", newsHits.map(item => el("a", { class: "result", href: safeUrl(item.url) || "#/news", target: safeUrl(item.url) ? "_blank" : null, rel: "noopener noreferrer" },
    highlight(newsTitle(item), query), el("small", { text: `${sourceLabel(item.source)}・${newsDate(item) ? relTime(newsDate(item)) : ""}` }))));
  group("経済指標", eventHits.map(event => { const d = eventDate(event); return el("a", { class: "result", href: "#/calendar" },
    highlight(japaneseEventName(event), query), el("small", { text: d ? `${fmtMD.format(d)}（${fmtWeek.format(d)}）${fmtTime.format(d)}` : "日時未定" })); }));
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

theme.sync();
widgets.ticker();
route();
loadNews();
loadCalendar();
setInterval(loadNews, 60_000);
setInterval(loadCalendar, 5 * 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadNews();
});

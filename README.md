# FX速報 AI

ドル円・豪ドル円・豪ドル米ドル向けに、速報ニュース・要人発言・日米豪の経済指標・通貨強弱・チャート・X投稿をまとめて見られる個人向けダッシュボード。
スマホのホーム画面に追加すると、アプリのように使えます（PWA）。

## 主な機能
- 速報ピックアップ／次の重要指標（カウントダウン付き）／まとめて検索
- 速報ニュース（重要度・情報源・ドル円への影響で絞り込み、あとで読むに保存）
- 上部に USD/JPY・AUD/JPY・AUD/USD のレート
- 経済指標（日米豪・前回／予想／結果つき、リスト／ボード表示）。重要度「高」は発表前後に上部の速報バナーとニュース欄に表示
- 要人発言（日米豪の首相・大統領、財務大臣・財務官、日銀・FRB・RBA など）、通貨強弱、チャート、X投稿（公開リスト）
- ライト／ダーク／自動のテーマ切り替え

## ファイル
- `index.html` … 画面
- `assets/app.css` … デザイン（色はすべて先頭のトークンで管理）
- `assets/app.js` … 動作
- `manifest.webmanifest`, `sw.js`, `icons/` … アプリ化（ホーム画面に追加）
- `scripts/fetch_news.py` + `.github/workflows/fetch-news.yml` … 15分ごとに公式RSS・要人発言の報道を取得してSupabaseへ保存
- `scripts/fetch_calendar.py` + `.github/workflows/fetch-calendar.yml` … TradingViewの経済指標（日米豪）を1〜4分ごとに取得し、`data` ブランチの `calendar.json` に保存。Telegramの設定があれば重要指標の発表前・結果を通知（止めるときはリポジトリの Variables に `TELEGRAM_ALERTS` = `off`）

個人向けの情報整理用です。重要度や影響は見出しのキーワードによる目安で、売買推奨ではありません。

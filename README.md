# 初読の赤入れリーダー

自作の日本語小説（Markdown・EPUB）を縦書きで読み、気づいた箇所にひと言を残して、読みかけの位置に戻るための個人用ツールです。原稿はブラウザーの中だけで扱い、どこにも送信しません。

アプリケーション仕様は [OKF v0.2 ナレッジ索引](./docs/knowledge/index.md) から参照できます。まず [目的・動作環境](./docs/knowledge/overview.md) を読み、実装・検証・運用の各文書へ進んでください。

## 実装の状況

段階的に実装中です。初版の必須項目（[§1](./docs/knowledge/overview.md#section-1)）がそろい、[§9](./docs/knowledge/verification.md#section-9)の確認に合格するまではリリースしません。

| 範囲 | 状況 |
|---|---|
| 縦書き表示・ページ送り・目次・文字設定・明暗テーマ | 実装済み |
| 赤入れ（単ページ・ページまたぎ）・一覧 | 未実装 |
| 保存・復元・書き出し・再割り当て | 未実装 |
| オフライン（通常タブの再起動） | 仕組みのみ。実機未確認 |

## 開発

Node.js 22 を使います。

```sh
npm ci
npm run dev          # 開発サーバー（http://localhost:5173/reading-notes/）
npm test             # 本文モデル・解析の単体テスト（Vitest）
npm run build        # 本番ビルド（CSP の meta と Service Worker を含む）
npx playwright test  # E2E（Chromium・WebKit。先に build が必要）
```

`main` への push で GitHub Pages（`/reading-notes/`）に公開します。リポジトリの Settings → Pages で Source を「GitHub Actions」にしてください。

## 対応形式と上限

- Markdown（`.md`、`.markdown`、UTF-8）：見出し・段落・改行・リスト・強調。ルビは `｜親文字《よみ》` の形だけ。生HTMLは文字列のまま表示し、画像は代替テキストだけを表示します。
- EPUB 3（DRMなし・リフロー型）：読書順、目次、見出し、段落、ルビ、同梱の PNG・JPEG・静止WebP。原稿側のCSS・フォント・スクリプトは使いません。
- 上限は暫定値です（[§9.4](./docs/knowledge/verification.md#section-9-4)）：ファイル 50 MB、EPUB展開後 200 MB、画像1点 10 MB・4,000万画素。

## 操作

- 左端タップ・右スワイプ・「← 次へ」で次のページ、右端タップ・左スワイプ・「前へ →」で前のページ。キーボードでは ← / → も使えます。
- 文字を選択している間はページ送りをしません。

## サンプル

`samples/anata-made-sankagetsu.epub` は作者の許諾を得て置いている検証用サンプル（『あなたまで三か月』）です。著作権は作者に帰属し、奥付の表示に従い、無断の複製・転載はできません。`samples/sample.md` はルビ・縦中横・見出し・生HTMLの扱いを確かめるための短い試験用原稿です。

私用の原稿・赤入れ・バックアップはこのリポジトリに置かないでください（[通信・オフライン・公開](./docs/knowledge/deployment.md#section-8)）。

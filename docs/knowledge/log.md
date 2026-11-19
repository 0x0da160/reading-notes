# 仕様ナレッジ変更ログ

## 2026-11-19

* iPhoneで画面全体が縦にスクロールする報告を受け、画面全体を固定した。[実機チェックリスト](./device-checklist.md)に項目1dを加えた。依頼者の指定で、[リーダーと画面](./reader.md)のピンチズームを残す規定を、拡大させない規定に改めた。
* 依頼者が記入する[iPhone実機チェックリスト](./device-checklist.md)を加えた（全項目未実施）。
* アプリの実装を始め、[検証](./verification.md#section-9-4)に読み込み上限の暫定値を記録した（実機未計測）。
* Modern Web Guidanceと照合し、次を改めた。
  * [通信・オフライン・公開](./deployment.md#section-8)：原稿のDOMをAPIで組み立て直すことと、`<meta>` のCSP（Trusted Typesを含む）で通信とHTML挿入を制限することを定めた。
  * [位置モデル](./position-model.md#section-6-1)：ハイライトの描画をCSS Custom Highlight APIに確定し、傍線と重なり順の実現方法を定めた。
  * [リーダーと画面](./reader.md)：`color-scheme` のmeta要素とテーマ設定の同期読込を加え、Enterに保存を割り当てないことで変換確定による誤保存を防いだ。
  * [実装構成](./architecture.md)：Workerを使わず、長い処理を区切ることにした。
* サンプルEPUBの構造と配色の計算値を照合し、次を改めた。
  * [実装構成](./architecture.md)：ダイアログをネイティブ `<dialog>` に統一し、UIライブラリを外した。コード分割をやめて必須機能を初期バンドルに入れ、[現在のタブでの継続](./deployment.md#section-8)から準備完了表示の仕組みを省いた。
  * [リーダーと画面](./reader.md)：原稿CSSを使わない場合の段落字下げと縦中横の規則、`rp`・`hidden`・本文中リンク・NCXの扱い、Markdownの章の見出しレベルを定めた。配色トークンを `light-dark()` で一本化し、確定注釈も塗りだけで示さないようにした。
  * [位置モデル](./position-model.md)：位置の単位をUTF-16コード単位に、文脈を書記素数に改め、重複した記述をまとめた。
  * [検証](./verification.md)：自動テストをChromiumとWebKitの両方で行い、上記のEPUB構造を試験対象に加えた。
* [ナレッジ運用](./deliverables.md#section-11)で定めた規約検査をCIに追加した。
* 統合実装要件をレビューし、[仕様ナレッジ](./index.md)として分冊化した。
* [位置モデル](./position-model.md)、[保存・書き出し](./persistence.md)、[オフライン準備](./deployment.md)、[実機合格条件](./verification.md)を明確にした。実機測定・人による承認は未実施。

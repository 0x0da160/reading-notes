# 仕様ナレッジ変更ログ

## 2026-11-19

* サンプルEPUBの構造と配色の計算値を照合し、次を改めた。
  * [実装構成](./architecture.md)：ダイアログをネイティブ `<dialog>` に統一し、UIライブラリを外した。コード分割をやめて必須機能を初期バンドルに入れ、[現在のタブでの継続](./deployment.md#section-8)から準備完了表示の仕組みを省いた。
  * [リーダーと画面](./reader.md)：原稿CSSを使わない場合の段落字下げと縦中横の規則、`rp`・`hidden`・本文中リンク・NCXの扱い、Markdownの章の見出しレベルを定めた。配色トークンを `light-dark()` で一本化し、確定注釈も塗りだけで示さないようにした。
  * [位置モデル](./position-model.md)：位置の単位をUTF-16コード単位に、文脈を書記素数に改め、重複した記述をまとめた。
  * [検証](./verification.md)：自動テストをChromiumとWebKitの両方で行い、上記のEPUB構造を試験対象に加えた。
* [ナレッジ運用](./deliverables.md#section-11)で定めた規約検査をCIに追加した。
* 統合実装要件をレビューし、[仕様ナレッジ](./index.md)として分冊化した。
* [位置モデル](./position-model.md)、[保存・書き出し](./persistence.md)、[オフライン準備](./deployment.md)、[実機合格条件](./verification.md)を明確にした。実機測定・人による承認は未実施。

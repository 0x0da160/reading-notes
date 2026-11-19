// テーマ設定を初回描画前に同期で反映する。読めなければ端末追従のまま（§4.2）。
(function () {
  try {
    var t = localStorage.getItem('reading-notes:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();

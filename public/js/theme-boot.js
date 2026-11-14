/* Applies the saved theme before first paint. Loaded synchronously in <head>. */
(function () {
  'use strict';
  try {
    var saved = localStorage.getItem('uc.theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.dataset.theme = saved;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      document.documentElement.dataset.theme = 'light';
    }
  } catch (e) {
    /* storage blocked: keep the default dark theme */
  }
})();

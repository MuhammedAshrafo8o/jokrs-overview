/* app.js — bootstrap. Opens directly from the file system (no build, no server). */
(function () {
  'use strict';
  var JK = window.JK;
  try {
    JK.Store.init();
  } catch (e) {
    console.error(e);
    document.getElementById('main').innerHTML = '<p style="padding:24px">تعذّر تهيئة بيانات العرض: ' + String(e.message).replace(/</g, '&lt;') + '</p>';
    return;
  }
  JK.Store.subscribe(function () { JK.UI.render(); });
  JK.UI.bindEvents();
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/overview');
  JK.UI.onRoute();
})();

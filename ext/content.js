// Runs on Classroom / PowerSchool / Genesis pages. Re-reads the page as it changes and sends it to StudyDash.
(function () {
  var last = '', timer = null, shown = false;
  function toast(text) {
    var d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#0a0f1f;color:#eef2ff;font:600 13px system-ui,sans-serif;padding:9px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transition:opacity .25s';
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.style.opacity = '1'; });
    setTimeout(function () { d.style.opacity = '0'; setTimeout(function () { d.remove(); }, 300); }, 2600);
  }
  function send() {
    var out;
    try { out = __sdRead(); } catch (e) { return; }
    if (!out.courses.length && !out.items.length && !out.tasks.length && !(out.mail && out.mail.length) && !(out.formulas && out.formulas.length)) return;
    var key = JSON.stringify([out.courses, out.items, out.tasks, out.mail, out.formulas]);
    if (key === last) return;
    last = key;
    try {
      chrome.runtime.sendMessage({ type: 'studydash', data: out }, function (r) {
        if (chrome.runtime.lastError || !r) return;
        if (!r.ok) { if (!shown) toast('StudyDash isn’t running. Open it to sync.'); shown = true; return; }
        if (!shown || r.added) toast(r.added ? '✓ StudyDash: ' + r.added + ' new' : '✓ Synced to StudyDash');
        shown = true;
      });
    } catch (e) {}
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(send, 1500); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();

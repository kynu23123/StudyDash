// StudyDash Sync: passes what the page reader found to the StudyDash app running on this computer.
const PORTS = [47322];
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'studydash') return;
  Promise.all(PORTS.map(p => fetch(`http://127.0.0.1:${p}/api/web/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: msg.data }),
  }).then(r => (r.ok ? r.json() : null)).catch(() => null)))
    .then(rs => {
      const ok = rs.filter(Boolean);
      const added = ok.reduce((a, r) => a + (r.added || 0), 0);
      chrome.action.setBadgeText({ text: ok.length ? '✓' : '!' });
      chrome.action.setBadgeBackgroundColor({ color: ok.length ? '#1a7f37' : '#d1242f' });
      chrome.action.setTitle({ title: ok.length ? `StudyDash Sync: updated ${new Date().toLocaleTimeString()}` : 'StudyDash Sync: StudyDash isn\'t running' });
      reply({ ok: ok.length > 0, added });
    });
  return true;
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

test('production starts blank and saves a user profile and custom routines', { timeout: 20000 }, async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'studydash-test-'));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const child = spawn(process.execPath, ['app.js', '--background'], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, STUDYDASH_DATA: data, STUDYDASH_PORT: String(port), STUDYDASH_TEST: '1' },
  });
  t.after(async () => {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode === null) { child.kill(); await exited; }
    assert.equal(path.dirname(path.resolve(data)), path.resolve(os.tmpdir()));
    fs.rmSync(data, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${port}`;
  const api = async (route, body) => {
    const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.ok(response.ok, `${route}: ${response.status}`);
    return response.json();
  };
  let state;
  for (let i = 0; i < 100; i++) {
    try { state = await api('/api/state'); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(state, 'backend started');
  assert.equal(state.settings.name, '');
  assert.equal(state.routines.length, 0);
  assert.equal([...state.todayList, ...state.anytime, ...state.overdue, ...state.upcoming].length, 0);
  assert.equal(state.spacecat, undefined);
  assert.equal(state.classroom.connected, false);
  assert.equal(state.gmail.connected, false);
  for (const route of ['/sc', '/appeals', '/api/sc/attempt/example']) assert.equal((await fetch(origin + route)).status, 404);
  await api('/api/settings', { name: 'Alex Rivera', category_colors: { study: '#56789a' } });
  await api('/api/routines', { title: 'My study session', category: 'study', color: '#aabbcc', days: '0,1,2,3,4,5,6', time: '18:00', minutes: 25 });
  state = await api('/api/state');
  assert.equal(state.settings.name, 'Alex Rivera');
  assert.equal(state.settings.category_colors.study, '#56789a');
  assert.equal(state.routines[0].title, 'My study session');
  assert.equal(state.routines[0].color, '#aabbcc');
  const payload = state.iq.code.match(/^LTN-([\w-]+)\./)[1];
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).n, 'Alex Rivera');
});

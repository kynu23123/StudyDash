'use strict';
// StudyDash — daily dashboard, reminders and Google Classroom sync.
// Single-file Node app packaged as a Windows Single Executable Application.

process.emitWarning = () => {}; // no console in GUI mode; keep stderr quiet

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const EDITION = 'ltn';
const LTN = true;
const APP_NAME = 'StudyDash';
const PORT = Number(process.env.STUDYDASH_PORT || 47322);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DATA_DIR = process.env.STUDYDASH_DATA || path.join(process.env.APPDATA || os.homedir(), 'StudyDash Production');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- logging (GUI subsystem has no stdout) ----------
const LOG_FILE = path.join(DATA_DIR, 'studydash.log');
try { if (fs.statSync(LOG_FILE).size > 2e6) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch {}
function log(...a) {
  const line = `[${new Date().toISOString()}] ` + a.map(x => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}
console.log = console.info = console.warn = console.error = console.debug = log;
process.on('uncaughtException', e => log('uncaught', e));
process.on('unhandledRejection', e => log('unhandled', e));

// ---------- assets ----------
let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch { sea = null; }
function asset(name, enc) {
  if (sea) { const b = Buffer.from(sea.getAsset(name)); return enc ? b.toString(enc) : b; }
  const p = path.join(__dirname, name.startsWith('ext-') ? path.join('ext', name.slice(4)) : name);
  return enc ? fs.readFileSync(p, enc) : fs.readFileSync(p);
}

// ---------- time helpers (all local time) ----------
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const today = () => ymd(new Date());
function addDays(dateStr, n) { const [y, m, d] = dateStr.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); }
function localMs(dateStr, timeStr) { const [y, m, d] = dateStr.split('-').map(Number); const [h, mi] = (timeStr || '23:59').split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); }
function fmtTime(t) { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; }
function fmtDay(dateStr) {
  const t = today();
  if (dateStr === t) return 'today';
  if (dateStr === addDays(t, 1)) return 'tomorrow';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

// ---------- database ----------
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(DATA_DIR, 'studydash.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  category TEXT DEFAULT 'other',
  due_date TEXT,
  due_time TEXT,
  remind_at INTEGER,
  notified INTEGER DEFAULT 0,
  done INTEGER DEFAULT 0,
  done_at INTEGER,
  source TEXT DEFAULT 'manual',
  external_id TEXT UNIQUE,
  course TEXT,
  link TEXT,
  minutes INTEGER,
  color TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE TABLE IF NOT EXISTS routines(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'other',
  days TEXT DEFAULT '1,2,3,4,5',
  time TEXT DEFAULT '17:00',
  minutes INTEGER DEFAULT 30,
  notes TEXT DEFAULT '',
  color TEXT,
  enabled INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE,
  source TEXT,
  course TEXT,
  text TEXT,
  link TEXT,
  created_at INTEGER,
  likely INTEGER DEFAULT 0,
  why TEXT,
  sug_title TEXT,
  sug_date TEXT,
  sug_time TEXT,
  state TEXT DEFAULT 'new',
  task_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
CREATE TABLE IF NOT EXISTS iq_events(
  ext TEXT PRIMARY KEY,
  course TEXT,
  title TEXT,
  link TEXT,
  due_ms INTEGER,
  at_ms INTEGER,
  status TEXT,
  grade_pct REAL,
  delta REAL
);
CREATE TABLE IF NOT EXISTS grade_courses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT, course TEXT, teacher TEXT, period TEXT,
  terms TEXT, cur_term TEXT, cur_letter TEXT, cur_pct REAL, prev_pct REAL,
  absences INTEGER, tardies INTEGER, updated_at INTEGER,
  UNIQUE(source, course)
);
CREATE TABLE IF NOT EXISTS grade_items(
  ext TEXT PRIMARY KEY, source TEXT, course TEXT, name TEXT, category TEXT, due_date TEXT,
  score REAL, max REAL, pct REAL, status TEXT, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS friends(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  iq INTEGER,
  stats TEXT,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS mail(
  id TEXT PRIMARY KEY, source TEXT, sender TEXT, sender_addr TEXT, subject TEXT, preview TEXT, received_at INTEGER, link TEXT,
  cls TEXT, score REAL, why TEXT, starred INTEGER DEFAULT 0, unread INTEGER DEFAULT 0, seen INTEGER DEFAULT 0, notified INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0, task_id INTEGER, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mail_recv ON mail(received_at);
CREATE TABLE IF NOT EXISTS mail_senders(sender TEXT PRIMARY KEY, cls TEXT);
CREATE TABLE IF NOT EXISTS grade_formulas(course TEXT PRIMARY KEY, teacher TEXT, data TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS grade_meta(course TEXT PRIMARY KEY, level TEXT, credits REAL, include INTEGER DEFAULT 1, weights TEXT, target REAL);
CREATE TABLE IF NOT EXISTS opportunities(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_id TEXT UNIQUE,
  thread_id TEXT,
  subject TEXT,
  sender TEXT,
  snippet TEXT,
  received_at INTEGER,
  kind TEXT,
  score INTEGER DEFAULT 0,
  deadline TEXT,
  status TEXT DEFAULT 'new',
  task_id INTEGER
);
`);

try { db.exec('ALTER TABLE grade_items ADD COLUMN term TEXT'); } catch {}
try { db.exec("ALTER TABLE opportunities ADD COLUMN acct TEXT DEFAULT 'gm'"); } catch {}
try { db.exec('ALTER TABLE mail ADD COLUMN due TEXT'); } catch {}
try { db.exec('ALTER TABLE mail ADD COLUMN manual_cls INTEGER DEFAULT 0'); } catch {}
for (const table of ['tasks', 'routines']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'color')) db.exec(`ALTER TABLE ${table} ADD COLUMN color TEXT`);
}
const DEFAULTS = {
  name: '', digest_enabled: '1', digest_time: '07:00', hw_lead_hours: '3',
  autostart: '0', notif_mode: 'app', sync_minutes: '30', seeded: '0',
  gc_client_id: '', gc_client_secret: '', gm_client_id: '', gm_client_secret: '', gmm_first_done: '0', gmail_alerts: '1', gc_refresh_token: '', gc_access_token: '', gc_expiry: '0',
  gc_last_sync: '0', gc_status: '', gc_error: '', gc_scopes: '', last_digest: '',
  cv_base: '', cv_ics: '', cv_token: '', cv_last_sync: '0', cv_status: '', cv_error: '',
  gm_refresh_token: '', gm_access_token: '', gm_expiry: '0', gm_email: '', gm_last_sync: '0', gm_status: '', gm_error: '',
  portal_url: '', grades_last_import: '0', grades_source: '',
  evening_enabled: '1', evening_time: '18:30', last_evening: '', evening2_enabled: '1', evening2_time: '20:30', last_evening2: '', startup_open: '0',
  ms_client_id: '', ms_tenant: 'organizations', ms_refresh_token: '', ms_access_token: '', ms_expiry: '0', ms_email: '', ms_status: '', ms_error: '',
  ms_first_done: '0', ms_last_sync: '0', ms_web_last: '0', mail_notify: '1', gpa_cfg: '',
  gm_activities: '', gm_extra: '', gm_days: '60', ann_notify: 'likely', opp_notify: '1', early_cutoff: '12:00',
};
function getS(k) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : (DEFAULTS[k] ?? ''); }
function setS(k, v) { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v)); }

function seed() {
  if (getS('seeded') !== '1') setS('seeded', '1');
}

const CATS = { homework: 'Homework', study: 'Study', hccc: 'College', opps: 'Opportunity', other: 'Other' };
const validColor = value => value == null || value === '' || (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value));
const savedColor = value => value ? value.toLowerCase() : null;
function categoryColors() {
  const saved = jparse(getS('category_colors'));
  return Object.fromEntries(Object.keys(CATS).filter(key => saved && saved[key] && validColor(saved[key])).map(key => [key,saved[key]]));
}

// ---------- routine instances ----------
function ensureRoutineInstances() {
  const t = today(), dow = new Date().getDay(), now = Date.now();
  const routines = db.prepare('SELECT * FROM routines WHERE enabled=1').all();
  for (const r of routines) {
    if (!String(r.days).split(',').map(Number).includes(dow)) continue;
    const ext = `routine:${r.id}:${t}`;
    const remind = localMs(t, r.time);
    const ex = db.prepare('SELECT * FROM tasks WHERE external_id=?').get(ext);
    if (!ex) {
      db.prepare(`INSERT INTO tasks(title,notes,category,due_date,due_time,remind_at,notified,source,external_id,minutes,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(r.title, r.notes || '', r.category, t, r.time, remind, remind < now - 30 * MIN ? 1 : 0, 'routine', ext, r.minutes, now);
    } else if (!ex.done && !ex.notified && ex.due_time !== r.time) {
      db.prepare('UPDATE tasks SET due_time=?, remind_at=? WHERE id=?').run(r.time, remind, ex.id);
    }
  }
}

// ---------- notifications ----------
const trayQueue = [];
let trayQuit = false, lastTrayPoll = 0;
const xmlEsc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const APP_AUMID = 'StudyDash.Production';
const PS_AUMID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

function runPS(script) {
  return new Promise(resolve => {
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', enc],
      { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => resolve({ ok: !err, err: err ? String(stderr || err.message) : '' }));
  });
}

function registerAumid() {
  if (!IS_WIN) return;
  const iconPath = path.join(DATA_DIR, 'icon.png');
  try { fs.writeFileSync(iconPath, asset('icon.png')); } catch (e) { log(e); }
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_AUMID}`;
  execFile('reg', ['add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', APP_NAME, '/f'], { windowsHide: true }, () => {});
  execFile('reg', ['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconPath, '/f'], { windowsHide: true }, () => {});
  execFile('reg', ['add', key, '/v', 'IconBackgroundColor', '/t', 'REG_SZ', '/d', 'FF1F6FEB', '/f'], { windowsHide: true }, () => {});
}

async function notify(title, body, { sticky = false } = {}) {
  log('notify', title, '|', body);
  if (!IS_WIN) return { ok: true, dev: true };
  const xml = `<toast ${sticky ? 'scenario="reminder" ' : ''}activationType="protocol" launch="${ORIGIN}/">` +
    `<visual><binding template="ToastGeneric"><text>${xmlEsc(title)}</text><text>${xmlEsc(body)}</text></binding></visual>` +
    `<actions><action content="Open StudyDash" activationType="protocol" arguments="${ORIGIN}/"/>` +
    `<action content="Dismiss" activationType="system" arguments="dismiss"/></actions>` +
    `<audio src="ms-winsoundevent:Notification.${sticky ? 'Reminder' : 'Default'}"/></toast>`;
  const b64 = Buffer.from(xml, 'utf8').toString('base64');
  const script = aumid => `$ErrorActionPreference='Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))
$t = New-Object Windows.UI.Notifications.ToastNotification $x
$t.Tag = 'sd' + [DateTime]::Now.Ticks.ToString().Substring(8)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${aumid}').Show($t)
Start-Sleep -Milliseconds 800
$seen = $true
try { $seen = @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory('${aumid}') | Where-Object { $_.Tag -eq $t.Tag }).Count -gt 0 } catch { $seen = $true }
if (-not $seen) { exit 3 }`;
  const compat = getS('notif_mode') === 'compat';
  let r = await runPS(script(compat ? PS_AUMID : APP_AUMID));
  if (!r.ok && !compat) {
    // Windows ignored the StudyDash app id on this PC: switch to the always-available PowerShell id.
    log('StudyDash toast not delivered, switching to compatibility mode', r.err);
    setS('notif_mode', 'compat');
    r = await runPS(script(PS_AUMID));
  }
  if (!r.ok) { log('toast failed, falling back to tray balloon', r.err); trayQueue.push({ title, body }); }
  return r;
}

function dueSoonHomework(hours = 48) {
  const now = Date.now();
  return db.prepare(`SELECT * FROM tasks WHERE done=0 AND source!='routine' AND due_date IS NOT NULL AND category IN ('homework','study','hccc')`).all()
    .map(t => ({ ...t, ms: localMs(t.due_date, t.due_time) }))
    .filter(t => t.ms <= now + hours * HOUR)
    .sort((a, b) => a.ms - b.ms);
}

async function fireReminder(t) {
  if (t.source === 'routine') {
    if (t.category === 'homework') {
      const list = dueSoonHomework(48);
      const body = list.length
        ? `${list.length} due soon: ` + list.slice(0, 4).map(x => `${x.title} (${fmtDay(x.due_date)}${x.due_time ? ' ' + fmtTime(x.due_time) : ''})`).join(' · ')
        : 'Nothing due in the next 2 days — get ahead or review.';
      return notify(`📚 ${t.title}`, body, { sticky: true });
    }
    const icon = '⏰';
    return notify(`${icon} ${t.title}${t.minutes ? ` · ${t.minutes} min` : ''}`, t.notes || 'Time to start.', { sticky: true });
  }
  if (t.source === 'classroom' || t.source === 'canvas') {
    return notify(`⏳ Due ${fmtDay(t.due_date)} ${fmtTime(t.due_time)}: ${t.title}`, `${t.course || 'Google Classroom'} — not turned in yet.`, { sticky: true });
  }
  return notify(`⏰ ${t.title}`, [t.due_time ? `Due ${fmtDay(t.due_date)} ${fmtTime(t.due_time)}` : '', t.notes].filter(Boolean).join(' — ') || 'Reminder', { sticky: true });
}

async function sendDigest() {
  const t = today();
  const items = db.prepare(`SELECT * FROM tasks WHERE done=0 AND due_date IS NOT NULL AND due_date<=? AND NOT (source='routine' AND due_date<?) ORDER BY due_date, due_time`).all(addDays(t, 1), t)
    .filter(x => x.due_date <= t || workDate(x) <= t);
  const overdue = items.filter(x => x.due_date < t).length;
  const title = `☀️ Good morning, ${getS('name') || 'there'} — ${items.length} thing${items.length === 1 ? '' : 's'} today`;
  const body = (overdue ? `${overdue} overdue. ` : '') + items.slice(0, 5).map(x => x.title).join(' · ');
  return notify(title, body || 'Nothing scheduled. Enjoy the day!');
}

async function sendEveningCheck(second = false) {
  const t = today(), tmr = addDays(t, 1);
  const items = db.prepare(`SELECT * FROM tasks WHERE done=0 AND source!='routine' AND due_date IS NOT NULL AND due_date<=? ORDER BY due_date, due_time`).all(tmr);
  if (!items.length) return;
  const label = x => x.due_date < t ? 'overdue' : x.due_date === t ? (x.due_time ? `today ${fmtTime(x.due_time)}` : 'today') : (x.due_time ? `tomorrow ${fmtTime(x.due_time)}` : 'tomorrow');
  const title = second ? `🌙 Last call: ${items.length} thing${items.length === 1 ? '' : 's'} still not done` : `🌆 ${items.length} thing${items.length === 1 ? '' : 's'} still due soon`;
  const body = items.slice(0, 4).map(x => `${x.title} (${label(x)})`).join(' · ') + (items.length > 4 ? ` +${items.length - 4} more` : '');
  return notify(title, body, { sticky: true });
}

let ticking = false;
async function tick() {
  if (ticking) return; ticking = true;
  try {
    ensureRoutineInstances();
    const now = Date.now(), t = today();
    // morning digest
    if (getS('digest_enabled') === '1' && getS('last_digest') !== t) {
      const at = localMs(t, getS('digest_time'));
      if (now >= at) { setS('last_digest', t); if (now - at < 2 * HOUR) await sendDigest(); }
    }
    // evening check (default 6:30 PM): anything unfinished that's overdue or due by tomorrow
    for (const [k, def, second] of [['evening', '18:30', false], ['evening2', '20:30', true]]) {
      if (getS(`${k}_enabled`) !== '1' || getS(`last_${k}`) === t) continue;
      const at = localMs(t, getS(`${k}_time`) || def);
      if (now >= at) { setS(`last_${k}`, t); if (now - at < 2 * HOUR) await sendEveningCheck(second); }
    }
    // task reminders
    const due = db.prepare('SELECT * FROM tasks WHERE done=0 AND notified=0 AND remind_at IS NOT NULL AND remind_at<=?').all(now);
    for (const task of due) {
      db.prepare('UPDATE tasks SET notified=1 WHERE id=?').run(task.id);
      if (now - task.remind_at <= 30 * MIN) await fireReminder(task);
    }
    // auto sync
    const every = Math.max(10, Number(getS('sync_minutes')) || 30) * MIN;
    if (googleSyncDue('gc', now, every)) syncClassroom().catch(() => {});
    if ((getS('cv_token') || getS('cv_ics')) && now - Number(getS('cv_last_sync')) > every) syncCanvas().catch(() => {});
    if ((jparse(getS('gccal_feeds')) || []).length && now - Number(getS('gccal_last') || 0) > every) syncClassroomCal().catch(() => {});
    for (const ac of ['gm', 'hm']) if (googleSyncDue(ac, now, getS('gmail_alerts') !== '0' ? Math.max(10 * MIN, Math.min(every, 15 * MIN)) : Math.max(every, HOUR))) syncGmail(ac).catch(() => {});
    if (getS('ms_refresh_token') && now - Number(getS('ms_last_sync')) > Math.max(10 * MIN, Math.min(every, 15 * MIN))) syncOutlook().catch(() => {});
    // keep tray alive
    if (IS_WIN && !trayQuit && now - lastTrayPoll > 45e3 && now - trayStartedAt > 45e3) startTray();
  } catch (e) { log('tick', e); }
  finally { ticking = false; }
}

// ---------- autostart ----------
function setAutostart(on) {
  if (process.env.STUDYDASH_TEST) return;
  const executable=process.env.STUDYDASH_DESKTOP_EXE || (sea ? process.execPath : null);
  if (!executable) { log("Autostart is managed by the source launcher."); return; }
  if (!IS_WIN) return;
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const args = on ? ['add', key, '/v', 'StudyDash Production', '/t', 'REG_SZ', '/d', `"${executable}"${getS('startup_open') === '1' ? '' : ' --background'}`, '/f'] : ['delete', key, '/v', 'StudyDash Production', '/f'];
  execFile('reg', args, { windowsHide: true }, err => err && log('autostart', err.message));
}

// ---------- window + tray ----------
let desktopProc = null;
function openDashboard(args=[]) {
  if (!IS_WIN) { log('open', ORIGIN); return; }
  const runtime = process.env.STUDYDASH_DESKTOP_EXE || path.join(__dirname, 'runtime', 'electron.exe');
  const environment={...process.env,STUDYDASH_PORT:String(PORT)};
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(runtime, process.env.STUDYDASH_DESKTOP_EXE ? args : [path.join(__dirname, 'desktop')], {
    detached: true, windowsHide:true, stdio: 'ignore', env: environment,
  });
  child.on('error', error => log('desktop launch', error));
  if (!desktopProc) {
    desktopProc = child;
    child.on('exit', () => { if (desktopProc === child) desktopProc = null; });
  }
  child.unref();
}

let trayProc = null, trayStartedAt = 0;
function startTray() {
  if (!IS_WIN) return;
  trayStartedAt = Date.now();
  try {
    const ico = path.join(DATA_DIR, 'themed-icon.ico');
    if (!fs.existsSync(ico)) fs.writeFileSync(ico, asset('icon.ico'));
    const ps1 = path.join(DATA_DIR, 'tray.ps1');
    fs.writeFileSync(ps1, '﻿' + asset('tray.ps1', 'utf8'));
    if (trayProc) { try { trayProc.kill(); } catch {} }
    trayProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-STA', '-File', ps1, '-Port', String(PORT), '-IconPath', ico, '-AppName', APP_NAME],
      { windowsHide: true, stdio: 'ignore' });
    trayProc.on('exit', c => log('tray exited', c));
  } catch (e) { log('tray', e); }
}

// ---------- Google sign-in (shared by Classroom and Gmail) ----------
const GOOGLE_ACCOUNTS = {
  gc: {
    label: 'Google Classroom',
    scopes: [
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      'https://www.googleapis.com/auth/classroom.announcements.readonly',
    ],
  },
  gm: {
    label: 'personal Gmail',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  hm: {
    label: 'HCST school email',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
};
const ANN_SCOPE = 'https://www.googleapis.com/auth/classroom.announcements.readonly';
const SCOPE_NAMES = {
  'classroom.courses.readonly': 'See your Google Classroom classes',
  'classroom.coursework.me.readonly': 'See your Classroom assignments and grades',
  'classroom.announcements.readonly': 'See class announcements',
  'gmail.readonly': 'Read your email',
};
const scopeName = sc => SCOPE_NAMES[sc.split('/').pop()] || sc;
// Google may return scopes as full URLs or short names; compare on the last path part.
const grantedSet = str => new Set(String(str || '').split(/\s+/).filter(Boolean).map(x => x.split('/').pop()));
const REDIRECT = `${ORIGIN}/oauth/callback`;
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let oauthPending = null;
const busy = { gc: false, cv: false, gm: false, hm: false };
// The two Google inboxes: personal Gmail (own key) and HCST school Gmail (school key)
let nextGmailMetadataRead = 0;
const MAIL_ACCTS = { gm: { source: 'gmail', name: 'personal email', course: 'Email', gate: 'gmm_first_done', route: 'gmail' }, hm: { source: 'hcst', name: 'HCST email', course: 'HCST email', gate: 'hmm_first_done', route: 'hcstmail' } };

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error_description || j.error || `token HTTP ${res.status}`); e.code = j.error; throw e; }
  return j;
}

// Gmail can use its own key (a personal Google Cloud project) when the school key is set to Internal.
const clientFor = acct => acct === 'gm' && getS('gm_client_id') ? { id: getS('gm_client_id'), secret: getS('gm_client_secret') } : { id: getS('gc_client_id'), secret: getS('gc_client_secret') };
async function accessToken(acct) {
  if (Number(getS(`${acct}_expiry`)) > Date.now() + 60e3 && getS(`${acct}_access_token`)) return getS(`${acct}_access_token`);
  const rt = getS(`${acct}_refresh_token`);
  if (!rt) throw new Error(`Not connected to ${GOOGLE_ACCOUNTS[acct].label}`);
  if (getS(`${acct}_status`) === 'reauth') throw new Error('Google sign-in expired. Reconnect in Settings.');
  try {
    const cl = clientFor(acct);
    const j = await tokenRequest({ client_id: cl.id, client_secret: cl.secret, refresh_token: rt, grant_type: 'refresh_token' });
    setS(`${acct}_access_token`, j.access_token); setS(`${acct}_expiry`, Date.now() + (j.expires_in || 3600) * 1000);
    return j.access_token;
  } catch (e) {
    if (e.code === 'invalid_grant') {
      setS(`${acct}_status`, 'reauth');
      e.message = 'Google sign-in expired. Reconnect in Settings.';
      setS(`${acct}_error`, e.message);
    }
    throw e;
  }
}

function googleAuthUrl(acct) {
  const verifier = b64url(crypto.randomBytes(32));
  const st = b64url(crypto.randomBytes(16));
  oauthPending = { verifier, state: st, acct, client: clientFor(acct), at: Date.now() };
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientFor(acct).id, redirect_uri: REDIRECT, response_type: 'code', scope: GOOGLE_ACCOUNTS[acct].scopes.join(' '),
    access_type: 'offline', prompt: 'consent select_account', state: st, include_granted_scopes: 'true',
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  });
}

async function gfetch(acct, url) {
  const request = async () => fetch(url, {
    headers: { Authorization: `Bearer ${await accessToken(acct)}` },
    signal: AbortSignal.timeout(30000),
  });
  let res = await request();
  if (res.status === 401) {
    await res.body?.cancel();
    setS(`${acct}_expiry`, 0);
    res = await request();
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j.error?.message || `HTTP ${res.status}`); e.status = res.status;
    const retry = res.headers.get('Retry-After');
    e.retryAt = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : 0;
    e.reason = [j.error?.status, ...(j.error?.errors || []).map(x => x.reason), ...(j.error?.details || []).map(x => x.reason)].filter(Boolean).join(' ');
    throw e;
  }
  return j;
}
const gapi = p => gfetch('gc', 'https://classroom.googleapis.com/v1' + p);
async function listAll(p, key, maxPages = 5) {
  let out = [], token = '';
  for (let i = 0; i < maxPages; i++) {
    const j = await gapi(p + (token ? `&pageToken=${encodeURIComponent(token)}` : ''));
    out = out.concat(j[key] || []);
    if (!j.nextPageToken) break; token = j.nextPageToken;
  }
  return out;
}

// Live checks right after sign-in. 403 = Google or the school said no.
// "Gmail API has not been used in project 123 before or it is disabled" = the API switch is off in the Cloud project (not a school block).
const apiOff = e => /has not been used in project|it is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(`${e.message} ${e.reason || ''}`);
const apiOffInfo = (e, api, name) => {
  const proj = (`${e.message}`.match(/project (\d+)/) || [])[1] || '';
  const link = `https://console.cloud.google.com/apis/library/${api}${proj ? `?project=${proj}` : ''}`;
  return { fatal: true, apiOff: { link, name, proj }, error: `The ${name} is switched off in your Google Cloud project${proj ? ` (${proj})` : ''}. Turn it on, wait a minute, then try again.` };
};
const scopeProblem = e => /insufficient authentication scopes|scope_insufficient|insufficient permission/i.test(e.message || '');
async function probeClassroom() {
  let courses;
  try { courses = (await gapi('/courses?studentId=me&courseStates=ACTIVE&pageSize=50')).courses || []; }
  catch (e) {
    if (googleQuota(e)) return pauseGoogleQuota('gc', e);
    if (e.status === 403 && apiOff(e)) return apiOffInfo(e, 'classroom.googleapis.com', 'Google Classroom API');
    if (e.status === 403) return { fatal: true, school: !scopeProblem(e), error: scopeProblem(e) ? 'Google didn\'t let StudyDash see your classes. Reconnect and allow everything on Google\'s screen.' : `Your school's Google settings block StudyDash from Classroom (${e.message}). The calendar, extension or bookmark options in Settings still work.` };
    return { fatal: true, error: `Couldn't reach Google Classroom: ${e.message}` };
  }
  if (!courses.length) return { courses: 0 };
  let blocked = 0, lastErr = null; const errs = [];
  for (const c of courses.slice(0, 3)) {
    try { await gapi(`/courses/${c.id}/courseWork?pageSize=1`); return { courses: courses.length }; }
    catch (e) { if (googleQuota(e)) return pauseGoogleQuota('gc', e); if (e.status === 403 || e.status === 404) { blocked++; lastErr = e; errs.push(e); } else return { courses: courses.length }; }
  }
  lastErr = errs.find(scopeProblem) || errs[0] || lastErr;
  if (lastErr && scopeProblem(lastErr)) return { courses: courses.length, error: 'Google is blocking StudyDash from reading your assignments. Remove StudyDash at myaccount.google.com/connections and reconnect.' };
  if (lastErr) return { courses: courses.length, school: true, error: `Your school blocks apps from reading Classroom assignments (${lastErr.message}). Use the calendar, extension or bookmark options in Settings instead.` };
  return { courses: courses.length };
}
async function probeGmail(acct = 'gm') {
  try { const p = await gfetch(acct, 'https://gmail.googleapis.com/gmail/v1/users/me/profile'); setS(`${acct}_email`, p.emailAddress || ''); return { courses: 0 }; }
  catch (e) {
    log('gmail probe failed', acct, e.status, e.reason || '', e.message);
    if (googleQuota(e)) return pauseGoogleQuota(acct, e);
    if (e.status === 403 && apiOff(e)) return apiOffInfo(e, 'gmail.googleapis.com', 'Gmail API');
    if (e.status === 403 && scopeProblem(e)) return { fatal: true, error: 'Google didn\'t let StudyDash read your email. Reconnect and tick the Gmail box on Google\'s screen.' };
    if (e.status === 403 && acct === 'hm' && /admin|domain|policy|organization|restricted/i.test(`${e.message} ${e.reason || ''}`)) return { fatal: true, school: true, error: `Your school's Google settings block apps from reading this email (${e.message}).` };
    return { fatal: true, error: `Gmail said no: ${e.message}` };
  }
}

// ---------- shared: tasks from school systems ----------
function upsertSchoolTask({ ext, title, notes, cat, due, course, link, turnedIn, source }, stats) {
  const now = Date.now(), lead = (Number(getS('hw_lead_hours')) || 3) * HOUR;
  // Remind `lead` hours before; if it's already inside that window, remind right away.
  const remind = due ? (due.ms > now ? Math.max(due.ms - lead, now) : due.ms) : null;
  const ex = db.prepare('SELECT * FROM tasks WHERE external_id=?').get(ext);
  if (!ex) {
    if (turnedIn && (!due || due.ms < now)) return; // old & finished: don't clutter
    db.prepare(`INSERT INTO tasks(title,notes,category,due_date,due_time,remind_at,notified,done,done_at,source,external_id,course,link,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(title, notes || '', cat, due?.date ?? null, due?.time ?? null, remind,
      remind && remind >= now && !turnedIn ? 0 : 1, turnedIn ? 1 : 0, turnedIn ? now : null, source, ext, course, link || null, now);
    stats.added++;
  } else {
    const dueChanged = ex.due_date !== (due?.date ?? null) || ex.due_time !== (due?.time ?? null);
    db.prepare(`UPDATE tasks SET title=?, course=?, link=?, due_date=?, due_time=?, remind_at=?, notified=? WHERE id=?`).run(
      title, course, link || null, due?.date ?? null, due?.time ?? null, dueChanged ? remind : ex.remind_at,
      dueChanged ? (remind && remind >= now ? 0 : 1) : ex.notified, ex.id);
    if (dueChanged) stats.updated++;
    if (turnedIn && !ex.done) { db.prepare('UPDATE tasks SET done=1, done_at=? WHERE id=?').run(now, ex.id); stats.completed++; }
  }
}

// ---------- reading dates out of plain text ----------
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function findDate(text, baseMs) {
  const base = new Date(baseMs); base.setHours(0, 0, 0, 0);
  const s = ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';
  const cands = [];
  const at = (d, idx) => cands.push({ d, idx });
  let m;
  const reTom = /\b(tomorrow|tmrw|tmr)\b/g; while ((m = reTom.exec(s))) { const d = new Date(base); d.setDate(d.getDate() + 1); at(d, m.index); }
  const reTod = /\b(tonight|today|end of (the )?day|by midnight)\b/g; while ((m = reTod.exec(s))) at(new Date(base), m.index);
  const reWd = /\b(next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thu|fri|sat)\b/g;
  while ((m = reWd.exec(s))) {
    const word = m[2], full = word.endsWith('day');
    const wd = WEEKDAYS.findIndex(w => w.startsWith(word.slice(0, 3)));
    // abbreviations ("sat", "wed") only count right after a deadline word, e.g. "due fri"
    if (!full && !m[1] && !/(due|by|on|for|before|until)\s$/.test(s.slice(Math.max(0, m.index - 8), m.index))) continue;
    const d = new Date(base); let add = (wd - d.getDay() + 7) % 7; if (add === 0) add = 7;
    d.setDate(d.getDate() + add); at(d, m.index);
  }
  const reMd = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = reMd.exec(s))) {
    const mo = +m[1], da = +m[2]; if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
    let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : base.getFullYear();
    let d = new Date(y, mo - 1, da);
    if (!m[3] && d < base - 60 * DAY) d = new Date(y + 1, mo - 1, da);
    at(d, m.index);
  }
  const reMon = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.? (\d{1,2})(st|nd|rd|th)?\b/g;
  while ((m = reMon.exec(s))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3)); const da = +m[2]; if (mo < 0 || da < 1 || da > 31) continue;
    if (m[1] === 'may' && !/(due|by|on|until|before)\s$/.test(s.slice(Math.max(0, m.index - 8), m.index))) continue;
    let d = new Date(base.getFullYear(), mo, da); if (d < base - 60 * DAY) d = new Date(base.getFullYear() + 1, mo, da);
    at(d, m.index);
  }
  if (!cands.length) return null;
  // Prefer a date right after a deadline word; otherwise the earliest mention.
  const kw = /(due|by|until|before|deadline|apply by|closes?|submit)/g; let best = null;
  while ((m = kw.exec(s))) { const c = cands.filter(c => c.idx >= m.index && c.idx - m.index < 40).sort((a, b) => a.idx - b.idx)[0]; if (c) { best = c; break; } }
  best = best || cands.sort((a, b) => a.idx - b.idx)[0];
  let time = null;
  const tm = s.slice(best.idx, best.idx + 60).match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/) || s.match(/\b(?:by|at|before)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/);
  if (tm) { let h = +tm[1] % 12; if (tm[3][0] === 'p') h += 12; time = `${pad(h)}:${tm[2] || '00'}`; }
  else if (/midnight|11:59/.test(s)) time = '23:59';
  else if (/(start|beginning) of class|in class/.test(s)) time = '08:00';
  return { date: ymd(best.d), time };
}

// Does an announcement read like the teacher is assigning work?
function detectAssignment(text, postedMs) {
  const s = text.toLowerCase();
  let score = 0; const why = [];
  const strong = /\b(due|submit|turn(ed)? (it |them )?in|hand in|upload|homework|hw|assignment|worksheet|problem set|lab report|essay|project|study guide)\b/;
  const medium = /\b(complete|finish|read (chapter|ch\.?|pages?|pp\.?|sections?)|answer (the )?questions|quiz|test|exam|practice|write|prepare|bring|review)\b/;
  if (strong.test(s)) { score += 2; why.push('mentions ' + s.match(strong)[0]); }
  if (medium.test(s)) { score += 1; why.push('asks you to ' + s.match(medium)[0]); }
  if (/\b(please|make sure|don'?t forget|reminder|you (will )?need to|must)\b/.test(s)) score += 0.5;
  const due = findDate(text, postedMs);
  if (due) { score += 1; why.push('has a date'); }
  if (/\b(no (homework|hw|class)|cancel+ed|optional|extra credit opportunity)\b/.test(s)) score -= 1.5;
  const first = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] || text;
  const title = first.length > 90 ? first.slice(0, 87).trim() + '…' : first;
  return { likely: score >= 2.5, score, why: why.join(', '), due, title };
}

function savePost({ ext, source, course, text, link, created }, stats) {
  const ex = db.prepare('SELECT id, state FROM posts WHERE external_id=?').get(ext);
  const det = detectAssignment(text, created);
  if (ex) { db.prepare('UPDATE posts SET text=?, link=?, course=? WHERE id=?').run(text, link, course, ex.id); return; }
  db.prepare(`INSERT INTO posts(external_id,source,course,text,link,created_at,likely,why,sug_title,sug_date,sug_time,state)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(ext, source, course, text, link, created, det.likely ? 1 : 0, det.why, det.title,
    det.due?.date ?? null, det.due?.time ?? null, 'new');
  stats.posts = (stats.posts || 0) + 1;
  const fresh = Date.now() - created < 12 * HOUR && getS(`${source}_ann_ready`) === '1';
  const mode = getS('ann_notify');
  if (fresh && (mode === 'all' || (mode === 'likely' && det.likely))) {
    const snippet = text.replace(/\s+/g, ' ').slice(0, 140);
    notify(det.likely ? `📣 Possible assignment · ${course}` : `📣 New post · ${course}`, snippet, { sticky: det.likely }).catch(() => {});
  }
}

// ---------- Google Classroom ----------
function parseDue(w) {
  if (!w.dueDate) return null;
  const { year, month, day } = w.dueDate;
  const hasTime = !!w.dueTime;
  const h = w.dueTime?.hours ?? 23, m = w.dueTime?.minutes ?? 59;
  const d = hasTime ? new Date(Date.UTC(year, month - 1, day, h, m)) : new Date(year, month - 1, day, 23, 59);
  return { date: ymd(d), time: hm(d), ms: d.getTime() };
}

const googleQuota = e => e.status === 429 || (e.status === 403 && /rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(`${e.reason || ''} ${e.message}`));
function googleSyncDue(acct, now, interval) {
  if (busy[acct] || !getS(`${acct}_refresh_token`) || getS(`${acct}_status`) === 'reauth') return false;
  const retryAt = Number(getS(`${acct}_retry_at`));
  if (retryAt) return now >= retryAt;
  return now - Math.max(Number(getS(`${acct}_last_sync`)) || 0, Number(getS(`${acct}_attempt`)) || 0) > interval;
}
function googleSyncPause(acct) {
  const status = getS(`${acct}_status`);
  if (status === 'reauth') return { deferred: true, message: 'Google sign-in expired. Reconnect in Settings.' };
  const retryAt = Number(getS(`${acct}_retry_at`));
  if (retryAt > Date.now()) return { deferred: true, retryAt, message: getS(`${acct}_error`) };
}
function pauseGoogleQuota(acct, error) {
  const failures = Math.min(6, (Number(getS(`${acct}_quota_failures`)) || 0) + 1);
  const retryAt = Math.max(error.retryAt || 0, Date.now() + 60e3 * 2 ** (failures - 1) + Math.random() * 5000);
  const message = `Google temporarily limited sync requests. StudyDash will retry automatically after ${new Date(retryAt).toLocaleTimeString()}. Your connection is saved.`;
  setS(`${acct}_quota_failures`, failures);
  setS(`${acct}_retry_at`, retryAt);
  setS(`${acct}_status`, 'backoff');
  setS(`${acct}_error`, message);
  return { deferred: true, retryAt, message };
}
function clearGooglePause(acct) {
  setS(`${acct}_retry_at`, 0);
  setS(`${acct}_quota_failures`, 0);
}

async function syncClassroom() {
  const pause = googleSyncPause('gc');
  if (pause) return pause;
  if (busy.gc) return { busy: true };
  busy.gc = true; setS('gc_status', 'syncing');
  const stats = { courses: 0, added: 0, updated: 0, completed: 0, posts: 0 };
  try {
    const now = Date.now();
    const courses = await listAll('/courses?studentId=me&courseStates=ACTIVE&pageSize=100', 'courses');
    stats.courses = courses.length;
    const hasAnn = true; let annBlocked = 0;
    let blocked = 0;
    for (const c of courses) {
      let works = [], subs = [];
      try {
        works = await listAll(`/courses/${c.id}/courseWork?courseWorkStates=PUBLISHED&pageSize=50`, 'courseWork', 3);
        subs = await listAll(`/courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`, 'studentSubmissions', 5);
      } catch (e) { if (!googleQuota(e) && (e.status === 403 || e.status === 404)) { blocked++; log('skip course', c.name, e.message); continue; } throw e; }
      const subMap = new Map(subs.map(s => [s.courseWorkId, s]));
      const cat = 'homework';
      for (const w of works) {
        const due = parseDue(w);
        recordIq(w, subMap.get(w.id), c, due);
        if (due) { if (due.ms < now - 21 * DAY) continue; }
        else if (Date.parse(w.creationTime || 0) < now - 10 * DAY) continue;
        const sub = subMap.get(w.id);
        upsertSchoolTask({
          ext: `gc:${w.id}`, title: w.title || 'Untitled assignment', notes: (w.description || '').slice(0, 500), cat, due,
          course: c.name, link: w.alternateLink, source: 'classroom', turnedIn: !!sub && (sub.state === 'TURNED_IN' || sub.state === 'RETURNED'),
        }, stats);
      }
      if (hasAnn) {
        try {
          const anns = await listAll(`/courses/${c.id}/announcements?announcementStates=PUBLISHED&pageSize=20`, 'announcements', 1);
          for (const a of anns) {
            const created = Date.parse(a.creationTime || 0);
            if (created < now - 30 * DAY || !a.text) continue;
            savePost({ ext: `gc-ann:${a.id}`, source: 'gc', course: c.name, text: a.text, link: a.alternateLink || null, created }, stats);
          }
        } catch (e) { if (googleQuota(e) || getS('gc_status') === 'reauth') throw e; if (e.status === 403) annBlocked++; log('announcements', c.name, e.message); }
      }
    }
    if (hasAnn) setS('gc_ann_ready', '1');
    clearGooglePause('gc');
    setS('gc_last_sync', Date.now()); setS('gc_status', 'ok'); setS('gc_error', '');
    setS('gc_ann_blocked', stats.courses && annBlocked >= stats.courses - blocked && annBlocked > 0 ? '1' : '0');
    if (stats.courses && blocked === stats.courses) { setS('gc_status', 'error'); setS('gc_error', 'Google wouldn\'t share your assignments. Your school may block this; the calendar, extension or bookmark options in Settings still work.'); }
    setS('gc_last_result', JSON.stringify(stats));
    log('classroom sync ok', stats);
    return stats;
  } catch (e) {
    log('classroom sync failed', e);
    if (googleQuota(e)) return pauseGoogleQuota('gc', e);
    if (getS('gc_status') === 'reauth') return googleSyncPause('gc');
    setS('gc_retry_at', 0);
    setS('gc_attempt', Date.now());
    if (getS('gc_refresh_token')) { setS('gc_status', 'error'); setS('gc_error', e.message); }
    throw e;
  } finally { busy.gc = false; if (getS('gc_status') === 'syncing') setS('gc_status', 'ok'); }
}

// ---------- HCCC Canvas ----------
function canvasBase() { return (getS('cv_base') || 'https://canvas.instructure.com').replace(/\/+$/, ''); }

function parseICS(txt) {
  const lines = txt.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = []; let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      ev[name] = { value: line.slice(i + 1).replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1'), params: params.join(';') };
    }
  }
  return events;
}
function icsDate(p) {
  if (!p) return null;
  const v = p.value;
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) { const d = new Date(+m[1], m[2] - 1, +m[3], 23, 59); return { date: ymd(d), time: '23:59', ms: d.getTime() }; }
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const d = m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  return { date: ymd(d), time: hm(d), ms: d.getTime() };
}

async function canvasApi(p) {
  let url = p.startsWith('http') ? p : canvasBase() + '/api/v1' + p;
  const out = [];
  for (let i = 0; i < 10 && url; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${getS('cv_token')}`, Accept: 'application/json' } });
    if (!res.ok) {
      const e = new Error(res.status === 401 ? 'Canvas rejected the access token. Make a new one in Canvas → Account → Settings.' : `Canvas HTTP ${res.status}`);
      e.status = res.status; throw e;
    }
    const j = await res.json();
    if (!Array.isArray(j)) return j;
    out.push(...j);
    const link = res.headers.get('link') || '';
    url = (link.split(',').find(s => /rel="next"/.test(s)) || '').match(/<([^>]+)>/)?.[1] || null;
  }
  return out;
}

const stripHtml = h => String(h || '').replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n').trim();

async function syncCanvas() {
  if (busy.cv) return { busy: true };
  const token = getS('cv_token'), ics = getS('cv_ics');
  if (!token && !ics) throw new Error('Add your HCCC Canvas calendar link or access token in Settings.');
  busy.cv = true; setS('cv_status', 'syncing');
  const stats = { courses: 0, added: 0, updated: 0, completed: 0, posts: 0 };
  const now = Date.now();
  try {
    if (token) {
      const courses = await canvasApi('/courses?enrollment_state=active&per_page=100');
      stats.courses = courses.length;
      const names = new Map(courses.map(c => [c.id, c.course_code || c.name]));
      const start = new Date(now - 21 * DAY).toISOString(), end = new Date(now + 90 * DAY).toISOString();
      const items = await canvasApi(`/planner/items?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&per_page=100`);
      for (const it of items) {
        const type = it.plannable_type, p = it.plannable || {};
        if (!['assignment', 'quiz', 'discussion_topic', 'wiki_page', 'planner_note'].includes(type)) continue;
        const dueIso = p.due_at || p.todo_date || it.plannable_date;
        if (!dueIso) continue;
        const d = new Date(dueIso);
        const s = it.submissions || {};
        upsertSchoolTask({
          ext: `canvas:${type}:${it.plannable_id}`, title: p.title || p.name || 'Canvas item', cat: 'hccc',
          notes: type === 'quiz' ? 'Quiz' : type === 'discussion_topic' ? 'Discussion post' : '',
          due: { date: ymd(d), time: hm(d), ms: d.getTime() }, course: `HCCC · ${it.context_name || names.get(it.course_id) || 'Canvas'}`,
          link: it.html_url ? (it.html_url.startsWith('http') ? it.html_url : canvasBase() + it.html_url) : null,
          source: 'canvas', turnedIn: !!(s.submitted || s.excused || s.graded) || !!it.planner_override?.marked_complete,
        }, stats);
        // IQ: Canvas tells us submitted / late / missing (no score in this feed).
        const cst = s.excused ? null : s.missing ? 'missing' : s.submitted && s.late ? 'late' : s.submitted ? 'ontime' : (d.getTime() < now - HOUR && !s.submitted ? 'missing' : null);
        const cext = `cv:${type}:${it.plannable_id}`;
        if (!cst) db.prepare('DELETE FROM iq_events WHERE ext=?').run(cext);
        else db.prepare(`INSERT INTO iq_events(ext,course,title,link,due_ms,at_ms,status,grade_pct,delta) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(ext) DO UPDATE SET title=excluded.title, status=excluded.status, delta=excluded.delta`)
          .run(cext, `HCCC · ${it.context_name || names.get(it.course_id) || 'Canvas'}`, p.title || p.name || 'Canvas item', null, d.getTime(), d.getTime(), cst, null, IQ_RULES[cst]);
      }
      if (courses.length) {
        const qs = courses.map(c => `context_codes[]=course_${c.id}`).join('&');
        const anns = await canvasApi(`/announcements?${qs}&start_date=${encodeURIComponent(new Date(now - 30 * DAY).toISOString())}&per_page=50`);
        for (const a of anns) {
          const cid = Number(String(a.context_code || '').replace('course_', ''));
          const text = [a.title, stripHtml(a.message)].filter(Boolean).join('\n\n');
          savePost({ ext: `canvas-ann:${a.id}`, source: 'cv', course: `HCCC · ${names.get(cid) || 'Canvas'}`, text, link: a.html_url || null,
            created: Date.parse(a.posted_at || a.created_at || now) }, stats);
        }
      }
    } else {
      if (!/^https:\/\//i.test(ics)) throw new Error('The Canvas calendar link should start with https://');
      const res = await fetch(ics.replace(/^webcal:/i, 'https:'));
      if (!res.ok) throw new Error(`Couldn't download the Canvas calendar (HTTP ${res.status}). Copy the Calendar Feed link again.`);
      const events = parseICS(await res.text());
      const courses = new Set();
      for (const ev of events) {
        const uid = ev.UID?.value || '';
        if (!/assignment/i.test(uid)) continue; // skip class meetings and other calendar events
        const due = icsDate(ev.DTSTART) || icsDate(ev.DTEND);
        if (!due || due.ms < now - 21 * DAY) continue;
        let title = ev.SUMMARY?.value || 'Canvas assignment', course = 'Canvas';
        const cm = title.match(/^(.*)\s\[([^\]]+)\]$/); if (cm) { title = cm[1]; course = cm[2]; }
        courses.add(course);
        // Same id scheme as the access-token sync, so switching methods never duplicates work.
        const aid = uid.match(/assignment-(\d+)/)?.[1];
        upsertSchoolTask({ ext: aid ? `canvas:assignment:${aid}` : `canvas-ics:${uid}`, title, cat: 'hccc', due, course: `HCCC · ${course}`,
          link: ev.URL?.value || null, notes: stripHtml(ev.DESCRIPTION?.value || '').slice(0, 400), source: 'canvas', turnedIn: false }, stats);
      }
      stats.courses = courses.size;
    }
    if (token) setS('cv_ann_ready', '1');
    setS('cv_last_sync', Date.now()); setS('cv_status', 'ok'); setS('cv_error', ''); setS('cv_last_result', JSON.stringify(stats));
    log('canvas sync ok', stats);
    return stats;
  } catch (e) {
    log('canvas sync failed', e);
    setS('cv_last_sync', Date.now()); setS('cv_status', 'error'); setS('cv_error', e.message);
    throw e;
  } finally { busy.cv = false; }
}

// ---------- Gmail: volunteer & internship finder ----------
const OPP_TERMS = ['internship', 'internships', 'intern', 'externship', 'volunteer', 'volunteers', 'volunteering', '"community service"',
  '"service hours"', 'fellowship', '"summer program"', '"research program"', '"pre-college"', '"job shadow"', 'shadowing', '"summer camp"'];
function oppKind(s) {
  s = s.toLowerCase();
  if (/\b(internships?|intern|externship|job shadow|shadowing)\b/.test(s)) return 'internship';
  if (/\b(volunteer\w*|community service|service hours|service opportunit)/.test(s)) return 'volunteer';
  if (/\b(summer program|research|fellowship|pre-college|camp|academy|workshop|competition)\b/.test(s)) return 'program';
  return 'other';
}
function oppScore(s) {
  s = s.toLowerCase(); let n = 0;
  if (/\bhigh school|students?\b|teens?|grades? (9|10|11|12)|juniors?|seniors?/.test(s)) n += 2;
  if (/\bapply|application|register|sign up|deadline|spots?\b/.test(s)) n += 1;
  if (/\bpaid|stipend|hours|credit\b/.test(s)) n += 1;
  if (/\bnew jersey|nj\b|jersey city|hoboken|bayonne|newark|hudson county/.test(s)) n += 1;
  if (/\bunsubscribe|% off|sale|deal|coupon|order\b/.test(s)) n -= 2;
  return n;
}

async function syncGmail(acct = 'gm') {
  const A = MAIL_ACCTS[acct];
  const pause = googleSyncPause(acct);
  if (pause) return pause;
  if (busy[acct]) return { busy: true };
  busy[acct] = true; setS(`${acct}_status`, 'syncing');
  const stats = { found: 0, added: 0 };
  try {
    const base = 'https://gmail.googleapis.com/gmail/v1/users/me';
    const alerts = getS('gmail_alerts') !== '0';
    const config = JSON.stringify([getS('gm_days'), getS('gm_extra'), alerts]);
    const checkpoint = jparse(getS(`${acct}_history`));
    let historyId = checkpoint?.config === config ? checkpoint.id : '';
    let changed = null;
    if (historyId) {
      try {
        changed = new Set();
        let pageToken = '';
        do {
          const query = new URLSearchParams({ startHistoryId: checkpoint.id });
          if (pageToken) query.set('pageToken', pageToken);
          const page = await gfetch(acct, `${base}/history?${query}`);
          for (const record of page.history || []) {
            for (const message of record.messages || []) changed.add(message.id);
            for (const field of ['messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved']) {
              for (const entry of record[field] || []) changed.add(entry.message.id);
            }
          }
          historyId = page.historyId || historyId;
          pageToken = page.nextPageToken;
        } while (pageToken);
      } catch (e) {
        if (e.status !== 404) throw e;
        changed = null;
        historyId = '';
      }
    }
    if (!historyId || !getS(`${acct}_email`)) {
      const profile = await gfetch(acct, `${base}/profile`);
      setS(`${acct}_email`, profile.emailAddress || '');
      if (!historyId) historyId = profile.historyId;
    }
    // Share overlapping reads across the opportunity and inbox searches.
    const metadata = new Map();
    async function messageFor(id) {
      if (!metadata.has(id)) {
        // Space metadata reads across both inboxes, including when they share a Google project.
        const now = Date.now();
        const startAt = Math.max(now, nextGmailMetadataRead);
        nextGmailMetadataRead = startAt + 350;
        if (startAt > now) await new Promise(resolve => setTimeout(resolve, startAt - now));
        try {
          metadata.set(id, await gfetch(acct, `${base}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`));
        } catch (e) {
          if (e.status !== 404) throw e;
          metadata.set(id, null);
        }
      }
      return metadata.get(id);
    }
    const extra = (getS('gm_extra') || '').split(',').map(s => s.trim()).filter(Boolean).map(s => (/\s/.test(s) ? `"${s.replace(/"/g, '')}"` : s));
    const q = `newer_than:${Number(getS('gm_days')) || 60}d -in:sent -in:chats -in:spam (${[...OPP_TERMS, ...extra].join(' OR ')})`;
    let ids = [], pageToken = '';
    for (let i = 0; i < 3; i++) {
      const j = await gfetch(acct, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(q)}${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
      ids = ids.concat(j.messages || []); if (!j.nextPageToken) break; pageToken = j.nextPageToken;
    }
    stats.found = ids.length;
    const fresh = [];
    for (const { id, threadId } of ids) {
      if (db.prepare('SELECT 1 FROM opportunities WHERE gmail_id=?').get(id)) continue;
      if (changed && !changed.has(id)) continue;
      const m = await messageFor(id);
      if (!m) continue;
      const h = n => (m.payload?.headers || []).find(x => x.name.toLowerCase() === n)?.value || '';
      const subject = h('subject') || '(no subject)', from = h('from').replace(/\s*<[^>]+>\s*$/, '').replace(/"/g, '') || h('from');
      const snippet = (m.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const received = Number(m.internalDate) || Date.now();
      const text = `${subject}. ${snippet}`;
      if (acct === 'gm' && personalMail({subject, preview:snippet, sender:from}).cls !== 'important') continue;
      const dl = /(deadline|apply by|due|closes?|until|register by|applications? (are )?due)/i.test(text) ? findDate(text, received) : null;
      db.prepare(`INSERT INTO opportunities(gmail_id,thread_id,subject,sender,snippet,received_at,kind,score,deadline,status,acct)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, threadId, subject, from, snippet, received, oppKind(text), oppScore(text + ' ' + from), dl?.date ?? null, 'new', acct);
      stats.added++;
      if (Date.now() - received < 2 * DAY && getS(`${acct}_first_sync_done`) === '1') fresh.push(subject);
    }
    if (fresh.length && getS('opp_notify') === '1')
      notify(`🌱 ${fresh.length} new opportunit${fresh.length === 1 ? 'y' : 'ies'} in your email`, fresh.slice(0, 3).join(' · ')).catch(() => {});
    setS(`${acct}_first_sync_done`, '1');
    // Important mail: deadlines, clubs, people waiting on a reply. Same sorting and alerts as the HCCC inbox.
    if (alerts) {
      const mstats = { added: 0, important: 0, tasks: 0 };
      const mq = 'in:inbox newer_than:30d -in:spam -in:trash -in:chats';
      let mailMessages = [], mailPage = '';
      for (let page = 0; page < 3; page++) {
        const mj = await gfetch(acct, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(mq)}${mailPage?'&pageToken='+encodeURIComponent(mailPage):''}`);
        mailMessages.push(...(mj.messages || [])); mailPage=mj.nextPageToken; if(!mailPage) break;
      }
      // Refresh saved messages too, including messages older than the recent inbox window.
      const inbox = new Map(mailMessages.map(message => [message.id, message]));
      const saved = new Set();
      for (const row of db.prepare('SELECT id FROM mail WHERE source=? AND hidden=0 ORDER BY received_at DESC LIMIT 500').all(A.source)) {
        const id = row.id.slice(acct.length + 1);
        saved.add(id);
        if ((!changed || changed.has(id)) && !inbox.has(id)) inbox.set(id, { id });
      }
      for (const { id, threadId } of inbox.values()) {
        if (changed && !changed.has(id) && saved.has(id)) continue;
        const msg = await messageFor(id);
        if (!msg) continue;
        const h = n => (msg.payload?.headers || []).find(x => x.name.toLowerCase() === n)?.value || '';
        const fromRaw = h('from'), addr = (fromRaw.match(/<([^>]+)>/) || [])[1] || fromRaw;
        const labels = msg.labelIds || [];
        saveMail({ id: acct + ':' + id, source: A.source, sender: fromRaw.replace(/\s*<[^>]+>\s*$/, '').replace(/"/g, '') || addr, sender_addr: addr,
          subject: h('subject') || '(no subject)', preview: (msg.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
          received_at: Number(msg.internalDate) || Date.now(), link: `https://mail.google.com/mail/u/${encodeURIComponent(getS(`${acct}_email`) || '0')}/#inbox/${msg.threadId || threadId || id}`,
          promotion: labels.includes('CATEGORY_PROMOTIONS'), unread: labels.includes('UNREAD'), gImportant: labels.includes('IMPORTANT'), inference: labels.some(l => /CATEGORY_(UPDATES|FORUMS)/.test(l)) ? 'updates' : '' }, mstats);
      }
      if (getS(A.gate) !== '1' && mstats.important && getS('mail_notify') !== '0') notify(`⭐ ${mstats.important} important ${A.name}${mstats.important === 1 ? '' : 's'}`, 'Starred in StudyDash → Mail. New ones will pop up here.').catch(() => {});
      setS(A.gate, '1');
      stats.mail = mstats;
    }
    if (historyId) setS(`${acct}_history`, JSON.stringify({ id: historyId, config }));
    clearGooglePause(acct);
    setS(`${acct}_last_sync`, Date.now()); setS(`${acct}_status`, 'ok'); setS(`${acct}_error`, ''); setS(`${acct}_last_result`, JSON.stringify(stats));
    log('gmail sync ok', acct, stats);
    return stats;
  } catch (e) {
    log('gmail sync failed', e);
    if (googleQuota(e)) return pauseGoogleQuota(acct, e);
    if (getS(`${acct}_status`) === 'reauth') return googleSyncPause(acct);
    setS(`${acct}_retry_at`, 0);
    setS(`${acct}_attempt`, Date.now());
    if (getS(`${acct}_refresh_token`)) { setS(`${acct}_status`, 'error'); setS(`${acct}_error`, e.message); }
    throw e;
  } finally { busy[acct] = false; if (getS(`${acct}_status`) === 'syncing') setS(`${acct}_status`, 'ok'); }
}

// ---------- Just-for-fun IQ scoreboard ----------
// Points per assignment; the total is squeezed onto 75..125 so 125 is a hard ceiling.
const IQ_RULES = { ontime: 2, late: -3, missing: -5, grade: [[90, 2], [80, 1], [70, -1], [60, -3], [0, -5]],
  // Each class's current average from PowerSchool/Genesis counts once, so the score tracks real grades.
  course: [[97, 4], [93, 3], [90, 2], [85, 1], [80, 0], [75, -2], [70, -3], [0, -5]] };
const IQ_MAX = 125;
function recordIq(w, sub, c, due) {
  const now = Date.now();
  const turned = sub && (sub.state === 'TURNED_IN' || sub.state === 'RETURNED');
  const hist = (sub?.submissionHistory || []).map(h => h.stateHistory).filter(h => h && h.state === 'TURNED_IN');
  const turnedAt = hist.length ? Date.parse(hist[hist.length - 1].stateTimestamp) : (turned ? Date.parse(sub.updateTime || 0) || now : null);
  let status = 'pending';
  if (turned) status = sub.late || (due && turnedAt > due.ms) ? 'late' : 'ontime';
  else if (due && due.ms < now - HOUR && sub) status = 'missing';
  if (status === 'pending') { db.prepare('DELETE FROM iq_events WHERE ext=?').run(`gc:${w.id}`); return; }
  let delta = IQ_RULES[status];
  let pct = null;
  if (sub && typeof sub.assignedGrade === 'number' && w.maxPoints > 0) {
    pct = Math.round((sub.assignedGrade / w.maxPoints) * 1000) / 10;
    delta += IQ_RULES.grade.find(([min]) => pct >= min)[1];
  }
  db.prepare(`INSERT INTO iq_events(ext,course,title,link,due_ms,at_ms,status,grade_pct,delta) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(ext) DO UPDATE SET course=excluded.course,title=excluded.title,link=excluded.link,due_ms=excluded.due_ms,at_ms=excluded.at_ms,status=excluded.status,grade_pct=excluded.grade_pct,delta=excluded.delta`)
    .run(`gc:${w.id}`, c.name, w.title || 'Assignment', w.alternateLink || null, due?.ms ?? null, turnedAt || due?.ms || now, status, pct, delta);
}
const iqFromPoints = p => Math.min(IQ_MAX, Math.round(100 + 25 * Math.tanh(p / 30)));
function iqState() {
  const ev = db.prepare('SELECT * FROM iq_events ORDER BY at_ms').all();
  let pts = 0; const series = [];
  for (const e of ev) { pts += e.delta; series.push({ t: e.at_ms, iq: iqFromPoints(pts) }); }
  const count = s => ev.filter(e => e.status === s).length;
  const classes = ev.filter(e => e.status === 'class');
  const graded = classes.length ? classes : ev.filter(e => e.grade_pct != null);
  const weekAgo = Date.now() - 7 * DAY;
  const before = ev.filter(e => e.at_ms < weekAgo).reduce((a, e) => a + e.delta, 0);
  const stats = { ontime: count('ontime'), late: count('late'), missing: count('missing'),
    avg: graded.length ? Math.round(graded.reduce((a, e) => a + e.grade_pct, 0) / graded.length) : null };
  const iq = iqFromPoints(pts);
  return { iq, points: Math.round(pts * 10) / 10, week: iq - iqFromPoints(before), stats, series,
    events: ev.slice(-60).reverse(), code: friendCode(iq, stats),
    friends: db.prepare('SELECT * FROM friends ORDER BY iq DESC').all().map(f => ({ ...f, stats: jparse(f.stats) })),
    rules: IQ_RULES, max: IQ_MAX };
}
const CODE_SALT = 'ltn-edition-just-for-fun';
function friendCode(iq, stats) {
  const payload = Buffer.from(JSON.stringify({ v: 1, n: getS('name') || 'Friend', iq, s: stats, t: Date.now() })).toString('base64url');
  return `LTN-${payload}.${crypto.createHash('sha256').update(CODE_SALT + payload).digest('hex').slice(0, 8)}`;
}
function readFriendCode(code) {
  // Chat apps sometimes wrap long text or add words around it, so find the code anywhere in what was pasted.
  const m = String(code || '').replace(/\s+/g, '').match(/LTN-([A-Za-z0-9_-]+)\.([0-9a-f]{8})/);
  if (!m) throw new Error('That isn\'t an LTN code. It should start with LTN-');
  if (crypto.createHash('sha256').update(CODE_SALT + m[1]).digest('hex').slice(0, 8) !== m[2]) throw new Error('That code was changed or copied wrong. Ask your friend to copy it again.');
  const d = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  if (!d.n || typeof d.iq !== 'number' || d.iq > IQ_MAX || d.iq < 50) throw new Error('That code has an impossible score.');
  return d;
}

// ---------- Grade portals (PowerSchool / Genesis), imported from the page the student has open ----------
const normTitle = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const termRank = t => { const m = String(t).match(/^(Q|MP|T|S|X|E|F|Y)(\d)?$/i); if (!m) return 0;
  const k = m[1].toUpperCase(), n = Number(m[2] || 0);
  if (k === 'Q' || k === 'MP' || k === 'T') return 100 + n * 2; if (k === 'S') return 100 + n * 4 - 1; return 0; };
function pickCurrent(terms) {
  // Most recent marking period with a grade; fall back to the final/year grade.
  const withGrade = terms.filter(t => t.pct != null || t.letter);
  const mp = withGrade.filter(t => termRank(t.term) >= 100).sort((a, b) => termRank(a.term) - termRank(b.term));
  return mp[mp.length - 1] || withGrade[withGrade.length - 1] || null;
}
function importGrades(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.courses)) throw new Error('No grades found on that page.');
  const source = /genesis/i.test(d.src) ? 'genesis' : /powerschool/i.test(d.src) ? 'powerschool' : 'portal';
  const now = Date.now(), stats = { courses: 0, items: 0, missing: 0 };
  for (const c of d.courses.slice(0, 40)) {
    const name = clean(c.course, 120); if (!name) continue;
    const terms = (Array.isArray(c.terms) ? c.terms : []).slice(0, 12).map(t => ({
      term: clean(t.term, 10) || 'Current', letter: t.letter ? clean(t.letter, 3) : null,
      pct: Number.isFinite(Number(t.pct)) && t.pct !== null && t.pct !== '' ? Math.max(0, Math.min(150, Number(t.pct))) : null }));
    const cur = pickCurrent(terms);
    if (!cur) continue; // skip Lunch, Homeroom and other ungraded rows
    const ex = db.prepare('SELECT cur_pct FROM grade_courses WHERE source=? AND course=?').get(source, name);
    db.prepare(`INSERT INTO grade_courses(source,course,teacher,period,terms,cur_term,cur_letter,cur_pct,prev_pct,absences,tardies,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,course) DO UPDATE SET teacher=excluded.teacher, period=excluded.period, terms=excluded.terms,
      cur_term=excluded.cur_term, cur_letter=excluded.cur_letter,
      prev_pct=CASE WHEN grade_courses.cur_pct IS NOT excluded.cur_pct THEN grade_courses.cur_pct ELSE grade_courses.prev_pct END,
      cur_pct=excluded.cur_pct, absences=excluded.absences, tardies=excluded.tardies, updated_at=excluded.updated_at`)
      .run(source, name, clean(c.teacher, 80), clean(c.period, 20), JSON.stringify(terms), cur.term, cur.letter, cur.pct, ex ? ex.cur_pct : null,
        Number.isFinite(+c.absences) ? +c.absences : null, Number.isFinite(+c.tardies) ? +c.tardies : null, now);
    stats.courses++;
    // IQ: one event per class, keyed so re-imports replace it.
    if (cur.pct != null) {
      const delta = IQ_RULES.course.find(([min]) => cur.pct >= min)[1];
      db.prepare(`INSERT INTO iq_events(ext,course,title,link,due_ms,at_ms,status,grade_pct,delta) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(ext) DO UPDATE SET title=excluded.title, at_ms=excluded.at_ms, grade_pct=excluded.grade_pct, delta=excluded.delta`)
        .run(`pc:${source}:${normTitle(name)}`, name, `${name} class average (${cur.term})`, getS('portal_url') || null, null, now, 'class', cur.pct, delta);
    }
  }
  const classroomTitles = new Set(db.prepare(`SELECT title FROM iq_events WHERE ext LIKE 'gc:%'`).all().map(r => normTitle(r.title)));
  for (const it of (Array.isArray(d.items) ? d.items : []).slice(0, 400)) {
    const name = clean(it.name, 160); if (!name) continue;
    const course = clean(it.course, 120) || '';
    const status = ['missing', 'late', 'graded'].includes(it.status) ? it.status : null; if (!status) continue;
    const score = Number.isFinite(+it.score) && it.score !== null ? +it.score : null, max = Number.isFinite(+it.max) && it.max ? +it.max : null;
    let pct = Number.isFinite(+it.pct) && it.pct !== null && it.pct !== '' ? +it.pct : (score != null && max ? Math.round(score / max * 1000) / 10 : null);
    const due = validDate(it.due) ? it.due : null;
    const ext = `pg:${source}:` + crypto.createHash('sha1').update(`${normTitle(course)}|${normTitle(name)}|${due || ''}`).digest('hex').slice(0, 16);
    const term = /^[A-Z]\d$/i.test(it.term || '') ? String(it.term).toUpperCase() : null;
    db.prepare(`INSERT INTO grade_items(ext,source,course,name,category,due_date,score,max,pct,status,updated_at,term) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ext) DO UPDATE SET score=excluded.score, max=excluded.max, pct=excluded.pct, status=excluded.status, category=excluded.category, updated_at=excluded.updated_at, term=COALESCE(excluded.term, grade_items.term)`)
      .run(ext, source, course, name, clean(it.category, 60), due, score, max, pct, status, now, term);
    stats.items++; if (status === 'missing') stats.missing++;
    // IQ: skip anything Classroom already counted.
    if (classroomTitles.has(normTitle(name))) continue;
    let delta = status === 'missing' ? IQ_RULES.missing : status === 'late' ? IQ_RULES.late : IQ_RULES.ontime;
    if (pct != null && status !== 'missing') delta += IQ_RULES.grade.find(([min]) => pct >= min)[1];
    const at = due ? localMs(due, '12:00') : now;
    db.prepare(`INSERT INTO iq_events(ext,course,title,link,due_ms,at_ms,status,grade_pct,delta) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ext) DO UPDATE SET status=excluded.status, grade_pct=excluded.grade_pct, delta=excluded.delta`)
      .run(ext, course, name, getS('portal_url') || null, due ? at : null, at, status === 'graded' ? 'ontime' : status, pct, delta);
  }
  // Google Classroom pages read in the browser (for accounts where the school blocks the Google key).
  stats.tasks = 0; stats.added = 0;
  const tstats = { added: 0, updated: 0, completed: 0 };
  for (const t of (Array.isArray(d.tasks) ? d.tasks : []).slice(0, 300)) {
    const id = String(t.id || '').replace(/[^\w-]/g, '').slice(0, 80); if (!id) continue;
    const title = clean(t.title, 200); if (!title) continue;
    const date = validDate(t.due) ? t.due : null, time = validTime(t.time) ? t.time : (date ? '23:59' : null);
    const due = date ? { date, time, ms: localMs(date, time) } : null;
    const st = ['assigned', 'missing', 'done'].includes(t.status) ? t.status : 'assigned';
    const link = /^https:\/\/classroom\.google\.com\//.test(t.link || '') ? String(t.link).slice(0, 400) : null;
    const course = clean(t.course, 120) || 'Google Classroom';
    upsertSchoolTask({ ext: `gcweb:${id}`, title, notes: '', cat: 'homework', due, course, link, source: 'classroom', turnedIn: st === 'done' }, tstats);
    stats.tasks++;
    const ext = `gcweb:${id}`;
    if (st === 'assigned') { db.prepare('DELETE FROM iq_events WHERE ext=?').run(ext); continue; }
    const status = st === 'missing' ? 'missing' : t.late ? 'late' : 'ontime';
    db.prepare(`INSERT INTO iq_events(ext,course,title,link,due_ms,at_ms,status,grade_pct,delta) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ext) DO UPDATE SET title=excluded.title, status=excluded.status, delta=excluded.delta`)
      .run(ext, course, title, link, due ? due.ms : null, due ? due.ms : now, status, null, IQ_RULES[status]);
  }
  stats.added = tstats.added;
  // PowerSchool "Final Grade Calculations": each class's own category and term weights
  stats.formulas = 0;
  for (const f of (Array.isArray(d.formulas) ? d.formulas : []).slice(0, 30)) {
    const course = clean(f.course, 120); if (!course || !f.terms || typeof f.terms !== 'object') continue;
    const terms = {};
    for (const [t, v] of Object.entries(f.terms).slice(0, 12)) {
      if (!/^[A-Z]\d$/i.test(t) || !v) continue;
      terms[t.toUpperCase()] = { type: ['category', 'term', 'points'].includes(v.type) ? v.type : 'points',
        items: (Array.isArray(v.items) ? v.items : []).slice(0, 30).filter(x => Array.isArray(x) && Number.isFinite(+x[0])).map(x => [+x[0], clean(x[1], 80)]) };
    }
    db.prepare(`INSERT INTO grade_formulas(course,teacher,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(course) DO UPDATE SET teacher=excluded.teacher, data=excluded.data, updated_at=excluded.updated_at`)
      .run(course, clean(f.teacher, 80), JSON.stringify(terms), now);
    stats.formulas++;
  }
  if (!stats.courses && !stats.items && !stats.tasks && !stats.formulas) throw new Error('StudyDash couldn\'t find anything on that page. Open your Classroom To-do page or your grades page and try again.');
  if (stats.tasks) setS('gcweb_last', now);
  if (stats.courses || stats.items || stats.formulas) {
    setS('grades_last_import', now); setS('grades_source', source);
    if (d.url && /^https:\/\//.test(d.url) && !getS('portal_url')) setS('portal_url', String(d.url).slice(0, 300));
  }
  log('grades import', source, stats);
  return { source, ...stats };
}
// Classroom class calendars (Google Calendar "secret address in iCal format"): fully automatic due dates.
let gccalBusy = false;
async function syncClassroomCal() {
  if (gccalBusy) return { busy: true };
  gccalBusy = true;
  const feeds = jparse(getS('gccal_feeds')) || [];
  const stats = { feeds: feeds.length, added: 0, updated: 0, completed: 0 };
  const now = Date.now();
  try {
    for (const f of feeds) {
      try {
        const res = await fetch(f.url);
        if (!res.ok) throw new Error(res.status === 404 ? 'Google says that calendar address doesn\'t exist anymore. Copy it again.' : `Calendar download failed (HTTP ${res.status}).`);
        const txt = await res.text();
        if (!/BEGIN:VCALENDAR/.test(txt)) throw new Error('That link didn\'t return a calendar. Use the "Secret address in iCal format".');
        const nm = (txt.match(/^X-WR-CALNAME:(.*)$/m) || [])[1];
        if (nm) f.name = nm.trim().replace(/\\,/g, ',').slice(0, 120);
        for (const ev of parseICS(txt)) {
          const due = icsDate(ev.DTSTART) || icsDate(ev.DTEND);
          if (!due || due.ms < now - 21 * DAY || due.ms > now + 150 * DAY) continue;
          const desc = ev.DESCRIPTION?.value || '';
          const link = (desc.match(/https:\/\/classroom\.google\.com\/[^\s"<>]+/) || [])[0] || null;
          const aid = link && (link.match(/\/(?:a|sa|mc)\/([\w-]+)/) || [])[1];
          const uid = (ev.UID?.value || '').replace(/[^\w@.-]/g, '').slice(0, 120);
          if (!aid && !uid) continue;
          upsertSchoolTask({ ext: aid ? `gcweb:${aid}` : `gccal:${uid}`, title: (ev.SUMMARY?.value || 'Assignment').slice(0, 200), cat: 'homework', due,
            course: f.name || 'Google Classroom', link, notes: '', source: 'classroom', turnedIn: false }, stats);
        }
        f.last = Date.now(); f.error = '';
      } catch (e) { f.error = e.message; log('classroom calendar', e.message); }
    }
    setS('gccal_feeds', JSON.stringify(feeds)); setS('gccal_last', Date.now());
    return stats;
  } finally { gccalBusy = false; }
}

function gradesState() {
  const courses = db.prepare('SELECT * FROM grade_courses ORDER BY period, course').all().map(c => ({ ...c, terms: jparse(c.terms) || [] }));
  const items = db.prepare('SELECT * FROM grade_items ORDER BY due_date DESC LIMIT 200').all();
  const pcts = courses.map(c => c.cur_pct).filter(v => v != null);
  return { courses, items, avg: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 10) / 10 : null,
    lastImport: Number(getS('grades_last_import')) || 0, source: getS('grades_source'), portalUrl: getS('portal_url'),
    meta: Object.fromEntries(db.prepare('SELECT * FROM grade_meta').all().map(r => [r.course, { ...r, weights: jparse(r.weights) }])),
    cfg: jparse(getS('gpa_cfg')),
    formulas: db.prepare('SELECT * FROM grade_formulas').all().map(f => ({ course: f.course, teacher: f.teacher, terms: jparse(f.data) || {} })),
    classroom: db.prepare(`SELECT course, title, grade_pct, due_ms, at_ms FROM iq_events WHERE (ext LIKE 'gc:%' OR ext LIKE 'gcweb:%') AND grade_pct IS NOT NULL ORDER BY at_ms DESC LIMIT 400`).all() };
}

// ---------- "work day": morning deadlines count as the night before ----------
// Work due tomorrow before the cutoff (default noon) counts as tonight's work.
function workDate(x) {
  const cut = getS('early_cutoff');
  if (!x.due_date || !x.due_time || x.source === 'routine' || !cut || cut === 'off') return x.due_date;
  // Only work due TOMORROW morning moves up to today. Every other day keeps its own date.
  const t = today();
  return x.due_date === addDays(t, 1) && x.due_time < cut ? t : x.due_date;
}

// ---------- HCCC email (Outlook): sort important vs. promotional, star + notify the important ones ----------
const MS_SCOPES = 'offline_access User.Read Mail.Read';
const MS_REDIRECT = `http://localhost:${PORT}/oauth/ms`;
let msPending = null, mailBusy = false;

// Signals. Each match adds weight; the reasons are shown next to the email.
const MAIL_RULES = {
  important: [
    [/\b(course )?registration\b|\bregistered\b|\benrollment\b|\benrolled\b|\badd\/drop\b|\bwait ?list(ed)?\b|\bclass schedule\b|\bschedule (change|confirmation)\b/i, 3, 'Registration'],
    [/\bpassword\b.*\b(expir|change|reset|update)|\b(expir|change|reset|update)\w*\b.*\bpassword\b|\bmfa\b|multi-?factor|\baccount (locked|suspended|deactivat)|\bsecurity alert\b|\bverify your (account|identity)\b/i, 4, 'Password / account security'],
    [/\bconfirm(ation|ed)\b/i, 2, 'Confirmation'],
    [/\btuition\b|\bbill(ing)?\b|\bpayment (due|plan|received)\b|\bbalance\b|\bfinancial aid\b|\bfafsa\b|\brefund\b|\bhold on your account\b|\bregistration hold\b|\bscholarship\b/i, 3, 'Money / financial aid'],
    [/\baction (required|needed)\b|\bimmediate(ly)?\b|\burgent\b|\bfinal notice\b|\bdeadline\b|\blast day\b|\bdue (by|date|on)\b|\bexpires?\b|\bwithdraw(al)?\b|\bdon'?t miss\b.*\bdeadline\b/i, 3, 'Deadline / action needed'],
    [/\b(final )?grades?\b.*\b(posted|available)\b|\bacademic (standing|probation|warning)\b|\bmidterm (grade|warning)\b|\battendance\b|\bdual enrollment\b|\btranscript\b/i, 3, 'Grades / academic record'],
    [/\b(class|course)\b.*\b(cancel+ed|moved|room change|online today)\b|\bcampus (closed|closure)\b|\bemergency\b|\bweather\b.*\bclos/i, 3, 'Class change / closure'],
  ],
  senders: [
    [/registrar|enrollment|admissions|bursar|student ?accounts|financial ?aid|it ?(help|service)|help ?desk|technology services|security|dual ?enrollment|advis(or|ing)|dean|professor|instructor|canvas/i, 2, 'From an important office'],
    [/\bprof\.?\s|\bdr\.?\s|\bprofessor\b/i, 3, 'From a professor'],
  ],
  promo: [
    [/\bnewsletter\b|\bdigest\b|\bweekly\b|\bmonthly\b|\bthis week at\b|\bspotlight\b|\bhighlights?\b|\binsights?\b|\btips?\b|\bdid you know\b|\bfun\b|\bjoin us\b|\byou'?re invited\b|\binvitation\b|\bwebinar\b|\bworkshop\b|\bevent(s)?\b|\bcelebrat|\bgiveaway\b|\bfree (food|pizza|swag)\b|\bsurvey\b|\bfeedback\b|\bsale\b|\b% off\b|\bdiscount\b|\bshop\b|\bpromo\b|\bunsubscribe\b|\bsocial media\b|\bfollow us\b/i, 2, 'Newsletter / event / promo'],
  ],
  promoSenders: [[/news|newsletter|marketing|communications|events?|student ?life|activities|athletics|alumni|foundation|no-?reply@(mail|email|news)|campus ?life|bookstore/i, 2, 'Mass-mail sender']],
};

// Personal inbox: membership and concrete opportunities outrank bulk-mail hints.
function personalMail(m) {
 const t = `${m.subject || ''} ${m.preview || ''}`, from = `${m.sender || ''} ${m.sender_addr || ''}`;
 const activities=(getS('gm_activities') || '').split(',').map(s=>s.trim().toLowerCase()).filter(s=>s.length>=3);
 const active=activities.some(s=>(t+' '+from).toLowerCase().includes(s));
 const task = /\b(meeting|agenda|minutes|orientation|your (?:application|registration|interview|shift)|accepted|selected|confirm|submit|permission|schedule|reminder|deadline|due|reply|action required)\b/i.test(t);
 const role = /\b(volunteer(?:ing|s)?|internship(?:s)?|intern position|community service)\b/i.test(t);
 const concrete = /\b(apply by|applications? (?:close|open|due)|deadline|shift|sign up|sign-up|stipend|paid|unpaid|hours? per week|eligibility|eligible|interview|positions? available|seeking volunteers|volunteers needed)\b/i.test(t);
 const retail = /\b(sale|coupon|shop now|discount|buy now|save \d+|% off|enroll now|tuition|paid course)\b/i.test(t);
 const recruitment = /\b(explore (?:our|your)|discover (?:our|your)|campus tour|open house|college fair|admissions? (?:newsletter|event)|why choose|find your (?:future|fit)|pre-college|summer camp|request (?:more )?info)\b/i.test(t);
 const bulk = m.promotion || /\b(newsletter|digest|unsubscribe|weekly roundup|spotlight|highlights|webinar)\b/i.test(t) || /newsletter|marketing|admissions|recruitment|news@/i.test(from);
 const accountTask = /\b(your (?:application|interview|registration|account|payment)|password (?:reset|changed|expires)|security alert|verification code|application (?:status|received|incomplete)|missing documents)\b/i.test(t);
 if(active && task) return {cls:'important',score:8,why:'Your activity / task'};
 if(accountTask && !recruitment && !retail) return {cls:'important',score:7,why:'Specific account or application task'};
 if(role && concrete && !retail && !recruitment) return {cls:'important',score:6,why:'Concrete volunteer / internship opportunity'};
 if(retail || recruitment || bulk) return {cls:'promo',score:-4,why:'Promotional content / college outreach'};
 if(active) return {cls:'normal',score:1,why:'Your activity update; no clear action'};
 if(!/no.?reply|mailer|notifications?@/i.test(from) && /\b(can you|could you|please reply|let me know|are you available)\b/i.test(t)) return {cls:'important',score:5,why:'Direct request for your reply'};
 return {cls:'normal',score:0,why:role?'Possible opportunity; review details':'No clear personal action found'};
}

function classifyMail(m) {
  if (m.source === 'gmail') {
    const c = personalMail(m);
    const rule = db.prepare('SELECT cls FROM mail_senders WHERE sender=?').get(normSender(m));
    return rule ? {...c, cls:rule.cls, why:'Your saved sender preference'} : c;
  }
  const text = `${m.subject || ''} \n ${m.preview || ''}`, from = `${m.sender || ''} ${m.sender_addr || ''}`;
  let imp = 0, promo = 0; const why = [];
  for (const [re, w, label] of MAIL_RULES.important) if (re.test(text)) { imp += w; why.push(label); }
  for (const [re, w, label] of MAIL_RULES.senders) if (re.test(from)) { imp += w; why.push(label); }
  for (const [re, w, label] of MAIL_RULES.promo) if (re.test(text)) { promo += w; if (!why.includes(label)) why.push(label); }
  for (const [re, w, label] of MAIL_RULES.promoSenders) if (re.test(from)) { promo += w; why.push(label); }
  if (m.importance === 'high') { imp += 2; why.push('Marked high importance'); }
  // Someone is waiting on you: a question or request from a real person (not a no-reply/mass sender).
  const massSender = /no-?reply|do-?not-?reply|newsletter|news@|marketing|notifications?@|mailer|updates@|info@|hello@|team@/i.test(from);
  if (/\?\s|\?$|\b(can you|could you|would you|will you|please (reply|respond|confirm|let me know|rsvp|sign|send|fill|submit)|let me know|are you (able|available|free|coming)|rsvp|respond by|reply by|get back to me|waiting (for|on) your|your (response|reply|input|answer)|need your|confirm your attendance)\b/i.test(text) && !massSender) { imp += 3; why.push('Needs your reply'); }
  if (/\b(club|meeting|practice|rehearsal|tryouts?|officers?|elections?|fundraiser|competition|deca|fbla|nhs|honor society|key club|model un|robotics|science olympiad|hosa|debate|student council|yearbook|band|chorus|team)\b/i.test(text)) { imp += massSender ? 1 : 3; why.push('Club / activity'); }
  if (m.gImportant) imp += 1;
  if (m.inference === 'updates') promo += 1;
  if (m.inference === 'other') promo += 1;
  if (m.inference === 'focused') imp += 0.5;
  // A real deadline or security wording beats newsletter wording ("Newsletter: registration closes Friday" is still important).
  let cls = imp >= 4 || (imp >= 3 && promo < 3) ? 'important' : promo >= 2 && imp < 3 ? 'promo' : 'normal';
  // Remembered choices for this sender win.
  const rule = db.prepare('SELECT cls FROM mail_senders WHERE sender=?').get(normSender(m));
  if (rule) cls = rule.cls;
  return { cls, score: imp - promo, why: [...new Set(why)].slice(0, 3).join(' · ') };
}
const normSender = m => String(m.sender_addr || m.sender || '').toLowerCase().trim().slice(0, 120);

function saveMail(m, stats) {
  if (!m.id || !m.subject && !m.preview) return;
  const ex = db.prepare('SELECT * FROM mail WHERE id=?').get(m.id);
  const c = classifyMail(m);
  if (ex) {
    db.prepare('UPDATE mail SET subject=?, preview=?, link=COALESCE(?, link), unread=? WHERE id=?').run(m.subject, m.preview, m.link || null, m.unread ? 1 : 0, m.id);
    if (m.source==='gmail' && !ex.manual_cls && !db.prepare('SELECT cls FROM mail_senders WHERE sender=?').get(normSender(m))) db.prepare("UPDATE mail SET cls=?,score=?,why=?,starred=CASE WHEN ?='promo' THEN 0 ELSE starred END WHERE id=?").run(c.cls,c.score,c.why,c.cls,m.id);
    return;
  }
  db.prepare(`INSERT INTO mail(id,source,sender,sender_addr,subject,preview,received_at,link,cls,score,why,starred,unread,seen,notified,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?)`).run(m.id, m.source, m.sender || '', m.sender_addr || '', (m.subject || '(no subject)').slice(0, 300),
    (m.preview || '').slice(0, 400), m.received_at || Date.now(), m.link || null, c.cls, c.score, c.why, c.cls === 'important' ? 1 : 0, m.unread ? 1 : 0, Date.now());
  stats.added++;
  if (c.cls === 'important') {
    stats.important++;
    const MA = Object.values(MAIL_ACCTS).find(x => x.source === m.source);
    const gate = MA ? MA.gate : 'ms_first_done';
    const fresh = Date.now() - (m.received_at || Date.now()) < 36 * HOUR && getS(gate) === '1' && getS('mail_notify') !== '0';
    if (fresh) {
      db.prepare('UPDATE mail SET notified=1 WHERE id=?').run(m.id);
      notify(`⭐ Important ${MA ? MA.name : 'HCCC email'}: ${m.subject || '(no subject)'}`, `${m.sender || ''} · ${c.why}`, { sticky: true }).catch(() => {});
    }
    // Deadlines stay in the Mail view (shown as a "Due" tag), never on the to-do list.
    const due = findDate(`${m.subject} ${m.preview}`, m.received_at || Date.now());
    if (due && localMs(due.date, due.time || '23:59') > Date.now() && /deadline|due|expir|by |last day|before|register|payment|password/i.test(`${m.subject} ${m.preview}`))
      db.prepare('UPDATE mail SET due=? WHERE id=?').run(due.date, m.id);
  }
}

// Microsoft sign-in (Graph). Needs the student's own free "Application (client) ID".
function msAuthUrl() {
  const verifier = b64url(crypto.randomBytes(32)), st = b64url(crypto.randomBytes(16));
  msPending = { verifier, state: st };
  return `https://login.microsoftonline.com/${getS('ms_tenant') || 'organizations'}/oauth2/v2.0/authorize?` + new URLSearchParams({
    client_id: getS('ms_client_id'), response_type: 'code', redirect_uri: MS_REDIRECT, response_mode: 'query', scope: MS_SCOPES,
    state: st, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account',
  });
}
async function msToken(params) {
  const res = await fetch(`https://login.microsoftonline.com/${getS('ms_tenant') || 'organizations'}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: getS('ms_client_id'), scope: MS_SCOPES, ...params }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error_description ? j.error_description.split('\r\n')[0] : j.error || `HTTP ${res.status}`); e.code = j.error; throw e; }
  return j;
}
async function msAccess() {
  if (Number(getS('ms_expiry')) > Date.now() + 60e3 && getS('ms_access_token')) return getS('ms_access_token');
  if (!getS('ms_refresh_token')) throw new Error('Not connected to Outlook');
  try {
    const j = await msToken({ grant_type: 'refresh_token', refresh_token: getS('ms_refresh_token') });
    setS('ms_access_token', j.access_token); setS('ms_expiry', Date.now() + (j.expires_in || 3600) * 1000);
    if (j.refresh_token) setS('ms_refresh_token', j.refresh_token);
    return j.access_token;
  } catch (e) {
    if (e.code === 'invalid_grant') { setS('ms_refresh_token', ''); setS('ms_status', 'error'); setS('ms_error', 'Microsoft sign-in expired. Reconnect in Settings.'); }
    throw e;
  }
}
async function graph(p) {
  const res = await fetch('https://graph.microsoft.com/v1.0' + p, { headers: { Authorization: `Bearer ${await msAccess()}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error?.message || `Outlook HTTP ${res.status}`); e.status = res.status; throw e; }
  return j;
}
async function syncOutlook() {
  if (mailBusy) return { busy: true };
  mailBusy = true;
  const stats = { added: 0, important: 0, tasks: 0 };
  try {
    if (!getS('ms_email')) { const me = await graph('/me?$select=mail,userPrincipalName'); setS('ms_email', me.mail || me.userPrincipalName || ''); }
    const j = await graph('/me/mailFolders/inbox/messages?$top=60&$orderby=receivedDateTime%20desc&$select=id,subject,from,receivedDateTime,bodyPreview,importance,webLink,isRead,inferenceClassification');
    for (const m of j.value || []) saveMail({ id: 'ms:' + m.id, source: 'graph', sender: m.from?.emailAddress?.name || '', sender_addr: m.from?.emailAddress?.address || '',
      subject: m.subject || '', preview: m.bodyPreview || '', received_at: Date.parse(m.receivedDateTime) || Date.now(), link: m.webLink || null,
      unread: !m.isRead, importance: m.importance, inference: m.inferenceClassification }, stats);
    if (getS('ms_first_done') !== '1' && stats.important && getS('mail_notify') !== '0') notify(`⭐ ${stats.important} important HCCC email${stats.important === 1 ? '' : 's'}`, 'Starred in StudyDash → Mail. New ones will pop up here.').catch(() => {});
    db.prepare('DELETE FROM mail WHERE starred=0 AND received_at<?').run(Date.now() - 90 * DAY);
    setS('ms_first_done', '1'); setS('ms_last_sync', Date.now()); setS('ms_status', 'ok'); setS('ms_error', '');
    log('outlook sync', stats);
    return stats;
  } catch (e) {
    setS('ms_last_sync', Date.now()); setS('ms_status', 'error'); setS('ms_error', e.message); log('outlook sync failed', e.message);
    throw e;
  } finally { mailBusy = false; }
}
// Outlook on the web, read by the extension/bookmark (for accounts where the school blocks app sign-in).
function importWebMail(list) {
  const stats = { added: 0, important: 0, tasks: 0 };
  for (const m of (Array.isArray(list) ? list : []).slice(0, 150)) {
    const id = String(m.id || '').slice(0, 200); if (!id) continue;
    saveMail({ id: 'web:' + id, source: 'web', sender: clean(m.sender, 120) || '', sender_addr: '', subject: clean(m.subject, 300) || '', preview: clean(m.preview, 400) || '',
      received_at: Number.isFinite(+m.time) ? +m.time : Date.now(), link: 'https://outlook.office.com/mail/', unread: !!m.unread }, stats);
  }
  setS('ms_first_done', '1'); setS('ms_web_last', Date.now());
  return stats;
}
function mailState() {
  const rows = db.prepare('SELECT * FROM mail WHERE hidden=0 ORDER BY received_at DESC LIMIT 1500').all();
  return { rows, connected: !!getS('ms_refresh_token'), hasClient: !!getS('ms_client_id'), email: getS('ms_email'), status: getS('ms_status'), error: getS('ms_error'),
    lastSync: Number(getS('ms_last_sync')) || 0, webLast: Number(getS('ms_web_last')) || 0, redirect: MS_REDIRECT, clientId: getS('ms_client_id'),
    gmail: { connected: !!getS('gm_refresh_token') && getS('gmail_alerts') !== '0', email: getS('gm_email'), activities:getS('gm_activities')||'', lastSync: Number(getS('gm_last_sync')) || 0 },
    hcst: { connected: !!getS('hm_refresh_token') && getS('gmail_alerts') !== '0', email: getS('hm_email'), lastSync: Number(getS('hm_last_sync')) || 0 } };
}

// ---------- state for UI ----------
function jparse(s) { try { return JSON.parse(s || 'null'); } catch { return null; } }
function streak(cat) {
  const days = new Set(db.prepare('SELECT done_at FROM tasks WHERE done=1 AND category=? AND done_at IS NOT NULL').all(cat).map(r => ymd(new Date(r.done_at))));
  let d = today(), n = 0;
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return { n, today: days.has(today()) };
}
function state() {
  ensureRoutineInstances();
  const routines = db.prepare('SELECT * FROM routines ORDER BY days DESC, time').all();
  const routineColors = new Map(routines.map(routine => [routine.id, routine.color]));
  const t = today(), startToday = localMs(t, '00:00');
  const all = db.prepare(`SELECT * FROM tasks WHERE
      (done=0 AND (due_date IS NULL OR due_date<=? ) AND NOT (source IN ('routine','spacecat') AND due_date<?))
      OR (done=1 AND done_at>=?)
      OR (done=0 AND due_date>? AND due_date<=?)`).all(t, t, startToday, t, addDays(t, 30));
  for (const x of all) {
    x.work_date = workDate(x);
    if (x.source === 'routine') x.routine_color = routineColors.get(Number(/^routine:(\d+):/.exec(x.external_id || '')?.[1])) || null;
  }
  // Sort by work day; within a day, next-morning deadlines go after tonight's items.
  const sortKey = x => `${x.work_date || '9999'} ${x.due_date || '9999'} ${x.due_time || '99:99'}`;
  all.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const gcCreds = !!getS('gc_client_id') && !!getS('gc_client_secret');
  return {
    now: Date.now(), today: t, edition: EDITION, appName: APP_NAME,
    iq: iqState(),
    mail: mailState(),
    grades: gradesState(),
    webSync: { feeds: (jparse(getS('gccal_feeds')) || []).map(f => ({ name: f.name, last: f.last, error: f.error, host: (f.url.match(/ical\/([^/]+)/) || [])[1] ? 'Google Calendar' : f.url.split('/')[2] })),
      calLast: Number(getS('gccal_last') || 0), pageLast: Number(getS('gcweb_last') || 0), extLast: Number(getS('ext_last_seen') || 0) },
    overdue: all.filter(x => !x.done && x.due_date && x.due_date < t),
    todayList: all.filter(x => (x.due_date === t || x.work_date === t || (x.done && x.due_date)) && !(!x.done && x.due_date < t)),
    anytime: all.filter(x => !x.due_date),
    upcoming: all.filter(x => !x.done && x.due_date && x.work_date > t),
    routines,
    settings: {
      name: getS('name'), category_colors: categoryColors(), digest_enabled: getS('digest_enabled'), digest_time: getS('digest_time'),
      hw_lead_hours: getS('hw_lead_hours'), autostart: getS('autostart'), notif_mode: getS('notif_mode'), sync_minutes: getS('sync_minutes'),
      ann_notify: getS('ann_notify'), opp_notify: getS('opp_notify'), early_cutoff: getS('early_cutoff'),
      evening_enabled: getS('evening_enabled'), evening_time: getS('evening_time'), evening2_enabled: getS('evening2_enabled'), evening2_time: getS('evening2_time'), startup_open: getS('startup_open'), mail_notify: getS('mail_notify'),
    },
    classroom: {
      hasCreds: gcCreds, clientId: getS('gc_client_id'), connected: !!getS('gc_refresh_token'), status: getS('gc_status'),
      error: getS('gc_error'), lastSync: Number(getS('gc_last_sync')) || 0, lastResult: jparse(getS('gc_last_result')),
      syncing: busy.gc, redirect: REDIRECT, announcements: getS('gc_ann_blocked') !== '1',
    },
    canvas: {
      base: canvasBase(), hasIcs: !!getS('cv_ics'), hasToken: !!getS('cv_token'), status: getS('cv_status'), error: getS('cv_error'),
      lastSync: Number(getS('cv_last_sync')) || 0, lastResult: jparse(getS('cv_last_result')), syncing: busy.cv,
    },
    gmail: {
      connected: !!getS('gm_refresh_token'), email: getS('gm_email'), status: getS('gm_status'), error: getS('gm_error'),
      lastSync: Number(getS('gm_last_sync')) || 0, lastResult: jparse(getS('gm_last_result')), syncing: busy.gm, extra: getS('gm_extra'),
      ownKey: !!getS('gm_client_id'), ownClientId: getS('gm_client_id'), alerts: getS('gmail_alerts') !== '0',
    },
    hcstmail: {
      connected: !!getS('hm_refresh_token'), email: getS('hm_email'), status: getS('hm_status'), error: getS('hm_error'),
      lastSync: Number(getS('hm_last_sync')) || 0, lastResult: jparse(getS('hm_last_result')), syncing: busy.hm,
    },
    posts: db.prepare(`SELECT * FROM posts WHERE created_at>? ORDER BY created_at DESC LIMIT 200`).all(Date.now() - 30 * DAY),
    opportunities: db.prepare(`SELECT * FROM opportunities WHERE status!='hidden' ORDER BY (status='new') DESC, received_at DESC LIMIT 300`).all().filter(o=>o.acct!=='gm'||o.status!=='new'||personalMail({subject:o.subject,preview:o.snippet,sender:o.sender}).cls==='important'),
    dataDir: DATA_DIR, platform: process.platform,
  };
}

// ---------- HTTP ----------
function send(res, code, body, type = 'application/json') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); req.on('error', reject);
  });
}
const clean = (v, n = 300) => (v == null ? null : String(v).slice(0, n));
const validTime = s => /^\d{2}:\d{2}$/.test(s || '');
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function taskReminder(due_date, due_time, remind_before) {
  if (!due_date || remind_before === '' || remind_before == null || remind_before === 'none') return null;
  return localMs(due_date, validTime(due_time) ? due_time : '08:00') - Number(remind_before) * MIN;
}

async function handle(req, res) {
  const host = req.headers.host || '';
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return send(res, 403, { error: 'bad host' });
  const origin = req.headers.origin;
  const fromExt = /^(chrome|extension)-extension:\/\/|^chrome-extension:\/\//.test(origin || '');
  if (req.method === 'OPTIONS' && fromExt) { res.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true' }); return res.end(); }
  if (req.method !== 'GET' && origin && origin !== ORIGIN && origin !== `http://localhost:${PORT}` && !(fromExt && req.url === '/api/web/import')) return send(res, 403, { error: 'bad origin' });
  const url = new URL(req.url, ORIGIN);
  let mm;
  const p = url.pathname, m = req.method;
  if (m === 'GET' && (p === '/assets/ui.js' || p === '/assets/ui.css')) {
    return send(res,200,asset(p.slice(1),'utf8'),p.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
  }
  if (m === 'GET' && p === '/workspace.css') return send(res, 200, asset('workspace.css','utf8'), 'text/css; charset=utf-8');
  if (m === 'GET' && (p === '/api/study/music' || p === '/api/study/audio')) {
    const folder = path.join(__dirname, 'music');
    const entries = await fs.promises.readdir(folder, { withFileTypes: true }).catch(() => []);
    const tracks = entries.filter(entry => entry.isFile() && /\.mp3$/i.test(entry.name)).map(entry => entry.name).sort();
    if (p.endsWith('/music')) return send(res, 200, { tracks });
    const name = url.searchParams.get('name');
    if (!tracks.includes(name)) return send(res, 404, { error: 'Track not found.' });
    const file = path.join(folder, name), { size } = await fs.promises.stat(file);
    const headers = { 'Content-Type':'audio/mpeg', 'Accept-Ranges':'bytes', 'Cache-Control':'no-store' };
    let start = 0, end = size - 1;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        if (range[1] && range[2]) end = Math.min(end, Number(range[2]));
      }
      if (!range || (!range[1] && !range[2]) || start > end) {
        res.writeHead(416, { 'Content-Range':`bytes */${size}` }); return res.end();
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(req.headers.range ? 206 : 200, headers);
    const audio = fs.createReadStream(file, { start, end });
    audio.on('error', () => res.destroy());
    res.on('close', () => audio.destroy());
    return audio.pipe(res);
  }

  if (m === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, asset('ui.html', 'utf8'), 'text/html; charset=utf-8');
  if (m === 'GET' && p === '/import') return send(res, 200, asset('ui.html', 'utf8'), 'text/html; charset=utf-8');
  if (m === 'GET' && p === '/grab.js') return send(res, 200, asset('grab.js', 'utf8').replace('/*READER*/', () => asset('reader.js', 'utf8')).replace(/__PORT__/g, String(PORT)), 'text/javascript; charset=utf-8');
  if (m === 'POST' && p === '/api/mail/import') {
    const b = await readBody(req);
    const list = b.data && b.data.mail;
    if (!Array.isArray(list) || !list.length) return send(res, 400, { error: 'No emails found on that page. Open your Outlook inbox and try again.' });
    return send(res, 200, importWebMail(list));
  }
  if (m === 'POST' && p === '/api/grades/meta') {
    const b = await readBody(req);
    const course = clean(b.course, 120); if (!course) return send(res, 400, { error: 'Missing course' });
    const ex = db.prepare('SELECT * FROM grade_meta WHERE course=?').get(course) || {};
    const level = ['cp', 'honors', 'ap', 'dual', 'none'].includes(b.level) ? b.level : ex.level || null;
    const credits = Number.isFinite(+b.credits) && b.credits !== null && b.credits !== '' ? Math.max(0, Math.min(20, +b.credits)) : ex.credits ?? null;
    const include = 'include' in b ? (b.include ? 1 : 0) : ex.include ?? 1;
    const weights = b.weights === null ? null : b.weights && typeof b.weights === 'object' ? JSON.stringify(b.weights).slice(0, 2000) : ex.weights || null;
    const target = Number.isFinite(+b.target) && b.target !== null && b.target !== '' ? +b.target : ex.target ?? null;
    db.prepare(`INSERT INTO grade_meta(course,level,credits,include,weights,target) VALUES(?,?,?,?,?,?) ON CONFLICT(course) DO UPDATE SET
      level=excluded.level, credits=excluded.credits, include=excluded.include, weights=excluded.weights, target=excluded.target`).run(course, level, credits, include, weights, target);
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/grades/cfg') {
    const b = await readBody(req);
    if (b.reset) { setS('gpa_cfg', ''); db.exec('DELETE FROM grade_meta'); return send(res, 200, { ok: true }); }
    setS('gpa_cfg', JSON.stringify(b.cfg || null).slice(0, 5000)); return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/grades/import') {
    const b = await readBody(req);
    try { return send(res, 200, importGrades(b.data)); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (m === 'POST' && p === '/api/web/import') {
    const b = await readBody(req);
    const d = b.data || {};
    if (!(Array.isArray(d.mail) && d.mail.length)) setS('ext_last_seen', Date.now());
    if (Array.isArray(d.mail) && d.mail.length) { const r = importWebMail(d.mail); return send(res, 200, { ok: true, added: r.important, mail: r }); }
    try { const r = importGrades(b.data); return send(res, 200, { ok: true, ...r }); } catch (e) { return send(res, 200, { ok: true, added: 0, note: e.message }); }
  }
  if (m === 'POST' && p === '/api/gccal') {
    const b = await readBody(req);
    const url = String(b.url || '').trim().replace(/^webcal:/i, 'https:');
    if (!/^https:\/\/\S+\.ics(\?\S*)?$/i.test(url)) return send(res, 400, { error: 'Paste the "Secret address in iCal format" from Google Calendar. It starts with https:// and ends in .ics' });
    const feeds = jparse(getS('gccal_feeds')) || [];
    if (feeds.some(f => f.url === url)) return send(res, 400, { error: 'That calendar is already added.' });
    feeds.push({ url, name: '', last: 0, error: '' });
    setS('gccal_feeds', JSON.stringify(feeds));
    try { const r = await syncClassroomCal(); const f = (jparse(getS('gccal_feeds')) || []).find(x => x.url === url);
      if (f && f.error) { setS('gccal_feeds', JSON.stringify((jparse(getS('gccal_feeds')) || []).filter(x => x.url !== url))); return send(res, 400, { error: f.error }); }
      return send(res, 200, { ...r, name: f && f.name }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (m === 'DELETE' && (mm = p.match(/^\/api\/gccal\/(\d+)$/))) {
    const feeds = jparse(getS('gccal_feeds')) || []; feeds.splice(Number(mm[1]), 1); setS('gccal_feeds', JSON.stringify(feeds)); return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/gccal/sync') { try { return send(res, 200, await syncClassroomCal()); } catch (e) { return send(res, 500, { error: e.message }); } }
  if (m === 'POST' && p === '/api/extension/setup') {
    const dir = path.join(DATA_DIR, 'StudyDash Sync extension');
    fs.mkdirSync(dir, { recursive: true });
    for (const [f, a] of [['manifest.json', 'ext-manifest.json'], ['background.js', 'ext-background.js'], ['content.js', 'ext-content.js'], ['reader.js', 'reader.js']]) fs.writeFileSync(path.join(dir, f), asset(a));
    fs.writeFileSync(path.join(dir, 'icon.png'), asset('icon.png'));
    if (IS_WIN) spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { ok: true, dir });
  }
  if (m === 'POST' && p === '/api/grades/clear') {
    db.exec(`DELETE FROM grade_courses; DELETE FROM grade_items; DELETE FROM iq_events WHERE ext LIKE 'pc:%' OR ext LIKE 'pg:%';`);
    setS('grades_last_import', '0'); return send(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/studydash.webmanifest') return send(res, 200, JSON.stringify({
    id: '/', name: APP_NAME, short_name: APP_NAME, start_url: '/', display: 'standalone',
    theme_color: '#000000', background_color: '#000000',
    icons: [{ src: '/icon.png', sizes: 'any', type: 'image/png' }],
  }), 'application/manifest+json');
  if (m === 'GET' && p === '/icon.png') return send(res, 200, asset('icon.png'), 'image/png');
  if (m === 'GET' && (p === '/assets/icon-dark.png' || p === '/assets/icon-light.png')) return send(res, 200, asset(p.slice(1)), 'image/png');
  if (m === 'GET' && p === '/api/state') return send(res, 200, state());

  // tasks
  if (m === 'POST' && p === '/api/tasks') {
    const b = await readBody(req);
    if (!b.title || !String(b.title).trim()) return send(res, 400, { error: 'title required' });
    if (!validColor(b.color)) return send(res, 400, { error: 'Choose a six-digit hex color or Automatic.' });
    const due_date = validDate(b.due_date) ? b.due_date : null, due_time = validTime(b.due_time) ? b.due_time : null;
    const remind = taskReminder(due_date, due_time, b.remind_before);
    const r = db.prepare(`INSERT INTO tasks(title,notes,category,due_date,due_time,remind_at,notified,source,link,minutes,color,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(clean(b.title).trim(), clean(b.notes, 2000) || '', CATS[b.category] ? b.category : 'other', due_date, due_time, remind, remind && remind > Date.now() ? 0 : 1, 'manual', clean(b.link, 1000), Number(b.minutes) || null, savedColor(b.color), Date.now());
    return send(res, 200, { id: Number(r.lastInsertRowid) });
  }
  if ((mm = p.match(/^\/api\/tasks\/(\d+)$/))) {
    const id = Number(mm[1]);
    const ex = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!ex) return send(res, 404, { error: 'not found' });
    if (m === 'DELETE') {
      // Classroom/routine items are hidden (not deleted) so the next sync doesn't bring them back.
      if (ex.source === 'manual') db.prepare('DELETE FROM tasks WHERE id=?').run(id);
      else db.prepare('UPDATE tasks SET done=3 WHERE id=?').run(id);
      return send(res, 200, { ok: true });
    }
    if (m === 'PATCH') {
      const b = await readBody(req);
      if ('color' in b && !validColor(b.color)) return send(res, 400, { error: 'Choose a six-digit hex color or Automatic.' });
      if (b.skip) db.prepare('UPDATE tasks SET done=2 WHERE id=?').run(id);
      if ('done' in b) db.prepare('UPDATE tasks SET done=?, done_at=? WHERE id=?').run(b.done ? 1 : 0, b.done ? Date.now() : null, id);
      if ('title' in b && String(b.title).trim()) db.prepare('UPDATE tasks SET title=? WHERE id=?').run(clean(b.title).trim(), id);
      if ('notes' in b) db.prepare('UPDATE tasks SET notes=? WHERE id=?').run(clean(b.notes, 2000) || '', id);
      if ('category' in b && CATS[b.category]) db.prepare('UPDATE tasks SET category=? WHERE id=?').run(b.category, id);
      if ('link' in b) db.prepare('UPDATE tasks SET link=? WHERE id=?').run(clean(b.link, 1000), id);
      if ('color' in b) db.prepare('UPDATE tasks SET color=? WHERE id=?').run(savedColor(b.color), id);
      if ('due_date' in b || 'due_time' in b || 'remind_before' in b) {
        const due_date = 'due_date' in b ? (validDate(b.due_date) ? b.due_date : null) : ex.due_date;
        const due_time = 'due_time' in b ? (validTime(b.due_time) ? b.due_time : null) : ex.due_time;
        const remind = 'remind_before' in b ? taskReminder(due_date, due_time, b.remind_before) : ex.remind_at;
        db.prepare('UPDATE tasks SET due_date=?, due_time=?, remind_at=?, notified=? WHERE id=?').run(due_date, due_time, remind, remind && remind > Date.now() ? 0 : 1, id);
      }
      return send(res, 200, { ok: true });
    }
  }
  if (m === 'POST' && (mm = p.match(/^\/api\/tasks\/(\d+)\/snooze$/))) {
    const b = await readBody(req);
    const mins = Math.min(24 * 60, Math.max(1, Number(b.minutes) || 10));
    db.prepare('UPDATE tasks SET remind_at=?, notified=0 WHERE id=?').run(Date.now() + mins * MIN, Number(mm[1]));
    return send(res, 200, { ok: true });
  }

  // routines
  if (m === 'POST' && p === '/api/routines') {
    const b = await readBody(req);
    if (!b.title || !validTime(b.time)) return send(res, 400, { error: 'title and time required' });
    if (!validColor(b.color)) return send(res, 400, { error: 'Choose a six-digit hex color or Automatic.' });
    const days = String(b.days || '').split(',').filter(d => /^[0-6]$/.test(d)).join(',');
    db.prepare('INSERT INTO routines(title,category,days,time,minutes,notes,color,enabled) VALUES(?,?,?,?,?,?,?,1)')
      .run(clean(b.title), CATS[b.category] ? b.category : 'other', days, b.time, Number(b.minutes) || null, clean(b.notes, 1000) || '', savedColor(b.color));
    ensureRoutineInstances();
    return send(res, 200, { ok: true });
  }
  if ((mm = p.match(/^\/api\/routines\/(\d+)$/))) {
    const id = Number(mm[1]);
    const t = today();
    if (m === 'DELETE') {
      db.prepare('DELETE FROM routines WHERE id=?').run(id);
      db.prepare(`DELETE FROM tasks WHERE external_id=? AND done=0`).run(`routine:${id}:${t}`);
      return send(res, 200, { ok: true });
    }
    if (m === 'PATCH') {
      const b = await readBody(req);
      const r = db.prepare('SELECT * FROM routines WHERE id=?').get(id);
      if (!r) return send(res, 404, { error: 'not found' });
      if ('color' in b && !validColor(b.color)) return send(res, 400, { error: 'Choose a six-digit hex color or Automatic.' });
      const n = {
        title: b.title ? clean(b.title) : r.title, category: CATS[b.category] ? b.category : r.category,
        days: 'days' in b ? String(b.days).split(',').filter(d => /^[0-6]$/.test(d)).join(',') : r.days,
        time: validTime(b.time) ? b.time : r.time, minutes: 'minutes' in b ? (Number(b.minutes) || null) : r.minutes,
        notes: 'notes' in b ? clean(b.notes, 1000) || '' : r.notes, enabled: 'enabled' in b ? (b.enabled ? 1 : 0) : r.enabled,
        color: 'color' in b ? savedColor(b.color) : r.color,
      };
      db.prepare('UPDATE routines SET title=?,category=?,days=?,time=?,minutes=?,notes=?,enabled=?,color=? WHERE id=?').run(n.title, n.category, n.days, n.time, n.minutes, n.notes, n.enabled, n.color, id);
      const inst = db.prepare('SELECT * FROM tasks WHERE external_id=?').get(`routine:${id}:${t}`);
      const runsToday = n.enabled && n.days.split(',').map(Number).includes(new Date().getDay());
      if (inst && !inst.done) {
        if (!runsToday) db.prepare('DELETE FROM tasks WHERE id=?').run(inst.id);
        else {
          const remind = localMs(t, n.time);
          db.prepare('UPDATE tasks SET title=?, category=?, notes=?, minutes=?, due_time=?, remind_at=?, notified=? WHERE id=?')
            .run(n.title, n.category, n.notes, n.minutes, n.time, remind, remind > Date.now() ? 0 : inst.notified, inst.id);
        }
      }
      ensureRoutineInstances();
      return send(res, 200, { ok: true });
    }
  }

  // settings
  if (m === 'POST' && p === '/api/settings') {
    const b = await readBody(req);
    if ('category_colors' in b) {
      const colors = b.category_colors;
      if (!colors || typeof colors !== 'object' || Array.isArray(colors) || Object.entries(colors).some(([key,value]) => !Object.hasOwn(CATS,key) || !validColor(value))) return send(res, 400, { error: 'Choose valid category colors or Automatic.' });
      const palette = categoryColors();
      for (const [key,value] of Object.entries(colors)) {
        if (value) palette[key] = savedColor(value);
        else delete palette[key];
      }
      setS('category_colors',JSON.stringify(palette));
    }
    const allowed = ['name', 'digest_enabled', 'digest_time', 'hw_lead_hours', 'autostart', 'notif_mode', 'sync_minutes', 'ann_notify', 'opp_notify', 'gm_extra', 'gm_activities', 'gm_days', 'early_cutoff', 'portal_url', 'evening_enabled', 'evening_time', 'evening2_enabled', 'evening2_time', 'startup_open', 'mail_notify', 'gmail_alerts'];
    for (const k of allowed) if (k in b) setS(k, clean(b[k], 100));
    if ('autostart' in b) setAutostart(b.autostart === '1' || b.autostart === true);
    if ('startup_open' in b && getS('autostart') === '1') setAutostart(true);
    for (const k of ['evening', 'evening2']) if (`${k}_time` in b) setS(`last_${k}`, Date.now() < localMs(today(), getS(`${k}_time`)) ? '' : today());
    if ('digest_time' in b) setS('last_digest', Date.now() < localMs(today(), getS('digest_time')) ? '' : today());
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/test-notification') {
    const r = await notify('🔔 StudyDash test', 'Notifications are working. You\'ll get reminders like this one.', { sticky: false });
    return send(res, 200, r);
  }

  // outlook (HCCC email)
  if (m === 'POST' && p === '/api/outlook/credentials') {
    const b = await readBody(req);
    const id = String(b.client_id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return send(res, 400, { error: 'The Application (client) ID looks like 8-4-4-4-12 letters and numbers, e.g. 1a2b3c4d-....' });
    const tenant = String(b.tenant || 'organizations').trim() || 'organizations';
    if (!/^[\w.-]{3,80}$/.test(tenant)) return send(res, 400, { error: 'Tenant should be "organizations", a domain like hccc.edu, or a directory ID.' });
    setS('ms_client_id', id); setS('ms_tenant', tenant);
    return send(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/api/outlook/connect') {
    if (!getS('ms_client_id')) return send(res, 400, 'Add your Microsoft Application (client) ID in Settings first.', 'text/plain');
    res.writeHead(302, { Location: msAuthUrl() }); return res.end();
  }
  if (m === 'GET' && p === '/oauth/ms') {
    const err = url.searchParams.get('error'), desc = url.searchParams.get('error_description') || '', code = url.searchParams.get('code'), st = url.searchParams.get('state');
    const page = (msg, ok, extra = '') => send(res, ok ? 200 : 400, `<!doctype html><meta charset=utf-8><title>StudyDash</title><body style="font:16px/1.5 system-ui;padding:40px;max-width:620px;margin:auto;color:#16181d"><h2>${ok ? '✅ Connected to your HCCC email' : '⚠️ Not connected yet'}</h2><p>${xmlEsc(msg)}</p>${extra}<p style="margin-top:22px">${ok ? '' : `<a href="/api/outlook/connect" style="background:#1f6feb;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:600">Try again</a> &nbsp; `}<a href="/#mail">Back to StudyDash</a></p>${ok ? '<script>setTimeout(()=>location.href="/#mail",1500)</script>' : ''}</body>`, 'text/html; charset=utf-8');
    const adminHelp = `<div style="background:#fff6d9;border-radius:10px;padding:12px 16px;margin-top:14px;font-size:15px"><b>HCCC needs to approve outside apps for email.</b> That's a school setting, not something wrong on your side. You can still use the <b>Outlook extension or bookmark</b> in StudyDash Settings → HCCC email: it reads your inbox list while you have Outlook open.</div>`;
    if (err) {
      const blocked = /AADSTS65001|AADSTS90094|AADSTS90095|admin|consent/i.test(desc) || err === 'consent_required';
      return page(err === 'access_denied' && !blocked ? 'You clicked Cancel on Microsoft\'s screen.' : `Microsoft said: ${desc.split(/\r?\n/)[0] || err}`, false, blocked ? adminHelp : '');
    }
    if (!msPending || st !== msPending.state) return page('Sign-in session expired. Start again from Settings.', false);
    try {
      const j = await msToken({ grant_type: 'authorization_code', code, redirect_uri: MS_REDIRECT, code_verifier: msPending.verifier });
      msPending = null;
      if (!j.refresh_token) busy[acct] = false;
      if (!j.refresh_token) return page('Microsoft did not return a refresh token. Make sure the app has the offline_access permission and try again.', false);
      setS('ms_refresh_token', j.refresh_token); setS('ms_access_token', j.access_token); setS('ms_expiry', Date.now() + (j.expires_in || 3600) * 1000);
      setS('ms_status', 'ok'); setS('ms_error', ''); setS('ms_email', '');
      let r = await syncOutlook();
      for (let i = 0; r.busy && i < 20; i++) { await new Promise(ok => setTimeout(ok, 500)); r = mailBusy ? { busy: true } : { important: db.prepare("SELECT COUNT(*) n FROM mail WHERE cls='important'").get().n }; }
      return page(`Checked your inbox: ${r.important || 0} important email${r.important === 1 ? '' : 's'} starred. New important mail will pop up as a notification.`, true);
    } catch (e) { return page(e.message, false, /AADSTS65001|consent|admin/i.test(e.message) ? adminHelp : ''); }
  }
  if (m === 'POST' && p === '/api/outlook/sync') {
    if (!getS('ms_refresh_token')) return send(res, 400, { error: 'Connect your HCCC email in Settings first.' });
    try { return send(res, 200, await syncOutlook()); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (m === 'POST' && p === '/api/outlook/disconnect') {
    for (const k of ['refresh_token', 'access_token', 'status', 'error', 'email']) setS(`ms_${k}`, '');
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/mail/seen') { db.exec('UPDATE mail SET seen=1 WHERE seen=0'); return send(res, 200, { ok: true }); }
  if (m === 'POST' && (mm = p.match(/^\/api\/mail\/(.+)$/))) {
    const id = decodeURIComponent(mm[1]), b = await readBody(req);
    const row = db.prepare('SELECT * FROM mail WHERE id=?').get(id); if (!row) return send(res, 404, { error: 'Not found' });
    if ('starred' in b) db.prepare("UPDATE mail SET starred=?,cls=CASE WHEN ?=1 THEN 'important' ELSE cls END,manual_cls=1 WHERE id=?").run(b.starred?1:0,b.starred?1:0,id);
    if ('hidden' in b) db.prepare('UPDATE mail SET hidden=? WHERE id=?').run(b.hidden ? 1 : 0, id);
    if (['important', 'normal', 'promo'].includes(b.cls)) {
      db.prepare('UPDATE mail SET cls=?, starred=?, manual_cls=1 WHERE id=?').run(b.cls, b.cls === 'important' ? 1 : 0, id);
      const snd = normSender(row);
      if (b.remember && snd) {
        db.prepare('INSERT INTO mail_senders(sender,cls) VALUES(?,?) ON CONFLICT(sender) DO UPDATE SET cls=excluded.cls').run(snd, b.cls);
        db.prepare('UPDATE mail SET cls=?, starred=CASE WHEN ?=\'important\' THEN 1 ELSE 0 END WHERE lower(COALESCE(NULLIF(sender_addr,\'\'),sender))=?').run(b.cls, b.cls, snd);
      }
    }
    return send(res, 200, { ok: true });
  }

  // classroom
  if (m === 'POST' && p === '/api/gmail/credentials') {
    const b = await readBody(req);
    if (b.clear) { setS('gm_client_id', ''); setS('gm_client_secret', ''); return send(res, 200, { ok: true }); }
    let id = String(b.client_id || '').trim(), secret = String(b.client_secret || '').trim();
    if (b.json) {
      try { const j = JSON.parse(b.json); const o = j.installed || j.web || j; id = o.client_id || id; secret = o.client_secret || secret; }
      catch { return send(res, 400, { error: 'That doesn\'t look like the client_secret JSON file.' }); }
    }
    if (!id.endsWith('.apps.googleusercontent.com') || !secret) return send(res, 400, { error: 'Need a Desktop-app Client ID (ends in .apps.googleusercontent.com) and Client secret.' });
    if (id !== getS('gm_client_id')) { for (const k of ['refresh_token', 'access_token', 'status', 'error', 'email']) setS(`gm_${k}`, ''); }
    setS('gm_client_id', id); setS('gm_client_secret', secret);
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/classroom/credentials') {
    const b = await readBody(req);
    let id = String(b.client_id || '').trim(), secret = String(b.client_secret || '').trim();
    if (b.json) {
      try { const j = JSON.parse(b.json); const o = j.installed || j.web || j; id = o.client_id || id; secret = o.client_secret || secret; }
      catch { return send(res, 400, { error: 'That doesn\'t look like the client_secret JSON file.' }); }
    }
    if (!id.endsWith('.apps.googleusercontent.com') || !secret) return send(res, 400, { error: 'Need a Desktop-app Client ID (ends in .apps.googleusercontent.com) and Client secret.' });
    setS('gc_client_id', id); setS('gc_client_secret', secret);
    return send(res, 200, { ok: true });
  }
  if (m === 'GET' && (mm = p.match(/^\/api\/(classroom|gmail|hcstmail)\/connect$/))) {
    const acct = { classroom: 'gc', gmail: 'gm', hcstmail: 'hm' }[mm[1]];
    if (!clientFor(acct).id) return send(res, 400, 'Add your Google key in Settings first.', 'text/plain');
    res.writeHead(302, { Location: googleAuthUrl(acct) }); return res.end();
  }
  if (m === 'GET' && p === '/oauth/callback') {
    const err = url.searchParams.get('error'), code = url.searchParams.get('code'), st = url.searchParams.get('state');
    const acct = oauthPending?.acct || 'gc', label = GOOGLE_ACCOUNTS[acct].label;
    const retry = MAIL_ACCTS[acct] ? `/api/${MAIL_ACCTS[acct].route}/connect` : '/api/classroom/connect';
    const page = (msg, ok, extra = '') => send(res, ok ? 200 : 400, `<!doctype html><meta charset=utf-8><title>StudyDash</title><body style="font:16px/1.5 system-ui;padding:40px;max-width:600px;margin:auto;color:#16181d"><h2>${ok ? `✅ Connected to ${label}` : '⚠️ Not connected yet'}</h2><p>${xmlEsc(msg)}</p>${extra}<p style="margin-top:22px">${ok ? '' : `<a href="${retry}" style="background:#1f6feb;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:600">Try again</a> &nbsp; `}<a href="/#settings">Back to StudyDash</a></p>${ok && !extra ? `<script>setTimeout(()=>location.href="/#${MAIL_ACCTS[acct] ? 'mail' : 'settings'}",1500)</script>` : ''}</body>`, 'text/html; charset=utf-8');
    const tickHelp = `<div style="background:#fff6d9;border-radius:10px;padding:12px 16px;margin-top:14px;font-size:15px"><b>On Google's screen:</b> click <b>Continue</b> or <b>Allow</b>. If you see checkboxes, tick <b>Select all</b> first.<br><br>Still stuck? Your Google account might already have StudyDash half-connected. Open <a href="https://myaccount.google.com/connections" target="_blank">myaccount.google.com/connections</a>, remove StudyDash, then click Try again.</div>`;
    if (err) return page(err === 'access_denied' ? 'You clicked Cancel on Google\'s screen, or your school blocks outside apps for this account.' : `Google said: ${err}`, false, err === 'access_denied' ? tickHelp : '');
    if (!oauthPending || st !== oauthPending.state || Date.now() - oauthPending.at > 10 * MIN) return page('Sign-in session expired. Start again from Settings.', false);
    try {
      if (busy[acct]) return page('A sync is running. Try signing in again when it finishes.', false);
      busy[acct] = true;
      const pending = oauthPending;
      oauthPending = null;
      const cl = clientFor(acct);
      if (cl.id !== pending.client.id || cl.secret !== pending.client.secret) throw new Error('The Google key changed. Start sign-in again in Settings.');
      const j = await tokenRequest({ code, client_id: cl.id, client_secret: cl.secret, redirect_uri: REDIRECT, grant_type: 'authorization_code', code_verifier: pending.verifier });
      if (!j.refresh_token) return page('Google did not return a refresh token. Remove StudyDash from your Google account permissions and try again.', false);
      log('oauth granted scopes', acct, j.scope || '(none listed)');
      setS(`${acct}_refresh_token`, j.refresh_token); setS(`${acct}_access_token`, j.access_token); setS(`${acct}_expiry`, Date.now() + (j.expires_in || 3600) * 1000);
      clearGooglePause(acct);
      for (const key of ['history', 'email', 'attempt', 'last_sync']) setS(`${acct}_${key}`, '');
      setS(`${acct}_scopes`, j.scope || ''); setS(`${acct}_status`, 'ok'); setS(`${acct}_error`, '');
      // Don't trust the scope list Google sends back (its wording varies). Ask the API directly.
      const probe = MAIL_ACCTS[acct] ? await probeGmail(acct) : await probeClassroom();
      busy[acct] = false;
      if (probe.deferred) return page(probe.message, true);
      if (probe.error) {
        setS(`${acct}_status`, 'error'); setS(`${acct}_error`, probe.error);
        if (probe.apiOff) {
          const A = probe.apiOff;
          return page(probe.error, false, `<div style="background:#fff6d9;border-radius:10px;padding:12px 16px;margin-top:14px;font-size:15px"><b>This is a quick fix in Google Cloud, not a problem with your account.</b><ol style="margin:8px 0 0;padding-left:20px"><li>Open <a href="${xmlEsc(A.link)}" target="_blank">the ${xmlEsc(A.name)} page</a>${A.proj ? ` (project ${xmlEsc(A.proj)})` : ''}. Make sure the project picker at the top shows the project your key is in.</li><li>Click <b>Enable</b>.</li><li>Wait about a minute, then click <b>Try again</b> below.</li></ol></div>`);
        }
        if (probe.fatal) return page(probe.error, false, probe.school ? '' : tickHelp);
        if (acct === 'gc') syncClassroom().catch(() => {});
        return page('Connected, but Google is holding one thing back:', true, `<p><b>${xmlEsc(probe.error)}</b></p>` + (probe.school ? '' : tickHelp + `<p><a href="${retry}" style="background:#1f6feb;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:600">Reconnect and fix it</a></p>`));
      }
      if (MAIL_ACCTS[acct]) { syncGmail(acct).catch(() => {}); return page(`Checking ${getS(`${acct}_email`) || 'your inbox'} for important mail and opportunities now.`, true); }
      syncClassroom().catch(() => {});
      return page(`Found ${probe.courses} class${probe.courses === 1 ? '' : 'es'}. Syncing your assignments and announcements now. They will appear on the dashboard in a few seconds.`, true);
    } catch (e) { busy[acct] = false; return page(e.message, false); }
  }
  const syncRoute = async (fn, ready, msg) => {
    if (!ready) return send(res, 400, { error: msg });
    try { return send(res, 200, await fn()); } catch (e) { return send(res, 500, { error: e.message }); }
  };
  if (m === 'POST' && p === '/api/classroom/sync') return syncRoute(syncClassroom, getS('gc_refresh_token'), 'Connect Google Classroom in Settings first.');
  if (m === 'POST' && p === '/api/canvas/sync') return syncRoute(syncCanvas, getS('cv_token') || getS('cv_ics'), 'Add your HCCC Canvas link in Settings first.');
  if (m === 'POST' && p === '/api/gmail/sync') return syncRoute(() => syncGmail('gm'), getS('gm_refresh_token'), 'Connect your personal Gmail in Settings first.');
  if (m === 'POST' && p === '/api/hcstmail/sync') return syncRoute(() => syncGmail('hm'), getS('hm_refresh_token'), 'Connect your HCST email in Settings first.');
  if (m === 'POST' && p === '/api/sync-all') {
    const jobs = [];
    if (getS('gc_refresh_token')) jobs.push(syncClassroom());
    if (getS('cv_token') || getS('cv_ics')) jobs.push(syncCanvas());
    if (getS('gm_refresh_token')) jobs.push(syncGmail('gm'));
    if (getS('hm_refresh_token')) jobs.push(syncGmail('hm'));
    if ((jparse(getS('gccal_feeds')) || []).length) jobs.push(syncClassroomCal());
    if (getS('ms_refresh_token')) jobs.push(syncOutlook());
    if (!jobs.length) return send(res, 400, { error: 'Nothing connected yet. Set up Classroom, Canvas or Gmail in Settings.' });
    const r = await Promise.allSettled(jobs);
    const failed = r.filter(x => x.status === 'rejected').map(x => x.reason.message);
    const deferred = r.filter(x => x.value?.deferred || x.value?.busy);
    const messages = [...new Set([...failed, ...deferred.map(x => x.value.message || 'A sync is already running.')])];
    return send(res, failed.length === r.length ? 500 : 200, { ok: !messages.length, synced: r.length - failed.length - deferred.length, error: messages.join(' · ') || undefined });
  }
  if (m === 'POST' && (mm = p.match(/^\/api\/(classroom|gmail|hcstmail)\/disconnect$/))) {
    const acct = { classroom: 'gc', gmail: 'gm', hcstmail: 'hm' }[mm[1]];
    if (busy[acct]) return send(res, 409, { error: 'A sync is running. Disconnect after it finishes.' });
    clearGooglePause(acct);
    // Google revocation can invalidate other tokens issued to the same Google project.
    // Disconnect this StudyDash connection locally.
    for (const k of ['refresh_token', 'access_token', 'status', 'error', 'scopes', 'email', 'history', 'attempt', 'last_sync']) setS(`${acct}_${k}`, '');
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/canvas/settings') {
    const b = await readBody(req);
    if ('ics' in b) {
      const v = String(b.ics || '').trim().replace(/^webcal:/i, 'https:');
      if (v && !/^https:\/\/[^\s]+\.ics(\?.*)?$/i.test(v)) return send(res, 400, { error: 'That doesn\'t look like a Canvas calendar feed. It should end in .ics.' });
      setS('cv_ics', v);
    }
    if ('token' in b) setS('cv_token', String(b.token || '').trim());
    if ('base' in b && b.base) {
      const v = String(b.base).trim().replace(/\/+$/, '');
      if (!/^https:\/\/[a-z0-9.-]+$/i.test(v)) return send(res, 400, { error: 'Canvas address should look like https://canvas.instructure.com' });
      setS('cv_base', v);
    }
    if (!getS('cv_ics') && !getS('cv_token')) { setS('cv_status', ''); setS('cv_error', ''); return send(res, 200, { ok: true }); }
    try { return send(res, 200, await syncCanvas()); } catch (e) {
      if ('token' in b && e.status === 401) { setS('cv_token', ''); if (getS('cv_ics')) syncCanvas().catch(() => {}); }
      return send(res, 400, { error: e.message });
    }
  }

  // announcement stream
  if (m === 'POST' && (mm = p.match(/^\/api\/posts\/(\d+)\/(convert|dismiss|restore|seen)$/))) {
    const id = Number(mm[1]);
    const post = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
    if (!post) return send(res, 404, { error: 'not found' });
    if (mm[2] === 'dismiss') { db.prepare(`UPDATE posts SET state='dismissed' WHERE id=?`).run(id); return send(res, 200, { ok: true }); }
    if (mm[2] === 'restore') { db.prepare(`UPDATE posts SET state='new' WHERE id=?`).run(id); return send(res, 200, { ok: true }); }
    if (mm[2] === 'seen') { db.prepare(`UPDATE posts SET state='seen' WHERE id=? AND state='new'`).run(id); return send(res, 200, { ok: true }); }
    const b = await readBody(req);
    const title = clean(b.title || post.sug_title || 'Assignment').trim();
    if (!validColor(b.color)) return send(res, 400, { error: 'Choose a six-digit hex color or Automatic.' });
    const due_date = validDate(b.due_date) ? b.due_date : null, due_time = validTime(b.due_time) ? b.due_time : null;
    const remind = taskReminder(due_date, due_time, b.remind_before ?? '180');
    const cat = CATS[b.category] ? b.category : (post.source === 'cv' ? 'hccc' : 'homework');
    const r = db.prepare(`INSERT INTO tasks(title,notes,category,due_date,due_time,remind_at,notified,source,course,link,color,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(title, clean(post.text, 2000), cat, due_date, due_time, remind, remind && remind > Date.now() ? 0 : 1, 'manual', post.course, post.link, savedColor(b.color), Date.now());
    db.prepare(`UPDATE posts SET state='assignment', task_id=? WHERE id=?`).run(Number(r.lastInsertRowid), id);
    return send(res, 200, { ok: true, task_id: Number(r.lastInsertRowid) });
  }
  if (m === 'POST' && p === '/api/posts/seen-all') { db.prepare(`UPDATE posts SET state='seen' WHERE state='new' AND likely=0`).run(); return send(res, 200, { ok: true }); }

  // friends (LTN leaderboard)
  if (m === 'POST' && p === '/api/friends') {
    const b = await readBody(req);
    let d; try { d = readFriendCode(b.code); } catch (e) { return send(res, 400, { error: e.message }); }
    if (d.n === (getS('name') || 'Friend')) return send(res, 400, { error: 'That code has your name on it. If it\'s a friend with the same name, one of you can change names in Settings.' });
    const name = clean(d.n, 40);
    const ex = db.prepare('SELECT * FROM friends WHERE name=?').get(name);
    if (ex && ex.updated_at > d.t) return send(res, 200, { ok: true, name, stale: true });
    db.prepare(`INSERT INTO friends(name,iq,stats,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET iq=excluded.iq, stats=excluded.stats, updated_at=excluded.updated_at`)
      .run(name, d.iq, JSON.stringify(d.s || {}), d.t);
    return send(res, 200, { ok: true, name, updated: !!ex });
  }
  if (m === 'DELETE' && (mm = p.match(/^\/api\/friends\/(\d+)$/))) { db.prepare('DELETE FROM friends WHERE id=?').run(Number(mm[1])); return send(res, 200, { ok: true }); }

  // opportunities
  if (m === 'POST' && (mm = p.match(/^\/api\/opps\/(\d+)$/))) {
    const id = Number(mm[1]); const b = await readBody(req);
    const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(id);
    if (!o) return send(res, 404, { error: 'not found' });
    if (['new', 'saved', 'applied', 'hidden'].includes(b.status)) db.prepare('UPDATE opportunities SET status=? WHERE id=?').run(b.status, id);
    if ('deadline' in b) db.prepare('UPDATE opportunities SET deadline=? WHERE id=?').run(validDate(b.deadline) ? b.deadline : null, id);
    if (b.remind) {
      const dl = validDate(b.deadline) ? b.deadline : o.deadline;
      if (!dl) return send(res, 400, { error: 'Pick a deadline first.' });
      const remind = localMs(addDays(dl, -3), '16:00');
      const r = db.prepare(`INSERT INTO tasks(title,notes,category,due_date,due_time,remind_at,notified,source,course,link,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(`Apply: ${o.subject}`.slice(0, 300), `${o.sender}\n${o.snippet}`, 'opps', dl, null, remind, remind > Date.now() ? 0 : 1, 'manual', o.sender,
          `https://mail.google.com/mail/?authuser=${encodeURIComponent(getS(`${o.acct || 'gm'}_email`))}#all/${o.thread_id}`, Date.now());
      db.prepare(`UPDATE opportunities SET task_id=?, status=CASE WHEN status='new' THEN 'saved' ELSE status END WHERE id=?`).run(Number(r.lastInsertRowid), id);
    }
    return send(res, 200, { ok: true });
  }

  // tray / app
  if (m === 'POST' && p === '/api/tray/poll') {
    lastTrayPoll = Date.now();
    const pending = db.prepare(`SELECT COUNT(*) n FROM tasks WHERE done=0 AND due_date=?`).get(today()).n;
    return send(res, 200, { quit: trayQuit, balloons: trayQueue.splice(0), tip: `${APP_NAME}: ${pending} left today` });
  }
  if (m === 'POST' && p === '/api/open') { openDashboard(); return send(res, 200, { ok: true }); }
  if (m === 'GET' && p === '/api/desktop/status') return send(res,200,{app:'StudyDash',root:__dirname,pid:process.pid,node:process.versions.node,executable:process.execPath,profileRoot:process.env.STUDYDASH_PROFILE_ROOT||null});
  if (m === 'POST' && p === '/api/quit') {
    trayQuit = true; send(res, 200, { ok: true });
    if(process.env.STUDYDASH_DESKTOP_EXE)openDashboard(['--quit']);
    else desktopProc?.kill();
    setTimeout(() => { try { trayProc && trayProc.kill(); } catch {} process.exit(0); }, 3500);
    return;
  }
  return send(res, 404, { error: 'not found' });
}

// ---------- boot ----------
const background = process.argv.includes('--background');
const server = http.createServer((req, res) => { handle(req, res).catch(e => { log('req', req.url, e); try { send(res, 500, { error: e.message }); } catch {} }); });
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    // Already running: just show the existing dashboard.
    if (!background) fetch(`${ORIGIN}/api/open`, { method: 'POST' }).catch(() => openDashboard()).finally(() => setTimeout(() => process.exit(0), 500));
    else process.exit(0);
  } else { log('server', e); process.exit(1); }
});
server.listen(PORT, '127.0.0.1', () => {
  log(`StudyDash running at ${ORIGIN} data=${DATA_DIR}`);
  seed();
  if (getS('personal_filter_v2') !== '1') {
    for(const row of db.prepare("SELECT * FROM mail WHERE source='gmail'").all()) {
      const c=classifyMail(row);
      db.prepare("UPDATE mail SET cls=?, score=?, why=?,starred=CASE WHEN ?='promo' THEN 0 ELSE starred END WHERE id=?").run(c.cls,c.score,c.why,c.cls,row.id);
    }
    setS('personal_filter_v2','1');
  }
  // An old version could leave a false "missing permission" error behind; re-check on the next tick.
  if (getS('gc_status') === 'error' && getS('gc_refresh_token')) setS('gc_last_sync', '0');
  // If the account connected as "Gmail" is really a school account, it becomes the HCST inbox.
  if (getS('gm_refresh_token') && getS('gm_email') && !/@(gmail|googlemail)\.com$/i.test(getS('gm_email')) && !getS('hm_refresh_token')) {
    for (const k of ['refresh_token', 'access_token', 'expiry', 'email', 'last_sync', 'status', 'error', 'scopes', 'last_result', 'first_sync_done']) { setS(`hm_${k}`, getS(`gm_${k}`)); setS(`gm_${k}`, k === 'expiry' || k === 'last_sync' ? '0' : ''); }
    setS('hmm_first_done', getS('gmm_first_done')); setS('gmm_first_done', '0');
    db.exec("UPDATE mail SET source='hcst', id='hm:' || substr(id, 4) WHERE source='gmail' AND id LIKE 'gm:%'");
    db.exec("UPDATE opportunities SET acct='hm' WHERE acct IS NULL OR acct='gm'");
    log('moved school account from Gmail to the HCST inbox');
  }
  // Historical destructive migrations are deliberately not replayed in this update.
  if (sea && IS_WIN && getS('autostart') === '1') setAutostart(true); // keep path current if the exe moved
  if (process.env.STUDYDASH_DESKTOP_EXE && IS_WIN) setAutostart(getS('autostart')==='1');
  if (!process.env.STUDYDASH_TEST) registerAumid();
  ensureRoutineInstances();
  if (!process.env.STUDYDASH_TEST) startTray();
  if (!background) openDashboard();
  if (!process.env.STUDYDASH_TEST) { tick(); setInterval(tick, 20e3); }
});

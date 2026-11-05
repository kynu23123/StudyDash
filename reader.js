function __sdRead() {
  /* StudyDash "Send to StudyDash" bookmark. Reads the grades page the student already has open
     (PowerSchool or Genesis) and hands the numbers to the StudyDash app on this computer. */
  var T = function (e) { return (e ? (e.innerText || e.textContent || '') : '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); };
  var L = function (e) { return String(e.innerText || e.textContent || '').split(/\n+/).map(function (x) { return x.replace(/ /g, ' ').trim(); }).filter(Boolean); };
  var attrs = function (e) { var s = ''; [e].concat([].slice.call(e.querySelectorAll('*'))).forEach(function (n) { s += ' ' + (n.getAttribute('title') || '') + ' ' + (n.getAttribute('alt') || '') + ' ' + (n.getAttribute('aria-label') || '') + ' ' + (typeof n.className === 'string' ? n.className : ''); }); return s; };
  var href = location.href;
  var isGen = /genesis/i.test(href) || /genesis/i.test(document.title) || !!document.querySelector('.listroweven,.listrowodd');
  var isPS = !isGen && (/powerschool/i.test(location.host) || /powerschool/i.test(document.title) || /\/guardian\//.test(location.pathname) || /Attendance By Class/.test(document.body.innerText || ''));
  var out = { v: 1, src: isGen ? 'genesis' : isPS ? 'powerschool' : 'portal', url: location.origin + location.pathname, title: document.title, courses: [], items: [], tasks: [] };
  var termRe = /^(Q|MP|T|S|X|E|F|Y)\d$/i;
  var gradeOf = function (s) {
    s = String(s || '').replace(/\[\s*i\s*\]/gi, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s || /^-+$/.test(s)) return null;
    var m = s.match(/^([A-F][+-]?)?\s*(\d{1,3}(?:\.\d+)?)?\s*%?\s*([A-F][+-]?)?$/i);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    return { letter: (m[1] || m[3] || '').toUpperCase() || null, pct: m[2] != null ? parseFloat(m[2]) : null };
  };
  var seen = {};
  var addCourse = function (c) { if (!c.course || seen[c.course]) return; seen[c.course] = 1; out.courses.push(c); };

  /* 1) Class list with term columns (PowerSchool home page: Exp | ... | Course | Q1 Q2 X1 Q3 Q4 X2 F1 | Absences | Tardies) */
  [].slice.call(document.querySelectorAll('table')).forEach(function (tb) {
    var rows = [].slice.call(tb.rows); if (rows.length < 2) return;
    var terms = null, absAfter = false;
    rows.forEach(function (r) {
      if (terms) return;
      var cells = [].slice.call(r.cells).map(T), ci = cells.indexOf('Course');
      if (ci < 0) return;
      var t = cells.slice(ci + 1).filter(function (x) { return termRe.test(x); });
      if (t.length) { terms = t; absAfter = cells.indexOf('Absences') > ci; }
    });
    if (!terms) return;
    rows.forEach(function (r) {
      var tds = [].slice.call(r.querySelectorAll(':scope > td')); if (tds.length < terms.length + 1) return;
      var ci = -1;
      tds.forEach(function (td, i) { if (ci < 0 && /Email|Rm:|\b(Teacher|Instructor)\b/i.test(T(td)) && /[A-Za-z]{3}/.test(T(td))) ci = i; });
      if (ci < 0) return;
      var lines = L(tds[ci]), full = T(tds[ci]);
      var course = (lines[0] || full).split(/\s+Email\s+/)[0].trim();
      var tm = full.match(/Email\s+(.+?)\s+-\s+Rm/);
      var termCells = tds.slice(ci + 1, ci + 1 + terms.length);
      var list = terms.map(function (name, i) { var g = gradeOf(T(termCells[i])); return { term: name, letter: g ? g.letter : null, pct: g ? g.pct : null }; });
      var rest = tds.slice(ci + 1 + terms.length).map(T);
      addCourse({ course: course, teacher: tm ? tm[1] : '', period: T(tds[0]).slice(0, 20), terms: list,
        absences: absAfter && /^\d+$/.test(rest[0] || '') ? +rest[0] : null, tardies: absAfter && /^\d+$/.test(rest[1] || '') ? +rest[1] : null });
    });
  });

  /* 2) Genesis "Grade Summary": one card per class ("S1 | English 2 Honors   Smith, Michelle A"),
        then a small table: MP1 9/02 to 11/13 | MP2 ... over a row like 95.20 (A) | --- */
  var firstTok = function (t) { return String(t).split(/\s+/)[0]; };
  var cardTitle = function (tb) {
    var node = tb;
    for (var up = 0; up < 5 && node; up++) {
      var prev = node.previousElementSibling;
      while (prev) {
        var cand = [prev].concat([].slice.call(prev.querySelectorAll('*'))).filter(function (e) { return /\|\s*\S/.test(T(e)) && T(e).length < 160; });
        if (cand.length) {
          cand.sort(function (a, b) { return T(a).length - T(b).length; });
          var titleEl = cand[0], t = T(titleEl);
          var teacher = '';
          [].slice.call(prev.querySelectorAll('*')).concat([prev]).forEach(function (e) { var x = T(e); if (!teacher && e !== titleEl && !e.contains(titleEl) && /^[A-Z][A-Za-z'\-]+,\s*[A-Z][A-Za-z .'\-]*$/.test(x)) teacher = x; });
          var mm = t.match(/^\s*([A-Z]{1,2}\d?)\s*\|\s*(.+)$/);
          var course = (mm ? mm[2] : t.split('|').pop()).trim();
          if (teacher && course.slice(-teacher.length) === teacher) course = course.slice(0, -teacher.length).trim();
          return { course: course, period: mm ? mm[1] : '', teacher: teacher };
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
      if (node && node.querySelectorAll('table').length > 1) break;
    }
    return null;
  };
  [].slice.call(document.querySelectorAll('table')).forEach(function (tb) {
    var rows = [].slice.call(tb.rows); if (rows.length < 2 || rows.length > 6) return;
    var hi = rows.findIndex(function (r) { return [].slice.call(r.cells).some(function (c) { return /^MP\d$/i.test(firstTok(T(c))); }); });
    if (hi < 0 || !rows[hi + 1]) return;
    var heads = [].slice.call(rows[hi].cells).map(function (c) { return firstTok(T(c)).toUpperCase(); });
    var vals = [].slice.call(rows[hi + 1].cells).map(T);
    var terms = [];
    heads.forEach(function (hd, i) { if (/^MP\d$/.test(hd)) { var g = gradeOf(vals[i]); terms.push({ term: hd, letter: g ? g.letter : null, pct: g ? g.pct : null }); } });
    var info = cardTitle(tb); if (!info || !info.course) return;
    addCourse({ course: info.course, teacher: info.teacher, period: info.period, terms: terms });
  });

  /* 2b) Genesis gradebook summary rows (listrowodd / listroweven) with a percentage */
  if (isGen) {
    var mpSel = document.querySelector('select[name*="mp" i] option:checked, select[name*="MarkingPeriod" i] option:checked');
    var mp = mpSel ? T(mpSel).replace(/\s+/g, '').toUpperCase().replace(/^MARKINGPERIOD/, 'MP') : 'Current';
    if (!termRe.test(mp)) mp = /^\d$/.test(mp) ? 'MP' + mp : 'Current';
    [].slice.call(document.querySelectorAll('tr.listrowodd, tr.listroweven')).forEach(function (r) {
      var tds = [].slice.call(r.cells); if (tds.length < 2) return;
      var pct = null, letter = null;
      tds.forEach(function (td) {
        var t = T(td), m = t.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
        if (m && pct == null && !/\d+\s*\/\s*\d+/.test(t)) pct = parseFloat(m[1]);
        if (!letter && /^[A-F][+-]?$/.test(t)) letter = t;
      });
      if (pct == null && !letter) return;
      var hasDate = tds.some(function (td) { return /^(mon|tue|wed|thu|fri|sat|sun)?\w*\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?$/i.test(T(td)); });
      if (hasDate) return; /* that's an assignment row, handled below */
      var lines = L(tds[0]);
      addCourse({ course: lines[0], teacher: lines[1] || '', period: '', terms: [{ term: mp, letter: letter, pct: pct }] });
    });
  }

  /* 3) Assignment rows: any table row with a due date plus a score, a percentage or a Missing/Late flag */
  var pageCourse = '';
  var h = document.querySelector('h1, h2, .course-name, #courseName');
  [].slice.call(document.querySelectorAll('table')).some(function (tb) {
    var hdr = [].slice.call((tb.rows[0] || { cells: [] }).cells).map(T);
    var ci = hdr.indexOf('Course');
    if (ci >= 0 && hdr.indexOf('Teacher') >= 0 && tb.rows[1] && !out.courses.length) { pageCourse = T(tb.rows[1].cells[ci]); return true; }
    return false;
  });
  if (!pageCourse && h && !/grades|attendance|gradebook|home/i.test(T(h))) pageCourse = T(h);
  /* PowerSchool's class score page is per reporting term (…scores.html?…&fg=Q1) */
  var pageTerm = ((location.search.match(/[?&]fg=([A-Z]\d)/i) || [])[1] || '').toUpperCase() || null;
  var today = new Date();
  var toISO = function (s) {
    var m = String(s).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (!m) return null;
    var y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
    var d = new Date(y, +m[1] - 1, +m[2]); if (!m[3] && d - today > 45 * 864e5) d.setFullYear(y - 1);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  };
  var dateCell = /^(mon|tue|wed|thu|fri|sat|sun)?[a-z]*\.?\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?$/i;
  [].slice.call(document.querySelectorAll('table')).forEach(function (tb) {
    var rows = [].slice.call(tb.rows); if (rows.length < 2) return;
    var map = {};
    for (var k = 0; k < Math.min(3, rows.length); k++) {
      /* column positions honor colspan (PowerSchool's "Flags" header spans 7 icon columns) */
      var hcells = [].slice.call(rows[k].cells), hc = [], pos = 0;
      hcells.forEach(function (c) { hc[pos] = T(c); for (var q = 1; q < (c.colSpan || 1); q++) hc[pos + q] = ''; pos += c.colSpan || 1; });
      if (hc.some(function (x) { return /^(due|date|due date)$/i.test(x); })) {
        hc.forEach(function (x, i) {
          if (/^(due|date|due date)$/i.test(x)) map.date = i;
          else if (/assignment|description|^name$/i.test(x)) map.name = map.name == null ? i : map.name;
          else if (/^(course|class)$/i.test(x)) map.course = i;
          else if (/categor/i.test(x)) map.cat = i;
          else if (/^(score|grade|points|mark)$/i.test(x)) map.score = map.score == null ? i : map.score;
          else if (/^%$|percent/i.test(x)) map.pct = i;
        });
        break;
      }
    }
    rows.forEach(function (r) {
      var raw = [].slice.call(r.cells); if (raw.length < 3 || r.querySelector('th')) return;
      /* spread cells out to column positions so they line up with the header map */
      var tds = [], texts = [], cp = 0;
      raw.forEach(function (c) { tds[cp] = c; texts[cp] = T(c); for (var q = 1; q < (c.colSpan || 1); q++) { tds[cp + q] = c; texts[cp + q] = ''; } cp += c.colSpan || 1; });
      if (raw.length === 1) return;
      var di = map.date != null ? map.date : texts.findIndex(function (t) { return dateCell.test(t); });
      if (di < 0 || !texts[di] || !/\d{1,2}\/\d{1,2}/.test(texts[di])) return;
      var flags = attrs(r) + ' ' + texts.join(' ');
      if (/exempt|excused/i.test(flags)) return;
      var missing = /\bmissing\b/i.test(flags), late = /\blate\b/i.test(flags);
      var score = null, max = null, pct = null;
      /* Only read the score from the Score column when there is one: names like "9/11 Interview" or
         "Participation 9/14-17" look like scores otherwise. */
      var scoreRe = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/;
      texts.forEach(function (t, i) {
        if (i === di || i === map.name || i === map.cat) return;
        if (map.score != null && i !== map.score) return;
        var sm = t.match(map.score != null ? /(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/ : scoreRe);
        if (sm && score == null) { score = parseFloat(sm[1]); max = parseFloat(sm[2]); }
      });
      texts.forEach(function (t, i) {
        if (i === di || i === map.name || i === map.cat || pct != null) return;
        if (map.pct != null && i !== map.pct) return;
        var pm = t.match(/^\s*(\d{1,3}(?:\.\d+)?)\s*%\s*$/);
        if (pm) pct = parseFloat(pm[1]);
      });
      if (score != null && max === 0) { score = null; max = null; }
      if (map.pct != null && pct == null) { var pv = parseFloat(texts[map.pct]); if (!isNaN(pv)) pct = pv; }
      var status = missing ? 'missing' : late ? 'late' : (score != null || pct != null) ? 'graded' : null;
      if (!status) return;
      var ni = map.name;
      if (ni == null) {
        var best = -1, bl = 0;
        texts.forEach(function (t, i) {
          if (i === di || /\d+\s*\/\s*\d+|%/.test(t) || t.length < 3) return;
          var first = L(tds[i])[0] || t; if (first.length > bl) { bl = first.length; best = i; }
        });
        ni = best;
      }
      if (ni < 0 || !tds[ni]) return;
      var name = (L(tds[ni])[0] || texts[ni]).slice(0, 160);
      var course = map.course != null ? (L(tds[map.course])[0] || '') : pageCourse;
      out.items.push({ name: name, course: course, category: map.cat != null ? texts[map.cat] : '', due: toISO(texts[di]), score: score, max: max, pct: pct, status: status, term: pageTerm });
    });
  });

  /* 3b) PowerSchool "Final Grade Calculations" tables: how each class weights categories and terms */
  out.formulas = [];
  [].slice.call(document.querySelectorAll('table')).forEach(function (tb) {
    var hdr = [].slice.call((tb.rows[0] || { cells: [] }).cells).map(T);
    if (hdr.indexOf('Reporting Term') < 0 || !hdr.some(function (x) { return /calculation type/i.test(x); })) return;
    var title = '', el = tb;
    for (var n = 0; n < 6 && el && !title; n++) {
      var prev = el.previousElementSibling;
      while (prev && !title) { var tt = T(prev); if (/final grade calculations/i.test(tt)) title = tt; prev = prev.previousElementSibling; }
      el = el.parentElement;
    }
    var parts = title.replace(/^.*?final grade calculations\s*[-–]\s*/i, '').split(/\s+[-–]\s+/);
    var course = (parts[0] || '').replace(/\s+Exp\.?\s*[\w\-()]+\s*$/i, '').trim();
    if (!course) return;
    var f = { course: course, teacher: (parts[1] || '').trim(), terms: {} };
    [].slice.call(tb.rows).slice(1).forEach(function (r) {
      var c = [].slice.call(r.cells).map(T); if (c.length < 2) return;
      var items = [];
      L(r.cells[2] || r.cells[1]).forEach(function (line) { var m = line.match(/^\(?\s*(\d*\.?\d+)\s*%\s*\)?\s*(.+)$/); if (m) items.push([parseFloat(m[1]), m[2].trim()]); });
      f.terms[c[0].toUpperCase()] = { type: /category/i.test(c[1]) ? 'category' : /term/i.test(c[1]) ? 'term' : 'points', items: items };
    });
    out.formulas.push(f);
  });

  /* 4) Google Classroom pages (To-do: Assigned / Missing / Done, or a class's Classwork page).
        Each assignment is a link like /c/<class>/a/<assignment>/details. */
  if (/classroom\.google\.com$/i.test(location.host)) {
    out.src = 'classroom';
    var path = location.pathname;
    var pageStatus = /\/a\/missing/i.test(path) ? 'missing' : /\/a\/(turned-in|done|returned)/i.test(path) ? 'done' : /\/a\/not-turned-in/i.test(path) ? 'assigned' : null;
    var tabSel = document.querySelector('[role="tab"][aria-selected="true"]');
    if (!pageStatus && tabSel) { var tt = T(tabSel); pageStatus = /missing/i.test(tt) ? 'missing' : /done|turned in/i.test(tt) ? 'done' : /assigned/i.test(tt) ? 'assigned' : null; }
    var clsName = '';
    var hdr = document.querySelector('[role="heading"][aria-level="1"], h1');
    if (/\/c\//.test(path) && hdr) clsName = T(hdr);
    var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    var WK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    var iso = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    var parseDue = function (s) {
      var t = String(s).toLowerCase(), base = new Date(); base.setHours(0, 0, 0, 0);
      var d = null, m;
      if (/\btoday\b/.test(t)) d = new Date(base);
      else if (/\btomorrow\b/.test(t)) { d = new Date(base); d.setDate(d.getDate() + 1); }
      else if (/\byesterday\b/.test(t)) { d = new Date(base); d.setDate(d.getDate() - 1); }
      else if ((m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/))) {
        var y = m[3] ? +m[3] : base.getFullYear(); d = new Date(y, MON.indexOf(m[1]), +m[2]);
        if (!m[3] && pageStatus !== 'missing' && d < base - 120 * 864e5) d.setFullYear(y + 1);
        if (!m[3] && d - base > 200 * 864e5) d.setFullYear(y - 1);
      } else if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) {
        d = new Date(m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : base.getFullYear(), +m[1] - 1, +m[2]);
      } else if ((m = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*/))) {
        d = new Date(base); var add = (WK.indexOf(m[1]) - d.getDay() + 7) % 7;
        if (pageStatus === 'missing' || pageStatus === 'done') { add = add - 7; if (add === -7) add = 0; }
        d.setDate(d.getDate() + add);
      }
      var tm = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)/) || t.match(/\b(\d{1,2})\s*(am|pm)\b/);
      var time = null;
      if (tm) { var hh = +tm[1] % 12, mm2 = tm[3] ? tm[2] : '00', ap = tm[3] || tm[2]; if (ap === 'pm') hh += 12; time = ('0' + hh).slice(-2) + ':' + mm2; if (!d) { d = new Date(base); } }
      return d ? { date: iso(d), time: time } : null;
    };
    var metaRe = /^(due\b|posted\b|edited\b|missing\b|turned in\b|done\b|assigned\b|graded\b|returned\b|no due date|handed in|\d+ points?|\d+\s*\/\s*\d+|see all|view all|view assignment|view details|this week|next week|later|earlier|no due date)/i;
    var seenA = {};
    [].slice.call(document.querySelectorAll('a[href*="/a/"], a[href*="/sa/"], a[href*="/mc/"]')).forEach(function (a) {
      var mm = (a.getAttribute('href') || '').match(/\/c\/([\w-]+)\/(?:a|sa|mc)\/([\w-]+)/);
      if (!mm || seenA[mm[2]]) return;
      var box = a.closest('li') || a;
      var lines = L(box).filter(function (x) { return x.length < 200; });
      if (!lines.length) return;
      var content = lines.filter(function (x) { return !metaRe.test(x); });
      var title = content[0];
      if (!title) return;
      var course = clsName || (content[1] && content[1] !== title ? content[1] : '');
      var dueLine = lines.filter(function (x) { return /^(due\b|missing\b)/i.test(x) || /\bdue\b/i.test(x); })[0] || '';
      var all = lines.join(' ');
      var st = pageStatus;
      if (!st) st = /\bmissing\b/i.test(all) ? 'missing' : /turned in|done|handed in|graded|returned/i.test(all) ? 'done' : 'assigned';
      var due = dueLine ? parseDue(dueLine) : null;
      seenA[mm[2]] = 1;
      out.tasks.push({ id: mm[2], cls: mm[1], title: title.slice(0, 200), course: course.slice(0, 120), due: due ? due.date : null, time: due ? due.time : null,
        status: st, late: /\blate\b/i.test(all), link: 'https://classroom.google.com' + (a.getAttribute('href').replace(/^https?:\/\/classroom\.google\.com/i, '')) });
    });
  }
  /* 5) Outlook on the web (HCCC email): the message list in the inbox. Reads sender, subject,
        preview and time from each row; never opens a message or reads full bodies. */
  out.mail = [];
  if (/(^|\.)outlook\.(office|office365|live)\.com$/i.test(location.host) || /^outlook\.cloud\.microsoft$/i.test(location.host)) {
    out.src = 'outlook';
    var timeRe = /^(\d{1,2}:\d{2}\s*(AM|PM)?|(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*(\s+\d{1,2}(:\d{2})?\s*(AM|PM)?)?(\s+\d{1,2}\/\d{1,2})?|\d{1,2}\/\d{1,2}(\/\d{2,4})?|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(,?\s*\d{4})?|Yesterday.*)$/i;
    var whenMs = function (s) {
      var now = new Date(), d = new Date(now), m;
      if ((m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i))) { var h = +m[1] % (m[3] ? 12 : 24); if (/pm/i.test(m[3] || '')) h += 12; d.setHours(h, +m[2], 0, 0); return +d; }
      if (/^yesterday/i.test(s)) { d.setDate(d.getDate() - 1); d.setHours(12, 0, 0, 0); return +d; }
      if ((m = s.match(/^(sun|mon|tue|wed|thu|fri|sat)/i))) { var back = (d.getDay() - ['sun','mon','tue','wed','thu','fri','sat'].indexOf(m[1].toLowerCase()) + 7) % 7 || 7; d.setDate(d.getDate() - back); d.setHours(12, 0, 0, 0); return +d; }
      if ((m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) return +new Date(m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : now.getFullYear(), +m[1] - 1, +m[2], 12);
      var t = Date.parse(s + (/\d{4}/.test(s) ? '' : ' ' + now.getFullYear())); if (t && t > now + 864e5) t = Date.parse(s + ' ' + (now.getFullYear() - 1));
      return t || +now;
    };
    var rows = [].slice.call(document.querySelectorAll('[data-convid], [role="listbox"] [role="option"]'));
    var seenM = {};
    rows.forEach(function (r) {
      var id = r.getAttribute('data-convid') || r.getAttribute('data-item-id') || r.id;
      var lines = L(r).filter(function (x) { return x.length < 400 && !/^(Pinned|Flagged|Has attachments?|Meeting|Draft)$/i.test(x); });
      if (lines.length < 2) return;
      var ti = -1; for (var i = 1; i < lines.length; i++) if (timeRe.test(lines[i])) { ti = i; break; }
      var sender = lines[0], subject = lines[1] && ti !== 1 ? lines[1] : lines[2] || '';
      var rest = lines.filter(function (x, i) { return i > 0 && i !== ti && x !== subject; });
      var preview = rest.join(' ').slice(0, 400);
      if (!id) id = sender + '|' + subject + '|' + (ti > 0 ? lines[ti] : '');
      if (seenM[id]) return; seenM[id] = 1;
      var label = r.getAttribute('aria-label') || '';
      out.mail.push({ id: String(id).slice(0, 200), sender: sender.slice(0, 120), subject: subject.slice(0, 300), preview: preview,
        time: ti > 0 ? whenMs(lines[ti]) : null, unread: /^unread\b/i.test(label) || /\bunread\b/i.test(r.className || '') });
    });
  }
  return out;
}

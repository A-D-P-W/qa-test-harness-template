// v0.1.6: synced from MailToDrive 3.12.8. 1-2: the hang watchdog (M106, M112); 3: a bare Date() under the clock-ahead
// shim (M110); 4: the FULL clock reruns must give every suite the same counts (M109). GUARD (d) (M107) is driven end to end
// by tools/guard_selftest.sh (planted module Promised; the fixture module's contract test cites its guarantees), as every
// GUARD is (L101), and so are the watchdog (a hung planted suite) and the count comparison (a planted suite that adds a
// PASS 60 days out).
// Run: node tests/v016.test.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const D = path.join(__dirname, '..'), WD = path.join(D, 'tools', 'watchdog.js'), SHIM = path.join(D, 'tools', 'clockahead.js');
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  -- ' + x)); };
const node = (args, env) => cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { NODE_OPTIONS: '', MTD_WATCHDOG_S: '', MTD_CLOCK_AHEAD_DAYS: '' }, env), encoding: 'utf8', timeout: 60000 });
const R = fs.readFileSync(path.join(D, 'runall.sh'), 'utf8');

// 1. runall wiring: the watchdog is preloaded into every node suite, once, with a limit that leaves room for a slower CI
// runner (M112), and the type check (npm ci, tsc: long silent steps) runs without it
{ const def = Number((/^export MTD_WATCHDOG_S=\$\{MTD_WATCHDOG_S:-(\d+)\}$/m.exec(R) || [])[1]);
  ok(def >= 120, 'runall.sh: default watchdog limit ' + def + ' s (>= 120 s: a limit set from local timings killed healthy suites on CI, M112)');
  ok(/^case "\$\{NODE_OPTIONS:-\}" in \*tools\/watchdog\.js\*\) ;; \*\) export NODE_OPTIONS="\$\{NODE_OPTIONS:\+\$NODE_OPTIONS \}--require \\"\$D\/tools\/watchdog\.js\\"" ;; esac$/m.test(R),
    'runall.sh: NODE_OPTIONS gets --require tools/watchdog.js unless it already has it (the nested clock and template runs inherit it)');
  const ex = R.indexOf('export MTD_WATCHDOG_S='), first = R.search(/^\s*(?:[A-Z_]+=\S* )*node /m);
  ok(ex > 0 && first > ex, 'runall.sh: the watchdog is set up before the first node suite runs');
  // L110: node splits NODE_OPTIONS at spaces, so every path runall puts there is double-quoted (tools/guard_selftest.sh also
  // runs runall from a folder whose path has a space; the clock-ahead lines run only under FULL, so this check covers them)
  const req = R.split('\n').filter(l => /--require /.test(l) && !/^\s*#/.test(l));
  ok(req.length >= 3 && req.every(l => (l.match(/--require /g) || []).length === (l.match(/--require \\"\$D\/[^"\\]+\\"/g) || []).length),
    'runall.sh: every --require path in NODE_OPTIONS is double-quoted (' + req.length + ' lines)', req.filter(l => !/--require \\"/.test(l)).join(' | '));
  const tc = R.split('\n').filter(l => /tests\/typecheck\/run\.sh/.test(l) && !/^\s*#/.test(l));
  ok(tc.length >= 2 && tc.every(l => /MTD_WATCHDOG_S=0 /.test(l)), 'runall.sh: every type-check call runs with MTD_WATCHDOG_S=0 (' + tc.length + ' calls)', tc.join(' | ')); }

// 2. the watchdog itself
{ const r = node(['-r', WD, '-e', "console.log('PASS before'); /^(a+)+$/.test('a'.repeat(40) + '!');"], { MTD_WATCHDOG_S: '2' });
  ok(r.signal === 'SIGKILL' && /^FAIL watchdog: no output for 2 s \(a hang, M106\) after: PASS before$/m.test(r.stdout), 'watchdog: a stuck regex gets one FAIL line naming the last output, and the process is killed', JSON.stringify({ sig: r.signal, out: r.stdout.slice(-200) }));
  const s = node(['-r', WD, '-e', 'for (;;) {}'], { MTD_WATCHDOG_S: '2' });
  ok(s.signal === 'SIGKILL' && /^FAIL watchdog: no output for 2 s \(a hang, M106\) after: \(start of suite\)$/m.test(s.stdout), 'watchdog: a suite stuck before its first line says so', JSON.stringify({ sig: s.signal, out: s.stdout.slice(-200) }));
  const q = node(['-r', WD, '-e', "console.log('PASS quick')"], { MTD_WATCHDOG_S: '2' });
  ok(q.status === 0 && q.stdout === 'PASS quick\n', 'watchdog: a suite that finishes exits normally (the worker never keeps it alive)', JSON.stringify(q.stdout));
  const off = node(['-r', WD, '-e', "setTimeout(() => console.log('PASS late'), 2500)"], { MTD_WATCHDOG_S: '0' });
  ok(off.status === 0 && off.stdout === 'PASS late\n', 'watchdog: MTD_WATCHDOG_S=0 switches it off (the type check)', JSON.stringify({ st: off.status, out: off.stdout }));
  // a suite that stubs or shifts Date.now (the clock-ahead preload does) does not trip it: it times with process.hrtime
  const st = node(['-e', "Date.now = () => 0; let i = 0; const h = setInterval(() => { console.log('PASS t' + (++i)); if (i > 12) clearInterval(h); }, 300);"],
    { MTD_WATCHDOG_S: '2', NODE_OPTIONS: '--require ' + JSON.stringify(WD) });
  ok(st.status === 0 && !/watchdog/.test(st.stdout), 'watchdog: Date.now stubbed to 0 by the suite does not trip it (monotonic hrtime)', JSON.stringify({ st: st.status, sig: st.signal }));
  // preloaded through NODE_OPTIONS (as runall does), every worker inherits the preload: only the main thread may watch, or a
  // worker's own silence kills a healthy suite that keeps printing (M106). Here the suite's own worker is silent for 4.5 s.
  const busy = "const { Worker } = require('worker_threads'); new Worker('Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4500)', { eval: true });" +
    "let i = 0; const h = setInterval(() => { console.log('PASS tick ' + (++i)); if (i >= 15) clearInterval(h); }, 300);";
  const b = node(['-e', busy], { MTD_WATCHDOG_S: '2', NODE_OPTIONS: '--require ' + JSON.stringify(WD) });
  ok(b.status === 0 && !/watchdog/.test(b.stdout) && (b.stdout.match(/^PASS tick/gm) || []).length === 15, 'watchdog via NODE_OPTIONS: a suite printing every 0.3 s, with a silent worker, runs 4.5 s past a 2 s limit (workers do not watch)', JSON.stringify({ st: b.status, sig: b.signal, tail: b.stdout.slice(-120) })); }

// 3. clockahead: a bare Date() call (M110). A class cannot be called without `new`, so with Date replaced by a class a bare
// Date() (which real Date answers with the current time as a string) threw under the FULL clock reruns.
{ const real = Number(node(['-e', 'console.log(Date.now())'], {}).stdout);
  const r = node(['-r', SHIM, '-e',
    "const vm = require('vm'); class X extends Date {}; console.log(JSON.stringify({ s: Date(), t: typeof Date(), n: Date.now(), d: new Date().getTime(), x: new X() instanceof X && new X() instanceof Date, inst: new Date() instanceof Date, c: vm.runInContext('Date()', vm.createContext({})), e: new Date(0).toISOString(), u: Date.UTC(2000, 0, 1), p: Date.parse('2000-01-01T00:00:00Z') }));"],
    { MTD_CLOCK_AHEAD_DAYS: '90' });
  let o = {}; try { o = JSON.parse(r.stdout); } catch (e) { o = { err: r.stderr.slice(0, 200) }; }
  const days = x => (x - real) / 864e5;
  ok(o.t === 'string' && Math.abs(days(Date.parse(o.s)) - 90) < 0.05, 'clockahead: a bare Date() returns the shifted time as a string (90 days ahead), as real Date does', JSON.stringify(o));
  ok(Math.abs(days(o.n) - 90) < 0.05 && Math.abs(days(o.d) - 90) < 0.05 && o.inst === true && o.x === true && o.e === '1970-01-01T00:00:00.000Z', 'clockahead: Date.now(), new Date(), subclasses and explicit dates still behave', JSON.stringify(o));
  ok(o.u === 946684800000 && o.p === 946684800000, 'clockahead: Date.UTC and Date.parse are the real ones', JSON.stringify(o));
  ok(typeof o.c === 'string' && Math.abs(days(Date.parse(o.c)) - 90) < 0.05, 'clockahead: a bare Date() inside a vm context is shifted too', o.c); }

// 4. M109: the verdict compares each suite's PASS/FAIL/RISK counts with the FULL clock reruns. Driven on runall's own verdict
// step (the python block of runall.sh) with a hand-made out/ folder: same counts, other counts, a suite the rerun dropped,
// a suite whose output file is missing, and the suites not compared.
{ const py = (R.split(`python3 - "$O" "$D" <<'PY'\n`)[1] || '').split('\nPY\n')[0];
  ok(py.length > 1000, 'runall.sh: verdict step found (' + py.length + ' chars)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v016-'));
  try {
    const put = (rel, t) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), t); };
    const one = 'PASS one\n', two = 'PASS one\nPASS two\n';
    const verdict = () => cp.spawnSync('python3', ['-', tmp, D], { input: py, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { GITHUB_REF_NAME: 'v016-scratch' }) });
    const SU = ['same', 'more', 'risky', 'dropped', 'nofile', 'deploy', 'typecheck', 'calendar.typecheck'];
    put('_fails.txt', ''); put('_suites.txt', SU.join('\n') + '\n');
    for (const s of SU) put(s + '.txt', one);
    const m109 = out => out.split('\n').filter(l => /\(M109\)$/.test(l));
    const none = m109(verdict().stdout);
    ok(none.length === 0, 'verdict: no clock rerun folders, no M109 line', none.join(' | '));
    put('clock90/_suites.txt', SU.filter(s => s !== 'dropped').join('\n') + '\n');
    for (const s of SU) if (s !== 'nofile') put('clock90/' + s + '.txt', one);
    put('clock90/more.txt', two); put('clock90/risky.txt', one + 'RISK planted\n');
    for (const s of ['deploy', 'typecheck', 'calendar.typecheck']) put('clock90/' + s + '.txt', two);
    const out = verdict().stdout, lines = m109(out);
    ok(lines.includes('GUARD suite more gives other counts with the clock 90 days ahead (PASS/FAIL/RISK (1, 0, 0) -> (2, 0, 0)): an assertion depends on the date (M109)'), 'verdict: a suite with another PASS count in the 90-day rerun fails', lines.join(' | '));
    ok(lines.includes('GUARD suite risky gives other counts with the clock 90 days ahead (PASS/FAIL/RISK (1, 0, 0) -> (1, 0, 1)): an assertion depends on the date (M109)'), 'verdict: a RISK line that shows only in the rerun fails too', lines.join(' | '));
    ok(lines.includes('GUARD suite dropped did not run in the clock 90 days ahead rerun (M109)') && lines.includes('GUARD suite nofile did not run in the clock 90 days ahead rerun (M109)'), 'verdict: a suite the rerun dropped, or whose rerun output is missing, fails (this run\'s suites are the list)', lines.join(' | '));
    ok(lines.length === 4, 'verdict: same counts, deploy, the type checks and the absent 365-day rerun give no M109 line (' + lines.length + ' lines)', lines.join(' | '));
    put('clock365/_suites.txt', SU.join('\n') + '\n'); for (const s of SU) put('clock365/' + s + '.txt', one); put('clock365/same.txt', '');
    const l365 = m109(verdict().stdout).filter(l => /365 days/.test(l));
    ok(l365.length === 1 && /^GUARD suite same gives other counts with the clock 365 days ahead \(PASS\/FAIL\/RISK \(1, 0, 0\) -> \(0, 0, 0\)\)/.test(l365[0]), 'verdict: the 365-day rerun is compared the same way', l365.join(' | '));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

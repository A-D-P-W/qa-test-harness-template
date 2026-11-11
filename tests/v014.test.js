// v0.1.4 (M100, seeded from MailToDrive L100): a fixture with a fixed date passes until the date ages out of a lookback
// window. tools/clockahead.js moves every clock a suite can read; FULL runall reruns every suite 90 days ahead (suite clock90).
// Ported from MailToDrive's tests/v3125.test.js (sections 1 and 2); section 3 drives the class on a small aging fixture.
// tools/guard_selftest.sh runs the FULL rerun end to end on a planted aging test.
// Run: node tests/v014.test.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const D = path.join(__dirname, '..'), SHIM = path.join(D, 'tools', 'clockahead.js');
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  -- ' + x)); };
const node = (args, env) => cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { NODE_OPTIONS: '' }, env), encoding: 'utf8', timeout: 120000 });

// 1. the shim: every no-argument clock moves, explicit dates do not, vm contexts get it, a bad setting refuses to load
{ const probe = `const vm = require('vm'); const t = Date.now(); console.log(JSON.stringify({ now: t, nd: new Date().getTime(), zero: new Date(0).getTime(),
    utc: Date.UTC(2026, 0, 1), cc: vm.runInContext('Date.now()', vm.createContext({})), rn: vm.runInNewContext('new Date().getTime()'),
    own: vm.runInContext('Date.now()', vm.createContext({ Date: { now: () => 7 } })) }))`;
  const ref = node(['-e', 'console.log(Date.now())'], {}), real = Number(ref.stdout);   // an unshifted child: this file may itself run under the shim (clock90)
  const r = node(['--require', SHIM, '-e', probe], { MTD_CLOCK_AHEAD_DAYS: '90' }), j = (() => { try { return JSON.parse(r.stdout); } catch (e) { return null; } })();
  const near = v => j && Math.abs(v - real - 90 * 864e5) < 60e3;   // clock-safe: compares two clock readings, no calendar date
  ok(j && near(j.now) && near(j.nd), 'Date.now() and new Date() are 90 days ahead', r.stdout + r.stderr);
  ok(j && j.zero === 0 && j.utc === 1767225600000, 'new Date(ms) and Date.UTC are unchanged');
  ok(j && near(j.cc) && near(j.rn), 'vm.createContext and vm.runInNewContext sandboxes get the shifted clock');
  ok(j && j.own === 7, 'a sandbox that brings its own Date keeps it');
  for (const bad of ['', '0', '-5', 'x', '4000']) {
    const b = node(['--require', SHIM, '-e', '1'], { MTD_CLOCK_AHEAD_DAYS: bad });
    ok(b.status !== 0 && /MTD_CLOCK_AHEAD_DAYS must be/.test(b.stderr), 'MTD_CLOCK_AHEAD_DAYS=' + JSON.stringify(bad) + ' refuses to load (no silent no-op)');
  }
}

// 2. runall wiring: FULL runs the rerun once (not inside itself), MTD_OUT cannot point outside out/
{ const R = fs.readFileSync(path.join(D, 'runall.sh'), 'utf8');
  ok(/if \[ -n "\$FULL" \] && \[ -z "\$\{MTD_CLOCK_AHEAD_DAYS:-\}" \]; then/.test(R) && /MTD_CLOCK_AHEAD_DAYS=90 NODE_OPTIONS="[^"]*--require \$D\/tools\/clockahead\.js"/.test(R) && /sum clock90 /.test(R),
    'runall.sh: FULL reruns every suite 90 days ahead as suite clock90, never nested inside itself');
  ok(/grep -q '\^VERDICT: PASS' "\$O\/_clock90_run\.txt"/.test(R) && /runall printed no VERDICT/.test(R), 'runall.sh: clock90 passes only on the nested VERDICT: PASS (a missing verdict fails)');
  const o = cp.spawnSync('bash', [path.join(D, 'runall.sh')], { env: Object.assign({}, process.env, { MTD_OUT: os.tmpdir() }), encoding: 'utf8', timeout: 20000 });
  ok(o.status === 2 && /MTD_OUT must be inside/.test(o.stdout + o.stderr), 'runall.sh refuses an MTD_OUT outside out/ before deleting anything', String(o.status));
}

// 3. the class: a fixture with a fixed limit 30 days out passes today and fails 90 days ahead; a clock-relative one passes both
{ const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v014-'));
  try {
    const limit = Number(node(['-e', 'console.log(Date.now() + 30 * 864e5)'], {}).stdout);   // clock-safe: an unshifted child's clock, written as a fixed date
    const fixed = path.join(tmp, 'fixed.js'), rel = path.join(tmp, 'relative.js');
    fs.writeFileSync(fixed, `if (Date.now() > ${limit}) { console.log('FAIL fixture aged out'); process.exit(1); } console.log('PASS fixture');\n`);
    fs.writeFileSync(rel, `const limit = Date.now() + 1; if (Date.now() > limit + 864e5) process.exit(1); console.log('PASS fixture');\n`);   // clock-safe: relative to its own clock
    const a = node([fixed], {}), b = node(['--require', SHIM, fixed], { MTD_CLOCK_AHEAD_DAYS: '90' }), c = node(['--require', SHIM, rel], { MTD_CLOCK_AHEAD_DAYS: '90' });
    ok(a.status === 0 && b.status === 1 && /aged out/.test(b.stdout), 'a fixture with a fixed date 30 days out passes today and fails 90 days ahead (exit ' + a.status + ', ' + b.status + ')');
    ok(c.status === 0, 'a fixture dated relative to the clock passes 90 days ahead');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

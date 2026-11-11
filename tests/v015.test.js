// v0.1.5 (M101, seeded from MailToDrive L101): a future-clock check finds only the fixtures that age out within its horizon.
// FULL runall reruns every suite 365 days ahead (suite clock365) beside the 90-day rerun (clock90, v014).
// tools/guard_selftest.sh runs both reruns end to end on planted tests that age out at 30 and 200 days.
// Run: node tests/v015.test.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const D = path.join(__dirname, '..'), SHIM = path.join(D, 'tools', 'clockahead.js');
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  -- ' + x)); };
const node = (args, env) => cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { NODE_OPTIONS: '' }, env), encoding: 'utf8', timeout: 120000 });

// 1. runall wiring: inside the same FULL-only, never-nested block as clock90, judged the same way
{ const R = fs.readFileSync(path.join(D, 'runall.sh'), 'utf8'), blk = (R.split('if [ -n "$FULL" ] && [ -z "${MTD_CLOCK_AHEAD_DAYS:-}" ]; then')[1] || '').split('\nfi\n')[0];
  ok(/MTD_CLOCK_AHEAD_DAYS=365 NODE_OPTIONS="[^"]*--require \$D\/tools\/clockahead\.js"/.test(blk) && /sum clock365 /.test(blk), 'runall.sh: FULL reruns every suite 365 days ahead as suite clock365, in the never-nested FULL block');
  ok(/MTD_CLOCK_AHEAD_DAYS=90 /.test(blk) && /sum clock90 /.test(blk), 'runall.sh: the 90-day rerun stays beside it (a year-boundary or DST failure can show at one shift only)');
  ok(/grep -q '\^VERDICT: PASS' "\$O\/_clock365_run\.txt"/.test(blk) && /FAIL clock \+365 days: runall printed no VERDICT/.test(blk), 'runall.sh: clock365 passes only on the nested VERDICT: PASS (a missing verdict fails)');
  ok(/MTD_OUT="\$O\/clock365"/.test(blk) && /MTD_OUT="\$O\/clock90"/.test(blk), 'runall.sh: each rerun writes its own folder inside out/'); }

// 2. the class: a fixture that ages out at 200 days passes at +90 and fails at +365
{ const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v015-'));
  try {
    const limit = Number(node(['-e', 'console.log(Date.now() + 200 * 864e5)'], {}).stdout);   // clock-safe: an unshifted child's clock, written as a fixed date
    const f = path.join(tmp, 'fixed.js');
    fs.writeFileSync(f, `if (Date.now() > ${limit}) { console.log('FAIL fixture aged out'); process.exit(1); } console.log('PASS fixture');\n`);
    const a = node(['--require', SHIM, f], { MTD_CLOCK_AHEAD_DAYS: '90' }), b = node(['--require', SHIM, f], { MTD_CLOCK_AHEAD_DAYS: '365' });
    ok(a.status === 0, 'a fixture with a fixed date 200 days out passes 90 days ahead (clock90 alone misses it)');
    ok(b.status === 1 && /aged out/.test(b.stdout), 'the same fixture fails 365 days ahead (exit ' + b.status + ')');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

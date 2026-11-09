// v0.1.1: tests/v368.test.js must fail, not pass, when its AST checks do not run (L107). Before 0.1.1 a missing parser
// left two checks and "2 passed, 0 failed", even with FULL=1.
// Run: SRC=<abs .gs> node tests/v011.test.js
const path = require('path'), os = require('os'), cp = require('child_process');
const SRC = process.env.SRC || process.env.MTD_GS || path.resolve(__dirname, '..', 'App.gs');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const run = env => cp.spawnSync(process.execPath, [path.join(__dirname, 'v368.test.js')], { env: { ...process.env, SRC, ...env }, encoding: 'utf8' });
const none = path.join(os.tmpdir(), 'v011-no-acorn-here');
for (const full of ['', '1']) {
  const r = run({ MTD_ACORN: none, MTD_TC_CACHE: none, FULL: full });
  ok(r.status === 1 && /^FAIL the \d+ AST checks ran; NOT RUN: alias, chain, alias corpus, chain corpus, L100, L100 corpus/m.test(r.stdout),
    'v368 without the parser' + (full ? ' (FULL=1)' : '') + ' fails and names the checks that did not run (exit ' + r.status + ')');
}
const r = run({});
ok(r.status === 0 && /^PASS the \d+ AST checks ran$/m.test(r.stdout), 'v368 with the parser reports that all its AST checks ran (exit ' + r.status + ')');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

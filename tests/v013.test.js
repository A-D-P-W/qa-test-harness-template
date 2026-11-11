// v0.1.3: the typecheck PASS line names the tool versions tests/typecheck/package-lock.json pins, read from the lockfile
// (L109). Before 0.1.3 the line said "typescript 5.9.3" as typed text, so after Dependabot's bump to 7.0.2 every run would
// have named a compiler it no longer ran.
// A stub compiler (MTD_TSC) stands in for tsc; run.sh is copied next to an edited lockfile to show the line follows it.
// Run: node tests/v013.test.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const H = path.resolve(__dirname, 'typecheck');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'v013-'));
const stub = path.join(W, 'tsc'); fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const gs = path.join(W, 'App.gs'); fs.writeFileSync(gs, 'function health() { return 1; }\n');
const run = dir => cp.spawnSync('bash', [path.join(dir, 'run.sh')], { encoding: 'utf8', env: { ...process.env, MTD_TSC: stub, MTD_GS: gs, MTD_TC_CACHE: path.join(W, 'cache') } });
const want = lock => ['typescript', '@types/google-apps-script'].map(p => p + ' ' + lock.packages['node_modules/' + p].version).join(', ');
try {
  const lock = JSON.parse(fs.readFileSync(path.join(H, 'package-lock.json'), 'utf8'));
  let r = run(H);
  ok(r.status === 0 && r.stdout.trim() === 'PASS typecheck: 0 errors (' + want(lock) + ')', 'the PASS line names the locked versions: ' + r.stdout.trim());
  const D = path.join(W, 'edited'); fs.mkdirSync(D);
  fs.copyFileSync(path.join(H, 'run.sh'), path.join(D, 'run.sh')); fs.copyFileSync(path.join(H, 'package.json'), path.join(D, 'package.json'));
  lock.packages['node_modules/typescript'].version = '99.0.0';
  fs.writeFileSync(path.join(D, 'package-lock.json'), JSON.stringify(lock));
  r = run(D);
  ok(r.status === 0 && r.stdout.includes('(typescript 99.0.0, '), 'an edited lockfile changes the PASS line (the versions are read, not typed): ' + r.stdout.trim());
  fs.writeFileSync(path.join(D, 'package-lock.json'), '{}');
  r = run(D);
  ok(r.status === 1 && /^FAIL typecheck: could not read the tool versions/m.test(r.stdout), 'a lockfile without the packages fails the suite (exit ' + r.status + '), never a PASS with no versions');
  ok(!/\b\d+\.\d+\.\d+\b/.test(fs.readFileSync(path.join(H, 'run.sh'), 'utf8').split('\n').filter(l => /PASS typecheck/.test(l)).join('\n')),
    'run.sh types no version number into its PASS line');
} finally { fs.rmSync(W, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

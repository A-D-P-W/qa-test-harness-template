// v0.1.2: tools/template_check.sh runs the scratch copy on this checkout's branch, with last_review_commit set to the copy's
// first commit in a review-record commit of its own (L108). Before 0.1.2 the copy was always on branch template-check, so
// runall's main-only GUARDs never applied to the template's own main: its CHANGELOG stayed dated (dev) from 0.1.0 to 0.1.1,
// and every run printed two NOTICEs before VERDICT: PASS.
// The real runall is replaced by a stub in a scratch copy (the real one runs this file, so calling it here would recurse);
// tools/guard_selftest.sh drives template_check.sh with the real runall on main.
// Run: node tests/v012.test.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const D = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'v012-'));
const sh = (cwd, cmd, env) => cp.spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const STUB = `#!/bin/bash
echo "branch=$(git rev-parse --abbrev-ref HEAD)"
echo "ref=\${GITHUB_REF_NAME-unset}"
lrc=$(python3 -c 'import json; print(json.load(open("tests/workflow_review.json"))["last_review_commit"])')
if [ "$lrc" = "$(git rev-parse HEAD~1)" ]; then echo "lrc=first"; else echo "lrc=$lrc"; fi
echo "commits=$(git rev-list --count HEAD)"
python3 tools/review_count.py .
`;
// copy <branch>: the tracked files as a git repo on <branch>, with runall.sh replaced by STUB
function copy(name, branch) {
  const C = path.join(W, name); fs.mkdirSync(C);
  const t = sh(D, `git ls-files -z | tar --null -T - -cf - | tar -xf - -C "${C}"`);
  if (t.status !== 0) throw new Error('copy failed: ' + t.stderr);
  fs.writeFileSync(path.join(C, 'runall.sh'), STUB, { mode: 0o755 });
  const g = sh(C, `git init -q -b "${branch}" && git add -A && git -c user.email=t@t.invalid -c user.name=t commit -qm copy`);
  if (g.status !== 0) throw new Error('git init failed: ' + g.stderr);
  return C;
}
const check = (C, env) => sh(C, 'env -u GITHUB_REF_NAME ' + Object.entries(env || {}).map(([k, v]) => k + '=' + JSON.stringify(v)).join(' ') + ' bash tools/template_check.sh');
const line = (out, k) => ((out.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]);
try {
  for (const br of ['main', 'feature/x']) {
    const r = check(copy(br.replace('/', '-'), br));
    ok(r.status === 0 && line(r.stdout, 'branch') === br, `checkout on ${br}: the scratch copy is on ${br} (got ${line(r.stdout, 'branch')}, exit ${r.status})`);
    ok(line(r.stdout, 'ref') === 'unset', `checkout on ${br}: GITHUB_REF_NAME is unset for the inner run (L79)`);
    ok(line(r.stdout, 'lrc') === 'first' && line(r.stdout, 'commits') === '2', `checkout on ${br}: last_review_commit = the copy's first commit, set in a second commit (got ${line(r.stdout, 'lrc')}, ${line(r.stdout, 'commits')} commits)`);
    ok(/^workflow changes since last review: 0\/8 commits, 0\/400 lines$/m.test(r.stdout) && !/^NOTICE/m.test(r.stdout),
      `checkout on ${br}: the review trigger runs and counts 0 (the record commit is excluded), no NOTICE`);
    ok(new RegExp('^template_check: scratch copy of \\d+ tracked files on branch ' + br.replace('/', '\\/') + ' ').test(r.stdout), `checkout on ${br}: the first line names the branch`);
  }
  const C = copy('ci', 'some-branch');
  let r = check(C, { GITHUB_REF_NAME: 'main' });
  ok(line(r.stdout, 'branch') === 'main' && line(r.stdout, 'ref') === 'unset', `CI: GITHUB_REF_NAME=main wins over the local branch name, and is unset inside (got ${line(r.stdout, 'branch')})`);
  sh(C, 'git checkout -q --detach');
  r = check(C);
  ok(r.status === 0 && line(r.stdout, 'branch') === 'template-check', `detached HEAD: the copy uses template-check (got ${line(r.stdout, 'branch')})`);
  r = check(C, { GITHUB_REF_NAME: 'bad..name' });
  ok(r.status === 0 && line(r.stdout, 'branch') === 'template-check', `a ref name git refuses as a branch: the copy uses template-check (got ${line(r.stdout, 'branch')})`);
  fs.writeFileSync(path.join(C, 'tests', 'workflow_review.json'), '{}\n');
  sh(C, 'git -c user.email=t@t.invalid -c user.name=t commit -qam broken');
  r = check(C);
  ok(r.status === 2 && /^template_check: FAIL could not set last_review_commit in the scratch copy$/m.test(r.stdout), `no last_review_commit field: template_check fails (exit ${r.status}) instead of running unfilled`);
} finally { fs.rmSync(W, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// v0.1.8: two ports from MailToDrive. 1: tools/review_count.py also counts origin/main when HEAD does not contain it, and
// prints a NOTICE that the checkout is stale or diverged (M126, seeded from MailToDrive L126); driven on real git repos, with
// three mutants. 2: runall's verdict step prints `NOTICE: CI time budget` when a FULL CI run uses more than 80% of the
// runall job's timeout-minutes (MailToDrive 3.12.14); driven on the verdict step with a hand-made out/ folder.
// Run: node tests/v018.test.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const D = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  -- ' + String(x).slice(0, 300))); };

// 1. M126: tools/review_count.py on a stale checkout, a branch ahead, a diverged branch and a repository with no origin
{ const RC = path.join(D, 'tools', 'review_count.py'), RC_SRC = fs.readFileSync(RC, 'utf8');
  // no detached `git gc --auto` writing into a folder this test deletes (MailToDrive L124)
  const NOGC = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'gc.auto', GIT_CONFIG_VALUE_0: '0', GIT_CONFIG_KEY_1: 'maintenance.auto', GIT_CONFIG_VALUE_1: 'false' };
  const ENV = { ...process.env, ...NOGC, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' };
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'v018-'));
  const git = (cwd, ...a) => cp.execFileSync('git', a, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const count = (dir, script = RC) => cp.execFileSync('python3', [script, dir], { env: ENV, encoding: 'utf8' }).trim();
  const put = (dir, f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  const cfg = base => JSON.stringify({ last_review_commit: base, last_review_date: '2026-01-01', threshold_commits: 8, threshold_lines: 400, paths: ['tests/'] }, null, 1);
  const mutant = (name, from, to) => { const S = RC_SRC.replace(from, to), p = path.join(T, name + '.py'); fs.writeFileSync(p, S); return S !== RC_SRC ? p : null; };
  const OM = "om = g('rev-parse', '--verify', '-q', 'refs/remotes/origin/main^{commit}').strip()", PICK = 'if share(n2, l2) > share(n, lines):';
  const noOm = mutant('rc_no_origin_main', OM, "om = ''");                 // the 0.1.7 behaviour: HEAD only
  const never = mutant('rc_never_origin', PICK, 'if False:');               // NOTICE printed, origin/main never decides
  const always = mutant('rc_always_origin', PICK, 'if True:');              // origin/main decides even when HEAD is nearer
  ok(noOm && never && always, 'the three mutants apply to tools/review_count.py (the lines they edit are where they expect)');
  try {
    const up = path.join(T, 'up'); fs.mkdirSync(up); git(up, 'init', '-q', '-b', 'main');
    put(up, 'tests/workflow_review.json', cfg('none')); put(up, 'tests/a.txt', 'a\n'); git(up, 'add', '-A'); git(up, 'commit', '-qm', 'base');
    put(up, 'tests/workflow_review.json', cfg(git(up, 'rev-parse', 'HEAD'))); git(up, 'commit', '-qam', 'review record');   // a record: not counted
    const solo = count(up);
    ok(/^workflow changes since last review: 0\/8 commits, 0\/400 lines$/.test(solo), 'a repository with no origin (as in tools/template_check.sh): no NOTICE, counted on HEAD', solo);
    git(T, 'clone', '-q', 'up', 'clone'); const cl = path.join(T, 'clone');
    ok(/^workflow changes since last review: 0\/8 commits/.test(count(cl)) && !/NOTICE/.test(count(cl)), 'fresh clone: no NOTICE, 0 counted (the record commit is excluded)', count(cl));
    for (let i = 0; i < 9; i++) { put(up, 'tests/a.txt', 'a' + i + '\n'); git(up, 'commit', '-qam', 'w' + i); }
    git(cl, 'fetch', '-q', 'origin');                                     // origin/main is now 9 workflow commits ahead of local main
    const st = count(cl);
    ok(/^NOTICE: HEAD [0-9a-f]+ does not contain origin\/main [0-9a-f]{7} \(stale checkout/m.test(st) && /^NOTICE: WORKFLOW REVIEW DUE \(9 commits \/ \d+ changed lines in workflow files since 2026-01-01 on origin\/main\) - see CLAUDE\.md$/m.test(st),
      'stale checkout (local main 9 behind origin/main): stale NOTICE, and DUE counted on origin/main', st);
    if (noOm) { const m = count(cl, noOm); ok(/^workflow changes since last review: 0\/8 commits/.test(m) && !/NOTICE/.test(m), 'mutant killed: without the origin/main check the same stale checkout reads NOT DUE with no NOTICE (the 0.1.7 behaviour)', m); }
    if (never) { const m = count(cl, never); ok(/does not contain origin\/main/.test(m) && !/REVIEW DUE/.test(m), "mutant killed: a NOTICE alone, with origin/main's count never used, reads NOT DUE", m); }
    git(cl, 'merge', '-q', '--ff-only', 'origin/main'); git(cl, 'checkout', '-q', '-b', 'work'); put(cl, 'tests/b.txt', 'b\n'); git(cl, 'add', '-A'); git(cl, 'commit', '-qm', 'ahead');
    const ah = count(cl);
    ok(!/does not contain origin\/main/.test(ah) && /^NOTICE: WORKFLOW REVIEW DUE \(10 commits .* since 2026-01-01\) - see CLAUDE\.md$/.test(ah), 'a branch ahead of origin/main: no stale NOTICE, counted on HEAD (10 commits)', ah);
    git(cl, 'checkout', '-q', '-b', 'side', 'HEAD~3'); put(cl, 'tests/c.txt', 'c\n'); git(cl, 'add', '-A'); git(cl, 'commit', '-qm', 'side');   // diverged: 8 here, 9 on origin/main
    const dv = count(cl);
    ok(/does not contain origin\/main/.test(dv) && /REVIEW DUE \(9 commits .* on origin\/main\)/.test(dv), 'a diverged branch (8 commits here, 9 on origin/main): stale NOTICE, and origin/main, nearer its threshold, decides', dv);
    for (let i = 0; i < 3; i++) { put(cl, 'tests/c.txt', 'c' + i + '\n'); git(cl, 'commit', '-qam', 'side' + i); }   // 11 here, 9 on origin/main
    const dh = count(cl);
    ok(/does not contain origin\/main/.test(dh) && /^NOTICE: WORKFLOW REVIEW DUE \(11 commits .* since 2026-01-01\) - see CLAUDE\.md$/m.test(dh), 'a diverged branch (11 commits here, 9 on origin/main): stale NOTICE, and HEAD, nearer its threshold, decides', dh);
    if (always) { const m = count(cl, always); ok(/REVIEW DUE \(9 commits .* on origin\/main\)/.test(m), 'mutant killed: always taking origin/main undercounts the diverged branch (9 instead of 11)', m); }
  } catch (e) { ok(false, 'review_count.py git scenarios ran', String(e && e.message || e)); }
  finally { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } }

// 2. the CI time-budget NOTICE (ported from MailToDrive 3.12.14): driven on runall's verdict step with a hand-made out/
{ const Y = fs.readFileSync(path.join(D, '.github', 'workflows', 'tests.yml'), 'utf8');
  const lim = Number((/\n  runall:\n(?:(?: {4}[^\n]*)?\r?\n)*? {4}timeout-minutes: ["']?(\d+)/.exec(Y) || [])[1]);
  ok(lim > 0, "CI: the runall job has a timeout-minutes the verdict step can read (" + lim + ')');
  const R = fs.readFileSync(path.join(D, 'runall.sh'), 'utf8'), py = (R.split(`python3 - "$O" "$D" <<'PY'\n`)[1] || '').split('\nPY\n')[0];
  ok(py.length > 1000 && /NOTICE: CI time budget/.test(py), "runall.sh: the verdict step (python3 heredoc) is found and holds the budget NOTICE");
  { const lines = R.split('\n'), ex = lines.findIndex(l => /(^|;\s*)export MTD_RUNALL_T0\b/.test(l)), py0 = lines.findIndex(l => l.startsWith('python3 - "$O" "$D" <<\'PY\''));
    ok(ex >= 0 && py0 > ex, 'runall.sh exports MTD_RUNALL_T0 before the verdict step runs (a plain assignment would never reach it)', 'export at line ' + (ex + 1) + ', verdict step at ' + (py0 + 1)); }
  ok(/env -u PWSH -u FULL MTD_OUT="\$O\/clock90"/.test(R) && /env -u PWSH -u FULL MTD_OUT="\$O\/clock365"/.test(R), 'the clock reruns run without FULL, so only the outer run can print the budget NOTICE');
  const run = (t0, drop = []) => { const O = fs.mkdtempSync(path.join(os.tmpdir(), 'v018o-'));
    try { for (const f of ['_suites.txt', '_projects.txt', '_fails.txt']) fs.writeFileSync(path.join(O, f), '');
      const env = { ...process.env, GITHUB_ACTIONS: 'true', FULL: '1', MTD_RUNALL_T0: String(t0), GITHUB_REF_NAME: 'v018-scratch' };
      for (const k of drop) delete env[k];
      return cp.spawnSync('python3', ['-', O, D], { input: py, encoding: 'utf8', timeout: 120000, env }).stdout || '';
    } finally { fs.rmSync(O, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } };
  const budget = o => o.split('\n').find(l => /budget/.test(l)) || '-';
  if (lim > 0) {
    // the verdict step reads the real clock (python time.time()); under runall's clock reruns this file's Date is shifted
    const now = Math.floor((Date.now() - (Number(process.env.MTD_CLOCK_AHEAD_DAYS) || 0) * 864e5) / 1000);   // clock-safe: undoes runall's clock-ahead shift to get the real time, no day boundary involved
    const over = Math.round(0.8 * lim * 60) + 60, under = Math.round(0.8 * lim * 60) - 60;   // a minute past and a minute short of 80%
    const late = run(now - over), short = run(now - under), early = run(now - 60), noCI = run(now - over, ['GITHUB_ACTIONS']), noFull = run(now - over, ['FULL']), noT0 = run(now - over, ['MTD_RUNALL_T0']);
    ok(new RegExp("^NOTICE: CI time budget: this FULL run took " + Math.floor(over / 60) + " min of the runall job's " + lim + "-minute limit \\(over 80%\\)", 'm').test(late),
      'a FULL CI run a minute past 80% of the job limit prints the NOTICE with the minutes used and the limit', budget(late));
    ok(![short, early, noCI, noFull, noT0].some(o => /CI time budget/.test(o)), 'no budget NOTICE a minute short of 80%, after a minute, off CI, without FULL, or without a start time',
      [short, early, noCI, noFull, noT0].map(budget).join(' | '));
    ok(/^VERDICT: /m.test(late) && /^VERDICT: /m.test(noT0), 'the verdict step ran to its VERDICT line in the driven cases', late.slice(-200));
  } }

// 3. the lesson row and the docs
{ const L = fs.readFileSync(path.join(D, 'tests', 'LESSONS.md'), 'utf8'), C = fs.readFileSync(path.join(D, 'CLAUDE.md'), 'utf8'), Rd = fs.readFileSync(path.join(D, 'README.md'), 'utf8');
  ok(/^\| M126 \| A trigger that counts from the local HEAD/m.test(L) && /tests\/v018\.test\.js/.test((L.match(/^\| M126 .*$/m) || [''])[0]), 'tests/LESSONS.md seeds MailToDrive L126 as M126, with this file as its guard');
  ok(/origin\/main/.test(C) && /CI time budget/.test(C) && /origin\/main/.test(Rd) && /CI time budget/.test(Rd), 'CLAUDE.md and README describe the stale-checkout count and the CI time-budget NOTICE'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

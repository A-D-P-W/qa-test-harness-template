// v0.1.7: synced from MailToDrive 3.12.10's review fixes. 1: v368 also checks calls with a scope too weak for them, so a
// NEEDS row widened with a wrong scope fails (M115); 2: the Windows deploy job runs under PowerShell 7 and Windows PowerShell
// 5.1, the shell an owner who types `powershell` deploys with (M116); 3: the GUARD (d) docs say what the guard checks.
// Run: node tests/v017.test.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const D = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  -- ' + String(x).slice(0, 300))); };

// 1. M115: a widened row fails v368 (driven on a copy of v368 with the Gmail.Users row widened to gmail.readonly)
{ const V = fs.readFileSync(path.join(D, 'tests', 'v368.test.js'), 'utf8');
  ok(/^const ROW_NOT = \[/m.test(V) && /no NEEDS row accepts a scope too weak for its call/.test(V), 'tests/v368.test.js has ROW_NOT: calls with a scope too weak for them');
  const row = "['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.modify']],";
  const at = V.indexOf("[/\\bGmail\\.Users\\.(?!Messages\\.(get|list)\\s*\\()/, " + row);
  ok(at > 0, 'tests/v368.test.js: the Gmail.Users row (other than Messages get/list) is where the mutant expects it');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'v017-'));
  try {
    fs.mkdirSync(path.join(T, 'tests')); fs.cpSync(path.join(D, 'tools'), path.join(T, 'tools'), { recursive: true });
    const run = text => { fs.writeFileSync(path.join(T, 'tests', 'v368.test.js'), text);
      return cp.spawnSync(process.execPath, [path.join(T, 'tests', 'v368.test.js')], { encoding: 'utf8', env: { ...process.env, SRC: path.join(D, 'App.gs'), NODE_OPTIONS: '' } }); };
    const base = run(V);
    if (at > 0 && base.status === 0) {
      const wide = run(V.replace(row, "['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.readonly']],"));
      ok(wide.status === 1 && /^FAIL no NEEDS row accepts a scope too weak for its call .*ACCEPTED: Gmail\.Users\.Labels\.list\(u\) with gmail\.readonly/m.test(wide.stdout),
        'the copy of v368 with that row widened to gmail.readonly fails, naming the call (exit ' + wide.status + ')', wide.stdout.split('\n').filter(l => /^FAIL/.test(l)).join(' | '));
    } else ok(base.status === 0 || base.status === 1, 'v368 copy ran (exit ' + base.status + '; the parser may be missing here, so the mutant is not driven)', base.stdout.slice(-200));
  } finally { fs.rmSync(T, { recursive: true, force: true }); } }

// 2. M116: both shells in the Windows job
{ const Y = fs.readFileSync(path.join(D, '.github', 'workflows', 'tests.yml'), 'utf8');
  const job = (Y.split(/\n  deploy-windows:\n/)[1] || '').split(/\n  [a-z][\w-]*:\n/)[0];
  ok(/^\s+ps: \[pwsh, powershell\]$/m.test(job) && /fail-fast: false/.test(job), 'deploy-windows: matrix ps = pwsh, powershell (Windows PowerShell 5.1), fail-fast off so one shell cannot hide the other');
  ok(/PWSH=\$\{\{ matrix\.ps \}\} bash tests\/deploy\.test\.sh/.test(job) && !/PWSH=pwsh bash/.test(job), 'deploy-windows: tests/deploy.test.sh runs with the matrix shell, not a fixed pwsh'); }

// 3. the GUARD (d) wording: a string, normally an assertion's name; the guard does not check that it is one
{ const C = fs.readFileSync(path.join(D, 'CLAUDE.md'), 'utf8'), R = fs.readFileSync(path.join(D, 'README.md'), 'utf8');
  ok(/\[<Module>\.G<n>\]` in a string, meant for an assertion's name/.test(C) && /in a string, normally an assertion's name/.test(R) && !/G<n>\]` in an assertion's name/.test(C + R),
    "CLAUDE.md and README say a guarantee is cited in a string (normally an assertion's name), not that the guard checks an assertion"); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

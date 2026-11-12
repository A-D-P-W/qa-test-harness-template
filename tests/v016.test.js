// v0.1.6 (synced from MailToDrive 3.12.8, its workflow and JS-tooling reviews of 2026-11-12):
//   M106 runall refuses MTD_CLOCK_AHEAD_DAYS without the clock shim (a leftover export switched the reruns off and passed);
//   M108 tools/guards.js and tests/v368.test.js require the pinned acorn (a shared tool cache can hold another project's);
//   M105 a CHANGELOG version listed twice is a runall GUARD (tools/guard_selftest.sh plants it).
// Run: node tests/v016.test.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const D = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  -- ' + String(x).slice(0, 200))); };
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'v016-'));
process.on('exit', () => fs.rmSync(W, { recursive: true, force: true }));

// M106: refused before anything is deleted or run
{ const r = cp.spawnSync('bash', [path.join(D, 'runall.sh')], { encoding: 'utf8', timeout: 30000, env: Object.assign({}, process.env, { MTD_CLOCK_AHEAD_DAYS: '90', NODE_OPTIONS: '', MTD_OUT: '' }) });
  ok(r.status === 2 && /MTD_CLOCK_AHEAD_DAYS is set only by runall's own clock-ahead reruns/.test(r.stdout), 'M106 runall refuses MTD_CLOCK_AHEAD_DAYS without the clock shim', (r.stdout || '') + ' rc=' + r.status); }

// M108: a decoy acorn (the real parser under another version number) is refused by both checks
{ const real = (() => { for (const c of [process.env.MTD_ACORN, path.join(process.env.MTD_TC_CACHE || path.join(os.homedir(), '.cache', 'mtd-tc'), 'node_modules', 'acorn')]) { try { if (c) return require.resolve(c); } catch (e) { /* next */ } } return null; })();
  if (!real) ok(false, 'M108 acorn is installed for the decoy check (tests/typecheck/run.sh installs it)');
  else { const fake = path.join(W, 'fake-acorn'); fs.mkdirSync(fake);
    fs.writeFileSync(path.join(fake, 'index.js'), 'module.exports = Object.assign({}, require(' + JSON.stringify(real) + '), { version: "0.0.0-decoy" });\n');
    const env = Object.assign({}, process.env, { MTD_ACORN: fake });
    const g = cp.spawnSync(process.execPath, [path.join(D, 'tools', 'guards.js')], { encoding: 'utf8', env });
    const v = cp.spawnSync(process.execPath, [path.join(D, 'tests', 'v368.test.js')], { encoding: 'utf8', env });
    ok(g.status === 1 && /^GUARD tools\/guards\.js loaded acorn 0\.0\.0-decoy, but tests\/typecheck\/package\.json pins /m.test(g.stdout), 'M108 tools/guards.js refuses a parser that is not the pinned acorn', g.stdout);
    ok(v.status === 1 && /^FAIL the parser is the pinned acorn .* \(loaded 0\.0\.0-decoy/m.test(v.stdout), 'M108 v368 fails on a parser that is not the pinned acorn', v.stdout.split('\n').filter(l => /acorn/.test(l)).join(' | '));
    const pin = JSON.parse(fs.readFileSync(path.join(D, 'tests', 'typecheck', 'package.json'), 'utf8')).devDependencies.acorn;
    console.log('INFO M108 pinned acorn ' + pin + '; the decoy reported 0.0.0-decoy'); } }

// M105: wiring (tools/guard_selftest.sh drives the GUARD on a planted duplicate)
{ const R = fs.readFileSync(path.join(D, 'runall.sh'), 'utf8');
  ok(/every version once, newest first \(a reused version number\)/.test(R) && /if not _a > _z/.test(R), 'M105 runall GUARDs a CHANGELOG version listed twice or out of order');
  ok(/expect planted 'GUARD src\/App\.main\.gs CHANGELOG lists 0\.1\.0 after 0\.1\.0/.test(fs.readFileSync(path.join(D, 'tools', 'guard_selftest.sh'), 'utf8')), 'M105 tools/guard_selftest.sh plants a duplicated CHANGELOG version'); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

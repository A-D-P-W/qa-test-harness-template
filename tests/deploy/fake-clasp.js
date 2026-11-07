#!/usr/bin/env node
// Fake clasp 3.4.1 for deploy.ps1 tests, modelled on the real build/src (review 2026-10-20):
//  - status needs no login, computes files from the folder, prints "Tracked files:" text or, with --json,
//    {"filesToPush":[localPath...],"untrackedFiles":[...]} (show-file-status.js:31-48)
//  - push without --force in a non-interactive shell prints "Skipping push." and exits 0 (push.js:34-42,112)
//  - pull writes <name>.js for scripts (first scriptExtension) and keeps subfolders (files.js:239)
//  - the project is the scriptId in ./.clasp.json; each project is a folder under FAKE_LIVE_ROOT
// Env: FAKE_LOG, FAKE_LIVE_ROOT, FAKE_VERSION, FAKE_LOGOUT (fail), FAKE_STATUS (ok|extra|text|fail), FAKE_PUSH (ok|fail|noop|badmanifest),
//      FAKE_PULL (ok|fail-after-push), FAKE_STDERR=1
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), cmd = args[0];
fs.appendFileSync(process.env.FAKE_LOG, args.join(' ') + '\n');
if (process.env.FAKE_STDERR) process.stderr.write('(noise on stderr)\n');
// --version: commander prints the package version on stdout (FAKE_VERSION overrides); logout needs no project:
// it deletes the stored credential and prints "Deleted credentials." (logout.ts), or nothing when none is stored.
if (cmd === '--version') { console.log(process.env.FAKE_VERSION || '3.4.1'); process.exit(0); }
if (cmd === 'logout') { if (process.env.FAKE_LOGOUT === 'fail') { console.error('Error: bad .clasprc.json'); process.exit(1); } console.log('Deleted credentials.'); process.exit(0); }   // real clasp exits 1 on a corrupt store (review L1)
const cfg = fs.existsSync('.clasp.json') ? JSON.parse(fs.readFileSync('.clasp.json', 'utf8')) : null;
if (!cfg) { console.error('Project settings not found.'); process.exit(1); }
const root = process.env.FAKE_LIVE_ROOT, live = path.join(root, cfg.scriptId); fs.mkdirSync(live, { recursive: true });
const local = () => fs.readdirSync('.').filter(f => /\.(gs|js|json|html)$/.test(f) && f !== '.clasp.json');
const walk = (d, b = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name), path.join(b, e.name)) : [path.join(b, e.name)]);
const clear = d => { for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { recursive: true, force: true }); };
if (cmd === 'status') {
  const s = process.env.FAKE_STATUS || 'ok'; let files = local();
  if (s === 'fail') { console.error('Error: something broke'); process.exit(1); }
  if (s === 'extra') files = files.concat(['old/MailToDrive.gs']);
  if (s === 'swap') files = ['appsscript.json', 'Code.gs'];
  if (args.includes('--json') && s !== 'text') console.log(JSON.stringify({ filesToPush: files, untrackedFiles: ['.clasp.json'] }));
  else console.log('Tracked files:\n' + files.map(f => '└─ ' + f).join('\n') + '\nUntracked files:\n└─ .clasp.json');
  process.exit(0);
}
if (cmd === 'push') {
  if (!args.includes('--force')) { console.log('Skipping push.'); process.exit(0); }
  const p = process.env.FAKE_PUSH || 'ok';
  if (p === 'fail') { console.error('Error: push failed'); process.exit(1); }
  if (p !== 'noop') {
    clear(live);
    for (const f of local()) {
      let c = fs.readFileSync(f, 'utf8');
      if (f === 'appsscript.json') { c = c.replace(/\n/g, '\r\n'); if (p === 'badmanifest') c = c.replace('V8', 'DEPRECATED_ES5'); }
      fs.writeFileSync(path.join(live, f.replace(/\.gs$/, '.js')), c);
    }
  }
  fs.writeFileSync(path.join(root, '.pushed'), '1');
  console.log('Pushed files.'); process.exit(0);
}
if (cmd === 'pull') {
  if (process.env.FAKE_PULL === 'fail-after-push' && fs.existsSync(path.join(root, '.pushed'))) { console.error('Error: network'); process.exit(1); }
  for (const f of walk(live)) { fs.mkdirSync(path.dirname(path.join('.', f)), { recursive: true }); fs.copyFileSync(path.join(live, f), path.join('.', f)); }
  console.log('Pulled.'); process.exit(0);
}
console.error('fake clasp: unknown ' + cmd); process.exit(2);

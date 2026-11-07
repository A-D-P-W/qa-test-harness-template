// Project registry (3.9.2, Phase 2 design §10): every Apps Script project that consumes modules has one list file
// deploy/<name>.files with two directive comments and its bundle inputs:
//   # @project <ProjectName>     the consumer name used in CONTRACT.md "Consumers" and tests/contract/<Module>.<name>.test.js
//   # @out <path>                the committed bundle this list builds (e.g. MailToDrive.gs, calendar/CalendarProposer.gs)
//   modules/<Name>/<Name>.gs ... the modules the project uses plus their Depends-on modules, in registry order
//   <dir>/src/<File>.gs          the project's own file(s), last
// deploy/modules.order is the registry order of every landed module (one source of truth for bundles and contract tests).
'use strict';
const fs = require('fs'), path = require('path');
const lines = f => fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim());
function moduleOrder(root) {
  const f = path.join(root, 'deploy', 'modules.order');
  return fs.existsSync(f) ? lines(f).filter(l => l && !l.startsWith('#')) : [];
}
function projects(root) {
  const dir = path.join(root, 'deploy');
  const res = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => f.endsWith('.files')).sort().map(f => {
    const all = lines(path.join(dir, f)), list = 'deploy/' + f;
    for (const l of all) if (/^#\s*@/.test(l) && !/^#\s*@(project|out)\s+\S+\s*$/.test(l)) throw new Error(list + ': directive line is not "# @project <Name>" or "# @out <path>": ' + l.slice(0, 60));   // review 3.9.2 L2
    const dir1 = k => { const x = all.map(l => new RegExp('^#\\s*@' + k + '\\s+(\\S+)\\s*$').exec(l)).filter(Boolean); if (x.length !== 1) throw new Error(list + ': needs exactly one "# @' + k + ' <value>" line'); return x[0][1]; };
    const name = dir1('project'), out = dir1('out');
    if (!/^[A-Z][A-Za-z]+$/.test(name)) throw new Error(list + ': @project ' + name + ' is not a plain CamelCase name');
    if (!/^([a-z]+\/)?[A-Za-z]+\.gs$/.test(out)) throw new Error(list + ': @out ' + out + ' must be <File>.gs or <dir>/<File>.gs');
    const files = all.filter(l => l && !l.startsWith('#'));
    const modules = files.filter(l => l.startsWith('modules/')).map(l => l.split('/')[1]);
    const own = files.filter(l => !l.startsWith('modules/'));
    const odir = out.includes('/') ? out.split('/')[0] + '/' : '';                  // review 3.9.2 L1: own files live in <out dir>/src/
    for (const f of own) if (!f.startsWith(odir + 'src/') || f.slice(odir.length + 4).includes('/')) throw new Error(list + ': ' + f + ' must be under ' + odir + 'src/ (the folder of @out ' + out + ')');
    if (!own.length) throw new Error(list + ': lists no project file');
    return { name, lname: name.toLowerCase(), list, out, files, modules, own };   // lname: contract-test file names are lowercased
  });
  // review 3.9.2 H1: names and bundles are unique (a duplicate @project replaced MailToDrive's files in guards.js); at most
  // one project builds at the repo root (MailToDrive); every other project has its own folder (its tests, manifest, deploy pin).
  const dup = (k) => { const seen = new Map(); for (const p of res) { if (seen.has(p[k])) throw new Error(p.list + ': @' + (k === 'lname' ? 'project ' + p.name : 'out ' + p.out) + ' is also used by ' + seen.get(p[k])); seen.set(p[k], p.list); } };
  dup('lname'); dup('out');
  if (res.filter(p => !p.out.includes('/')).length > 1) throw new Error('deploy/*.files: only one project may build at the repo root; give the others @out <dir>/<File>.gs');
  return res;
}
module.exports = { projects, moduleOrder };

// Reachable code of a bundle (3.9.2, Phase 2 §10): the top-level declarations a project's own files can reach through
// calls/references, plus all top-level statements of its own files. A module function the project never reaches (e.g.
// RunControl.sheetUsable_ in a project without Drive) is left out, so tests/v368.test.js checks the scopes the project's
// code can actually need. Roots: every top-level item of a non-module file (any of them may be run from the editor or
// a trigger). Usage: reachable(bundleText, acorn, files) → source text (declarations joined by blank lines).
// Fails toward the WHOLE bundle (stricter, review 3.9.2 M1) when it cannot be sure:
//   - `files` (the project list's file order) missing, or the bundle's file banners differ from it (a banner-looking
//     line inside a comment or template would otherwise reclassify own code as module code);
//   - own code uses globalThis, eval, Function, or a computed member on `this`/globalThis (dynamic name lookup).
// A string literal equal to a top-level name counts as a reference (ScriptApp.newTrigger('name'), dispatch tables).
// 3.9.3: `exempt` (names) = own top-level functions that are deliberately NOT roots — scope probes that call an API the
// manifest leaves out on purpose (calendar/v368-exempt.json). An exempt name that is not an own top-level function, or
// that other reachable code refers to, throws: the exemption must never hide a real call path.
'use strict';
const { freeIds } = require('./ast');
function reachable(text, acorn, files, exempt) {
  exempt = exempt || [];
  if (!Array.isArray(files) || !files.length) return text;
  const prog = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  // banners must be exactly the generated ones: top-level, between statements, in list order
  const banners = [...text.matchAll(/^\/\/ ===== file: (\S+) =====$/gm)].map(m => ({ at: m.index, file: m[1] }));
  if (banners.map(b => b.file).join('\n') !== files.join('\n')) return text;
  if (banners.some(b => prog.body.some(st => st.start < b.at && b.at < st.end))) return text;
  const fileAt = pos => { let f = ''; for (const b of banners) if (b.at <= pos) f = b.file; return f; };
  const strings = n => { const out = []; (function scan(x) { if (!x || typeof x.type !== 'string') return;
    if (x.type === 'Literal' && typeof x.value === 'string') out.push(x.value);
    if (x.type === 'TemplateLiteral') x.quasis.forEach(q => out.push(q.value.cooked));
    for (const k of Object.keys(x)) { if (k === 'loc') continue; const v = x[k]; if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v.type === 'string') scan(v); } })(n); return out; };
  const dynamic = n => { let d = false; (function scan(x) { if (d || !x || typeof x.type !== 'string') return;
    if (x.type === 'MemberExpression' && x.computed && (x.object.type === 'ThisExpression' || (x.object.type === 'Identifier' && x.object.name === 'globalThis'))) d = true;
    for (const k of Object.keys(x)) { if (k === 'loc') continue; const v = x[k]; if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v.type === 'string') scan(v); } })(n); return d; };
  const items = prog.body.map(st => {
    const names = st.type === 'FunctionDeclaration' ? [st.id.name] : st.type === 'VariableDeclaration' ? st.declarations.filter(d => d.id.type === 'Identifier').map(d => d.id.name) : [];
    return { st, names, own: !fileAt(st.start).startsWith('modules/'), refs: [...freeIds(st).keys()].concat(strings(st)) };
  });
  for (const it of items) if (it.own && (it.refs.some(r => r === 'globalThis' || r === 'eval' || r === 'Function') || dynamic(it.st))) return text;
  const byName = new Map(); items.forEach(it => it.names.forEach(n => byName.set(n, it)));
  for (const n of exempt) { const it = byName.get(n);
    if (!it || !it.own || it.st.type !== 'FunctionDeclaration') throw new Error('exempt name is not an own top-level function: ' + n); }
  const seen = new Set(), queue = items.filter(it => it.own && !it.names.some(n => exempt.includes(n)));
  while (queue.length) { const it = queue.pop(); if (seen.has(it)) continue; seen.add(it);
    for (const r of it.refs) { const t = byName.get(r); if (t && !seen.has(t)) queue.push(t); } }
  for (const n of exempt) if (seen.has(byName.get(n))) throw new Error('exempt function is reachable from other code: ' + n);
  return items.filter(it => seen.has(it)).map(it => text.slice(it.st.start, it.st.end)).join('\n\n');
}
module.exports = { reachable };

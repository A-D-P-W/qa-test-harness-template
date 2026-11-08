// v3.6.8: manifest-scope guard. The mocks grant every API, so a call needing an OAuth scope the manifest
// (appsscript.json oauthScopes) does not list passes every suite and fails only in production.
// Observed 2026-10-19: Session.getEffectiveUser() needed userinfo.email; metrics silently stopped after run 1.
// Run: SRC=<abs .gs> node tests/v368.test.js
const fs = require('fs'), path = require('path');
const SRC = process.env.SRC || process.env.MTD_GS || path.resolve(__dirname, '..', 'App.gs');
const src = fs.readFileSync(SRC, 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.resolve(path.dirname(SRC), 'appsscript.json'), 'utf8'));
const granted = new Set(manifest.oauthScopes || []);
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };

// 3.9.2: only the code the project's own files can reach (tools/reachable.js) — a shared module's function the project
// never calls does not demand its scope. Without the parser (acorn, installed with the type check) the scope rows check the
// whole file, but the alias, chain and L100 checks cannot run: that is a FAIL under FULL=1 (release), an INFO otherwise.
let reach = src, ACORN = null, EXBODIES = [];
try { const acorn = require(process.env.MTD_ACORN || path.join(process.env.MTD_TC_CACHE || path.join(require('os').homedir(), '.cache', 'mtd-tc'), 'node_modules', 'acorn'));
      // the project whose committed bundle SRC is (any other file, e.g. runall's file-mode copy → whole bundle)
      let root = path.dirname(path.resolve(SRC)); while (!fs.existsSync(path.join(root, 'deploy')) && path.dirname(root) !== root) root = path.dirname(root);   // the repo SRC belongs to
      const rel = path.relative(root, path.resolve(SRC)).split(path.sep).join('/');
      const proj = fs.existsSync(path.join(root, 'deploy')) ? require(path.join(__dirname, '..', 'tools', 'projects.js')).projects(root).find(p => p.out === rel) : null;
      // 3.9.3: deliberate scope probes (<project dir>/v368-exempt.json: { name: reason }) are not roots; printed as INFO
      const exf = proj && path.join(root, path.dirname(rel), 'v368-exempt.json');
      const exempt = exf && fs.existsSync(exf) ? JSON.parse(fs.readFileSync(exf, 'utf8')) : {};
      // review M1: each exemption names the ONE API it may skip ({ name: { api, why } }); the rest of its body is still checked
      const ex = Object.entries(exempt).map(([n, v]) => { if (!v || typeof v !== 'object' || !/^[A-Z][A-Za-z]*$/.test(String(v.api || '')) || !v.why) throw new Error('exempt entry ' + n + ' needs { "api": "<Service>", "why": "…" }'); return [n, v]; });
      for (const [n, v] of ex) console.log('INFO v368 exempt probe ' + n + ' may call ' + v.api + ': ' + v.why);
      reach = require(path.join(__dirname, '..', 'tools', 'reachable.js')).reachable(src, acorn, proj && proj.files, ex.map(([n]) => n));
      const body = n => { const st = acorn.parse(src, { ecmaVersion: 'latest' }).body.find(x => x.type === 'FunctionDeclaration' && x.id.name === n); return src.slice(st.start, st.end); };
      ACORN = acorn; EXBODIES = ex.map(([n, v]) => [n, v, body(n)]);
      for (const [n, v] of ex) reach += '\n\n' + body(n).replace(new RegExp('\\b' + v.api + '\\.', 'g'), 'EXEMPT_' + v.api + '_.'); }
catch (e) { if (/^exempt /.test(e.message)) ok(false, 'v368-exempt.json: ' + e.message);
            else console.log('INFO reachability unavailable (' + String(e.message).split('\n')[0].slice(0, 100) + '): whole bundle checked');   // review L2
            reach = src; }
// Code without comments/strings, so a mention in the CHANGELOG or a log message is not a call.
// 3.9.0 (L33): strings are stripped LINE BY LINE. A file-wide quote match is thrown off by quotes inside regex
// literals (/['"]/), so code after them was swallowed — moving HtmlText to the top of the bundle hid every GmailApp call.
const code = reach.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')
                .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\\n])*`/g, "''")).join('\n')
                // 3.9.9 workflow review H1: `DriveApp?.x` and `DriveApp .x` are calls too — normalise them before the rows run
                .replace(/\?\.(?!\d)/g, '.').replace(/\s+\.(?=[A-Za-z_$])/g, '.');

// API surface → scope(s) it needs (any one suffices). Source: Apps Script reference, "Authorization" per method.
const NEEDS = [
  [/\bSession\.getEffectiveUser\s*\(/, ['https://www.googleapis.com/auth/userinfo.email']],
  [/\bSession\.getActiveUser\s*\(/,    ['https://www.googleapis.com/auth/userinfo.email']],
  [/\bUrlFetchApp\./,                  ['https://www.googleapis.com/auth/script.external_request']],
  [/\bMailApp\./,                      ['https://www.googleapis.com/auth/script.send_mail', 'https://mail.google.com/']],
  [/\bCalendarApp\./,                  ['https://www.googleapis.com/auth/calendar']],
  [/\bDocumentApp\./,                  ['https://www.googleapis.com/auth/documents']],
  // 3.9.7: GmailApp.search runs under gmail.readonly — live probe in the owner's account 2026-10-22 (CalendarProposer 0.1.0/0.1.1:
  // "PROBE GmailApp.search: ALLOWED", and the GmailMessage reads getId/getHeader/getRawContent/getPlainBody/getAttachments
  // ALLOWED) although the reference summary says every method needs https://mail.google.com/. Every other GmailApp call keeps
  // the full scope until a live check says otherwise.
  [/\bGmailApp\.search\s*\(/,             ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.readonly']],
  [/\bGmailApp\.(?!search\s*\()/,          ['https://mail.google.com/']],
  [/\bGmailApp\.sendEmail\s*\(/,       ['https://mail.google.com/']],                 // 3.8.0 digest + alerts (live check: digest() once)
  // 3.9.2: Users.messages.get/list "Requires one of the following OAuth scopes: https://mail.google.com/ … gmail.modify …
  // gmail.readonly … gmail.metadata" (developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get); other
  // Users calls (labels, modify) need the full or modify scope. CalendarProposer reads with gmail.readonly (ADR-0013).
  [/\bGmail\.Users\.Messages\.(get|list)\s*\(/, ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.readonly']],
  [/\bGmail\.Users\.(?!Messages\.(get|list)\s*\()/, ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.modify']],
  // Calendar advanced service (events.insert/get/list/patch/delete accept these; app.created covers only calendars the app made)
  [/\bCalendar\.Events\./,           ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.events.owned']],
  [/\bCalendar\.Calendars\.insert\s*\(/, ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.app.created']],
  // 3.9.3: calendars.get "requires authorization with at least one of the following scopes: …calendar.readonly …calendar
  // …calendar.app.created …calendar.calendars …calendar.calendars.readonly" (developers.google.com/workspace/calendar/api/v3/reference/calendars/get)
  [/\bCalendar\.Calendars\.get\s*\(/,    ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.calendars', 'https://www.googleapis.com/auth/calendar.calendars.readonly']],
  [/\bCalendar\.Acl\./,              ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.acls', 'https://www.googleapis.com/auth/calendar.app.created']],
  // review 3.9.2 M4: every other Calendar advanced-service call (CalendarList, Calendars.list/patch, …) needs a full or
  // read-only calendar scope until a row with a quoted source says otherwise.
  [/\bCalendar\.(?!Events\.|Calendars\.insert\s*\(|Calendars\.get\s*\(|Acl\.)/, ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.readonly']],
  [/\bDriveApp\.|\bDrive\./,          ['https://www.googleapis.com/auth/drive']],   // 3.9.9: every Drive advanced resource (Files, Permissions, …)
  [/\bSpreadsheetApp\./,               ['https://www.googleapis.com/auth/spreadsheets']],
  [/\bScriptApp\.newTrigger|\bScriptApp\.getProjectTriggers|\bScriptApp\.deleteTrigger/, ['https://www.googleapis.com/auth/script.scriptapp']],
];
for (const [re, scopes] of NEEDS) {
  if (!re.test(code)) continue;
  ok(scopes.some(s => granted.has(s)), `${re.source} is called and the manifest grants ${scopes.join(' or ')}`);
}
ok(!/\bSession\.(getEffectiveUser|getActiveUser)\s*\(/.test(code), 'no Session user lookup in code (single-account: use MY_ADDRESS)');
// 3.9.7 workflow review H1: the regex rows see only `Service.` text, so an alias (`const { Events } = Calendar`, `const A = DriveApp`)
// would hide a call. Every service name in reachable code must be the object of a plain member access (or a typeof operand).
if (!ACORN && process.env.FULL) ok(false, 'parser (acorn) unavailable: the alias, chain and L100 checks did not run (FULL=1 needs them)');
if (ACORN) {
  const SERVICES = new Set(['GmailApp', 'Gmail', 'Calendar', 'CalendarApp', 'DriveApp', 'Drive', 'MailApp', 'UrlFetchApp', 'ScriptApp',
    'SpreadsheetApp', 'Sheets', 'DocumentApp', 'Session', 'PropertiesService', 'LockService', 'CacheService', 'People', 'Tasks']);
  const aliases = [];
  (function walk(n, parent, key) { if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier' && SERVICES.has(n.name) &&
        !(parent && parent.type === 'MemberExpression' && key === 'object' && !parent.computed) &&
        !(parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed) &&
        !(parent && parent.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand) &&
        !(parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof')) aliases.push(n.name + '@' + n.start);
    for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(x => walk(x, n, k)); else if (v && typeof v.type === 'string') walk(v, n, k); } })(ACORN.parse(reach, { ecmaVersion: 'latest' }), null, null);
  // 3.9.9 workflow review H1: every service member chain in reachable code must be matched by a NEEDS row or be known to
  // need no scope — a service with no row (Sheets, Tasks, People, …) would otherwise pass unseen.
  const NOSCOPE = /^(PropertiesService|LockService|CacheService)\.|^ScriptApp\.(WeekDay|EventType|AuthMode)\b|^DriveApp\.(Access|Permission)\b|^Session\.getScriptTimeZone\b/;
  const chains = new Set();
  (function walk(n) { if (!n || typeof n.type !== 'string') return;
    if (n.type === 'MemberExpression' && !n.computed) { const parts = []; let m = n; while (m.type === 'MemberExpression' && !m.computed) { parts.unshift(m.property.name); m = m.object; }
      if (m.type === 'Identifier' && SERVICES.has(m.name)) chains.add([m.name, ...parts].join('.')); }
    for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); } })(ACORN.parse(reach, { ecmaVersion: 'latest' }));
  const unrowed = [...chains].filter(c => !NOSCOPE.test(c) && !NEEDS.some(([re]) => re.test(c + '(')) && ![...chains].some(d => d !== c && d.startsWith(c + '.')));
  ok(!unrowed.length, 'every service call in reachable code has a NEEDS row or is known to need no scope (' + chains.size + ' chains)' + (unrowed.length ? ': ' + unrowed.join(', ') : ''));
  ok(!aliases.length, 'no service object is aliased, destructured or passed around in reachable code (the scope rows would not see its calls)' + (aliases.length ? ': ' + aliases.slice(0, 5).join(', ') : ''));
  // L100 (security reviews 2026-11-08, driven): a service reached WITHOUT its name in the code is invisible to the rows
  // and to the alias check above. Each form below passed this suite with "oauthScopes": [] until this rule. The rule:
  //   A1 any reference to globalThis/self/window/global the file does not declare itself
  //   A2 any Reflect          A3 eval, and Function except as the right side of instanceof or an operand of === / !==
  //   A4 this.<Service> anywhere; outside a class body, `this` only as `this.<name>` (not this[...], not bare this)
  //   A5 .constructor used as a value (allowed: .constructor.name, and === / !== comparisons)
  //   A6 Object.getPrototypeOf / setPrototypeOf / getOwnPropertyDescriptor(s) / getOwnPropertyNames, and __proto__
  // This is a lint against code that reaches a service the manifest does not grant, not a sandbox: the manifest is the
  // run-time boundary. Round 3 (2026-11-08, driven) added constant folding of "constructor" keys (+ and templates),
  // destructured {constructor} keys and A6 (Object.getPrototypeOf / getOwnPropertyDescriptor(s) / getOwnPropertyNames /
  // setPrototypeOf, __proto__). Known residual: a constructor key computed by a call at run time (for example
  // ["constr", "uctor"].join("") or a reversed string); no static rule can see it. Known false
  // positives: ES5 `this` in prototype functions and object-literal methods (write them as class methods).
  const GLOBALS = new Set(['globalThis', 'self', 'window', 'global']);
  const REFLECTIVE = new Set(['getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getOwnPropertyNames']);
  // constant string value of a node: a string literal, a template without expressions, or + of those; else null
  const fold = x => { if (!x) return null; if (x.type === 'Literal' && typeof x.value === 'string') return x.value;
    if (x.type === 'TemplateLiteral') { let v = x.quasis[0].value.cooked; for (let i = 0; i < x.expressions.length; i++) { const e = fold(x.expressions[i]); if (e === null) return null; v += e + x.quasis[i + 1].value.cooked; } return v; }
    if (x.type === 'BinaryExpression' && x.operator === '+') { const a = fold(x.left), b = fold(x.right); return a === null || b === null ? null : a + b; } return null; };
  function dynamicAccess(src) {
    const ast = ACORN.parse(src, { ecmaVersion: 'latest' }), out = [], declared = new Set();
    const pat = p => { if (!p) return; if (p.type === 'Identifier') declared.add(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach(q => pat(q.value || q.argument));
      else if (p.type === 'ArrayPattern') p.elements.forEach(pat); else if (p.type === 'AssignmentPattern') pat(p.left); else if (p.type === 'RestElement') pat(p.argument); };
    (function d(n) { if (!n || typeof n.type !== 'string') return;
      if (n.type === 'VariableDeclarator') pat(n.id);
      if (/Function/.test(n.type)) { if (n.id) declared.add(n.id.name); n.params.forEach(pat); }
      if (n.type === 'ClassDeclaration' && n.id) declared.add(n.id.name);
      if (n.type === 'CatchClause') pat(n.param);
      for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(d); else if (v && typeof v.type === 'string') d(v); } })(ast);
    (function w(n, parent, key, inClass) { if (!n || typeof n.type !== 'string') return;
      // class code is strict: a detached class method's `this` is undefined, never the global object
      if (n.type === 'ClassBody') inClass = true;
      else if (/Function/.test(n.type) && n.type !== 'ArrowFunctionExpression' && !(parent && parent.type === 'MethodDefinition')) inClass = false;
      const memObj = parent && parent.type === 'MemberExpression' && key === 'object';
      const plainProp = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
        (parent.type === 'Property' && key === 'key' && !parent.computed) || (parent.type === 'MethodDefinition' && key === 'key' && !parent.computed));
      if (n.type === 'Identifier' && !plainProp) {
        if (GLOBALS.has(n.name) && !declared.has(n.name)) out.push('A1 ' + n.name + '@' + n.start);
        if (n.name === 'Reflect' && !declared.has('Reflect')) out.push('A2 Reflect@' + n.start);
        if (n.name === 'eval') out.push('A3 eval@' + n.start);
        if (n.name === 'Function' && !(parent && parent.type === 'BinaryExpression' &&
            (parent.operator === 'instanceof' ? key === 'right' : /^[!=]==?$/.test(parent.operator)))) out.push('A3 Function@' + n.start);
      }
      if (n.type === 'ThisExpression') {
        if (memObj && !parent.computed && SERVICES.has(parent.property.name)) out.push('A4 this.' + parent.property.name + '@' + n.start);
        else if (!inClass && (!memObj || parent.computed)) out.push('A4 ' + (memObj ? 'this[...]' : 'this') + '@' + n.start);
      }
      // A5 also: any constant string "constructor" (folded across + and templates) used as a key, argument or value;
      // a destructured constructor key; A6 the reflective Object calls that reach a prototype or a non-enumerable key.
      const memKey = parent && parent.type === 'MemberExpression' && key === 'property' && parent.computed;
      if (!memKey && fold(n) === 'constructor' && !(parent && parent.type === 'BinaryExpression' && parent.operator === '+')) out.push('A5 "constructor"@' + n.start);
      if (n.type === 'Property' && parent && parent.type === 'ObjectPattern' && (n.computed ? fold(n.key) : (n.key.name || n.key.value)) === 'constructor') out.push('A5 {constructor}@' + n.start);
      if (n.type === 'MemberExpression' && !n.computed && ((n.object.type === 'Identifier' && n.object.name === 'Object' && REFLECTIVE.has(n.property.name)) || n.property.name === '__proto__')) out.push('A6 ' + n.property.name + '@' + n.start);
      if (n.type === 'MemberExpression') {
        const name = n.computed ? fold(n.property) : n.property.name;
        if (name === 'constructor' && !((parent && parent.type === 'MemberExpression' && key === 'object' && !parent.computed && parent.property.name === 'name') ||
            (parent && parent.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)))) out.push('A5 .constructor@' + n.start);
      }
      for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(x => w(x, n, k, inClass)); else if (v && typeof v.type === 'string') w(v, n, k, inClass); }
    })(ast, null, null, false);
    return out;
  }
  const dynamic = dynamicAccess(reach);
  ok(!dynamic.length, 'no service reached without its name in reachable code (global object, Reflect, eval/Function, this[...], .constructor; L100)' + (dynamic.length ? ': ' + dynamic.slice(0, 5).join(', ') : ''));
  // The rule is driven on every run: each bypass found in review must still be flagged, each legitimate form must not be.
  const BYPASS = [
    'function run(){ globalThis["Drive"+"App"].getRootFolder(); }', 'function run(){ var k="Drive"+"App"; this[k].getRootFolder(); }',
    'function run(){ (0,eval)("Drive"+"App").getRootFolder(); }', 'function run(){ new Function("return Drive"+"App")().getRootFolder(); }',
    'function run(){ Reflect.get(globalThis,"Drive"+"App").getRootFolder(); }', 'function run(){ Object.values(globalThis).find(v => v && v.getRootFolder).getRootFolder(); }',
    'function run(){ const g=globalThis; g["Drive"+"App"].getRootFolder(); }', 'const g=this; function run(){ g["Drive"+"App"].getRootFolder(); }',
    'function run(){ (function(){return this})()["Drive"+"App"].getRootFolder(); }', 'function run(){ (()=>{}).constructor("return Drive"+"App")().getRootFolder(); }',
    'function run(){ [].map.constructor("return Drive"+"App")().getRootFolder(); }', 'function run(){ [].map["constructor"]("return Drive"+"App")().getRootFolder(); }',
    'function run(){ const F=(()=>{}).constructor; return F("return Drive"+"App")(); }', 'function run(){ const { DriveApp: D } = globalThis; return D.getRootFolder(); }',
    'function run(){ return globalThis.DriveApp.getRootFolder(); }', 'function run(){ return this.DriveApp.getRootFolder(); }',
    'function Grab(){ return this["Drive"+"App"]; }', 'class G { get(k) { return Reflect.get(this.__proto__.constructor("return this")(), k); } }',
    'class H { get(k) { return Reflect.ownKeys(k); } }', 'const o = { m() { return this["Drive"+"App"]; } }; function run(){ return (0, o.m)(); }',
    'function run(){ const {constructor:C}=()=>{}; return C("return Drive"+"App")(); }', 'function run(){ const {constructor:C}=async()=>{}; return C("return Drive"+"App")(); }',
    'function run(){ const {constructor:C}=[].map; return C("return Drive"+"App")(); }', 'function run(){ return [].map["constr"+"uctor"]("return Drive"+"App")(); }',
    'function run(){ return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(()=>{}), "constructor").value("return Drive"+"App")(); }',
    'function run(){ const {["constr"+"uctor"]:C}=()=>{}; return C("return Drive"+"App")(); }', 'function run(){ const k=`constr${"uctor"}`; return [].map[k]("return Drive"+"App")(); }',
    'function run(){ return (function*(){}).constructor("return Drive"+"App")().next(); }', 
    'function run(){ const p=Object.getPrototypeOf(()=>{}); const n=Object.getOwnPropertyNames(p).find(x=>x.length===11); return p[n]("return Drive"+"App")(); }', 'function run(){ return Object.getOwnPropertyDescriptors(Object.getPrototypeOf(()=>{})).constructor.value("return Drive"+"App")(); }',
  ];
  const LEGIT = [
    'function run(){ var o={eval:1}; return o.eval; }', 'class Box { set(k, v) { this[k] = v; } }', 'function run(){ const self={a:1}; return self["a"]; }',
    'function run(x){ return x instanceof Function; }', 'function run(){ const o={a:1}; return Object.keys(o).length; }', 'class A {} function run(){ return new A().constructor.name; }',
    'var Mod = (function(){ function priv(){ return 1; } return { pub: priv }; })();', 'function run(x){ return typeof x === "function" && x.constructor === Function; }',
    'function run(o){ const { a, b: [c], ...rest } = o; return a + c + Object.keys(rest).length; }', 'function run(a, i){ return a[i + 1] + a["k" + i] + a[`k${i}`]; }',
    'class P { constructor(x) { this.x = x; } }', 'function run(e){ Logger.log("constructor failed: " + e); return "Constructor"; }',
    'function run(o){ return Object.assign({}, o, Object.fromEntries(Object.entries(o))); }', 'function run(x){ return x && x["constructor"] === Object; }',
  ];
  const missed = BYPASS.filter(s => !dynamicAccess(s).length), flagged = LEGIT.filter(s => dynamicAccess(s).length);
  ok(!missed.length && !flagged.length, 'the L100 rule flags all ' + BYPASS.length + ' known bypass forms and none of ' + LEGIT.length + ' legitimate forms' +
    (missed.length ? '; MISSED: ' + missed[0] : '') + (flagged.length ? '; FLAGGED: ' + flagged[0] : ''));
  // workflow review M1: an exemption whose unmasked body needs no scope the manifest lacks is obsolete (and would mask later calls)
  for (const [n, v, b] of EXBODIES) {
    const bc = b.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\\n])*`/g, "''")).join('\n');
    ok(NEEDS.some(([re, scopes]) => re.test(bc) && !scopes.some(x => granted.has(x))), 'v368-exempt.json: ' + n + ' still needs its exemption (an obsolete exemption masks later calls)');
  }
}

// Behaviour (projects that call sheetUsable_ with SHEET_OPTS — MailToDrive): it must work when Session would throw.
if (/\bsheetUsable_\(/.test(code) && !/\bSHEET_OPTS\b/.test(code)) ok(false, 'sheetUsable_ is reachable but no SHEET_OPTS was found: the Session-unauthorised behavior checks cannot run (review 3.9.2 M3)');
if (/\bsheetUsable_\(/.test(code) && /\bSHEET_OPTS\b/.test(code)) {
// Behaviour: sheetUsable_ must work when Session would throw for lack of scope.
const vm = require('vm');
const ctx = {
  Session: { getEffectiveUser: () => { throw new Error('Specified permissions are not sufficient to call Session.getEffectiveUser.'); },
             getActiveUser:    () => { throw new Error('Specified permissions are not sufficient'); } },
  DriveApp: { Access: { PRIVATE: 'PRIVATE' }, getFileById: () => ({
    isTrashed: () => false, getMimeType: () => 'application/vnd.google-apps.spreadsheet',
    getOwner: () => ({ getEmail: () => 'owner@example.com' }), getSharingAccess: () => 'PRIVATE',
    getEditors: () => [], getViewers: () => [] }) },
  Logger: { log: () => {} }, console,
};
vm.createContext(ctx);
let usable;
try { vm.runInContext(src + '\n;this.__r = sheetUsable_("x", SHEET_OPTS);', ctx); usable = ctx.__r; } catch (e) { usable = 'threw: ' + e.message; }
ok(usable === true, 'sheetUsable_ returns true for a private sheet I own when Session is unauthorised (got ' + usable + ')');

ctx.DriveApp.getFileById = () => ({ isTrashed: () => false, getMimeType: () => 'application/vnd.google-apps.spreadsheet',
  getOwner: () => ({ getEmail: () => 'someone@example.com' }), getSharingAccess: () => 'PRIVATE', getEditors: () => [], getViewers: () => [] });
try { usable = vm.runInContext('sheetUsable_("y", SHEET_OPTS)', ctx); } catch (e) { usable = 'threw'; }
ok(usable === false, 'sheetUsable_ still rejects a sheet owned by another account');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

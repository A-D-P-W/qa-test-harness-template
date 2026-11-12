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
// whole file, but the alias, chain and L100 checks cannot run: that is a FAIL in every mode (L107).
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
// Row self-test (L105): the rows above run only on code that calls a service. The template's App.gs calls none, so a
// broken row (a typo in its regex or its scope) would pass every run. Each sample below is a call its row must match,
// and the scope it names must be one of that row's scopes, so with that scope missing from a manifest the row fails.
const ROW_SAMPLES = [
  ['Session.getEffectiveUser()', 'userinfo.email'], ['Session.getActiveUser()', 'userinfo.email'],
  ['UrlFetchApp.fetch(u)', 'script.external_request'], ['MailApp.sendEmail(m)', 'script.send_mail'],
  ['CalendarApp.getDefaultCalendar()', 'calendar'], ['DocumentApp.create(n)', 'documents'],
  ['GmailApp.search(q)', 'gmail.readonly'], ['GmailApp.getInboxThreads()', 'https://mail.google.com/'],
  ['GmailApp.sendEmail(m)', 'https://mail.google.com/'], ['Gmail.Users.Messages.get(u, id)', 'gmail.readonly'],
  ['Gmail.Users.Labels.list(u)', 'gmail.modify'], ['Calendar.Events.insert(e, id)', 'calendar.events'],
  ['Calendar.Calendars.insert(c)', 'calendar.app.created'], ['Calendar.Calendars.get(id)', 'calendar.readonly'],
  ['Calendar.Acl.list(id)', 'calendar.acls'], ['Calendar.CalendarList.list()', 'calendar.readonly'],
  ['DriveApp.getRootFolder()', 'drive'], ['Drive.Files.list()', 'drive'], ['SpreadsheetApp.openById(id)', 'spreadsheets'],
  ['ScriptApp.newTrigger(f)', 'script.scriptapp'],
];
const full = x => /^https:/.test(x) ? x : 'https://www.googleapis.com/auth/' + x;
const rowMiss = ROW_SAMPLES.filter(([call, scope]) => !NEEDS.some(([re, scopes]) => re.test(call) && scopes.includes(full(scope))));
const rowless = NEEDS.filter(([re]) => !ROW_SAMPLES.some(([call]) => re.test(call)));
ok(!rowMiss.length && !rowless.length, 'every NEEDS row matches its ' + ROW_SAMPLES.length + ' sample calls with the scope it names, and every row has a sample' +
  (rowMiss.length ? '; NO ROW FOR: ' + rowMiss.map(([c, s]) => c + ' -> ' + s).join(', ') : '') + (rowless.length ? '; NO SAMPLE FOR: ' + rowless[0][0].source : ''));
// M115 (seeded from MailToDrive L115; its 3.12.10 review L3): and samples a row must NOT accept — a scope too weak for the call. A row widened with a wrong scope
// (gmail.readonly on a label or send call, a read-only Drive or calendar scope on a write) fails here. A row widened on
// purpose, with a quoted source or a live check, removes its pair in the same change.
const ROW_NOT = [
  ['GmailApp.sendEmail(m)', 'gmail.readonly'], ['GmailApp.getInboxThreads()', 'gmail.readonly'], ['Gmail.Users.Labels.list(u)', 'gmail.readonly'],
  ['MailApp.sendEmail(m)', 'gmail.readonly'], ['UrlFetchApp.fetch(u)', 'script.send_mail'], ['Calendar.Calendars.insert(c)', 'calendar.readonly'],
  ['Calendar.Acl.list(id)', 'calendar.readonly'], ['DriveApp.getRootFolder()', 'drive.readonly'], ['Drive.Files.list()', 'drive.file'],
  ['SpreadsheetApp.openById(id)', 'spreadsheets.readonly'], ['ScriptApp.newTrigger(f)', 'script.external_request'],
];
const rowWide = ROW_NOT.filter(([call, scope]) => NEEDS.some(([re, scopes]) => re.test(call) && scopes.includes(full(scope))));
ok(!rowWide.length, 'no NEEDS row accepts a scope too weak for its call (' + ROW_NOT.length + ' pairs)' + (rowWide.length ? '; ACCEPTED: ' + rowWide.map(([c, sc]) => c + ' with ' + sc).join(', ') : ''));
// 3.9.7 workflow review H1: the regex rows see only `Service.` text, so an alias (`const { Events } = Calendar`, `const A = DriveApp`)
// would hide a call. Every service name in reachable code must be the object of a plain member access (or a typeof operand).
// L107: the AST checks below must report that they ran. A parser that failed to load, or a guard around them that
// skipped them, once left only the two checks above and the suite still passed ("2 passed, 0 failed", even with FULL=1).
const RAN = new Set();
if (ACORN) {
  const SERVICES = new Set(['GmailApp', 'Gmail', 'Calendar', 'CalendarApp', 'DriveApp', 'Drive', 'MailApp', 'UrlFetchApp', 'ScriptApp',
    'SpreadsheetApp', 'Sheets', 'DocumentApp', 'Session', 'PropertiesService', 'LockService', 'CacheService', 'People', 'Tasks']);
  function aliasesIn(text) { const aliases = [];
  (function walk(n, parent, key) { if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier' && SERVICES.has(n.name) &&
        !(parent && parent.type === 'MemberExpression' && key === 'object' && !parent.computed) &&
        !(parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed) &&
        !(parent && parent.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand) &&
        !(parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof')) aliases.push(n.name + '@' + n.start);
    for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(x => walk(x, n, k)); else if (v && typeof v.type === 'string') walk(v, n, k); } })(ACORN.parse(text, { ecmaVersion: 'latest' }), null, null);
  return aliases; }
  // 3.9.9 workflow review H1: every service member chain in reachable code must be matched by a NEEDS row or be known to
  // need no scope — a service with no row (Sheets, Tasks, People, …) would otherwise pass unseen.
  const NOSCOPE = /^(PropertiesService|LockService|CacheService)\.|^ScriptApp\.(WeekDay|EventType|AuthMode)\b|^DriveApp\.(Access|Permission)\b|^Session\.getScriptTimeZone\b/;
  function chainsIn(text) { const chains = new Set();
  (function walk(n) { if (!n || typeof n.type !== 'string') return;
    if (n.type === 'MemberExpression' && !n.computed) { const parts = []; let m = n; while (m.type === 'MemberExpression' && !m.computed) { parts.unshift(m.property.name); m = m.object; }
      if (m.type === 'Identifier' && SERVICES.has(m.name)) chains.add([m.name, ...parts].join('.')); }
    for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); } })(ACORN.parse(text, { ecmaVersion: 'latest' }));
  return chains; }
  const unrowedIn = text => { const chains = chainsIn(text); return [...chains].filter(c => !NOSCOPE.test(c) && !NEEDS.some(([re]) => re.test(c + '(')) && ![...chains].some(d => d !== c && d.startsWith(c + '.'))); };
  const unrowed = unrowedIn(reach), aliases = aliasesIn(reach);
  ok(!unrowed.length, 'every service call in reachable code has a NEEDS row or is known to need no scope (' + chainsIn(reach).size + ' chains)' + (unrowed.length ? ': ' + unrowed.join(', ') : ''));
  ok(!aliases.length, 'no service object is aliased, destructured or passed around in reachable code (the scope rows would not see its calls)' + (aliases.length ? ': ' + aliases.slice(0, 5).join(', ') : ''));
  RAN.add('chain'); RAN.add('alias');
  // L107: each check is driven on every run with forms it must flag and forms it must pass, as the L100 rule is below.
  const ALIAS_BAD = ['const A = DriveApp; A.getRootFolder();', 'const { Events } = Calendar;', 'function f(s){ return s; } f(GmailApp);',
    'const o = { d: DriveApp };', 'const all = [DriveApp];'];
  const ALIAS_GOOD = ['DriveApp.getRootFolder();', 'if (typeof DriveApp === "undefined") {}', 'const o = { DriveApp: 1 }; o.DriveApp;',
    'GmailApp.search("x").length;', 'const m = { DriveApp() { return 1; } };'];
  const CHAIN_BAD = ['Tasks.Tasklists.list();', 'People.People.get("me");', 'Sheets.Spreadsheets.get(id);', 'ScriptApp.getService();'];
  const CHAIN_GOOD = ['PropertiesService.getScriptProperties();', 'ScriptApp.WeekDay.MONDAY;', 'DriveApp.Access.PRIVATE;', 'Session.getScriptTimeZone();',
    'Calendar.Events.insert(e, id);', 'DriveApp.getRootFolder().getName();', 'ScriptApp.newTrigger("f");'];
  const aMiss = ALIAS_BAD.filter(x => !aliasesIn(x).length), aFlag = ALIAS_GOOD.filter(x => aliasesIn(x).length);
  ok(!aMiss.length && !aFlag.length, 'the alias check flags all ' + ALIAS_BAD.length + ' aliasing forms and none of ' + ALIAS_GOOD.length + ' plain uses' +
    (aMiss.length ? '; MISSED: ' + aMiss[0] : '') + (aFlag.length ? '; FLAGGED: ' + aFlag[0] : ''));
  const cMiss = CHAIN_BAD.filter(x => !unrowedIn(x).length), cFlag = CHAIN_GOOD.filter(x => unrowedIn(x).length);
  ok(!cMiss.length && !cFlag.length, 'the chain check flags all ' + CHAIN_BAD.length + ' calls with no NEEDS row and none of ' + CHAIN_GOOD.length + ' rowed or scope-free calls' +
    (cMiss.length ? '; MISSED: ' + cMiss[0] : '') + (cFlag.length ? '; FLAGGED: ' + cFlag[0] : ''));
  RAN.add('alias corpus'); RAN.add('chain corpus');
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
  // Round 4 (driven): A1/A2 no longer exempt a declared name (the exemption was file-wide, so an unrelated
  // `function f(globalThis){}` or `catch (Reflect)` disarmed the rule everywhere); a local named self/global is a known false
  // positive. Constant folding now follows string bindings (const/let/var, `=` and `+=`, file-wide, every value a name
  // may hold), so `const a = "constr"; x[a + "uctor"]` is seen. A6 also flags Object used as a value (alias, destructuring,
  // `with (Object)`) or with a computed key that is, or may be, one of the reflective names; a `__proto__` key anywhere; A7
  // any `with` statement.
  const GLOBALS = new Set(['globalThis', 'self', 'window', 'global']);
  const REFLECTIVE = new Set(['getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getOwnPropertyNames']);
  const DANGER = v => v === 'constructor' || v === '__proto__' || REFLECTIVE.has(v);
  function dynamicAccess(src) {
    const ast = ACORN.parse(src, { ecmaVersion: 'latest' }), out = [], env = new Map();   // name -> Set of string values it may hold
    // every constant string value a node may have (a literal, a template, + of those, a bound name); null if any part is unknown
    const vals = x => { if (!x) return null;
      if (x.type === 'Literal' && typeof x.value === 'string') return [x.value];
      if (x.type === 'Identifier') return env.has(x.name) ? [...env.get(x.name)] : null;
      const cat = (a, b) => { if (!a || !b) return null; const r = []; for (const u of a) for (const v of b) { if (r.length > 64) return null; r.push(u + v); } return r; };
      if (x.type === 'TemplateLiteral') { let v = [x.quasis[0].value.cooked]; for (let i = 0; i < x.expressions.length; i++) { v = cat(cat(v, vals(x.expressions[i])), [x.quasis[i + 1].value.cooked]); if (!v) return null; } return v; }
      if (x.type === 'BinaryExpression' && x.operator === '+') return cat(vals(x.left), vals(x.right));
      if (x.type === 'ConditionalExpression') { const a = vals(x.consequent), b = vals(x.alternate); return a && b ? [...a, ...b] : null; }
      return null; };
    const bind = (name, v) => { if (!v) return; if (!env.has(name)) env.set(name, new Set()); v.forEach(x => env.get(name).add(x)); };
    (function d(n) { if (!n || typeof n.type !== 'string') return;
      for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(d); else if (v && typeof v.type === 'string') d(v); }
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') bind(n.id.name, vals(n.init));
      if (n.type === 'AssignmentPattern' && n.left.type === 'Identifier') bind(n.left.name, vals(n.right));
      if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') {
        if (n.operator === '=') bind(n.left.name, vals(n.right));
      } })(ast);
    // then every `+=` on a bound name (a second pass, so the initial values are known first)
    (function d(n) { if (!n || typeof n.type !== 'string') return;
      for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(d); else if (v && typeof v.type === 'string') d(v); }
      if (n.type === 'AssignmentExpression' && n.operator === '+=' && n.left.type === 'Identifier' && env.has(n.left.name)) { const b = vals(n.right); if (b) bind(n.left.name, [...env.get(n.left.name)].flatMap(u => b.map(v => u + v))); } })(ast);
    const keyOf = (n, prop, computed) => computed ? vals(prop) : [prop.name !== undefined ? prop.name : String(prop.value)];
    (function w(n, parent, key, inClass) { if (!n || typeof n.type !== 'string') return;
      // class code is strict: a detached class method's `this` is undefined, never the global object
      if (n.type === 'ClassBody') inClass = true;
      else if (/Function/.test(n.type) && n.type !== 'ArrowFunctionExpression' && !(parent && parent.type === 'MethodDefinition')) inClass = false;
      const memObj = parent && parent.type === 'MemberExpression' && key === 'object';
      const plainProp = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
        (parent.type === 'Property' && key === 'key' && !parent.computed) || (parent.type === 'MethodDefinition' && key === 'key' && !parent.computed));
      if (n.type === 'WithStatement') out.push('A7 with@' + n.start);
      if (n.type === 'Identifier' && !plainProp) {
        if (GLOBALS.has(n.name)) out.push('A1 ' + n.name + '@' + n.start);
        if (n.name === 'Reflect') out.push('A2 Reflect@' + n.start);
        if (n.name === 'eval') out.push('A3 eval@' + n.start);
        if (n.name === 'Function' && !(parent && parent.type === 'BinaryExpression' &&
            (parent.operator === 'instanceof' ? key === 'right' : /^[!=]==?$/.test(parent.operator)))) out.push('A3 Function@' + n.start);
        // A6: Object only as Object.<name> / Object[<known safe name>], or compared; never as a value
        if (n.name === 'Object') {
          const k = memObj ? keyOf(parent, parent.property, parent.computed) : null;
          if (memObj ? (!k || k.some(DANGER)) : !(parent && parent.type === 'BinaryExpression' && /^([!=]==?|instanceof)$/.test(parent.operator)))
            out.push('A6 Object' + (memObj ? (k ? '.' + k.find(DANGER) : '[?]') : ' as a value') + '@' + n.start);
        }
      }
      if (n.type === 'ThisExpression') {
        if (memObj && !parent.computed && SERVICES.has(parent.property.name)) out.push('A4 this.' + parent.property.name + '@' + n.start);
        else if (!inClass && (!memObj || parent.computed)) out.push('A4 ' + (memObj ? 'this[...]' : 'this') + '@' + n.start);
      }
      // A5: any constant "constructor" (or __proto__) a node may hold, used as a key, argument or value
      const memKey = parent && parent.type === 'MemberExpression' && key === 'property' && parent.computed;
      const v = vals(n);
      if (!memKey && v && v.some(x => x === 'constructor' || x === '__proto__') && !(parent && parent.type === 'BinaryExpression' && parent.operator === '+')) out.push('A5 "' + v.find(x => x === 'constructor' || x === '__proto__') + '"@' + n.start);
      if (n.type === 'Property' && parent && parent.type === 'ObjectPattern') { const k = keyOf(n, n.key, n.computed); if (!k || k.some(x => x === 'constructor' || x === '__proto__')) out.push('A5 {' + (k ? k.join('|') : '[?]') + '}@' + n.start); }
      if (n.type === 'MemberExpression' && !n.computed && n.property.name === '__proto__') out.push('A6 __proto__@' + n.start);
      if (n.type === 'MemberExpression' && n.computed) { const k = vals(n.property); if (k && k.includes('__proto__')) out.push('A6 [__proto__]@' + n.start); }
      if (n.type === 'MemberExpression') {
        const names = n.computed ? (vals(n.property) || []) : [n.property.name];
        if (names.includes('constructor') && !((parent && parent.type === 'MemberExpression' && key === 'object' && !parent.computed && parent.property.name === 'name') ||
            (parent && parent.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)))) out.push('A5 .constructor@' + n.start);
      }
      for (const k of Object.keys(n)) { if (k === 'loc') continue; const c = n[k]; if (Array.isArray(c)) c.forEach(x => w(x, n, k, inClass)); else if (c && typeof c.type === 'string') w(c, n, k, inClass); }
    })(ast, null, null, false);
    return out;
  }
  const dynamic = dynamicAccess(reach);
  RAN.add('L100');
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
    // round 4 (driven: each passed the full suite with "oauthScopes": [] and reached a fake DriveApp in a vm)
    'function run(){ const a="constr"; return [].map[a+"uctor"]("return Drive"+"App")(); }', 'function run(){ let k="constr"; k+="uctor"; return [].map[k]("return Drive"+"App")(); }',
    'function f(globalThis){ return 1; } function run(){ return globalThis["Drive"+"App"]; }', 'function f(Reflect){ return 1; } function g(globalThis){ return 1; } function run(){ return Reflect.get(globalThis,"Drive"+"App"); }',
    'function run(){ const {getPrototypeOf:gp,getOwnPropertyNames:gn}=Object; const p=gp(()=>{}); return p[gn(p).find(x=>x.length===11)]("return Drive"+"App")(); }',
    'function run(){ const p=Object["getPrototypeOf"](()=>{}); return p[Object["getOwnPropertyNames"](p).find(x=>x.length===11)]("return Drive"+"App")(); }',
    'function q(){ try{ return 1; }catch(globalThis){ return 2; } } function run(){ return globalThis["Drive"+"App"]; }',
    'function run(){ const {__proto__:P}=()=>{}; return P[Object.keys(P)[0]]; }', 'function run(){ var r; with(Object){ r=getPrototypeOf(()=>{}); return r; } }',
    'function run(){ const o=Object; const p=o.getPrototypeOf(()=>{}); return p[o.getOwnPropertyNames(p).find(x=>x.length===11)]("return Drive"+"App")(); }',
    'function run(){ const a="constr"; const b=a; return [].map[b+`uctor`]("return Drive"+"App")(); }', 'function run(){ var k; k="constr"; k=k+"uctor"; return [].map[k]("return Drive"+"App")(); }',
    'function run(){ const k=1?"constructor":"x"; return [].map[k]("return Drive"+"App")(); }', 'function run(){ return ({}).__lookupGetter__("__proto__").call(()=>{}); }',
    'function run(){ const n="getPrototypeOf"; return Object[n](()=>{}); }', 'function run(x){ return x["__pro"+"to__"]; }',
    'function run(){ with([].map){ return constructor("return Drive"+"App")(); } }',
    // round 5 (test-design review, driven): with the `.__proto__` member rule deleted, every form above still passed, so
    // nothing pinned that rule. This form is flagged by it alone.
    'function run(o){ return o.__proto__; }',
  ];
  const LEGIT = [
    'function run(){ var o={eval:1}; return o.eval; }', 'class Box { set(k, v) { this[k] = v; } }', 'function run(){ const me={a:1}; return me["a"]; }',
    'function run(x){ return x instanceof Function; }', 'function run(){ const o={a:1}; return Object.keys(o).length; }', 'class A {} function run(){ return new A().constructor.name; }',
    'var Mod = (function(){ function priv(){ return 1; } return { pub: priv }; })();', 'function run(x){ return typeof x === "function" && x.constructor === Function; }',
    'function run(o){ const { a, b: [c], ...rest } = o; return a + c + Object.keys(rest).length; }', 'function run(a, i){ return a[i + 1] + a["k" + i] + a[`k${i}`]; }', 'function run(){ const k="na"+"me"; let j="a"; j+="b"; return Object.keys({})[0] + k + j + (Object.entries({}).length); }', 'function run(o){ return o && o.constructor === Object && Object["keys"](o).length; }',
    'class P { constructor(x) { this.x = x; } }', 'function run(e){ Logger.log("constructor failed: " + e); return "Constructor"; }',
    'function run(o){ return Object.assign({}, o, Object.fromEntries(Object.entries(o))); }', 'function run(x){ return x && x["constructor"] === Object; }',
  ];
  const missed = BYPASS.filter(s => !dynamicAccess(s).length), flagged = LEGIT.filter(s => dynamicAccess(s).length); RAN.add('L100 corpus');
  ok(!missed.length && !flagged.length, 'the L100 rule flags all ' + BYPASS.length + ' known bypass forms and none of ' + LEGIT.length + ' legitimate forms' +
    (missed.length ? '; MISSED: ' + missed[0] : '') + (flagged.length ? '; FLAGGED: ' + flagged[0] : ''));
  // workflow review M1: an exemption whose unmasked body needs no scope the manifest lacks is obsolete (and would mask later calls)
  for (const [n, v, b] of EXBODIES) {
    const bc = b.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\\n])*`/g, "''")).join('\n');
    ok(NEEDS.some(([re, scopes]) => re.test(bc) && !scopes.some(x => granted.has(x))), 'v368-exempt.json: ' + n + ' still needs its exemption (an obsolete exemption masks later calls)');
  }
}
// L107: fails, in every mode, when the parser is missing or any AST check above did not run.
const AST_CHECKS = ['alias', 'chain', 'alias corpus', 'chain corpus', 'L100', 'L100 corpus'];
const notRun = AST_CHECKS.filter(k => !RAN.has(k));
ok(!notRun.length, 'the ' + AST_CHECKS.length + ' AST checks ran' + (notRun.length ? '; NOT RUN: ' + notRun.join(', ') + (ACORN ? '' : ' (parser acorn unavailable: tests/typecheck/run.sh installs it)') : ''));

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

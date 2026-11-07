// v0.1.0: the project skeleton. Every version ADDS its own tests/v<version>.test.js (runall GUARD); never rename old ones.
// Run: SRC=<abs .gs> node tests/v010.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = process.env.SRC || process.env.MTD_GS || path.resolve(__dirname, '..', 'App.gs');
const src = fs.readFileSync(SRC, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const VER = (/const VERSION = '([0-9.]+)'/.exec(src) || [])[1] || '0.0.0', atLeast = (w, v) => { const a = v.split('.').map(Number), b = w.split('.').map(Number); for (let k = 0; k < 3; k++) if (a[k] !== b[k]) return a[k] > b[k]; return true; };
ok(atLeast('0.1.0', VER), 'VERSION is 0.1.0 or later (' + VER + ')');   // never assert the exact VERSION (L16)
const logs = [], ctx = vm.createContext({ Logger: { log: m => logs.push(String(m)) } });
vm.runInContext(src, ctx);
ok(vm.runInContext('health()', ctx) === 'VERSION ' + VER && logs.length === 1, 'health() logs and returns one status line');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

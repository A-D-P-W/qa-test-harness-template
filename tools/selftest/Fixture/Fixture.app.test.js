// Contract test for the self-test fixture module (tools/guard_selftest.sh copies it to tests/contract/ in its scratch
// copies). It cites each guarantee of modules/Fixture/CONTRACT.md in an assertion's name, as GUARD (d) requires (M107):
// one in a plain string, one in a template literal, so both forms count.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'modules', 'Fixture', 'Fixture.gs'), 'utf8') + '\n;this.api = { fixtureClamp_, fixtureBox_, FixtureBox_, FIXTURE_LIMIT };', ctx);
const { fixtureClamp_, fixtureBox_, FixtureBox_, FIXTURE_LIMIT } = ctx.api;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
ok([-5, 0, 2, FIXTURE_LIMIT, 99].every(n => { const r = fixtureClamp_(n); return r >= 0 && r <= FIXTURE_LIMIT; }), '[Fixture.G1] fixtureClamp_ stays within 0..FIXTURE_LIMIT');
const b = fixtureBox_(7);
ok(b instanceof FixtureBox_ && b.n === 7, `[Fixture.G2] fixtureBox_ returns a FixtureBox_ holding n`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

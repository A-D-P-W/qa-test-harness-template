// Self-test fixture for tools/guards.js (tools/guard_selftest.sh copies it into a scratch copy's modules/). Never bundled.
const FIXTURE_LIMIT = 3;
function fixtureClamp_(n) { return Math.min(Math.max(0, n), FIXTURE_LIMIT); }
function FixtureBox_(n) { this.n = n; }   // a constructor: `this` here is allowed (L107 negative case)
function fixtureBox_(n) { return new FixtureBox_(n); }

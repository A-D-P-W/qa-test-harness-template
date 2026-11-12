# Fixture

Version: 1.0.0

## Purpose
Self-test fixture for tools/guards.js. tools/guard_selftest.sh copies it into a scratch copy; it is never in a real project.

## Public API
- `fixtureClamp_(n)` returns n clamped to 0..FIXTURE_LIMIT.
- `FIXTURE_LIMIT` the upper bound.
- `FixtureBox_(n)` a constructor (uses `this`, which tools/guards.js allows in a function the module calls with new).
- `fixtureBox_(n)` returns new FixtureBox_(n).

## Guarantees
- [G1] `fixtureClamp_(n)` never returns a value below 0 or above `FIXTURE_LIMIT`.
- [G2] `fixtureBox_(n)` returns a `FixtureBox_` that holds n.

## Internal
None.

## Depends on
None.

## Apps Script services
None.

## Consumers
- App — planned (Phase 1)

## Version history
| Version | sha256 | Change | ADR |
|---|---|---|---|
| 1.0.0 | 0f8fc3871a6b4ca4008346082f6f2a29501bc8cdad7fa7c4d23661d4bf5e638f | Fixture for the guard self-test | ADR-0900 |

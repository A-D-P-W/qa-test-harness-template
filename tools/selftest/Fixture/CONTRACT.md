# Fixture

Version: 1.0.0

## Purpose
Self-test fixture for tools/guards.js. tools/guard_selftest.sh copies it into a scratch copy; it is never in a real project.

## Public API
- `fixtureClamp_(n)` returns n clamped to 0..FIXTURE_LIMIT.
- `FIXTURE_LIMIT` the upper bound.
- `FixtureBox_(n)` a constructor (uses `this`, which tools/guards.js allows in a function the module calls with new).
- `fixtureBox_(n)` returns new FixtureBox_(n).

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
| 1.0.0 | 931e365d53b72ac5dde7f4b8388f8d783f3f13d8a0cdf99c2c586ce60257051c | Fixture for the guard self-test | ADR-0900 |

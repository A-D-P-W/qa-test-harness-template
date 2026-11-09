# Fixture

Version: 1.0.0

## Purpose
Self-test fixture for tools/guards.js. tools/guard_selftest.sh copies it into a scratch copy; it is never in a real project.

## Public API
- `fixtureClamp_(n)` returns n clamped to 0..FIXTURE_LIMIT.
- `FIXTURE_LIMIT` the upper bound.

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
| 1.0.0 | c8804afe421f8ad90a2f99b248650d36ca098e47e9f6cad18b6788ebf73aedaa | Fixture for the guard self-test | ADR-0900 |

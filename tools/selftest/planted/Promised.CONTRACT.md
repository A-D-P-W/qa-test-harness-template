# Promised

Version: 1.0.0

## Purpose
Planted GUARD (d) violations for tools/guard_selftest.sh (scratch copies only, M107).

## Public API
- `promisedOne_()` returns 1.

## Guarantees
- [G1] `promisedOne_()` returns 1 (cited only in a comment of the contract test).
- `promisedOne_()` takes no arguments (a bullet with no ID).
- [G4] `promisedOne_()` returns a number (out of order: bullet 3 carries G4; cited in a template literal).

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
| 1.0.0 | SHA | planted | ADR-0900 |

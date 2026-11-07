# Safety patterns

How a script that acts on the owner's data stays reversible, previewable and quiet. Each pattern names where MailToDrive
(the private source project) built it. The contracts below are DRAFTS:
none of these is a shared module yet (MailToDrive ADR-0008 defers DriveMoves). Vendor a pattern by porting its code with a
test of every guarantee listed, then turn it into a module (docs/MODULES.md) once a second project needs it.

## 1. Log before mutate, and revert
- **Rule:** every change to an existing object (move, edit, delete) first writes a log row of IDs (never names or content);
  a change that cannot be logged is not made. An owner-run `revert<Things>(sinceIso)` undoes logged changes newest first,
  only when safe, reports skips by ID, and never reverts its own revert rows.
- **Draft contract:** `logThenDo_(ctx, kind, rows, doFn) → n done`; `revert_(sinceIso) → {reverted:[id], skipped:[{file, reason}]}`.
  Guarantees: row written before the call; the whole revert runs under the script lock; idempotent; skips an object that
  moved again since, a pinned object, and a destination that fails the privacy check; every restored object is pinned.
- **MailToDrive:** `moveFiles_`, `revertMoves` (src/MailToDrive.main.gs; CLAUDE.md § Moves, undo log, dry run); the store is
  StateStore (`MOVELOG_`) with a private sheet tab first. CalendarProposer: PLOG rows before each insert, `revertProposals`
  with If-Match (calendar/src/CalendarProposer.main.gs).

## 2. Dry run on an overlay
- **Rule:** `dryRun()` runs the real decision code against an in-memory overlay of the objects it would change; no mutator is
  called and nothing real is cached as if it had changed.
- **Draft contract:** `ctx.dry = true`, `ctx.vfs = overlay`; every mutator goes through one helper that checks `ctx.dry`.
- **MailToDrive:** `dryOverlay_`, `dryRun()`; DrivePrivacy reads `ctx.vfs` so a dry run does not cache real folders.

## 3. Owner edits win (pins)
- **Rule:** an object the owner changed by hand after the script made it, or one restored by a revert, is pinned and never
  changed again by any script path until the owner unpins it. Pins are listed in `health()`.
- **Draft contract:** `pin_(ctx, id)`, `unpin(id)`, `pins()`, `movable_(ctx, id) → bool` checked BEFORE creating anything.
- **MailToDrive:** `pin_`, `unpin`, `movable_`, `PINS_0..7` via StateStore; CalendarProposer: `untouched_` gates adoption,
  owner edits are pinned (CPIN_).

## 4. Preview by default, approve to act
- **Rule:** a new kind of change ships as a preview (logs what it would do); acting needs an owner switch or an approval
  function run by the owner. One-off upgrade steps are previewed in the digest and applied by one approval function.
- **MailToDrive:** `recheck()` with `RECHECK_MODE` unset = preview, `'move'` = act; `UPGRADES` + `approveUpgrades()`.

## 5. Weekly digest + at most one alert a day
- **Rule:** one weekly email with counts and links (no file names, senders or subjects); a problem alert at most once a day
  per kind of problem; no new OAuth scope for it.
- **MailToDrive:** `digest()`; RunControl `alert_` (max-1/day per signature); DigestRender for the HTML/plain-text pair.

## 6. Heartbeat (dead-man)
- **Rule:** silence must be noticeable. The weekly digest is the heartbeat the owner sees: a missing digest means the
  schedule stopped. A heartbeat checked from outside Apps Script is not built in MailToDrive [unverified design].

## 7. Owner-only settings sheet for values that must not be committed
- **Rule:** owner-chosen identifiers and similar values are typed by the owner into a Settings tab of a private sheet the
  owner alone owns, and copied to script properties by an owner-run `applySettings()`; never logged, never committed. The
  sheet must be owned by the owner with NO other editor or viewer — stricter than RunControl `sheetUsable_`, which accepts
  `opts.allowedShares` (fine for a metrics sheet, not for settings). After applying, the typed values are blanked in the sheet
  (they stay in its version history: the owner knows).
- **MailToDrive:** `applySettings()` (its own owner-only check on top of `sheetUsable_`, review M1; 3.8.1: the editor's
  Script properties page is read-only past 50 properties).

## 8. Fail closed on trust and privacy checks
- **Rule:** a check that cannot read what it needs answers "not trusted" / "not private", never "fine"; bad arguments
  throw TypeError before any service call.
- **MailToDrive:** SenderTrust, DrivePrivacy (`assertPrivate_`), CalendarProposer `tenantOk_`.

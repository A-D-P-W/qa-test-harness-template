/**
 * <Project name> — <what it does, in one line>.
 * Source: this file is src/App.main.gs; App.gs at the repo root is GENERATED (node tools/bundle.js). Never edit App.gs.
 * Deploy: .\deploy.ps1 from the repo on the owner's PC (clasp; tagged releases only; see CLAUDE.md § Release). Never paste.
 * Emergency stop, once the project has a schedule: run uninstall() in the editor (removes the schedule; no deploy needed).
 */

// ===================== VERSION =====================
const VERSION = '0.1.4';
/* CHANGELOG (newest first; the full record is this list, git history and tests/LESSONS.md)
 * 0.1.4  2026-11-11  Synced from MailToDrive: FULL reruns every suite 90 days ahead (tools/clockahead.js, suite clock90);
 *                    seeded lessons L85-L90, L98, L99 and M100 (MailToDrive L100+ rows seeded as M<n>); 3 module rows.
 * 0.1.3  2026-11-11  Type-check tools bumped (Dependabot #4: typescript 7.0.2, @types/google-apps-script 2.0.14, acorn
 *                    8.19.0); tests/typecheck/run.sh reads the versions it prints from the lockfile (L109).
 * 0.1.2  2026-11-11  tools/template_check.sh runs the scratch copy on this checkout's branch with last_review_commit set,
 *                    so the main-only GUARDs apply to the template's own main (L108); release dates set for 0.1.0, 0.1.1.
 * 0.1.1  2026-11-09  Template test gaps closed (L107): v368 fails when its AST checks did not run and drives
 *                    the alias and chain checks with example forms; the GUARD self-test plants every module check.
 * 0.1.0  2026-11-06  Template published (qa-test-harness-template). A project made from it adds its own lines above these,
 *                    dated (dev) during development; runall fails a (dev) top line on main (README § Start a project).
 */

// One status line for the owner: what is running and whether anything needs attention. Extend it, never remove it:
// the release flow's live check is "one normal run + health()" (CLAUDE.md § Release).
function health() {
  const line = 'VERSION ' + VERSION;
  Logger.log(line);
  return line;
}

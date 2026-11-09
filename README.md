# qa-test-harness-template

A test and release harness for unattended Google Apps Script projects. These are scripts that run on a schedule against
someone's mail, Drive or calendar with no person watching each run. The harness came out of a private production project
(MailToDrive, an Apps Script mail-filing tool). This repository has its test runner, its guards, its release path and its
record of mistakes, and none of its project code or data.

The example project in `src/` is a single `health()` function. It is small so that the harness can be read on its own.

## Run it

Requirements: bash, Node (CI uses Node 24), Python 3, git. PowerShell 7 (`pwsh`) is optional and runs the deploy-script tests.

```bash
tools/template_check.sh                     # this repository as shipped (an unfilled template), see below
PWSH=pwsh FULL=1 tools/template_check.sh    # the release run: the type check, module guards and deploy tests are required
```

The last line of the output is the verdict: `VERDICT: PASS - no regressions`, or `VERDICT: REGRESSION - n problem(s)`
followed by each problem (exit code 1). A project created from the template runs `./runall.sh` in place of
`tools/template_check.sh`.

The template has to be run from a scratch copy. On `main`, runall fails an unfilled template on purpose. The CHANGELOG is
still dated `(dev)` and `tests/workflow_review.json` has no first commit yet, and a real project must fix both before its
first release. `tools/template_check.sh` copies the tracked files to a temporary git repository on a branch, puts in
placeholder script IDs and runs runall there, the way a new project's first branch would. CI
(`.github/workflows/tests.yml`) chooses between the two commands from the state of `tests/workflow_review.json`.

## What it checks

| Suite / check | What it catches |
|---|---|
| `typecheck` | Calls to Apps Script members that do not exist, checked against Google's published types (`tests/typecheck/`, typescript and @types/google-apps-script pinned by integrity hash). Mocks cannot catch this. |
| `v368` (scope map) | Code that calls an Apps Script service whose OAuth scope is missing from `appsscript.json`. The check walks the AST of the code the project can reach, so aliasing (`const A = DriveApp`) and optional chaining are covered. Any service with no row in its NEEDS table fails, and every run checks each row against a sample call (L105), because the template's own code calls no service. Code that reaches a service without naming it (the global object, `Reflect`, `eval`/`Function`, `this[...]`, `.constructor`, property-descriptor lookups) fails too, and every run re-checks that rule against every known bypass form and a set of legitimate forms, and prints both counts (L100). Four review rounds each found new bypasses, and a name produced by running code (for example `['constr', 'uctor'].join('')`) is a documented residual. It is a lint against accidental omissions, not a sandbox: the manifest is what Google enforces at run time. |
| `v010` | The example project's own tests. Each version adds a `tests/v<VERSION without dots>.test.js` (0.1.1: `tests/v011.test.js`). |
| `deploy` | `deploy.ps1`, the only release path, tested against real git repositories and a fake `clasp` CLI. The fake is modelled on the source of clasp 3.4.1. Each test asserts which stage stopped the release, not only that it stopped. |
| `guards` (`tools/guards.js`) | Module rules, checked on the AST: a module reads no consumer globals and calls only the services its contract lists; every consumer has a contract test; module versions are immutable once released. |
| runall GUARDs | Checks on the test suite itself, listed below. |

The runall GUARDs fail the run when:

- a suite passes nothing (it may not have run)
- a `tests/v*.test.js` file is not run, or a test-looking file sits where the runner's glob never reaches
- two suites report identical results (one suite running twice)
- the current VERSION has no test file, or a test asserts the exact VERSION (that breaks at the next release)
- a test uses a clock offset that crosses midnight or DST, or a timing ratio taken from one sample (flaky under load)
- an allowed-failure entry matches nothing (stale), or a suite exits 1 with no FAIL line, or crashes
- the committed bundle differs from a fresh build
- VERSION and the top CHANGELOG line disagree
- the thresholds of the workflow-review trigger were edited quietly

`tools/guard_selftest.sh` (run by CI) plants a violation for each of these in a scratch copy, plus module-rule violations
in a fixture module (`tools/selftest/Fixture/`), and fails if any check stays silent (L101). It also runs runall from a
path with a space next to a canary folder (L104). CI runs shellcheck on every tracked `*.sh`.

## Design rationale

- **One verdict.** Every suite feeds one line. A failure is either listed in `tests/expected_deployed.txt` or
  `tests/known_open.txt` as `<suite> | <exact line>` with an owner's OK, or the run fails. An entry that no longer matches
  anything also fails the run, so the list of allowed failures cannot quietly rot.
- **Lessons become guards.** `tests/LESSONS.md` lists 87 mistake classes: 81 from the source project and 6 found here. Each row gives its
  evidence (what happened, when, how it was found) and the check that now catches it. A bug fix adds a guard for the
  bug's class, not only the case. Many rows are about the tests themselves: a mock that dropped an argument, a fuzz
  generator that lost float precision, a mutant that looped forever and was counted as killed. Most of those checks are
  MailToDrive's. The ones that run in this repository are the runall GUARDs, `tools/guards.js`, `tests/v368.test.js`, the
  type check and `tests/deploy.test.sh` (on Linux in runall, and on Windows in the `deploy-windows` CI job, L103).
- **Guards are driven, not read.** A check is trusted after it has been run against neighbouring forms of the bug and
  against mutants of the code it protects (lessons L19, L37, L46). Reading the check is not enough.
- **Release only from a tested commit.** `deploy.ps1` uploads the bytes of the tested commit (`git archive`, not the
  working folder) to a pinned script ID. It creates an immutable annotated tag, downloads the live script again and compares
  it with what was uploaded. Every irreversible step comes after every check.
- **Mocks lie.** The mocks grant every API, so each new Apps Script API gets a row in the scope map and a live check in
  the owner's account before it is trusted (L4).
- **Safety patterns for scripts that touch personal data.** `docs/PATTERNS.md`: write a log row before every change, with
  an owner-run revert; dry runs on an in-memory overlay; owner edits are pinned and never changed again; preview first,
  then approve; a weekly digest with at most one alert a day; fail closed on trust and privacy checks.
- **Review is triggered by size.** `tools/review_count.py` prints `WORKFLOW REVIEW DUE` after 8 commits or 400 added lines
  in workflow files since the last review. Many small additions to a test workflow create gaps and conflicts that no single
  review sees (L10).

## Files

| Area | Files |
|---|---|
| Example project | `src/App.main.gs`, `App.gs` (generated bundle, committed), `appsscript.json`, `deploy/app.files`, `tests/v010.test.js` |
| Verdict | `runall.sh`, `tests/expected_deployed.txt`, `tests/known_open.txt`, `tests/LESSONS.md`, `tools/template_check.sh`, `tools/guard_selftest.sh` |
| Scope map and types | `tests/v368.test.js`, `tools/reachable.js`, `tools/ast.js`, `tests/typecheck/` |
| Modules | `tools/bundle.js`, `tools/projects.js`, `tools/guards.js`, `docs/MODULES.md`, `docs/ARCHITECTURE.md` |
| Release | `deploy.ps1`, `tests/deploy.test.sh`, `tests/deploy/fake-clasp.js`, `.clasp.json`, `.claspignore` |
| CI and GitHub | `.github/workflows/tests.yml`, `docs/RULESETS.md` |
| Governance | `CLAUDE.md` (agent-instruction skeleton), `docs/adr/`, `tests/workflow_review.json`, `tools/review_count.py` |

## Start a project from it

1. Copy the tracked files into a new private repository: `git init -b main`, then
   `git -C <template> archive HEAD | tar -x`. Record the template commit in
   `docs/adr/0001-start-from-template.md`.
2. Fill in `CLAUDE.md` and the header of `src/App.main.gs`. Replace the `(dev)` CHANGELOG date with today's date, then run
   `node tools/bundle.js`.
3. Create the Apps Script project and copy its script ID from the editor's Project Settings. Put it into `deploy.ps1` (`$PinnedScriptId`) and `.clasp.json` in one
   reviewed commit.
4. In a commit of its own, set `last_review_commit` in `tests/workflow_review.json` to the first commit's SHA and
   `last_review_date` to today. Until this commit, `./runall.sh` on `main` fails the GUARD
   `last_review_commit is not a commit on main`.
5. Run `PWSH=pwsh FULL=1 ./runall.sh` and expect `VERDICT: PASS`. Push `main`, wait for check-run `runall` to succeed,
   then apply the two rulesets in `docs/RULESETS.md`. They require that check, so applying them first would block the
   first push.
6. Add code under `src/` and modules under `modules/` (`docs/MODULES.md`). Every new service gets a NEEDS row, and every
   new API gets a live check.

## Notes

- `tests/LESSONS.md` and the code comments cite the source project's versions, dates and lesson numbers. The source
  repository is private, so those citations are records, not links. Vendor and platform names in the lessons are
  replaced by placeholders (Vendor-X, Platform-Y).
- On Windows with Git Bash, set `MTD_TC_CACHE` to a path in `C:/...` form. `tests/typecheck/run.sh` passes the cache path
  to tsc, and Windows node cannot resolve a `/c/...` path.

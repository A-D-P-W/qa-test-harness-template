#!/bin/bash
# Self-test of the checks that check the tests (L101): every runall GUARD and module GUARD listed below is made to fire on
# a violation planted in a scratch copy, and the same copy without the violations must pass. A GUARD that nothing makes
# fire can be broken (a regex typo, a deleted line) and every run stays green.
# Usage: bash tools/guard_selftest.sh   Exit 0 = the clean copy passes and every expected line appears; 1 otherwise.
# Five runs of runall in scratch git copies (deleted afterwards): clean (on a branch), from a folder whose path has a
# space (L104), planted (on a branch, with a hung suite and a 20 s watchdog, M106), planted on main, and one FULL run with
# tests that age out at 30 and 200 days (M100, M101) and one whose count changes 60 days out (M109). Then two runs of tools/template_check.sh from checkouts on main (L108): with a release date it passes
# with no NOTICE, with a (dev) date it fails.
# The deploy suite is not run (PWSH points nowhere): tests/deploy.test.sh tests deploy.ps1, not the GUARDs.
# tools/selftest/Fixture/ is a module used only here, so tools/guards.js checks at least one real module.
D=$(cd "$(dirname "$0")/.." && pwd)
W=$(mktemp -d "${TMPDIR:-/tmp}/guard-selftest.XXXXXX") || { echo "guard_selftest: FAIL could not make a scratch folder"; exit 1; }
trap 'rm -rf -- "${W:?}"' EXIT
fail=0; pass=0
CUR=$(sed -n "s/^const VERSION = '\([0-9.]*\)';/\1/p" "$D/src/App.main.gs")
copy() {   # copy <name> <branch>: tracked files + the fixture module into $W/<name>, as a git repo on <branch>
  local C="$W/$1"; mkdir -p "$C"
  (cd "$D" && git ls-files -z | tar --null -T - -cf -) | tar -xf - -C "$C" || { echo "guard_selftest: FAIL could not copy the tracked files"; exit 1; }
  mkdir -p "$C/modules/Fixture"; cp "$D/tools/selftest/Fixture/Fixture.gs" "$D/tools/selftest/Fixture/CONTRACT.md" "$C/modules/Fixture/"
  cp "$D/tools/selftest/Fixture/Fixture.app.test.js" "$C/tests/contract/"   # cites [Fixture.G1], [Fixture.G2] (GUARD (d), M107)
  cp "$D/tools/selftest/Fixture/0900-guard-selftest-fixture.md" "$C/docs/adr/"; echo Fixture >> "$C/deploy/modules.order"
  (cd "$C" && git init -q -b "$2" && git add -A && git -c user.email=t@t.invalid -c user.name=t commit -qm selftest) >/dev/null 2>&1 \
    || { echo "guard_selftest: FAIL could not make the scratch git copy"; exit 1; }
}
run() { (cd "$W/$1" && env -u GITHUB_REF_NAME -u FULL PWSH="$W/no-pwsh" ./runall.sh) > "$W/$1.out" 2>&1; }
expect() {   # expect <run> <fixed text>
  if grep -qF -- "$2" "$W/$1.out"; then echo "PASS $1 shows: $2"; pass=$((pass+1)); else echo "FAIL $1 does not show: $2"; fail=$((fail+1)); fi; }
absent() {   # absent <run> <line start>: no output line starts with it
  if grep -q -- "^$2" "$W/$1.out"; then echo "FAIL $1 shows a line starting: $2"; fail=$((fail+1)); else echo "PASS $1 has no line starting: $2"; pass=$((pass+1)); fi; }
plant() {   # the violations; each line below is the trigger for one expected GUARD line
  local C="$W/$1"
  : > "$C/tests/helper.js"; mkdir -p "$C/tests/sub"; : > "$C/tests/sub/x.test.js"; : > "$C/tests/contract/bad.js"
  { cat "$C/tests/v368.test.js"; printf '%s\n' '// tb < 3 * Math.max(ts, 1)' '// const tb = time(f)' '// Date.now() - 86400000' \
      '// Date.now() - 2 * 3600e3' "// ok(VER === '0.1.0')"; } > "$C/tests/v369.test.js"
  echo 'process.exit(2);' > "$C/tests/v901.test.js"; echo 'process.exit(1);' > "$C/tests/v902.test.js"
  echo 'console.log("FAIL planted"); process.exit(1);' > "$C/tests/v903.test.js"
  echo 'console.log("PASS before the hang"); for (;;) {}' > "$C/tests/v905.test.js"   # M106: killed by the watchdog (run planted sets 20 s)
  printf '%s\n' 'console.log("PASS ok"); console.log("FAIL planted cr\rsecond part"); process.exit(1);' > "$C/tests/v904.test.js"   # L102
  printf 'v010 | FAIL nothing prints this line\nno separator here\n' >> "$C/tests/known_open.txt"
  sed -i 's/"threshold_commits": 8/"threshold_commits": 9/' "$C/tests/workflow_review.json"
  sed -i 's/lists \([0-9]*\) mistake classes/lists 1\1 mistake classes/' "$C/README.md"   # L106: a count that no longer matches
  local dup; dup=$(grep '^| L100 |' "$C/tests/LESSONS.md"); printf '%s\n' "$dup" >> "$C/tests/LESSONS.md"   # L106: a lesson numbered twice
  dup=$(grep '^| M100 |' "$C/tests/LESSONS.md"); printf '%s\n' "$dup" >> "$C/tests/LESSONS.md"   # the same for a seeded M row
  sed -i "s/^const VERSION = '[^']*';/const VERSION = '9.9.9';/" "$C/src/App.main.gs"
  printf 'function useFixture_() { return fixtureClamp_(1); }\nfunction useBad_() { return badPub_(); }\n' >> "$C/src/App.main.gs"
  printf 'function fixtureLeak_() { return globalThis; }\nfunction fixtureUsesBad_() { return badPub_(); }\n' >> "$C/modules/Fixture/Fixture.gs"
  # L107: module-rule violations, one or more per check in tools/guards.js (tools/selftest/planted/)
  local P="$D/tools/selftest/planted" m
  for m in Bad Spare NoVer NoCon Broken Promised; do mkdir -p "$C/modules/$m"; cp "$P/$m.gs" "$C/modules/$m/$m.gs"; echo "$m" >> "$C/deploy/modules.order"
    [ -f "$P/$m.CONTRACT.md" ] && cp "$P/$m.CONTRACT.md" "$C/modules/$m/CONTRACT.md"; done
  cp "$P/Bad.app.test.js" "$C/tests/contract/Bad.app.test.js"
  # M107 GUARD (d): Promised has a bullet with no ID, IDs out of order, a guarantee cited only in a comment and a citation of
  # an ID it lacks; its version row gets the real sha, so only GUARD (d) reports it
  cp "$P/Promised.app.test.js" "$C/tests/contract/Promised.app.test.js"; printf -- '- Promised 1.0.0\n' >> "$C/docs/adr/0900-guard-selftest-fixture.md"
  local psha; psha=$(cd "$C" && node tools/guards.js --sha Promised); sed -i "s/| SHA |/| $psha |/" "$C/modules/Promised/CONTRACT.md"
  rm -f "$C/tests/contract/Fixture.app.test.js"   # keeps the GUARD (c) case below: App uses Fixture with no contract test
  sed -i 's#^src/App.main.gs$#modules/Spare/Spare.gs\nsrc/App.main.gs#' "$C/deploy/app.files"
  (cd "$C" && node tools/bundle.js >/dev/null) && echo '// hand edit' >> "$C/App.gs"
}

copy clean selftest; run clean
expect clean 'VERDICT: PASS - no regressions'
expect clean 'OK module guards: '
grep -qE 'OK module guards: [1-9]' "$W/clean.out" || { echo "FAIL clean: tools/guards.js checked no module"; fail=$((fail+1)); }

# L104: runall from "code old/repo" next to a folder "code". An unquoted path once split there, and `rm -rf $O` deleted
# the sibling folder. The canary must survive and the run must still pass.
mkdir -p "$W/code"; echo keep > "$W/code/CANARY.txt"
copy "code old/repo" selftest; run "code old/repo"
expect "code old/repo" 'VERDICT: PASS - no regressions'
if [ -f "$W/code/CANARY.txt" ]; then echo "PASS a path with a space: the sibling folder's canary survived"; pass=$((pass+1))
else echo "FAIL a path with a space: runall deleted the sibling folder $W/code (L104)"; fail=$((fail+1)); fi

copy planted selftest; plant planted; MTD_WATCHDOG_S=20 run planted
expect planted 'GUARD tests/helper.js looks like a test but runall never runs it'
expect planted 'GUARD tests/sub/x.test.js looks like a test in a subfolder that runall never runs'
expect planted 'GUARD tests/contract/bad.js is not <Module>.<consumer>.test.js'
expect planted 'GUARD single-attempt linear-time ratio (retry the pair up to 3 times, L60) tests/v369.test.js:'
expect planted 'GUARD single-sample timing ratio (flaky under load; use min of 3) tests/v369.test.js:'
expect planted 'GUARD relative clock offset may cross midnight (clamp it, or mark the line clock-safe with why, L59) tests/v369.test.js:'
expect planted 'GUARD clock-offset time bomb (breaks at DST) tests/v369.test.js:'
expect planted 'GUARD exact-VERSION assertion (breaks at the next release) tests/v369.test.js:'
expect planted 'GUARD suites v368 and v369 report identical results (duplicate suite?)'
expect planted 'GUARD suite v901 passed nothing (did it run?)'
expect planted 'UNEXPECTED [v901] FAIL suite crashed: exit 2'
expect planted 'UNEXPECTED [v902] FAIL suite exited 1 with no FAIL line'
expect planted 'UNEXPECTED [v903] FAIL planted'
expect planted 'UNEXPECTED [v904] FAIL planted cr\rsecond part'
expect planted 'STALE ENTRY known_open.txt:'
expect planted 'BAD ENTRY known_open.txt:'
expect planted 'GUARD tests/workflow_review.json thresholds/paths differ from runall'
expect planted 'GUARD README.md says 1'
expect planted 'GUARD tests/LESSONS.md numbers a lesson twice: L100, M100'
expect planted 'GUARD STALE App.gs differs from a fresh build'
expect planted 'GUARD App VERSION 9.9.9 has no tests/v999.test.js'
expect planted "GUARD App VERSION 9.9.9 != top CHANGELOG line $CUR"
expect planted 'GUARD modules/Fixture: source or contract changed without a new version row'
expect planted 'GUARD modules/Fixture/Fixture.gs:6 uses globalThis'
expect planted 'GUARD modules/Fixture/Fixture.gs: top-level fixtureLeak_ is neither Public nor Internal in CONTRACT.md'
expect planted 'GUARD modules/Fixture: App uses it but its contract does not list App as a consumer'
expect planted 'GUARD modules/Fixture: consumer App has no tests/contract/Fixture.app.test.js'
expect planted 'GUARD deploy/app.files: App uses Fixture (directly or as a dependency) but does not bundle it'
# tools/guards.js, every check that a planted input can reach (L107)
expect planted 'GUARD modules/Broken/Broken.gs does not parse'
expect planted 'GUARD modules/NoCon: no CONTRACT.md'
expect planted 'GUARD modules/NoVer/CONTRACT.md: no "## Consumers" section'
expect planted 'GUARD modules/NoVer: CONTRACT.md has no "Version: X.Y.Z" line'
expect planted 'GUARD modules/Spare/CONTRACT.md: Consumers line is not "- <Project> — …": * App'
expect planted 'GUARD modules/Spare/CONTRACT.md: Consumers line is not "- <Project> — <callers or planned …>": - App callers'
expect planted 'GUARD modules/Spare: CONTRACT.md version table has no "| version | sha256 | change | ADR |" row'
expect planted 'GUARD modules/Bad: Version 3.0.0 is not the top row of the version table (1.0.0)'
expect planted 'GUARD modules/Bad: source or contract changed without a new version row'
expect planted 'GUARD modules/Bad: version 1.0.0 appears twice'
expect planted 'GUARD modules/Bad: version 2.0.0 cites no ADR with a bullet line "- Bad 2.0.0"'
expect planted 'GUARD modules/Bad: version rows must go up from bottom to top (2.0.0 then 1.0.0)'
expect planted 'GUARD modules/Bad/Bad.gs:1 top-level destructuring'
expect planted 'GUARD modules/Bad/Bad.gs:2 top-level let badCount (only listed module-owned state)'
expect planted 'GUARD modules/Bad/Bad.gs:3 top-level initializer of BAD_LOADED may run code or read other files at load time (call;'
expect planted 'GUARD modules/Bad/Bad.gs:4 top-level ExpressionStatement (modules declare functions and constants only)'
expect planted 'GUARD modules/Bad/Bad.gs:7 calls constructor BadMaker_ without new'
expect planted 'GUARD modules/Bad/Bad.gs:8 uses this outside a constructor'
if grep -qF 'GUARD modules/Fixture/Fixture.gs:4 uses this outside a constructor' "$W/planted.out"; then echo "FAIL planted: this inside the constructor FixtureBox_ was flagged"; fail=$((fail+1))
else echo "PASS planted: this inside a constructor is not flagged"; pass=$((pass+1)); fi
expect planted 'GUARD modules/Bad/Bad.gs:9 uses .constructor'
expect planted 'GUARD modules/Bad/Bad.gs:10 names "constructor" (reaches Function)'
expect planted 'GUARD modules/Bad/Bad.gs:11 uses Reflect'
expect planted 'GUARD modules/Bad/Bad.gs:12 uses new.target'
expect planted 'GUARD modules/Bad/Bad.gs:13 uses Apps Script service DriveApp, not listed in its contract'
expect planted 'GUARD modules/Bad/Bad.gs:14 free identifier mysteryName is not a built-in, service or module name'
expect planted 'GUARD modules/Bad/Bad.gs:15 uses App global useFixture_ (pass it as an argument)'
expect planted 'GUARD modules/Bad/Bad.gs:19 names "constructor" (reaches Function)'
expect planted 'GUARD modules/Bad/Bad.gs:20 names "constructor" (reaches Function)'
expect planted 'GUARD modules/Bad/Bad.gs:21 names "constructor" (reaches Function)'
expect planted 'GUARD modules/Bad/Bad.gs:22 uses eval'
expect planted 'GUARD modules/Bad/Bad.gs:23 uses Function'
expect planted "GUARD modules/Bad/Bad.gs:16 uses Fixture.fixtureLeak_, which is not Public in Fixture's contract"
expect planted 'GUARD modules/Fixture/Fixture.gs:7 uses Bad.badPub_ but "Depends on" does not list Bad'
expect planted 'GUARD App: top-level health declared in modules/Spare and src/App.main.gs'
expect planted 'GUARD deploy/app.files: bundles Spare, which App does not use'
expect planted 'GUARD tests/contract/Bad.app.test.js: App uses Bad.badPub_ but its contract test never exercises it'
expect planted 'GUARD tests/contract/Bad.app.test.js: references Internal helper badHelper_'
expect planted 'GUARD docs/ARCHITECTURE.md: registry row for Bad does not list consumer App'
# GUARD (d), M107
expect planted 'GUARD modules/Promised/CONTRACT.md: Guarantees bullet 2 has no "[G<n>]" ID'
expect planted 'GUARD modules/Promised/CONTRACT.md: Guarantees bullet 3 is [G4] (IDs go 1, 2, … in order)'
expect planted 'GUARD modules/Promised: guarantee [G1] is cited by no contract test'
expect planted 'GUARD tests/contract/Promised.*: cites [Promised.G9], which modules/Promised/CONTRACT.md does not have'
absent planted 'GUARD modules/Promised: guarantee \[G4\]'
absent planted 'GUARD modules/Promised: source or contract changed'
# M106: the hang watchdog kills a stuck suite and names its last output
expect planted 'UNEXPECTED [v905] FAIL watchdog: no output for 20 s (a hang, M106) after: PASS before the hang'
expect planted 'UNEXPECTED [v905] FAIL suite crashed: exit 137'

copy main main
# L107: rules that need history. Older is committed on main at 2.0.0 and tagged; the Fixture row and source change after
# that, and Older goes back to 1.0.0.
older() {   # older <version>: write modules/Older at <version> with its real sha
  local M="$W/main/modules/Older"; mkdir -p "$M"; cp "$D/tools/selftest/planted/Older.gs" "$M/Older.gs"
  sed -e "s/VER/$1/g" -e "s/SHA/$(printf '%064d' 0)/" "$D/tools/selftest/planted/Older.CONTRACT.md" > "$M/CONTRACT.md"
  local sha; sha=$(cd "$W/main" && node tools/guards.js --sha Older); sed -i "s/$(printf '%064d' 0)/$sha/" "$M/CONTRACT.md"; }
older 2.0.0; echo Older >> "$W/main/deploy/modules.order"; printf -- '- Older 2.0.0\n- Older 1.0.0\n' >> "$W/main/docs/adr/0900-guard-selftest-fixture.md"
(cd "$W/main" && git add -A && git -c user.email=t@t.invalid -c user.name=t commit -qm older && git tag release/v0.0.1) >/dev/null 2>&1 \
  || { echo "guard_selftest: FAIL could not commit and tag the main copy"; exit 1; }
older 1.0.0
printf '// changed after the tag\n' >> "$W/main/modules/Fixture/Fixture.gs"
fsha=$(cd "$W/main" && node tools/guards.js --sha Fixture); sed -i "s/^| 1.0.0 | [0-9a-f]\{64\} |/| 1.0.0 | $fsha |/" "$W/main/modules/Fixture/CONTRACT.md"
sed -i 's/^\( \* [0-9][0-9.]*\)  *[^ ]*/\1  (dev)/' "$W/main/src/App.main.gs"
sed -i 's/"last_review_commit": "[^"]*"/"last_review_commit": "not-a-commit"/' "$W/main/tests/workflow_review.json"
(cd "$W/main" && node tools/bundle.js >/dev/null); run main
expect main 'is dated (dev) on main: replace it with the release date'
expect main 'GUARD tests/workflow_review.json last_review_commit is not a commit on main'
expect main 'GUARD modules/Fixture: version 1.0.0 row changed after it reached main (bump the version instead)'
expect main 'GUARD modules/Fixture: changed since release/v0.0.1 but Version is still 1.0.0'
expect main 'GUARD modules/Older: version 2.0.0 (on main) was removed from the version table'
expect main 'GUARD modules/Older: Version 1.0.0 is lower than 2.0.0 at release/v0.0.1'

# M100: FULL reruns every suite 90 days ahead, so a test with a fixed date 30 days out passes today and fails there.
copy aging aging
lim=$(node -e 'console.log(Date.now() + 30 * 864e5)')
printf '%s\n' "if (Date.now() > $lim) { console.log('FAIL fixture aged out'); process.exit(1); }" "console.log('PASS fixture'); console.log('\n1 passed, 0 failed');" > "$W/aging/tests/v903.test.js"
lim=$(node -e 'console.log(Date.now() + 200 * 864e5)')   # M101: ages out between the two horizons
printf '%s\n' "if (Date.now() > $lim) { console.log('FAIL fixture aged out at 200 days'); process.exit(1); }" "console.log('PASS fixture'); console.log('\n1 passed, 0 failed');" > "$W/aging/tests/v904.test.js"
lim=$(node -e 'console.log(Date.now() + 60 * 864e5)')   # M109: a check that adds itself once the date passes 60 days out
printf '%s\n' "console.log('PASS always');" "if (Date.now() > $lim) console.log('PASS only later');" "console.log('\n1 passed, 0 failed');" > "$W/aging/tests/v905.test.js"
(cd "$W/aging" && git add -A && git -c user.email=t@t.invalid -c user.name=t commit -qm aging) >/dev/null 2>&1 || { echo "guard_selftest: FAIL could not commit the aging copy"; exit 1; }
(cd "$W/aging" && env -u GITHUB_REF_NAME FULL=1 PWSH="$W/no-pwsh" ./runall.sh) > "$W/aging.out" 2>&1
expect aging '== v903: PASS=1 FAIL=0'
expect aging 'FAIL clock +90 days: UNEXPECTED [v903] FAIL fixture aged out'
expect aging 'FAIL clock +365 days: UNEXPECTED [v904] FAIL fixture aged out at 200 days'
expect aging 'GUARD suite v905 gives other counts with the clock 90 days ahead (PASS/FAIL/RISK (1, 0, 0) -> (2, 0, 0)): an assertion depends on the date (M109)'
expect aging 'GUARD suite v905 gives other counts with the clock 365 days ahead (PASS/FAIL/RISK (1, 0, 0) -> (2, 0, 0))'
expect aging 'GUARD suite v903 gives other counts with the clock 90 days ahead (PASS/FAIL/RISK (1, 0, 0) -> (0, 1, 0))'
absent aging 'GUARD suite v010 gives other counts'
if grep -qF 'FAIL clock +90 days: UNEXPECTED [v904]' "$W/aging.out"; then echo "FAIL aging: the 200-day fixture failed at +90 days"; fail=$((fail+1)); else echo "PASS aging: the 200-day fixture passes at +90 days (only the 365-day rerun sees it)"; pass=$((pass+1)); fi

# L108: template_check.sh carries this checkout's branch into its scratch copy, so on main a (dev) top CHANGELOG line
# fails the template itself. Both checkouts get their date set here, so the case does not depend on the current one.
tc() {   # tc <name> <date>: tracked files as a git repo on main, top CHANGELOG line dated <date>; runs template_check.sh
  local C="$W/$1"; mkdir -p "$C"
  (cd "$D" && git ls-files -z | tar --null -T - -cf -) | tar -xf - -C "$C" || { echo "guard_selftest: FAIL could not copy the tracked files"; exit 1; }
  sed -i "0,/^\( \* [0-9][0-9.]*\)  *[^ ]*/s//\1  $2/" "$C/src/App.main.gs"   # the top CHANGELOG line only
  (cd "$C" && node tools/bundle.js >/dev/null && git init -q -b main && git add -A && git -c user.email=t@t.invalid -c user.name=t commit -qm tc) >/dev/null 2>&1 \
    || { echo "guard_selftest: FAIL could not make the template_check copy"; exit 1; }
  (cd "$C" && env -u GITHUB_REF_NAME -u FULL PWSH="$W/no-pwsh" bash tools/template_check.sh) > "$W/$1.out" 2>&1; }
tc tc-dated 2026-01-01
expect tc-dated 'on branch main (placeholder script IDs; last_review_commit = its first commit)'
expect tc-dated 'VERDICT: PASS - no regressions'
absent tc-dated 'NOTICE'
tc tc-dev '(dev)'
expect tc-dev "GUARD App CHANGELOG $CUR is dated (dev) on main: replace it with the release date"

echo; echo "$pass passed, $fail failed"
[ $fail = 0 ] || { echo "guard_selftest: FAIL (outputs: rerun with the scratch folder kept to inspect)"; exit 1; }

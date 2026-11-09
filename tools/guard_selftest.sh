#!/bin/bash
# Self-test of the checks that check the tests (L101): every runall GUARD and module GUARD listed below is made to fire on
# a violation planted in a scratch copy, and the same copy without the violations must pass. A GUARD that nothing makes
# fire can be broken (a regex typo, a deleted line) and every run stays green.
# Usage: bash tools/guard_selftest.sh   Exit 0 = the clean copy passes and every expected line appears; 1 otherwise.
# Four runs of runall in scratch git copies (deleted afterwards): clean (on a branch), from a folder whose path has a
# space (L104), planted (on a branch), planted on main.
# The deploy suite is not run (PWSH points nowhere): tests/deploy.test.sh tests deploy.ps1, not the GUARDs.
# tools/selftest/Fixture/ is a module used only here, so tools/guards.js checks at least one real module.
D=$(cd "$(dirname "$0")/.." && pwd)
W=$(mktemp -d "${TMPDIR:-/tmp}/guard-selftest.XXXXXX") || { echo "guard_selftest: FAIL could not make a scratch folder"; exit 1; }
trap 'rm -rf -- "${W:?}"' EXIT
fail=0; pass=0
copy() {   # copy <name> <branch>: tracked files + the fixture module into $W/<name>, as a git repo on <branch>
  local C="$W/$1"; mkdir -p "$C"
  (cd "$D" && git ls-files -z | tar --null -T - -cf -) | tar -xf - -C "$C" || { echo "guard_selftest: FAIL could not copy the tracked files"; exit 1; }
  mkdir -p "$C/modules/Fixture"; cp "$D/tools/selftest/Fixture/Fixture.gs" "$D/tools/selftest/Fixture/CONTRACT.md" "$C/modules/Fixture/"
  cp "$D/tools/selftest/Fixture/0900-guard-selftest-fixture.md" "$C/docs/adr/"; echo Fixture >> "$C/deploy/modules.order"
  (cd "$C" && git init -q -b "$2" && git add -A && git -c user.email=t@t.invalid -c user.name=t commit -qm selftest) >/dev/null 2>&1 \
    || { echo "guard_selftest: FAIL could not make the scratch git copy"; exit 1; }
}
run() { (cd "$W/$1" && env -u GITHUB_REF_NAME -u FULL PWSH="$W/no-pwsh" ./runall.sh) > "$W/$1.out" 2>&1; }
expect() {   # expect <run> <fixed text>
  if grep -qF -- "$2" "$W/$1.out"; then echo "PASS $1 shows: $2"; pass=$((pass+1)); else echo "FAIL $1 does not show: $2"; fail=$((fail+1)); fi; }
plant() {   # the violations; each line below is the trigger for one expected GUARD line
  local C="$W/$1"
  : > "$C/tests/helper.js"; mkdir -p "$C/tests/sub"; : > "$C/tests/sub/x.test.js"; : > "$C/tests/contract/bad.js"
  { cat "$C/tests/v368.test.js"; printf '%s\n' '// tb < 3 * Math.max(ts, 1)' '// const tb = time(f)' '// Date.now() - 86400000' \
      '// Date.now() - 2 * 3600e3' "// ok(VER === '0.1.0')"; } > "$C/tests/v369.test.js"
  echo 'process.exit(2);' > "$C/tests/v901.test.js"; echo 'process.exit(1);' > "$C/tests/v902.test.js"
  echo 'console.log("FAIL planted"); process.exit(1);' > "$C/tests/v903.test.js"
  printf '%s\n' 'console.log("PASS ok"); console.log("FAIL planted cr\rsecond part"); process.exit(1);' > "$C/tests/v904.test.js"   # L102
  printf 'v010 | FAIL nothing prints this line\nno separator here\n' >> "$C/tests/known_open.txt"
  sed -i 's/"threshold_commits": 8/"threshold_commits": 9/' "$C/tests/workflow_review.json"
  sed -i "s/^const VERSION = '[^']*';/const VERSION = '0.1.1';/" "$C/src/App.main.gs"
  printf 'function useFixture_() { return fixtureClamp_(1); }\n' >> "$C/src/App.main.gs"
  printf 'function fixtureLeak_() { return globalThis; }\n' >> "$C/modules/Fixture/Fixture.gs"
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

copy planted selftest; plant planted; run planted
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
expect planted 'GUARD STALE App.gs differs from a fresh build'
expect planted 'GUARD App VERSION 0.1.1 has no tests/v011.test.js'
expect planted 'GUARD App VERSION 0.1.1 != top CHANGELOG line 0.1.0'
expect planted 'GUARD modules/Fixture: source or contract changed without a new version row'
expect planted 'GUARD modules/Fixture/Fixture.gs:4 uses globalThis'
expect planted 'GUARD modules/Fixture/Fixture.gs: top-level fixtureLeak_ is neither Public nor Internal in CONTRACT.md'
expect planted 'GUARD modules/Fixture: App uses it but its contract does not list App as a consumer'
expect planted 'GUARD modules/Fixture: consumer App has no tests/contract/Fixture.app.test.js'
expect planted 'GUARD deploy/app.files: App uses Fixture (directly or as a dependency) but does not bundle it'

copy main main
sed -i 's/^\( \* [0-9][0-9.]*\)  *[^ ]*/\1  (dev)/' "$W/main/src/App.main.gs"
sed -i 's/"last_review_commit": "[^"]*"/"last_review_commit": "not-a-commit"/' "$W/main/tests/workflow_review.json"
(cd "$W/main" && node tools/bundle.js >/dev/null); run main
expect main 'is dated (dev) on main: replace it with the release date'
expect main 'GUARD tests/workflow_review.json last_review_commit is not a commit on main'

echo; echo "$pass passed, $fail failed"
[ $fail = 0 ] || { echo "guard_selftest: FAIL (outputs: rerun with the scratch folder kept to inspect)"; exit 1; }

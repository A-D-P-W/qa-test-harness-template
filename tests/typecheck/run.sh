#!/bin/bash
# Type check of the bundle (App.gs) against Google's published Apps Script types.
# Catches calls to Apps Script / advanced-service members that do not exist (mocks cannot: lesson L4).
# Tools: tests/typecheck/package-lock.json (typescript 5.9.3, @types/google-apps-script 2.0.13, sha512 integrity),
# installed with `npm ci` into $MTD_TC_CACHE (default ~/.cache/mtd-tc) when the lock changes.
# Prints PASS / FAIL lines for runall. Exit 3 = tools unavailable (runall reports SKIPPED; FULL=1 fails).
# MTD_TSC overrides the compiler (tests of this script only).
H=$(cd "$(dirname "$0")" && pwd); D=$(cd "$H/../.." && pwd); C=${MTD_TC_CACHE:-$HOME/.cache/mtd-tc}; SRC=${MTD_GS:-$D/App.gs}
mkdir -p "$C" || exit 3
if [ -z "$MTD_TSC" ] && { ! cmp -s "$H/package-lock.json" "$C/package-lock.json" || [ ! -x "$C/node_modules/.bin/tsc" ]; }; then   # a stub compiler needs no install
  cp "$H/package.json" "$H/package-lock.json" "$C/" || exit 3
  (cd "$C" && npm ci --silent --no-audit --no-fund >/dev/null 2>&1) || { rm -f "$C/package-lock.json"; echo "SKIP typecheck: npm ci failed"; exit 3; }
fi
TSC=${MTD_TSC:-$C/node_modules/.bin/tsc}
W=$(mktemp -d) || exit 3; trap 'rm -rf -- "${W:?}"' EXIT
cp "$SRC" "$W/App.js"
# strict:false (noImplicitAny: 549 errors); the five free strictness flags below report 0 today (CI review L3)
printf '{"compilerOptions":{"allowJs":true,"checkJs":true,"noEmit":true,"target":"es2020","lib":["es2020"],"types":["google-apps-script"],"typeRoots":["%s/node_modules/@types"],"strict":false,"noImplicitThis":true,"strictBindCallApply":true,"noFallthroughCasesInSwitch":true,"noImplicitReturns":true,"alwaysStrict":true,"skipLibCheck":true},"files":["App.js"]}\n' "$C" > "$W/tsconfig.json"
out=$(cd "$W" && "$TSC" -p . 2>&1); trc=$?; n=$(grep -c "error TS" <<<"$out")
if [ "$n" = 0 ] && [ $trc = 0 ]; then echo "PASS typecheck: 0 errors (typescript 5.9.3, @types/google-apps-script 2.0.13)"; exit 0; fi
if [ "$n" = 0 ]; then echo "FAIL typecheck: tsc exit $trc with no error lines: $(head -1 <<<"$out" | cut -c1-200)"; exit 1; fi   # CI review: a crash is not a pass
grep "error TS" <<<"$out" | sed -e "s#^App.js#$(basename "$SRC")#" -e 's/^/FAIL typecheck /' | cut -c1-300; exit 1

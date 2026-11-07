#!/bin/bash
# deploy.ps1 behaviour tests (ported from MailToDrive tests/deploy.test.sh): real git repos (bare origin + clone) + a fake clasp modelled on clasp 3.4.1
# (tests/deploy/fake-clasp.js). Needs PowerShell (PWSH=<path>, default pwsh). Each test asserts WHICH stage stopped
# the run (its STOP text) and whether an upload happened, not only the exit code (QA lesson, M08).
D=$(cd "$(dirname "$0")/.." && pwd); PW=${PWSH:-pwsh}
command -v "$PW" >/dev/null || { echo "SKIP deploy tests: PowerShell not found (set PWSH)"; exit 3; }
W=$(mktemp -d) || exit 1; [ -n "$W" ] && [ -d "$W" ] || exit 1
trap 'rm -rf -- "${W:?}"' EXIT
mkdir -p "$W/bin"; printf '#!/bin/bash\nexec node %s "$@"\n' "$D/tests/deploy/fake-clasp.js" > "$W/bin/clasp"; chmod +x "$W/bin/clasp"
export PATH="$W/bin:$PATH" FAKE_LOG="$W/calls.log" FAKE_LIVE_ROOT="$W/live" TMPDIR="$W/tmp"
PIN=1TemplateTestPinXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX; VER=$(grep -oP "const VERSION = '\K[0-9.]+" "$D/App.gs")
LIVE="$W/live/$PIN"; pass=0; fail=0; n=0
ok(){ n=$((n+1)); if eval "$1"; then echo "PASS $2"; pass=$((pass+1)); else echo "FAIL $2  -- rc=$rc out: $(echo "$out" | tr '\n' ' ' | cut -c1-400)"; fail=$((fail+1)); fi; }
tagit(){ git -C "$W/r" tag -a "release/v$VER" -m release "${1:-HEAD}"; git -C "$W/r" push -q origin "release/v$VER" 2>/dev/null; }
fresh(){
  rm -rf -- "${W:?}/origin.git" "${W:?}/r" "${W:?}/r2" "${W:?}/live" "${W:?}/tmp"; mkdir -p "$W/live" "$W/tmp" "$LIVE"
  git init -q --bare -b main "$W/origin.git"; git clone -q "$W/origin.git" "$W/r" 2>/dev/null
  cd "$W/r"; git config user.email t@t; git config user.name t
  cp "$D/App.gs" "$D/appsscript.json" "$D/.clasp.json" "$D/.claspignore" "$D/deploy.ps1" "$D/.gitattributes" .
  # the template ships with no pin: the tests set their own (a real project pins its live scriptId in a reviewed commit)
  if [ "$1" != nopin ]; then sed -i "s/^\$PinnedScriptId = '[^']*'/\$PinnedScriptId = '$PIN'/" deploy.ps1; sed -i "s/\"scriptId\": *\"[^\"]*\"/\"scriptId\": \"$PIN\"/" .clasp.json
    grep -q "^\$PinnedScriptId = '$PIN'" deploy.ps1 && grep -q "\"scriptId\": \"$PIN\"" .clasp.json || echo "FAIL fresh could not set the test pin (deploy.ps1 or .clasp.json changed shape)"
  else   # review H1: once a project pins itself, "unpinned" must be made, not assumed from the shipped file
    sed -i "s/^\$PinnedScriptId = '[^']*'/\$PinnedScriptId = ''/" deploy.ps1; sed -i "s/\"scriptId\": *\"[^\"]*\"/\"scriptId\": \"PASTE_THE_LIVE_SCRIPT_ID_IN_A_REVIEWED_COMMIT\"/" .clasp.json
    grep -q "^\$PinnedScriptId = ''" deploy.ps1 && grep -q "PASTE_THE_LIVE_SCRIPT_ID" .clasp.json || echo "FAIL fresh could not clear the pin (deploy.ps1 or .clasp.json changed shape)"; fi
  git add -A; git commit -qm init; git push -q origin main 2>/dev/null; [ "$1" = notag ] || [ "$1" = nopin ] || tagit
  printf "const VERSION = '0.0.1';\n" > "$LIVE/Code.js"; cp appsscript.json "$LIVE/"
  : > "$FAKE_LOG"; export FAKE_STATUS=ok FAKE_PUSH=ok FAKE_PULL=ok; unset FAKE_STDERR clasp_config_project FAKE_VERSION FAKE_LOGOUT KEEP_CLASP_LOGIN; rm -f "$W/origin.git/hooks/pre-receive"
}
run(){ out=$(cd "$W/r" && "$PW" -NoProfile -File ./deploy.ps1 "$@" 2>&1); rc=$?; }
pushed(){ grep -q '^push --force' "$FAKE_LOG"; }
livehas(){ grep -q "$1" "$LIVE/App.js" 2>/dev/null; }
SHA(){ git -C "$W/r" rev-parse --short=7 HEAD; }

fresh; run
ok '[ $rc = 0 ] && grep -q "DEPLOYED v$VER = commit $(SHA)" <<<"$out"' "happy path → DEPLOYED v$VER = commit"
ok 'grep -qx "push --force" "$FAKE_LOG" && grep -qx "status --json" "$FAKE_LOG"' 'uses status --json and push --force'
ok '[ -z "$(ls -A "$W/tmp")" ]' 'all temporary folders removed'
ok 'cmp -s <(tr -d "\r" < "$LIVE/App.js") "$D/App.gs" && [ ! -e "$LIVE/Code.js" ]' 'live = commit; old Code.js gone'
fresh; export FAKE_STDERR=1; run
ok '[ $rc = 0 ] && grep -q DEPLOYED <<<"$out"' 'stderr chatter does not stop the deploy'
fresh; echo x >> "$W/r/App.gs"; run
ok '[ $rc = 1 ] && grep -q "STOP: uncommitted" <<<"$out" && grep -q "only line endings" <<<"$out" && ! pushed' 'dirty tree → STOP (with line-ending hint), no upload'
fresh; touch "$W/r/stray.txt"; run
ok '[ $rc = 1 ] && grep -q "stray.txt" <<<"$out" && ! pushed' 'untracked file → STOP'
fresh; git -C "$W/r" checkout -qb feature; run
ok '[ $rc = 1 ] && grep -q "not main" <<<"$out" && ! pushed' 'not on main → STOP'
fresh; (cd "$W/r"; echo "// local" >> App.gs; git commit -qam local); run
ok '[ $rc = 1 ] && grep -q "is not origin/main" <<<"$out" && ! pushed' 'local commit not on GitHub → STOP'
fresh; git clone -q "$W/origin.git" "$W/r2" 2>/dev/null; (cd "$W/r2"; git config user.email t@t; git config user.name t; echo "// newer" >> App.gs; git commit -qam newer; git push -q origin main 2>/dev/null); run
ok '[ $rc = 1 ] && grep -q "run: git pull" <<<"$out" && ! pushed' 'GitHub has a newer commit (local behind) → STOP'
fresh notag; run
ok '[ $rc = 1 ] && grep -q "no annotated tag release/v$VER" <<<"$out" && ! pushed' 'no release tag → STOP'
fresh notag; run -DryRun
ok '[ $rc = 1 ] && grep -q "WARNING: .*no annotated tag" <<<"$out" && grep -q MISMATCH <<<"$out" && ! pushed' 'no release tag, dry run → WARNING, compares, no upload'
fresh notag; (cd "$W/r"; git tag "release/v$VER"; git push -q origin "release/v$VER" 2>/dev/null); run
ok '[ $rc = 1 ] && grep -q "no annotated tag" <<<"$out" && ! pushed' 'lightweight tag → STOP'
fresh notag; git -C "$W/r" tag -a "release/v$VER" -m local; run
ok '[ $rc = 1 ] && grep -q "no annotated tag" <<<"$out" && ! pushed' 'tag only local, not on GitHub → STOP'
fresh; (cd "$W/r"; echo "// after tag" >> App.gs; git commit -qam after; git push -q origin main 2>/dev/null); run
ok '[ $rc = 1 ] && grep -q "no annotated tag" <<<"$out" && ! pushed' 'tag on an older commit → STOP'
fresh notag; (cd "$W/r"; sed -i "s/$PIN/1OtherProjectXXXXXXXXXXXXXXXXXXXXX/" .clasp.json; git commit -qam swap; git push -q origin main 2>/dev/null); tagit; run
ok '[ $rc = 1 ] && grep -q "not the pinned live project" <<<"$out" && ! pushed' 'scriptId swapped in a commit → STOP'
fresh; export clasp_config_project=/tmp/other; run; unset clasp_config_project
ok '[ $rc = 1 ] && grep -q "clasp_config_project would redirect" <<<"$out" && ! pushed' 'clasp_config_* env var → STOP'
fresh; (cd "$W/r"; git update-index --assume-unchanged App.gs; echo "function injected_() {}" >> App.gs); run
ok '[ $rc = 0 ] && grep -q DEPLOYED <<<"$out" && ! livehas injected_' 'hidden working-folder edit is NOT uploaded (stage = commit bytes)'
fresh; export FAKE_STATUS=extra; run
ok '[ $rc = 1 ] && grep -q "old/MailToDrive.gs" <<<"$out" && ! pushed' 'clasp would upload an extra file (full path) → STOP'
fresh; export FAKE_STATUS=text; run
ok '[ $rc = 1 ] && grep -q "did not return JSON" <<<"$out" && ! pushed' 'status without JSON → STOP'
fresh; export FAKE_STATUS=fail; run
ok '[ $rc = 1 ] && grep -q "STOP: clasp status --json failed" <<<"$out" && ! pushed' 'status error → STOP'
fresh; export FAKE_PUSH=fail; run
ok '[ $rc = 1 ] && grep -q "STOP: clasp push --force failed" <<<"$out" && [ "$(grep -v "^logout$" "$FAKE_LOG" | tail -1)" = "push --force" ]' 'push error → STOP at push, no verify pull after it'
ok '[ -z "$(ls -A "$W/tmp")" ]' 'STOP inside a clasp step still removes every temporary folder'
fresh; export FAKE_PUSH=noop; run
ok '[ $rc = 1 ] && grep -q "MISMATCH" <<<"$out" && grep -q "live script differs" <<<"$out"' 'push that changed nothing → MISMATCH'
fresh; export FAKE_PUSH=badmanifest; run
ok '[ $rc = 1 ] && grep -q "appsscript.json differs" <<<"$out"' 'live manifest differs after push → MISMATCH'
fresh; run; mkdir -p "$LIVE/lib"; echo "x" > "$LIVE/lib/Evil.js"; : > "$FAKE_LOG"; run -DryRun
ok '[ $rc = 1 ] && grep -q "lib/Evil.js" <<<"$out" && ! pushed' 'extra script in a live subfolder → MISMATCH (dry run)'
fresh; run; cp "$LIVE/App.js" "$LIVE/Code.js"; run -DryRun
ok '[ $rc = 1 ] && grep -q "expected one script" <<<"$out"' 'second live script → MISMATCH'
fresh; run -DryRun
ok '[ $rc = 1 ] && grep -q "a deploy would change it" <<<"$out" && ! pushed' 'dry run, live is old → MISMATCH, no upload'
fresh; run; : > "$FAKE_LOG"; run -DryRun
ok '[ $rc = 0 ] && grep -q "LIVE MATCHES v$VER" <<<"$out" && ! pushed' 'dry run after deploy → LIVE MATCHES, no upload'
fresh; sed -i 's#"oauthScopes": \[\]#"oauthScopes": ["https://mail.google.com/"]#' "$LIVE/appsscript.json"; grep -q 'mail.google.com' "$LIVE/appsscript.json" || echo "FAIL could not change the live scopes (template appsscript.json changed shape)"; run
ok '[ $rc = 0 ] && grep -q "SCOPES CHANGED: open the Apps Script editor, run health()" <<<"$out"' 'oauthScopes differ from live → SCOPES CHANGED notice (app: run health())'
fresh; run
ok '! grep -q "SCOPES CHANGED" <<<"$out"' 'same scopes → no notice'
fresh; echo "{ not json" > "$LIVE/appsscript.json"; run
ok '[ $rc = 0 ] && grep -q "SCOPES CHANGED" <<<"$out"' 'unreadable live manifest → deploys, announces scopes (never guesses)'
fresh; echo "{ not json" > "$LIVE/appsscript.json"; run -DryRun
ok '[ $rc = 1 ] && grep -q "not valid JSON" <<<"$out" && ! grep -q "Conversion from JSON" <<<"$out" && [ -z "$(ls -A "$W/tmp")" ] && ! pushed' 'unreadable live manifest, dry run → MISMATCH (no crash, temps removed)'
fresh; export FAKE_PULL=fail-after-push; run
ok '[ $rc = 1 ] && grep -q "UPLOADED, live state UNVERIFIED" <<<"$out"' 'verify download fails after upload → says UPLOADED, UNVERIFIED'
fresh notag; (cd "$W/r"; sed -i "s/const VERSION = '[^']*';/const VERZION = 'x';/" App.gs; git commit -qam nover; git push -q origin main 2>/dev/null); run
ok '[ $rc = 1 ] && grep -q "no VERSION" <<<"$out" && ! pushed' 'no VERSION line → STOP'
fresh notag; (cd "$W/r"; git rm -q .gitattributes; sed -i 's/$/\r/' App.gs; git -c core.autocrlf=false add -A; git -c core.autocrlf=false commit -qm crlf; git push -q origin main 2>/dev/null); tagit; run
ok '[ $rc = 1 ] && grep -q "Windows line endings" <<<"$out" && ! pushed' 'CRLF in the commit → STOP'
fresh; export FAKE_STATUS=swap; run
ok '[ $rc = 1 ] && grep -q "would upload \[appsscript.json, Code.gs\]" <<<"$out" && ! pushed' 'clasp would upload a different file, same count → STOP'
fresh; run; mkdir -p "$LIVE/lib"; mv "$LIVE/App.js" "$LIVE/lib/"; run -DryRun
ok '[ $rc = 1 ] && grep -q "expected one script" <<<"$out"' 'live script in a subfolder, manifest at root → MISMATCH'
fresh; export clasp_config_auth=/tmp/other; run; unset clasp_config_auth
ok '[ $rc = 1 ] && grep -q "clasp_config_auth would redirect" <<<"$out" && ! pushed' 'clasp_config_auth env var → STOP'
fresh; (cd "$W/r"; echo Extra.js >> .git/info/exclude; echo "x" > Extra.js); run
ok '[ $rc = 0 ] && grep -q DEPLOYED <<<"$out" && [ ! -e "$LIVE/Extra.js" ]' 'git-ignored extra script in working folder is NOT uploaded'
fresh; (cd "$W/r"; git update-index --assume-unchanged App.gs; sed -i "s/const VERSION = '[^']*';/const VERSION = '9.9.9';/" App.gs); run
ok '[ $rc = 0 ] && grep -q "DEPLOYED v$VER" <<<"$out"' 'VERSION is read from the commit, not the working folder'
fresh; export FAKE_STATUS=fail; run
ok '[ $rc = 1 ] && grep -q "something broke" <<<"$out"' 'status error → clasp stderr shown'
# ---- 3.7.9: clasp version pin, logout after every run, one-command release
loggedout(){ [ "$(tail -1 "$FAKE_LOG")" = "logout" ] && grep -q "clasp: logged out" <<<"$out"; }
fresh; run
ok '[ $rc = 0 ] && loggedout' 'deploy → clasp logout is the last clasp call'
fresh; export FAKE_PUSH=fail; run
ok '[ $rc = 1 ] && loggedout' 'STOP inside a clasp step → still logged out'
fresh; echo x >> "$W/r/App.gs"; run
ok '[ $rc = 1 ] && loggedout' 'STOP before any clasp project step → still logged out'
fresh; run -DryRun
ok 'loggedout && ! pushed' 'dry run → logged out, no upload'
fresh; export FAKE_VERSION=3.5.0; run
ok '[ $rc = 1 ] && grep -q "tested with 3.4.1 only" <<<"$out" && ! pushed && ! grep -q "^status" "$FAKE_LOG"' 'clasp 3.5.0 → STOP before any project step'
fresh; export FAKE_VERSION='3.4.1-beta'; run
ok '[ $rc = 1 ] && grep -q "tested with 3.4.1 only" <<<"$out" && ! pushed' 'clasp 3.4.1-beta → STOP'
fresh notag; run -Release "$(git -C "$W/r" rev-parse HEAD)"
ok '[ $rc = 0 ] && grep -q "created and pushed" <<<"$out" && grep -q "DEPLOYED v$VER" <<<"$out" && [ "$(git -C "$W/origin.git" for-each-ref --format="%(objecttype) %(*objectname)" refs/tags/release/v$VER)" = "tag $(git -C "$W/r" rev-parse HEAD)" ]' '-Release <sha> → annotated tag created on GitHub on that commit, deployed'
fresh; run -Release "$(SHA)"
ok '[ $rc = 0 ] && grep -q "already on GitHub" <<<"$out" && grep -q DEPLOYED <<<"$out"' '-Release on an already-tagged commit (short sha) → reuses the tag, deploys'
fresh notag; (cd "$W/r"; P=$(git rev-parse HEAD); echo "// v2" >> App.gs; git commit -qam v2; git push -q origin main 2>/dev/null; echo "$P" > "$W/prev"); run -Release "$(cat "$W/prev")"
ok '[ $rc = 1 ] && grep -q "is not HEAD/origin/main" <<<"$out" && ! pushed && [ -z "$(git -C "$W/origin.git" tag)" ]' '-Release with an older commit → STOP, no tag, no upload'
fresh notag; (cd "$W/r"; git tag -a "release/v$VER" -m old HEAD; git push -q origin "release/v$VER" 2>/dev/null; echo "// v2" >> App.gs; git commit -qam v2; git push -q origin main 2>/dev/null; git tag -d "release/v$VER" >/dev/null); run -Release "$(SHA)"
ok '[ $rc = 1 ] && grep -q "release/v$VER already exists" <<<"$out" && grep -q "another commit" <<<"$out" && ! pushed && [ "$(git -C "$W/origin.git" rev-list -n1 release/v$VER)" != "$(git -C "$W/r" rev-parse HEAD)" ]' '-Release when GitHub has the tag on another commit → STOP, tag not moved'
fresh notag; run -Release deadbeefcafe
ok '[ $rc = 1 ] && grep -q "is not in this repo" <<<"$out" && ! pushed' '-Release with an unknown commit → STOP'
fresh notag; run -Release 'HEAD~0'
ok '[ $rc = 1 ] && grep -q "needs the tested commit ID" <<<"$out" && ! pushed' '-Release with a non-hex ref → STOP'
fresh; run -Release "$(SHA)" -DryRun
ok '[ $rc = 1 ] && grep -q "together" <<<"$out" && ! pushed' '-Release with -DryRun → STOP'
# ---- deploy review 2026-10-21 (PowerShell + git + clasp experts): X1-X5, X7
fresh notag; (cd "$W/r"; echo '{bad' > appsscript.json; git commit -qam badman; git push -q origin main 2>/dev/null); run -DryRun
ok '[ $rc != 0 ] && [ "$(tail -1 "$FAKE_LOG")" = "logout" ]' 'an error the script does not catch (bad manifest) → still logged out (try/finally)'
# 3.9.8: owner toggle KEEP_CLASP_LOGIN=1 keeps the login (exact value only)
fresh; export KEEP_CLASP_LOGIN=1; run
ok '[ $rc = 0 ] && ! grep -q "^logout$" "$FAKE_LOG" && grep -q "clasp: login KEPT (KEEP_CLASP_LOGIN=1" <<<"$out" && grep -q "DEPLOYED v$VER" <<<"$out"' 'KEEP_CLASP_LOGIN=1 → deploys, no clasp logout, says the login was kept'
fresh; export KEEP_CLASP_LOGIN=1; (cd "$W/r"; echo x >> App.gs); run
ok '[ $rc = 1 ] && ! grep -q "^logout$" "$FAKE_LOG" && grep -q "login KEPT" <<<"$out"' 'KEEP_CLASP_LOGIN=1 + a STOP → still no logout, still says so'
fresh; export KEEP_CLASP_LOGIN=yes; run
ok '[ $rc = 0 ] && [ "$(tail -1 "$FAKE_LOG")" = "logout" ] && grep -q "KEEP_CLASP_LOGIN=.yes. is not 1 - ignored" <<<"$out"' 'any value other than 1 → warned and logged out as before'
fresh; export FAKE_LOGOUT=fail; run
ok '! grep -q "clasp: logged out" <<<"$out" && grep -q "WARNING: clasp logout failed" <<<"$out"' 'failed logout is reported as failed, not as logged out'
fresh notag; printf '#!/bin/bash\nwhile read o n r; do case $r in refs/tags/*) echo "GH013: Repository rule violations found for $r"; exit 1;; esac; done\n' > "$W/origin.git/hooks/pre-receive"; chmod +x "$W/origin.git/hooks/pre-receive"
H=$(git -C "$W/r" rev-parse HEAD); run -Release "$H"
ok '[ $rc = 1 ] && grep -q "the tag was not pushed" <<<"$out" && ! pushed && loggedout' 'GitHub rejects the tag push → STOP, nothing uploaded, logged out'
rm -f "$W/origin.git/hooks/pre-receive"; : > "$FAKE_LOG"; run -Release "$H"
ok '[ $rc = 0 ] && grep -q "created and pushed" <<<"$out" && grep -q DEPLOYED <<<"$out"' 'rerun with the leftover local tag → pushes it, deploys'
fresh notag; (cd "$W/r"; sed -i 's/"scriptId": *"[^"]*"/"scriptId":"OTHER"/' .clasp.json; git commit -qam other; git push -q origin main 2>/dev/null); run -Release "$(SHA)"
ok '[ $rc = 1 ] && grep -q "not the pinned live project" <<<"$out" && [ -z "$(git -C "$W/origin.git" tag)" ]' '-Release on a commit naming another project → STOP before any tag is made'
fresh notag; (cd "$W/r"; git tag "release/v$VER"; git push -q origin "release/v$VER" 2>/dev/null; git tag -d "release/v$VER" >/dev/null); run -Release "$(SHA)"
ok '[ $rc = 1 ] && ! pushed' 'lightweight tag on GitHub on HEAD → STOP, no upload'
fresh notag; run -Release 1234e10
ok '[ $rc = 1 ] && grep -q "commit 1234e10 is not in this repo" <<<"$out"' '-Release 1234e10 is kept as text (not parsed as a number)'
# ---- the template ships unpinned
fresh nopin; run
ok '[ $rc = 1 ] && grep -q "has no pinned scriptId" <<<"$out" && ! pushed' 'unpinned project (as the template ships) → STOP, no upload'
fresh nopin; run -Release "$(SHA)"
ok '[ $rc = 1 ] && grep -q "has no pinned scriptId" <<<"$out" && ! pushed && [ -z "$(git -C "$W/origin.git" tag)" ] && [ -z "$(git -C "$W/r" tag)" ]' 'unpinned project + -Release → STOP before any tag (none on GitHub or local), no upload'
# ---- a second project row (MailToDrive 3.9.3: one pin, bundle, manifest, .clasp.json and tag prefix per project; flattened stage)
SPIN=1SecondProjectTestPinXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX; SLIVE="$W/live/$SPIN"
sfresh(){ fresh notag; mkdir -p "$SLIVE"; cd "$W/r"; mkdir -p second
  printf "const VERSION = '0.1.0';\nfunction probe() { return 1; }\n" > second/Second.gs
  printf '{"timeZone":"America/Los_Angeles","runtimeVersion":"V8","oauthScopes":["https://www.googleapis.com/auth/gmail.readonly"]}\n' > second/appsscript.json
  printf '{"scriptId":"%s","rootDir":""}\n' "$SPIN" > second/.clasp.json
  ROW="  'second' = @{ Pin = '$([ "$1" = nopin ] || echo "$SPIN")'; Bundle = 'second/Second.gs'; Manifest = 'second/appsscript.json'; Clasp = 'second/.clasp.json'; TagPrefix = 'release/second-v' }"
  sed -i "/^  'app' = @{/a\\$ROW" deploy.ps1
  grep -qF "$ROW" deploy.ps1 || echo "FAIL sfresh could not add the second project row (deploy.ps1 project table changed shape)"
  git add -A; git commit -qm second; git push -q origin main 2>/dev/null
  [ "$2" = notag ] || { git tag -a release/second-v0.1.0 -m second; git push -q origin release/second-v0.1.0 2>/dev/null; }
  printf "const VERSION = '0.0.1';\n" > "$SLIVE/Code.js"; : > "$FAKE_LOG"; }
sfresh nopin; run -Project second
ok '[ $rc = 1 ] && grep -q "has no pinned scriptId" <<<"$out" && ! pushed' '-Project second before it is pinned → STOP, no upload'
sfresh; run -Project second
ok '[ $rc = 0 ] && grep -q "SCOPES CHANGED: open the second project.s editor, run any function once" <<<"$out" && ! grep -q "health()" <<<"$out"' '-Project second: the SCOPES CHANGED notice names no health() or schedule'
ok '[ $rc = 0 ] && grep -q "DEPLOYED second v0.1.0 = commit $(SHA)" <<<"$out" && cmp -s <(tr -d "\r" < "$SLIVE/Second.js") "$W/r/second/Second.gs" && cmp -s <(tr -d "\r" < "$SLIVE/appsscript.json") "$W/r/second/appsscript.json" && [ ! -e "$SLIVE/Code.js" ] && [ ! -e "$LIVE/Second.js" ]' '-Project second: uploads second/Second.gs + its manifest to the second project only, DEPLOYED second v0.1.0'
ok 'grep -q "checks OK: second v0.1.0" <<<"$out" && grep -q "uploads appsscript.json + Second.gs\|uploads Second.gs + appsscript.json" <<<"$out"' '-Project second: clasp sees exactly the flattened 2 files'
sfresh x notag; (cd "$W/r"; git tag -a release/v0.1.0 -m wrong; git push -q origin release/v0.1.0 2>/dev/null); run -Project second
ok '[ $rc = 1 ] && grep -q "no annotated tag release/second-v0.1.0" <<<"$out" && ! pushed' "-Project second needs release/second-v<VERSION> (the app's tag prefix does not count)"
sfresh x notag; run -Project second -Release "$(git -C "$W/r" rev-parse HEAD)"
ok '[ $rc = 0 ] && grep -q "tag release/second-v0.1.0 on commit .*created and pushed" <<<"$out" && [ "$(git -C "$W/origin.git" for-each-ref --format="%(objecttype)" refs/tags/release/second-v0.1.0)" = tag ] && [ -z "$(git -C "$W/origin.git" tag -l release/v0.1.0)" ]' '-Project second -Release creates release/second-v0.1.0 only'
sfresh; (cd "$W/r"; printf '{"scriptId":"%s","rootDir":""}\n' "$PIN" > second/.clasp.json; git commit -qam swap; git push -q origin main 2>/dev/null; git tag -d release/second-v0.1.0 >/dev/null; git push -q origin :refs/tags/release/second-v0.1.0 2>/dev/null; git tag -a release/second-v0.1.0 -m c; git push -q origin release/second-v0.1.0 2>/dev/null); run -Project second
ok '[ $rc = 1 ] && grep -q "second/.clasp.json names project .*not the pinned live project" <<<"$out" && ! pushed' "second/.clasp.json naming the app's project → STOP"
sfresh nopin notag; (cd "$W/r"; sed -i "s/Pin = ''; Bundle = 'second/Pin = '$PIN'; Bundle = 'second/" deploy.ps1; printf '{"scriptId":"%s","rootDir":""}\n' "$PIN" > second/.clasp.json; git commit -qam samepin; git push -q origin main 2>/dev/null; git tag -a release/second-v0.1.0 -m c; git push -q origin release/second-v0.1.0 2>/dev/null); run -Project second
ok '[ $rc = 1 ] && grep -q "same pinned scriptId as another project" <<<"$out" && ! pushed && grep -q "^const VERSION" "$LIVE/Code.js"' 'second project pinned to the app'"'"'s scriptId in BOTH deploy.ps1 and second/.clasp.json → STOP, app untouched'
sfresh; run -Project Bogus
ok '[ $rc = 1 ] && grep -q "\-Project .bogus. is not one of: app, second" <<<"$out" && ! pushed' '-Project with an unknown name → STOP'
sfresh; run
ok '[ $rc = 1 ] && grep -q "no annotated tag release/v$VER" <<<"$out" && ! [ -e "$LIVE/Second.js" ]' 'default project is still app (its own tag rule), never the second project files'
# MailToDrive 3.10.0 (template review L3): a project row must have its own one-segment tag prefix
sfresh; (cd "$W/r"; sed -i "s#TagPrefix = 'release/second-v'#TagPrefix = 'release/v'#" deploy.ps1; git commit -qam sameprefix; git push -q origin main 2>/dev/null); run -Project second
ok '[ $rc = 1 ] && grep -q "same TagPrefix as another project" <<<"$out" && ! pushed' 'second row sharing the app tag prefix → STOP, no upload'
sfresh; (cd "$W/r"; sed -i "s#TagPrefix = 'release/second-v'#TagPrefix = 'release/second/v'#" deploy.ps1; git commit -qam badprefix; git push -q origin main 2>/dev/null); run -Project second
ok '[ $rc = 1 ] && grep -q "is not release/v or release/<name>-v" <<<"$out" && ! pushed' 'a tag prefix with a second path segment → STOP, no upload'
EXPECTED=79
echo; echo "$pass passed, $fail failed"
[ $n = $EXPECTED ] || { echo "FAIL test count $n != $EXPECTED (a scenario was skipped or added without updating EXPECTED)"; exit 1; }
[ $fail = 0 ]

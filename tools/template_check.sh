#!/bin/bash
# Check the template itself: run its runall in a scratch git copy, set up the way a new project's first branch would be.
# Usage: tools/template_check.sh   (FULL=1 tools/template_check.sh for the release run; PWSH=<pwsh> runs the deploy suite)
# Why a scratch copy: an unfilled template has no first commit for the workflow-review trigger yet
# (tests/workflow_review.json, README § Start a project, step 4), and on main runall fails that GUARD on purpose. The copy is
# set up the way a new project's repository is after steps 3 and 4: placeholder script IDs in deploy.ps1 and .clasp.json, so
# the deploy suite tests a pinned project, and a second commit of its own that sets last_review_commit to the first.
# The copy is on the same branch as this checkout (L108): on main, runall's main-only GUARDs (a (dev) CHANGELOG date, an
# unset review commit) apply to the template's own main. A checkout with no branch name (detached HEAD) uses template-check.
# GITHUB_REF_NAME is unset for the inner run (L79); the copy's own branch carries the name.
# A project created from the template runs ./runall.sh directly (.github/workflows/tests.yml picks the mode).
# Prints the inner runall's output and exits with its exit code. The copy is deleted afterwards.
D=$(cd "$(dirname "$0")/.." && pwd)
TP=$(mktemp -d "${TMPDIR:-/tmp}/template-check.XXXXXX") || { echo "template_check: FAIL could not make a scratch folder"; exit 2; }
trap 'rm -rf "$TP"' EXIT
(cd "$D" && git ls-files -z | tar --null -T - -cf -) | tar -xf - -C "$TP" || { echo "template_check: FAIL could not copy the tracked files"; exit 2; }
sed -i "s/^\$PinnedScriptId = '[^']*'/\$PinnedScriptId = '1TemplateCheckPinXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'/" "$TP/deploy.ps1"
sed -i 's/"scriptId": *"[^"]*"/"scriptId": "1TemplateCheckPinXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"/' "$TP/.clasp.json"
if ! { grep -q "^\$PinnedScriptId = '1TemplateCheckPin" "$TP/deploy.ps1" && grep -q '"scriptId": "1TemplateCheckPin' "$TP/.clasp.json"; }; then
  echo "template_check: FAIL the placeholder pin did not take in deploy.ps1 or .clasp.json"; exit 2; fi
BR=${GITHUB_REF_NAME:-$(git -C "$D" rev-parse --abbrev-ref HEAD 2>/dev/null)}
if [ "$BR" = HEAD ] || ! git check-ref-format --branch "$BR" >/dev/null 2>&1; then BR=template-check; fi
(cd "$TP" && git init -q -b "$BR" && git add -A && git -c user.email=t@t.invalid -c user.name=t commit -qm template) >/dev/null 2>&1 \
  || { echo "template_check: FAIL could not make the scratch git copy"; exit 2; }
FIRST=$(git -C "$TP" rev-parse HEAD)
sed -i "s/\"last_review_commit\": *\"[^\"]*\"/\"last_review_commit\": \"$FIRST\"/" "$TP/tests/workflow_review.json"
grep -q "\"last_review_commit\": \"$FIRST\"" "$TP/tests/workflow_review.json" \
  || { echo "template_check: FAIL could not set last_review_commit in the scratch copy"; exit 2; }
(cd "$TP" && git add -A && git -c user.email=t@t.invalid -c user.name=t commit -qm 'review record: first commit') >/dev/null 2>&1 \
  || { echo "template_check: FAIL could not commit the review record in the scratch copy"; exit 2; }
echo "template_check: scratch copy of $(cd "$TP" && git ls-files | wc -l) tracked files on branch $BR (placeholder script IDs; last_review_commit = its first commit)"
(cd "$TP" && env -u GITHUB_REF_NAME ./runall.sh)

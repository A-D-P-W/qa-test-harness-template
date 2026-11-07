#!/bin/bash
# Check the template itself: run its runall in a scratch git copy, set up the way a new project's first branch would be.
# Usage: tools/template_check.sh   (FULL=1 tools/template_check.sh for the release run; PWSH=<pwsh> runs the deploy suite)
# Why a scratch copy: on main, an unfilled template fails two runall GUARDs on purpose. The CHANGELOG is dated (dev), and
# tests/workflow_review.json has no first commit yet (README § Start a project, steps 2 and 4). A project created from
# the template fills both in, and its CI then runs ./runall.sh directly (.github/workflows/tests.yml picks the mode).
# The copy gets placeholder script IDs in deploy.ps1 and .clasp.json, so the deploy suite tests a pinned project, as it
# would in a real one. GITHUB_REF_NAME is unset for the inner run: CI's branch name is not the copy's branch (L79).
# Prints the inner runall's output and exits with its exit code. The copy is deleted afterwards.
D=$(cd "$(dirname "$0")/.." && pwd)
TP=$(mktemp -d "${TMPDIR:-/tmp}/template-check.XXXXXX") || { echo "template_check: FAIL could not make a scratch folder"; exit 2; }
trap 'rm -rf "$TP"' EXIT
(cd "$D" && git ls-files -z | tar --null -T - -cf -) | tar -xf - -C "$TP" || { echo "template_check: FAIL could not copy the tracked files"; exit 2; }
sed -i "s/^\$PinnedScriptId = '[^']*'/\$PinnedScriptId = '1TemplateCheckPinXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'/" "$TP/deploy.ps1"
sed -i 's/"scriptId": *"[^"]*"/"scriptId": "1TemplateCheckPinXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"/' "$TP/.clasp.json"
grep -q "^\$PinnedScriptId = '1TemplateCheckPin" "$TP/deploy.ps1" && grep -q '"scriptId": "1TemplateCheckPin' "$TP/.clasp.json" \
  || { echo "template_check: FAIL the placeholder pin did not take in deploy.ps1 or .clasp.json"; exit 2; }
(cd "$TP" && git init -q -b template-check && git add -A && git -c user.email=t@t.invalid -c user.name=t commit -qm template) >/dev/null 2>&1 \
  || { echo "template_check: FAIL could not make the scratch git copy"; exit 2; }
echo "template_check: scratch copy of $(cd "$TP" && git ls-files | wc -l) tracked files on branch template-check"
(cd "$TP" && env -u GITHUB_REF_NAME ./runall.sh)

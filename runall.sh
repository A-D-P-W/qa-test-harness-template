#!/bin/bash
# Run every QA suite against the committed root bundle (deploy/*.files, the project with @out at the repo root) and print
# one verdict. Usage: ./runall.sh   (FULL=1 ./runall.sh before a release)   Output: one line per suite, every problem, VERDICT.
# Ported from MailToDrive runall.sh.
# Allowed failures: tests/expected_deployed.txt (deployed design) and tests/known_open.txt (open bugs + fix version).
# Each entry is "<suite> | <exact failure line>"; an entry that matches nothing fails the run (stale).
# Guards (tests/LESSONS.md): every suite runs and passes something, every tests/v*.test.js runs, the current VERSION has
# a test file, no clock-offset time bombs, no two suites with identical results, RISK lines count like failures,
# no stale allowance entries, no exact-VERSION asserts, a suite exiting >1 is a crash, no test-looking file left unrun.
# Writes out/ (untracked; safe to delete).
D=$(cd "$(dirname "$0")" && pwd); O=${MTD_OUT:-$D/out}
case "$O" in "$D/out"|"$D/out/"*) ;; *) echo "runall: MTD_OUT must be inside $D/out (got '$O')"; exit 2 ;; esac   # M100: nested clock-ahead run
export TZ=${TZ:-America/Los_Angeles}
rm -rf -- "${O:?}"; mkdir -p "$O"; : > "$O/_fails.txt"; : > "$O/_suites.txt"
sum(){ local rc=${3:-$?}; echo "$1" >> "$O/_suites.txt"; echo "== $1: PASS=$(grep -cE '^ *PASS' "$2") FAIL=$(grep -cE '^ *(FAIL|BUG|LEAK) ' "$2") RISK=$(grep -c '^ *RISK' "$2")$([ "$rc" -gt 1 ] && echo '  CRASHED')"
       grep -E '^ *(FAIL|BUG|LEAK|RISK) ' "$2" | sed "s/^ */[$1] /" >> "$O/_fails.txt"
       grep -qE '^(Error|.*Error:|node:internal)' "$2" && echo "[$1] FAIL suite crashed: $(grep -m1 -E 'Error' "$2")" >> "$O/_fails.txt"
       [ "$rc" -gt 1 ] && echo "[$1] FAIL suite crashed: exit $rc" >> "$O/_fails.txt"
       [ "$rc" = 1 ] && ! grep -qE '^ *(FAIL|BUG|LEAK|RISK) ' "$2" && echo "[$1] FAIL suite exited 1 with no FAIL line" >> "$O/_fails.txt"; true; }
# FULL: 1 = release run; unset or 0 = normal run; anything else stops.
case "${FULL:-}" in ""|0) FULL="" ;; 1) ;; *) echo "runall: FULL must be 1, 0 or unset (got '$FULL')"; exit 2 ;; esac
# The root project (@out without a folder) and every other project (@out <dir>/<File>.gs), from deploy/*.files.
MTD_ROOT="$D" node -e "require(process.env.MTD_ROOT + '/tools/projects.js').projects(process.env.MTD_ROOT).forEach(p => console.log(p.name + ' ' + (p.out.includes('/') ? p.out.split('/')[0] : '.') + ' ' + p.out + ' ' + p.own[p.own.length - 1]))" > "$O/_projects.txt" 2> "$O/_projects.err" || { echo "[projects] FAIL tools/projects.js could not read deploy/*.files: $(head -c 200 "$O/_projects.err")" >> "$O/_fails.txt"; : > "$O/_projects.txt"; }
read -r _RN _RD B _RS < <(grep -E '^[A-Za-z]+ \. ' "$O/_projects.txt")
[ -n "$B" ] || { echo "[projects] FAIL no project builds at the repo root (deploy/*.files @out <File>.gs)" >> "$O/_fails.txt"; B=App.gs; }
F=$D/$B; export MTD_GS=$F
echo "-- suites ($B)"
# Type check against @types/google-apps-script (pinned; tools cached; exit 3 = unavailable). Runs BEFORE the v* suites:
# it installs acorn, which the scope map and module GUARDs need (CI starts with no cache).
MTD_GS="$F" bash "$D/tests/typecheck/run.sh" > "$O/typecheck.txt" 2>&1; tcrc=$?
if [ "$tcrc" = 3 ]; then echo "== typecheck: SKIPPED ($(head -1 "$O/typecheck.txt"))"; [ -n "$FULL" ] && echo "[typecheck] FAIL suite not run: FULL=1 (release) needs the type check" >> "$O/_fails.txt"
else sum typecheck "$O/typecheck.txt" "$tcrc"; fi
for t in "$D"/tests/v[0-9]*.test.js; do [ -e "$t" ] || continue; n=$(basename "$t" .test.js); SRC="$F" node "$t" > "$O/$n.txt" 2>&1; sum "$n" "$O/$n.txt"; done
if command -v "${PWSH:-pwsh}" >/dev/null 2>&1; then bash "$D/tests/deploy.test.sh" > "$O/deploy.txt" 2>&1; sum deploy "$O/deploy.txt"
else echo "== deploy: SKIPPED (PowerShell not found as ${PWSH:-pwsh}; set PWSH=<path to pwsh> to run deploy.ps1 tests)"
     [ -n "$FULL" ] && echo "[deploy] FAIL suite not run: FULL=1 (release) needs PowerShell for tests/deploy.test.sh" >> "$O/_fails.txt"; fi
# Consumer-driven contract tests and the module GUARDs (a)(b)(c) — acorn comes with the type check tools
for t in "$D"/tests/contract/*.test.js; do [ -e "$t" ] || continue; n=contract.$(basename "$t" .test.js); node "$t" > "$O/$n.txt" 2>&1; sum "$n" "$O/$n.txt"; done
node "$D/tools/guards.js" > "$O/_guards.txt" 2>&1; grc=$?
if [ "$grc" = 3 ]; then echo "== guards: SKIPPED ($(head -1 "$O/_guards.txt"))"; [ -n "$FULL" ] && echo "[guards] FAIL module guards not run: FULL=1 (release) needs them" >> "$O/_fails.txt"
else echo "== guards: $(tail -1 "$O/_guards.txt")"; grep "^NOTICE" "$O/_guards.txt"
     if [ "$grc" != 0 ] && ! grep -q '^GUARD ' "$O/_guards.txt"; then echo "[guards] FAIL tools/guards.js exited $grc with no GUARD line (crash): $(tail -1 "$O/_guards.txt" | cut -c1-120)" >> "$O/_fails.txt"; fi; fi
# Every other project (@out <dir>/<File>.gs) runs its own suites, the scope map and the type check on its own bundle.
while read -r PN PDIR POUT _; do
  [ "$PDIR" = . ] && continue
  echo "-- project $PN ($POUT)"
  for t in "$D/$PDIR"/tests/*.test.js; do [ -e "$t" ] || continue; n=$PDIR.$(basename "$t" .test.js); SRC="$D/$POUT" MTD_GS="$D/$POUT" node "$t" > "$O/$n.txt" 2>&1; sum "$n" "$O/$n.txt"; done
  SRC="$D/$POUT" node "$D/tests/v368.test.js" > "$O/$PDIR.v368.txt" 2>&1; sum "$PDIR.v368" "$O/$PDIR.v368.txt"
  MTD_GS="$D/$POUT" bash "$D/tests/typecheck/run.sh" > "$O/$PDIR.typecheck.txt" 2>&1; tcrc=$?
  if [ "$tcrc" = 3 ]; then echo "== $PDIR.typecheck: SKIPPED"; [ -n "$FULL" ] && echo "[$PDIR.typecheck] FAIL suite not run: FULL=1 (release) needs the type check" >> "$O/_fails.txt"
  else sum "$PDIR.typecheck" "$O/$PDIR.typecheck.txt" "$tcrc"; fi
done < "$O/_projects.txt"
# M100 (seeded from MailToDrive L100): FULL reruns every suite with all clocks 90 days ahead (tools/clockahead.js), so a fixture with a
# fixed date that ages out of a lookback window fails here 90 days before it would fail for real.
if [ -n "$FULL" ] && [ -z "${MTD_CLOCK_AHEAD_DAYS:-}" ]; then
  (env -u PWSH -u FULL MTD_OUT="$O/clock90" MTD_CLOCK_AHEAD_DAYS=90 NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require $D/tools/clockahead.js" "$D/runall.sh") > "$O/_clock90_run.txt" 2>&1
  { grep -q '^VERDICT: PASS' "$O/_clock90_run.txt" && echo "PASS every suite passes with the clock 90 days ahead ($(grep -c '^== ' "$O/_clock90_run.txt") suites)"
    grep -E '^(UNEXPECTED|GUARD|STALE ENTRY|BAD ENTRY)|CRASHED' "$O/_clock90_run.txt" | sed 's/^/FAIL clock +90 days: /'
    grep -q '^VERDICT:' "$O/_clock90_run.txt" || echo "FAIL clock +90 days: runall printed no VERDICT"; } > "$O/clock90.txt"
  sum clock90 "$O/clock90.txt"
  # M101 (seeded from MailToDrive L101): and 365 days ahead. +90 alone missed fixtures that pass at +202 days and fail at +203
  # in the source project; the year horizon flags them a year early. Both stay: a year-boundary or DST failure can show at
  # one shift and not the other.
  (env -u PWSH -u FULL MTD_OUT="$O/clock365" MTD_CLOCK_AHEAD_DAYS=365 NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require $D/tools/clockahead.js" "$D/runall.sh") > "$O/_clock365_run.txt" 2>&1
  { grep -q '^VERDICT: PASS' "$O/_clock365_run.txt" && echo "PASS every suite passes with the clock 365 days ahead ($(grep -c '^== ' "$O/_clock365_run.txt") suites)"
    grep -E '^(UNEXPECTED|GUARD|STALE ENTRY|BAD ENTRY)|CRASHED' "$O/_clock365_run.txt" | sed 's/^/FAIL clock +365 days: /'
    grep -q '^VERDICT:' "$O/_clock365_run.txt" || echo "FAIL clock +365 days: runall printed no VERDICT"; } > "$O/clock365.txt"
  sum clock365 "$O/clock365.txt"
fi
# Verdict: every FAIL/BUG/LEAK/RISK line must equal an allowance entry; every entry must match; guards must hold.
python3 - "$O" "$D" <<'PY'
import sys, os, re, glob, hashlib, subprocess, json
O, D = sys.argv[1], sys.argv[2]
# newline='\n': a bare \r inside a FAIL line (Windows tool output) must not split it into a line with no [suite] (L102)
fails = [l.rstrip('\r\n').replace('\r', '\\r') for l in open(os.path.join(O, '_fails.txt'), encoding='utf-8', errors='replace', newline='\n') if l.strip()]
entries = []
for fn in ('expected_deployed.txt', 'known_open.txt'):
    p = os.path.join(D, 'tests', fn)
    for n, l in enumerate(open(p, encoding='utf-8') if os.path.exists(p) else [], 1):
        l = l.rstrip('\n')
        if not l.strip() or l.startswith('#'): continue
        body = l.split('  #')[0].rstrip()
        if ' | ' not in body: entries.append((fn, n, None, body)); continue
        suite, text = body.split(' | ', 1); entries.append((fn, n, suite.strip(), text))
bad, used = [], set()
for f in fails:
    m = re.match(r'^\[([^\]]+)\] (.*)$', f)
    if not m: bad.append('GUARD malformed line in the failure list (no [suite] prefix): ' + f[:200]); continue
    suite, text = m.group(1), m.group(2)
    hit = [i for i, e in enumerate(entries) if e[2] == suite and e[3] == text]
    if hit: used.update(hit)
    else: bad.append('UNEXPECTED ' + f)
for i, e in enumerate(entries):
    if e[2] is None: bad.append(f'BAD ENTRY {e[0]}:{e[1]} (need "<suite> | <exact line>"): {e[3]}')
    elif i not in used: bad.append(f'STALE ENTRY {e[0]}:{e[1]} matches no failure (now passing? remove it): {e[2]} | {e[3]}')
suites = [l.strip() for l in open(os.path.join(O, '_suites.txt')) if l.strip()]
for s in suites:
    t = open(os.path.join(O, s + '.txt'), encoding='utf-8', errors='replace').read()
    if not re.search(r'^ *PASS', t, re.M): bad.append(f'GUARD suite {s} passed nothing (did it run?)')
for t in glob.glob(os.path.join(D, 'tests', 'v[0-9]*.test.js')):
    n = os.path.basename(t)[:-8]
    if n not in suites: bad.append(f'GUARD {os.path.basename(t)} was not run')
# A test-looking file whose name the runner's glob misses is never run (MailToDrive L-f).
for t in os.listdir(os.path.join(D, 'tests')):
    if re.search(r'\.(m?js|cjs|sh|ts)$', t) and not re.match(r'v\d+\.test\.js$', t) and t not in ('deploy.test.sh',):
        bad.append(f'GUARD tests/{t} looks like a test but runall never runs it (rename to v<VERSION without dots>.test.js, e.g. v011, or move it)')
for t in glob.glob(os.path.join(D, 'tests', '*', '**', '*.test.js'), recursive=True):   # a test in a subfolder never runs
    r = os.path.relpath(t, D)
    if not re.match(r'tests/(archive|typecheck)/', r) and not re.match(r'tests/contract/[A-Za-z]+\.[a-z]+\.test\.js$', r): bad.append(f'GUARD {r} looks like a test in a subfolder that runall never runs')
_gf = os.path.join(O, '_guards.txt')
if os.path.exists(_gf): bad.extend(l.strip() for l in open(_gf, encoding='utf-8', errors='replace') if l.startswith('GUARD '))
for t in (os.listdir(os.path.join(D, 'tests', 'contract')) if os.path.isdir(os.path.join(D, 'tests', 'contract')) else []):   # contract dir: only <Module>.<consumer>.test.js + helpers
    if t not in ('load.js', '_h.js', '.gitkeep') and not re.match(r'[A-Z][A-Za-z]+\.[a-z]+\.test\.js$', t): bad.append(f'GUARD tests/contract/{t} is not <Module>.<consumer>.test.js (runall would not run it as a contract test)')
# The committed bundles must equal a fresh build of deploy/*.files (stale or hand-edited → FAIL)
_b = subprocess.run(['node', os.path.join(D, 'tools', 'bundle.js'), '--check'], capture_output=True, text=True)
if _b.returncode != 0:
    _st = [l for l in (_b.stdout + '\n' + _b.stderr).splitlines() if l.startswith('STALE') or 'Error' in l]
    bad.extend('GUARD ' + l[:200] for l in (_st or ['tools/bundle.js --check failed']))
CLOCK_OFF = re.compile(r'Date\.now\(\)\s*[-+]\s*(?!\s)(?![a-z_$][\w$]*\b(?!\s*[*.(\[]))(?!\d{1,4}(?![\d.eE])(?!\s*\*))')   # products, parens, CONSTANTS, big literals (MailToDrive L78)
bomb = re.compile(r'Date\.now\(\)\s*[-+]\s*\d+(\.\d+)?\s*\*\s*3600(e3|000)\b')
_projects = [l.split() for l in open(os.path.join(O, '_projects.txt')).read().split('\n') if l.strip()] if os.path.exists(os.path.join(O, '_projects.txt')) else []
_pdirs = [p[1] for p in _projects if p[1] != '.']
for _pd in _pdirs:   # every other project's tests/ folder gets the same hygiene scans and the unrun-file check
    for t in (os.listdir(os.path.join(D, _pd, 'tests')) if os.path.isdir(os.path.join(D, _pd, 'tests')) else []):
        if re.search(r'\.(m?js|cjs|sh|ts)$', t) and not re.match(r'v\d+\.test\.js$', t): bad.append(f'GUARD {_pd}/tests/{t} looks like a test but runall never runs it (rename to v<VERSION without dots>.test.js, e.g. v011, or move it)')
    for t in glob.glob(os.path.join(D, _pd, 'tests', '*', '**', '*.test.js'), recursive=True): bad.append(f'GUARD {os.path.relpath(t, D)} looks like a test in a subfolder that runall never runs')
for p in glob.glob(os.path.join(D, 'tests', '**', '*.js'), recursive=True) + [q for _pd in _pdirs for q in glob.glob(os.path.join(D, _pd, 'tests', '**', '*.js'), recursive=True)]:
    if '/archive/' in p or '/node_modules/' in p: continue
    _prev = ''
    for n, l in enumerate(open(p, encoding='utf-8', errors='replace'), 1):
        vt = re.match(r'v\d+\.test\.js$', os.path.basename(p)) or '/tests/contract/' in p
        # a linear-time ratio check (tb < K * Math.max(ts, F)) needs retried pairs (or interleaved samples) — MailToDrive L60
        if re.search(r'\btb\s*<\s*\d+\s*\*\s*Math\.max\(\s*ts', l) and not re.search(r'L60|interleaved', _prev + l) and vt: bad.append(f'GUARD single-attempt linear-time ratio (retry the pair up to 3 times, L60) {os.path.relpath(p, D)}:{n}')
        _prev = l
        # absolute limits (Date.now() - t < N, ms < N) without best-of-3 (MailToDrive L28)
        if (re.search(r'\b(tb|ts)\s*=\s*time\(', l) or (re.search(r'Date\.now\(\)\s*-\s*t\w*\s*<\s*\d{3,}|\bms\s*<\s*\d{3,}', l) and not re.search(r'best3|Math\.min', l))) and vt: bad.append(f'GUARD single-sample timing ratio (flaky under load; use min of 3) {os.path.relpath(p, D)}:{n}')
        # any clock offset but a small literal or an elapsed-time subtraction of a lowercase timer variable (MailToDrive L59/L78)
        if CLOCK_OFF.search(l) and 'clock-safe' not in l and vt: bad.append(f'GUARD relative clock offset may cross midnight (clamp it, or mark the line clock-safe with why, L59) {os.path.relpath(p, D)}:{n}')
        if bomb.search(l): bad.append(f'GUARD clock-offset time bomb (breaks at DST) {os.path.relpath(p, D)}:{n}')
        if re.search(r"\bVER(SION)?\b['\"]?\s*(?:[!=]==?|,)\s*['\"]\d+\.\d|['\"]\d+\.\d+\.\d+['\"]\s*[!=]==?\s*[\w.]*VER|VERSION = ['\"]\\?\d", l) and re.match(r'v\d+\.test\.js$', os.path.basename(p)): bad.append(f'GUARD exact-VERSION assertion (breaks at the next release) {os.path.relpath(p, D)}:{n}')
seen = {}
for s in suites:
    lines = sorted(l.strip() for l in open(os.path.join(O, s + '.txt'), encoding='utf-8', errors='replace') if re.match(r'^ *PASS', l))
    if len(lines) < 5: continue
    h = hashlib.sha256('\n'.join(lines).encode()).hexdigest()
    if h in seen: bad.append(f'GUARD suites {seen[h]} and {s} report identical results (duplicate suite?)')
    else: seen[h] = s
# L106: a count written by hand must equal the count of what it names. README "lists N mistake classes: A from the source
# project and B found here" is checked against tests/LESSONS.md rows (seeded: below L100 or M-numbered; this project's own: L100 and up).
_rd, _lf = os.path.join(D, 'README.md'), os.path.join(D, 'tests', 'LESSONS.md')
if os.path.exists(_lf):
    _rows = [(p, int(x)) for p, x in re.findall(r'^\| ([LM])(\d+) \|', open(_lf, encoding='utf-8').read(), re.M)]
    _own = sum(1 for p, x in _rows if p == 'L' and x >= 100)   # seeded: L below 100 and every M row (MailToDrive L100+, M100 on)
    if len(set(_rows)) != len(_rows): bad.append('GUARD tests/LESSONS.md numbers a lesson twice: ' + ', '.join('%s%d' % r for r in sorted(set(r for r in _rows if _rows.count(r) > 1))))
    for _m in re.finditer(r'lists\s+(\d+)\s+mistake\s+classes:\s+(\d+)\s+from\s+the\s+source\s+project\s+and\s+(\d+)\s+found\s+here', open(_rd, encoding='utf-8').read() if os.path.exists(_rd) else ''):
        if (int(_m.group(1)), int(_m.group(2)), int(_m.group(3))) != (len(_rows), len(_rows) - _own, _own):
            bad.append(f'GUARD README.md says {_m.group(1)} mistake classes ({_m.group(2)} seeded, {_m.group(3)} found here) but tests/LESSONS.md has {len(_rows)} rows ({len(_rows) - _own} seeded: below L100 or M-numbered, {_own} from L100 on)')
n_unexp = sum(1 for b in bad if b.startswith('UNEXPECTED'))
# The review trigger's thresholds and paths are fixed; changing them is a CLAUDE.md change, not a quiet edit
_w = json.load(open(os.path.join(D, 'tests', 'workflow_review.json')))
_WP = ['runall.sh', 'tests/', 'CLAUDE.md', 'appsscript.json', 'deploy.ps1', '.clasp.json', '.claspignore', '.gitattributes', '.gitignore', '.github/', 'tools/', 'deploy/', 'docs/', 'modules/']
if _w.get('threshold_commits') != 8 or _w.get('threshold_lines') != 400 or sorted(_w.get('paths', [])) != sorted(_WP): bad.append('GUARD tests/workflow_review.json thresholds/paths differ from runall (8 commits, 400 lines, fixed path list): change both together, with a CLAUDE.md note')
# Workflow-integrity review trigger (notice only) — tools/review_count.py
_rc = subprocess.run(['python3', os.path.join(D, 'tools', 'review_count.py'), D], capture_output=True, text=True)
print(_rc.stdout.rstrip())
if 'last_review_commit is not a commit' in _rc.stdout and (os.environ.get('GITHUB_REF_NAME') or subprocess.run(['git', '-C', D, 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True).stdout.strip()) == 'main':
    bad.append('GUARD tests/workflow_review.json last_review_commit is not a commit on main: set it to the first commit (README step 4) or the review trigger stays off')
if _rc.returncode != 0: bad.append(f'GUARD tools/review_count.py exited {_rc.returncode} (the review trigger is off): {(_rc.stderr.strip().splitlines() or [""])[-1][:120]}')
# Release rules for every project: a test file for its VERSION, VERSION == top CHANGELOG line, no (dev) date on main
_br = os.environ.get('GITHUB_REF_NAME') or subprocess.run(['git', '-C', D, 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True).stdout.strip()
for _pn, _pd, _po, _ps in _projects:
    _b = open(os.path.join(D, _po), encoding='utf-8').read() if os.path.exists(os.path.join(D, _po)) else ''
    _v = re.search(r"const VERSION = '([^']+)'", _b)
    if not _v: bad.append(f'GUARD {_po}: no VERSION line'); continue
    _vt = os.path.join(_pd, 'tests', 'v' + _v.group(1).replace('.', '') + '.test.js')
    if not os.path.exists(os.path.join(D, _vt)): bad.append(f'GUARD {_pn} VERSION {_v.group(1)} has no {os.path.normpath(_vt)}')
    _src = open(os.path.join(D, _ps), encoding='utf-8').read() if os.path.exists(os.path.join(D, _ps)) else ''
    _c = re.search(r"/\* CHANGELOG[^\n]*\n \* (\d+\.\d+\.\d+)\s+(\S+)", _src)
    if not _c: bad.append(f'GUARD {_ps}: no "/* CHANGELOG" block with a top "<version> <date>" line')
    elif _c.group(1) != _v.group(1): bad.append(f'GUARD {_pn} VERSION {_v.group(1)} != top CHANGELOG line {_c.group(1)} (every version gets its CHANGELOG entry)')
    elif _c.group(2) == '(dev)' and _br == 'main': bad.append(f'GUARD {_pn} CHANGELOG {_c.group(1)} is dated (dev) on main: replace it with the release date and rebuild the bundle (CLAUDE.md § Release)')
    elif _c.group(2) == '(dev)': print(f'NOTICE: {_pn} CHANGELOG {_c.group(1)} is dated (dev) — replace it with the release date before merging to main')
print(f"\nallowed (deployed design or known-open): {len(fails) - n_unexp}")
for b in bad: print(b)
print('VERDICT:', 'PASS - no regressions' if not bad else f'REGRESSION - {len(bad)} problem(s)')
sys.exit(1 if bad else 0)
PY

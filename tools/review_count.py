#!/usr/bin/env python3
"""Workflow-integrity review trigger (CLAUDE.md § Workflow-integrity review). Prints one line: a NOTICE when the review is
due, else the running count. Usage: tools/review_count.py <repo dir>
Counts commits touching the workflow paths since last_review_commit, excluding only the commits that change the
last_review_commit value and touch no other counted path (the review records); lines = lines ADDED by the counted
commits (3.9.0, workflow review 1a M1 + re-review).
M126 (seeded from MailToDrive L126, its 3.12.17): HEAD alone undercounts on a stale checkout (there, local main 11 commits
behind origin/main printed NOT DUE while the review was due). When HEAD does not contain origin/main (as of the last fetch),
the count also runs on origin/main, the result nearer its threshold decides, and a NOTICE says the checkout is stale or
diverged. A repository with no origin/main (tools/template_check.sh's scratch copy) counts on HEAD alone, as before.
Limit: a fetch that never ran is not detected."""
import json, os, subprocess, sys
D = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    w = json.load(open(os.path.join(D, 'tests', 'workflow_review.json')))
    base = w['last_review_commit']
    g = lambda *a: subprocess.run(['git', '-C', D] + list(a), capture_output=True, text=True).stdout
    anc = lambda a, b: subprocess.run(['git', '-C', D, 'merge-base', '--is-ancestor', a, b], capture_output=True).returncode == 0
    if g('rev-parse', '--verify', '-q', base + '^{commit}').strip():
        ps = list(w['paths']) + [':(exclude)tests/workflow_review.json']   # the review record itself never counts
        # A review record = a commit that CHANGES the last_review_commit value and touches no other counted path (re-review:
        # reformatting the line, or bundling fixes into the record commit, must not hide work from the count).
        def lrc(ref):
            try: return json.loads(g('show', ref + ':tests/workflow_review.json') or '{}').get('last_review_commit')
            except Exception: return None
        def count(tip):
            # 3.9.0 (workflow review 1a M1): count from last_review_commit. Only the commits that change the last_review_commit
            # value (the review records) are excluded — editing anything else in workflow_review.json no longer resets the count.
            recs = set()
            for c in g('log', '--format=%H', base + '..' + tip, '--', 'tests/workflow_review.json').split():
                if lrc(c) != lrc(c + '^') and not g('show', '--name-only', '--format=', c, '--', *ps).strip(): recs.add(c)
            commits = [c for c in g('rev-list', base + '..' + tip, '--', *ps).split() if c and c not in recs]
            lines = sum(int(a) for c in commits for a, b, *_ in (l.split('\t') for l in g('show', '--numstat', '--format=', c, '--', *ps).splitlines()) if a.isdigit())   # added lines only, per counted commit
            return len(commits), lines
        if not anc(base, 'HEAD'): print('NOTICE: last_review_commit is not an ancestor of HEAD - review state unknown, dispatch the workflow review')
        n, lines, where = *count('HEAD'), ''
        om = g('rev-parse', '--verify', '-q', 'refs/remotes/origin/main^{commit}').strip()
        if om and not anc(om, 'HEAD'):
            head = g('rev-parse', '--short', 'HEAD').strip()
            print(f'NOTICE: HEAD {head} does not contain origin/main {om[:7]} (stale checkout or diverged branch; fetch, then rebase or pull) - the count below is the larger of HEAD and origin/main')
            if anc(base, om):
                n2, l2 = count(om)
                share = lambda c, l: max(c / w['threshold_commits'], l / w['threshold_lines'])   # nearer its threshold = larger
                if share(n2, l2) > share(n, lines): n, lines, where = n2, l2, ' on origin/main'
        if n >= w['threshold_commits'] or lines >= w['threshold_lines']:
            print(f"NOTICE: WORKFLOW REVIEW DUE ({n} commits / {lines} changed lines in workflow files since {w['last_review_date']}{where}) - see CLAUDE.md")
        else: print(f"workflow changes since last review: {n}/{w['threshold_commits']} commits, {lines}/{w['threshold_lines']} lines{where}")
    else: print('NOTICE: tests/workflow_review.json last_review_commit is not a commit - set it to the last commit the next review covers (a new project: its first commit)')
except Exception as e: print('NOTICE: workflow review check failed:', e)

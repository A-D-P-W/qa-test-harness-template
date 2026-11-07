#!/usr/bin/env python3
"""Workflow-integrity review trigger (CLAUDE.md § Workflow-integrity review). Prints one line: a NOTICE when the review is
due, else the running count. Usage: tools/review_count.py <repo dir>
Counts commits touching the workflow paths since last_review_commit, excluding only the commits that change the
last_review_commit value and touch no other counted path (the review records); lines = lines ADDED by the counted
commits (3.9.0, workflow review 1a M1 + re-review)."""
import json, os, subprocess, sys
D = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    w = json.load(open(os.path.join(D, 'tests', 'workflow_review.json')))
    base = w['last_review_commit']
    g = lambda *a: subprocess.run(['git', '-C', D] + list(a), capture_output=True, text=True).stdout
    if g('rev-parse', '--verify', '-q', base + '^{commit}').strip():
        ps = list(w['paths']) + [':(exclude)tests/workflow_review.json']   # the review record itself never counts
        # 3.9.0 (workflow review 1a M1): count from last_review_commit. Only the commits that change the last_review_commit
        # value (the review records) are excluded — editing anything else in workflow_review.json no longer resets the count.
        if subprocess.run(['git', '-C', D, 'merge-base', '--is-ancestor', base, 'HEAD']).returncode != 0: print('NOTICE: last_review_commit is not an ancestor of HEAD - review state unknown, dispatch the workflow review')
        # A review record = a commit that CHANGES the last_review_commit value and touches no other counted path (re-review:
        # reformatting the line, or bundling fixes into the record commit, must not hide work from the count).
        def lrc(ref):
            try: return json.loads(g('show', ref + ':tests/workflow_review.json') or '{}').get('last_review_commit')
            except Exception: return None
        recs = set()
        for c in g('log', '--format=%H', base + '..HEAD', '--', 'tests/workflow_review.json').split():
            if lrc(c) != lrc(c + '^') and not g('show', '--name-only', '--format=', c, '--', *ps).strip(): recs.add(c)
        commits = [c for c in g('rev-list', base + '..HEAD', '--', *ps).split() if c and c not in recs]
        lines = sum(int(a) for c in commits for a, b, *_ in (l.split('\t') for l in g('show', '--numstat', '--format=', c, '--', *ps).splitlines()) if a.isdigit())   # added lines only, per counted commit
        if len(commits) >= w['threshold_commits'] or lines >= w['threshold_lines']:
            print(f"NOTICE: WORKFLOW REVIEW DUE ({len(commits)} commits / {lines} changed lines in workflow files since {w['last_review_date']}) - see CLAUDE.md")
        else: print(f"workflow changes since last review: {len(commits)}/{w['threshold_commits']} commits, {lines}/{w['threshold_lines']} lines")
    else: print('NOTICE: tests/workflow_review.json last_review_commit is not a commit - set it to the last commit the next review covers (a new project: its first commit)')
except Exception as e: print('NOTICE: workflow review check failed:', e)

# GitHub rulesets

Two repository rulesets, copied from the source project (MailToDrive) as its rulesets API returned them on
2026-10-22. Create them under Settings › Rules › Rulesets (or `POST /repos/<owner>/<repo>/rulesets`),
then re-read them after every release (CLAUDE.md § Release): both `active`, `bypass_actors` empty.

## main
```json
{
  "name": "main", "target": "branch", "enforcement": "active", "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_status_checks", "parameters": {
        "required_status_checks": [{ "context": "runall", "integration_id": 15368 }],
        "strict_required_status_checks_policy": false, "do_not_enforce_on_create": false } }
  ]
}
```
`integration_id` 15368 is GitHub Actions: every `runall` check-run on MailToDrive reports `app.slug=github-actions`,
`app.id=15368` [unverified as a constant for other accounts: re-read the ruleset after creating it].
The check context `runall` is the job id in `.github/workflows/tests.yml` (a job with no `name:` reports its id).

Apply the rulesets AFTER the first push to `main` has a successful `runall` check-run: the `main` ruleset requires it, and
`do_not_enforce_on_create: false` applies the check to creating the branch too. Rulesets are enforced "in public and private
repositories with GitHub Pro, GitHub Team, and GitHub Enterprise Cloud" and only "in public repositories with GitHub Free"
(https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

## release tags
```json
{
  "name": "release tags", "target": "tag", "enforcement": "active", "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/tags/release/*"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "update" } ]
}
```
A release tag is evidence only because the host makes it immutable (MailToDrive L15). `release/*` does not match a second
`/`, so a second project's tags are `release/<name>-v<VERSION>`, one path segment (L52).

# ADR-0001: Start from the project template

Status: Accepted (at project creation)
Template source: qa-test-harness-template at commit <sha> (fill in at creation; compare later templates against it)

## Context
MailToDrive (a private Apps Script project) worked out, under review, how an unattended Apps Script project is built, tested and
released safely. Its decisions that every project needs are recorded there: ADR-0002 (module contracts, consumer-driven
contract tests), ADR-0003 (modules shared by source), ADR-0008 (extraction order: parameterize in place, then move),
ADR-0009 (one committed bundle per project, checked against a fresh build).

## Decision
This project adopts them as they stand in the template: one committed bundle (`App.gs`), modules copied by source with their
CONTRACT.md, `deploy.ps1` as the only release path, `runall.sh` as the only verdict, `tests/LESSONS.md` seeded with
MailToDrive's project-independent lesson classes.

## Consequences
A change to a vendored module follows ADR-0002 (version row + ADR). Template updates are ported by hand: compare
this project with the template's current version and port what applies.

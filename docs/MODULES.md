# Modules

A module is `modules/<Name>/<Name>.gs` + `modules/<Name>/CONTRACT.md`. It declares functions and constants only, reads no
consumer globals, and calls only the services its contract lists (tools/guards.js GUARD (b), AST-checked). Every consumer
has a contract test `tests/contract/<Module>.<consumer>.test.js` that calls or member-accesses every export it uses and
never an Internal helper (GUARD (c)). A change to a module's code or contract API sections needs a new version row with
its sha256 (`node tools/guards.js --sha <Module>`) and an ADR (GUARD (a)).

## Vendoring a MailToDrive module (share by source, MailToDrive ADR-0003)
1. Copy `modules/<Name>/` from MailToDrive at a release tag (and its Depends-on modules); note the tag in a new ADR of this
   project that contains the exact bullet line `- <Name> <version>` (GUARD (a) looks for it).
2. In the copied CONTRACT.md: change the version row's ADR column to that ADR, and replace `## Consumers` with
   `- App — callers today: <functions>` (both are outside the hashed API sections, so the sha in the row stays valid).
3. Write the App code that calls the module first: GUARD (b) refuses a bundle that lists a module App does not use.
4. Add `<Name>` to `deploy/modules.order` (after its Depends-on modules) and to `deploy/app.files` before `src/App.main.gs`.
5. Copy MailToDrive's `tests/contract/load.js` and `_h.js` into `tests/contract/` (first module only; remove `.gitkeep`
   from the template's file list if you track it).
6. Write `tests/contract/<Name>.app.test.js` for the exports App uses; mutate the module once and see it fail (L37).
7. Add the module's services to `tests/v368.test.js` NEEDS if missing, and a row to ARCHITECTURE.md's registry naming the
   consumer `App`.
8. `node tools/bundle.js`; `node tools/guards.js` (expect `OK module guards: 1 modules`); `./runall.sh`.

## MailToDrive's modules (source project, private)
| Module | Purpose (from its CONTRACT.md) | Depends on |
|---|---|---|
| Text | Make untrusted strings safe for names, logs and HTML. | — |
| Hash | Stable hashes for names and content. | — |
| Dates | Date arithmetic and formatting. | — |
| SecurityNames | Fail-closed test of whether a name looks like security codes, recovery keys or secrets. | — |
| FileClassify | First-match-wins classification of a file from its metadata only (name, MIME type, times), against a consumer's rule table. | — |
| SheetRecords | Write rows that may hold untrusted text into a Google Sheet as plain text, never as formulas. | — |
| HtmlText | Turn untrusted HTML email bodies into plain text. | — |
| PdfSafety | Classify an untrusted PDF as safe, soft-flagged or hard-blocked, without rendering it. | — |
| SenderTrust | Decide whether an email's visible sender is authenticated by Google. | — |
| StateStore | One generic store for a JSON list across n script properties `<prefix>0..<prefix>n-1`, replacing the two copies of the pattern in MailToDrive (PINS_0..7, MOVELOG_0..7). | — |
| GmailScan | Page through a Gmail search with a resumable cursor; cache labels. | — |
| RunControl | Phase timing, runtime accounting, once-a-day alerts, private-sheet check. | Dates |
| DrivePrivacy | Refuse writes into Drive folders shared beyond the owner; list link-shared files under a set of root folders. | — |
| DriveFiles | Drive folder helpers: list children, find or create a subfolder (cached per run), a free file name, one folder's file metadata. | — |
| DigestRender | Formatting and link primitives for digest emails. | — |

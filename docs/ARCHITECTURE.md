# <Project name> — architecture and module registry

Status: created from the template. Decisions: `docs/adr/`. How modules are added: `docs/MODULES.md`.

## Projects (consumers)
| Project | Bundle | List | Tests |
|---|---|---|---|
| App | `App.gs` | `deploy/app.files` | `tests/v*.test.js`, `tests/contract/<Module>.app.test.js` |

## Module registry
| Module | Version | Consumers | Services | Scopes | Module-owned state | Host ctx members | Budget |
|---|---|---|---|---|---|---|---|
| <none yet> | | | | | | | |

Load / bundle order: `deploy/modules.order`, then the consumer's own file last.

## Host context (`ctx`)
<One row per ctx member a module reads: name, type, who creates it, lifetime (one run).>

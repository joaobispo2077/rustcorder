# Automatic Semantic Release Validation

Date: 2026-11-14. Implementation of
[feature 004](../specs/004-automated-semantic-release/tasks.md) is locally validated.
Hosted acceptance remains pending; the stored production policy is disabled.

## Preservation baseline

Work remains on feature/transcription-speaker-insights. Before implementation,
branch, HEAD, staged diff and hashes of all existing Git-visible files were
captured under ignored local build evidence. The transcription/speaker changes,
application source, workers, assets and their documentation are outside this change.
Commit creation waits for review of logical groups and explicit approval.

## Evidence ledger

- Requirements checklist: 16/16 complete before implementation.
- No extension hooks configured at implementation start.
- Existing ignore rules cover Rust/native output, Node dependencies, ignored build
  evidence, private audio/models and local secrets. CI tooling is private; no npm
  publication, Docker, Terraform, Helm, ESLint or Prettier setup is introduced.
- Initial support baseline had one Windows junction permission failure; its isolated
  publisher boundary rerun passed with the required filesystem permission. No code
  change was used to hide the environment limitation.
- Setup pins notes generator 14.1.1 and Angular 8.3.1 using locked CI dependencies;
  no lifecycle scripts or product Cargo changes. Fifteen synthetic semantic cases
  and four fixed-date notes snapshots were generated from the pinned reference.
- Foundation red checks failed on the missing automatic policy/record validators
  and isolated workflow-role support. After implementation, all 22 focused fixture,
  release-decision and workflow tests passed.
- Semantic/notes red checks demonstrated missing configured notes, footer keywords,
  linked heading support and explicit bootstrap. All four pinned notes snapshots
  subsequently passed. Regression work also binds proposal/preparation dates.
- The focused semantic, notes, preparation, proposal, release-decision and joined
  release-flow run passed after date binding. Historical plain-note preparation
  remains covered while automatic notes use the full Angular entry.
- Mutation and hosted results are not yet claimed.
- Production adoption remains disabled. No product version, changelog entry, tag,
  release, branch operation, commit or remote PR comment has been performed here.

## Hosted prerequisites

Owner clarification during implementation: use the configured origin and AVO's
`GH_TOKEN` secret naming convention; a new test repository is not being provisioned
by this task. Read-only checks returned no Rustcorder repository Actions secrets.
The workflow supports this owner-supplied token and the optional planned App.
No secret value is needed in chat or documentation. Configuration/permissions,
controller installation and compatible release rules still require owner setup.
Hosted synthetic release publication remains pending; origin is not scratch data.

Local reporter red tests demonstrated absent projection/controller/workflow support.
Projection, API/fork identity, pending/failed/incomplete overlays, numeric ownership,
lost POST, newer-run ordering, changed heads and forbidden delivery now pass in
isolated fixtures. Actual PR comments and latency have not been exercised.

Before hosted acceptance, verify default-main controller installation, existing
lifecycle refs/PR fixtures, compatible rules, GH_TOKEN (or the optional scoped App)
and an explicit initial version. Origin may be used for ordinary CI/report
observations after approved deployment. Synthetic publication requires an
owner-approved version/environment boundary; production tags are not disposable
test data. Local fixtures cannot certify credential-triggered CI, native hosted
package proof, comment transport or measured report timing.

<!-- acceptance-audit:start -->
## Local acceptance audit

This is an implementation-review snapshot, not a product release authorization.

| Check | Observed evidence |
| --- | --- |
| Locked dependencies | npm ci restored 228 exact locked packages with lifecycle scripts disabled; no Cargo dependency/version changes |
| CI support | 456 tests; 0 failures across 31 helper suites |
| Syntax/workflows | All eight configured module syntax checks and pinned actionlint passed |
| Publisher | Independent PowerShell boundaries and Node/PowerShell Unicode canonical golden passed |
| Joined release fixture | Both legacy and automatic paths passed; real Git trees, actual package/quality adapters, immutable retries and v2 preflight/authority joined without a remote |
| Light mutation | PASS — 602/988 detected (60.93%; unchanged floor 40%) |
| Full mutation | PASS — 973/1482 detected (65.65%; unchanged floor 50%) |
| Documentation | All checked local Markdown links resolve; current guidance replaces the historical manual-only flow |
| Workspace | 126 out-of-scope original files remain byte-identical; current branch/HEAD preserved; unrelated dirty work excluded from commit groups |

The automatic joined fixture validates C's own evidence and refuses source-P
substitution, wrong jobs, missing outcomes and changed bytes. Its executable/native
proof is synthetic contract data: it does not establish real hosted UI behavior.
Three publication reruns retain identical receipt bytes; five duplicate ref events
produce one ref update, including a lost-response simulation. Matching drafts/assets
resume, while conflicting tags, bytes, tips, attempts and authority stop.

Retry analysis also found that a new controller identity could change C if it
regenerated preparation. Source-prefixed immutable preparation lookup now reuses
the earliest verified equivalent artifact, including after writer serialization.
Creator identity, full source proof, release history and policy are revalidated;
reused preparations retain their original issuer/artifact ID. Conflicts stop.

The Unicode golden exposed JSON.NET escaping U+0085/U+2028/U+2029 differently from
Node. Independent publisher string canonicalization now matches JSON.stringify,
including emoji, control characters, ordinal keys and safe integer values. The
regression failed before the fix and passes in the publisher boundary suite.

### Mutation execution and population limits

Early mutation runs copied unrelated local models; subsequent runs disturbed by
dependency reinstallation were discarded. A clean process-per-file light run
also reached the existing 20-minute limit and produced no complete report. None
of those runs qualifies acceptance. Dependencies were restored before the final
sequential runs, with no installation during qualification.

Under the observed competing load, identical populations passed in both Node modes:
light 139/139 in 5,113 ms (process) versus 3,567 ms (none); full 270/270 in 5,486 ms
versus 4,665 ms. Each mutant still gets a fresh Node command; only file-level child
processes inside that command are removed. Ordinary support validation keeps its
normal isolation. Existing mutation scopes are extended to real automatic/report
decisions; floors remain 40% light/50% full and budgets 20/60 minutes. Source ranges
are checked against qualified function bodies so surrounding orchestration edits
cannot silently substitute different critical decisions. See Node's
[test isolation documentation](https://nodejs.org/download/release/v24.22.1/docs/api/cli.html#--test-isolationmode).

Conservative whole-suite accounting records 375/456
(82.24%) in-process tests and 81
cases grouped with process/Git boundary suites. Mixed suites include cheap cases,
so this is a lower bound, not a claim that every grouped case starts a process.
The helper-only slice does not claim the 90% target: real Git trees, Cargo graph
boundaries, archive extraction, independent PowerShell execution and publisher
transport/receipt behavior need retained boundary coverage. No tests were padded
or removed to improve the ratio, and no application-wide ratio is claimed.

### Requirement and success-criterion evidence

The detailed [requirement-to-task mapping](../specs/004-automated-semantic-release/tasks.md#requirement-coverage)
covers all 23 FRs. Local source/authority/immutable-publication cases cover FR-001–015;
projection, actual-job overlays, ownership, ordering, escaping and fallback cover
FR-016–019; role isolation, reference parity, owner setup and honest evidence cover
FR-020–023. Hosted portions remain pending rather than being inferred from fixtures.

| Criterion | Local result / outstanding observation |
| --- | --- |
| SC-001 | Joined automatic fixture passed; actual hosted automatic release pending |
| SC-002 | Negative provenance/authority/report cases stop without release writes; live credential behavior pending |
| SC-003 | Fifteen semantic cases, four pinned notes snapshots, bootstrap and history tests passed |
| SC-004 | Five duplicate ref events and three publication reruns passed; hosted races pending |
| SC-005 | Bound/render/state tests passed; five-minute delivery target has no hosted sample and no claimed percentage |
| SC-006 | Rerun/new-run/head ordering and forbidden/service fallback passed locally; real fork/head/attempt observations pending |
| SC-007 | Final-C package/version/proof binding passed with synthetic native data; real hosted binary/native UI pending |
| SC-008 | Published-history/asset immutability, exact main-promotion decisions and workspace preservation passed locally; hosted promotion pending |

### Owner activation and commit review

Install the reviewed controllers on default main, verify lifecycle refs/rules,
configure GH_TOKEN (or the optional App) and choose an explicit initial version.
Validate actual origin CI/PR delivery and an owner-approved publication boundary
before enabling automation_enabled. Cancel active runs as part of stopping an
already-running flow; credential and policy changes are not a claim of an atomic
global shutdown. The stored production policy remains disabled.

Hosted tasks T067–T070 remain open. No real version/tag/release/comment, branch
operation or unapproved commit is part of this local acceptance. The proposed
[16 logical commit groups](automated-semantic-release-commit-groups.md) list every
file, responsibility and Conventional Commit message. They exclude all unrelated
transcription/speaker work and require the user's explicit per-batch approval.
<!-- acceptance-audit:end -->

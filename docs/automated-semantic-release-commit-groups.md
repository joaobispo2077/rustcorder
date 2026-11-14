# Automatic release commit groups

Staged for review; commits still require the user’s explicit approval.

All groups use the current branch and preserve unrelated transcription/speaker work.
No product version, tag or publication is included. Groups follow documentation,
test infrastructure, tests, production helpers, then infrastructure. Each scope
can be reviewed and reversed separately.

## 1. docs(governance): authorize bounded automatic releases

Keep the constitution and its instruction/template copies aligned with the authorized automation exception.

- `AGENTS.md`
- `.specify/memory/constitution.md`
- `.github/copilot-instructions.md`
- `.github/instructions/versioning-and-documentation.instructions.md`
- `.cursor/rules/40-versioning-and-changelog.mdc`
- `.specify/templates/plan-template.md`
- `.specify/templates/tasks-template.md`

## 2. docs(ci): record release automation design and research

Keep the feature specification, tool qualification, design contracts and task evidence together.

- `.specify/feature.json`
- `docs/automated-semantic-release-research.md`
- `docs/automated-semantic-release-plan.md`
- `specs/004-automated-semantic-release/checklists/requirements.md`
- `specs/004-automated-semantic-release/contracts/pr-quality-report.md`
- `specs/004-automated-semantic-release/contracts/release-automation.md`
- `specs/004-automated-semantic-release/data-model.md`
- `specs/004-automated-semantic-release/plan.md`
- `specs/004-automated-semantic-release/quickstart.md`
- `specs/004-automated-semantic-release/research.md`
- `specs/004-automated-semantic-release/spec.md`
- `specs/004-automated-semantic-release/tasks.md`

## 3. docs(ci): document release operations and validation

Explain owner setup, current release behavior, honest acceptance limits and this review without rewriting historical evidence.

- `docs/versioning.md`
- `docs/branching.md`
- `docs/ci-quality-release-plan.md`
- `docs/ci-quality-release-validation.md`
- `docs/automated-semantic-release-validation.md`
- `docs/automated-semantic-release-commit-groups.md`

## 4. build(ci): pin Angular release notes tooling

Keep exact notes dependencies, lock integrity and executable syntax checks in one CI tooling change.

- `scripts/ci/package.json`
- `scripts/ci/package-lock.json`

## 5. test(ci): add isolated automation fixture backends

Provide the deny-by-default API fixture and extend the existing isolated publisher fixture, with their own harness checks.

- `scripts/ci/tests/git-fixture.mjs`
- `scripts/ci/tests/release-flow.fixture.ps1`
- `scripts/ci/tests/automation-fixtures.test.mjs`

## 6. test(release): cover configured version and changelog rules

Verify semantic impacts, pinned notes snapshots, adoption, history preservation and bounded Cargo preparation.

- `scripts/ci/tests/semantic.test.mjs`
- `scripts/ci/tests/notes.test.mjs`
- `scripts/ci/tests/proposal.test.mjs`
- `scripts/ci/tests/preparation.test.mjs`
- `scripts/ci/tests/fixtures/release-notes/initial.md`
- `scripts/ci/tests/fixtures/release-notes/major.md`
- `scripts/ci/tests/fixtures/release-notes/minor.md`
- `scripts/ci/tests/fixtures/release-notes/patch.md`
- `scripts/ci/tests/fixtures/semantic-release.json`

## 7. test(release): cover automatic authority and recovery

Verify source eligibility, exact metadata, authority, independent publication, interruptions and immutable retries.

- `scripts/ci/tests/release-decisions.test.mjs`
- `scripts/ci/tests/authorization.test.mjs`
- `scripts/ci/tests/release-automation.test.mjs`
- `scripts/ci/tests/release-flow.test.mjs`
- `scripts/ci/tests/publish.test.ps1`
- `scripts/ci/tests/promotion.test.mjs`

## 8. test(ci): cover PR reports and workflow trust

Verify current owned PR comments, final readiness overlays, safe rendering and isolated workflow permissions.

- `scripts/ci/tests/report.test.mjs`
- `scripts/ci/tests/pr-comment.test.mjs`
- `scripts/ci/tests/pr-decisions.test.mjs`
- `scripts/ci/tests/pr-comment-workflow.test.mjs`
- `scripts/ci/tests/workflows.test.mjs`
- `scripts/ci/tests/preview-workflow.test.mjs`
- `scripts/ci/tests/security.test.mjs`
- `scripts/ci/tests/setup.test.mjs`

## 9. test(ci): verify helper mutation and population accounting

Make omitted modules, stale critical selectors and incomplete test populations fail explicitly.

- `scripts/ci/tests/mutation-config.test.mjs`
- `scripts/ci/tests/populations.test.mjs`
- `scripts/ci/tests/dispatcher.test.ps1`

## 10. feat(ci): prepare and verify automatic release metadata

Implement deterministic, policy-bound source preparation, authenticated continuation and exact final-candidate authority.

- `scripts/ci/release.mjs`
- `scripts/ci/release-automation.mjs`
- `scripts/ci/release-policy.json`

## 11. feat(ci): authorize exact automatic publications

Independently validate v2 authority and persist stable receipts while preserving annotated tags and immutable assets.

- `scripts/ci/publish.ps1`

## 12. feat(ci): report current PR quality evidence

Build compact data projections and reconcile only the owned current PR report, including safe transport fallback.

- `scripts/ci/report.mjs`
- `scripts/ci/pr-comment.mjs`

## 13. ci(policy): isolate release and report permissions

Validate trusted workflow roles and fixed commands, retain ordinary CI guards and bound credential-related API access.

- `scripts/ci/gates.mjs`

## 14. ci(release): connect guarded automatic release jobs

Wire the trusted automatic stages, persisted/reused preparations, isolated writer and independent publisher with immutable action pins.

- `.github/workflows/release.yml`
- `scripts/ci/toolchain.json`

## 15. ci(report): connect isolated PR quality comments

Upload compact evidence in ordinary CI and add a trusted per-PR comment workflow with readable fallback.

- `.github/workflows/ci.yml`
- `.github/workflows/quality-comment.yml`

## 16. ci(testing): cover automatic helper mutation scope

Account for real critical decisions and helper suites, exclude unrelated data copies and retain existing floors/time budgets.

- `scripts/ci/stryker.config.mjs`
- `scripts/ci/run-mutation.mjs`
- `scripts/ci/test-populations.json`

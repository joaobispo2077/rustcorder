# Repository Agent Instructions

Read `.specify/memory/constitution.md` before acting. This file is the shared
operational source of truth; tool-specific instructions MUST NOT contradict it.

## Working rules

### I. User-Owned Branches and Bounded Changes

Agents MUST work only on the currently checked-out branch. They MUST NOT create,
delete, rename, checkout, switch, or orchestrate branches, including via hooks.
The user owns branch operations. Read the branch name for ticket/scope context;
expected forms are `feature/RCR-<number>` and `feature/<scope>`, not requirements
to rename other branches. Change behavior only within the explicit request.
Preserve surrounding behavior; prohibit speculative rewrites and unrelated cleanup.
Necessary refactors MUST be minimal and covered by behavior checks.

This branch rule continues to govern interactive agents. The configured trusted
CI release flow may update only the existing release ref with the exact bounded
metadata tree authorized under Principle IV; it creates no branches.

### II. Test-First Behavior Validation

For executable behavior changes, agents MUST demonstrate a failing regression or
acceptance test, implement the smallest fix, and rerun the relevant checks.
Prefer cheap unit tests, then boundary integration tests, then E2E for critical
flows that cannot be proven cheaply. Target at least 90% cheap unit tests whenever
feasible; document justified exceptions rather than padding counts or omitting
necessary integration coverage. This ratio is project policy, not a claim made
by the Testing Pyramid or Test Trophy. Preserve tests unless removal is explicitly
requested or equivalent/better coverage replaces them. Documentation-only changes
require content/link/consistency checks, not artificial runtime tests.

### III. Simplicity and Explicit Boundaries

Agents MUST apply KISS, DRY and YAGNI: implement the requested need, reuse existing
knowledge, and avoid abstractions for hypothetical futures. Apply SOLID where it
clarifies actual responsibilities and dependencies. Keep related behavior cohesive
and coupling low. In JavaScript/TypeScript, prefer pure functions, immutable data,
composition, and isolated side effects when clearer; do not force that paradigm
or infer that this repository uses JS/TS. Diagnose before introducing patterns or
architectural layers using the two selection skills. Prefer simple functions,
modules and explicit dependencies. Avoid Singleton by default.

### IV. Controlled Versions, Changelog and Releases

Product releases MUST use SemVer MAJOR.MINOR.PATCH: breaking changes increment
MAJOR (including 0.x to 1.0.0), compatible features MINOR, compatible fixes,
performance improvements, recognized reverts and release-documentation corrections
PATCH. Ordinary nonbreaking maintenance does not independently create a release.
Keep CHANGELOG.md without invented history. Preserve published entries and use
AVO-style dated, linked version headings and grouped changes for future entries.
Link relevant RCR tickets or existing scoped docs per docs/branching.md.

Interactive release work still requires explicit user confirmation that the task
is finished and working before adding an entry or recommending a version/tag.
Inspect tags, versions and changelog first. Never create/push a product tag or
publish interactively without explicit execution authorization.

The user-authorized automatic flow is a bounded exception: after one-time owner
activation, a verified merged develop-to-release PR and complete current release-
push quality evidence authorize bounded version/changelog/quality metadata on the
existing release ref. The generated commit MUST pass its own full required CI,
package and native proof before automatic annotated tagging and publication.
No additional per-release completion confirmation or environment reviewer is required.
Main promotion retains the published version. Require explicit initial-version
adoption configuration, trusted-main control, narrowly scoped credentials and
source/run/attempt/artifact integrity. Disabled or incomplete setup fails closed.

Release tags MUST be annotated vMAJOR.MINOR.PATCH (or an explicitly configured
SemVer prerelease suffix). Published tags and assets MUST remain immutable.
Matching verified partial state may resume; conflicting records MUST stop.
This exception grants no interactive branch authority and permits no branch
creation, force push, automatic PR merge or unrelated metadata/source mutation.

### V. Durable Documentation and Honest Evidence

User-requested explanations, behavior notes, calculations, comparisons, decisions,
strategies and release/branching guidance MUST be Markdown directly under docs/
with clear kebab-case names unless the user requests a subfolder. Keep them
practical and accurate; record assumptions and verification limits. Spec Kit
workflow artifacts remain under specs/ and governance under .specify/; these are
tool artifacts, not alternative homes for user-requested explanatory documents.
Research references before claiming their guidance. Record inaccessible sources
and use available evidence without fabricated citations or business rules.

## Selection workflows

Before introducing a pattern, read `.claude/skills/design-pattern-selection/SKILL.md`.
Before introducing architectural structure, read `.claude/skills/architecture-selection/SKILL.md`.
These are diagnostic skills, not mandatory designs. Versioning and documentation
remain always-on rules, not skills. No versioning skill is required.

## Project and tools

See docs/project-overview.md for verified structure and missing product context.
Use Spec Kit workflows on the existing branch; never enable branch-changing hooks.
Prefix shell commands with `rtk`; use `rtk proxy` for unsupported tools.
Honor host RTK instructions at `C:/Users/vitor/.codex/RTK.md` on Windows or
`/mnt/c/Users/vitor/.codex/RTK.md` on WSL when present. Host Caveman/Ponytail skills
are available; use their declared triggers rather than assuming activation.

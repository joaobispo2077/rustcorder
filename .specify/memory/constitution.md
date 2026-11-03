<!--
Sync Impact Report
Version: unratified template -> 1.0.0 (initial adoption, not a product release)
Modified principles: all five unnamed template slots replaced by principles I-V.
Added sections: Repository Constraints; Development Workflow; Governance.
Removed sections: placeholder examples only.
Updated: .specify/templates/plan-template.md, spec-template.md, tasks-template.md;
all installed .agents/skills/speckit-*/SKILL.md repository overrides;
AGENTS.md, CLAUDE.md, Cursor and Copilot instructions, README.md.
Deferred: application requirements/toolchain and automated release implementation
await future product work. No constitution placeholders or pending template sync.
-->
# rustcorder Constitution

## Core Principles

### I. User-Owned Branches and Bounded Changes

Agents MUST work only on the currently checked-out branch. They MUST NOT create,
delete, rename, checkout, switch, or orchestrate branches, including via hooks.
The user owns branch operations. Read the branch name for ticket/scope context;
expected forms are `feature/RCR-<number>` and `feature/<scope>`, not requirements
to rename other branches. Change behavior only within the explicit request.
Preserve surrounding behavior; prohibit speculative rewrites and unrelated cleanup.
Necessary refactors MUST be minimal and covered by behavior checks.

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

Product releases MUST use SemVer `MAJOR.MINOR.PATCH`: breaking changes increment
MAJOR, compatible features MINOR, compatible fixes and release documentation
corrections PATCH. Ensure CHANGELOG.md exists without invented history. Do not add
a release entry or offer release/tag commands until the user explicitly confirms
the task is finished and working (for example, "approved" or "we can release it").
Then inspect existing tags, versions and changelog, determine the next version,
and add a high-level dated entry. Link RCR tickets using the configured URL in
docs/branching.md; for scoped branches without tickets, link docs/<scope>.md.
For other branches, use a relevant docs link without inventing a ticket/scope.
Release tags MUST be annotated and use `vMAJOR.MINOR.PATCH` (or a SemVer prerelease
suffix). Published tags MUST remain immutable. Recommend commands for a specific
commit after confirmation; never execute tag creation/push without explicit
execution authorization. Future semantic-release automation MUST preserve these
approval and annotated-tag requirements; it is not configured by this setup.

### V. Durable Documentation and Honest Evidence

User-requested explanations, behavior notes, calculations, comparisons, decisions,
strategies and release/branching guidance MUST be Markdown directly under docs/
with clear kebab-case names unless the user requests a subfolder. Keep them
practical and accurate; record assumptions and verification limits. Spec Kit
workflow artifacts remain under specs/ and governance under .specify/; these are
tool artifacts, not alternative homes for user-requested explanatory documents.
Research references before claiming their guidance. Record inaccessible sources
and use available evidence without fabricated citations or business rules.

## Repository Constraints

At adoption, the repository contained only README.md with the project name.
No application code, build manifest, tests or business rules existed. Agents MUST
NOT infer runtime, recording behavior, platforms or domain count from the name.
The initial setup adds governance and Spec Kit workflows, not a product design.
AGENTS.md is the common operational entry point; agent-specific rules MUST agree
with it and this constitution. Use RTK for shell commands when available, including
`rtk proxy` for unsupported commands; report unavailability rather than hiding it.
Caveman and Ponytail are available host skills; do not vendor them or activate a
response style solely because they are installed.

## Development Workflow

1. Inspect status/current branch, instructions and the affected behavior.
2. Define acceptance, preserved behavior and relevant tests before implementation.
3. Consult selection skills only for actual pattern/architecture decisions.
4. Prove failure, implement the smallest coherent change, then prove success.
5. Update requested docs and review constitution compliance before completion.
6. Report checks and limits. Wait for the user's completion signal before release
   entries or tag recommendations, and separate execution authorization for tags.

## Governance

This constitution governs repository principles; AGENTS.md is their shared runtime
entry point. In a repository-policy conflict, align derivative files to this
constitution. Explicit user instructions and host/system requirements retain
precedence. Propose amendments with rationale and impact, obtain user authorization,
and update this file, its Sync Impact Report, templates and agent rules together.
Constitution versioning is separate from product releases: MAJOR for incompatible
principle removal/redefinition, MINOR for new or materially expanded principles,
PATCH for non-semantic clarifications. Each plan/review MUST record compliance or
a user-authorized exception with rationale and a bounded remediation plan.
No exception permits silently bypassing user-owned branch operations.

**Version**: 1.0.0 | **Ratified**: 2026-11-02 | **Last Amended**: 2026-11-02

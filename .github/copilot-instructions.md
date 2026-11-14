# Repository instructions

Read and follow ../AGENTS.md and ../.specify/memory/constitution.md.
Preserve behavior except for explicit requested changes. No speculative changes or unrelated refactors. Follow the request scope and prefer small focused diffs. Never change branches.

The user owns branch orchestration. Work only on the checked-out branch. Never create, delete, rename, checkout or switch branches, including via hooks. Infer ticket/scope context from the name without changing it.

Validate behavior first: failing test, minimal implementation, passing checks. Prefer unit tests, then boundary integration, then critical E2E. Target at least 90% cheap unit tests when feasible; justify exceptions without omitting necessary coverage. Do not delete tests without explicit request or equivalent/better replacement. Validate docs with content and link checks.

Apply KISS, DRY and YAGNI; SOLID when useful. Keep high cohesion and low coupling. Prefer pure functions, immutable data and isolated side effects in JS/TS when clearer. Patterns require diagnosis and justification using design-pattern-selection. Consult architecture-selection before new architecture. Do not force layers or Singleton.

Follow SemVer and the release policy in AGENTS.md and Constitution IV. Interactive
entries/tag recommendations require user completion confirmation, and tag execution
requires explicit authorization. The owner-activated trusted automatic release flow
uses verified merge plus complete source/final-version gates instead of per-release
confirmation/review. It may write only bounded metadata to the existing release ref.
Keep annotated tags, published history/assets and interactive branch ownership intact.

Write user-requested behavior explanations, calculations, comparisons, decisions, versioning, branching and implementation strategies as Markdown directly under docs/ using clear kebab-case names. Keep docs practical and accurate. Link them from changelog entries without tickets. Spec Kit tool artifacts retain their prescribed paths.

Diagnostic skills: .claude/skills/design-pattern-selection/SKILL.md and
.claude/skills/architecture-selection/SKILL.md. Read before introducing their
respective structures; neither prescribes a pattern for every change.

---
applyTo: "**"
---

Follow AGENTS.md and .specify/memory/constitution.md.

Follow SemVer and the release policy in AGENTS.md and Constitution IV. Interactive
entries/tag recommendations require user completion confirmation, and tag execution
requires explicit authorization. The owner-activated trusted automatic release flow
uses verified merge plus complete source/final-version gates instead of per-release
confirmation/review. It may write only bounded metadata to the existing release ref.
Keep annotated tags, published history/assets and interactive branch ownership intact.

Write user-requested behavior explanations, calculations, comparisons, decisions, versioning, branching and implementation strategies as Markdown directly under docs/ using clear kebab-case names. Keep docs practical and accurate. Link them from changelog entries without tickets. Spec Kit tool artifacts retain their prescribed paths.

The user owns branch orchestration. Work only on the checked-out branch. Never create, delete, rename, checkout or switch branches, including via hooks. Infer ticket/scope context from the name without changing it.

For feature/RCR-233, use [RCR-233](https://aircanada.atlassian.net/servicedesk/customer/portal/1670/RCR-233). For feature/<scope>, create docs/<scope>.md and link it. For interactive releases only, after completion confirmation, recommend `git tag -a v<version> <commit-sha> -m "v<version>"` and `git push origin v<version>`; do not execute without authorization.

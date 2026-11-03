---
applyTo: "**"
---

Follow AGENTS.md and .specify/memory/constitution.md.

Follow SemVer; ensure CHANGELOG.md exists. Add a high-level next-version release entry only after the user confirms finished and working. Inspect tags and current versions first. Link branch tickets or scoped docs per docs/branching.md. Only then offer annotated tag commands for a specific commit. Never create/push tags without explicit execution authorization. Keep published tags immutable.

Write user-requested behavior explanations, calculations, comparisons, decisions, versioning, branching and implementation strategies as Markdown directly under docs/ using clear kebab-case names. Keep docs practical and accurate. Link them from changelog entries without tickets. Spec Kit tool artifacts retain their prescribed paths.

The user owns branch orchestration. Work only on the checked-out branch. Never create, delete, rename, checkout or switch branches, including via hooks. Infer ticket/scope context from the name without changing it.

For feature/RCR-233, use [RCR-233](https://aircanada.atlassian.net/servicedesk/customer/portal/1670/RCR-233). For feature/<scope>, create docs/<scope>.md and link it. After completion confirmation, recommend `git tag -a v<version> <commit-sha> -m "v<version>"` and `git push origin v<version>`; do not execute without authorization.

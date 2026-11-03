---
name: architecture-selection
description: Diagnose project size and domain boundaries before choosing or changing architectural structure.
---

# Architecture selection

Use when a requested feature requires new architectural boundaries or an explicit
architecture decision. Skip for ordinary local changes. Follow AGENTS.md; never
reorganize unrelated code, change branches or create speculative folders.

## Diagnosis

Inspect project size, number of real business domains, domain complexity, external
adapters, testability needs, current modules, dependency direction, deployment and
runtime boundaries. Distinguish business domains from folder counts. Mark unknowns;
do not infer a domain model or language from the repository name.

## Decision

For small projects, prefer lightweight Ports and Adapters/Hexagonal boundaries
where real I/O needs isolation: keep logic independent and inject external behavior.
Do not add empty ports, interfaces or adapter directories for a README-only project.
For big projects, especially more than five actual domains or DDD-heavy behavior,
prefer Clean Architecture with inward dependencies. Size is a diagnostic signal,
not permission for a rewrite. Compare both with preserving existing modules.
Introduce only boundaries with an actual responsibility and testing benefit.

## Recommendation before structural edits

State current diagnosis/evidence, recommended architecture (including no change),
minimal folder/module changes, dependency ownership and testing strategy. For a
migration, state incremental reversible steps, behavior regression checks and a
rollback plan. Preserve behavior and explain each new boundary. Record requested
decisions in docs/; do not apply architecture blindly or abstract hypothetical needs.

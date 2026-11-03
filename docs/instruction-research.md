# Instruction research

Reviewed on 2026-11-02. Guidance is summarized and adapted; project-specific
requirements come from the supplied prompt, not from claims about these sources.

| Reference | Applied guidance |
| --- | --- |
| [Testing Pyramid](https://lawsofsoftwareengineering.com/laws/testing-pyramid/) | Many fast unit checks, fewer boundary/integration and UI checks |
| [KISS](https://lawsofsoftwareengineering.com/laws/kiss-principle/) | Prefer the simplest sufficient design |
| [DRY](https://lawsofsoftwareengineering.com/laws/dry-principle/) | Keep authoritative knowledge in one place |
| [SOLID](https://lawsofsoftwareengineering.com/laws/solid-principles/) | Use clear responsibilities and replaceable dependencies where useful |
| [YAGNI](https://lawsofsoftwareengineering.com/laws/yagni/) | Do not implement hypothetical requirements |
| [Functional JavaScript](https://dev.to/alexmercedcoder/deep-dive-into-functional-programming-in-javascript-851) | Pure functions and explicit state improve predictability and testability |
| [Mostly Adequate Guide](https://mostly-adequate.gitbook.io/mostly-adequate-guide) | Prefer composition and isolated effects when they clarify JS/TS code |
| [Strategy](https://refactoring.guru/design-patterns/strategy) | Isolate actual interchangeable algorithms |
| [Observer](https://refactoring.guru/design-patterns/observer) | Decouple event producers from multiple subscribers |
| [Facade](https://refactoring.guru/design-patterns/facade) | Simplify repeated complex subsystem coordination |
| [Decorator](https://refactoring.guru/design-patterns/decorator) | Compose optional behavior around a stable contract |
| [Adapter](https://refactoring.guru/design-patterns/adapter) | Translate incompatible interfaces at boundaries |
| [Singleton](https://refactoring.guru/design-patterns/singleton) | Uniqueness/global access carries isolation and dependency costs |
| [Ports and Adapters](https://dev.to/rafaeljcamara/ports-and-adapters-hexagonal-architecture-547c) | Isolate business behavior from external systems without prescribing folders |
| [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) | Direct dependencies inward toward business policy |
| [SemVer](https://semver.org/) | Version by compatibility impact; prereleases precede stable versions |
| [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) | Human-readable, dated, categorized release history |
| [Git tags](https://git-scm.com/docs/git-tag) | Annotated tags can target a specific commit; avoid rewriting published tags |
| [Cursor rules](https://cursor.com/docs/rules) | MDC frontmatter with alwaysApply for always-on rules |
| [Copilot instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions) | Repository instructions and applyTo frontmatter for instruction files |
| [Claude memory](https://code.claude.com/docs/en/memory) | Import shared repository guidance from CLAUDE.md |

## Access limits

- The supplied [coupling/cohesion article](https://www.joaobispo2077.com/blog/posts/coupling-and-cohesion-the-key-to-high-quality-software)
  was inaccessible through the research tool. High cohesion/low coupling rules
  therefore use the prompt's explicit requirements, not attributed article claims.
- The supplied [Mostly Adequate GitHub repository](https://github.com/mostlyadequate/mostly-adequate-guide)
  failed to fetch; its published book above was available as a fallback.

## Project-specific choices and assumptions

The 90% cheap-unit-test target, branch restrictions, completion-gated releases,
ticket URL convention and size/domain architecture preferences are user policy.
They are not universal prescriptions from the references. The two architecture
options require diagnosis and do not justify scaffolding empty application layers.
No application runtime or business rules could be established from the baseline.
Semantic-release automation requires later implementation with the same release gate.

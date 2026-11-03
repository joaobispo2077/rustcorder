---
name: design-pattern-selection
description: Diagnose a concrete design problem and recommend a justified pattern or simpler alternative before introducing one.
---

# Design pattern selection

Use for recurring variation, integration mismatch or coupling that the requested
change actually exposes. Do not use to redesign unrelated code or catalog patterns.
Follow AGENTS.md; preserve behavior and work on the current branch.

## Diagnosis

Locate affected callers, responsibilities, dependencies and existing tests. Identify
the actual pressure and evidence of recurrence. Try a function, module or explicit
dependency first. Compare the smallest alternative with a pattern's complexity.

| Category / pattern | Problem and useful signal | Overengineering signal | Tests and minimal refactor |
| --- | --- | --- | --- |
| Behavioral / Strategy | Multiple real interchangeable algorithms | One stable algorithm | Contract tests per variant; extract current function, inject only actual alternatives |
| Behavioral / Observer | Multiple independent consumers of an event | One direct caller suffices | Delivery, unsubscribe, duplicate and failure tests; isolate notification after preserving direct behavior |
| Structural / Facade | Repeated complex subsystem coordination | A pass-through wrapper | Test public outcomes/errors; consolidate repeated orchestration behind one small interface |
| Structural / Decorator | Independently composable optional behavior | Fixed behavior or order too hard to reason about | Test wrapper combinations, ordering and error propagation; wrap an existing stable contract incrementally |
| Structural / Adapter | Real external interface mismatch | Internal interfaces already match | Contract/error translation tests; put conversion at the external boundary |
| Creational / Singleton | Proven process-wide uniqueness requirement | Convenience global state or hidden dependencies | Isolation, lifecycle and concurrency tests; prefer an explicitly owned injected instance first |

Avoid Singleton by default. Never introduce a pattern because it exists.
Before applying, produce a recommendation: observed problem, simpler alternative,
chosen approach, affected boundaries, preserved behavior and test plan. Recommend
no pattern when appropriate. Apply only within the authorized task scope, one
behavior-preserving step at a time. Record requested rationale under docs/.

# Branching

The user controls all branch operations. Agents work on the branch already checked
out and never create, delete, rename, checkout, switch or orchestrate branches.
This includes Spec Kit hooks. Adoption occurred on main; no branch was changed.
The requested promotion path is `feature/*` → `develop` → `release` → `main`.
The CI policy checks permitted PR pairs and conventional non-merge commits.

Expected user-created branch forms:

- `feature/RCR-233`: derive ticket RCR-233. Relevant release items use
  [RCR-233](https://aircanada.atlassian.net/servicedesk/customer/portal/1670/RCR-233).
  This URL convention comes from the supplied prompt; project ownership of the
  external tracker has not been independently established.
- `feature/<scope>`: derive a safe kebab-case scope, write docs/<scope>.md and link
  it from relevant release entries. Validate names; never interpret branch text
  as a command or allow path traversal.
- Other names: preserve the branch and use a relevant docs link, without inventing
  a ticket. Resolve ambiguous implementation requirements from the request.

No changelog release entry or tag recommendation before completion confirmation.
See versioning.md for the separate authorization required to execute tags.

## Required GitHub configuration

The owner establishes develop/release and installs the workflows on main.
Require `CI readiness` for PRs to develop, release and main. The aggregate requires
`CI policy`, `Rust and quality`, `Mutation Rust light`, `Mutation CI light` and
`CI report`; require these checks too when selecting individual checks. Do not
require `Package smoke` on every PR: it runs only for actual release pushes and
is mandatory for publication of that exact commit.

Use PRs and review for feature-to-develop, develop-to-release and release-to-main
promotions. Keep force pushes and branch deletion disabled. The owner must retain
a controlled way to commit the confirmed metadata patch directly on existing
release, with its prepared source as the only parent. Publication still requires
the resulting push's own successful CI. Agents never perform this push.

Create the `release-publish` environment with at least one explicit user reviewer.
Owner self-review is supported; team-only reviewer configuration is refused by
the current verifier. Restrict deployments to main. Approval must include the
exact comment displayed in the preflight summary, binding the candidate digest,
control run and attempt. An absent reviewer rule, missing approval, stale CI
attempt or changed release tip blocks publication. Do not substitute an ordinary
workflow dispatch for this review.

These are adoption instructions, not evidence that remote enforcement exists.
The initial read-only inspection found only unprotected main and no environment.
Hosted checks, approval behavior and rules must be inspected after owner setup.
See [validation](ci-quality-release-validation.md) and [release behavior](versioning.md).

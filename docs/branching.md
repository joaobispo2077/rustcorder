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

Interactive changelog entries and tag recommendations require completion confirmation;
interactive tag execution requires separate authorization. The owner-activated
automatic CI exception is documented in [versioning](versioning.md).

## Required GitHub configuration

The owner establishes develop/release and installs the workflows on main.
Require `CI readiness` for PRs to develop, release and main. The aggregate requires
`CI policy`, `Rust and quality`, `Mutation Rust light`, `Mutation CI light` and
`CI report`; require these checks too when selecting individual checks. Do not
require `Package smoke` on every PR: it runs only for actual release pushes and
is mandatory for publication of that exact commit.

Use PRs and review for feature-to-develop, develop-to-release and release-to-main
promotions. Keep force pushes and branch deletion disabled. The owner must permit
the configured automation identity to advance only existing release with the exact
four-file prepared metadata commit, without branch creation or automatic PR merges.
Interactive agents retain no branch-operation authority. Publication requires that
commit's own successful CI/package/native proof and unchanged current release tip.

The fully automatic flow replaces the old release-publish per-release environment
review. Configure the GH_TOKEN repository secret used by AVO, or the optional
repository-scoped App client ID/private key. Do not give the reporter either
credential. Its own job token can write PR comments only. Manual workflow dispatch
offers a read-only preview and cannot prepare or publish.

Install the release and quality-comment controllers on default main, verify the
existing lifecycle refs/rules and supply an explicit initial version before owner
activation. Production adoption remains disabled. These are setup instructions,
not proof of remote configuration. No secret value, branch or rule was changed by
the local implementation. See [current validation](automated-semantic-release-validation.md)
and [release behavior](versioning.md). Older [feature-003 evidence](ci-quality-release-validation.md)
records its historical manual publication design.

# Branching

The user controls all branch operations. Agents work on the branch already checked
out and never create, delete, rename, checkout, switch or orchestrate branches.
This includes Spec Kit hooks. Adoption occurred on main; no branch was changed.
This policy does not prescribe GitFlow or trunk-based development.

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

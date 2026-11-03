# Versioning and releases

Use MAJOR.MINOR.PATCH: breaking changes, compatible functionality, compatible fixes
respectively. Documentation corrections tied to a release may increment PATCH.
No product version or release history has been established. Constitution 1.0.0 is
governance metadata, not the first product release.

Only after the user confirms completion, inspect manifests, CHANGELOG.md and tags;
choose the next version from actual history and change impact. Use dated, newest
first entries with Added/Changed/Deprecated/Removed/Fixed/Security as appropriate.
Describe user-visible outcomes and link tickets or docs per branching.md.

Release tags are annotated `vMAJOR.MINOR.PATCH`. An alpha may use, for example,
`v0.1.0-alpha.1`, then alpha.2; prereleases precede the corresponding stable release.
Examples below are reference syntax, not a recommendation to release now:

```sh
git tag -a v<version> <commit-sha> -m "v<version>"
git push origin v<version>
```

Validate the intended commit before tagging. Agents may recommend concrete
commands after completion confirmation, but execute only when explicitly asked.
Never move/rewrite a published tag; publish a new version for corrections.
Automated semantic release is a future requirement. Its design must preserve the
completion gate, changelog alignment, annotated tags and execution authorization;
do not enable a default pipeline that bypasses these rules.

Sources: [SemVer](https://semver.org/), [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[Git annotated tags](https://git-scm.com/docs/git-tag).

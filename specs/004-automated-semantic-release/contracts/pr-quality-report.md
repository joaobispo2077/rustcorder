# PR Quality Report Contract

Scope: GitHub issue comments on PR conversations for develop, release and main.
This is CI evidence, not release authorization. See [the data model](../data-model.md).

## Trusted workflow and data input

Add quality-comment.yml on CI workflow_run requested, in_progress and completed.
Its code/dependencies come from trusted main. Resolve run/PR read-only; deliver
under per-repository/PR concurrency with cancel-in-progress false and only
contents-read/actions-read/pull-requests-write. Do not use pull_request_target,
candidate checkout/dependencies/caches or release credentials. Workflow-run branch
filters describe source branches; verify the PR target through the API instead.

CI remains read-only. Its existing report job uploads a compact data-only
quality-comment-RUN-ATTEMPT artifact alongside full quality evidence. Projection:

- schema_version 1 and kind pr-quality-projection; existing hosted context;
- PR number/base/head repository/ref/SHA hints;
- preliminary assessment and reasons;
- known gate rows: status, applicability/exclusion reason, available counts,
  measurements and thresholds;
- fixed expected full-quality artifact name.

Limit JSON to 1 MiB, known gate population and bounded strings/arrays/safe integers.
No raw HTML, arbitrary links, executable paths or instructions. Freeze artifact
ID/digest/run ownership and expiration; extract only allowlisted files under bounds.
Projection-generation failure remains report construction failure.

## Authoritative resolution and readiness

Verify upstream repository, CI workflow ID/path, PR event, run ordering/attempt and
status through API calls. Resolve associated PRs; a projection number is only a hint.
GET PR must confirm base repository/allowed target, head repository/ref/SHA and
open-PR tested merge identity. Fork head repositories legitimately differ. Refuse
ambiguous association; direct pushes get run evidence without an invented PR.

Fetch exact-attempt jobs and final certification separately: the preliminary report
was constructed before readiness. Green requires actual successful required jobs,
valid complete certification and matching current identity. Failed, cancelled,
timed-out, missing or malformed evidence yields failed/incomplete/pending as
appropriate. Excluded gates are labeled with reasons, never converted to passes.
When no report exists, publish a verified incomplete diagnostic if association is
known, with available run/job links.

## Comment ownership and freshness

Use fixed marker `<!-- rustcorder-quality-report:v1 -->` and verify the expected
numeric bot-author ID before editing. Hidden metadata includes PR/head/tested SHA,
run number/ID/attempt, phase and report digest. Human-forged markers and unrelated
bot comments are ignored. Treat hidden metadata as bounded data, never authority.

List comments with pagination; PATCH the owned comment or POST if absent. Recover
a lost POST response by relisting. Reconcile duplicate owned comments without
touching others, retaining at most one current report. Do not create one per run ID.

Re-fetch current PR and newest applicable CI run/attempt immediately before writing,
then inspect after writing to neutralize a just-superseded result. Compare attempts
only within the same run; use verified run ordering across runs. An old callback
reconciles the newest state. Requested/in_progress turns previous success pending;
in_progress also covers reruns. Closed/merged PRs use historical wording or skip;
their merge_commit_sha is not treated as the old open-PR test merge.

There is no atomic PR-head guard on GitHub comment PATCH. Per-PR serialization,
pre/post-write checks and wording naming exact head/tested SHA bound the race.
Do not promise instantaneous freshness during outages or call old evidence current
merge approval merely because an older head passed.

## Presentation and delivery

Render ≤48 KiB UTF-8 Markdown: identity/phase, final readiness, gate table, available
counts/measurements/floors, exclusions and evidence/run links. Preserve zero versus
unavailable values. Escape untrusted text, suppress mentions/unsafe markup and
generate links from verified GitHub identities. Truncate details with a visible
pointer to full evidence; never paste arbitrary artifact Markdown.

Record delivered, superseded, closed/skipped, forbidden or service-failed outcomes
in the reporter summary and small delivery artifact. Retain the original readable
report and run evidence. Comment transport failure cannot alter upstream readiness;
construction/validation failure must not be hidden as successful delivery. Missing
permissions do not request extra authority automatically.

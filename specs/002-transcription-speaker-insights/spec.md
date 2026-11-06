# Feature Specification: Accurate Transcription and Speaker Insights

**Feature Branch**: `main` (existing branch; unchanged)

**Created**: 2026-11-05

**Status**: Ready for planning; candidate selection requires measured evaluation

**Input**: Improve current transcription accuracy, research alternatives including
WhisperX, identify how many people speak using labels such as Person 1 and Person 2,
and highlight how much and how often each person speaks.

**Confirmed constraint (2026-11-05)**: Local only; compare CPU and GPU options.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Obtain a More Accurate Transcript (Priority: P1)

As a user reviewing a Portuguese or English recording, I can choose a higher
accuracy option and obtain a transcript that needs fewer word corrections.

**Why this priority**: Speaker labels and statistics cannot compensate for an
inaccurate account of what was said.

**Independent Test**: Transcribe the same human-referenced recordings using the
current options and the proposed quality option. Compare word errors, completion
time and speech-free controls without enabling speaker analysis.

**Acceptance Scenarios**:

1. **Given** a supported local WAV or MP3 and required local assets, **When** I
   choose higher accuracy and transcribe, **Then** I receive text in the selected
   language, visible progress and an explicit completed or incomplete state.
2. **Given** candidate quality options, **When** one is recommended as more accurate,
   **Then** its recommendation is supported by SC-001's same-recording comparison;
   a speed or timestamp improvement alone does not qualify.
3. **Given** missing assets, insufficient resources or unavailable acceleration,
   **When** I start a job, **Then** I see the specific limitation and available
   alternatives, without an automatic model change or network access.
4. **Given** completed text, **When** I copy or save it, **Then** the words remain
   available through the existing plain-text workflow and audio is unchanged.

---

### User Story 2 - See Who Spoke When (Priority: P1)

As a user reviewing a finished conversation, I can see the estimated number of
distinct voices and timestamped passages labelled Person 1, Person 2, and so on,
including when a previously heard person speaks again.

**Why this priority**: This distinguishes participants within a recording without
requiring anyone's real identity.

**Independent Test**: Analyze human-annotated one- through four-person recordings,
including a person returning after a long pause. Compare count, identity consistency
and speech boundaries independently of transcript accuracy using reference intervals.

**Acceptance Scenarios**:

1. **Given** an available local speaker-analysis option, **When** I analyze finished
   audio, **Then** I see its estimated distinct-speaker count and timestamped
   speaker-labelled text, with numbered labels ordered by first attributed speech.
2. **Given** one person speaks, another answers and the first returns, **When** the
   final result is displayed, **Then** the first person's passages share one label
   throughout that result instead of receiving a new label for each passage.
3. **Given** simultaneous voices or speech that cannot be attributed reliably,
   **When** results are displayed, **Then** detected overlap and unassigned speech
   are distinguishable; ambiguity is not silently resolved into a certain identity.
4. **Given** I know the participant count, **When** I supply that optional count
   within the selected option's advertised range before analysis, **Then** it is
   used as a hint and recorded as supplied rather than automatically estimated.
   An impossible hint produces a warning.
5. **Given** transcription succeeded but speaker analysis failed, **When** I review
   results, **Then** the transcript remains usable and speaker insights are clearly
   unavailable or incomplete instead of reported as zero speakers.

---

### User Story 3 - Review Participation Highlights (Priority: P2)

As a user reviewing a finished conversation, I can compare each person's speaking
duration, share of speech and turn count, and inspect their timestamped passages
to understand participation without replaying the entire conversation.

**Why this priority**: This answers both "how long did each person speak?" and
"how many times did each person speak?".

**Independent Test**: Supply fixed speaker intervals and verify summary arithmetic,
ordering and turn boundaries without speech recognition. Then verify one complete
recording through display and export.

**Acceptance Scenarios**:

1. **Given** completed analysis, **When** I view the summary, **Then** I see each
   person's speaking duration, percentage of attributed speaker-time and turn count,
   plus separate recording duration, overlap and unassigned speech.
2. **Given** Person 1 speaks at [0, 5) and [8, 10) seconds, Person 2 at [4, 8), and
   unassigned speech at [12, 13) in a 20-second recording, **When** statistics are
   computed, **Then** Person 1 has 7 seconds and 2 turns, Person 2 has 4 seconds
   and 1 turn, shares are 63.6% and 36.4%, overlap is 1 second, unassigned speech
   is 1 second, and time without detected speech is 9 seconds.
3. **Given** different text chunking for the same speaker activity, **When** I compare
   results, **Then** speaking duration and turn counts are identical.
4. **Given** a person is selected in the summary, **When** I inspect their passages,
   **Then** their timestamped text is shown without changing the full result or
   recalculating its totals using only the filtered passages.
5. **Given** completed or incomplete results, **When** I copy or save a speaker
   report, **Then** labels, timestamps, available text, statistics, count provenance
   and completion status agree with the displayed result.

---

### User Story 4 - Analyze Saved Audio Without Disrupting Capture (Priority: P2)

As a recording user, I can finish saving audio and then request the more accurate
transcript and speaker report while retaining existing recording and live text.

**Why this priority**: Whole-conversation analysis can use later context to resolve
speakers and must not delay securing audio.

**Independent Test**: Record with analysis unavailable, save and analyze the saved
file later. Inject cancellation and failure, verifying that saved audio and any
existing transcript remain intact.

**Acceptance Scenarios**:

1. **Given** either existing recording mode, **When** I stop, **Then** the recording
   is secured independently of higher-accuracy or speaker analysis. I can request
   analysis of that saved recording afterward.
2. **Given** existing live transcription, **When** I use it without new analysis,
   **Then** its pending/final text and save behavior remain available; live speaker
   labels are not needed to complete this feature.
3. **Given** analysis in progress, **When** I cancel or analysis fails, **Then** I
   see the outcome, retain available partial results as incomplete and can retry
   without modifying original audio or replacing an earlier complete result with
   an incomplete result without an explicit user action.

### Edge Cases

- Silence, music, tones and stationary noise alone: no invented words, speakers,
  turns or percentages; unavailable analysis is distinct from a genuine zero result.
- One participant, similar voices, distant/quiet speakers, brief replies, accents,
  compressed calls and Portuguese mixed with English terms: evaluate separately;
  preserve uncertainty and original wording.
- A person returns after minutes of silence: final labels stay consistent within
  that recording. Labels have no identity relationship across recordings.
- Overlap: each detected person's active time counts independently; summed
  person-times may exceed elapsed speech time. A readable passage assignment
  must not erase overlap from participation calculations.
- Echo or duplicated microphone/output audio may distort results. Audio sources
  and stereo channels must not be assumed to represent distinct people.
- A word cannot be timed/attributed: retain text, mark missing timing/attribution
  and exclude it from statistics that require unavailable timing.
- Speaker count exceeds a method's range, or a supplied hint conflicts with
  evidence: expose the limit/warning instead of silently claiming accurate counts.
- Long recordings and resource exhaustion: show progress or clear failure; do not
  freeze the interface, silently truncate results or lose audio.
- Export failure or an existing destination: preserve existing data and report the
  problem using existing explicit save/overwrite behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Offer at least one evaluated higher-accuracy option for completed
  Brazilian Portuguese and English recordings, independently of speaker analysis.
- **FR-002**: Identify the selected option, language, processing device and required
  local assets before analysis; report readiness, progress, cancellation, failure,
  partial/full completion without silent fallback.
- **FR-003**: Keep audio, text and speaker analysis local and usable offline with
  provisioned assets; analysis MUST NOT download assets, contact services or send
  telemetry. Explain external asset acquisition and applicable terms separately.
- **FR-004**: Support existing WAV/MP3 inputs and saved app recordings without
  changing their bytes or requiring a meeting-service account.
- **FR-005**: Estimate distinct speakers automatically for at least one through
  four people, display the estimate as an estimate and declare the supported range.
  An optional known-count hint MUST be visibly distinguished from estimation.
- **FR-006**: Assign stable anonymous labels Person 1, Person 2, etc. by first
  attributed speech within a completed result; timestamps MUST refer to the
  original recording timeline, including silence.
- **FR-007**: Preserve unassigned text/speech and detected overlapping activity;
  do not invent real names or imply identities persist across files.
- **FR-008**: Present a complete timestamped transcript and allow inspection of one
  person's attributed passages while retaining the full conversation and totals.
- **FR-009**: Calculate speaking duration as the union of each person's detected
  speech intervals, including their start and excluding their end. Exclude silence,
  avoid duplicate counting for that person and retain simultaneous speech.
- **FR-010**: Calculate speech share as a person's speaking duration divided by
  the sum of all attributed persons' durations. Exclude unassigned speech from that
  denominator and display its duration separately; label the denominator. For a
  zero denominator, show no attributed speech instead of a percentage.
- **FR-011**: Count turns using maximal chains of a person's activity intervals
  separated by at most 0.5 seconds, with no other-person or unassigned speech in
  the intervening gap. Overlap during continuous activity does not split that
  person's turn. Joined gaps add no speaking duration. Text chunks and punctuation
  MUST NOT determine counts.
- **FR-012**: Report recording duration, elapsed time with any detected speech,
  elapsed overlap time with at least two attributed speakers, elapsed unassigned
  speech and time without detected speech. These are unions of intervals rather
  than sums across people; make incomplete coverage explicit.
- **FR-013**: Calculate before rounding; show durations to 0.1 seconds and shares
  to one decimal place. Disclose overlap and rounding so totals can be interpreted.
- **FR-014**: Offer explicit copy/save of a readable speaker report containing the
  summary and timestamped passages. Preserve plain-text-only export and include
  partial status and speaker-count provenance in the report.
- **FR-015**: Make speaker analysis optional. If unavailable, failed or cancelled,
  preserve successful transcription, existing complete results and audio; never
  present missing analysis as a completed zero-participation result.
- **FR-016**: Permit analysis after a recording is saved without delaying audio
  finalization. Preserve capture modes, device selection, live text and existing
  single-active-job behavior; this feature does not introduce simultaneous jobs.
- **FR-017**: Retain current options for resource-constrained use. An option that
  cannot run on a selected device MUST explain this before processing or report
  the actual runtime failure without changing selections automatically.

### Key Entities *(include if feature involves data)*

- **Recording**: Original audio, duration, selected language and source context.
- **Analysis option**: Accuracy/device choice, local prerequisites and declared
  language/speaker-count capabilities.
- **Analysis result**: Recording association, selected option, completion/coverage,
  transcript, estimated or supplied count, warnings and summary.
- **Speaker**: Anonymous identity scoped to one result, ordinal label and first
  attributed appearance; no real-world identity claim.
- **Speech interval**: Start/end on the recording timeline, with one or more
  detected speaker activities or unassigned speech; distinct from text chunks.
- **Transcript passage**: Original-language text, available timing/attribution and
  explicit missing timing/attribution.
- **Participation summary**: Derived durations, shares and turn counts with defined
  denominators, overlap, unassigned speech and completion status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

These are proposed acceptance gates, not measured improvements. Freeze recordings,
human annotations and scoring rules before selecting the winner. Use at least
60 minutes across 12 conversations, at least 30 minutes per language, covering
one through four speakers with at least two conversations per count, clean and
compressed/noisy audio, and annotated overlap. Keep at least four conversations,
two per language, held out from tuning. Distinguish full-set and held-out results.

- **SC-001**: On held-out conversations, the quality option reduces word error rate
  by at least 20% relative to the better current multilingual option per language,
  scored on identical inputs and normalization rules. Report languages separately
  and count insertions; the two current options must be remeasured on this corpus.
- **SC-002**: Without supplied counts, detect the exact count on at least 90% of
  the 12 or more conversations and at least 75% of held-out conversations. Report
  errors by count and language.
- **SC-003**: On held-out conversations, diarization error rate is at most 15% per
  language, including overlap and using no boundary forgiveness. Match predicted
  labels one-to-one to reference people and report missed speech, false speech
  and speaker confusion separately.
- **SC-004**: For held-out reference speakers with at least 30 seconds of speech,
  speaking-duration error is at most the larger of 3 seconds or 10% of reference
  duration for at least 90% of those speakers. Deterministic interval calculations
  match FR-009 through FR-013, including overlap and the exact 0.5-second boundary.
- **SC-005**: All declared speech-free controls produce zero speakers and turns
  without invented words. Quiet-speech controls remain nonempty; attribution may
  be unassigned when the voice cannot be resolved.
- **SC-006**: At least one recommended quality option completes a 10-minute
  reference conversation and report within 20 minutes on the declared computer.
  Record device, peak memory and cold/warm time separately; the interface
  acknowledges cancellation within 2 seconds and stays usable during processing.
- **SC-007**: All acceptance cases preserve source audio byte-for-byte and retain
  available text through speaker-analysis cancellation/failure. Display and export
  agree in every deterministic summary/status case.
- **SC-008**: Required flows work with provisioned assets and networking disabled;
  connected tracing shows zero attempted service, download or telemetry connections
  by the app and its analysis processes.

## Assumptions

- The user confirmed local-only operation and comparison of CPU/GPU options.
  Existing Windows desktop and offline requirements remain in force.
  Brazilian Portuguese is the default; English stays explicitly selectable.
- Initial scope is completed recordings: imports and explicit analysis after
  stopping capture. Stable live speaker labels and live participation dashboards
  are deferred; existing live transcription remains supported.
- "Highlights" means participation statistics and timestamped passages. Semantic
  summaries, action items, topics, video clips, emotional judgments and assessments
  of interruption intent are outside scope.
- Recognition means anonymous within-recording diarization. Voice enrollment,
  cross-recording identity matching and automatic real names are outside scope.
- Speaker splitting/merging corrections, a transcript editor, a new audio player,
  batch queues and new import formats are outside this first increment.
- One through four people is the initial validated range. Larger groups may form
  a separate challenge set without implying validated support.
- Asset acquisition may need prior internet access or acceptance of upstream terms.
  Normal use requires provisioned local assets and no online login.
- The reference computer is the existing Windows development machine, currently
  including an 8 GB graphics device. A CPU alternative must remain available;
  identical speed across devices is not assumed.
- Human-referenced conversations and speaker activity annotations are dependencies
  for accepting accuracy claims; existing read-speech tests are insufficient.
- Candidate tradeoffs are in [the research report](../../docs/transcription-speaker-research.md).
  This spec defines outcomes without selecting a model, library or process design.

## Preservation and validation constraints

Work remains on `main`; branch creation/switching is prohibited. This invocation
creates specification/research artifacts only. Existing staged UI/layout changes
are unrelated and must remain intact. No release entry or version change applies.

Authorized future changes are higher-accuracy completed-file transcription,
optional anonymous speaker analysis, participation display and report export.
Preserve independent capture/storage, file formats, explicit language and asset
readiness, failure/cancel handling, plain-text export, offline operation and live
behavior. Existing validation limitations are not resolved by writing this spec.

Before executable changes, demonstrate failing acceptance/regression tests at the
narrowest responsible boundary. Use cheap unit cases for unions, overlap, turns,
rounding, count provenance and status; use necessary boundary checks for real
assets, analyzer failure, cancellation, export and process isolation. Target at
least 90% cheap unit tests where feasible and document justified exceptions.
Keep existing tests; real audio, network/device/UI checks supplement unit tests.

Update documentation directly under `docs/` with device/model measurements,
offline assets/licenses, formulas and verification limits. For this documentation-only
invocation, check links, completeness, coverage, arithmetic and preserved changes;
runtime tests are unnecessary.

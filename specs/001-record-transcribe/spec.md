# Feature Specification: Desktop Voice Recording and Transcription MVP

**Feature Branch**: `main` (existing branch; unchanged)

**Created**: 2026-11-02

**Status**: Ready for planning — product clarifications resolved

**Input**: Build a minimum Rust desktop voice recorder that records microphone
audio, records microphone plus computer sounds for Google Meet/Discord calls,
transcribes existing recordings, and transcribes while recording.

**Confirmed clarification (2026-11-02)**: Transcription runs locally and offline.
Brazilian Portuguese is the initial language. Users can select a local folder
containing compatible models/language packs, including English when needed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record My Voice (Priority: P1)

As a desktop user, I can choose my microphone, start and stop recording, and find
the saved audio so that I can retain a voice note without using a meeting service.

**Why this priority**: Reliable microphone capture and saving are the smallest
useful product and the foundation for the other recording mode.

**Independent Test**: With transcription disabled, record a spoken test phrase,
stop, and open the saved file in an ordinary audio player. Confirm the phrase is
audible and the file remains available after restarting the app.

**Acceptance Scenarios**:

1. **Given** an available microphone and writable save location, **When** I start
   microphone-only recording, **Then** the app visibly indicates active recording,
   identifies the selected input, and shows elapsed time.
2. **Given** an active recording, **When** I speak and then stop, **Then** capture
   ends and the app displays the location of a playable saved recording containing
   my speech, without capturing the selected computer-output source directly.
3. **Given** missing microphone access or an unavailable input, **When** I try to
   start, **Then** the app explains how to resolve the problem and does not show a
   successful recording state or create a misleading completed recording.
4. **Given** an existing recording at the intended save location, **When** another
   recording is saved, **Then** the previous file remains intact and the new file
   receives a distinct name.

---

### User Story 2 - Record Both Sides of a Call (Priority: P1)

As a participant in a computer call, I can record my microphone and the sound
played by my computer together so that the saved recording contains both sides.

**Why this priority**: Capturing the remote participant is the key difference
between a voice-note recorder and the requested call-recording use case.

**Independent Test**: Use headphones and an external call/test partner. Record
alternating local and remote phrases, then simultaneous speech, and play back
the saved file. Repeat the scenario in Google Meet and Discord independently.
No transcription is needed to test this story.

**Acceptance Scenarios**:

1. **Given** an available microphone and computer-output source, **When** I select
   microphone plus computer audio and start, **Then** both selected sources are
   visibly identified and their capture starts as one recording session.
2. **Given** the local participant speaks into the microphone and a remote
   participant speaks through the selected output, **When** I stop and play the
   recording, **Then** both voices are audible in their original timing/order,
   including intervals where they overlap.
3. **Given** headphones are used, **When** remote speech plays while my microphone
   is quiet, **Then** the remote speech is still captured; recording must not rely
   on a microphone picking up loudspeakers.
4. **Given** either required source cannot be captured at startup, **When** I start
   this mode, **Then** the app names the unavailable source and does not silently
   substitute microphone-only capture.
5. **Given** another application plays sound through the selected output, **When**
   recording is active, **Then** that sound is included too; the app makes the
   whole-output scope clear before recording starts.

---

### User Story 3 - Transcribe an Existing Recording (Priority: P2)

As a user with a saved audio recording, I can select that file and obtain readable
text so that I do not need to replay the entire recording to recover its content.

**Why this priority**: This delivers transcription value independently of live
recording and lets users process recordings made outside this app.

**Independent Test**: Without starting recording, select a known spoken-audio file,
transcribe it, compare the result with its reference text, and save the transcript.
Confirm the original audio is unchanged.

**Acceptance Scenarios**:

1. **Given** a readable supported audio file containing speech, **When** I select
   it and start transcription, **Then** the app identifies the file, displays
   processing status, and eventually shows a readable completed transcript.
2. **Given** a completed transcript, **When** I copy or save it, **Then** the text
   is available on the clipboard or as a plain-text file at a visible location,
   and the source audio remains unchanged.
3. **Given** an unsupported, empty, corrupt, or unreadable file, **When** I try to
   transcribe it, **Then** the app explains the specific problem and allows me to
   choose another file without damaging the original.
4. **Given** valid audio containing silence but no speech, **When** transcription
   completes, **Then** the app reports that no speech was detected rather than
   presenting invented spoken content as a successful transcript.
5. **Given** transcription is processing a file, **When** I cancel, **Then** the
   app returns to an available state, preserves the original, and does not label
   partial text as a completed transcript. I can retry later.
6. **Given** a valid Brazilian Portuguese model is available in my selected local
   model folder and network access is disabled, **When** I transcribe a Portuguese
   recording, **Then** I receive Portuguese text without an online service or account.
7. **Given** the app is idle and I choose a local folder with a compatible English
   model, **When** I select English and transcribe an English recording, **Then**
   the app uses that model offline. English is not offered as ready unless a
   compatible model supporting it is available.
8. **Given** a model folder is missing, unreadable, empty, incompatible or incomplete,
   **When** I select it or try to transcribe, **Then** the app explains the problem,
   offers selection of another folder, and does not download a model or send audio
   to an online service. Recording without transcription remains available.
9. **Given** I selected a valid model folder and language, **When** I restart the
   app, **Then** those settings are remembered and revalidated before transcription;
   moved or removed files result in a not-ready state rather than silent fallback.

---

### User Story 4 - Read Transcription While Recording (Priority: P2)

As a recording user, I can enable live transcription and see spoken content appear
while recording continues so that I can follow a voice note or call in text.

**Why this priority**: This combines reliable capture with transcription; it must
not weaken audio recording when transcription is unavailable or falls behind.

**Independent Test**: Enable live transcription, speak several separated phrases,
and verify text appears before stopping. Repeat for microphone-only and combined
capture, then verify saved audio and the completed transcript.

**Dependencies**: This flow requires the capture behavior from Story 1 or 2 and
transcription readiness. It is separately verifiable, not independently implementable
before capture exists. Story 3 can be delivered without either recording story.

**Acceptance Scenarios**:

1. **Given** transcription is ready, **When** I enable live transcription before
   starting either recording mode, **Then** text appears during recording and is
   ordered according to the captured speech.
2. **Given** combined capture with alternating local and remote speech, **When**
   live transcription is enabled, **Then** the transcription includes speech from
   both selected sources. Speaker names/identification are not required.
3. **Given** live text can still change, **When** it is displayed, **Then** pending
   text is distinguishable from finalized text and revisions do not accumulate
   duplicate copies of the same passage in the finalized transcript.
4. **Given** recording and live transcription are active, **When** I stop, **Then**
   audio capture ends and the recording is saved without waiting for transcription;
   pending transcription shows a finalizing state before the completed text can
   be copied or saved.
5. **Given** transcription fails or falls behind, **When** audio capture remains
   available, **Then** recording continues, the transcript's incomplete/lagging
   state is visible, and stopping still saves the recorded audio. The user can
   transcribe the saved file later rather than losing the recording.
6. **Given** transcription has failed after producing some finalized text, **When**
   I copy or save that text, **Then** the available words are preserved and displayed
   and saved text are clearly identified as incomplete.
7. **Given** recording has stopped but transcription is still finalizing, **When**
   I try to close, **Then** I can keep the app open or confirm cancellation, copy/save
   available text, and close without affecting the already saved audio.
8. **Given** a compatible model for the selected language is ready locally and the
   network is disabled, **When** I start either capture mode with live transcription,
   **Then** text appears while recording and both audio and text can be saved offline.
   Test Brazilian Portuguese by default and English after selecting its model.

### Edge Cases

- A selected microphone/output disappears mid-session: stop capture, preserve the
  captured portion when writable, and clearly report the source and interruption.
  Do not silently change sources or claim a complete two-source recording.
- A system default device changes: keep the selected source while available;
  changing defaults alone must not silently replace it during a session.
- A selected source is silent: silence is valid, not proof of disconnection or
  failure. The app must not fabricate audio or words to fill it.
- The save location becomes unwritable or full: stop capture, report the save
  failure, and distinguish any retained partial file from a completed recording.
  Do not promise recovery of data that could not be written.
- The user closes the app during recording: offer to stop/save and close or cancel
  closing. Pending transcription must not delay securing the recorded audio.
- Sleep or an audio interruption ends usable capture: finalize the captured portion
  where possible and mark the session interrupted; do not claim continuous audio
  through an unrecorded interval. Crash/power-loss recovery is outside this MVP.
- A second recording is requested: keep the current one and explain that only one
  recording can be active. Recording settings cannot change mid-session.
- A second transcription task is requested while file/live transcription is busy:
  keep the current task and ask the user to finish/cancel it first. Do not introduce
  background queues in the MVP.
- Starting a recording while existing-file transcription runs, or starting file
  transcription during recording, is rejected without affecting the current work.
- Closing during file transcription or post-stop finalization offers keep-open or
  cancel-and-close. Before closing, allow copy/save of available incomplete text
  and require confirmation before discarding unsaved text; preserve original audio.
- Speakers may feed remote audio back into the microphone: baseline acceptance
  uses headphones; automatic echo removal/noise suppression is outside this MVP.
- Overlapping voices, heavy noise or unsupported languages may reduce transcript
  quality. Do not promise speaker separation or perfect transcription.
- The selected model folder is changed, moved or removed: validate compatible
  model availability before a task. Model/language changes are allowed only while
  no recording or transcription task is active. If files become unavailable during
  live transcription, mark transcription failed while preserving audio capture.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST provide a Windows desktop interface with microphone-only
  and microphone-plus-computer-audio recording modes.
- **FR-002**: Before recording, users MUST be able to select an available microphone
  and, for combined capture, the computer-output source. Defaults MAY be preselected
  but the selected sources and capture scope MUST be visible.
- **FR-003**: Users MUST be able to start and stop one recording at a time. The app
  MUST show idle, recording, saving, completed and failed/interrupted outcomes,
  display elapsed recording time, and avoid contradictory active/completed states.
- **FR-004**: Microphone-only mode MUST capture the selected input. Combined mode
  MUST capture both microphone and selected output directly, preserving relative
  timing and overlapping audio in one playable recording, without joining calls
  or requiring Google/Discord account integration.
- **FR-005**: Combined mode MUST disclose that other sound from the selected output
  is captured, rather than imply capture is isolated to a particular app or call.
- **FR-006**: Before capture, the user MUST be able to choose a writable local save
  folder. Each normally stopped recording MUST be saved as a uniquely named WAV
  audio file; no existing file may be overwritten silently. The result MUST show
  the file location and remain available after app restart.
- **FR-007**: The app MUST validate required source access and the save destination
  before reporting successful capture. Startup failures MUST identify the missing
  access/source or unwritable location, with a recovery action.
- **FR-008**: Capture interruptions and save failures MUST stop the affected session,
  preserve already captured audio when possible, and distinguish interrupted or
  partial output from a completed recording. Combined capture MUST NOT silently
  continue as single-source capture.
- **FR-009**: Users MUST be able to select an existing local WAV or MP3 audio file
  for transcription, including recordings produced by this app. Unsupported,
  empty, corrupt or unreadable inputs MUST produce specific understandable errors.
- **FR-010**: Existing-file transcription MUST show the selected input and processing,
  completed, cancelled or failed status. The user MUST be able to cancel and retry
  without modifying or deleting the source file.
- **FR-011**: Completed file/live transcripts and finalized partial text from failed
  or cancelled tasks MUST be viewable, copyable, and savable as UTF-8 plain text to
  a user-chosen location without silently overwriting files. Incomplete text MUST
  be clearly identified on screen and in exports. Failed transcript saves MUST
  leave displayed text available to copy or retry.
- **FR-012**: Users MUST be able to enable/disable transcription before recording;
  enabling it MUST work in both capture modes. Live text MUST appear before
  recording stops, include both sources in combined mode, and distinguish pending
  text from finalized text when revisions are possible.
- **FR-013**: Stopping capture MUST secure the audio independently of transcription
  completion. Remaining text MUST show a finalizing state and then completed or
  incomplete/failed status; repeated revisions MUST NOT duplicate finalized text.
- **FR-014**: Transcription failure or lag MUST NOT stop otherwise functioning audio
  capture or discard recorded audio. Already finalized text MUST remain available
  and be identified as incomplete; the saved audio MUST be usable for later retry.
- **FR-015**: The app MUST allow at most one transcription task at a time, either
  existing-file or live transcription, and MUST clearly handle conflicting starts
  without disrupting the active task. Existing-file transcription and recording
  MUST NOT run concurrently; live transcription is part of its recording session.
- **FR-016**: Existing-file and live transcription MUST run entirely on the user's
  computer using locally available models. Recording, transcription, copying and
  saving MUST work with network access disabled. The app MUST NOT upload audio or
  transcript content, invoke a cloud transcription service, require an online
  account, or download models automatically.
- **FR-017**: Brazilian Portuguese MUST be the initial/default spoken language.
  Users MUST be able to select English when a compatible local model supporting
  English is available. The app MUST show the selected language and only mark it
  ready when its model is usable. Automatic language detection, translation and
  languages other than Brazilian Portuguese and optional English are outside MVP scope.
  Missing English assets MUST NOT prevent Brazilian Portuguese transcription.
  English speech MUST produce English text, rather than Portuguese translation.
- **FR-018**: Transcription prerequisites MUST be visible before starting a task.
  If transcription is not ready, the app MUST explain how to make it ready and
  permit recording without live transcription. It MUST NOT claim live transcription
  has started when its prerequisites have not been met.
- **FR-019**: An ordinary app close during recording MUST offer stop/save-and-close
  or cancel-close; the app MUST finish saving or report a save failure before
  closing. Closing during file transcription or post-stop finalization MUST offer
  keep-open or cancel-and-close, allow available text to be copied/saved, and obtain
  confirmation before discarding unsaved text. Source/saved audio MUST remain intact.
  Recording itself MUST NOT require an app account or network connection.
- **FR-020**: Valid speech-free audio MUST produce an explicit no-speech result;
  it MUST NOT produce fabricated speech presented as a completed transcription.
- **FR-021**: While no recording or transcription task is active, users MUST be
  able to select a local folder containing compatible transcription models/packs
  and choose the model and language to use. The app MUST list usable models with
  their supported languages, validate required files and compatibility, and clearly
  report missing, unreadable, corrupt, incomplete or unsupported content. Arbitrary model
  formats are not implied; planning MUST define and document the supported pack
  format and how users obtain and place compatible packs in a folder.
- **FR-022**: The app MUST remember the selected model folder, model and language
  across restarts and revalidate them before use. Missing or invalid models MUST
  block transcription with an actionable message without blocking recording alone.
  Model/language changes MUST NOT alter an active session or task.

### Key Entities *(include if feature involves data)*

- **Capture source**: A selectable microphone or computer-output source with a
  user-visible identity and availability.
- **Recording session**: One capture attempt with mode, selected sources, live
  transcription setting, elapsed time and completion/interruption status.
- **Audio recording**: Saved audio with local path, duration and completed/partial
  status. It can be produced by a session or supplied as an existing file.
- **Transcription task**: Processing of an existing file or an active recording,
  with processing/finalizing/completed/cancelled/failed status, selected local
  model and spoken language.
- **Transcript**: Ordered text associated with an audio source, including pending
  and finalized passages, completeness status and optional saved text-file path.
- **Local model selection**: A user-selected folder, compatible available models,
  supported languages, selected model/language and validation/readiness state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

These are proposed MVP acceptance targets, not claims of measured performance.
Planning MUST declare the reference Windows computer, audio devices, test audio
and transcription prerequisites used to verify them before implementation.

- **SC-001**: With permissions already granted and a writable folder selected, a
  first-time user can start microphone-only recording within three primary actions
  from the idle screen. The recording indicator appears within two seconds of Start.
- **SC-002**: A 60-minute microphone-only recording and a 60-minute combined recording
  each produce playable saved audio. Every scheduled local/remote test phrase is
  present; combined audio preserves source timing within 250 milliseconds at the
  beginning and end. After Stop, capture ends within one second and the saved-file
  location appears within five seconds on the reference computer.
- **SC-003**: Combined-capture acceptance passes separately in Google Meet and Discord
  with headphones: all local/remote alternating phrases and overlapping test audio
  are audible without requiring a bot, account link or call-specific integration.
- **SC-004**: For a declared test set with at least ten minutes of clean, non-overlapping
  speech in Brazilian Portuguese and, with a compatible English pack selected,
  English, completed transcripts achieve at most 20% word error
  rate against human-checked text. Existing-file tests include WAV and MP3; live tests
  cover both recording modes. Clean-audio accuracy is not a noisy-call guarantee.
  Planning MUST fix the reference-text normalization for punctuation, casing and
  written/spoken numbers before measurement. Include a separate declared speech-free
  test set to verify FR-020; no claim of universal hallucination prevention is made.
  The selected reference models MUST be recorded; these accuracy/performance targets
  do not guarantee identical results for every compatible user-supplied model.
- **SC-005**: With prerequisites ready, a supported ten-minute recording can be
  transcribed in no more than ten minutes on the reference computer/environment.
- **SC-006**: In a ten-minute live test with at least twenty separated spoken phrases,
  visible text appears within five seconds of the end of a phrase for at least 95%
  of phrases, while capture remains active. After Stop, pending text is finalized
  or explicitly marked incomplete within thirty seconds.
- **SC-007**: All induced microphone/source-loss, unwritable-folder, unsupported-file
  and transcription-failure scenarios produce an actionable visible outcome. No
  scenario silently reports partial capture or incomplete text as complete.
- **SC-008**: In each transcription-failure test during recording, capture continues
  until the user stops or a separate capture/storage failure occurs. The saved audio
  remains playable and eligible for existing-file transcription.
- **SC-009**: Copying/exporting completed text preserves the displayed words and
  Unicode characters in every acceptance case, and no import/export/recording test
  modifies the original input or silently overwrites an existing saved file.
- **SC-010**: With compatible models already present and network access disabled,
  existing-file and live transcription pass in Brazilian Portuguese and in English
  after model/language selection. Both capture modes and audio/text saving work;
  no transcription operation makes an outbound network request or requires online
  authentication, model downloads or a paid transcription service.
- **SC-011**: Folder-selection acceptance tests cover valid Portuguese and English
  models, a folder containing multiple compatible models, and missing, unreadable,
  empty, corrupt, incomplete and incompatible folders. Each produces the correct usable-model
  list or an actionable not-ready state. Selection survives restart; missing models
  never silently trigger another model, language, download or cloud fallback.

## Assumptions

- The four listed capabilities are all MVP scope despite the introduction saying
  "3 features." Priorities describe delivery order, not optional exclusions.
- Windows-only for the first version is confirmed by the user on 2026-11-02.
- Offline-only transcription, Brazilian Portuguese initially, and user-selected
  local model folders for optional English are confirmed on 2026-11-02. English
  support is enabled by the user's compatible local pack, not a required bundled
  English download. Users explicitly select the spoken language before a task.
- Users obtain compatible models outside the app and select their containing
  folder. An in-app model store/downloader and arbitrary inference-model formats
  are outside this MVP. Planning determines the supported format, reference models,
  acquisition instructions and local resource requirements without changing the
  offline-only policy.
- Rust is an explicit user delivery constraint. Frameworks, audio mechanisms,
  transcription engines, model choices and module structure belong in planning,
  not in these user-facing behavior requirements.
- One person operates the app locally. Microphone access and a writable local
  folder are required. No accounts, cloud library or team administration is needed.
- MVP recording saves WAV; imports accept WAV and MP3. Video files and other audio
  formats are outside the initial acceptance scope. These format defaults can be
  revised before planning if the user's existing recordings require another format.
- Combined capture means the entire selected computer-output source, not selection
  of an individual application, browser tab or remote speaker. Headphones are the
  baseline for call tests. Meeting/Discord settings remain under the user's control.
- Transcript timestamps, speaker labels, editing tools, translation, summaries,
  meeting bots, calendar integrations, video capture, audio editing, pause/resume,
  global hotkeys and multi-recording/job queues are outside this MVP.
- Saving audio/text as local files is sufficient; an in-app library, playback
  editor, cloud sync, automatic retention/deletion and full crash recovery are
  outside this MVP. Users can play saved recordings in an ordinary audio player.
- Performance/accuracy targets are explicit proposed acceptance baselines and must
  be checked against declared hardware and representative test recordings.

## Preservation and validation constraints

- Preserve the existing branch (`main`), constitution and agent instructions.
  This feature authorizes new product behavior; it does not authorize unrelated
  governance changes, release entries, tags or branch operations.
- At specification time no app source, language manifest or test suite exists.
  This step defines behavior only; it does not claim an implementation or a pass
  on executable acceptance tests.
- Implementation MUST begin each behavior slice with a failing test, preserve the
  relevant failure proof, and then demonstrate passing focused checks. Target at
  least 90% cheap unit tests where feasible without omitting boundary validation.
- Real-device boundary checks MUST verify microphone capture, computer-output
  capture, combined timing, file readability and transcription behavior. Keep E2E
  coverage limited to the critical recording/transcription flows above.
- Documentation-only validation checks required sections, acceptance coverage,
  measurable outcomes, local links, unresolved decisions and checklist consistency.
  User-requested explanatory docs go directly under docs/; Spec Kit feature
  artifacts stay in this feature directory.

# Restore the agreed desktop layout

The user supplied the original mockup and the running Windows build. The mockup
places source, folder and model controls in a persistent left sidebar, with a
large transcript workspace on the right and a compact timer/recording action
above it. The implemented build instead placed all controls in a single vertical
scroll area. Its transcript was height-limited and its small controls did not
match the agreed presentation.

The correction stays within the existing native egui interface. It adds no UI
framework, service, model or recording feature. Existing device/model selections,
task guards, audio/text outcomes, copy/save/cancel actions and close handling must
remain available. Recording and inference ownership do not change.

The intended arrangement is a 290-point left column with its own scrolling when
the window is short, and a flexible right workspace. Controls are at least
36 points high, the primary action 44 points, and the body font is 16 points.
The initial window is 1040 by 880 logical points, with a 760 by 600 minimum so
both columns remain usable. The transcript uses the available right-side space
and keeps export actions visible. Both Record and Transcribe file retain the
same shared model controls.

Verification exercised actual egui widget rectangles at the reference size,
a wide window, the 760 by 600 minimum and a simulated 2x display scale. Three
initial layout assertions failed before the correction. A review found that
Cancel disappeared while audio was stopping/saving; an actual-render state
regression failed before the original cancellation availability was restored.

The native Windows check then caught a missing fixture: populated combined
capture and a long model path pushed the language selector below the sidebar.
The new combined-ready test first failed with the language control at y836-872
outside a viewport ending at y860. Compact sidebar spacing, a Refresh button
beside Capture mode, and moving the visible six-hour notice to the recording
status row now place language at y742-778 and readiness at y784-800. Both are
visible at 1040 by 880 and 1014 by 856. The complete combined-mode label is also
checked for truncation.

All eleven UI tests pass, including the six existing lifecycle cases. The full
default suite passes 96 library tests and 62 integration tests, with five external
checks ignored. Formatting and all-target Clippy with warnings denied pass.
No recording/transcription algorithm, worker protocol or stored preference format
changed. Review confirmed existing task guards and actions remain present.

The final portable build was visually inspected in its native Windows window:
Record with the populated combined source/model selections, Transcribe file, and
a maximized window. Tab focused Record and then Transcribe file; Enter opened
the file screen. The selected language/readiness controls, primary action and
bottom export controls were visible. No microphone was activated for this check.
Full keyboard/Narrator, physical display-scaling and device/performance acceptance
remain separate requirements.

The corrected preview is
`dist/rustcorder-windows-layout-preview-final/rustcorder.exe`, with the complete
portable folder archived as `dist/rustcorder-windows-layout-preview-final.zip`.
The ZIP's CRCs and executable/VAD hashes were verified against its package manifest.
Earlier layout-preview folders are intermediate inspection builds.

The previously approved 28 commits were pushed first, unchanged, through
8b200d2. This correction is new work and requires its own reviewed commit groups
before any further commit or push, as requested by the user.

## Proposed commit groups for this correction

| Group | Message | Reason |
| --- | --- | --- |
| Documentation | `docs(ui): document the agreed desktop layout` | Layout rationale, verification and current preview instructions. |
| Rendering seam | `refactor(ui): isolate drawing for layout checks` | Extract the existing drawing/style entry points without changing presentation, so headless checks exercise the same UI as eframe. |
| Regression checks | `test(ui): cover desktop layout and action visibility` | Actual rendered rectangles, populated combined selections, scaling, footer placement and cancellation visibility. |
| Presentation fix | `fix(ui): restore the agreed two-column layout` | Sidebar/workspace styling, readable controls, placement and initial window geometry. |

Tests and production changes share src/ui.rs and must be staged by hunk. The test
commit reproduces the previous layout's assertion failures; the following fix
makes them pass. The rendering extraction stays separate from the visual fix.
The earlier approved 28-commit snapshot is already on origin/main; these new
groups are pending user approval.

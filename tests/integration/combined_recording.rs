//! Combined-mode lifecycle checks; real mic/output capture remains opt-in.

use super::microphone_recording::{Scratch, config, real_capture, rejected_native_start};
use rustcorder::app::{
    AppError, AudioOutcome, CaptureState, Controller, PreflightError, RecordingMode,
};
use rustcorder::recording::{RecordingStatus, WavRecording};

#[test]
fn combined_mode_requires_both_sources_without_a_microphone_only_fallback() {
    let folder = Scratch::new();
    for (mic, output, error) in [
        (
            None,
            Some("output".into()),
            PreflightError::MicrophoneUnavailable,
        ),
        (Some("mic".into()), None, PreflightError::OutputUnavailable),
    ] {
        let mut selected = config(&folder.0, RecordingMode::MicrophoneAndComputer);
        selected.microphone_id = mic;
        selected.output_id = output;
        let mut app = Controller::new(selected);
        assert_eq!(app.start_recording(Ok(())), Err(AppError::Preflight(error)));
        assert_eq!(app.capture(), &CaptureState::Idle);
        assert_eq!(app.config().mode, RecordingMode::MicrophoneAndComputer);
    }
}

#[test]
fn failed_combined_preflight_does_not_claim_partial_or_completed_capture() {
    let folder = Scratch::new();
    rejected_native_start(RecordingMode::MicrophoneAndComputer, folder.0.clone());
    // Any file reserved during preflight contains no captured frames.
    for entry in std::fs::read_dir(&folder.0).unwrap() {
        assert_eq!(
            hound::WavReader::open(entry.unwrap().path())
                .unwrap()
                .duration(),
            0
        );
    }
}

#[test]
fn selected_ids_and_mode_stay_frozen_when_another_default_is_offered() {
    let folder = Scratch::new();
    let selected = config(&folder.0, RecordingMode::MicrophoneAndComputer);
    let mut app = Controller::new(selected.clone());
    app.start_recording(Ok(())).unwrap();
    app.capture_started().unwrap();
    let mut changed_defaults = selected.clone();
    changed_defaults.microphone_id = Some("new-default-mic".into());
    changed_defaults.output_id = Some("new-default-output".into());
    changed_defaults.mode = RecordingMode::Microphone;
    assert_eq!(
        app.configure(changed_defaults),
        Err(AppError::ConfigurationLocked)
    );
    assert_eq!(app.config(), &selected);
    assert_eq!(app.start_recording(Ok(())), Err(AppError::Busy));
}

#[test]
fn combined_disconnection_discontinuity_or_overflow_preserves_partial_wav() {
    let folder = Scratch::new();
    for reason in [
        "selected output disconnected",
        "source reported missing audio",
        "bounded recording queue overflowed",
    ] {
        let mut app = Controller::new(config(&folder.0, RecordingMode::MicrophoneAndComputer));
        let mut writer = WavRecording::create(&folder.0).unwrap();
        app.start_recording(Ok(())).unwrap();
        app.capture_started().unwrap();
        // The audio module's unit tests cover the actual two-source mix and timeline.
        writer
            .append_interleaved(&[0.25, -0.25, 0.5, -0.5])
            .unwrap();
        app.stop_recording().unwrap();
        app.capture_stopped().unwrap();
        let saved = writer.finalize(Some(reason.into()));
        assert_eq!(saved.status, RecordingStatus::Partial);
        assert_eq!(hound::WavReader::open(&saved.path).unwrap().duration(), 2);
        app.finish_audio(AudioOutcome::Interrupted {
            path: Some(saved.path),
            reason: saved.error.unwrap(),
        })
        .unwrap();
        assert!(matches!(
            app.capture(),
            CaptureState::Finished(AudioOutcome::Interrupted { .. })
        ));
        assert_eq!(app.config().mode, RecordingMode::MicrophoneAndComputer);
        assert!(!app.is_busy());
    }
}

#[test]
#[ignore = "Records actual microphone plus all selected output sound; requires explicit opt-in, selected IDs, folder and duration environment variables"]
fn real_combined_start_stop_and_retained_wav() {
    real_capture(RecordingMode::MicrophoneAndComputer);
}

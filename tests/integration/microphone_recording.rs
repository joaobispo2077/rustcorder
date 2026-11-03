//! Synthetic recording lifecycle and non-activating Windows preflight checks.

use rustcorder::app::{
    AppConfig, AppError, AudioOutcome, CaptureState, ClosePlan, Controller, ModelState,
    PreflightError, RecordingMode,
};
use rustcorder::audio::{self, AudioEvent, CaptureConfig};
use rustcorder::recording::{RecordingStatus, WavRecording};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub(super) struct Scratch(pub PathBuf);
impl Scratch {
    pub(super) fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "rustcorder-recording-ação-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn config(folder: &Path, mode: RecordingMode) -> AppConfig {
    AppConfig {
        mode,
        microphone_id: Some("synthetic-selected-mic".into()),
        output_id: (mode == RecordingMode::MicrophoneAndComputer)
            .then(|| "synthetic-selected-output".into()),
        save_folder: folder.into(),
        ..AppConfig::default()
    }
}

#[test]
fn synthetic_start_stop_saves_readable_audio_without_a_model() {
    let folder = Scratch::new();
    let mut app = Controller::new(config(&folder.0, RecordingMode::Microphone));
    let mut writer = WavRecording::create(&folder.0).unwrap();
    app.start_recording(Ok(())).unwrap();
    assert_eq!(app.capture(), &CaptureState::Starting);
    app.capture_started().unwrap();
    assert_eq!(app.model(), &ModelState::NotConfigured);
    writer.append_interleaved(&vec![0.125; 9_600]).unwrap();
    assert_eq!(app.start_recording(Ok(())), Err(AppError::Busy));
    assert_eq!(
        app.start_file_transcription("other.wav".into()),
        Err(AppError::Busy)
    );
    assert_eq!(
        app.finish_audio(AudioOutcome::Completed(writer.path().into())),
        Err(AppError::InvalidTransition)
    );
    app.stop_recording().unwrap();
    app.capture_stopped().unwrap();
    assert_eq!(app.close_plan(false), ClosePlan::StopAndSave);
    let saved = writer.finalize(None);
    assert_eq!(saved.status, RecordingStatus::Completed);
    assert_eq!(saved.frames, 4_800);
    let wav = hound::WavReader::open(&saved.path).unwrap();
    assert_eq!(wav.duration(), 4_800);
    assert_eq!(wav.spec().channels, 2);
    assert_eq!(wav.spec().sample_rate, 48_000);
    assert_eq!(wav.spec().bits_per_sample, 16);
    app.finish_audio(AudioOutcome::Completed(saved.path))
        .unwrap();
    assert!(!app.is_busy());
    assert_eq!(app.close_plan(false), ClosePlan::Close);
    assert_eq!(app.close_plan(true), ClosePlan::DiscardUnsavedText);
    assert!(app.start_recording(Ok(())).is_ok());
}

#[test]
fn synthetic_interruption_preserves_readable_partial_audio() {
    let folder = Scratch::new();
    let mut app = Controller::new(config(&folder.0, RecordingMode::Microphone));
    let mut writer = WavRecording::create(&folder.0).unwrap();
    app.start_recording(Ok(())).unwrap();
    app.capture_started().unwrap();
    writer.append_pcm(&[100, -100, 200, -200]).unwrap();
    assert_eq!(app.close_plan(false), ClosePlan::StopAndSave);
    app.stop_recording().unwrap();
    app.capture_stopped().unwrap();
    let saved = writer.finalize(Some("selected microphone disconnected".into()));
    assert_eq!(saved.status, RecordingStatus::Partial);
    assert_eq!(hound::WavReader::open(&saved.path).unwrap().duration(), 2);
    app.finish_audio(AudioOutcome::Interrupted {
        path: Some(saved.path.clone()),
        reason: saved.error.unwrap(),
    })
    .unwrap();
    assert!(
        matches!(app.capture(), CaptureState::Finished(AudioOutcome::Interrupted { path: Some(path), .. }) if path == &saved.path)
    );
    assert!(!app.is_busy());
}

#[test]
fn configuration_is_frozen_until_the_synthetic_writer_finishes() {
    let folder = Scratch::new();
    let original = config(&folder.0, RecordingMode::Microphone);
    let mut app = Controller::new(original.clone());
    let writer = WavRecording::create(&folder.0).unwrap();
    app.start_recording(Ok(())).unwrap();
    let changed = config(
        Path::new("another-folder"),
        RecordingMode::MicrophoneAndComputer,
    );
    assert_eq!(
        app.configure(changed.clone()),
        Err(AppError::ConfigurationLocked)
    );
    app.capture_started().unwrap();
    app.stop_recording().unwrap();
    app.capture_stopped().unwrap();
    assert_eq!(app.configure(changed), Err(AppError::ConfigurationLocked));
    assert_eq!(app.config(), &original);
    let saved = writer.finalize(None);
    app.finish_audio(AudioOutcome::Completed(saved.path))
        .unwrap();
    assert!(app.configure(AppConfig::default()).is_ok());
}

pub(super) fn rejected_native_start(mode: RecordingMode, destination: PathBuf) -> String {
    // Both IDs are deliberately nonexistent: this boundary test never activates a mic.
    let mut selected = config(&destination, mode);
    selected.microphone_id = Some("rustcorder-nonexistent-mic-preflight".into());
    selected.output_id = (mode == RecordingMode::MicrophoneAndComputer)
        .then(|| "rustcorder-nonexistent-output-preflight".into());
    let mut app = Controller::new(selected.clone());
    app.start_recording(Ok(())).unwrap();
    let session = audio::start(
        CaptureConfig {
            mode,
            microphone_id: selected.microphone_id.unwrap(),
            output_id: selected.output_id,
            save_folder: destination,
        },
        None,
    )
    .unwrap();
    let message = match session.events.recv_timeout(Duration::from_secs(6)).unwrap() {
        AudioEvent::Failed(message) => message,
        event => panic!("Invalid source/destination claimed capture: {event:?}"),
    };
    app.fail_capture_start(message.clone()).unwrap();
    assert!(matches!(
        app.capture(),
        CaptureState::Finished(AudioOutcome::Failed(_))
    ));
    assert!(!app.is_busy());
    assert!(!session.events.try_iter().any(|event| matches!(
        event,
        AudioEvent::Started
            | AudioEvent::Finished {
                interrupted: None,
                ..
            }
    )));
    message
}

#[test]
fn native_missing_mic_and_unwritable_destination_never_claim_recording() {
    let folder = Scratch::new();
    rejected_native_start(RecordingMode::Microphone, folder.0.clone());
    let occupied = folder.0.join("occupied-file");
    std::fs::write(&occupied, b"keep existing data").unwrap();
    let message = rejected_native_start(RecordingMode::Microphone, occupied.clone());
    assert!(message.contains("save") || message.contains("local recording"));
    assert_eq!(std::fs::read(occupied).unwrap(), b"keep existing data");
}

#[test]
fn destination_preflight_and_save_failure_have_distinct_honest_outcomes() {
    let folder = Scratch::new();
    let mut app = Controller::new(config(&folder.0, RecordingMode::Microphone));
    assert_eq!(
        app.start_recording(Err(PreflightError::DestinationUnwritable)),
        Err(AppError::Preflight(PreflightError::DestinationUnwritable))
    );
    assert_eq!(app.capture(), &CaptureState::Idle);
    app.start_recording(Ok(())).unwrap();
    app.capture_started().unwrap();
    app.stop_recording().unwrap();
    app.capture_stopped().unwrap();
    app.finish_audio(AudioOutcome::Failed(
        "WAV finalization failed: injected disk failure".into(),
    ))
    .unwrap();
    assert!(matches!(
        app.capture(),
        CaptureState::Finished(AudioOutcome::Failed(_))
    ));
    assert!(!matches!(
        app.capture(),
        CaptureState::Finished(AudioOutcome::Completed(_))
    ));
    // Actual write/finalize failure injection is covered at RecordingWriter's I/O boundary.
}

pub(super) fn real_capture(mode: RecordingMode) {
    assert_eq!(
        std::env::var("RUSTCORDER_ALLOW_AUDIO_CAPTURE").as_deref(),
        Ok("1"),
        "Explicit microphone-capture opt-in is required"
    );
    let microphone_id =
        std::env::var("RUSTCORDER_TEST_MIC_ID").expect("Set the selected stable microphone ID");
    let output_id = (mode == RecordingMode::MicrophoneAndComputer).then(|| {
        std::env::var("RUSTCORDER_TEST_OUTPUT_ID").expect("Set the selected stable output ID")
    });
    let save_folder = PathBuf::from(
        std::env::var("RUSTCORDER_TEST_SAVE_FOLDER")
            .expect("Set an existing folder for retained real audio"),
    );
    let seconds: u64 = std::env::var("RUSTCORDER_TEST_SECONDS")
        .expect("Set the deliberate capture duration, for example 5 or 3600")
        .parse()
        .unwrap();
    assert!((1..=21_600).contains(&seconds));
    let session = audio::start(
        CaptureConfig {
            mode,
            microphone_id,
            output_id,
            save_folder,
        },
        None,
    )
    .unwrap();
    assert!(matches!(
        session.events.recv_timeout(Duration::from_secs(6)).unwrap(),
        AudioEvent::Started
    ));
    let began = Instant::now();
    while began.elapsed() < Duration::from_secs(seconds) {
        match session.events.recv_timeout(Duration::from_millis(100)) {
            Ok(event) => assert!(
                matches!(event, AudioEvent::Level { .. }),
                "Recording ended early: {event:?}"
            ),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(error) => panic!("Recording event channel closed: {error}"),
        }
    }
    let stopped = Instant::now();
    session.stop();
    loop {
        let remaining = Duration::from_secs(30)
            .checked_sub(stopped.elapsed())
            .expect("Recording did not finalize within thirty seconds");
        match session.events.recv_timeout(remaining).unwrap() {
            AudioEvent::Level { .. } => {}
            AudioEvent::Finished {
                path,
                frames,
                interrupted: None,
            } => {
                assert!(stopped.elapsed() <= Duration::from_secs(30));
                assert_eq!(
                    hound::WavReader::open(&path).unwrap().duration() as u64,
                    frames
                );
                let file_seconds = frames as f64 / 48_000.0;
                assert!(
                    (file_seconds - seconds as f64).abs() < 1.0,
                    "Unexpected file duration: {file_seconds}"
                );
                println!(
                    "Retained {} frames at {}; stop-to-saved {:?}. Audible phrases, source alignment and peak memory require separate observations.",
                    frames,
                    path.display(),
                    stopped.elapsed()
                );
                break;
            }
            event => panic!("Real capture did not complete successfully: {event:?}"),
        }
    }
}

#[test]
#[ignore = "Records actual microphone audio; requires explicit opt-in, selected ID, folder and duration environment variables"]
fn real_microphone_start_stop_and_retained_wav() {
    real_capture(RecordingMode::Microphone);
}

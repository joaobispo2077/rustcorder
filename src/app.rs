//! Pure task coordination; audio, model loading and file I/O remain outside it.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingMode {
    #[default]
    Microphone,
    MicrophoneAndComputer,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Language {
    #[default]
    #[serde(rename = "pt")]
    Portuguese,
    #[serde(rename = "en")]
    English,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelConfig {
    pub path: PathBuf,
    pub language: Language,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub mode: RecordingMode,
    pub microphone_id: Option<String>,
    pub output_id: Option<String>,
    pub save_folder: PathBuf,
    pub live_transcription: bool,
    pub model: Option<ModelConfig>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum CaptureState {
    #[default]
    Idle,
    Starting,
    Recording,
    Stopping,
    Saving,
    Finished(AudioOutcome),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AudioOutcome {
    Completed(PathBuf),
    Interrupted {
        path: Option<PathBuf>,
        reason: String,
    },
    Failed(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum TranscriptionState {
    #[default]
    Idle,
    Live,
    File(PathBuf),
    Finalizing,
    Finished(TextOutcome),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextOutcome {
    Completed,
    NoSpeech,
    Cancelled,
    Incomplete(String),
    Failed(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ModelState {
    #[default]
    NotConfigured,
    Checking,
    Ready,
    Invalid(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreflightError {
    MicrophoneUnavailable,
    OutputUnavailable,
    DestinationUnwritable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppError {
    Busy,
    ConfigurationLocked,
    Preflight(PreflightError),
    ModelUnavailable,
    InvalidTransition,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClosePlan {
    Close,
    StopAndSave,
    CancelTranscription,
    DiscardUnsavedText,
}

#[derive(Debug, Default)]
pub struct Controller {
    config: AppConfig,
    capture: CaptureState,
    transcription: TranscriptionState,
    model: ModelState,
}

impl Controller {
    pub fn close_plan(&self, unsaved_text: bool) -> ClosePlan {
        if matches!(
            self.capture,
            CaptureState::Starting
                | CaptureState::Recording
                | CaptureState::Stopping
                | CaptureState::Saving
        ) {
            ClosePlan::StopAndSave
        } else if self.is_busy() {
            ClosePlan::CancelTranscription
        } else if unsaved_text {
            ClosePlan::DiscardUnsavedText
        } else {
            ClosePlan::Close
        }
    }
    pub fn new(config: AppConfig) -> Self {
        Self {
            config,
            ..Self::default()
        }
    }

    pub fn config(&self) -> &AppConfig {
        &self.config
    }
    pub fn capture(&self) -> &CaptureState {
        &self.capture
    }
    pub fn transcription(&self) -> &TranscriptionState {
        &self.transcription
    }
    pub fn model(&self) -> &ModelState {
        &self.model
    }
    pub fn is_busy(&self) -> bool {
        matches!(
            self.capture,
            CaptureState::Starting
                | CaptureState::Recording
                | CaptureState::Stopping
                | CaptureState::Saving
        ) || matches!(
            self.transcription,
            TranscriptionState::Live | TranscriptionState::File(_) | TranscriptionState::Finalizing
        ) || self.model == ModelState::Checking
    }

    pub fn configure(&mut self, config: AppConfig) -> Result<(), AppError> {
        if self.is_busy() {
            return Err(AppError::ConfigurationLocked);
        }
        if config.model != self.config.model {
            self.model = ModelState::NotConfigured;
        }
        self.config = config;
        Ok(())
    }

    fn require_idle(&self) -> Result<(), AppError> {
        if self.is_busy() {
            Err(AppError::Busy)
        } else {
            Ok(())
        }
    }

    pub fn start_model_validation(&mut self) -> Result<(), AppError> {
        self.require_idle()?;
        if self.config.model.is_none() {
            return Err(AppError::ModelUnavailable);
        }
        self.model = ModelState::Checking;
        Ok(())
    }

    pub fn finish_model_validation(&mut self, result: Result<(), String>) -> Result<(), AppError> {
        if self.model != ModelState::Checking {
            return Err(AppError::InvalidTransition);
        }
        self.model = match result {
            Ok(()) => ModelState::Ready,
            Err(reason) => ModelState::Invalid(reason),
        };
        Ok(())
    }

    pub fn start_recording(
        &mut self,
        preflight: Result<(), PreflightError>,
    ) -> Result<(), AppError> {
        self.require_idle()?;
        if self
            .config
            .microphone_id
            .as_ref()
            .is_none_or(|id| id.is_empty())
        {
            return Err(AppError::Preflight(PreflightError::MicrophoneUnavailable));
        }
        if self.config.mode == RecordingMode::MicrophoneAndComputer
            && self
                .config
                .output_id
                .as_ref()
                .is_none_or(|id| id.is_empty())
        {
            return Err(AppError::Preflight(PreflightError::OutputUnavailable));
        }
        if self.config.save_folder.as_os_str().is_empty() {
            return Err(AppError::Preflight(PreflightError::DestinationUnwritable));
        }
        preflight.map_err(AppError::Preflight)?;
        if self.config.live_transcription && self.model != ModelState::Ready {
            return Err(AppError::ModelUnavailable);
        }
        self.capture = CaptureState::Starting;
        Ok(())
    }

    pub fn capture_started(&mut self) -> Result<(), AppError> {
        if self.capture != CaptureState::Starting {
            return Err(AppError::InvalidTransition);
        }
        self.capture = CaptureState::Recording;
        if self.config.live_transcription {
            self.transcription = TranscriptionState::Live;
        }
        Ok(())
    }

    pub fn fail_capture_start(&mut self, reason: String) -> Result<(), AppError> {
        if self.capture != CaptureState::Starting {
            return Err(AppError::InvalidTransition);
        }
        self.capture = CaptureState::Finished(AudioOutcome::Failed(reason));
        Ok(())
    }

    pub fn stop_recording(&mut self) -> Result<(), AppError> {
        if !matches!(
            self.capture,
            CaptureState::Starting | CaptureState::Recording
        ) {
            return Err(AppError::InvalidTransition);
        }
        self.capture = CaptureState::Stopping;
        Ok(())
    }

    pub fn capture_stopped(&mut self) -> Result<(), AppError> {
        if self.capture != CaptureState::Stopping {
            return Err(AppError::InvalidTransition);
        }
        self.capture = CaptureState::Saving;
        if self.transcription == TranscriptionState::Live {
            self.transcription = TranscriptionState::Finalizing;
        }
        Ok(())
    }

    pub fn finish_audio(&mut self, outcome: AudioOutcome) -> Result<(), AppError> {
        if self.capture != CaptureState::Saving {
            return Err(AppError::InvalidTransition);
        }
        self.capture = CaptureState::Finished(outcome);
        Ok(())
    }

    pub fn start_file_transcription(&mut self, path: PathBuf) -> Result<(), AppError> {
        self.require_idle()?;
        if self.model != ModelState::Ready {
            return Err(AppError::ModelUnavailable);
        }
        self.transcription = TranscriptionState::File(path);
        Ok(())
    }

    pub fn finish_transcription(&mut self, outcome: TextOutcome) -> Result<(), AppError> {
        if self.transcription == TranscriptionState::Live
            && matches!(outcome, TextOutcome::Completed | TextOutcome::NoSpeech)
        {
            return Err(AppError::InvalidTransition);
        }
        if !matches!(
            self.transcription,
            TranscriptionState::Live | TranscriptionState::File(_) | TranscriptionState::Finalizing
        ) {
            return Err(AppError::InvalidTransition);
        }
        self.transcription = TranscriptionState::Finished(outcome);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_plan_secures_audio_before_cancelling_text_or_discarding_words() {
        let mut app = ready_controller(true);
        app.start_recording(Ok(())).unwrap();
        app.capture_started().unwrap();
        assert_eq!(app.close_plan(true), ClosePlan::StopAndSave);
        app.stop_recording().unwrap();
        app.capture_stopped().unwrap();
        assert_eq!(app.close_plan(true), ClosePlan::StopAndSave);
        app.finish_audio(AudioOutcome::Completed("audio.wav".into()))
            .unwrap();
        assert_eq!(app.close_plan(true), ClosePlan::CancelTranscription);
        app.finish_transcription(TextOutcome::Cancelled).unwrap();
        assert_eq!(app.close_plan(true), ClosePlan::DiscardUnsavedText);
        assert_eq!(app.close_plan(false), ClosePlan::Close);
    }

    fn recording_config() -> AppConfig {
        AppConfig {
            microphone_id: Some("mic-1".into()),
            save_folder: "recordings".into(),
            ..AppConfig::default()
        }
    }

    fn ready_controller(live: bool) -> Controller {
        let mut config = recording_config();
        config.live_transcription = live;
        config.model = Some(ModelConfig {
            path: "models/ggml-base.bin".into(),
            language: Language::Portuguese,
        });
        let mut app = Controller::new(config);
        app.start_model_validation().unwrap();
        app.finish_model_validation(Ok(())).unwrap();
        app
    }

    #[test]
    fn live_success_waits_for_capture_stop() {
        for outcome in [TextOutcome::Completed, TextOutcome::NoSpeech] {
            let mut app = ready_controller(true);
            app.start_recording(Ok(())).unwrap();
            app.capture_started().unwrap();
            assert_eq!(
                app.finish_transcription(outcome),
                Err(AppError::InvalidTransition)
            );
            assert_eq!(app.transcription(), &TranscriptionState::Live);
            app.stop_recording().unwrap();
            app.capture_stopped().unwrap();
            assert_eq!(app.transcription(), &TranscriptionState::Finalizing);
        }
    }

    #[test]
    fn recording_does_not_require_models_and_reports_actual_start() {
        let mut app = Controller::new(recording_config());
        app.start_recording(Ok(())).unwrap();
        assert_eq!(app.capture(), &CaptureState::Starting);
        app.capture_started().unwrap();
        assert_eq!(app.capture(), &CaptureState::Recording);
        assert_eq!(app.model(), &ModelState::NotConfigured);
    }

    #[test]
    fn second_capture_and_file_task_cannot_replace_active_capture() {
        let mut app = ready_controller(false);
        app.start_recording(Ok(())).unwrap();
        app.capture_started().unwrap();
        assert_eq!(app.start_recording(Ok(())), Err(AppError::Busy));
        assert_eq!(
            app.start_file_transcription("source.wav".into()),
            Err(AppError::Busy)
        );
        assert_eq!(app.capture(), &CaptureState::Recording);
    }

    #[test]
    fn preflight_errors_do_not_claim_recording() {
        for error in [
            PreflightError::MicrophoneUnavailable,
            PreflightError::OutputUnavailable,
            PreflightError::DestinationUnwritable,
        ] {
            let mut app = Controller::new(recording_config());
            assert_eq!(
                app.start_recording(Err(error)),
                Err(AppError::Preflight(error))
            );
            assert_eq!(app.capture(), &CaptureState::Idle);
            assert!(!app.is_busy());
        }
    }

    #[test]
    fn missing_source_selection_is_rejected_even_if_probe_says_ready() {
        let mut app = Controller::new(AppConfig::default());
        assert_eq!(
            app.start_recording(Ok(())),
            Err(AppError::Preflight(PreflightError::MicrophoneUnavailable))
        );
        let mut config = recording_config();
        config.mode = RecordingMode::MicrophoneAndComputer;
        app.configure(config).unwrap();
        assert_eq!(
            app.start_recording(Ok(())),
            Err(AppError::Preflight(PreflightError::OutputUnavailable))
        );
    }

    #[test]
    fn live_recording_requires_validated_model_but_plain_recording_does_not() {
        let mut config = recording_config();
        config.live_transcription = true;
        let mut app = Controller::new(config.clone());
        assert_eq!(app.start_recording(Ok(())), Err(AppError::ModelUnavailable));
        config.live_transcription = false;
        app.configure(config).unwrap();
        assert!(app.start_recording(Ok(())).is_ok());
    }

    #[test]
    fn model_validation_blocks_conflicting_work_and_failure_does_not_block_plain_recording() {
        let mut app = ready_controller(false);
        app.start_model_validation().unwrap();
        assert_eq!(app.start_recording(Ok(())), Err(AppError::Busy));
        assert_eq!(
            app.start_file_transcription("source.wav".into()),
            Err(AppError::Busy)
        );
        app.finish_model_validation(Err("missing weights".into()))
            .unwrap();
        assert_eq!(
            app.start_file_transcription("source.wav".into()),
            Err(AppError::ModelUnavailable)
        );
        assert!(app.start_recording(Ok(())).is_ok());
    }

    #[test]
    fn active_configuration_is_immutable_through_saving_and_finalization() {
        let mut app = ready_controller(true);
        let original = app.config().clone();
        app.start_recording(Ok(())).unwrap();
        app.capture_started().unwrap();
        assert_eq!(
            app.configure(AppConfig::default()),
            Err(AppError::ConfigurationLocked)
        );
        assert_eq!(app.config(), &original);
        app.stop_recording().unwrap();
        assert_eq!(app.capture(), &CaptureState::Stopping);
        app.capture_stopped().unwrap();
        assert_eq!(app.capture(), &CaptureState::Saving);
        assert_eq!(app.transcription(), &TranscriptionState::Finalizing);
        app.finish_audio(AudioOutcome::Completed("saved.wav".into()))
            .unwrap();
        assert_eq!(app.start_recording(Ok(())), Err(AppError::Busy));
        assert_eq!(
            app.configure(AppConfig::default()),
            Err(AppError::ConfigurationLocked)
        );
        app.finish_transcription(TextOutcome::Completed).unwrap();
        assert!(app.configure(AppConfig::default()).is_ok());
        assert_eq!(app.model(), &ModelState::NotConfigured);
    }

    #[test]
    fn transcription_failure_never_stops_active_capture() {
        let mut app = ready_controller(true);
        app.start_recording(Ok(())).unwrap();
        app.capture_started().unwrap();
        app.finish_transcription(TextOutcome::Incomplete("worker exited".into()))
            .unwrap();
        assert_eq!(app.capture(), &CaptureState::Recording);
        assert!(app.is_busy());
        app.stop_recording().unwrap();
        app.capture_stopped().unwrap();
        app.finish_audio(AudioOutcome::Completed("saved.wav".into()))
            .unwrap();
        assert_eq!(
            app.transcription(),
            &TranscriptionState::Finished(TextOutcome::Incomplete("worker exited".into()))
        );
        assert!(!app.is_busy());
    }

    #[test]
    fn audio_failure_and_successful_text_are_independent_results() {
        let mut app = ready_controller(true);
        app.start_recording(Ok(())).unwrap();
        app.capture_started().unwrap();
        app.stop_recording().unwrap();
        app.capture_stopped().unwrap();
        app.finish_audio(AudioOutcome::Failed("disk full".into()))
            .unwrap();
        app.finish_transcription(TextOutcome::Completed).unwrap();
        assert_eq!(
            app.capture(),
            &CaptureState::Finished(AudioOutcome::Failed("disk full".into()))
        );
        assert_eq!(
            app.transcription(),
            &TranscriptionState::Finished(TextOutcome::Completed)
        );
    }

    #[test]
    fn file_task_is_exclusive_and_cancel_releases_it() {
        let mut app = ready_controller(false);
        app.start_file_transcription("input.wav".into()).unwrap();
        assert_eq!(
            app.start_file_transcription("another.wav".into()),
            Err(AppError::Busy)
        );
        assert_eq!(app.start_recording(Ok(())), Err(AppError::Busy));
        assert_eq!(app.start_model_validation(), Err(AppError::Busy));
        app.finish_transcription(TextOutcome::Cancelled).unwrap();
        assert!(!app.is_busy());
        assert!(app.start_recording(Ok(())).is_ok());
    }

    #[test]
    fn native_start_failure_never_claims_saved_audio_or_running_text() {
        let mut app = ready_controller(true);
        app.start_recording(Ok(())).unwrap();
        app.fail_capture_start("device disappeared".into()).unwrap();
        assert_eq!(
            app.capture(),
            &CaptureState::Finished(AudioOutcome::Failed("device disappeared".into()))
        );
        assert_eq!(app.transcription(), &TranscriptionState::Idle);
        assert!(!app.is_busy());
    }

    #[test]
    fn invalid_completion_events_return_errors_without_changing_state() {
        let mut app = Controller::new(recording_config());
        assert_eq!(app.capture_started(), Err(AppError::InvalidTransition));
        assert_eq!(
            app.finish_audio(AudioOutcome::Completed("fake.wav".into())),
            Err(AppError::InvalidTransition)
        );
        assert_eq!(
            app.finish_transcription(TextOutcome::Completed),
            Err(AppError::InvalidTransition)
        );
        assert_eq!(
            app.finish_model_validation(Ok(())),
            Err(AppError::InvalidTransition)
        );
        assert_eq!(app.capture(), &CaptureState::Idle);
    }
}

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

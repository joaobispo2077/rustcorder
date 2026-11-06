//! Native desktop controls. Capture and inference are owned by background threads.

use crate::{
    app::*,
    audio::{self, AudioEvent, CaptureConfig, DeviceInfo, DeviceKind, LiveChunk, Session},
    models::{self, ModelCandidate},
    settings::{self, Settings},
    transcription::{
        EventKind, ModelMetadata,
        jobs::{Job, JobEvent},
        transcript::Transcript,
    },
};
use eframe::egui::{self, Color32, RichText};
use std::{
    path::PathBuf,
    sync::mpsc::{self, Receiver, SyncSender},
    time::Duration,
};

enum Background {
    Devices(Result<Vec<DeviceInfo>, String>),
    Capture(Result<Session, String>),
}
#[derive(Clone, Copy, PartialEq)]
enum JobMode {
    Models,
    File,
    Live,
}

pub struct Desktop {
    controller: Controller,
    settings: Settings,
    devices: Vec<DeviceInfo>,
    models: Vec<(ModelCandidate, Result<ModelMetadata, String>)>,
    background: Receiver<Background>,
    background_sender: mpsc::Sender<Background>,
    session: Option<Session>,
    capture_pending: bool,
    job: Option<Job>,
    job_mode: Option<JobMode>,
    live_input: Option<SyncSender<LiveChunk>>,
    transcript: Transcript,
    file: Option<PathBuf>,
    file_tab: bool,
    status: String,
    notice: String,
    peak: f32,
    frames: u64,
    close_prompt: bool,
    close_after: bool,
    stopped_early: bool,
    text_failure: Option<String>,
    user_cancelled: bool,
    pending_live_finish: Option<JobEvent>,
}

impl Desktop {
    pub fn new(context: &eframe::CreationContext<'_>) -> Self {
        configure_style(&context.egui_ctx);
        let (settings, notice) = match settings::default_path()
            .and_then(|path| settings::load(&path))
        {
            Ok(settings) => (settings, String::new()),
            Err(error) => (
                Settings::default(),
                format!(
                    "Settings could not be restored: {error}. Choose your folders and devices again."
                ),
            ),
        };
        let (sender, background) = mpsc::channel();
        let mut app = Self {
            controller: Controller::new(settings.config.clone()),
            settings,
            devices: Vec::new(),
            models: Vec::new(),
            background,
            background_sender: sender,
            session: None,
            capture_pending: false,
            job: None,
            job_mode: None,
            live_input: None,
            transcript: Transcript::default(),
            file: None,
            file_tab: false,
            status: "Ready to record. Choose a microphone and save folder.".into(),
            notice,
            peak: 0.0,
            frames: 0,
            close_prompt: false,
            close_after: false,
            stopped_early: false,
            text_failure: None,
            user_cancelled: false,
            pending_live_finish: None,
        };
        app.refresh_devices();
        if let Some(folder) = app.settings.model_folder.clone() {
            app.scan_models(folder);
        }
        app
    }
    fn busy(&self) -> bool {
        ui_busy(
            &self.controller,
            self.job.is_some() || self.capture_pending || self.session.is_some(),
        )
    }
    fn refresh_devices(&self) {
        let sender = self.background_sender.clone();
        std::thread::spawn(move || {
            let _ = sender.send(Background::Devices(
                audio::enumerate().map_err(|e| e.to_string()),
            ));
        });
    }
    fn persist(&mut self) {
        self.settings.config = self.controller.config().clone();
        if let Err(error) =
            settings::default_path().and_then(|path| settings::save(&path, &self.settings))
        {
            self.notice = format!("Preferences were not saved: {error}");
        }
    }
    fn scan_models(&mut self, folder: PathBuf) {
        match models::discover_models(&folder) {
            Ok(candidates) if !candidates.is_empty()=> {
                self.settings.model_folder=Some(folder);
                self.models.clear();
                let mut config=self.controller.config().clone();
                if !candidates.iter().any(|c|config.model.as_ref().is_some_and(|m|m.path==c.path)) {
                    config.model=Some(ModelConfig {path:candidates[0].path.clone(),language:Language::Portuguese});
                }
                if self.controller.configure(config).is_err() || self.controller.start_model_validation().is_err() { return; }
                self.job=Some(Job::validate(candidates)); self.job_mode=Some(JobMode::Models);
                self.status="Checking local model files…".into(); self.persist();
            }
            Ok(_)=>self.notice="No supported models found. Place ggml-base.bin, ggml-small.bin, ggml-base.en.bin or ggml-small.en.bin directly in the selected folder.".into(),
            Err(error)=>self.notice=format!("Cannot read the model folder: {error}. Select an available local folder."),
        }
    }
    fn update_model_readiness(&mut self) {
        let result=self.controller.config().model.as_ref().and_then(|selected|self.models.iter().find(|(c,_)|c.path==selected.path).map(|(_,r)|r.clone().and_then(|m|models::supported_languages(&m)).and_then(|languages|if languages.contains(&selected.language){Ok(())}else{Err("This model does not support the selected language. Choose a multilingual model for Portuguese.".into())}))).unwrap_or(Err("Choose a valid local model.".into()));
        if self.controller.model() != &ModelState::Checking {
            let _ = self.controller.start_model_validation();
        }
        let _ = self.controller.finish_model_validation(result);
    }
    fn begin_audio(&mut self) {
        if self.capture_pending || self.session.is_some() {
            return;
        }
        let config = self.controller.config();
        let capture = CaptureConfig {
            mode: config.mode,
            microphone_id: config.microphone_id.clone().unwrap_or_default(),
            output_id: config.output_id.clone(),
            save_folder: config.save_folder.clone(),
        };
        let live = self.live_input.take();
        let sender = self.background_sender.clone();
        self.capture_pending = true;
        std::thread::spawn(move || {
            let _ = sender.send(Background::Capture(
                audio::start(capture, live).map_err(|e| e.to_string()),
            ));
        });
    }
    fn start_recording(&mut self) {
        if self.transcript.unsaved() {
            self.notice =
                "Save the previous transcript, or choose Discard transcript before starting again."
                    .into();
            return;
        }
        match self.controller.start_recording(Ok(())) {
            Ok(()) => {
                self.transcript = Transcript::default();
                self.frames = 0;
                self.stopped_early = false;
                self.text_failure = None;
                self.user_cancelled = false;
                self.status = "Starting selected audio sources…".into();
                if self.controller.config().live_transcription {
                    let (job, input) = Job::live(self.controller.config().model.clone().unwrap());
                    self.job = Some(job);
                    self.job_mode = Some(JobMode::Live);
                    self.live_input = Some(input);
                    self.status = "Loading the local model before recording…".into();
                } else {
                    self.begin_audio();
                }
            }
            Err(error) => {
                self.notice = format!(
                    "Cannot start: {error:?}. Check the selected sources, save folder and live-text model."
                )
            }
        }
    }
    fn stop_recording(&mut self) {
        self.stopped_early = true;
        if let Some(session) = &self.session {
            session.stop();
        }
        let _ = self.controller.stop_recording();
        if !self.capture_pending && self.session.is_none() {
            self.live_input.take();
            if let Some(job) = &self.job {
                job.cancel();
            }
            let _ = self.controller.capture_stopped();
            let _ = self.controller.finish_audio(AudioOutcome::Failed(
                "Stopped before audio capture began; no recording was created.".into(),
            ));
        }
        self.status = "Stopping capture and saving audio…".into();
    }
    fn start_file(&mut self) {
        let Some(path) = self.file.clone() else {
            return;
        };
        if self.transcript.unsaved() {
            self.notice = "Save or discard the previous transcript first.".into();
            return;
        }
        match self.controller.start_file_transcription(path.clone()) {
            Ok(()) => {
                self.user_cancelled = false;
                self.transcript = Transcript::default();
                self.job = Some(Job::file(
                    self.controller.config().model.clone().unwrap(),
                    path,
                ));
                self.job_mode = Some(JobMode::File);
                self.status = "Loading the local model…".into();
            }
            Err(error) => {
                self.notice =
                    format!("Cannot transcribe: {error:?}. Select a usable local model first.")
            }
        }
    }
    fn poll_text_errors(&mut self) {
        let text_errors = self
            .session
            .as_ref()
            .map(|s| s.transcription_errors.try_iter().collect::<Vec<_>>())
            .unwrap_or_default();
        for message in text_errors {
            self.transcript.fail(message.clone());
            self.notice = message.clone();
            if self.controller.capture() == &CaptureState::Starting {
                self.text_failure = Some(message);
            }
            if let Some(job) = &self.job {
                job.cancel();
            }
        }
    }
    fn finish_audio_session(&mut self) {
        self.poll_text_errors();
        self.session = None;
    }
    fn poll(&mut self) {
        self.poll_text_errors();
        while let Ok(event) = self.background.try_recv() {
            match event {
                Background::Devices(Ok(devices)) => {
                    self.devices = devices;
                    if !self.busy() {
                        let mut config = self.controller.config().clone();
                        for (kind, selected) in [
                            (DeviceKind::Microphone, &mut config.microphone_id),
                            (DeviceKind::ComputerOutput, &mut config.output_id),
                        ] {
                            if selected.is_none() {
                                *selected = self
                                    .devices
                                    .iter()
                                    .find(|d| d.kind == kind && d.is_default)
                                    .or_else(|| self.devices.iter().find(|d| d.kind == kind))
                                    .map(|d| d.id.clone());
                            }
                        }
                        let _ = self.controller.configure(config);
                        self.persist();
                    }
                }
                Background::Devices(Err(message)) => self.notice = message,
                Background::Capture(result) => {
                    self.capture_pending = false;
                    match result {
                        Ok(session) => {
                            if self.stopped_early {
                                session.stop();
                            }
                            self.session = Some(session);
                        }
                        Err(message) => {
                            if self.controller.capture() == &CaptureState::Starting {
                                let _ = self.controller.fail_capture_start(message.clone());
                            } else {
                                let _ = self.controller.capture_stopped();
                                let _ = self
                                    .controller
                                    .finish_audio(AudioOutcome::Failed(message.clone()));
                            }
                            if let Some(job) = &self.job {
                                job.cancel();
                            }
                            self.live_input.take();
                            self.status = message;
                            self.close_after = false;
                        }
                    }
                }
            }
        }
        let audio_events = self
            .session
            .as_ref()
            .map(|s| s.events.try_iter().collect::<Vec<_>>())
            .unwrap_or_default();
        for event in audio_events {
            match event {
                AudioEvent::Started => {
                    if self.controller.capture() == &CaptureState::Starting {
                        let _ = self.controller.capture_started();
                    }
                    if self.stopped_early {
                        if let Some(s) = &self.session {
                            s.stop();
                        }
                    } else {
                        self.status = "Recording — audio stays on this computer.".into();
                    }
                    if let Some(reason) = self.text_failure.take() {
                        let _ = self
                            .controller
                            .finish_transcription(TextOutcome::Incomplete(reason));
                    }
                }
                AudioEvent::Level {
                    peak,
                    elapsed_frames,
                } => {
                    self.peak = peak;
                    self.frames = elapsed_frames;
                }
                AudioEvent::Finished {
                    path,
                    frames,
                    interrupted,
                } => {
                    self.frames = frames;
                    if matches!(
                        self.controller.capture(),
                        CaptureState::Starting | CaptureState::Recording
                    ) {
                        let _ = self.controller.stop_recording();
                    }
                    let _ = self.controller.capture_stopped();
                    let outcome = match interrupted {
                        Some(reason) => {
                            self.close_after = false;
                            AudioOutcome::Interrupted {
                                path: Some(path),
                                reason,
                            }
                        }
                        None => AudioOutcome::Completed(path),
                    };
                    let _ = self.controller.finish_audio(outcome);
                    self.finish_audio_session();
                    self.peak = 0.0;
                    self.status =
                        "Audio saved. Any remaining text is finalizing separately.".into();
                }
                AudioEvent::Failed(message) => {
                    if matches!(
                        self.controller.capture(),
                        CaptureState::Starting | CaptureState::Recording
                    ) {
                        let _ = self.controller.stop_recording();
                    }
                    let _ = self.controller.capture_stopped();
                    let _ = self
                        .controller
                        .finish_audio(AudioOutcome::Failed(message.clone()));
                    self.finish_audio_session();
                    self.status = message;
                    self.close_after = false;
                }
            }
        }
        let mut events = self
            .job
            .as_ref()
            .map(|job| job.events.try_iter().collect::<Vec<_>>())
            .unwrap_or_default();
        if let Some(event) = self.pending_live_finish.take() {
            events.push(event);
        }
        for event in events {
            match event {
                JobEvent::Ready if self.job_mode == Some(JobMode::Live) => {
                    if !self.stopped_early {
                        self.begin_audio();
                    }
                }
                JobEvent::Ready => self.status = "Transcribing locally…".into(),
                JobEvent::ModelChecked { candidate, result } => {
                    self.models.push((candidate, result))
                }
                JobEvent::Progress(message) => self.status = message,
                JobEvent::Window {
                    event,
                    final_window,
                } => match event {
                    EventKind::Segments {
                        segments,
                        coverage_start,
                        coverage_end,
                        ..
                    } => {
                        self.transcript
                            .apply(segments, coverage_start, coverage_end, final_window)
                    }
                    EventKind::NoSpeech {
                        coverage_start,
                        coverage_end,
                        ..
                    } => self
                        .transcript
                        .apply(vec![], coverage_start, coverage_end, final_window),
                    EventKind::Progress {
                        fraction, stage, ..
                    } => {
                        self.status = match fraction {
                            Some(f) => format!("{stage}: {:.0}%", f * 100.0),
                            None => stage,
                        }
                    }
                    EventKind::Error { message, .. } => self.notice = message,
                    _ => {}
                },
                JobEvent::Finished { result, end, gap } => {
                    if self.job_mode == Some(JobMode::Live)
                        && result.is_ok()
                        && !live_finish_ready(self.controller.capture())
                    {
                        self.pending_live_finish = Some(JobEvent::Finished { result, end, gap });
                        continue;
                    }
                    let mode = self.job_mode.take();
                    self.job = None;
                    if mode == Some(JobMode::Models) {
                        if let Err(message) = result {
                            self.notice = message;
                        }
                        self.update_model_readiness();
                        self.persist();
                        self.status = "Local model check finished.".into();
                    } else {
                        if gap {
                            self.transcript.fail("Audio intervals were skipped or transcription stopped early. Retry from the saved recording.");
                        }
                        let recorded_frames = if mode == Some(JobMode::Live) {
                            Some(self.frames)
                        } else {
                            None
                        };
                        let outcome = text_outcome(
                            result,
                            self.user_cancelled,
                            &mut self.transcript,
                            end,
                            recorded_frames,
                        );
                        if self.controller.capture() == &CaptureState::Starting
                            && mode == Some(JobMode::Live)
                        {
                            let reason = self
                                .transcript
                                .reason()
                                .unwrap_or("Transcription ended before recording started")
                                .to_owned();
                            if self.capture_pending {
                                self.text_failure = Some(reason);
                            } else {
                                let _ = self.controller.fail_capture_start(reason);
                            }
                        } else {
                            let _ = self.controller.finish_transcription(outcome.clone());
                        }
                        self.status = format!("Transcription: {outcome:?}");
                    }
                }
            }
        }
    }
    fn model_controls(&mut self, ui: &mut egui::Ui) {
        ui.label("Local models");
        if let Some(folder) = &self.settings.model_folder {
            ui.label(
                RichText::new(folder.display().to_string())
                    .size(14.0)
                    .color(SECONDARY),
            );
        } else {
            ui.label(
                RichText::new("No model folder selected")
                    .size(14.0)
                    .color(SECONDARY),
            );
        }
        if ui
            .add_enabled(
                !self.busy(),
                egui::Button::new("Choose model folder…")
                    .min_size(egui::vec2(ui.available_width(), 36.0)),
            )
            .clicked()
            && let Some(folder) = rfd::FileDialog::new().pick_folder()
        {
            self.scan_models(folder);
        }
        let mut config = self.controller.config().clone();
        let before = config.clone();
        ui.add_enabled_ui(!self.busy(), |ui| {
            let label = ui.label("Model");
            let selected = config
                .model
                .as_ref()
                .and_then(|selected| {
                    self.models
                        .iter()
                        .find(|(candidate, _)| candidate.path == selected.path)
                })
                .map(|(candidate, result)| model_label(candidate, result))
                .unwrap_or_else(|| "Choose a model".into());
            egui::ComboBox::from_id_salt("model")
                .selected_text(selected)
                .width(ui.available_width())
                .truncate()
                .show_ui(ui, |ui| {
                    for (candidate, result) in &self.models {
                        match result {
                            Ok(_) => {
                                let picked = config
                                    .model
                                    .as_ref()
                                    .is_some_and(|model| model.path == candidate.path);
                                if ui
                                    .selectable_label(picked, model_label(candidate, result))
                                    .clicked()
                                {
                                    config.model = Some(ModelConfig {
                                        path: candidate.path.clone(),
                                        language: config
                                            .model
                                            .as_ref()
                                            .map(|model| model.language)
                                            .unwrap_or_default(),
                                    });
                                }
                            }
                            Err(reason) => {
                                ui.label(format!("{}: {reason}", candidate.display_name));
                            }
                        }
                    }
                })
                .response
                .labelled_by(label.id);
            let label = ui.label("Spoken language");
            let mut language = config
                .model
                .as_ref()
                .map(|model| model.language)
                .unwrap_or_default();
            let supports_english = config.model.as_ref().is_some_and(|model| {
                self.models
                    .iter()
                    .any(|(candidate, result)| candidate.path == model.path && result.is_ok())
            });
            ui.add_enabled_ui(config.model.is_some(), |ui| {
                let language_response = egui::ComboBox::from_id_salt("language")
                    .selected_text(language_label(language))
                    .width(ui.available_width())
                    .truncate()
                    .show_ui(ui, |ui| {
                        ui.selectable_value(
                            &mut language,
                            Language::Portuguese,
                            "Português (Brasil)",
                        );
                        ui.add_enabled_ui(supports_english, |ui| {
                            ui.selectable_value(&mut language, Language::English, "English");
                        });
                    })
                    .response
                    .labelled_by(label.id);
                #[cfg(test)]
                remember_rect(ui, "language", language_response.rect);
                let _ = language_response;
            });
            if let Some(model) = &mut config.model {
                model.language = language;
            }
        });
        if config != before {
            let _ = self.controller.configure(config);
            self.update_model_readiness();
            self.persist();
        }
        match self.controller.model() {
            ModelState::Ready => {
                let readiness = ui.label(
                    RichText::new("Ready · local model, selected language")
                        .size(14.0)
                        .color(SECONDARY),
                );
                #[cfg(test)]
                {
                    remember_rect(ui, "readiness", readiness.rect);
                    remember_rect(ui, "model_clip", ui.clip_rect());
                }
                let _ = readiness;
            }
            ModelState::Checking => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label("Checking local models…");
                });
            }
            ModelState::Invalid(reason) => {
                ui.colored_label(Color32::LIGHT_RED, reason);
            }
            ModelState::NotConfigured => {
                ui.label(RichText::new("Choose a compatible local model for transcription. You can still record audio.").size(14.0).color(SECONDARY));
            }
        }
    }
    fn record_controls(&mut self, ui: &mut egui::Ui) {
        let mut config = self.controller.config().clone();
        let before = config.clone();
        ui.add_enabled_ui(!self.busy(), |ui| {
            let label = ui.horizontal(|ui| {
                let label=ui.label("Capture mode");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center),|ui| {
                    if ui.add(egui::Button::new(RichText::new("Refresh").size(14.0))).on_hover_text("Refresh audio devices").clicked(){self.refresh_devices();}
                });
                label
            }).inner;
            egui::ComboBox::from_id_salt("capture_mode")
                .selected_text(RichText::new(match config.mode { RecordingMode::Microphone => "Microphone only", RecordingMode::MicrophoneAndComputer => "Microphone + computer audio" }).size(14.0))
                .width(ui.available_width()).truncate().show_ui(ui, |ui| {
                    ui.selectable_value(&mut config.mode, RecordingMode::Microphone, "Microphone only");
                    ui.selectable_value(&mut config.mode, RecordingMode::MicrophoneAndComputer, "Microphone + computer audio");
                }).response.labelled_by(label.id);
            device_picker(ui, "Microphone", DeviceKind::Microphone, &self.devices, &mut config.microphone_id);
            if config.mode == RecordingMode::MicrophoneAndComputer {
                device_picker(ui, "Computer output", DeviceKind::ComputerOutput, &self.devices, &mut config.output_id);
                ui.label(RichText::new("Includes all sound from this output, including calls and notifications. Use headphones for calls.").size(14.0).color(SECONDARY));
            }
            ui.label("Save recordings to");
            let folder = if config.save_folder.as_os_str().is_empty() { "Choose a save folder".into() } else { config.save_folder.display().to_string() };
            ui.label(RichText::new(folder).size(14.0).color(SECONDARY));
            if ui.add_sized([ui.available_width(), 36.0], egui::Button::new("Choose folder…")).clicked()
                && let Some(folder) = rfd::FileDialog::new().pick_folder() { config.save_folder = folder; }
            ui.checkbox(&mut config.live_transcription, "Transcribe while recording");
        });
        if config != before {
            let _ = self.controller.configure(config);
            self.persist();
        }
    }
    fn file_controls(&mut self, ui: &mut egui::Ui) {
        ui.label("Audio recording");
        ui.label(
            RichText::new(
                self.file
                    .as_ref()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|| "No file selected".into()),
            )
            .size(14.0)
            .color(SECONDARY),
        );
        let picker = ui.add_enabled(
            !self.busy(),
            egui::Button::new("Choose WAV or MP3…")
                .min_size(egui::vec2(ui.available_width(), 36.0)),
        );
        #[cfg(test)]
        remember_rect(ui, "first_control", picker.rect);
        if picker.clicked()
            && let Some(path) = rfd::FileDialog::new()
                .add_filter("Audio", &["wav", "mp3"])
                .pick_file()
        {
            self.file = Some(path);
        }
        ui.label(
            RichText::new("Your original recording stays unchanged.")
                .size(14.0)
                .color(SECONDARY),
        );
    }
    fn primary_action(&mut self, ui: &mut egui::Ui) {
        let recording = matches!(
            self.controller.capture(),
            CaptureState::Starting | CaptureState::Recording
        );
        let saving = matches!(
            self.controller.capture(),
            CaptureState::Stopping | CaptureState::Saving
        );
        let text_job = self.job.is_some() && self.job_mode != Some(JobMode::Models);
        let (label, enabled) = if recording {
            ("Stop and save", true)
        } else if saving {
            ("Saving audio…", false)
        } else if text_job {
            ("Cancel transcription", true)
        } else if self.file_tab {
            (
                "Transcribe file",
                !self.busy()
                    && self.file.is_some()
                    && self.controller.model() == &ModelState::Ready,
            )
        } else {
            ("Start recording", !self.busy())
        };
        let primary = ui.add_enabled(
            enabled,
            egui::Button::new(RichText::new(label).color(Color32::from_rgb(20, 42, 69)))
                .fill(ACCENT)
                .min_size(egui::vec2(150.0, 44.0)),
        );
        #[cfg(test)]
        {
            remember_rect(ui, "primary", primary.rect);
            ui.ctx().data_mut(|data| {
                data.insert_temp(egui::Id::unique("primary_enabled"), primary.enabled())
            });
        }
        if primary.clicked() {
            if recording {
                self.stop_recording();
            } else if text_job {
                if let Some(job) = &self.job {
                    self.user_cancelled = true;
                    job.cancel();
                }
            } else if self.file_tab {
                self.start_file();
            } else {
                self.start_recording();
            }
        }
    }
    fn transcript_actions(&mut self, ui: &mut egui::Ui) {
        let available = !self.transcript.stable_text().is_empty();
        #[cfg(test)]
        ui.ctx()
            .data_mut(|data| data.insert_temp(egui::Id::unique("footer_cancel_enabled"), false));
        ui.horizontal_wrapped(|ui| {
            if ui.add_enabled(available, egui::Button::new("Copy text")).clicked() { ui.ctx().copy_text(self.transcript.export_text()); }
            if ui.add_enabled(available, egui::Button::new("Save text…")).clicked()
                && let Some(path) = rfd::FileDialog::new().set_file_name("transcript.txt").add_filter("UTF-8 text", &["txt"]).save_file() {
                match self.transcript.save_new(&path) { Ok(()) => self.notice = format!("Text saved: {}", path.display()), Err(error) => self.notice = format!("Text was not saved: {error}. Choose a new filename; the text remains available.") }
            }
            if available && ui.add_enabled(!self.busy(), egui::Button::new("Discard transcript")).clicked() { self.transcript = Transcript::default(); }
            if self.job.is_some() && (matches!(self.controller.capture(), CaptureState::Starting | CaptureState::Recording | CaptureState::Stopping | CaptureState::Saving) || self.job_mode == Some(JobMode::Models))
            {
                let cancel=ui.button(if self.job_mode == Some(JobMode::Models) { "Cancel model check" } else { "Cancel transcription" });
                #[cfg(test)]
                ui.ctx().data_mut(|data|data.insert_temp(egui::Id::unique("footer_cancel_enabled"),cancel.enabled()));
                if cancel.clicked() && let Some(job)=&self.job {self.user_cancelled=true;job.cancel();}
            }
        });
    }
    fn audio_result(&self, ui: &mut egui::Ui) {
        match self.controller.capture() {
            CaptureState::Finished(AudioOutcome::Completed(path)) => {
                ui.label(format!("Saved: {}", path.display()));
            }
            CaptureState::Finished(AudioOutcome::Interrupted { path, reason }) => {
                ui.colored_label(Color32::LIGHT_RED, format!("Interrupted: {reason}"));
                if let Some(path) = path {
                    ui.label(format!("Retained partial recording: {}", path.display()));
                }
            }
            CaptureState::Finished(AudioOutcome::Failed(reason)) => {
                ui.colored_label(Color32::LIGHT_RED, reason);
            }
            _ => {}
        }
    }
    fn workspace(&mut self, ui: &mut egui::Ui) {
        egui::Panel::top("workspace_action")
            .resizable(false)
            .frame(egui::Frame::new())
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    let status_width = (ui.available_width() - 206.0).max(80.0);
                    ui.allocate_ui_with_layout(
                        egui::vec2(status_width, 70.0),
                        egui::Layout::top_down(egui::Align::Min),
                        |ui| {
                            let heading = if self.busy() {
                                &self.status
                            } else if self.file_tab {
                                "Ready to transcribe"
                            } else {
                                "Ready to record"
                            };
                            ui.add(
                                egui::Label::new(
                                    RichText::new(heading).size(14.0).color(SECONDARY),
                                )
                                .truncate(),
                            )
                            .on_hover_text(&self.status);
                            if !self.file_tab
                                || matches!(
                                    self.controller.capture(),
                                    CaptureState::Starting
                                        | CaptureState::Recording
                                        | CaptureState::Stopping
                                        | CaptureState::Saving
                                )
                            {
                                let seconds = self.frames / 48_000;
                                let elapsed = if seconds >= 3_600 {
                                    format!(
                                        "{:02}:{:02}:{:02}",
                                        seconds / 3_600,
                                        (seconds / 60) % 60,
                                        seconds % 60
                                    )
                                } else {
                                    format!("{:02}:{:02}", seconds / 60, seconds % 60)
                                };
                                ui.label(RichText::new(elapsed).size(30.0));
                            } else {
                                ui.label(RichText::new("Local transcription").size(22.0));
                            }
                        },
                    );
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        self.primary_action(ui)
                    });
                });
                if !self.file_tab {
                    ui.horizontal(|ui| {
                        let label =
                            ui.label(RichText::new("Input level").size(14.0).color(SECONDARY));
                        ui.add(
                            egui::ProgressBar::new(self.peak.clamp(0.0, 1.0))
                                .desired_width(140.0)
                                .desired_height(6.0),
                        )
                        .labelled_by(label.id);
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            ui.label(
                                RichText::new("WAV · up to 6 hours")
                                    .size(13.0)
                                    .color(SECONDARY),
                            );
                        });
                    });
                }
            });
        let extra_actions = !self.transcript.stable_text().is_empty() || self.job.is_some();
        let footer_height = if ui.available_width() < 620.0 && extra_actions {
            88.0
        } else {
            44.0
        };
        let footer = egui::Panel::bottom("transcript_actions")
            .exact_size(footer_height)
            .frame(egui::Frame::new())
            .show(ui, |ui| self.transcript_actions(ui));
        #[cfg(test)]
        remember_rect(ui, "footer", footer.response.rect);
        let _ = footer;
        let has_result = matches!(self.controller.capture(), CaptureState::Finished(_))
            || !self.notice.is_empty();
        if has_result {
            egui::Panel::bottom("workspace_result")
                .default_size(80.0)
                .max_size(140.0)
                .resizable(false)
                .frame(egui::Frame::new())
                .show(ui, |ui| {
                    egui::ScrollArea::vertical()
                        .id_salt("result_scroll")
                        .show(ui, |ui| {
                            self.audio_result(ui);
                            if !self.notice.is_empty() {
                                ui.colored_label(Color32::LIGHT_YELLOW, &self.notice);
                                if ui.small_button("Dismiss message").clicked() {
                                    self.notice.clear();
                                }
                            }
                        });
                });
        }
        egui::Panel::top("transcript_heading")
            .resizable(false)
            .frame(egui::Frame::new())
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.strong("Transcript");
                    let state = match self.controller.transcription() {
                        TranscriptionState::Idle => {
                            if self.file_tab {
                                "Waiting for a recording"
                            } else {
                                "Waiting for speech"
                            }
                        }
                        TranscriptionState::Live => "Live · pending words may change",
                        TranscriptionState::File(_) => "Processing locally",
                        TranscriptionState::Finalizing => "Finalizing text",
                        TranscriptionState::Finished(TextOutcome::Completed) => "Completed",
                        TranscriptionState::Finished(TextOutcome::NoSpeech) => "No speech detected",
                        TranscriptionState::Finished(TextOutcome::Cancelled) => "Cancelled",
                        TranscriptionState::Finished(TextOutcome::Incomplete(_)) => "Incomplete",
                        TranscriptionState::Finished(TextOutcome::Failed(_)) => "Failed",
                    };
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.add(
                            egui::Label::new(RichText::new(state).size(14.0).color(SECONDARY))
                                .truncate(),
                        );
                    });
                });
                if let Some(reason) = self.transcript.reason() {
                    ui.colored_label(Color32::LIGHT_RED, format!("Incomplete: {reason}"));
                }
            });
        let scroll = egui::ScrollArea::vertical()
            .id_salt("transcript_scroll")
            .auto_shrink([false, false])
            .stick_to_bottom(true)
            .show(ui, |ui| {
                let mut text = self.transcript.stable_text();
                if text.is_empty() {
                    ui.label(
                        RichText::new(if self.file_tab {
                            "Select a recording to create a transcript."
                        } else {
                            "Spoken words will appear here while you record."
                        })
                        .color(SECONDARY),
                    );
                } else {
                    ui.add(
                        egui::TextEdit::multiline(&mut text)
                            .desired_width(f32::INFINITY)
                            .font(egui::TextStyle::Body)
                            .frame(egui::Frame::new())
                            .interactive(false),
                    );
                }
                let pending = self.transcript.pending_text();
                if !pending.is_empty() {
                    ui.label(
                        RichText::new(format!("Pending (may change): {pending}"))
                            .italics()
                            .color(SECONDARY),
                    );
                }
            });
        #[cfg(test)]
        remember_rect(ui, "transcript", scroll.inner_rect);
        let _ = scroll;
    }
    fn draw(&mut self, ui: &mut egui::Ui) {
        egui::Panel::top("app_header")
            .exact_size(54.0)
            .show_separator_line(false)
            .frame(
                egui::Frame::new()
                    .fill(PANEL)
                    .inner_margin(egui::Margin::symmetric(20, 9)),
            )
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(RichText::new("rustcorder").size(18.0).strong());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(RichText::new("Works offline").size(14.0).color(SECONDARY));
                    });
                });
            });
        egui::Panel::top("app_tabs")
            .exact_size(54.0)
            .frame(
                egui::Frame::new()
                    .fill(BACKGROUND)
                    .inner_margin(egui::Margin::symmetric(20, 9)),
            )
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    for (file, title) in [(false, "Record"), (true, "Transcribe file")] {
                        let selected = self.file_tab == file;
                        if ui
                            .add(
                                egui::Button::new(RichText::new(title).color(if selected {
                                    ACCENT
                                } else {
                                    TEXT
                                }))
                                .fill(PANEL)
                                .stroke(egui::Stroke::new(
                                    1.0,
                                    if selected { ACCENT } else { BORDER },
                                )),
                            )
                            .clicked()
                        {
                            self.file_tab = file;
                        }
                    }
                });
            });
        let settings = egui::Panel::left("settings")
            .exact_size(290.0)
            .resizable(false)
            .frame(egui::Frame::new().fill(BACKGROUND).inner_margin(20))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 6.0;
                egui::ScrollArea::vertical()
                    .id_salt("settings_scroll")
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        if self.file_tab {
                            self.file_controls(ui);
                        } else {
                            self.record_controls(ui);
                        }
                        ui.add_space(4.0);
                        ui.separator();
                        ui.add_space(4.0);
                        self.model_controls(ui);
                    });
            });
        #[cfg(test)]
        remember_rect(ui, "settings", settings.response.rect);
        let _ = settings;
        let workspace = egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(BACKGROUND).inner_margin(24))
            .show(ui, |ui| self.workspace(ui));
        #[cfg(test)]
        remember_rect(ui, "workspace", workspace.response.rect);
        let _ = workspace;
    }
}

impl eframe::App for Desktop {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll();
        ctx.request_repaint_after(Duration::from_millis(50));
        if ctx.input(|i| i.viewport().close_requested())
            && !self.close_after
            && (self.busy()
                || self.controller.close_plan(self.transcript.unsaved()) != ClosePlan::Close)
        {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.close_prompt = true;
        }
        if self.close_after
            && !self.busy()
            && !self.capture_pending
            && self.session.is_none()
            && self.job.is_none()
        {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.draw(ui);
        if self.close_prompt {
            egui::Window::new("Close rustcorder?").collapsible(false).resizable(false).show(ui.ctx(),|ui| {
                ui.label("Active audio will be stopped and saved. Transcription will be cancelled. Unsaved text will be discarded.");
                ui.label("Choose Keep open to copy or save text first.");
                ui.horizontal(|ui| {
                    if ui.button("Keep open").clicked(){self.close_prompt=false;}
                    if ui.button("Stop, save audio and close").clicked(){
                        self.close_prompt=false;self.close_after=true;
                        if matches!(self.controller.capture(),CaptureState::Starting|CaptureState::Recording){self.stop_recording();}
                        if let Some(job)=&self.job{self.user_cancelled=true;job.cancel();}
                    }
                });
            });
        }
    }
}

const BACKGROUND: Color32 = Color32::from_rgb(32, 34, 36);
const PANEL: Color32 = Color32::from_rgb(40, 43, 45);
const BORDER: Color32 = Color32::from_rgb(72, 78, 84);
const TEXT: Color32 = Color32::from_rgb(240, 242, 244);
const SECONDARY: Color32 = Color32::from_rgb(182, 190, 199);
const ACCENT: Color32 = Color32::from_rgb(157, 198, 255);

fn configure_style(ctx: &egui::Context) {
    let mut style = (*ctx.style_of(egui::Theme::Dark)).clone();
    style.spacing.item_spacing = egui::vec2(8.0, 8.0);
    style.spacing.interact_size = egui::vec2(40.0, 36.0);
    style.spacing.button_padding = egui::vec2(11.0, 7.0);
    for text in [
        egui::TextStyle::Body,
        egui::TextStyle::Button,
        egui::TextStyle::Monospace,
    ] {
        style
            .text_styles
            .insert(text, egui::FontId::proportional(16.0));
    }
    style
        .text_styles
        .insert(egui::TextStyle::Small, egui::FontId::proportional(14.0));
    style
        .text_styles
        .insert(egui::TextStyle::Heading, egui::FontId::proportional(18.0));
    style.visuals = egui::Visuals::dark();
    style.visuals.override_text_color = Some(TEXT);
    style.visuals.panel_fill = BACKGROUND;
    style.visuals.window_fill = PANEL;
    style.visuals.extreme_bg_color = BACKGROUND;
    style.visuals.selection.bg_fill = Color32::from_rgb(40, 78, 124);
    style.visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, BORDER);
    style.visuals.widgets.inactive.bg_fill = PANEL;
    style.visuals.widgets.inactive.weak_bg_fill = PANEL;
    style.visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0, BORDER);
    ctx.set_style_of(egui::Theme::Dark, style);
    ctx.set_theme(egui::ThemePreference::Dark);
}

fn language_label(language: Language) -> &'static str {
    match language {
        Language::Portuguese => "Português (Brasil)",
        Language::English => "English",
    }
}

fn model_label(candidate: &ModelCandidate, result: &Result<ModelMetadata, String>) -> String {
    match result {
        Ok(metadata) => format!(
            "{} · {}",
            match metadata.family.as_str() {
                "base" => "Base",
                "small" => "Small",
                other => other,
            },
            if metadata.multilingual {
                "multilingual"
            } else {
                "English only"
            }
        ),
        Err(_) => candidate.display_name.clone(),
    }
}

#[cfg(test)]
fn remember_rect(ui: &egui::Ui, name: &str, rect: egui::Rect) {
    ui.ctx()
        .data_mut(|data| data.insert_temp(egui::Id::unique(name), rect));
}

fn text_outcome(
    result: Result<(), String>,
    user_cancelled: bool,
    transcript: &mut Transcript,
    end: u64,
    recorded_frames: Option<u64>,
) -> TextOutcome {
    match result {
        Ok(()) => {
            transcript.finish(end.max(recorded_frames.unwrap_or(0) / 3));
            if transcript.is_incomplete() {
                TextOutcome::Incomplete(transcript.reason().unwrap_or("Incomplete").into())
            } else if transcript.stable_text().is_empty() {
                TextOutcome::NoSpeech
            } else {
                TextOutcome::Completed
            }
        }
        Err(message) => {
            transcript.fail(message.clone());
            if user_cancelled {
                TextOutcome::Cancelled
            } else {
                TextOutcome::Incomplete(message)
            }
        }
    }
}

fn device_picker(
    ui: &mut egui::Ui,
    label: &str,
    kind: DeviceKind,
    devices: &[DeviceInfo],
    selected: &mut Option<String>,
) {
    let caption = ui.label(label);
    let name = devices
        .iter()
        .find(|device| Some(&device.id) == selected.as_ref())
        .map(|device| device.name.as_str())
        .unwrap_or("Select an available device");
    let picker = egui::ComboBox::from_id_salt(label)
        .selected_text(name)
        .width(ui.available_width())
        .truncate()
        .show_ui(ui, |ui| {
            for device in devices.iter().filter(|device| device.kind == kind) {
                ui.selectable_value(selected, Some(device.id.clone()), &device.name);
            }
        });
    picker
        .response
        .clone()
        .labelled_by(caption.id)
        .on_hover_text(name);
    #[cfg(test)]
    if label == "Microphone" {
        remember_rect(ui, "first_control", picker.response.rect);
    }
}

fn ui_busy(controller: &Controller, resources_pending: bool) -> bool {
    controller.is_busy() || resources_pending
}

fn live_finish_ready(capture: &CaptureState) -> bool {
    matches!(capture, CaptureState::Idle | CaptureState::Finished(_))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rendered_combined_ready_settings_fit_without_scrolling() {
        for size in [[1040.0, 880.0], [1014.0, 856.0]] {
            let mut app = desktop_fixture();
            let folder = PathBuf::from(r"C:\Users\someone\dev\tools\rustcorder\models");
            let model = folder.join("ggml-base.bin");
            app.controller = Controller::new(AppConfig {
                mode: RecordingMode::MicrophoneAndComputer,
                microphone_id: Some("mic".into()),
                output_id: Some("output".into()),
                save_folder: PathBuf::from(r"C:\Recordings"),
                live_transcription: true,
                model: Some(ModelConfig {
                    path: model.clone(),
                    language: Language::Portuguese,
                }),
            });
            app.controller.start_model_validation().unwrap();
            app.controller.finish_model_validation(Ok(())).unwrap();
            app.settings.model_folder = Some(folder);
            app.models = vec![(
                ModelCandidate {
                    path: model,
                    display_name: "ggml-base.bin".into(),
                },
                Ok(ModelMetadata {
                    family: "base".into(),
                    multilingual: true,
                }),
            )];
            app.devices = vec![
                DeviceInfo {
                    id: "mic".into(),
                    name: "Headset microphone".into(),
                    kind: DeviceKind::Microphone,
                    is_default: true,
                },
                DeviceInfo {
                    id: "output".into(),
                    name: "Headphones".into(),
                    kind: DeviceKind::ComputerOutput,
                    is_default: true,
                },
            ];
            app.status = "Ready to record".into();
            let ctx = egui::Context::default();
            configure_style(&ctx);
            let input = egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(size[0], size[1]),
                )),
                ..Default::default()
            };
            let mut combined_label_visible = false;
            for _ in 0..2 {
                let output = ctx.run_ui(input.clone(), |ui| app.draw(ui));
                combined_label_visible=output.shapes.iter().any(|shape|matches!(&shape.shape,egui::epaint::Shape::Text(text) if text.galley.job.text=="Microphone + computer audio"&&!text.galley.elided));
                output.drop_without_applying_deltas();
            }
            let [language, readiness, clip] = ["language", "readiness", "model_clip"].map(|key| {
                ctx.data(|data| {
                    data.get_temp::<egui::Rect>(egui::Id::unique(key))
                        .expect(key)
                })
            });
            assert!(
                clip.contains_rect(language),
                "Language selector must be visible at {size:?}: {language:?} in {clip:?}"
            );
            assert!(
                clip.contains_rect(readiness),
                "Readiness must be visible at {size:?}: {readiness:?} in {clip:?}"
            );
            assert!(language.height() >= 36.0);
            assert!(
                combined_label_visible,
                "The complete selected capture mode should be visible"
            );
            println!(
                "Combined ready {size:?}: language={language:?}, readiness={readiness:?}, clip={clip:?}"
            );
        }
    }
    #[test]
    fn rendered_cancel_remains_available_while_audio_stops_and_saves() {
        for saving in [false, true] {
            let mut app = desktop_fixture();
            app.controller.stop_recording().unwrap();
            if saving {
                app.controller.capture_stopped().unwrap();
            }
            let worker = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(".build/missing-ui-test-worker.exe");
            assert!(!worker.exists());
            app.job = Some(Job::file_with_command(
                app.controller.config().model.clone().unwrap(),
                "unused.wav".into(),
                std::process::Command::new(worker),
            ));
            let ctx = egui::Context::default();
            configure_style(&ctx);
            let input = egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1014.0, 856.0),
                )),
                ..Default::default()
            };
            ctx.run_ui(input, |ui| app.draw(ui))
                .drop_without_applying_deltas();
            assert_eq!(
                ctx.data(|data| data.get_temp::<bool>(egui::Id::unique("primary_enabled"))),
                Some(false)
            );
            assert_eq!(
                ctx.data(|data| data.get_temp::<bool>(egui::Id::unique("footer_cancel_enabled"))),
                Some(true),
                "Stopping/saving audio must not remove text cancellation"
            );
        }
    }
    fn rendered_layout(
        size: [f32; 2],
        scale: f32,
        file_tab: bool,
    ) -> (egui::Context, [egui::Rect; 6]) {
        let mut app = desktop_fixture();
        app.controller = Controller::new(AppConfig {
            microphone_id: Some("mic".into()),
            save_folder: "recordings".into(),
            ..AppConfig::default()
        });
        app.file_tab = file_tab;
        let ctx = egui::Context::default();
        configure_style(&ctx);
        let mut input = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(size[0], size[1]),
            )),
            ..Default::default()
        };
        input
            .viewports
            .get_mut(&egui::ViewportId::ROOT)
            .unwrap()
            .native_pixels_per_point = Some(scale);
        for _ in 0..2 {
            ctx.run_ui(input.clone(), |ui| app.draw(ui))
                .drop_without_applying_deltas();
        }
        let rectangles = [
            "settings",
            "workspace",
            "transcript",
            "primary",
            "first_control",
            "footer",
        ]
        .map(|name| {
            ctx.data(|data| {
                data.get_temp::<egui::Rect>(egui::Id::unique(name))
                    .expect(name)
            })
        });
        (ctx, rectangles)
    }
    #[test]
    fn rendered_record_layout_matches_the_two_column_mockup() {
        let (ctx, [settings, workspace, transcript, primary, control, footer]) =
            rendered_layout([1014.0, 856.0], 1.0, false);
        assert!(
            (settings.width() - 290.0).abs() <= 1.0,
            "Settings must occupy the fixed sidebar: {settings:?}"
        );
        assert!(
            workspace.left() >= settings.right(),
            "Transcript workspace must sit beside settings"
        );
        assert!(
            transcript.height() > 300.0,
            "Transcript should use the workspace height: {transcript:?}"
        );
        assert!(
            primary.top() < settings.top() + 100.0 && primary.right() > workspace.right() - 50.0,
            "Primary action belongs at the upper right: {primary:?}"
        );
        assert!(
            primary.height() >= 44.0 && control.height() >= 36.0,
            "Controls must be readable and easy to hit"
        );
        assert!(footer.bottom() <= 856.0 && footer.top() >= transcript.bottom());
        assert_eq!(
            ctx.data(|data| data.get_temp::<bool>(egui::Id::unique("primary_enabled"))),
            Some(true)
        );
        assert!(
            egui::TextStyle::Body
                .resolve(&ctx.style_of(egui::Theme::Dark))
                .size
                >= 16.0
        );
    }
    #[test]
    fn rendered_file_layout_keeps_the_same_sidebar_and_expands_on_wide_windows() {
        let (ctx, [settings, workspace, transcript, primary, control, footer]) =
            rendered_layout([2048.0, 1117.0], 1.0, true);
        assert!((settings.width() - 290.0).abs() <= 1.0);
        assert!(workspace.left() >= settings.right());
        assert!(
            transcript.width() > 1600.0 && transcript.height() > 700.0,
            "Wide windows should expand the transcript: {transcript:?}"
        );
        assert!(primary.height() >= 44.0 && control.height() >= 36.0);
        assert!(footer.bottom() <= 1117.0 && footer.top() >= transcript.bottom());
        assert_eq!(
            ctx.data(|data| data.get_temp::<bool>(egui::Id::unique("primary_enabled"))),
            Some(false)
        );
    }
    #[test]
    fn rendered_small_high_dpi_window_preserves_a_visible_transcript() {
        for file_tab in [false, true] {
            let (_, [settings, workspace, transcript, primary, _, footer]) =
                rendered_layout([760.0, 600.0], 2.0, file_tab);
            assert!((settings.width() - 290.0).abs() <= 1.0);
            assert!(workspace.left() >= settings.right());
            assert!(transcript.width() > 300.0 && transcript.height() >= 180.0);
            assert!(primary.right() <= 760.0 && primary.top() < 220.0);
            assert!(footer.bottom() <= 600.0 && footer.top() >= transcript.bottom());
        }
    }
    fn desktop_fixture() -> Desktop {
        let config = AppConfig {
            microphone_id: Some("mic".into()),
            save_folder: "recordings".into(),
            live_transcription: true,
            model: Some(ModelConfig {
                path: "model.bin".into(),
                language: Language::Portuguese,
            }),
            ..AppConfig::default()
        };
        let mut controller = Controller::new(config);
        controller.start_model_validation().unwrap();
        controller.finish_model_validation(Ok(())).unwrap();
        controller.start_recording(Ok(())).unwrap();
        controller.capture_started().unwrap();
        let (background_sender, background) = mpsc::channel();
        Desktop {
            controller,
            settings: Settings::default(),
            devices: vec![],
            models: vec![],
            background,
            background_sender,
            session: None,
            capture_pending: false,
            job: None,
            job_mode: Some(JobMode::Live),
            live_input: None,
            transcript: Transcript::default(),
            file: None,
            file_tab: false,
            status: String::new(),
            notice: String::new(),
            peak: 0.0,
            frames: 0,
            close_prompt: false,
            close_after: false,
            stopped_early: false,
            text_failure: None,
            user_cancelled: false,
            pending_live_finish: None,
        }
    }
    #[test]
    fn live_completion_arriving_before_audio_completion_is_retained_then_applied() {
        let mut app = desktop_fixture();
        app.transcript.apply(vec![], 0, 100, true);
        app.pending_live_finish = Some(JobEvent::Finished {
            result: Ok(()),
            end: 100,
            gap: false,
        });
        app.poll();
        assert!(
            app.pending_live_finish.is_some(),
            "A successful text outcome must wait for saved audio length"
        );
        assert_eq!(app.controller.transcription(), &TranscriptionState::Live);
        let (events, receiver) = mpsc::channel();
        let (_, errors) = mpsc::channel();
        app.session = Some(Session::test_session(receiver, errors));
        events
            .send(AudioEvent::Finished {
                path: "saved.wav".into(),
                frames: 300,
                interrupted: None,
            })
            .unwrap();
        app.poll();
        assert!(app.pending_live_finish.is_none());
        assert_eq!(
            app.controller.transcription(),
            &TranscriptionState::Finished(TextOutcome::NoSpeech)
        );
        assert!(!app.busy());
    }
    #[test]
    fn audio_terminal_drains_text_errors_that_arrived_after_the_initial_poll() {
        let mut app = desktop_fixture();
        let (_events, receiver) = mpsc::channel();
        let (errors, error_receiver) = mpsc::channel();
        app.session = Some(Session::test_session(receiver, error_receiver));
        app.poll_text_errors();
        errors.send("last converter failed".into()).unwrap();
        app.finish_audio_session();
        assert_eq!(app.transcript.reason(), Some("last converter failed"));
        assert!(app.session.is_none());
    }
    #[test]
    fn stopping_during_model_preload_keeps_actions_locked_until_the_job_exits() {
        let mut controller = Controller::default();
        let mut config = AppConfig {
            microphone_id: Some("mic".into()),
            save_folder: "recordings".into(),
            live_transcription: true,
            model: Some(ModelConfig {
                path: "model.bin".into(),
                language: Language::Portuguese,
            }),
            ..AppConfig::default()
        };
        controller.configure(config.clone()).unwrap();
        controller.start_model_validation().unwrap();
        controller.finish_model_validation(Ok(())).unwrap();
        controller.start_recording(Ok(())).unwrap();
        controller.stop_recording().unwrap();
        controller.capture_stopped().unwrap();
        controller
            .finish_audio(AudioOutcome::Failed("preload stopped".into()))
            .unwrap();
        assert!(!controller.is_busy());
        assert!(ui_busy(&controller, true));
        assert!(!ui_busy(&controller, false));
        config.live_transcription = false;
        assert!(controller.configure(config).is_ok());
    }
    #[test]
    fn explicit_cancel_has_distinct_status_and_preserves_incomplete_unicode() {
        let mut transcript = Transcript::default();
        transcript.apply(
            vec![crate::transcription::Segment {
                start_sample: 0,
                end_sample: 100,
                text: "ação segura".into(),
            }],
            0,
            100,
            true,
        );
        assert_eq!(
            text_outcome(Err("Cancelled".into()), true, &mut transcript, 100, None),
            TextOutcome::Cancelled
        );
        assert!(transcript.export_text().contains("INCOMPLETE"));
        assert!(transcript.export_text().contains("ação segura"));
    }
    #[test]
    fn worker_deadline_is_not_presented_as_a_user_cancellation() {
        let mut transcript = Transcript::default();
        assert!(matches!(
            text_outcome(Err("deadline".into()), false, &mut transcript, 100, None),
            TextOutcome::Incomplete(_)
        ));
    }

    #[derive(Clone, Copy, Debug)]
    enum MatrixState {
        Idle,
        Ready,
        Busy,
        Stopping,
        Saving,
        Failed,
        Completed,
    }

    fn matrix_ready() -> Desktop {
        let mut app = desktop_fixture();
        app.controller = Controller::new(app.controller.config().clone());
        app.controller.start_model_validation().unwrap();
        app.controller.finish_model_validation(Ok(())).unwrap();
        app.file = Some("matrix.wav".into());
        app.job_mode = None;
        app
    }

    fn matrix_text(app: &mut Desktop) {
        app.transcript.apply(
            vec![crate::transcription::Segment {
                start_sample: 0,
                end_sample: 100,
                text: "Deterministic transcript".into(),
            }],
            0,
            100,
            true,
        );
        app.transcript.finish(100);
    }

    fn matrix_pending(app: &mut Desktop, file: bool) {
        if file {
            app.controller
                .start_file_transcription("matrix.wav".into())
                .unwrap();
        } else {
            app.controller.start_recording(Ok(())).unwrap();
            app.controller.capture_started().unwrap();
        }
        // No real worker, model, hardware or dialog is used by the drawing fixture.
        let missing =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".build/missing-matrix-worker.exe");
        assert!(!missing.exists());
        app.job = Some(Job::file_with_command(
            app.controller.config().model.clone().unwrap(),
            "matrix.wav".into(),
            std::process::Command::new(missing),
        ));
        app.job_mode = Some(if file { JobMode::File } else { JobMode::Live });
    }

    fn matrix_app(state: MatrixState, file: bool) -> Desktop {
        let mut app = matrix_ready();
        app.file_tab = file;
        match state {
            MatrixState::Idle => {
                app.controller = Controller::default();
                app.file = None;
            }
            MatrixState::Ready => {}
            MatrixState::Busy => matrix_pending(&mut app, file),
            MatrixState::Stopping | MatrixState::Saving => {
                matrix_pending(&mut app, false);
                app.controller.stop_recording().unwrap();
                if matches!(state, MatrixState::Saving) {
                    app.controller.capture_stopped().unwrap();
                }
            }
            MatrixState::Failed | MatrixState::Completed => {
                app.controller
                    .start_file_transcription("matrix.wav".into())
                    .unwrap();
                let outcome = if matches!(state, MatrixState::Failed) {
                    app.transcript.fail("Deterministic failure");
                    TextOutcome::Failed("Deterministic failure".into())
                } else {
                    matrix_text(&mut app);
                    TextOutcome::Completed
                };
                app.controller.finish_transcription(outcome).unwrap();
            }
        }
        app
    }

    fn matrix_harness(
        state: MatrixState,
        file: bool,
        size: [f32; 2],
        scale: f32,
    ) -> egui_kittest::Harness<'static, Desktop> {
        let mut harness = egui_kittest::Harness::builder()
            .with_size(size)
            .with_pixels_per_point(scale)
            .with_context_setup(configure_style)
            .with_max_steps(8)
            .build_ui_state(
                |ui, app: &mut Desktop| app.draw(ui),
                matrix_app(state, file),
            );
        // Busy spinners deliberately repaint forever; never wait for them to settle.
        harness.run_steps(2);
        harness
    }

    fn matrix_rect(harness: &egui_kittest::Harness<'_, Desktop>, name: &str) -> egui::Rect {
        harness.ctx.data(|data| {
            data.get_temp::<egui::Rect>(egui::Id::unique(name))
                .expect(name)
        })
    }

    fn assert_matrix_geometry(harness: &egui_kittest::Harness<'_, Desktop>, size: [f32; 2]) {
        let settings = matrix_rect(harness, "settings");
        let workspace = matrix_rect(harness, "workspace");
        let transcript = matrix_rect(harness, "transcript");
        let primary = matrix_rect(harness, "primary");
        let footer = matrix_rect(harness, "footer");
        assert!(workspace.left() >= settings.right(), "{harness:#?}");
        assert!(transcript.width() > 250.0, "{transcript:?}\n{harness:#?}");
        assert!(transcript.height() >= 150.0, "{transcript:?}\n{harness:#?}");
        assert!(primary.height() >= 44.0, "{primary:?}\n{harness:#?}");
        assert!(primary.right() <= size[0], "{primary:?}\n{harness:#?}");
        assert!(footer.bottom() <= size[1] + 1.0, "{footer:?}\n{harness:#?}");
        assert!(
            footer.top() >= transcript.bottom(),
            "{footer:?} {transcript:?}"
        );
    }

    #[test]
    fn actual_draw_matrix_covers_both_screens_states_sizes_and_scales() {
        use egui_kittest::kittest::Queryable;
        let states = [
            MatrixState::Idle,
            MatrixState::Ready,
            MatrixState::Busy,
            MatrixState::Stopping,
            MatrixState::Saving,
            MatrixState::Failed,
            MatrixState::Completed,
        ];
        let mut cases = 0;
        for file in [false, true] {
            for state in states {
                for size in [[1040.0, 880.0], [760.0, 600.0], [2048.0, 1117.0]] {
                    for scale in [1.0, 2.0] {
                        let harness = matrix_harness(state, file, size, scale);
                        assert_matrix_geometry(&harness, size);
                        assert!(harness.get_by_label("Record").rect().height() >= 30.0);
                        if matches!(state, MatrixState::Stopping | MatrixState::Saving) {
                            assert!(
                                harness
                                    .get_by_label("Cancel transcription")
                                    .rect()
                                    .is_positive(),
                                "{state:?}\n{harness:#?}"
                            );
                            assert_eq!(
                                harness.ctx.data(|data| data
                                    .get_temp::<bool>(egui::Id::unique("primary_enabled"))),
                                Some(false)
                            );
                        }
                        cases += 1;
                    }
                }
            }
        }
        assert_eq!(cases, 84, "Stopping and saving are distinct concrete cases");
    }

    #[test]
    fn actual_ui_keyboard_tab_enter_and_pointer_navigation_reach_both_screens() {
        use egui_kittest::kittest::Queryable;
        let mut harness = matrix_harness(MatrixState::Ready, false, [1040.0, 880.0], 1.0);
        harness.get_by_label("Record").focus();
        harness.run_steps(2);
        harness.key_press(egui::Key::Tab);
        harness.run_steps(2);
        assert!(
            harness.get_by_label("Transcribe file").is_focused(),
            "{harness:#?}"
        );
        harness.key_press(egui::Key::Enter);
        harness.run_steps(2);
        assert!(harness.state().file_tab, "{harness:#?}");
        harness.get_by_label("Record").click();
        harness.run_steps(2);
        assert!(!harness.state().file_tab, "{harness:#?}");
    }

    #[test]
    fn actual_ui_copy_and_discard_preserve_the_exported_text() {
        use egui_kittest::kittest::Queryable;
        let mut harness = matrix_harness(MatrixState::Completed, false, [1040.0, 880.0], 1.0);
        harness.get_by_label("Copy text").click();
        harness.step();
        assert!(
            harness
                .output()
                .platform_output
                .commands
                .iter()
                .any(|command| matches!(command,
            egui::OutputCommand::CopyText(text) if text.contains("Deterministic transcript"))),
            "{harness:#?}"
        );
        harness.get_by_label("Discard transcript").click();
        harness.run_steps(2);
        assert!(
            harness.state().transcript.stable_text().is_empty(),
            "{harness:#?}"
        );
    }

    #[test]
    fn actual_ui_cancel_remains_clickable_while_stopping_and_saving() {
        use egui_kittest::kittest::Queryable;
        for state in [MatrixState::Stopping, MatrixState::Saving] {
            let mut harness = matrix_harness(state, false, [760.0, 600.0], 2.0);
            harness.get_by_label("Cancel transcription").click();
            harness.run_steps(2);
            assert!(harness.state().user_cancelled, "{state:?}\n{harness:#?}");
        }
    }

    #[test]
    fn dropped_final_live_chunk_is_detected_from_the_saved_audio_length() {
        let mut transcript = Transcript::default();
        transcript.apply(vec![], 0, 100, true);
        assert!(matches!(
            text_outcome(Ok(()), false, &mut transcript, 100, Some(303)),
            TextOutcome::Incomplete(_)
        ));
    }
}

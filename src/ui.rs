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
        let mut style = (*context.egui_ctx.style_of(egui::Theme::Dark)).clone();
        style.spacing.item_spacing = egui::vec2(10.0, 10.0);
        style.visuals = egui::Visuals::dark();
        style.visuals.selection.bg_fill = Color32::from_rgb(32, 122, 112);
        context.egui_ctx.set_style_of(egui::Theme::Dark, style);
        context.egui_ctx.set_theme(egui::ThemePreference::Dark);
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
        egui::CollapsingHeader::new("Local transcription model").default_open(self.models.is_empty()).show(ui,|ui| {
            ui.label("Compatible packs: whisper.cpp GGML base / small. The app never downloads models.");
            if ui.add_enabled(!self.busy(),egui::Button::new("Choose model folder…")).clicked()
                && let Some(folder)=rfd::FileDialog::new().pick_folder() {self.scan_models(folder);}
            if let Some(folder)=&self.settings.model_folder {ui.label(folder.display().to_string());}
            let mut config=self.controller.config().clone();let before=config.clone();
            ui.add_enabled_ui(!self.busy(),|ui| {
                let selected=config.model.as_ref().map(|m|m.path.file_name().unwrap_or_default().to_string_lossy().into_owned()).unwrap_or("Choose a model".into());
                egui::ComboBox::from_id_salt("model").selected_text(selected).show_ui(ui,|ui| {
                    for (candidate,result) in &self.models {
                        match result {
                            Ok(metadata)=>{let label=format!("{} — {}",candidate.display_name,if metadata.multilingual{"Portuguese + English"}else{"English only"});let picked=config.model.as_ref().is_some_and(|m|m.path==candidate.path);if ui.selectable_label(picked,label).clicked(){config.model=Some(ModelConfig{path:candidate.path.clone(),language:config.model.as_ref().map(|m|m.language).unwrap_or_default()});}},
                            Err(reason)=>{ui.label(format!("{}: {reason}",candidate.display_name));}
                        }
                    }
                });
                if let Some(model)=&mut config.model {
                    ui.horizontal(|ui| {
                        ui.label("Spoken language:");
                        ui.selectable_value(&mut model.language,Language::Portuguese,"Português brasileiro");
                        let supports_en=self.models.iter().find(|(c,_)|c.path==model.path).is_some_and(|(_,r)|r.is_ok());
                        ui.add_enabled_ui(supports_en,|ui|{ui.selectable_value(&mut model.language,Language::English,"English");});
                    });
                }
            });
            if config!=before {let _=self.controller.configure(config);self.update_model_readiness();self.persist();}
            match self.controller.model(){ModelState::Ready=>{ui.colored_label(Color32::LIGHT_GREEN,"Ready — local model, selected language");},ModelState::Checking=>{ui.spinner();ui.label("Validating model bytes locally…");},ModelState::Invalid(reason)=>{ui.colored_label(Color32::LIGHT_RED,reason);},ModelState::NotConfigured=>{ui.label("Choose and validate a local model to enable transcription. Plain recording is available.");}}
        });
    }
    fn record_controls(&mut self, ui: &mut egui::Ui) {
        let mut config = self.controller.config().clone();
        let before = config.clone();
        ui.add_enabled_ui(!self.busy(),|ui| {
            ui.horizontal(|ui|{ui.selectable_value(&mut config.mode,RecordingMode::Microphone,"Microphone");ui.selectable_value(&mut config.mode,RecordingMode::MicrophoneAndComputer,"Microphone + computer");});
            device_picker(ui,"Microphone",DeviceKind::Microphone,&self.devices,&mut config.microphone_id);
            if config.mode==RecordingMode::MicrophoneAndComputer {device_picker(ui,"Computer output",DeviceKind::ComputerOutput,&self.devices,&mut config.output_id);ui.label("Records every sound on the selected output, including notifications. Use headphones for calls.");}
            ui.horizontal(|ui|{if ui.button("Save folder…").clicked()&&let Some(path)=rfd::FileDialog::new().pick_folder(){config.save_folder=path;}ui.label(if config.save_folder.as_os_str().is_empty(){"Choose where to save WAV recordings".into()}else{config.save_folder.display().to_string()});});
            ui.checkbox(&mut config.live_transcription,"Transcribe while recording (local)");
            if ui.button("Refresh audio devices").clicked(){self.refresh_devices();}
        });
        if config != before {
            let _ = self.controller.configure(config);
            self.persist();
        }
        ui.label("48 kHz stereo WAV · automatic stop at 6 hours");
        let seconds = self.frames / 48_000;
        ui.label(
            RichText::new(format!(
                "{:02}:{:02}:{:02}",
                seconds / 3600,
                (seconds / 60) % 60,
                seconds % 60
            ))
            .size(40.0)
            .monospace(),
        );
        ui.add(egui::ProgressBar::new(self.peak.clamp(0.0, 1.0)).text("Input level"));
        ui.horizontal(|ui| {
            if ui
                .add_enabled(
                    !self.busy(),
                    egui::Button::new("Start recording").fill(Color32::from_rgb(30, 112, 99)),
                )
                .clicked()
            {
                self.start_recording();
            }
            if ui
                .add_enabled(
                    matches!(
                        self.controller.capture(),
                        CaptureState::Starting | CaptureState::Recording
                    ),
                    egui::Button::new("Stop and save").fill(Color32::from_rgb(140, 63, 49)),
                )
                .clicked()
            {
                self.stop_recording();
            }
        });
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
    fn file_controls(&mut self, ui: &mut egui::Ui) {
        ui.label("Transcribe an existing recording without changing the original.");
        if ui
            .add_enabled(!self.busy(), egui::Button::new("Choose WAV or MP3…"))
            .clicked()
            && let Some(path) = rfd::FileDialog::new()
                .add_filter("Audio", &["wav", "mp3"])
                .pick_file()
        {
            self.file = Some(path);
        }
        if let Some(path) = &self.file {
            ui.label(path.display().to_string());
        }
        if ui
            .add_enabled(
                !self.busy()
                    && self.file.is_some()
                    && self.controller.model() == &ModelState::Ready,
                egui::Button::new("Transcribe file").fill(Color32::from_rgb(30, 112, 99)),
            )
            .clicked()
        {
            self.start_file();
        }
    }
    fn transcript_controls(&mut self, ui: &mut egui::Ui) {
        ui.separator();
        ui.heading("Transcript");
        if let Some(reason) = self.transcript.reason() {
            ui.colored_label(Color32::LIGHT_RED, format!("Incomplete: {reason}"));
        }
        ui.horizontal(|ui| {
            let available=!self.transcript.stable_text().is_empty();
            if ui.add_enabled(available,egui::Button::new("Copy finalized text")).clicked(){ui.ctx().copy_text(self.transcript.export_text());}
            if ui.add_enabled(available,egui::Button::new("Save text…")).clicked()&&let Some(path)=rfd::FileDialog::new().set_file_name("transcript.txt").add_filter("UTF-8 text",&["txt"]).save_file(){match self.transcript.save_new(&path){Ok(())=>self.notice=format!("Text saved: {}",path.display()),Err(error)=>self.notice=format!("Text was not saved: {error}. Choose a new filename; the text remains available.")}}
            if ui.add_enabled(!self.busy()&&available,egui::Button::new("Discard transcript")).clicked(){self.transcript=Transcript::default();}
            if ui.add_enabled(self.job.is_some(),egui::Button::new("Cancel transcription")).clicked() && let Some(job)=&self.job{self.user_cancelled=true;job.cancel();}
        });
        egui::ScrollArea::vertical()
            .max_height(260.0)
            .show(ui, |ui| {
                let mut text = self.transcript.stable_text();
                if text.is_empty() {
                    ui.weak("Finalized words will appear here.");
                } else {
                    ui.add(
                        egui::TextEdit::multiline(&mut text)
                            .desired_width(f32::INFINITY)
                            .interactive(false),
                    );
                }
                let pending = self.transcript.pending_text();
                if !pending.is_empty() {
                    ui.label(
                        RichText::new(format!("Pending (may change): {pending}"))
                            .italics()
                            .color(Color32::from_gray(165)),
                    );
                }
            });
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
        egui::CentralPanel::default().show(ui, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| {
                ui.heading(RichText::new("rustcorder").size(30.0));
                ui.weak("Record. Transcribe. Keep it local.");
                ui.separator();
                ui.horizontal(|ui| {
                    ui.selectable_value(&mut self.file_tab, false, "Record");
                    ui.selectable_value(&mut self.file_tab, true, "Transcribe file");
                });
                if self.file_tab {
                    self.file_controls(ui);
                } else {
                    self.record_controls(ui);
                }
                ui.separator();
                self.model_controls(ui);
                ui.separator();
                ui.label(&self.status);
                if !self.notice.is_empty() {
                    ui.colored_label(Color32::LIGHT_YELLOW, &self.notice);
                    if ui.small_button("Dismiss message").clicked() {
                        self.notice.clear();
                    }
                }
                self.transcript_controls(ui);
            });
        });
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
    ui.horizontal(|ui| {
        ui.label(label);
        let name = devices
            .iter()
            .find(|d| Some(&d.id) == selected.as_ref())
            .map(|d| d.name.as_str())
            .unwrap_or("Select an available device");
        egui::ComboBox::from_id_salt(label)
            .selected_text(name)
            .width(420.0)
            .show_ui(ui, |ui| {
                for device in devices.iter().filter(|d| d.kind == kind) {
                    ui.selectable_value(selected, Some(device.id.clone()), &device.name);
                }
            });
    });
}

fn ui_busy(controller: &Controller, resources_pending: bool) -> bool {
    controller.is_busy() || resources_pending
}

fn live_finish_ready(capture: &CaptureState) -> bool {
    matches!(capture, CaptureState::Idle | CaptureState::Finished(_))
}

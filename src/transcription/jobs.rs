//! Background ownership of a local worker and bounded UI/capture queues.

use super::live::Scheduler;
use super::{
    Event, EventKind, ModelMetadata, PROTOCOL_VERSION, Request, RequestKind, WorkerError,
    WorkerProcess,
};
use crate::{
    app::{Language, ModelConfig},
    audio::LiveChunk,
    models::ModelCandidate,
};
use std::{
    path::PathBuf,
    process::Command,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Debug)]
pub enum JobEvent {
    Ready,
    ModelChecked {
        candidate: ModelCandidate,
        result: Result<ModelMetadata, String>,
    },
    Window {
        event: EventKind,
        final_window: bool,
    },
    Progress(String),
    Finished {
        result: Result<(), String>,
        end: u64,
        gap: bool,
    },
}

pub struct Job {
    pub events: JobEvents,
    cancel: Arc<AtomicBool>,
    thread: thread::JoinHandle<()>,
}

/// Bounded progress/text events plus one reserved terminal outcome.
/// A stalled window must not prevent cancellation from reaping native work.
pub struct JobEvents {
    normal: Receiver<JobEvent>,
    terminal: Receiver<JobEvent>,
}
impl JobEvents {
    pub fn try_recv(&self) -> Result<JobEvent, mpsc::TryRecvError> {
        let normal_disconnected = match self.normal.try_recv() {
            Ok(event) => return Ok(event),
            Err(mpsc::TryRecvError::Empty) => false,
            Err(mpsc::TryRecvError::Disconnected) => true,
        };
        match self.terminal.try_recv() {
            Ok(event) => Ok(event),
            Err(mpsc::TryRecvError::Disconnected) if normal_disconnected => {
                Err(mpsc::TryRecvError::Disconnected)
            }
            Err(_) => Err(mpsc::TryRecvError::Empty),
        }
    }
    pub fn try_iter(&self) -> impl Iterator<Item = JobEvent> + '_ {
        std::iter::from_fn(|| self.try_recv().ok())
    }
    pub fn recv_timeout(&self, timeout: Duration) -> Result<JobEvent, mpsc::RecvTimeoutError> {
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or(mpsc::RecvTimeoutError::Timeout)?;
        loop {
            match self.try_recv() {
                Ok(event) => return Ok(event),
                Err(mpsc::TryRecvError::Disconnected) => {
                    return Err(mpsc::RecvTimeoutError::Disconnected);
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or(mpsc::RecvTimeoutError::Timeout)?;
            thread::sleep(remaining.min(Duration::from_millis(2)));
        }
    }
}

fn publish(
    out: &SyncSender<JobEvent>,
    mut event: JobEvent,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let started = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Transcription cancelled".into());
        }
        if started.elapsed() >= Duration::from_secs(2) {
            return Err("The interface stopped receiving transcription events; available text is incomplete".into());
        }
        match out.try_send(event) {
            Ok(()) => return Ok(()),
            Err(mpsc::TrySendError::Disconnected(_)) => return Err("Window closed".into()),
            Err(mpsc::TrySendError::Full(pending)) => event = pending,
        }
        thread::sleep(Duration::from_millis(5));
    }
}

impl Job {
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
    pub fn is_finished(&self) -> bool {
        self.thread.is_finished()
    }
    pub fn validate(candidates: Vec<ModelCandidate>) -> Self {
        Self::spawn(move |out, cancel| {
            let mut worker = spawn_worker()?;
            let mut id = 0;
            for candidate in candidates {
                if cancel.load(Ordering::Relaxed) {
                    return Err("Cancelled".into());
                }
                let mut result = Err("The worker returned no model metadata".into());
                request(
                    &mut worker,
                    &mut id,
                    RequestKind::ValidateModel {
                        model_path: candidate.path.clone(),
                    },
                    &[],
                    Duration::from_secs(60),
                    &cancel,
                    |event| {
                        if let EventKind::ModelValidated {
                            valid,
                            model,
                            error,
                            ..
                        } = event.event
                        {
                            result = if valid {
                                model.ok_or("Missing model metadata".into())
                            } else {
                                Err(error.unwrap_or("Invalid model".into()))
                            };
                        }
                    },
                )?;
                publish(&out, JobEvent::ModelChecked { candidate, result }, &cancel)?;
            }
            shutdown(&mut worker, &mut id, &cancel);
            Ok((0, false))
        })
    }
    pub fn file(model: ModelConfig, audio_path: PathBuf) -> Self {
        Self::file_using(model, audio_path, None)
    }
    #[doc(hidden)]
    pub fn file_with_command(model: ModelConfig, audio_path: PathBuf, command: Command) -> Self {
        Self::file_using(model, audio_path, Some(command))
    }
    fn file_using(model: ModelConfig, audio_path: PathBuf, command: Option<Command>) -> Self {
        Self::spawn(move |out, cancel| {
            let mut worker = spawn_worker_using(command)?;
            let mut id = 0;
            load(&mut worker, &mut id, model.clone(), &cancel)?;
            publish(&out, JobEvent::Ready, &cancel)?;
            let mut end = 0;
            let mut failure = None;
            request(
                &mut worker,
                &mut id,
                RequestKind::TranscribeFile {
                    audio_path,
                    language: language(model.language).into(),
                },
                &[],
                Duration::from_secs(60),
                &cancel,
                |event| {
                    match &event.event {
                        EventKind::Error { message, .. } => failure = Some(message.clone()),
                        EventKind::Segments { coverage_end, .. }
                        | EventKind::NoSpeech { coverage_end, .. } => end = end.max(*coverage_end),
                        _ => {}
                    }
                    if let Err(message) = publish(
                        &out,
                        JobEvent::Window {
                            event: event.event,
                            final_window: true,
                        },
                        &cancel,
                    ) {
                        failure.get_or_insert(message);
                        cancel.store(true, Ordering::Relaxed);
                    }
                },
            )?;
            if let Some(message) = failure {
                return Err(message);
            }
            shutdown(&mut worker, &mut id, &cancel);
            Ok((end, false))
        })
    }
    pub fn live(model: ModelConfig) -> (Self, SyncSender<LiveChunk>) {
        Self::live_using(model, None, Duration::from_secs(30))
    }
    #[doc(hidden)]
    pub fn live_with_command(
        model: ModelConfig,
        command: Command,
        finalization_timeout: Duration,
    ) -> (Self, SyncSender<LiveChunk>) {
        Self::live_using(model, Some(command), finalization_timeout)
    }
    fn live_using(
        model: ModelConfig,
        command: Option<Command>,
        finalization_timeout: Duration,
    ) -> (Self, SyncSender<LiveChunk>) {
        let (input, chunks) = mpsc::sync_channel::<LiveChunk>(16);
        let job = Self::spawn(move |out, cancel| {
            let mut worker = spawn_worker_using(command)?;
            let mut id = 0;
            load(&mut worker, &mut id, model.clone(), &cancel)?;
            publish(&out, JobEvent::Ready, &cancel)?;
            let state = Arc::new(Mutex::new((Scheduler::default(), None::<Instant>, false)));
            let collector_state = state.clone();
            let collector_cancel = cancel.clone();
            let collector = thread::spawn(move || {
                while !collector_cancel.load(Ordering::Relaxed) {
                    match chunks.recv_timeout(Duration::from_millis(20)) {
                        Ok(chunk) => collector_state
                            .lock()
                            .unwrap()
                            .0
                            .push(chunk.start_sample, &chunk.samples),
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
                let mut state = collector_state.lock().unwrap();
                state.0.finish();
                state.1 = Some(Instant::now());
            });
            let result = (|| {
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        return Err("Cancelled; available finalized text is incomplete".into());
                    }
                    let (window, stopped) = {
                        let mut state = state.lock().unwrap();
                        (state.0.take(), state.1)
                    };
                    if let Some(stopped) = stopped
                        && stopped.elapsed() >= finalization_timeout
                    {
                        return Err(
                            "Final transcription exceeded 30 seconds; audio saving is independent"
                                .into(),
                        );
                    }
                    let Some(window) = window else {
                        if stopped.is_some() {
                            break;
                        }
                        thread::sleep(Duration::from_millis(10));
                        continue;
                    };
                    let command = RequestKind::TranscribeWindow {
                        language: language(model.language).into(),
                        start_sample: window.start,
                        end_sample: window.end(),
                        sample_count: window.samples.len(),
                        final_window: window.final_window,
                    };
                    let mut failure = None;
                    // Cancellation includes the independent post-Stop deadline, even if Stop arrives during inference.
                    let deadline_cancel = Arc::new(AtomicBool::new(false));
                    let watch_done = Arc::new(AtomicBool::new(false));
                    let (watch_cancel, done, watched, user_cancel) = (
                        deadline_cancel.clone(),
                        watch_done.clone(),
                        state.clone(),
                        cancel.clone(),
                    );
                    let watcher = thread::spawn(move || {
                        while !done.load(Ordering::Relaxed) {
                            if user_cancel.load(Ordering::Relaxed)
                                || watched
                                    .lock()
                                    .unwrap()
                                    .1
                                    .is_some_and(|at| at.elapsed() >= finalization_timeout)
                            {
                                watch_cancel.store(true, Ordering::Relaxed);
                                break;
                            }
                            thread::sleep(Duration::from_millis(20));
                        }
                    });
                    let response = request(
                        &mut worker,
                        &mut id,
                        command,
                        &window.samples,
                        Duration::from_secs(30),
                        &deadline_cancel,
                        |event| {
                            if let EventKind::Error { message, .. } = &event.event {
                                failure = Some(message.clone());
                            }
                            if let Err(message) = publish(
                                &out,
                                JobEvent::Window {
                                    event: event.event,
                                    final_window: window.final_window,
                                },
                                &deadline_cancel,
                            ) {
                                failure.get_or_insert(message);
                                deadline_cancel.store(true, Ordering::Relaxed);
                            }
                        },
                    );
                    watch_done.store(true, Ordering::Relaxed);
                    let _ = watcher.join();
                    response?;
                    if let Some(message) = failure {
                        return Err(message);
                    }
                }
                let state = state.lock().unwrap();
                Ok((state.0.end(), state.0.gap))
            })();
            // Stop the collector on worker failure; capture's nonblocking sender may disconnect safely.
            cancel.store(true, Ordering::Relaxed);
            let _ = collector.join();
            shutdown(&mut worker, &mut id, &AtomicBool::new(false));
            result
        });
        (job, input)
    }
    fn spawn(
        work: impl FnOnce(SyncSender<JobEvent>, Arc<AtomicBool>) -> Result<(u64, bool), String>
        + Send
        + 'static,
    ) -> Self {
        let (sender, events) = mpsc::sync_channel(128);
        let (terminal, terminal_events) = mpsc::sync_channel(1);
        let cancel = Arc::new(AtomicBool::new(false));
        let task_cancel = cancel.clone();
        let thread = thread::spawn(move || {
            let result = work(sender.clone(), task_cancel);
            let (result, end, gap) = match result {
                Ok((end, gap)) => (Ok(()), end, gap),
                Err(message) => (Err(message), 0, true),
            };
            let _ = terminal.send(JobEvent::Finished { result, end, gap });
        });
        Self {
            events: JobEvents {
                normal: events,
                terminal: terminal_events,
            },
            cancel,
            thread,
        }
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        self.cancel();
    }
}

fn spawn_worker() -> Result<WorkerProcess, String> {
    spawn_worker_using(None)
}
fn spawn_worker_using(command: Option<Command>) -> Result<WorkerProcess, String> {
    let command = match command {
        Some(command) => command,
        None => {
            let mut command = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
            command.arg("--asr-worker");
            command
        }
    };
    WorkerProcess::spawn(command, Duration::from_secs(10)).map_err(|e| e.to_string())
}
fn request(
    worker: &mut WorkerProcess,
    id: &mut u64,
    command: RequestKind,
    samples: &[f32],
    timeout: Duration,
    cancel: &AtomicBool,
    callback: impl FnMut(Event),
) -> Result<(), String> {
    *id += 1;
    worker
        .request(
            &Request {
                protocol: PROTOCOL_VERSION,
                id: *id,
                job_generation: 1,
                payload_bytes: samples.len() * 4,
                command,
            },
            samples,
            timeout,
            cancel,
            callback,
        )
        .map_err(|error| match error {
            WorkerError::Cancelled => {
                "Transcription cancelled or its finalization deadline expired".into()
            }
            other => other.to_string(),
        })
}
fn load(
    worker: &mut WorkerProcess,
    id: &mut u64,
    model: ModelConfig,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let mut failure = None;
    request(
        worker,
        id,
        RequestKind::LoadModel {
            model_path: model.path,
            language: language(model.language).into(),
        },
        &[],
        Duration::from_secs(60),
        cancel,
        |event| {
            if let EventKind::Error { message, .. } = event.event {
                failure = Some(message);
            }
        },
    )?;
    failure.map_or(Ok(()), Err)
}
fn shutdown(worker: &mut WorkerProcess, id: &mut u64, cancel: &AtomicBool) {
    let _ = request(
        worker,
        id,
        RequestKind::Shutdown,
        &[],
        Duration::from_secs(2),
        cancel,
        |_| {},
    );
}
pub fn language(value: Language) -> &'static str {
    match value {
        Language::Portuguese => "pt",
        Language::English => "en",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stalled_interface_queue_has_a_bounded_wait_without_user_cancellation() {
        let (sender, _receiver) = mpsc::sync_channel(1);
        sender.send(JobEvent::Ready).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let thread_cancel = cancel.clone();
        let publisher = thread::spawn(move || publish(&sender, JobEvent::Ready, &thread_cancel));
        let deadline = Instant::now() + Duration::from_secs(3);
        while !publisher.is_finished() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        let finished = publisher.is_finished();
        cancel.store(true, Ordering::Relaxed);
        assert!(publisher.join().unwrap().is_err());
        assert!(
            finished,
            "A full UI queue must not retain a native worker indefinitely"
        );
    }
}

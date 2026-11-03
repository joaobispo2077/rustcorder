//! Private bounded transport and child-process supervision for local inference.

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub mod worker;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_HEADER_BYTES: usize = 64 * 1024;
pub const MAX_PAYLOAD_BYTES: usize = 1024 * 1024;
pub const MAX_EVENT_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Request {
    pub protocol: u32,
    pub id: u64,
    pub job_generation: u64,
    pub payload_bytes: usize,
    #[serde(flatten)]
    pub command: RequestKind,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum RequestKind {
    ValidateModel {
        model_path: PathBuf,
    },
    LoadModel {
        model_path: PathBuf,
        language: String,
    },
    TranscribeFile {
        audio_path: PathBuf,
        language: String,
    },
    TranscribeWindow {
        language: String,
        start_sample: u64,
        end_sample: u64,
        sample_count: usize,
        final_window: bool,
    },
    Shutdown,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ModelMetadata {
    pub family: String,
    pub multilingual: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub start_sample: u64,
    pub end_sample: u64,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub protocol: u32,
    pub id: u64,
    pub job_generation: u64,
    #[serde(flatten)]
    pub event: EventKind,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum EventKind {
    Ready {
        model: Option<ModelMetadata>,
    },
    ModelValidated {
        path: PathBuf,
        valid: bool,
        model: Option<ModelMetadata>,
        error: Option<String>,
    },
    Progress {
        fraction: Option<f32>,
        stage: String,
        processed_samples: u64,
    },
    Segments {
        segments: Vec<Segment>,
        coverage_start: u64,
        coverage_end: u64,
        terminal: bool,
    },
    NoSpeech {
        coverage_start: u64,
        coverage_end: u64,
        terminal: bool,
    },
    Error {
        code: String,
        stage: String,
        message: String,
    },
}

#[derive(Debug)]
pub enum WorkerError {
    Io(io::Error),
    Protocol(String),
    Timeout,
    Cancelled,
    Exited,
}

impl std::fmt::Display for WorkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "Worker I/O: {error}"),
            Self::Protocol(message) => write!(f, "Invalid worker protocol: {message}"),
            Self::Timeout => write!(f, "Local transcription worker timed out"),
            Self::Cancelled => write!(f, "Local transcription was cancelled"),
            Self::Exited => write!(f, "Local transcription worker exited"),
        }
    }
}
impl std::error::Error for WorkerError {}
impl From<io::Error> for WorkerError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

fn protocol(message: &str) -> WorkerError {
    WorkerError::Protocol(message.into())
}

fn valid_language(language: &str) -> bool {
    matches!(language, "pt" | "en")
}

fn validate_request(request: &Request) -> Result<(), WorkerError> {
    if request.protocol != PROTOCOL_VERSION || request.id == 0 {
        return Err(protocol("Unsupported protocol or request identity"));
    }
    if request.payload_bytes > MAX_PAYLOAD_BYTES {
        return Err(protocol("Audio payload exceeds its limit"));
    }
    match &request.command {
        RequestKind::TranscribeWindow {
            language,
            start_sample,
            end_sample,
            sample_count,
            ..
        } => {
            if !valid_language(language)
                || end_sample.checked_sub(*start_sample) != Some(*sample_count as u64)
                || sample_count.checked_mul(4) != Some(request.payload_bytes)
            {
                return Err(protocol(
                    "Inconsistent audio window or unsupported language",
                ));
            }
        }
        other => {
            if request.payload_bytes != 0 {
                return Err(protocol("Non-audio requests cannot carry PCM"));
            }
            let valid = match other {
                RequestKind::ValidateModel { model_path } => model_path.is_absolute(),
                RequestKind::LoadModel {
                    model_path,
                    language,
                } => model_path.is_absolute() && valid_language(language),
                RequestKind::TranscribeFile {
                    audio_path,
                    language,
                } => audio_path.is_absolute() && valid_language(language),
                RequestKind::Shutdown => true,
                RequestKind::TranscribeWindow { .. } => unreachable!(),
            };
            if !valid {
                return Err(protocol("Invalid local path or language"));
            }
        }
    }
    Ok(())
}

fn encode_request(request: &Request, samples: &[f32]) -> Result<Vec<u8>, WorkerError> {
    validate_request(request)?;
    if samples.len().checked_mul(4) != Some(request.payload_bytes)
        || samples.iter().any(|sample| !sample.is_finite())
    {
        return Err(protocol("Invalid PCM samples or length"));
    }
    let header = serde_json::to_vec(request).map_err(|_| protocol("Request cannot be encoded"))?;
    if header.is_empty() || header.len() > MAX_HEADER_BYTES {
        return Err(protocol("Request header exceeds its limit"));
    }
    let mut frame = Vec::with_capacity(4 + header.len() + request.payload_bytes);
    frame.extend_from_slice(&(header.len() as u32).to_le_bytes());
    frame.extend_from_slice(&header);
    for sample in samples {
        frame.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(frame)
}

pub fn write_request<W: Write>(
    writer: &mut W,
    request: &Request,
    samples: &[f32],
) -> Result<(), WorkerError> {
    let frame = encode_request(request, samples)?;
    writer.write_all(&frame)?;
    writer.flush()?;
    Ok(())
}

pub fn read_request<R: Read>(reader: &mut R) -> Result<Option<(Request, Vec<f32>)>, WorkerError> {
    let mut length = [0; 4];
    match reader.read_exact(&mut length[..1]) {
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        result => result?,
    }
    reader.read_exact(&mut length[1..])?;
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_HEADER_BYTES {
        return Err(protocol("Invalid header length"));
    }
    let mut header = vec![0; length];
    reader.read_exact(&mut header)?;
    let request: Request =
        serde_json::from_slice(&header).map_err(|_| protocol("Invalid request JSON"))?;
    validate_request(&request)?;
    let mut bytes = vec![0; request.payload_bytes];
    reader.read_exact(&mut bytes)?;
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("four-byte chunk")))
        .collect();
    if samples.iter().any(|sample| !sample.is_finite()) {
        return Err(protocol("PCM contains non-finite samples"));
    }
    Ok(Some((request, samples)))
}

fn validate_event(event: &Event) -> Result<(), WorkerError> {
    if event.protocol != PROTOCOL_VERSION {
        return Err(protocol("Unsupported event protocol"));
    }
    match &event.event {
        EventKind::Progress { fraction, .. }
            if fraction
                .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value)) =>
        {
            return Err(protocol("Invalid progress fraction"));
        }
        EventKind::Segments {
            segments,
            coverage_start,
            coverage_end,
            ..
        } => {
            if coverage_start > coverage_end {
                return Err(protocol("Invalid coverage interval"));
            }
            let mut previous = *coverage_start;
            for segment in segments {
                if segment.start_sample < previous
                    || segment.end_sample < segment.start_sample
                    || segment.end_sample > *coverage_end
                {
                    return Err(protocol("Invalid segment interval"));
                }
                previous = segment.start_sample;
            }
        }
        EventKind::NoSpeech {
            coverage_start,
            coverage_end,
            ..
        } if coverage_start > coverage_end => {
            return Err(protocol("Invalid no-speech coverage"));
        }
        _ => {}
    }
    Ok(())
}

pub fn read_event<R: BufRead>(reader: &mut R) -> Result<Option<Event>, WorkerError> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(protocol("Truncated event line"))
            };
        }
        let count = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if line.len() + count > MAX_EVENT_BYTES {
            return Err(protocol("Event exceeds its limit"));
        }
        let finished = available[count - 1] == b'\n';
        line.extend_from_slice(&available[..count]);
        reader.consume(count);
        if finished {
            break;
        }
    }
    let event = serde_json::from_slice(&line)
        .map_err(|_| protocol("Worker stdout is not a valid JSON event"))?;
    validate_event(&event)?;
    Ok(Some(event))
}

pub fn write_event<W: Write>(writer: &mut W, event: &Event) -> Result<(), WorkerError> {
    validate_event(event)?;
    let mut line = serde_json::to_vec(event).map_err(|_| protocol("Event cannot be encoded"))?;
    line.push(b'\n');
    if line.len() > MAX_EVENT_BYTES {
        return Err(protocol("Event exceeds its limit"));
    }
    writer.write_all(&line)?;
    writer.flush()?;
    Ok(())
}

enum WireMessage {
    Event(Event),
    Eof,
    Error(WorkerError),
}

pub struct WorkerProcess {
    child: Option<Child>,
    writer: Option<SyncSender<Vec<u8>>>,
    events: Option<Receiver<WireMessage>>,
    threads: Vec<JoinHandle<()>>,
    last_id: u64,
}

impl WorkerProcess {
    pub fn spawn(mut command: Command, startup_timeout: Duration) -> Result<Self, WorkerError> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn()?;
        let mut stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let mut stderr = child.stderr.take().expect("piped stderr");
        let (event_tx, event_rx) = mpsc::sync_channel(32);
        let (write_tx, write_rx) = mpsc::sync_channel::<Vec<u8>>(1);
        let mut worker = Self {
            child: Some(child),
            writer: Some(write_tx),
            events: Some(event_rx),
            threads: Vec::new(),
            last_id: 0,
        };
        let read_tx = event_tx.clone();
        worker.threads.push(
            thread::Builder::new()
                .name("asr-events".into())
                .spawn(move || {
                    let mut input = BufReader::new(stdout);
                    loop {
                        let message = match read_event(&mut input) {
                            Ok(Some(event)) => WireMessage::Event(event),
                            Ok(None) => WireMessage::Eof,
                            Err(error) => WireMessage::Error(error),
                        };
                        let terminal = !matches!(message, WireMessage::Event(_));
                        if read_tx.send(message).is_err() || terminal {
                            break;
                        }
                    }
                })?,
        );
        worker.threads.push(
            thread::Builder::new()
                .name("asr-writer".into())
                .spawn(move || {
                    for frame in write_rx {
                        if let Err(error) = stdin.write_all(&frame).and_then(|()| stdin.flush()) {
                            let _ = event_tx.send(WireMessage::Error(error.into()));
                            break;
                        }
                    }
                })?,
        );
        worker.threads.push(
            thread::Builder::new()
                .name("asr-diagnostics".into())
                .spawn(move || {
                    let _ = io::copy(&mut stderr, &mut io::sink());
                })?,
        );
        let deadline = Self::deadline(startup_timeout)?;
        let handshake = worker.next(deadline, &AtomicBool::new(false))?;
        if !matches!(
            handshake,
            WireMessage::Event(Event {
                id: 0,
                job_generation: 0,
                event: EventKind::Ready { model: None },
                ..
            })
        ) {
            return Err(protocol("Invalid worker startup handshake"));
        }
        Ok(worker)
    }

    /// File requests use an idle deadline renewed only by advancing processed
    /// samples/coverage; native-window and other requests keep absolute deadlines.
    pub fn request<F: FnMut(Event)>(
        &mut self,
        request: &Request,
        samples: &[f32],
        timeout: Duration,
        cancel: &AtomicBool,
        mut on_event: F,
    ) -> Result<(), WorkerError> {
        let result = self.run_request(request, samples, timeout, cancel, &mut on_event);
        if result.is_err() {
            self.stop();
        }
        result
    }

    fn run_request<F: FnMut(Event)>(
        &mut self,
        request: &Request,
        samples: &[f32],
        timeout: Duration,
        cancel: &AtomicBool,
        on_event: &mut F,
    ) -> Result<(), WorkerError> {
        if !self.is_running() {
            return Err(WorkerError::Exited);
        }
        let frame = encode_request(request, samples)?;
        if request.id <= self.last_id {
            return Err(protocol("Request IDs must increase"));
        }
        let mut deadline = Self::deadline(timeout)?;
        let file_idle_deadline = matches!(&request.command, RequestKind::TranscribeFile { .. });
        let mut furthest_processed = 0;
        self.writer
            .as_ref()
            .ok_or(WorkerError::Exited)?
            .try_send(frame)
            .map_err(|_| protocol("Worker request queue is unavailable"))?;
        self.last_id = request.id;
        loop {
            match self.next(deadline, cancel)? {
                WireMessage::Event(event) => {
                    if event.id != request.id || event.job_generation != request.job_generation {
                        continue;
                    }
                    let terminal = terminal_for(&request.command, &event.event)?;
                    validate_window_coverage(&request.command, &event.event, terminal)?;
                    if file_idle_deadline && !terminal {
                        let processed = match &event.event {
                            EventKind::Progress {
                                processed_samples, ..
                            } => *processed_samples,
                            EventKind::Segments { coverage_end, .. }
                            | EventKind::NoSpeech { coverage_end, .. } => *coverage_end,
                            _ => furthest_processed,
                        };
                        if processed > furthest_processed {
                            furthest_processed = processed;
                            deadline = Self::deadline(timeout)?;
                        }
                    }
                    on_event(event);
                    if terminal {
                        return Ok(());
                    }
                }
                WireMessage::Eof if matches!(request.command, RequestKind::Shutdown) => loop {
                    if cancel.load(Ordering::Acquire) {
                        return Err(WorkerError::Cancelled);
                    }
                    if Instant::now() >= deadline {
                        return Err(WorkerError::Timeout);
                    }
                    match self.child.as_mut().ok_or(WorkerError::Exited)?.try_wait()? {
                        Some(status) if status.success() => {
                            self.stop();
                            return Ok(());
                        }
                        Some(_) => return Err(WorkerError::Exited),
                        None => thread::sleep(Duration::from_millis(10)),
                    }
                },
                WireMessage::Eof => return Err(WorkerError::Exited),
                WireMessage::Error(error) => return Err(error),
            }
        }
    }

    fn deadline(timeout: Duration) -> Result<Instant, WorkerError> {
        Instant::now()
            .checked_add(timeout)
            .ok_or_else(|| protocol("Invalid worker deadline"))
    }

    fn next(&mut self, deadline: Instant, cancel: &AtomicBool) -> Result<WireMessage, WorkerError> {
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err(WorkerError::Cancelled);
            }
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or(WorkerError::Timeout)?;
            let receiver = self.events.as_ref().ok_or(WorkerError::Exited)?;
            match receiver.recv_timeout(remaining.min(Duration::from_millis(20))) {
                Ok(WireMessage::Error(error)) => return Err(error),
                Ok(message) => return Ok(message),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err(WorkerError::Exited),
            }
        }
    }

    pub fn is_running(&mut self) -> bool {
        self.child
            .as_mut()
            .is_some_and(|child| matches!(child.try_wait(), Ok(None)))
    }

    fn stop(&mut self) {
        self.writer.take();
        self.events.take();
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        for handle in self.threads.drain(..) {
            let _ = handle.join();
        }
    }
}

impl Drop for WorkerProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

fn terminal_for(command: &RequestKind, event: &EventKind) -> Result<bool, WorkerError> {
    if matches!(command, RequestKind::Shutdown) {
        return Err(protocol("Shutdown requires a clean worker exit"));
    }
    match event {
        EventKind::Error { .. } => Ok(true),
        EventKind::Progress { .. } if !matches!(command, RequestKind::Shutdown) => Ok(false),
        EventKind::ModelValidated { .. }
            if matches!(command, RequestKind::ValidateModel { .. }) =>
        {
            Ok(true)
        }
        EventKind::Ready { model: Some(_) } if matches!(command, RequestKind::LoadModel { .. }) => {
            Ok(true)
        }
        EventKind::Segments { terminal, .. } | EventKind::NoSpeech { terminal, .. }
            if matches!(
                command,
                RequestKind::TranscribeWindow { .. } | RequestKind::TranscribeFile { .. }
            ) =>
        {
            Ok(*terminal)
        }
        _ => Err(protocol("Unexpected event for this request")),
    }
}

fn validate_window_coverage(
    command: &RequestKind,
    event: &EventKind,
    terminal: bool,
) -> Result<(), WorkerError> {
    let RequestKind::TranscribeWindow {
        start_sample,
        end_sample,
        ..
    } = command
    else {
        return Ok(());
    };
    let (coverage_start, coverage_end) = match event {
        EventKind::Segments {
            coverage_start,
            coverage_end,
            ..
        }
        | EventKind::NoSpeech {
            coverage_start,
            coverage_end,
            ..
        } => (*coverage_start, *coverage_end),
        _ => return Ok(()),
    };
    if coverage_start < *start_sample
        || coverage_end > *end_sample
        || (terminal && (coverage_start != *start_sample || coverage_end != *end_sample))
    {
        return Err(protocol(
            "Worker coverage does not match the requested window",
        ));
    }
    Ok(())
}

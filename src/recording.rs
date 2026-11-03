//! Non-overwriting, bounded local PCM WAV recording.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: u16 = 2;
pub const MAX_FRAMES: u64 = SAMPLE_RATE as u64 * 60 * 60 * 6;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecordingStatus {
    Completed,
    Partial,
    SaveFailed,
}

#[derive(Clone, Debug)]
pub struct RecordingOutcome {
    pub path: PathBuf,
    pub frames: u64,
    pub status: RecordingStatus,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecordingError {
    Io(String),
    InvalidSamples,
    LimitReached,
}

impl std::fmt::Display for RecordingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) => write!(f, "Cannot save the local recording: {message}"),
            Self::InvalidSamples => write!(f, "Recording requires complete finite stereo frames"),
            Self::LimitReached => write!(f, "The six-hour recording limit has been reached"),
        }
    }
}
impl std::error::Error for RecordingError {}

pub struct RecordingWriter<W: Write + Seek> {
    path: PathBuf,
    writer: hound::WavWriter<W>,
    frames: u64,
    max_frames: u64,
    last_checkpoint: u64,
    failure: Option<String>,
}
pub type WavRecording = RecordingWriter<BufWriter<File>>;

impl WavRecording {
    pub fn create(folder: &Path) -> Result<Self, RecordingError> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let stem = format!(
            "rustcorder-{}-{:09}-{}",
            stamp.as_secs(),
            stamp.subsec_nanos(),
            std::process::id()
        );
        Self::create_named(folder, &stem)
    }
    fn create_named(folder: &Path, stem: &str) -> Result<Self, RecordingError> {
        for suffix in 0..10_000 {
            let name = if suffix == 0 {
                format!("{stem}.wav")
            } else {
                format!("{stem}-{suffix}.wav")
            };
            let path = folder.join(name);
            let file = match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(RecordingError::Io(format!("{}: {error}", path.display())));
                }
            };
            return Self::from_writer(BufWriter::with_capacity(64 * 1024, file), path, MAX_FRAMES);
        }
        Err(RecordingError::Io(
            "No unused recording filename is available in this folder".into(),
        ))
    }
}
impl<W: Write + Seek> RecordingWriter<W> {
    fn from_writer(writer: W, path: PathBuf, max_frames: u64) -> Result<Self, RecordingError> {
        if max_frames == 0 || max_frames > MAX_FRAMES {
            return Err(RecordingError::Io(
                "Invalid bounded recording duration".into(),
            ));
        }
        let spec = hound::WavSpec {
            channels: CHANNELS,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::new(writer, spec)
            .map_err(|error| RecordingError::Io(format!("{}: {error}", path.display())))?;
        // Flush the initial header so an unwritable/full destination fails before capture.
        writer
            .flush()
            .map_err(|error| RecordingError::Io(format!("{}: {error}", path.display())))?;
        Ok(Self {
            path,
            writer,
            frames: 0,
            max_frames,
            last_checkpoint: 0,
            failure: None,
        })
    }
    /// Append stereo frames. At the duration cap, accepts only remaining frames,
    /// then returns `LimitReached` so the owner can stop/save normally.
    pub fn append_interleaved(&mut self, samples: &[f32]) -> Result<(), RecordingError> {
        if !samples.len().is_multiple_of(CHANNELS as usize)
            || samples.iter().any(|sample| !sample.is_finite())
        {
            return Err(self.invalid_samples());
        }
        self.append_samples(samples.iter().copied().map(pcm_sample), samples.len())
    }
    pub fn append_pcm(&mut self, samples: &[i16]) -> Result<(), RecordingError> {
        if !samples.len().is_multiple_of(CHANNELS as usize) {
            return Err(self.invalid_samples());
        }
        self.append_samples(samples.iter().copied(), samples.len())
    }

    fn invalid_samples(&mut self) -> RecordingError {
        let error = RecordingError::InvalidSamples;
        self.failure.get_or_insert_with(|| error.to_string());
        error
    }

    fn append_samples(
        &mut self,
        samples: impl Iterator<Item = i16>,
        count: usize,
    ) -> Result<(), RecordingError> {
        if let Some(message) = &self.failure {
            return Err(RecordingError::Io(message.clone()));
        }
        let frames = (count / CHANNELS as usize) as u64;
        let remaining = self.max_frames.saturating_sub(self.frames);
        let accepted = frames.min(remaining);
        let result = (|| {
            for sample in samples.take(accepted as usize * CHANNELS as usize) {
                self.writer.write_sample(sample)?;
            }
            Ok::<(), hound::Error>(())
        })();
        self.frames = self.writer.duration() as u64;
        if let Err(error) = result {
            let message = error.to_string();
            self.failure = Some(message.clone());
            return Err(RecordingError::Io(message));
        }
        if self.frames.saturating_sub(self.last_checkpoint) >= SAMPLE_RATE as u64 {
            if let Err(error) = self.writer.flush() {
                let message = error.to_string();
                self.failure = Some(message.clone());
                return Err(RecordingError::Io(message));
            }
            self.last_checkpoint = self.frames;
        }
        if self.limit_reached() {
            Err(RecordingError::LimitReached)
        } else {
            Ok(())
        }
    }

    pub fn frames_written(&self) -> u64 {
        self.frames
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn limit_reached(&self) -> bool {
        self.frames >= self.max_frames
    }

    /// Finalization is explicit: a retained path alone never establishes success.
    pub fn finalize(self, interruption: Option<String>) -> RecordingOutcome {
        let mut error = self.failure.or(interruption);
        let status = match self.writer.finalize() {
            Ok(()) if error.is_some() => RecordingStatus::Partial,
            Ok(()) => RecordingStatus::Completed,
            Err(cause) => {
                let message = format!("WAV finalization failed: {cause}");
                error = Some(match error {
                    Some(prior) => format!("{prior}; {message}"),
                    None => message,
                });
                RecordingStatus::SaveFailed
            }
        };
        RecordingOutcome {
            path: self.path,
            frames: self.frames,
            status,
            error,
        }
    }
}
fn pcm_sample(sample: f32) -> i16 {
    let sample = sample.clamp(-1.0, 1.0);
    let scale = if sample < 0.0 { 32768.0 } else { 32767.0 };
    (sample * scale).round() as i16
}

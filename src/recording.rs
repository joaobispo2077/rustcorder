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

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::io::{self, Cursor, Read, SeekFrom};
    use std::rc::Rc;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[derive(Default)]
    struct State {
        bytes: Cursor<Vec<u8>>,
        fail_after: Option<u64>,
        fail_seek: bool,
        fail_flush: bool,
    }
    struct Shared(Rc<RefCell<State>>);
    impl Write for Shared {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            let mut state = self.0.borrow_mut();
            if let Some(limit) = state.fail_after {
                let remaining = limit.saturating_sub(state.bytes.position()) as usize;
                if remaining == 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::StorageFull,
                        "injected disk full",
                    ));
                }
                return state.bytes.write(&bytes[..remaining.min(bytes.len())]);
            }
            state.bytes.write(bytes)
        }
        fn flush(&mut self) -> io::Result<()> {
            if self.0.borrow().fail_flush {
                Err(io::Error::other("injected flush failure"))
            } else {
                Ok(())
            }
        }
    }
    impl Seek for Shared {
        fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
            let mut state = self.0.borrow_mut();
            if state.fail_seek {
                Err(io::Error::other("injected seek failure"))
            } else {
                state.bytes.seek(position)
            }
        }
    }
    fn sink(max_frames: u64) -> (RecordingWriter<Shared>, Rc<RefCell<State>>) {
        let state = Rc::new(RefCell::new(State::default()));
        let result =
            RecordingWriter::from_writer(Shared(state.clone()), "partial.wav".into(), max_frames);
        assert!(result.is_ok(), "a writable sink must initialize");
        let writer = result.unwrap();
        (writer, state)
    }
    fn folder() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target/recording-tests")
            .join(format!(
                "{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn float_pcm_conversion_clamps_and_preserves_both_signed_endpoints() {
        assert_eq!(pcm_sample(-2.0), i16::MIN);
        assert_eq!(pcm_sample(-1.0), i16::MIN);
        assert_eq!(pcm_sample(0.0), 0);
        assert_eq!(pcm_sample(1.0), i16::MAX);
        assert_eq!(pcm_sample(2.0), i16::MAX);
        assert_eq!(pcm_sample(0.5), 16_384);
    }
    #[test]
    fn pcm_round_trip_has_stereo_48khz_header_and_frame_duration() {
        let (mut writer, state) = sink(MAX_FRAMES);
        writer.append_pcm(&[i16::MIN, i16::MAX, 23, -45]).unwrap();
        assert_eq!(writer.frames_written(), 2);
        let outcome = writer.finalize(None);
        assert_eq!(outcome.status, RecordingStatus::Completed);
        assert_eq!(outcome.frames, 2);
        assert!(outcome.error.is_none());
        let mut reader =
            hound::WavReader::new(Cursor::new(state.borrow().bytes.get_ref().clone())).unwrap();
        assert_eq!(reader.spec().sample_rate, SAMPLE_RATE);
        assert_eq!(reader.spec().channels, CHANNELS);
        assert_eq!(reader.spec().bits_per_sample, 16);
        assert_eq!(reader.duration(), 2);
        assert_eq!(
            reader
                .samples::<i16>()
                .collect::<Result<Vec<_>, _>>()
                .unwrap(),
            vec![i16::MIN, i16::MAX, 23, -45]
        );
    }
    #[test]
    fn float_append_writes_complete_clamped_pcm_frames() {
        let (mut writer, state) = sink(MAX_FRAMES);
        writer.append_interleaved(&[-2.0, 2.0, 0.0, 0.5]).unwrap();
        assert_eq!(writer.finalize(None).status, RecordingStatus::Completed);
        let samples = hound::WavReader::new(Cursor::new(state.borrow().bytes.get_ref().clone()))
            .unwrap()
            .samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(samples, vec![i16::MIN, i16::MAX, 0, 16_384]);
    }
    #[test]
    fn odd_or_nonfinite_input_is_rejected_before_writing_any_samples() {
        for invalid in [vec![0.1], vec![0.0, f32::NAN], vec![f32::INFINITY, 0.0]] {
            let (mut writer, _) = sink(MAX_FRAMES);
            assert_eq!(
                writer.append_interleaved(&invalid),
                Err(RecordingError::InvalidSamples)
            );
            assert_eq!(writer.frames_written(), 0);
            assert_ne!(writer.finalize(None).status, RecordingStatus::Completed);
        }
        let (mut writer, _) = sink(MAX_FRAMES);
        assert_eq!(writer.append_pcm(&[1]), Err(RecordingError::InvalidSamples));
        assert_eq!(writer.frames_written(), 0);
    }
    #[test]
    fn the_six_hour_cap_fits_standard_riff_and_never_writes_past_boundary() {
        assert!(MAX_FRAMES * 4 + 68 < u32::MAX as u64);
        let (mut writer, state) = sink(3);
        assert_eq!(
            writer.append_pcm(&[1, 2, 3, 4, 5, 6, 7, 8]),
            Err(RecordingError::LimitReached)
        );
        assert_eq!(writer.frames_written(), 3);
        assert!(writer.limit_reached());
        assert_eq!(
            writer.append_pcm(&[9, 10]),
            Err(RecordingError::LimitReached)
        );
        assert_eq!(writer.finalize(None).status, RecordingStatus::Completed);
        let reader =
            hound::WavReader::new(Cursor::new(state.borrow().bytes.get_ref().clone())).unwrap();
        assert_eq!(reader.duration(), 3);
    }
    #[test]
    fn exact_boundary_returns_controlled_stop_with_valid_audio() {
        let (mut writer, _) = sink(1);
        assert_eq!(
            writer.append_pcm(&[1, 2]),
            Err(RecordingError::LimitReached)
        );
        assert_eq!(writer.frames_written(), 1);
        assert_eq!(writer.finalize(None).status, RecordingStatus::Completed);
    }
    #[test]
    fn interrupted_capture_preserves_playable_partial_audio_and_reason() {
        let (mut writer, state) = sink(MAX_FRAMES);
        writer.append_pcm(&[1, 2, 3, 4]).unwrap();
        let result = writer.finalize(Some("microphone disconnected".into()));
        assert_eq!(result.status, RecordingStatus::Partial);
        assert_eq!(result.path, PathBuf::from("partial.wav"));
        assert!(result.error.unwrap().contains("disconnected"));
        assert_eq!(
            hound::WavReader::new(Cursor::new(state.borrow().bytes.get_ref().clone()))
                .unwrap()
                .duration(),
            2
        );
    }
    #[test]
    fn write_failure_is_latched_and_never_reported_as_completed() {
        let (mut writer, state) = sink(MAX_FRAMES);
        writer.append_pcm(&[1, 2]).unwrap();
        let position = state.borrow().bytes.position();
        state.borrow_mut().fail_after = Some(position);
        assert!(writer.append_pcm(&[3, 4]).is_err());
        assert!(writer.append_pcm(&[5, 6]).is_err());
        let result = writer.finalize(None);
        assert_ne!(result.status, RecordingStatus::Completed);
        assert!(result.error.is_some());
        assert_eq!(result.path, PathBuf::from("partial.wav"));
    }
    #[test]
    fn header_seek_and_buffer_flush_failures_are_explicit_save_failures() {
        for fail_seek in [false, true] {
            let (mut writer, state) = sink(MAX_FRAMES);
            writer.append_pcm(&[1, 2]).unwrap();
            state.borrow_mut().fail_seek = fail_seek;
            state.borrow_mut().fail_flush = !fail_seek;
            let result = writer.finalize(None);
            assert_eq!(result.status, RecordingStatus::SaveFailed);
            assert!(result.error.is_some());
            assert_eq!(result.path, PathBuf::from("partial.wav"));
        }
    }
    #[test]
    fn create_new_names_never_overwrite_an_existing_recording() {
        let folder = folder();
        let mut first = WavRecording::create_named(&folder, "same-name").unwrap();
        first.append_pcm(&[17, 18]).unwrap();
        let first = first.finalize(None);
        let original = std::fs::read(&first.path).unwrap();
        let mut second = WavRecording::create_named(&folder, "same-name").unwrap();
        second.append_pcm(&[19, 20]).unwrap();
        let second = second.finalize(None);
        assert_ne!(first.path, second.path);
        assert_eq!(std::fs::read(first.path).unwrap(), original);
        assert_eq!(second.status, RecordingStatus::Completed);
    }
    #[test]
    fn missing_or_non_directory_destination_fails_preflight() {
        let folder = folder();
        assert!(WavRecording::create(&folder.join("missing")).is_err());
        let file = folder.join("not-a-folder");
        std::fs::write(&file, b"existing input").unwrap();
        assert!(WavRecording::create(&file).is_err());
        assert_eq!(std::fs::read(file).unwrap(), b"existing input");
    }
    #[test]
    fn real_saved_file_reopens_with_original_pcm() {
        let mut writer = WavRecording::create(&folder()).unwrap();
        assert!(writer.path().is_file());
        writer.append_pcm(&[12, -12, 45, -45]).unwrap();
        let result = writer.finalize(None);
        let mut reader = hound::WavReader::open(&result.path).unwrap();
        let mut bytes = Vec::new();
        File::open(&result.path)
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert!(!bytes.is_empty());
        assert_eq!(
            reader
                .samples::<i16>()
                .collect::<Result<Vec<_>, _>>()
                .unwrap(),
            vec![12, -12, 45, -45]
        );
    }
}

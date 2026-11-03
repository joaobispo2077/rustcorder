//! Bounded audio capture and the recording-priority timeline.

use crate::app::RecordingMode;
use crate::recording::{RecordingError, RecordingStatus, WavRecording};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{
    Adjustable, Async, FixedAsync, PolynomialDegree, Resampler, Resizable,
    SincInterpolationParameters,
};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub mod windows;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceKind {
    Microphone,
    ComputerOutput,
}
#[derive(Clone, Debug)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub kind: DeviceKind,
    pub is_default: bool,
}
#[derive(Clone, Debug)]
pub struct CaptureConfig {
    pub mode: RecordingMode,
    pub microphone_id: String,
    pub output_id: Option<String>,
    pub save_folder: PathBuf,
}
#[derive(Clone, Debug)]
pub struct LiveChunk {
    pub start_sample: u64,
    pub samples: Vec<f32>,
}
#[derive(Debug)]
pub enum AudioEvent {
    Started,
    Level {
        peak: f32,
        elapsed_frames: u64,
    },
    Finished {
        path: PathBuf,
        frames: u64,
        interrupted: Option<String>,
    },
    Failed(String),
}
#[derive(Clone, Debug)]
pub struct AudioError(pub String);
impl std::fmt::Display for AudioError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}
impl std::error::Error for AudioError {}

pub struct Session {
    pub events: Receiver<AudioEvent>,
    pub transcription_errors: Receiver<String>,
    stop: Arc<AtomicBool>,
    stop_at: Arc<AtomicU64>,
}
impl Session {
    #[cfg(test)]
    pub(crate) fn test_session(
        events: Receiver<AudioEvent>,
        transcription_errors: Receiver<String>,
    ) -> Self {
        Self {
            events,
            transcription_errors,
            stop: Arc::new(AtomicBool::new(false)),
            stop_at: Arc::new(AtomicU64::new(0)),
        }
    }
    pub fn stop(&self) {
        if let Ok(now) = windows::now_hns() {
            let _ = self
                .stop_at
                .compare_exchange(0, now, Ordering::AcqRel, Ordering::Acquire);
        }
        self.stop.store(true, Ordering::Release);
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn enumerate() -> Result<Vec<DeviceInfo>, AudioError> {
    windows::enumerate()
}
pub fn start(
    config: CaptureConfig,
    live: Option<SyncSender<LiveChunk>>,
) -> Result<Session, AudioError> {
    if config.microphone_id.is_empty()
        || (config.mode == RecordingMode::MicrophoneAndComputer
            && config.output_id.as_ref().is_none_or(String::is_empty))
    {
        return Err(AudioError(
            "Select the required microphone and computer output before recording".into(),
        ));
    }
    let stop = Arc::new(AtomicBool::new(false));
    let stop_at = Arc::new(AtomicU64::new(0));
    let (sender, events) = mpsc::sync_channel(8);
    let (text_errors, transcription_errors) = mpsc::sync_channel(1);
    let (owner_stop, owner_stamp) = (stop.clone(), stop_at.clone());
    std::thread::Builder::new()
        .name("audio-writer".into())
        .spawn(move || {
            if let Err(error) = record(
                config,
                live,
                &sender,
                &text_errors,
                owner_stop.clone(),
                owner_stamp,
            ) {
                owner_stop.store(true, Ordering::Release);
                let _ = sender.send(AudioEvent::Failed(error.0));
            }
        })
        .map_err(|error| AudioError(format!("Cannot start recording: {error}")))?;
    Ok(Session {
        events,
        transcription_errors,
        stop,
        stop_at,
    })
}

fn decode_packet(bytes: &[u8], frames: usize, silent: bool) -> Result<Vec<[f32; 2]>, AudioError> {
    if frames > 48_000 {
        return Err(AudioError(
            "The audio source returned an oversized packet".into(),
        ));
    }
    if silent {
        return Ok(vec![[0.0; 2]; frames]);
    }
    if bytes.len() != frames * 8 {
        return Err(AudioError(
            "The audio source returned an incomplete stereo packet".into(),
        ));
    }
    bytes
        .chunks_exact(8)
        .map(|frame| {
            let left = f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]);
            let right = f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]);
            if !left.is_finite() || !right.is_finite() {
                return Err(AudioError(
                    "The audio source returned invalid samples".into(),
                ));
            }
            Ok([left, right])
        })
        .collect()
}
fn frame_from_timestamp(epoch: u64, timestamp: u64) -> u64 {
    (timestamp.saturating_sub(epoch) as u128 * 48_000 / 10_000_000) as u64
}
fn check_clock_step(previous: u64, now: u64) -> Result<(), AudioError> {
    if now < previous || now - previous >= 5_000_000 {
        return Err(AudioError(
            "Recording was interrupted by sleep or a storage delay".into(),
        ));
    }
    Ok(())
}
fn clock_ratio(frames: u64, duration_hns: u64) -> Result<f64, AudioError> {
    let ratio = duration_hns as f64 * 48_000.0 / 10_000_000.0 / frames as f64;
    if frames == 0 || !ratio.is_finite() || !(0.98..=1.02).contains(&ratio) {
        return Err(AudioError(
            "The selected audio source has an unstable recording clock".into(),
        ));
    }
    Ok(ratio)
}
fn mix_frame(mic: [f32; 2], output: Option<[f32; 2]>) -> [f32; 2] {
    match output {
        None => mic.map(|sample| sample.clamp(-1.0, 1.0)),
        Some(output) => {
            let voice = (mic[0] + mic[1]) * 0.5;
            [
                (voice * 0.5 + output[0] * 0.5).clamp(-1.0, 1.0),
                (voice * 0.5 + output[1] * 0.5).clamp(-1.0, 1.0),
            ]
        }
    }
}

#[derive(Default)]
struct Timeline {
    chunks: VecDeque<(u64, Vec<[f32; 2]>)>,
    buffered: usize,
}
impl Timeline {
    fn push(&mut self, start: u64, frames: Vec<[f32; 2]>, written: u64) -> Result<(), AudioError> {
        if frames.is_empty() {
            return Ok(());
        }
        if start < written {
            return Err(AudioError(
                "Audio arrived too late to save without a gap".into(),
            ));
        }
        if self
            .chunks
            .back()
            .is_some_and(|(previous, data)| start < *previous + data.len() as u64)
        {
            return Err(AudioError(
                "The audio clock produced overlapping packets".into(),
            ));
        }
        if self.buffered + frames.len() > 96_000 {
            return Err(AudioError(
                "The recording buffer filled before audio could be saved".into(),
            ));
        }
        self.buffered += frames.len();
        self.chunks.push_back((start, frames));
        Ok(())
    }
    fn sample_at(&mut self, frame: u64) -> Option<[f32; 2]> {
        while self
            .chunks
            .front()
            .is_some_and(|(start, data)| *start + data.len() as u64 <= frame)
        {
            if let Some((_, data)) = self.chunks.pop_front() {
                self.buffered -= data.len();
            }
        }
        let (start, data) = self.chunks.front()?;
        frame
            .checked_sub(*start)
            .and_then(|offset| data.get(offset as usize).copied())
    }
}
#[derive(Default)]
struct LiveDelivery {
    next_sample: u64,
}
impl LiveDelivery {
    fn send(&mut self, sender: &SyncSender<LiveChunk>, samples: Vec<f32>) {
        let start_sample = self.next_sample;
        self.next_sample += samples.len() as u64;
        let _ = sender.try_send(LiveChunk {
            start_sample,
            samples,
        });
    }
}

fn resampling_error(error: impl std::fmt::Display) -> AudioError {
    AudioError(format!("Cannot normalize recording audio: {error}"))
}

fn convert_live(
    converter: &mut Option<Converter>,
    samples: &[f32],
    errors: &SyncSender<String>,
) -> Option<Vec<f32>> {
    match converter.as_mut()?.convert(samples) {
        Ok(output) => Some(output),
        Err(error) => {
            *converter = None;
            // Separate capacity-one control slot preserves the first text fault without
            // blocking the recording writer or competing with level/audio events.
            let _ = errors.try_send(error.to_string());
            None
        }
    }
}

struct Converter {
    resampler: Async<f32>,
    channels: usize,
    trim: usize,
}
impl Converter {
    fn new(channels: usize, ratio: f64, sinc: bool) -> Result<Self, AudioError> {
        let resampler = if sinc {
            Async::new_sinc(
                ratio,
                1.025,
                &SincInterpolationParameters::default(),
                48_000,
                channels,
                FixedAsync::Input,
            )
        } else {
            Async::new_poly(
                ratio,
                1.025,
                PolynomialDegree::Cubic,
                48_000,
                channels,
                FixedAsync::Input,
            )
        }
        .map_err(resampling_error)?;
        let trim = resampler.output_delay();
        Ok(Self {
            resampler,
            channels,
            trim,
        })
    }
    fn convert(&mut self, input: &[f32]) -> Result<Vec<f32>, AudioError> {
        if input.is_empty() {
            return Ok(Vec::new());
        }
        self.resampler
            .set_chunk_size(input.len() / self.channels)
            .map_err(resampling_error)?;
        let adapter = InterleavedSlice::new(input, self.channels, input.len() / self.channels)
            .map_err(resampling_error)?;
        let mut output = self
            .resampler
            .process(&adapter, None)
            .map_err(resampling_error)?
            .take_data();
        let trim = self.trim.min(output.len() / self.channels);
        output.drain(..trim * self.channels);
        self.trim -= trim;
        Ok(output)
    }
}

struct SourceClock {
    converter: Converter,
    origin: u64,
    cursor: u64,
    start: u64,
    input_frames: u64,
    ratio: f64,
}
impl SourceClock {
    fn new(epoch: u64, timestamp: u64) -> Result<Self, AudioError> {
        let start = frame_from_timestamp(epoch, timestamp);
        Ok(Self {
            converter: Converter::new(2, 1.0, false)?,
            origin: timestamp,
            cursor: start,
            start,
            input_frames: 0,
            ratio: 1.0,
        })
    }
    fn accept(
        &mut self,
        timestamp: u64,
        frames: Vec<[f32; 2]>,
        timeline: &mut Timeline,
        written: u64,
    ) -> Result<(), AudioError> {
        if self.input_frames >= 24_000 {
            let measured = clock_ratio(self.input_frames, timestamp.saturating_sub(self.origin))?;
            self.ratio = self.ratio * 0.9 + measured * 0.1;
            self.converter
                .resampler
                .set_resample_ratio(self.ratio, true)
                .map_err(resampling_error)?;
        }
        self.input_frames += frames.len() as u64;
        let input: Vec<f32> = frames.into_iter().flatten().collect();
        let output = self.converter.convert(&input)?;
        self.push(output, timeline, written)
    }
    fn push(
        &mut self,
        output: Vec<f32>,
        timeline: &mut Timeline,
        written: u64,
    ) -> Result<(), AudioError> {
        let frames: Vec<_> = output
            .chunks_exact(2)
            .map(|pair| [pair[0], pair[1]])
            .collect();
        let count = frames.len() as u64;
        timeline.push(self.cursor, frames, written)?;
        self.cursor += count;
        Ok(())
    }
    fn finish(&mut self, timeline: &mut Timeline, written: u64) -> Result<(), AudioError> {
        let target = (self.input_frames as f64 * self.ratio).round() as u64;
        // Only flush filter history; padded input must not extend the source duration.
        let count = self.converter.resampler.output_delay().max(32);
        let mut output = self.converter.convert(&vec![0.0; count * 2])?;
        let produced = self.cursor.saturating_sub(self.start);
        output.truncate(target.saturating_sub(produced) as usize * 2);
        self.push(output, timeline, written)
    }
}

fn ready(source: &windows::Source, stop: &AtomicBool) -> Result<(), AudioError> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if stop.load(Ordering::Acquire) {
            return Err(AudioError(
                "Recording stopped before all selected sources were ready".into(),
            ));
        }
        match source.ready.recv_timeout(Duration::from_millis(30)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {}
            _ => {
                return Err(AudioError(
                    "The selected audio source did not start in time".into(),
                ));
            }
        }
    }
}

fn record(
    config: CaptureConfig,
    live: Option<SyncSender<LiveChunk>>,
    events: &SyncSender<AudioEvent>,
    text_errors: &SyncSender<String>,
    stop: Arc<AtomicBool>,
    stop_at: Arc<AtomicU64>,
) -> Result<(), AudioError> {
    windows::prioritize();
    let mut recording =
        WavRecording::create(&config.save_folder).map_err(|error| AudioError(error.to_string()))?;
    let mut live_converter = if live.is_some() {
        match Converter::new(1, 1.0 / 3.0, true) {
            Ok(converter) => Some(converter),
            Err(error) => {
                let _ = text_errors.try_send(error.to_string());
                None
            }
        }
    } else {
        None
    };
    let (packets_tx, packets) = mpsc::sync_channel(128);
    let fault = Arc::new(Mutex::new(None));
    let mut sources = Vec::new();
    let mut epoch = 0;
    let startup = (|| {
        sources.push(windows::spawn(
            DeviceKind::Microphone,
            config.microphone_id,
            packets_tx.clone(),
            stop.clone(),
            fault.clone(),
        )?);
        if config.mode == RecordingMode::MicrophoneAndComputer {
            sources.push(windows::spawn(
                DeviceKind::ComputerOutput,
                config.output_id.unwrap_or_default(),
                packets_tx.clone(),
                stop.clone(),
                fault.clone(),
            )?);
        }
        for source in &sources {
            ready(source, &stop)?;
        }
        epoch = windows::now_hns()?;
        for source in &sources {
            source.trigger.send(()).map_err(resampling_error)?;
        }
        for source in &sources {
            ready(source, &stop)?;
        }
        if stop.load(Ordering::Acquire) {
            return Err(AudioError("Recording stopped before capture began".into()));
        }
        events.send(AudioEvent::Started).map_err(resampling_error)?;
        Ok(())
    })();
    drop(packets_tx);
    if let Err(error) = startup {
        stop.store(true, Ordering::Release);
        let reason: AudioError = error;
        let outcome = recording.finalize(Some(reason.0.clone()));
        return Err(AudioError(format!(
            "{}; recording did not start ({})",
            reason.0,
            outcome.path.display()
        )));
    }
    let mut interrupted = None;
    let mut clocks: [Option<SourceClock>; 2] = [None, None];
    let mut timelines = [Timeline::default(), Timeline::default()];
    let mut delivery = LiveDelivery::default();
    let mut last_level = Instant::now();
    let mut last_clock = epoch;
    let mut ending = None;
    loop {
        let now = match windows::now_hns() {
            Ok(now) => now,
            Err(error) => {
                interrupted.get_or_insert(error.0);
                last_clock
            }
        };
        if let Err(error) = check_clock_step(last_clock, now) {
            interrupted.get_or_insert(error.0);
            let _ = stop_at.compare_exchange(0, last_clock, Ordering::AcqRel, Ordering::Acquire);
        } else {
            last_clock = now;
        }
        if interrupted.is_some() {
            stop.store(true, Ordering::Release);
        }
        if stop.load(Ordering::Acquire) && ending.is_none() {
            let now = windows::now_hns().unwrap_or(epoch);
            let stamp = stop_at.load(Ordering::Acquire);
            ending = Some((if stamp == 0 { now } else { stamp }, Instant::now()));
        }
        while let Ok(message) = packets.try_recv() {
            let result = match message {
                windows::Message::Error(error) => Err(AudioError(error)),
                windows::Message::Quiet(kind) => {
                    let index = usize::from(kind == DeviceKind::ComputerOutput);
                    if let Some(mut clock) = clocks[index].take() {
                        clock.finish(&mut timelines[index], recording.frames_written())
                    } else {
                        Ok(())
                    }
                }
                windows::Message::Packet {
                    kind,
                    timestamp,
                    frames,
                } => {
                    let index = usize::from(kind == DeviceKind::ComputerOutput);
                    let initialize = if clocks[index].is_none() {
                        SourceClock::new(epoch, timestamp).map(|clock| clocks[index] = Some(clock))
                    } else {
                        Ok(())
                    };
                    initialize.and_then(|()| {
                        if let Some(clock) = clocks[index].as_mut() {
                            clock.accept(
                                timestamp,
                                frames,
                                &mut timelines[index],
                                recording.frames_written(),
                            )
                        } else {
                            Ok(())
                        }
                    })
                }
            };
            if let Err(error) = result {
                interrupted.get_or_insert(error.0);
            }
        }
        if let Ok(mut failure) = fault.lock()
            && let Some(reason) = failure.take()
        {
            interrupted.get_or_insert(reason);
        }
        if !stop.load(Ordering::Acquire) && sources.iter().any(|source| source.thread.is_finished())
        {
            interrupted.get_or_insert("An audio capture thread stopped unexpectedly".into());
        }
        let all_stopped = sources.iter().all(|source| source.thread.is_finished());
        if let Some((_, since)) = ending
            && (all_stopped || since.elapsed() >= Duration::from_millis(500))
        {
            if !all_stopped {
                interrupted.get_or_insert("An audio source did not stop promptly".into());
            }
            for index in 0..2 {
                if let Some(mut clock) = clocks[index].take()
                    && let Err(error) =
                        clock.finish(&mut timelines[index], recording.frames_written())
                {
                    interrupted.get_or_insert(error.0);
                }
            }
        }
        let target = match ending {
            Some((stamp, _)) if all_stopped => frame_from_timestamp(epoch, stamp),
            Some((stamp, since)) if since.elapsed() >= Duration::from_millis(500) => {
                frame_from_timestamp(epoch, stamp)
            }
            _ => frame_from_timestamp(epoch, now.saturating_sub(1_000_000)),
        };
        while recording.frames_written() < target && epoch != 0 {
            let start = recording.frames_written();
            let frames = (target - start).min(480) as usize;
            let mut stereo = Vec::with_capacity(frames * 2);
            let mut mono = Vec::with_capacity(frames);
            let mut peak = 0.0_f32;
            for frame in start..start + frames as u64 {
                let mic = timelines[0].sample_at(frame).unwrap_or([0.0; 2]);
                let output = if config.mode == RecordingMode::MicrophoneAndComputer {
                    Some(timelines[1].sample_at(frame).unwrap_or([0.0; 2]))
                } else {
                    None
                };
                let mixed = mix_frame(mic, output);
                peak = peak.max(mixed[0].abs()).max(mixed[1].abs());
                stereo.extend(mixed);
                mono.push((mixed[0] + mixed[1]) * 0.5);
            }
            match recording.append_interleaved(&stereo) {
                Ok(()) => {}
                Err(RecordingError::LimitReached) => {
                    stop.store(true, Ordering::Release);
                    break;
                }
                Err(error) => {
                    interrupted.get_or_insert(error.to_string());
                    stop.store(true, Ordering::Release);
                    break;
                }
            }
            if let Some(sender) = &live {
                // Transcription failure or backpressure never blocks the recording writer.
                if let Some(samples) = convert_live(&mut live_converter, &mono, text_errors) {
                    delivery.send(sender, samples);
                }
            }
            if last_level.elapsed() >= Duration::from_millis(100) {
                let _ = events.try_send(AudioEvent::Level {
                    peak,
                    elapsed_frames: recording.frames_written(),
                });
                last_level = Instant::now();
            }
        }
        if ending
            .is_some_and(|(_, since)| all_stopped || since.elapsed() >= Duration::from_millis(500))
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    stop.store(true, Ordering::Release);
    for source in sources {
        if source.thread.is_finished() {
            let _ = source.thread.join();
        }
    }
    if let Some(sender) = &live {
        let expected = recording.frames_written() / 3;
        let tail_frames = live_converter
            .as_ref()
            .map(|converter| converter.resampler.output_delay() * 3 + 480);
        if let Some(tail_frames) = tail_frames
            && let Some(mut tail) =
                convert_live(&mut live_converter, &vec![0.0; tail_frames], text_errors)
        {
            tail.truncate(expected.saturating_sub(delivery.next_sample) as usize);
            delivery.send(sender, tail);
        }
    }
    let outcome = recording.finalize(interrupted);
    if outcome.status == RecordingStatus::SaveFailed {
        return Err(AudioError(format!(
            "Could not finalize {}: {}",
            outcome.path.display(),
            outcome.error.unwrap_or_default()
        )));
    }
    events
        .send(AudioEvent::Finished {
            path: outcome.path,
            frames: outcome.frames,
            interrupted: outcome.error,
        })
        .map_err(resampling_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_float_conversion_retains_stereo_and_rejects_invalid_lengths() {
        let bytes: Vec<_> = [0.25f32, -0.5]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect();
        assert_eq!(decode_packet(&bytes, 1, false).unwrap(), [[0.25, -0.5]]);
        assert!(decode_packet(&bytes[..7], 1, false).is_err());
    }

    #[test]
    fn silent_packets_need_no_native_data_pointer() {
        assert_eq!(decode_packet(&[], 2, true).unwrap(), [[0.0; 2]; 2]);
    }

    #[test]
    fn non_finite_audio_is_not_written_as_valid_pcm() {
        let bytes: Vec<_> = [f32::NAN, 0.0]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect();
        assert!(decode_packet(&bytes, 1, false).is_err());
    }

    #[test]
    fn common_qpc_timeline_preserves_source_start_offset() {
        assert_eq!(frame_from_timestamp(1_000_000, 1_500_000), 2_400);
        assert_eq!(frame_from_timestamp(2_000_000, 1_500_000), 0);
    }

    #[test]
    fn independent_clock_drift_produces_adjusted_resampling_ratio() {
        assert!((clock_ratio(48_048, 10_000_000).unwrap() - 48_000.0 / 48_048.0).abs() < 1e-9);
        assert!(clock_ratio(0, 1).is_err());
        assert!(clock_ratio(48_000, 20_000_000).is_err());
    }

    #[test]
    fn combined_mix_preserves_both_sources_with_headroom() {
        assert_eq!(mix_frame([0.8, 0.8], Some([0.2, -0.2])), [0.5, 0.3]);
        assert_eq!(mix_frame([0.5, 0.5], None), [0.5, 0.5]);
    }

    #[test]
    fn source_timeline_preserves_offset_and_missing_output_is_silence() {
        let mut timeline = Timeline::default();
        timeline
            .push(480, vec![[0.2, -0.2], [0.3, -0.3]], 0)
            .unwrap();
        assert_eq!(timeline.sample_at(0), None);
        assert_eq!(timeline.sample_at(480), Some([0.2, -0.2]));
        assert_eq!(timeline.sample_at(481), Some([0.3, -0.3]));
        assert_eq!(timeline.sample_at(482), None);
    }

    #[test]
    fn late_audio_is_an_interruption_not_a_silent_drop() {
        let mut timeline = Timeline::default();
        assert!(timeline.push(0, vec![[0.1; 2]; 10], 20).is_err());
    }

    #[test]
    fn full_transcription_queue_keeps_capture_nonblocking_and_exposes_coverage_gap() {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let mut delivery = LiveDelivery::default();
        delivery.send(&sender, vec![0.1; 3]);
        delivery.send(&sender, vec![0.2; 2]);
        assert_eq!(delivery.next_sample, 5);
        assert_eq!(receiver.try_recv().unwrap().start_sample, 0);
        delivery.send(&sender, vec![0.3]);
        assert_eq!(receiver.try_recv().unwrap().start_sample, 5);
    }

    #[test]
    fn sleep_or_clock_reversal_is_not_fabricated_as_continuous_audio() {
        assert!(check_clock_step(10_000_000, 20_000_000).is_err());
        assert!(check_clock_step(10_000_000, 9_000_000).is_err());
        assert!(check_clock_step(10_000_000, 10_050_000).is_ok());
    }

    #[test]
    fn variable_native_packets_and_filter_tail_preserve_duration() {
        let mut clock = SourceClock::new(0, 0).unwrap();
        let mut timeline = Timeline::default();
        let mut samples = 0;
        for count in [479, 481, 137, 823] {
            clock
                .accept(
                    samples * 10_000_000 / 48_000,
                    vec![[0.25, -0.25]; count],
                    &mut timeline,
                    0,
                )
                .unwrap();
            samples += count as u64;
        }
        clock.finish(&mut timeline, 0).unwrap();
        assert_eq!(clock.cursor, samples);
        assert!(timeline.sample_at(samples - 1).is_some());
        assert_eq!(timeline.sample_at(samples), None);
    }

    #[test]
    fn resumed_output_uses_its_new_qpc_offset_after_a_quiet_gap() {
        let mut timeline = Timeline::default();
        let mut first = SourceClock::new(0, 0).unwrap();
        first
            .accept(0, vec![[0.2; 2]; 480], &mut timeline, 0)
            .unwrap();
        first.finish(&mut timeline, 0).unwrap();
        let mut resumed = SourceClock::new(0, 1_000_000).unwrap();
        resumed
            .accept(1_000_000, vec![[0.4; 2]; 480], &mut timeline, 0)
            .unwrap();
        resumed.finish(&mut timeline, 0).unwrap();
        assert!(timeline.sample_at(479).is_some());
        assert_eq!(timeline.sample_at(2_400), None);
        assert!(timeline.sample_at(4_800).is_some());
    }

    #[test]
    fn live_downsampling_filters_out_of_band_sound() {
        fn rms(hz: f32) -> f32 {
            let mut converter = Converter::new(1, 1.0 / 3.0, true).unwrap();
            let input: Vec<_> = (0..4_800)
                .map(|index| (index as f32 * std::f32::consts::TAU * hz / 48_000.0).sin())
                .collect();
            let output = converter.convert(&input).unwrap();
            (output.iter().map(|sample| sample * sample).sum::<f32>() / output.len() as f32).sqrt()
        }
        assert!(rms(1_000.0) > 0.65);
        assert!(rms(12_000.0) < 0.05);
    }

    #[test]
    fn live_conversion_failure_reports_a_reason_and_disables_only_that_branch() {
        let (errors, messages) = mpsc::sync_channel(1);
        let mut converter = Some(Converter::new(1, 1.0 / 3.0, true).unwrap());
        assert!(convert_live(&mut converter, &vec![0.1; 48_001], &errors).is_none());
        assert!(converter.is_none());
        assert!(
            messages
                .try_recv()
                .expect("ASR conversion failure must reach the UI")
                .contains("normalize")
        );
    }

    #[test]
    fn a_full_transcription_error_channel_never_blocks_audio_work() {
        let (errors, messages) = mpsc::sync_channel(1);
        errors.send("first failure".into()).unwrap();
        let mut converter = Some(Converter::new(1, 1.0 / 3.0, true).unwrap());
        assert!(convert_live(&mut converter, &vec![0.1; 48_001], &errors).is_none());
        assert_eq!(messages.try_recv().unwrap(), "first failure");
        assert!(converter.is_none());
    }

    #[test]
    fn required_sources_are_validated_before_a_session_is_created() {
        let config = CaptureConfig {
            mode: RecordingMode::MicrophoneAndComputer,
            microphone_id: "mic".into(),
            output_id: None,
            save_folder: PathBuf::new(),
        };
        assert!(start(config, None).is_err());
    }

    #[test]
    fn invalid_endpoint_preflight_never_reports_started() {
        let folder = std::env::temp_dir().join(format!(
            "rustcorder-audio-preflight-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&folder).unwrap();
        let config = CaptureConfig {
            mode: RecordingMode::Microphone,
            microphone_id: "rustcorder-intentionally-invalid-endpoint".into(),
            output_id: None,
            save_folder: folder.clone(),
        };
        let session = start(config, None).unwrap();
        let event = session.events.recv_timeout(Duration::from_secs(6)).unwrap();
        assert!(
            matches!(event, AudioEvent::Failed(_)),
            "Unexpected event: {event:?}"
        );
        drop(session);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn resampled_independent_clock_tracks_the_common_timeline() {
        let mut timeline = Timeline::default();
        let mut clock = SourceClock::new(0, 0).unwrap();
        let mut written = 0;
        // 481 source frames per 10 ms, against the common 480-frame clock.
        for tick in 0..1_000 {
            clock
                .accept(tick * 100_000, vec![[0.1; 2]; 481], &mut timeline, written)
                .unwrap();
            while written + 4_800 < tick * 480 {
                timeline.sample_at(written);
                written += 1;
            }
        }
        clock.finish(&mut timeline, written).unwrap();
        assert!(
            clock.cursor.abs_diff(480_000) < 100,
            "Clock drift: {} frames",
            clock.cursor.abs_diff(480_000)
        );
        assert!(timeline.buffered < 6_000);
    }
}

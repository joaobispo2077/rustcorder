//! Native inference runs only through this child-process entry point.

use super::{
    Event, EventKind, ModelMetadata, PROTOCOL_VERSION, Request, RequestKind, Segment, WorkerError,
    read_request, write_event,
};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};
use std::io;
use std::path::{Path, PathBuf};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
    WhisperVadContext, WhisperVadContextParams, WhisperVadParams,
};

struct LoadedModel {
    _context: WhisperContext,
    state: WhisperState,
    metadata: ModelMetadata,
    language: String,
    vad: WhisperVadContext,
}

const VAD_FILENAME: &str = "ggml-silero-v6.2.0.bin";

fn select_vad_path(executable: &Path, asr_model: &Path) -> Result<PathBuf, String> {
    let adjacent = executable
        .parent()
        .ok_or("Cannot find the local application folder")?
        .join(VAD_FILENAME);
    match std::fs::metadata(&adjacent) {
        Ok(metadata) if metadata.is_file() => return Ok(adjacent),
        Ok(_) => {
            return Err(format!(
                "The local speech detector {VAD_FILENAME} beside the application is not a file; restore the supplied asset"
            ));
        }
        Err(cause) if cause.kind() == io::ErrorKind::NotFound => {}
        Err(cause) => {
            return Err(format!(
                "Cannot access local speech detector {VAD_FILENAME}: {cause}"
            ));
        }
    }
    let fallback = asr_model
        .parent()
        .ok_or("Cannot find the local model folder")?
        .join(VAD_FILENAME);
    if fallback.is_file() {
        return Ok(fallback);
    }
    Err(format!(
        "Missing local speech detector {VAD_FILENAME}; restore it beside the application, or place the verified asset beside the ASR model for development. No download is performed."
    ))
}

pub fn run() -> Result<(), WorkerError> {
    // With logging backends disabled these hooks suppress both native log streams.
    whisper_rs::install_logging_hooks();
    let threads = thread_budget(
        std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1),
    );
    eprintln!(
        "Local inference worker: CPU only, {threads} threads; limit 8 with two-CPU headroom where possible"
    );
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    write_event(
        &mut output,
        &Event {
            protocol: PROTOCOL_VERSION,
            id: 0,
            job_generation: 0,
            event: EventKind::Ready { model: None },
        },
    )?;
    let mut loaded = None;
    while let Some((request, samples)) = read_request(&mut input)? {
        if matches!(request.command, RequestKind::Shutdown) {
            break;
        }
        let event = if matches!(request.command, RequestKind::TranscribeFile { .. }) {
            transcribe_file(&request, &mut loaded, threads, |event| {
                write_event(
                    &mut output,
                    &Event {
                        protocol: PROTOCOL_VERSION,
                        id: request.id,
                        job_generation: request.job_generation,
                        event,
                    },
                )
                .map_err(|cause| cause.to_string())
            })
        } else {
            handle(&request, &samples, &mut loaded, threads)
        };
        write_event(
            &mut output,
            &Event {
                protocol: PROTOCOL_VERSION,
                id: request.id,
                job_generation: request.job_generation,
                event,
            },
        )?;
    }
    Ok(())
}

fn handle(
    request: &Request,
    samples: &[f32],
    loaded: &mut Option<LoadedModel>,
    threads: i32,
) -> EventKind {
    match &request.command {
        RequestKind::ValidateModel { model_path } => {
            // Release the previous context before validation so memory cannot double.
            *loaded = None;
            match load_context(model_path, threads) {
                Ok((_context, model, _vad)) => EventKind::ModelValidated {
                    path: model_path.clone(),
                    valid: true,
                    model: Some(model),
                    error: None,
                },
                Err(message) => EventKind::ModelValidated {
                    path: model_path.clone(),
                    valid: false,
                    model: None,
                    error: Some(message),
                },
            }
        }
        RequestKind::LoadModel {
            model_path,
            language,
        } => {
            *loaded = None;
            if !matches!(language.as_str(), "pt" | "en") {
                return error("UnsupportedLanguage", "model", "Select Portuguese (pt) or English (en); automatic language detection is unavailable".into());
            }
            let (context, model, vad) = match load_context(model_path, threads) {
                Ok(value) => value,
                Err(message) => return error("InvalidModel", "model", message),
            };
            if let Err(message) = check_language(&model, language) {
                return error("UnsupportedLanguage", "model", message);
            }
            let state = match context.create_state() {
                Ok(state) => state,
                Err(cause) => {
                    return error(
                        "InvalidModel",
                        "model",
                        format!("Cannot prepare local inference for the selected model: {cause}"),
                    );
                }
            };
            *loaded = Some(LoadedModel {
                _context: context,
                state,
                metadata: model.clone(),
                language: language.clone(),
                vad,
            });
            EventKind::Ready { model: Some(model) }
        }
        RequestKind::TranscribeWindow {
            language,
            start_sample,
            end_sample,
            ..
        } => {
            let Some(model) = loaded.as_mut() else {
                return error(
                    "ModelNotLoaded",
                    "inference",
                    "Select and load a compatible local model before transcription".into(),
                );
            };
            if language != &model.language {
                return error("UnsupportedLanguage", "inference", "The requested language differs from the loaded selection; load the selected model and language first".into());
            }
            if let Err(message) = check_language(&model.metadata, language) {
                return error("UnsupportedLanguage", "inference", message);
            }
            if samples.is_empty() || samples.iter().any(|sample| !sample.is_finite()) {
                return error(
                    "InvalidAudio",
                    "inference",
                    "Provide nonempty finite mono 16 kHz audio samples".into(),
                );
            }
            if digital_silence(samples) {
                return EventKind::NoSpeech {
                    coverage_start: *start_sample,
                    coverage_end: *end_sample,
                    terminal: true,
                };
            }
            match infer(model, samples, *start_sample, *end_sample, threads) {
                Ok(segments) if segments.is_empty() => EventKind::NoSpeech {
                    coverage_start: *start_sample,
                    coverage_end: *end_sample,
                    terminal: true,
                },
                Ok(segments) => EventKind::Segments {
                    segments,
                    coverage_start: *start_sample,
                    coverage_end: *end_sample,
                    terminal: true,
                },
                Err(message) => error("InferenceFailed", "inference", message),
            }
        }
        RequestKind::TranscribeFile { .. } => error(
            "InvalidRequest",
            "protocol",
            "File requests must use the streaming dispatcher".into(),
        ),
        RequestKind::Shutdown => error(
            "InvalidRequest",
            "protocol",
            "Shutdown must end the worker loop".into(),
        ),
    }
}

fn load_context(
    path: &Path,
    threads: i32,
) -> Result<(WhisperContext, ModelMetadata, WhisperVadContext), String> {
    if !path.is_absolute() {
        return Err("Choose an absolute local model path".into());
    }
    let executable = std::env::current_exe()
        .map_err(|cause| format!("Cannot find local speech detector location: {cause}"))?;
    let vad_path = select_vad_path(&executable, path)?;
    let vad_path_text = vad_path
        .to_str()
        .filter(|text| !text.contains('\0'))
        .ok_or("Local speech detector path is not valid UTF-8 or contains a null character")?;
    let mut vad_parameters = WhisperVadContextParams::default();
    vad_parameters.set_use_gpu(false);
    vad_parameters.set_n_threads(threads.clamp(1, 4));
    let vad = WhisperVadContext::new(vad_path_text, vad_parameters)
        .map_err(|cause| format!("Cannot load local speech detector {}: {cause}. Restore the verified {VAD_FILENAME} asset; no fallback or download is performed.", vad_path.display()))?;
    let mut parameters = WhisperContextParameters::default();
    parameters.use_gpu(false);
    let context = WhisperContext::new_with_params(path, parameters)
        .map_err(|cause| format!("Cannot load the local model at {}: {cause}. Select a complete whisper.cpp-compatible GGML base or small model", path.display()))?;
    let family = context
        .model_type_readable_str()
        .map_err(|cause| format!("Cannot read model metadata: {cause}"))?;
    let model = metadata(family, context.is_multilingual())?;
    Ok((context, model, vad))
}

/// Decode a supported local file incrementally into bounded mono 16 kHz chunks.
pub fn decode_audio_file<F: FnMut(&[f32], u64) -> Result<(), String>>(
    path: &Path,
    mut on_chunk: F,
) -> Result<u64, String> {
    if !path.is_absolute() {
        return Err("Choose an absolute local audio path".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "wav" | "mp3") {
        return Err("Unsupported audio type: choose a WAV or MP3 file".into());
    }
    let file =
        std::fs::File::open(path).map_err(|cause| format!("Cannot open audio file: {cause}"))?;
    if file.metadata().map_err(|cause| cause.to_string())?.len() == 0 {
        return Err("The selected audio file is empty".into());
    }
    let mut hint = Hint::new();
    hint.with_extension(&extension);
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|cause| format!("Unsupported or corrupt audio: {cause}"))?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or("No audio track was found")?;
    let track_id = track.id;
    let expected_frames = track.num_frames;
    let parameters = track
        .codec_params
        .as_ref()
        .and_then(|value| value.audio())
        .ok_or("Unsupported audio codec")?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(parameters, &AudioDecoderOptions::default())
        .map_err(|cause| format!("Unsupported audio codec: {cause}"))?;
    let mut normalizer: Option<MonoNormalizer> = None;
    let mut interleaved = Vec::<f32>::new();
    while let Some(packet) = format
        .next_packet()
        .map_err(|cause| format!("Corrupt or truncated audio: {cause}"))?
    {
        if packet.track_id != track_id {
            continue;
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|cause| format!("Cannot decode audio: {cause}"))?;
        let rate = decoded.spec().rate();
        let channels = decoded.spec().channels().count();
        if !(1..=8).contains(&channels)
            || !(8_000..=384_000).contains(&rate)
            || decoded.samples_interleaved() > 1_048_576
        {
            return Err("Unsupported audio rate, channels or packet size".into());
        }
        let normalizer = match &mut normalizer {
            Some(value) if value.rate == rate => value,
            Some(_) => return Err("Audio sample rate changes inside the file".into()),
            empty @ None => empty.insert(MonoNormalizer::new(rate)?),
        };
        interleaved.resize(decoded.samples_interleaved(), 0.0);
        decoded.copy_to_slice_interleaved(&mut interleaved);
        for frame in interleaved.chunks_exact(channels) {
            if frame.iter().any(|sample| !sample.is_finite()) {
                return Err("Audio contains invalid non-finite samples".into());
            }
            let mono = frame
                .iter()
                .map(|sample| sample.clamp(-1.0, 1.0))
                .sum::<f32>()
                / channels as f32;
            normalizer.push(mono, &mut on_chunk)?;
        }
    }
    let mut normalizer = normalizer.ok_or("The selected file contains no decoded audio")?;
    if normalizer.total_input == 0 {
        return Err("The selected file contains no audio samples".into());
    }
    if extension == "wav"
        && expected_frames.is_some_and(|expected| expected != normalizer.total_input)
    {
        return Err("WAV is truncated or its declared sample count is inconsistent".into());
    }
    normalizer.finish(&mut on_chunk)
}

const FILE_CHUNK_SAMPLES: usize = 240_000;

struct MonoNormalizer {
    rate: u32,
    resampler: Option<Fft<f32>>,
    input: Vec<f32>,
    trim_delay: usize,
    output: Vec<f32>,
    total_input: u64,
    delivered: u64,
}

impl MonoNormalizer {
    fn new(rate: u32) -> Result<Self, String> {
        let resampler = if rate == 16_000 {
            None
        } else {
            Some(
                Fft::new(rate as usize, 16_000, 1024, 1, FixedSync::Input)
                    .map_err(|cause| cause.to_string())?,
            )
        };
        let trim_delay = resampler.as_ref().map_or(0, Resampler::output_delay);
        Ok(Self {
            rate,
            resampler,
            input: Vec::new(),
            trim_delay,
            output: Vec::with_capacity(FILE_CHUNK_SAMPLES),
            total_input: 0,
            delivered: 0,
        })
    }

    fn push(
        &mut self,
        sample: f32,
        callback: &mut impl FnMut(&[f32], u64) -> Result<(), String>,
    ) -> Result<(), String> {
        self.total_input += 1;
        if let Some(resampler) = &self.resampler {
            self.input.push(sample);
            if self.input.len() == resampler.input_frames_next() {
                self.process(callback)?;
            }
        } else {
            self.append(&[sample], callback)?;
        }
        Ok(())
    }

    fn process(
        &mut self,
        callback: &mut impl FnMut(&[f32], u64) -> Result<(), String>,
    ) -> Result<(), String> {
        let resampler = self.resampler.as_mut().unwrap();
        self.input.resize(resampler.input_frames_next(), 0.0);
        let adapter = InterleavedSlice::new(&self.input, 1, self.input.len())
            .map_err(|cause| cause.to_string())?;
        let output = resampler
            .process(&adapter, None)
            .map_err(|cause| cause.to_string())?
            .take_data();
        self.input.clear();
        self.append(&output, callback)
    }

    fn expected(&self) -> u64 {
        (self.total_input * 16_000 + u64::from(self.rate) / 2) / u64::from(self.rate)
    }

    fn append(
        &mut self,
        samples: &[f32],
        callback: &mut impl FnMut(&[f32], u64) -> Result<(), String>,
    ) -> Result<(), String> {
        let trim = self.trim_delay.min(samples.len());
        self.trim_delay -= trim;
        let remaining =
            self.expected()
                .saturating_sub(self.delivered + self.output.len() as u64) as usize;
        for sample in samples[trim..].iter().take(remaining) {
            self.output.push(sample.clamp(-1.0, 1.0));
            if self.output.len() == FILE_CHUNK_SAMPLES {
                callback(&self.output, self.delivered)?;
                self.delivered += self.output.len() as u64;
                self.output.clear();
            }
        }
        Ok(())
    }

    fn finish(
        &mut self,
        callback: &mut impl FnMut(&[f32], u64) -> Result<(), String>,
    ) -> Result<u64, String> {
        while self.delivered + (self.output.len() as u64) < self.expected() {
            self.process(callback)?;
        }
        if !self.output.is_empty() {
            callback(&self.output, self.delivered)?;
            self.delivered += self.output.len() as u64;
            self.output.clear();
        }
        Ok(self.delivered)
    }
}

fn transcribe_file(
    request: &Request,
    loaded: &mut Option<LoadedModel>,
    threads: i32,
    mut emit: impl FnMut(EventKind) -> Result<(), String>,
) -> EventKind {
    let RequestKind::TranscribeFile {
        audio_path,
        language,
    } = &request.command
    else {
        unreachable!()
    };
    let Some(model) = loaded.as_mut() else {
        return error(
            "ModelNotLoaded",
            "model",
            "Select a compatible local model first".into(),
        );
    };
    if language != &model.language || check_language(&model.metadata, language).is_err() {
        return error(
            "UnsupportedLanguage",
            "inference",
            "Load the selected compatible model/language before transcription".into(),
        );
    }
    let mut speech = false;
    let result = decode_audio_file(audio_path, |samples, origin| {
        let end = origin + samples.len() as u64;
        let segments = if digital_silence(samples) {
            Vec::new()
        } else {
            infer(model, samples, origin, end, threads)?
        };
        if segments.is_empty() {
            emit(EventKind::NoSpeech {
                coverage_start: origin,
                coverage_end: end,
                terminal: false,
            })?;
        } else {
            speech = true;
            emit(EventKind::Segments {
                segments,
                coverage_start: origin,
                coverage_end: end,
                terminal: false,
            })?;
        }
        emit(EventKind::Progress {
            fraction: None,
            stage: "Transcribing local recording".into(),
            processed_samples: end,
        })
    });
    match result {
        Ok(end) if speech => EventKind::Segments {
            segments: Vec::new(),
            coverage_start: 0,
            coverage_end: end,
            terminal: true,
        },
        Ok(end) => EventKind::NoSpeech {
            coverage_start: 0,
            coverage_end: end,
            terminal: true,
        },
        Err(message) => error("InvalidAudio", "decode", message),
    }
}

fn infer(
    model: &mut LoadedModel,
    samples: &[f32],
    origin: u64,
    limit: u64,
    threads: i32,
) -> Result<Vec<Segment>, String> {
    let mut vad_parameters = WhisperVadParams::default();
    vad_parameters.set_threshold(0.5);
    vad_parameters.set_min_speech_duration(250);
    // Native detect_speech clears LSTM state per call; overlapping windows stay independent.
    let speech = model
        .vad
        .segments_from_samples(vad_parameters, samples)
        .map_err(|cause| format!("Local speech detection failed: {cause}"))?;
    if speech.num_segments() == 0 {
        return Ok(Vec::new());
    }
    drop(speech);
    // Gate the whole window only: preserve its original samples and Whisper timestamps.
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(threads);
    params.set_language(Some(&model.language));
    params.set_detect_language(false);
    params.set_translate(false);
    params.set_no_context(true);
    params.set_no_timestamps(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.enable_vad(false);
    model
        .state
        .full(params, samples)
        .map_err(|cause| format!("Local transcription failed: {cause}"))?;
    let mut segments = Vec::new();
    for segment in model.state.as_iter() {
        let text = segment
            .to_str()
            .map_err(|cause| format!("Local transcription returned invalid text: {cause}"))?;
        let (start_sample, end_sample) = segment_range(
            origin,
            limit,
            segment.start_timestamp(),
            segment.end_timestamp(),
        );
        if !text.trim().is_empty() && end_sample > start_sample {
            segments.push(Segment {
                start_sample,
                end_sample,
                text: text.to_owned(),
            });
        }
    }
    Ok(segments)
}

fn error(code: &str, stage: &str, message: String) -> EventKind {
    eprintln!("Local transcription error ({code}, {stage}): {message}");
    EventKind::Error {
        code: code.into(),
        stage: stage.into(),
        message,
    }
}

fn metadata(family: &str, multilingual: bool) -> Result<ModelMetadata, String> {
    if !matches!(family, "base" | "small") {
        return Err(format!(
            "Model family {family} is unsupported; choose a GGML base or small model"
        ));
    }
    Ok(ModelMetadata {
        family: family.to_owned(),
        multilingual,
    })
}

fn check_language(model: &ModelMetadata, language: &str) -> Result<(), String> {
    match language {
        "en" => Ok(()),
        "pt" if model.multilingual => Ok(()),
        "pt" => Err("This model is English-only; choose multilingual base or small for Brazilian Portuguese".into()),
        _ => Err("Select Portuguese (pt) or English (en); automatic language detection is unavailable".into()),
    }
}

fn digital_silence(samples: &[f32]) -> bool {
    !samples.is_empty() && samples.iter().all(|sample| *sample == 0.0)
}

fn segment_range(origin: u64, limit: u64, start_cs: i64, end_cs: i64) -> (u64, u64) {
    let bound = limit.max(origin);
    let position = |centiseconds: i64| {
        origin
            .saturating_add((centiseconds.max(0) as u64).saturating_mul(160))
            .min(bound)
    };
    let start = position(start_cs);
    (start, position(end_cs).max(start))
}

fn thread_budget(logical_cpus: usize) -> i32 {
    logical_cpus.saturating_sub(2).clamp(1, 8) as i32
}

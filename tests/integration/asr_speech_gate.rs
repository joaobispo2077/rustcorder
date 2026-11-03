//! Actual base-model negative controls and attenuated real Portuguese speech.
//! These are declared probes, not a general claim that all noise is recognizable.

use rustcorder::transcription::{EventKind, PROTOCOL_VERSION, Request, RequestKind, WorkerProcess};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

const SAMPLES: usize = 8 * 16_000;

fn request(id: u64, command: RequestKind, samples: &[f32]) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        id,
        job_generation: 1,
        payload_bytes: samples.len() * 4,
        command,
    }
}

fn noise(amplitude: f32) -> Vec<f32> {
    let mut state = 0x4f12_b937_u32;
    (0..SAMPLES)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((state >> 8) as f32 / 16_777_215.0 * 2.0 - 1.0) * amplitude
        })
        .collect()
}

fn quiet_speech(path: &Path) -> (Vec<f32>, usize) {
    let mut wav = hound::WavReader::open(path).expect("prepared FLEURS pt_br row-0000 must exist");
    let spec = wav.spec();
    assert_eq!(
        (spec.channels, spec.sample_rate, spec.bits_per_sample),
        (1, 16_000, 32)
    );
    assert_eq!(spec.sample_format, hound::SampleFormat::Float);
    let original: Vec<f32> = wav.samples::<f32>().collect::<Result<_, _>>().unwrap();
    assert!(original.iter().all(|sample| sample.is_finite()));
    assert!(original.iter().any(|sample| sample.abs() > 0.001));
    let original_samples = original.len();
    let mut attenuated: Vec<f32> = original
        .into_iter()
        .take(SAMPLES)
        .map(|sample| sample * 0.01)
        .collect();
    attenuated.resize(SAMPLES, 0.0);
    (attenuated, original_samples)
}

fn probe(worker: &mut WorkerProcess, id: u64, name: &str, samples: &[f32]) -> Value {
    assert_eq!(samples.len(), SAMPLES);
    assert!(samples.iter().all(|sample| sample.is_finite()));
    let mut text = Vec::new();
    let mut no_speech = false;
    let mut errors = Vec::new();
    let began = Instant::now();
    worker
        .request(
            &request(
                id,
                RequestKind::TranscribeWindow {
                    language: "pt".into(),
                    start_sample: 0,
                    end_sample: samples.len() as u64,
                    sample_count: samples.len(),
                    final_window: true,
                },
                samples,
            ),
            samples,
            Duration::from_secs(60),
            &AtomicBool::new(false),
            |event| match event.event {
                EventKind::NoSpeech {
                    terminal: true,
                    coverage_start,
                    coverage_end,
                } => {
                    assert_eq!((coverage_start, coverage_end), (0, SAMPLES as u64));
                    no_speech = true;
                }
                EventKind::Segments { segments, .. } => {
                    text.extend(segments.into_iter().filter_map(|segment| {
                        let text = segment.text.trim().to_owned();
                        (!text.is_empty()).then_some(text)
                    }))
                }
                EventKind::Error {
                    code,
                    stage,
                    message,
                } => errors.push(format!("{stage}/{code}: {message}")),
                _ => {}
            },
        )
        .expect(
            "actual worker transport must complete; transport errors are not no-speech results",
        );
    json!({
        "case": name, "samples": samples.len(),
        "peak": samples.iter().map(|sample| sample.abs()).fold(0.0_f32, f32::max),
        "rms": (samples.iter().map(|sample| (*sample as f64).powi(2)).sum::<f64>() / samples.len() as f64).sqrt(),
        "seconds": began.elapsed().as_secs_f64(),
        "no_speech": no_speech, "text": text.join(" "), "errors": errors,
    })
}

#[test]
#[ignore = "actual local base GGML and prepared FLEURS pt_br row-0000; run serially on an idle CPU"]
fn local_speech_free_and_quiet_speech_gate() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let model = root
        .join("models/ggml-base.bin")
        .canonicalize()
        .expect("local multilingual base GGML required");
    let source = root.join(".build/fixtures/pt_br/row-0000.wav");
    let (speech, original_samples) = quiet_speech(&source);
    let mut command = Command::new(env!("CARGO_BIN_EXE_rustcorder"));
    command.arg("--asr-worker");
    let mut worker = WorkerProcess::spawn(command, Duration::from_secs(10)).unwrap();
    let mut loaded = false;
    worker
        .request(
            &request(
                1,
                RequestKind::LoadModel {
                    model_path: model.clone(),
                    language: "pt".into(),
                },
                &[],
            ),
            &[],
            Duration::from_secs(120),
            &AtomicBool::new(false),
            |event| match event.event {
                EventKind::Ready {
                    model: Some(metadata),
                } => {
                    assert_eq!(metadata.family, "base");
                    assert!(metadata.multilingual);
                    loaded = true;
                }
                EventKind::Error { code, message, .. } => {
                    panic!("Model load failed: {code}: {message}")
                }
                _ => {}
            },
        )
        .unwrap();
    assert!(loaded);
    let controls = [
        ("digital_zero", vec![0.0; SAMPLES]),
        ("quiet_uniform_noise_peak_0.0001", noise(0.0001)),
        ("moderate_uniform_noise_peak_0.05", noise(0.05)),
        (
            "constant_440hz_tone_peak_0.05",
            (0..SAMPLES)
                .map(|index| (index as f32 * std::f32::consts::TAU * 440.0 / 16_000.0).sin() * 0.05)
                .collect(),
        ),
    ];
    let mut observations = Vec::new();
    for (index, (name, samples)) in controls.iter().enumerate() {
        observations.push(probe(&mut worker, index as u64 + 2, name, samples));
    }
    observations.push(probe(&mut worker, 6, "real_fleurs_pt_gain_0.01", &speech));
    let report = json!({
        "model": model, "model_bytes": std::fs::metadata(root.join("models/ggml-base.bin")).unwrap().len(),
        "language": "pt", "window_seconds": 8,
        "speech_source": source, "speech_source_samples": original_samples,
        "speech_used_samples": original_samples.min(SAMPLES), "speech_gain": 0.01,
        "speech_reference_scored": false,
        "observations": observations,
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    worker
        .request(
            &request(7, RequestKind::Shutdown, &[]),
            &[],
            Duration::from_secs(5),
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
    let observations = report["observations"].as_array().unwrap();
    let failures: Vec<_> = observations[..4]
        .iter()
        .filter(|observation| {
            observation["no_speech"] != true
                || observation["text"].as_str() != Some("")
                || !observation["errors"].as_array().unwrap().is_empty()
        })
        .map(|observation| observation["case"].as_str().unwrap())
        .collect();
    assert!(
        failures.is_empty(),
        "Speech-free controls produced text/errors: {failures:?}; retain observed failure and make an explicit offline VAD asset decision before tuning"
    );
    let quiet = &observations[4];
    assert!(quiet["errors"].as_array().unwrap().is_empty());
    assert!(
        !quiet["text"].as_str().unwrap().trim().is_empty(),
        "Attenuated real Portuguese speech must survive conservative silence handling"
    );
}

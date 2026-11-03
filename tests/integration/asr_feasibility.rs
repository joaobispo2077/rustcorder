//! Preliminary CPU/model gate; not a live pipeline or final acceptance proof.
use rustcorder::transcription::{EventKind, Request, RequestKind, WorkerProcess};
use serde_json::{Value, json};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};
use unicode_normalization::UnicodeNormalization;

fn normalize(text: &str) -> String {
    let lowercase: String = text.nfc().flat_map(char::to_lowercase).collect();
    let separated: String = lowercase
        .nfc()
        .map(|character| {
            if character.is_alphanumeric()
                || unicode_normalization::char::is_combining_mark(character)
            {
                character
            } else {
                ' '
            }
        })
        .collect();
    separated.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn word_errors(reference: &str, prediction: &str) -> (usize, usize) {
    let reference = normalize(reference);
    let prediction = normalize(prediction);
    let expected: Vec<_> = reference.split_whitespace().collect();
    let actual: Vec<_> = prediction.split_whitespace().collect();
    let mut previous: Vec<_> = (0..=actual.len()).collect();
    for (i, expected_word) in expected.iter().enumerate() {
        let mut current = vec![i + 1; actual.len() + 1];
        for (j, actual_word) in actual.iter().enumerate() {
            current[j + 1] = (previous[j] + usize::from(expected_word != actual_word))
                .min(previous[j + 1] + 1)
                .min(current[j] + 1);
        }
        previous = current;
    }
    (previous[actual.len()], expected.len())
}

fn percentile(values: &[f64], quantile: f64) -> f64 {
    assert!(!values.is_empty() && quantile > 0.0 && quantile <= 1.0);
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted[(sorted.len() as f64 * quantile).ceil() as usize - 1]
}

fn parse_sha256(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let digest = line.trim();
        (digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .then(|| digest.to_ascii_lowercase())
    })
}

fn sha256(path: &Path) -> String {
    let output = Command::new("certutil.exe")
        .arg("-hashfile")
        .arg(path)
        .arg("SHA256")
        .output()
        .expect("benchmark requires Windows certutil.exe to verify fixture/model hashes");
    assert!(
        output.status.success(),
        "certutil could not hash {}: {}",
        path.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    parse_sha256(&String::from_utf8_lossy(&output.stdout))
        .expect("certutil output must contain an exact SHA-256 digest")
}

#[test]
fn sha256_parser_requires_an_exact_hex_digest_line() {
    let digest = "0123456789abcdef".repeat(4);
    assert_eq!(
        parse_sha256(&format!(
            "SHA256 hash:\r\n{}\r\nDone",
            digest.to_uppercase()
        )),
        Some(digest)
    );
    assert_eq!(parse_sha256("abcd"), None);
    assert_eq!(parse_sha256(&"g".repeat(64)), None);
}

#[test]
fn normalization_preserves_accents_and_digits_while_removing_punctuation() {
    assert_eq!(
        normalize("  REUNIÃO,\tamanhã! 42,5%  "),
        "reunião amanhã 42 5"
    );
    assert_eq!(normalize("AÇÃO ac\u{0327}a\u{0303}o"), "ação ação");
    assert_ne!(normalize("pode"), normalize("pôde"));
    assert_eq!(normalize("Olá\n\t mundo—sim"), "olá mundo sim");
}

#[test]
fn word_error_counts_substitutions_insertions_deletions_and_reference_length() {
    assert_eq!(word_errors("um dois três", "um três quatro"), (2, 3));
    assert_eq!(word_errors("um dois", ""), (2, 2));
    assert_eq!(word_errors("", "um dois"), (2, 0));
    assert_eq!(word_errors("Reunião! 42", "reunião 42"), (0, 2));
    assert_eq!(word_errors("", ""), (0, 0));
    // Aggregate edits/reference words, never average per-clip WERs.
    let cases = [word_errors("a", "b"), word_errors("a b c d", "a b c d")];
    assert_eq!(cases.iter().map(|item| item.0).sum::<usize>(), 1);
    assert_eq!(cases.iter().map(|item| item.1).sum::<usize>(), 5);
}

#[test]
fn latency_percentiles_use_nearest_rank_without_changing_observations() {
    let values = [4.0, 1.0, 3.0, 2.0, 5.0];
    assert_eq!(percentile(&values, 0.5), 3.0);
    assert_eq!(percentile(&values, 0.95), 5.0);
    assert_eq!(values, [4.0, 1.0, 3.0, 2.0, 5.0]);
}

fn header(id: u64, command: RequestKind, payload_bytes: usize) -> Request {
    Request {
        protocol: 1,
        id,
        job_generation: 1,
        payload_bytes,
        command,
    }
}

fn window(id: u64, language: &str, samples: usize) -> Request {
    header(
        id,
        RequestKind::TranscribeWindow {
            language: language.into(),
            start_sample: 0,
            end_sample: samples as u64,
            sample_count: samples,
            final_window: true,
        },
        samples * 4,
    )
}

fn samples(path: &Path, expected: usize) -> Vec<f32> {
    let mut wav = hound::WavReader::open(path).expect("selected corpus WAV must exist and decode");
    let format = wav.spec();
    assert_eq!(
        (format.channels, format.sample_rate, format.bits_per_sample),
        (1, 16_000, 32)
    );
    assert_eq!(format.sample_format, hound::SampleFormat::Float);
    let samples: Vec<f32> = wav.samples::<f32>().collect::<Result<_, _>>().unwrap();
    assert_eq!(
        samples.len(),
        expected,
        "whole manifest clip required; no cropping"
    );
    assert!(samples.len() <= 262_144 && samples.iter().all(|sample| sample.is_finite()));
    samples
}

#[test]
#[ignore = "requires explicitly prepared local models/corpus; run serially on idle reference CPU"]
fn local_cpu_corpus_baseline() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let model_name = std::env::var("RUSTCORDER_BENCH_MODEL").unwrap_or_else(|_| "base".into());
    let language = std::env::var("RUSTCORDER_BENCH_LANG").unwrap_or_else(|_| "pt".into());
    assert!(matches!(model_name.as_str(), "base" | "small"));
    let corpus = match language.as_str() {
        "pt" => "pt_br",
        "en" => "en_us",
        _ => panic!("select pt or en"),
    };
    let folder = root.join(".build/fixtures").join(corpus);
    let manifest: Value = serde_json::from_slice(
        &std::fs::read(folder.join("window-manifest.json"))
            .expect("explicit benchmark requires its prepared manifest"),
    )
    .unwrap();
    let recordings = manifest["recordings"]
        .as_array()
        .expect("manifest recordings required");
    assert!(!recordings.is_empty());
    let model_path = root
        .join("models")
        .join(format!("ggml-{model_name}.bin"))
        .canonicalize()
        .expect("explicit benchmark requires selected local model");
    let model_hash = sha256(&model_path);
    let approved_hash = match model_name.as_str() {
        "base" => "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        "small" => "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        _ => unreachable!(),
    };
    assert_eq!(
        model_hash, approved_hash,
        "benchmark requires the declared reference model bytes"
    );
    let logical_cpus = std::thread::available_parallelism().unwrap().get();
    let vad: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("assets/silero-vad.json"))
            .expect("pinned VAD provenance required"),
    )
    .unwrap();
    assert_eq!(
        sha256(&root.join("models").join(vad["filename"].as_str().unwrap())),
        vad["sha256"].as_str().unwrap(),
        "benchmark requires the pinned speech-detector bytes"
    );
    let worker_threads = logical_cpus.saturating_sub(2).clamp(1, 8);
    let mut command = Command::new(env!("CARGO_BIN_EXE_rustcorder"));
    command.arg("--asr-worker");
    let mut worker = WorkerProcess::spawn(command, Duration::from_secs(10)).unwrap();
    let cancelled = AtomicBool::new(false);
    let mut metadata = None;
    let load_start = Instant::now();
    worker
        .request(
            &header(
                1,
                RequestKind::LoadModel {
                    model_path: model_path.clone(),
                    language: language.clone(),
                },
                0,
            ),
            &[],
            Duration::from_secs(120),
            &cancelled,
            |event| match event.event {
                EventKind::Ready { model } => metadata = model,
                EventKind::Error { code, message, .. } => panic!("model error {code}: {message}"),
                _ => {}
            },
        )
        .unwrap();
    let load_seconds = load_start.elapsed().as_secs_f64();
    let metadata = metadata.expect("loaded model metadata required");
    assert!(metadata.multilingual);
    assert_eq!(metadata.family, model_name);
    let file_pipeline =
        std::env::var("RUSTCORDER_BENCH_PIPELINE").is_ok_and(|value| value == "file");
    let mut results = Vec::new();
    let mut durations = Vec::new();
    let (mut total_edits, mut reference_words, mut total_samples) = (0usize, 0usize, 0usize);
    for (index, item) in recordings.iter().enumerate() {
        let relative = Path::new(item["file"].as_str().unwrap());
        assert!(
            relative
                .components()
                .all(|part| matches!(part, Component::Normal(_)))
        );
        let expected = item["num_samples"].as_u64().unwrap() as usize;
        assert_eq!(
            sha256(&folder.join(relative)),
            item["sha256"].as_str().unwrap(),
            "manifest clip hash must match actual WAV bytes"
        );
        let audio = samples(&folder.join(relative), expected);
        let reference = item["transcription"]
            .as_str()
            .or_else(|| item["raw_transcription"].as_str())
            .unwrap();
        let mut prediction = String::new();
        let started = Instant::now();
        let request = if file_pipeline {
            header(
                index as u64 + 2,
                RequestKind::TranscribeFile {
                    audio_path: folder.join(relative).canonicalize().unwrap(),
                    language: language.clone(),
                },
                0,
            )
        } else {
            window(index as u64 + 2, &language, audio.len())
        };
        worker
            .request(
                &request,
                if file_pipeline { &[] } else { &audio },
                Duration::from_secs(120),
                &cancelled,
                |event| match event.event {
                    EventKind::Segments { segments, .. } => {
                        for segment in segments {
                            prediction.push_str(&segment.text);
                            prediction.push(' ');
                        }
                    }
                    EventKind::NoSpeech { .. } => {}
                    EventKind::Error { code, message, .. } => {
                        panic!("clip {} failed {code}: {message}", relative.display())
                    }
                    _ => {}
                },
            )
            .unwrap();
        if file_pipeline {
            assert_eq!(
                sha256(&folder.join(relative)),
                item["sha256"].as_str().unwrap(),
                "file pipeline must preserve the source"
            );
        }
        let elapsed = started.elapsed().as_secs_f64();
        let (edits, words) = word_errors(reference, &prediction);
        total_edits += edits;
        reference_words += words;
        total_samples += audio.len();
        durations.push(elapsed);
        println!(
            "{model_name}/{language} clip {}/{} {}: {:.2}s inference / {:.2}s audio, edits {edits}/{words}",
            index + 1,
            recordings.len(),
            relative.display(),
            elapsed,
            audio.len() as f64 / 16_000.0
        );
        results.push(json!({"file":relative, "source_sha256":item["sha256"], "audio_seconds":audio.len() as f64/16_000.0,
            "inference_seconds":elapsed, "reference":reference, "raw_reference":item["raw_transcription"], "prediction":prediction.trim(),
            "normalized_reference":normalize(reference), "normalized_prediction":normalize(&prediction), "word_edits":edits,"reference_words":words}));
    }
    let silence = vec![0.0f32; 128_000];
    let mut silence_no_speech = false;
    worker
        .request(
            &window(recordings.len() as u64 + 2, &language, silence.len()),
            &silence,
            Duration::from_secs(120),
            &cancelled,
            |event| match event.event {
                EventKind::NoSpeech { terminal: true, .. } => silence_no_speech = true,
                EventKind::Error { code, message, .. } => {
                    panic!("silence failed {code}: {message}")
                }
                _ => {}
            },
        )
        .unwrap();
    worker
        .request(
            &header(recordings.len() as u64 + 3, RequestKind::Shutdown, 0),
            &[],
            Duration::from_secs(5),
            &cancelled,
            |_| {},
        )
        .unwrap();
    assert!(!worker.is_running());
    let audio_seconds = total_samples as f64 / 16_000.0;
    let inference_seconds: f64 = durations.iter().sum();
    let total_model_seconds = load_seconds + inference_seconds;
    let wer = total_edits as f64 / reference_words as f64;
    let report = json!({"benchmark":if file_pipeline {"offline_imported_file_pipeline"} else {"preliminary_cpu_whole_clip_baseline"}, "not_live_pipeline_acceptance":true,
        "model":metadata, "model_path":model_path, "model_sha256":model_hash,"model_bytes":std::fs::metadata(&model_path).unwrap().len(),
        "language":language, "logical_cpus":logical_cpus, "worker_threads":worker_threads,"gpu_enabled":false,
        "build_profile":if cfg!(debug_assertions) {"debug"}else{"release"},
        "vad":vad,"speech_gate":"whole-window Silero default threshold 0.5 / minimum speech 250 ms; no trimming",
        "corpus_dataset":manifest["dataset"],"corpus_revision":manifest["revision"],"corpus_config":manifest["config"],
        "independently_human_checked":manifest["independently_human_checked"],"whole_clips":results.len(),
        "reference_field":"transcription (corpus-normalized reference); raw_reference retained for review",
        "normalization":"NFC, lowercase, punctuation to spaces, collapse whitespace; preserve accents and digits; no numeral expansion",
        "audio_seconds":audio_seconds,"load_seconds":load_seconds,"inference_seconds":inference_seconds,"total_model_seconds":total_model_seconds,
        "raw_clip_latency_p50_seconds":percentile(&durations,0.5),"raw_clip_latency_p95_seconds":percentile(&durations,0.95),
        "word_edits":total_edits,"reference_words":reference_words,"aggregate_word_error_rate":wer,
        "digital_silence_no_speech":silence_no_speech,"clips":results});
    let output = std::env::var_os("RUSTCORDER_BENCH_REPORT")
        .map(|value| root.join(value))
        .unwrap_or_else(|| {
            root.join(".build/benchmarks")
                .join(format!("{model_name}-{language}-baseline.json"))
        });
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(&output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    println!(
        "Report: {} | WER {wer:.4} | model {total_model_seconds:.2}s / audio {audio_seconds:.2}s",
        output.display()
    );
    assert!(
        audio_seconds >= 600.0 && reference_words > 0,
        "ten-minute nonempty corpus required"
    );
    assert!(silence_no_speech, "digital silence must produce NoSpeech");
    assert!(wer <= 0.20, "preliminary WER gate failed; report retained");
    assert!(
        total_model_seconds <= audio_seconds,
        "preliminary CPU throughput gate failed; report retained"
    );
}

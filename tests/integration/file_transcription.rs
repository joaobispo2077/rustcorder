use rustcorder::transcription::worker::decode_audio_file;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

fn folder() -> PathBuf {
    static ID: AtomicU64 = AtomicU64::new(0);
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target/file-tests")
        .join(format!(
            "{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            ID.fetch_add(1, Ordering::Relaxed)
        ));
    std::fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap()
}

fn wav(path: &Path, rate: u32, channels: u16, seconds: f64, value: impl Fn(usize) -> f32) {
    let spec = hound::WavSpec {
        channels,
        sample_rate: rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec).unwrap();
    for frame in 0..(rate as f64 * seconds).round() as usize {
        for channel in 0..channels {
            writer
                .write_sample(value(frame * channels as usize + channel as usize))
                .unwrap();
        }
    }
    writer.finalize().unwrap();
}

#[test]
fn stereo_wav_is_downmixed_and_resampled_without_changing_original() {
    let path = folder().join("stereo.wav");
    wav(&path, 48_000, 2, 1.0, |index| {
        if index % 2 == 0 { 0.25 } else { 0.75 }
    });
    let original = std::fs::read(&path).unwrap();
    let mut audio = Vec::new();
    let frames = decode_audio_file(&path, |chunk, origin| {
        assert_eq!(origin, audio.len() as u64);
        audio.extend_from_slice(chunk);
        Ok(())
    })
    .expect("supported stereo WAV should decode");
    assert_eq!(frames, 16_000);
    assert_eq!(audio.len(), 16_000);
    assert!(
        audio[1000..15000]
            .iter()
            .all(|value| (*value - 0.5).abs() < 0.01)
    );
    assert_eq!(std::fs::read(path).unwrap(), original);
}

#[test]
fn fractional_rate_and_short_tail_preserve_duration() {
    let path = folder().join("fractional.wav");
    wav(&path, 44_100, 1, 0.5, |frame| {
        ((frame as f32 / 44_100.0) * 1000.0 * std::f32::consts::TAU).sin() * 0.2
    });
    let mut audio = Vec::new();
    let count = decode_audio_file(&path, |chunk, _| {
        audio.extend_from_slice(chunk);
        Ok(())
    })
    .unwrap();
    assert_eq!(count, 8_000);
    assert!(audio.iter().all(|sample| sample.is_finite()));
    assert!(
        audio.iter().any(|sample| sample.abs() > 0.1),
        "resampling must not discard quiet valid audio"
    );
}

#[test]
fn long_silence_is_streamed_in_bounded_chunks() {
    let path = folder().join("silence.wav");
    wav(&path, 16_000, 1, 31.0, |_| 0.0);
    let (mut samples, mut chunks) = (0usize, 0usize);
    let frames = decode_audio_file(&path, |chunk, origin| {
        assert_eq!(origin, samples as u64);
        assert!(!chunk.is_empty() && chunk.len() <= 240_000);
        assert!(chunk.iter().all(|value| *value == 0.0));
        chunks += 1;
        samples += chunk.len();
        Ok(())
    })
    .unwrap();
    assert_eq!(frames, 496_000);
    assert_eq!(samples, 496_000);
    assert!(chunks >= 3);
}

#[test]
fn decoder_reports_empty_missing_corrupt_unsupported_and_non_finite_files() {
    let root = folder();
    for (name, content) in [
        ("empty.wav", &b""[..]),
        ("corrupt.wav", &b"not audio"[..]),
        ("audio.txt", &b"text"[..]),
    ] {
        std::fs::write(root.join(name), content).unwrap();
        assert!(
            decode_audio_file(&root.join(name), |_, _| Ok(())).is_err(),
            "{name} must fail"
        );
    }
    assert!(decode_audio_file(&root.join("missing.wav"), |_, _| Ok(())).is_err());
    let invalid = root.join("nan.wav");
    wav(&invalid, 16_000, 1, 0.1, |_| f32::NAN);
    assert!(decode_audio_file(&invalid, |_, _| Ok(())).is_err());
}

#[test]
fn truncated_wav_never_claims_a_complete_decode() {
    let path = folder().join("truncated.wav");
    wav(&path, 16_000, 1, 0.5, |_| 0.1);
    let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_len(file.metadata().unwrap().len() - 40).unwrap();
    assert!(decode_audio_file(&path, |_, _| Ok(())).is_err());
}

#[test]
fn caller_can_abort_incremental_decode() {
    let path = folder().join("cancel.wav");
    wav(&path, 16_000, 1, 31.0, |_| 0.1);
    let mut calls = 0;
    let result = decode_audio_file(&path, |_, _| {
        calls += 1;
        Err("cancelled test consumer".into())
    });
    assert!(result.is_err());
    assert_eq!(calls, 1);
}

#[test]
fn synthetic_mp3_decodes_locally_without_external_converter() {
    // Synthetic silence, generated once with libmp3lame 3.100, 16 kHz mono/16 kbps.
    // The test and product use Symphonia; FFmpeg is not a test/runtime dependency.
    const HEX: &str = "fff328c40000000348000000004c414d45332e313030555555555555555555555555555555555555555555555555555555555555554c414d45332e31303055555555555555555555fff328c43b00000348000000005555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555fff328c47600000348000000005555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555fff328c4b100000348000000005555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555fff328c4c400000348000000005555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555";
    let bytes: Vec<u8> = (0..HEX.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&HEX[index..index + 2], 16).unwrap())
        .collect();
    let path = folder().join("synthetic.mp3");
    std::fs::write(&path, &bytes).unwrap();
    let mut output = Vec::new();
    let count = decode_audio_file(&path, |chunk, _| {
        output.extend_from_slice(chunk);
        Ok(())
    })
    .unwrap();
    assert!(count > 0 && count < 16_000);
    assert!(
        output
            .iter()
            .all(|sample| sample.is_finite() && sample.abs() < 0.0001)
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
}

#[test]
#[ignore = "requires prepared local model and spoken recording; run without concurrent model benchmarks"]
fn actual_file_worker_returns_progress_and_text_without_modifying_audio() {
    use rustcorder::transcription::{EventKind, Request, RequestKind, WorkerProcess};
    use std::process::Command;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let audio = std::env::var_os("RUSTCORDER_FILE_TEST_AUDIO")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join(".build/fixtures/pt_br/row-0000.wav"))
        .canonicalize()
        .expect("prepared spoken fixture required");
    let model = root
        .join("models/ggml-base.bin")
        .canonicalize()
        .expect("prepared multilingual base required");
    let original = std::fs::read(&audio).unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_rustcorder"));
    command.arg("--asr-worker");
    let mut child = WorkerProcess::spawn(command, Duration::from_secs(10)).unwrap();
    let cancelled = AtomicBool::new(false);
    child
        .request(
            &Request {
                protocol: 1,
                id: 1,
                job_generation: 1,
                payload_bytes: 0,
                command: RequestKind::LoadModel {
                    model_path: model,
                    language: "pt".into(),
                },
            },
            &[],
            Duration::from_secs(120),
            &cancelled,
            |event| {
                if let EventKind::Error { message, .. } = event.event {
                    panic!("{message}")
                }
            },
        )
        .unwrap();
    let (mut progress, mut terminal, mut text) = (0, 0, String::new());
    child
        .request(
            &Request {
                protocol: 1,
                id: 2,
                job_generation: 1,
                payload_bytes: 0,
                command: RequestKind::TranscribeFile {
                    audio_path: audio.clone(),
                    language: "pt".into(),
                },
            },
            &[],
            Duration::from_secs(120),
            &cancelled,
            |event| match event.event {
                EventKind::Progress { .. } => progress += 1,
                EventKind::Segments {
                    segments,
                    terminal: done,
                    ..
                } => {
                    for segment in segments {
                        text.push_str(&segment.text);
                    }
                    terminal += usize::from(done);
                }
                EventKind::NoSpeech { terminal: done, .. } => terminal += usize::from(done),
                EventKind::Error { message, .. } => panic!("{message}"),
                _ => {}
            },
        )
        .unwrap();
    assert!(progress > 0 && !text.trim().is_empty());
    assert_eq!(terminal, 1);
    assert_eq!(std::fs::read(audio).unwrap(), original);
}

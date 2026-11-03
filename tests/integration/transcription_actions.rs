//! Synthetic export and background-worker action scenarios.

use rustcorder::app::{Language, ModelConfig};
use rustcorder::transcription::jobs::{Job, JobEvent};
use rustcorder::transcription::transcript::Transcript;
use rustcorder::transcription::{EventKind, Segment};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub(super) fn folder() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target/job-tests")
        .join(format!(
            "{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
    std::fs::create_dir_all(&path).unwrap();
    path.canonicalize().unwrap()
}

pub(super) fn model() -> ModelConfig {
    ModelConfig {
        path: Path::new(env!("CARGO_MANIFEST_DIR")).join("models/ggml-base.bin"),
        language: Language::Portuguese,
    }
}

pub(super) fn fake_command(mode: &str) -> Command {
    static BINARY: OnceLock<PathBuf> = OnceLock::new();
    let binary = BINARY.get_or_init(|| {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .unwrap();
        let destination = folder();
        assert!(destination.starts_with(root.join("target")));
        let source = destination.join("fake-job-worker.rs");
        let binary = destination.join(if cfg!(windows) {
            "fake-job-worker.exe"
        } else {
            "fake-job-worker"
        });
        std::fs::write(&source, FAKE_WORKER).unwrap();
        let compiler = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
        let result = Command::new(compiler)
            .arg("--edition=2024")
            .arg(source)
            .arg("-o")
            .arg(&binary)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "fake child must compile: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        binary
    });
    let mut command = Command::new(binary);
    command.arg(mode);
    command
}

pub(super) fn next(job: &Job) -> JobEvent {
    job.events
        .recv_timeout(Duration::from_secs(5))
        .expect("background job must report an outcome")
}

pub(super) fn wait_finished(job: &Job, limit: Duration) -> bool {
    let until = Instant::now() + limit;
    while Instant::now() < until {
        if job.is_finished() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    job.is_finished()
}

fn complete_text() -> Transcript {
    let mut transcript = Transcript::default();
    transcript.apply(
        vec![Segment {
            start_sample: 0,
            end_sample: 16,
            text: "Olá, ação e reunião — amanhã!".into(),
        }],
        0,
        16,
        true,
    );
    transcript.finish(16);
    transcript
}

#[test]
fn complete_text_exports_unicode_and_does_not_overwrite_existing_files() {
    let path = folder().join("transcrição.txt");
    let mut transcript = complete_text();
    assert!(transcript.unsaved());
    let clipboard_text = transcript.export_text();
    assert_eq!(clipboard_text, "Olá, ação e reunião — amanhã!\n");
    transcript.save_new(&path).unwrap();
    assert!(!transcript.unsaved());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), clipboard_text);
    assert_eq!(
        transcript.save_new(&path).unwrap_err().kind(),
        std::io::ErrorKind::AlreadyExists
    );
    assert_eq!(std::fs::read_to_string(path).unwrap(), clipboard_text);
}

#[test]
fn failed_export_preserves_finalized_text_and_unsaved_state_for_retry() {
    let folder = folder();
    let mut transcript = complete_text();
    let text = transcript.stable_text();
    assert!(
        transcript
            .save_new(&folder.join("missing/result.txt"))
            .is_err()
    );
    assert_eq!(transcript.stable_text(), text);
    assert!(transcript.unsaved());
    transcript.save_new(&folder.join("retry.txt")).unwrap();
    assert!(!transcript.unsaved());
}

#[test]
fn incomplete_export_marks_partial_text_and_never_includes_revisable_words() {
    let mut transcript = Transcript::default();
    transcript.apply(
        vec![
            Segment {
                start_sample: 0,
                end_sample: 16_000,
                text: "ação segura".into(),
            },
            Segment {
                start_sample: 100_000,
                end_sample: 120_000,
                text: "palavras revisáveis".into(),
            },
        ],
        0,
        128_000,
        false,
    );
    transcript.fail("local worker failed");
    let text = transcript.export_text();
    assert!(text.contains("INCOMPLETE TRANSCRIPT"));
    assert!(text.contains("ação segura"));
    assert!(!text.contains("revisáveis"));
    let path = folder().join("partial.txt");
    transcript.save_new(&path).unwrap();
    assert_eq!(std::fs::read_to_string(path).unwrap(), text);
}

#[test]
fn background_file_job_reports_segments_completion_and_preserves_input() {
    let input = folder().join("input.wav");
    std::fs::write(&input, b"fake-worker fixture, not decoded audio").unwrap();
    let original = std::fs::read(&input).unwrap();
    let job = Job::file_with_command(model(), input.clone(), fake_command("file_success"));
    assert!(matches!(next(&job), JobEvent::Ready));
    assert!(matches!(
        next(&job),
        JobEvent::Window {
            event: EventKind::Segments { terminal: true, .. },
            ..
        }
    ));
    assert!(matches!(
        next(&job),
        JobEvent::Finished {
            result: Ok(()),
            end: 16,
            gap: false
        }
    ));
    assert!(wait_finished(&job, Duration::from_secs(2)));
    assert_eq!(std::fs::read(input).unwrap(), original);
}

#[test]
fn background_file_error_keeps_stable_words_for_labeled_export() {
    let input = folder().join("input.wav");
    std::fs::write(&input, b"preserved original").unwrap();
    let job = Job::file_with_command(model(), input.clone(), fake_command("file_error"));
    let mut transcript = Transcript::default();
    loop {
        match next(&job) {
            JobEvent::Window {
                event:
                    EventKind::Segments {
                        segments,
                        coverage_start,
                        coverage_end,
                        ..
                    },
                ..
            } => transcript.apply(segments, coverage_start, coverage_end, true),
            JobEvent::Finished {
                result: Err(message),
                ..
            } => {
                transcript.fail(message);
                break;
            }
            JobEvent::Finished { result: Ok(()), .. } => {
                panic!("error response must not complete successfully")
            }
            _ => {}
        }
    }
    assert_eq!(transcript.stable_text(), "ação já salva");
    assert!(transcript.export_text().contains("INCOMPLETE"));
    assert_eq!(std::fs::read(input).unwrap(), b"preserved original");
}

#[test]
fn file_cancellation_reaps_worker_and_reports_failure_promptly() {
    let job = Job::file_with_command(
        model(),
        folder().join("input.wav"),
        fake_command("file_hang"),
    );
    assert!(matches!(next(&job), JobEvent::Ready));
    assert!(matches!(
        next(&job),
        JobEvent::Window {
            event: EventKind::Progress { .. },
            ..
        }
    ));
    let started = Instant::now();
    job.cancel();
    assert!(matches!(
        next(&job),
        JobEvent::Finished {
            result: Err(_),
            gap: true,
            ..
        }
    ));
    assert!(wait_finished(&job, Duration::from_secs(2)));
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn cancellation_cleans_up_even_when_ui_event_queue_is_full() {
    let job = Job::file_with_command(
        model(),
        folder().join("input.wav"),
        fake_command("file_spam"),
    );
    assert!(matches!(next(&job), JobEvent::Ready));
    std::thread::sleep(Duration::from_millis(350));
    job.cancel();
    assert!(
        wait_finished(&job, Duration::from_secs(2)),
        "cancellation must not wait for a stalled UI to drain its bounded queue"
    );
    let finished = job
        .events
        .try_iter()
        .filter(|event| matches!(event, JobEvent::Finished { .. }))
        .count();
    assert_eq!(
        finished, 1,
        "the terminal outcome must remain deliverable after queue saturation"
    );
}

const FAKE_WORKER: &str = r###"
use std::io::{self, Read, Write};
use std::thread;
use std::time::Duration;
fn number(header: &str, field: &str) -> u64 {
    header.split_once(&format!("\"{field}\":")).unwrap().1.trim_start()
        .chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap()
}
fn emit(id: u64, generation: u64, fields: &str) {
    println!(r#"{{"protocol":1,"id":{id},"job_generation":{generation},{fields}}}"#);
    io::stdout().flush().unwrap();
}
fn main() {
    let mode = std::env::args().nth(1).unwrap();
    emit(0,0,r#""kind":"Ready","model":null"#);
    let mut input=io::stdin().lock();
    loop {
        let mut size=[0;4];
        if input.read_exact(&mut size).is_err() { return; }
        let mut header=vec![0;u32::from_le_bytes(size) as usize];
        input.read_exact(&mut header).unwrap();
        let header=String::from_utf8(header).unwrap();
        let mut payload=vec![0;number(&header,"payload_bytes") as usize];
        input.read_exact(&mut payload).unwrap();
        let (id,generation)=(number(&header,"id"),number(&header,"job_generation"));
        if header.contains("\"kind\":\"Shutdown\"") { return; }
        if header.contains("\"kind\":\"LoadModel\"") {
            emit(id,generation,r#""kind":"Ready","model":{"family":"base","multilingual":true}"#);
            continue;
        }
        if mode=="live_crash" { std::process::exit(29); }
        if mode=="file_spam" {
            for _ in 0..500 {
                emit(id,generation,r#""kind":"Progress","fraction":0.2,"stage":"processing","processed_samples":0"#);
            }
        }
        if mode=="live_hang" || mode=="file_hang" {
            emit(id,generation,r#""kind":"Progress","fraction":null,"stage":"processing","processed_samples":0"#);
            thread::sleep(Duration::from_secs(30)); return;
        }
        if mode=="file_error" {
            emit(id,generation,r#""kind":"Segments","segments":[{"start_sample":0,"end_sample":16,"text":"ação já salva"}],"coverage_start":0,"coverage_end":16,"terminal":false"#);
            emit(id,generation,r#""kind":"Error","code":"InferenceFailed","stage":"inference","message":"injected local failure"#);
            continue;
        }
        let (start,end)=if header.contains("\"kind\":\"TranscribeWindow\"") {
            (number(&header,"start_sample"),number(&header,"end_sample"))
        } else { (0,16) };
        emit(id,generation,&format!(r#""kind":"Segments","segments":[{{"start_sample":{start},"end_sample":{end},"text":"ação local"}}],"coverage_start":{start},"coverage_end":{end},"terminal":true"#));
    }
}
"###;

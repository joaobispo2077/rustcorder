use rustcorder::transcription::{
    Event, EventKind, MAX_EVENT_BYTES, MAX_HEADER_BYTES, MAX_PAYLOAD_BYTES, Request, RequestKind,
    WorkerError, WorkerProcess, read_event, read_request, write_event, write_request,
};
use std::io::{self, BufReader, Cursor, Read, Write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

fn request() -> Request {
    Request {
        protocol: 1,
        id: 7,
        job_generation: 3,
        payload_bytes: 8,
        command: RequestKind::TranscribeWindow {
            language: "pt".into(),
            start_sample: 0,
            end_sample: 2,
            sample_count: 2,
            final_window: false,
        },
    }
}

fn event() -> Event {
    Event {
        protocol: 1,
        id: 7,
        job_generation: 3,
        event: EventKind::NoSpeech {
            coverage_start: 0,
            coverage_end: 2,
            terminal: true,
        },
    }
}

fn raw_frame(header: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut frame = (header.len() as u32).to_le_bytes().to_vec();
    frame.extend_from_slice(header);
    frame.extend_from_slice(payload);
    frame
}

struct ShortIo {
    bytes: Cursor<Vec<u8>>,
}
impl Read for ShortIo {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        let length = output.len().min(2);
        self.bytes.read(&mut output[..length])
    }
}
impl Write for ShortIo {
    fn write(&mut self, input: &[u8]) -> io::Result<usize> {
        self.bytes.write(&input[..input.len().min(2)])
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn requests_round_trip_with_short_reads_and_writes_and_clean_eof() {
    let expected = request();
    let mut stream = ShortIo {
        bytes: Cursor::new(Vec::new()),
    };
    write_request(&mut stream, &expected, &[0.25, -0.5]).expect("valid request must write fully");
    stream.bytes.set_position(0);
    let (actual, samples) = read_request(&mut stream)
        .expect("valid frame must read")
        .expect("one frame");
    assert_eq!(actual, expected);
    assert_eq!(samples, vec![0.25, -0.5]);
    assert!(
        read_request(&mut stream).unwrap().is_none(),
        "clean frame-boundary EOF is not an error"
    );
}

#[test]
fn concatenated_requests_keep_the_next_header_intact() {
    let mut bytes = Vec::new();
    let mut second = request();
    second.id += 1;
    write_request(&mut bytes, &request(), &[0.1, 0.2]).unwrap();
    write_request(&mut bytes, &second, &[0.3, 0.4]).unwrap();
    let mut input = Cursor::new(bytes);
    assert_eq!(read_request(&mut input).unwrap().unwrap().0.id, 7);
    assert_eq!(read_request(&mut input).unwrap().unwrap().0.id, 8);
}

#[test]
fn wire_samples_are_little_endian_float32() {
    let mut frame = Vec::new();
    write_request(&mut frame, &request(), &[0.25, -0.5]).unwrap();
    let header_len = u32::from_le_bytes(frame[..4].try_into().unwrap()) as usize;
    let expected: Vec<_> = [0.25f32, -0.5]
        .into_iter()
        .flat_map(f32::to_le_bytes)
        .collect();
    assert_eq!(&frame[4 + header_len..], expected.as_slice());
}

#[test]
fn read_rejects_oversized_zero_and_truncated_headers() {
    for length in [0, MAX_HEADER_BYTES as u32 + 1] {
        assert!(read_request(&mut Cursor::new(length.to_le_bytes())).is_err());
    }
    assert!(read_request(&mut Cursor::new(vec![1, 2])).is_err());
    assert!(read_request(&mut Cursor::new(raw_frame(b"{", &[]))).is_err());
    assert!(read_request(&mut Cursor::new(raw_frame(&[0xff], &[]))).is_err());
}

#[test]
fn read_rejects_unknown_protocol_kind_and_oversized_payload() {
    let valid = serde_json::to_value(request()).unwrap();
    for (field, value) in [
        ("protocol", serde_json::json!(2)),
        ("kind", serde_json::json!("ExecuteProgram")),
        ("payload_bytes", serde_json::json!(MAX_PAYLOAD_BYTES + 1)),
    ] {
        let mut header = valid.clone();
        header[field] = value;
        let frame = raw_frame(&serde_json::to_vec(&header).unwrap(), &[]);
        assert!(
            read_request(&mut Cursor::new(frame)).is_err(),
            "must reject {field}"
        );
    }
}

#[test]
fn read_rejects_truncated_pcm_and_non_finite_audio() {
    let header = serde_json::to_vec(&request()).unwrap();
    assert!(read_request(&mut Cursor::new(raw_frame(&header, &[0; 4]))).is_err());
    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let payload: Vec<_> = [0.0f32, bad]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect();
        assert!(read_request(&mut Cursor::new(raw_frame(&header, &payload))).is_err());
    }
}

#[test]
fn read_rejects_inconsistent_window_counts_ranges_and_language() {
    for (field, value) in [
        ("sample_count", serde_json::json!(3)),
        ("end_sample", serde_json::json!(1)),
        ("start_sample", serde_json::json!(3)),
        ("language", serde_json::json!("fr")),
    ] {
        let mut header = serde_json::to_value(request()).unwrap();
        header[field] = value;
        assert!(
            read_request(&mut Cursor::new(raw_frame(
                &serde_json::to_vec(&header).unwrap(),
                &[0; 8]
            )))
            .is_err(),
            "must reject {field}"
        );
    }
}

#[test]
fn writing_invalid_audio_or_metadata_emits_no_partial_frame() {
    for samples in [vec![f32::NAN, 0.0], vec![0.0], vec![f32::INFINITY, 0.0]] {
        let mut bytes = Vec::new();
        assert!(write_request(&mut bytes, &request(), &samples).is_err());
        assert!(bytes.is_empty(), "validate before emitting bytes");
    }
    let mut invalid = request();
    invalid.payload_bytes = MAX_PAYLOAD_BYTES + 1;
    let mut bytes = Vec::new();
    assert!(write_request(&mut bytes, &invalid, &[0.0, 0.0]).is_err());
    assert!(bytes.is_empty());
}

#[test]
fn non_audio_requests_cannot_smuggle_pcm_payloads() {
    let mut invalid = request();
    invalid.command = RequestKind::LoadModel {
        model_path: "model.bin".into(),
        language: "pt".into(),
    };
    let mut bytes = Vec::new();
    assert!(write_request(&mut bytes, &invalid, &[0.0, 0.0]).is_err());
    let header = serde_json::to_vec(&invalid).unwrap();
    assert!(read_request(&mut Cursor::new(raw_frame(&header, &[0; 8]))).is_err());
}

#[test]
fn exact_maximum_audio_payload_is_accepted_but_large_headers_are_not() {
    let count = MAX_PAYLOAD_BYTES / 4;
    let samples = vec![0.0f32; count];
    let mut value = request();
    value.payload_bytes = MAX_PAYLOAD_BYTES;
    value.command = RequestKind::TranscribeWindow {
        language: "pt".into(),
        start_sample: 0,
        end_sample: count as u64,
        sample_count: count,
        final_window: true,
    };
    let mut bytes = Vec::new();
    write_request(&mut bytes, &value, &samples).expect("exact maximum payload is valid");
    assert_eq!(
        read_request(&mut Cursor::new(bytes))
            .unwrap()
            .unwrap()
            .1
            .len(),
        count
    );
    value.payload_bytes = 0;
    value.command = RequestKind::ValidateModel {
        model_path: "x".repeat(MAX_HEADER_BYTES).into(),
    };
    let mut output = Vec::new();
    assert!(write_request(&mut output, &value, &[]).is_err());
    assert!(output.is_empty());
}

#[test]
fn all_non_audio_command_variants_round_trip_without_payload() {
    for command in [
        RequestKind::ValidateModel {
            model_path: "C:/Models/base.bin".into(),
        },
        RequestKind::LoadModel {
            model_path: "C:/Models/base.bin".into(),
            language: "en".into(),
        },
        RequestKind::TranscribeFile {
            audio_path: "C:/Audio/reunião.wav".into(),
            language: "pt".into(),
        },
        RequestKind::Shutdown,
    ] {
        let value = Request {
            command,
            payload_bytes: 0,
            ..request()
        };
        let mut bytes = Vec::new();
        write_request(&mut bytes, &value, &[]).unwrap();
        assert_eq!(
            read_request(&mut Cursor::new(bytes)).unwrap(),
            Some((value, vec![]))
        );
    }
}

#[test]
fn event_json_lines_round_trip_and_preserve_utf8_and_line_boundaries() {
    let mut value = event();
    value.event = EventKind::Error {
        code: "InvalidModel".into(),
        stage: "load".into(),
        message: "Pasta da reunião inválida".into(),
    };
    let mut output = ShortIo {
        bytes: Cursor::new(Vec::new()),
    };
    write_event(&mut output, &value).unwrap();
    write_event(&mut output, &event()).unwrap();
    output.bytes.set_position(0);
    let mut input = BufReader::with_capacity(2, output);
    assert_eq!(read_event(&mut input).unwrap(), Some(value));
    assert_eq!(read_event(&mut input).unwrap(), Some(event()));
    assert!(read_event(&mut input).unwrap().is_none());
}

#[test]
fn event_reader_rejects_native_output_invalid_utf8_truncated_and_oversized_lines() {
    for bytes in [
        b"native loader diagnostic\n".to_vec(),
        vec![0xff, b'\n'],
        b"{\"protocol\":1".to_vec(),
        vec![b'x'; MAX_EVENT_BYTES + 1],
    ] {
        assert!(read_event(&mut BufReader::new(Cursor::new(bytes))).is_err());
    }
}

#[test]
fn event_reader_rejects_unknown_protocol_and_impossible_coverage() {
    for (field, value) in [
        ("protocol", serde_json::json!(99)),
        ("coverage_start", serde_json::json!(10)),
    ] {
        let mut header = serde_json::to_value(event()).unwrap();
        header[field] = value;
        let mut line = serde_json::to_vec(&header).unwrap();
        line.push(b'\n');
        assert!(
            read_event(&mut Cursor::new(line)).is_err(),
            "must reject {field}"
        );
    }
}

#[test]
fn event_writer_rejects_oversized_text_before_emitting_a_line() {
    let mut value = event();
    value.event = EventKind::Error {
        code: "failure".into(),
        stage: "inference".into(),
        message: "x".repeat(MAX_EVENT_BYTES),
    };
    let mut output = Vec::new();
    assert!(write_event(&mut output, &value).is_err());
    assert!(output.is_empty());
}

fn fake_binary() -> &'static PathBuf {
    static BINARY: OnceLock<PathBuf> = OnceLock::new();
    BINARY.get_or_init(|| {
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .unwrap();
        let directory = workspace.join("target/protocol-tests");
        std::fs::create_dir_all(&directory).unwrap();
        let directory = directory.canonicalize().unwrap();
        assert!(
            directory.starts_with(workspace.join("target")),
            "fixture output must stay under target"
        );
        let name = if cfg!(windows) {
            format!("fake-worker-{}.exe", std::process::id())
        } else {
            format!("fake-worker-{}", std::process::id())
        };
        let binary = directory.join(name);
        let compiler = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
        let result = Command::new(compiler)
            .arg("--edition=2024")
            .arg(workspace.join("tests/support/fake_worker.rs"))
            .arg("-o")
            .arg(&binary)
            .output()
            .expect("test environment must allow compiling a std-only child fixture");
        assert!(
            result.status.success(),
            "fake worker compilation failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        binary
    })
}

fn spawn(mode: &str) -> WorkerProcess {
    let mut command = Command::new(fake_binary());
    command.arg(mode);
    WorkerProcess::spawn(command, Duration::from_secs(3))
        .expect("valid child Ready handshake must succeed")
}

#[test]
fn supervisor_delivers_progress_and_terminal_segments() {
    let mut child = spawn("segments");
    assert!(child.is_running());
    let mut events = Vec::new();
    child
        .request(
            &request(),
            &[0.0; 2],
            Duration::from_secs(3),
            &AtomicBool::new(false),
            |value| events.push(value),
        )
        .unwrap();
    assert_eq!(events.len(), 2);
    assert!(matches!(events[0].event, EventKind::Progress { .. }));
    assert!(
        matches!(&events[1].event, EventKind::Segments { segments, terminal: true, .. } if segments[0].text == "Olá, reunião")
    );
    assert!(
        child.is_running(),
        "successful request keeps model worker available"
    );
}

#[test]
fn supervisor_ignores_stale_ids_and_generations() {
    let mut child = spawn("stale");
    let mut events = Vec::new();
    child
        .request(
            &request(),
            &[0.0; 2],
            Duration::from_secs(3),
            &AtomicBool::new(false),
            |value| events.push(value),
        )
        .unwrap();
    assert_eq!(
        events,
        vec![event()],
        "stale completions must not escape into the current job"
    );
}

#[test]
fn duplicate_terminal_event_cannot_complete_the_next_request() {
    let mut child = spawn("duplicate");
    for id in [7, 8] {
        let next = Request { id, ..request() };
        let mut events = Vec::new();
        child
            .request(
                &next,
                &[0.0; 2],
                Duration::from_secs(3),
                &AtomicBool::new(false),
                |value| events.push(value),
            )
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, id);
    }
}

#[test]
fn supervisor_drains_large_stderr_without_blocking_stdout() {
    let mut child = spawn("stderr_spam");
    let mut count = 0;
    child
        .request(
            &request(),
            &[0.0; 2],
            Duration::from_secs(5),
            &AtomicBool::new(false),
            |_| count += 1,
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn shutdown_completes_on_clean_child_exit_and_reaps_process() {
    let mut child = spawn("success");
    let shutdown = Request {
        payload_bytes: 0,
        command: RequestKind::Shutdown,
        ..request()
    };
    let mut events = Vec::new();
    child
        .request(
            &shutdown,
            &[],
            Duration::from_secs(3),
            &AtomicBool::new(false),
            |value| events.push(value),
        )
        .unwrap();
    assert!(
        events.is_empty(),
        "Shutdown terminates through EOF, not a fabricated response"
    );
    assert!(!child.is_running());
}

#[test]
fn startup_hang_and_invalid_handshakes_are_bounded_failures() {
    for mode in ["startup_hang", "startup_crash", "startup_malformed"] {
        let mut command = Command::new(fake_binary());
        command.arg(mode);
        let start = Instant::now();
        let result = WorkerProcess::spawn(command, Duration::from_millis(300));
        assert!(result.is_err(), "invalid startup {mode} must fail");
        assert!(start.elapsed() < Duration::from_secs(5));
    }
}

#[test]
fn request_deadline_kills_and_reaps_a_hung_child() {
    let mut child = spawn("hang");
    let start = Instant::now();
    let result = child.request(
        &request(),
        &[0.0; 2],
        Duration::from_millis(200),
        &AtomicBool::new(false),
        |_| {},
    );
    assert!(matches!(result, Err(WorkerError::Timeout)));
    assert!(
        !child.is_running(),
        "timeout must reap the child before returning"
    );
    assert!(start.elapsed() < Duration::from_secs(5));
}

#[test]
fn cancellation_interrupts_a_blocked_request_and_reaps_child() {
    let mut child = spawn("hang");
    let cancelled = AtomicBool::new(false);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            std::thread::sleep(Duration::from_millis(100));
            cancelled.store(true, Ordering::Release);
        });
        let start = Instant::now();
        let result = child.request(
            &request(),
            &[0.0; 2],
            Duration::from_secs(10),
            &cancelled,
            |_| {},
        );
        assert!(matches!(result, Err(WorkerError::Cancelled)));
        assert!(!child.is_running());
        assert!(start.elapsed() < Duration::from_secs(5));
    });
}

#[test]
fn malformed_overflow_truncated_and_crashed_workers_fail_and_are_reaped() {
    for mode in ["malformed", "oversized", "truncated", "crash"] {
        let mut child = spawn(mode);
        let result = child.request(
            &request(),
            &[0.0; 2],
            Duration::from_secs(3),
            &AtomicBool::new(false),
            |_| {},
        );
        assert!(result.is_err(), "{mode} must fail the request");
        assert!(!child.is_running(), "{mode} child must be reaped");
    }
}

#[test]
fn mismatched_or_partial_terminal_coverage_cannot_reach_the_current_job() {
    for mode in ["wrong_coverage", "partial_coverage"] {
        let mut child = spawn(mode);
        let mut delivered = false;
        let result = child.request(
            &request(),
            &[0.0; 2],
            Duration::from_secs(3),
            &AtomicBool::new(false),
            |_| delivered = true,
        );
        assert!(matches!(result, Err(WorkerError::Protocol(_))));
        assert!(
            !delivered,
            "another interval cannot establish this window's coverage"
        );
        assert!(!child.is_running());
    }
}

#[test]
fn shutdown_error_is_not_successful_exit_and_reaps_the_worker() {
    let mut child = spawn("shutdown_error");
    let shutdown = Request {
        command: RequestKind::Shutdown,
        payload_bytes: 0,
        ..request()
    };
    let result = child.request(
        &shutdown,
        &[],
        Duration::from_secs(3),
        &AtomicBool::new(false),
        |_| {},
    );
    assert!(
        result.is_err(),
        "Shutdown requires clean EOF/exit, not an Error event"
    );
    assert!(!child.is_running());
}

fn file_request() -> Request {
    Request {
        command: RequestKind::TranscribeFile {
            audio_path: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/fixture.wav"),
            language: "pt".into(),
        },
        payload_bytes: 0,
        ..request()
    }
}

#[test]
fn advancing_file_progress_renews_idle_deadline_without_limiting_total_duration() {
    let mut child = spawn("file_advancing");
    let started = Instant::now();
    let mut progress = 0;
    child
        .request(
            &file_request(),
            &[],
            Duration::from_millis(250),
            &AtomicBool::new(false),
            |event| {
                if matches!(event.event, EventKind::Progress { .. }) {
                    progress += 1;
                }
            },
        )
        .expect("a file making real progress may take longer than one idle interval");
    assert_eq!(progress, 8);
    assert!(started.elapsed() >= Duration::from_millis(450));
    assert!(child.is_running());
}

#[test]
fn advancing_file_coverage_also_renews_idle_deadline() {
    let mut child = spawn("file_coverage");
    let mut covered = 0;
    child
        .request(
            &file_request(),
            &[],
            Duration::from_millis(250),
            &AtomicBool::new(false),
            |event| {
                if let EventKind::NoSpeech { coverage_end, .. } = event.event {
                    covered = coverage_end;
                }
            },
        )
        .expect("processed silence coverage is real work even when it has no words");
    assert_eq!(covered, 8);
    assert!(child.is_running());
}

#[test]
fn stationary_rewinding_and_foreign_progress_cannot_keep_a_stalled_file_alive() {
    for mode in ["file_stationary", "file_rewind", "file_foreign"] {
        let mut child = spawn(mode);
        let started = Instant::now();
        let result = child.request(
            &file_request(),
            &[],
            Duration::from_millis(250),
            &AtomicBool::new(false),
            |_| {},
        );
        assert!(
            matches!(result, Err(WorkerError::Timeout)),
            "{mode} cannot renew an idle deadline: {result:?}"
        );
        assert!(!child.is_running(), "{mode} must be reaped after stalling");
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}

#[test]
fn window_requests_keep_an_absolute_deadline_despite_progress_events() {
    let mut child = spawn("file_advancing");
    let result = child.request(
        &request(),
        &[0.0; 2],
        Duration::from_millis(250),
        &AtomicBool::new(false),
        |_| {},
    );
    assert!(matches!(result, Err(WorkerError::Timeout)));
    assert!(!child.is_running());
}

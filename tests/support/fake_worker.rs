//! Deterministic child-process fixture. No native libraries, models or devices.
use std::io::{self, Read, Write};
use std::thread;
use std::time::Duration;

fn number(header: &str, field: &str) -> u64 {
    let key = format!("\"{field}\":");
    header
        .split_once(&key)
        .unwrap()
        .1
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .unwrap()
}

fn emit(id: u64, generation: u64, extra: &str) {
    println!("{{\"protocol\":1,\"id\":{id},\"job_generation\":{generation},{extra}}}");
    io::stdout().flush().unwrap();
}

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "success".into());
    if mode == "startup_hang" {
        thread::sleep(Duration::from_secs(30));
        return;
    }
    if mode == "startup_crash" {
        std::process::exit(19);
    }
    if mode == "startup_malformed" {
        println!("native diagnostic on stdout");
        return;
    }
    emit(0, 0, "\"kind\":\"Ready\",\"model\":null");
    let mut input = io::stdin().lock();
    loop {
        let mut length = [0; 4];
        if input.read_exact(&mut length).is_err() {
            return;
        }
        let length = u32::from_le_bytes(length) as usize;
        assert!(length <= 65_536);
        let mut header = vec![0; length];
        input.read_exact(&mut header).unwrap();
        let header = String::from_utf8(header).unwrap();
        let mut payload = vec![0; number(&header, "payload_bytes") as usize];
        input.read_exact(&mut payload).unwrap();
        let id = number(&header, "id");
        let generation = number(&header, "job_generation");
        if header.contains("\"kind\":\"Shutdown\"") {
            if mode == "shutdown_error" {
                emit(
                    id,
                    generation,
                    "\"kind\":\"Error\",\"code\":\"ShutdownFailed\",\"stage\":\"shutdown\",\"message\":\"not exited\"",
                );
                thread::sleep(Duration::from_secs(30));
            }
            return;
        }
        match mode.as_str() {
            "file_advancing" | "file_coverage" | "file_stationary" | "file_foreign"
            | "file_rewind" => {
                if mode == "file_rewind" {
                    emit(
                        id,
                        generation,
                        "\"kind\":\"Progress\",\"fraction\":0.1,\"stage\":\"processing\",\"processed_samples\":100",
                    );
                }
                for step in 1..=8 {
                    thread::sleep(Duration::from_millis(80));
                    if mode == "file_coverage" {
                        emit(
                            id,
                            generation,
                            &format!(
                                "\"kind\":\"NoSpeech\",\"coverage_start\":0,\"coverage_end\":{step},\"terminal\":false"
                            ),
                        );
                    } else {
                        let processed = if mode == "file_stationary" { 0 } else { step };
                        let (event_id, event_generation) = if mode == "file_foreign" {
                            if step % 2 == 0 {
                                (id + 1, generation)
                            } else {
                                (id, generation + 1)
                            }
                        } else {
                            (id, generation)
                        };
                        emit(
                            event_id,
                            event_generation,
                            &format!(
                                "\"kind\":\"Progress\",\"fraction\":0.5,\"stage\":\"processing-{step}\",\"processed_samples\":{processed}"
                            ),
                        );
                    }
                }
                emit(
                    id,
                    generation,
                    "\"kind\":\"NoSpeech\",\"coverage_start\":0,\"coverage_end\":8,\"terminal\":true",
                );
            }
            "wrong_coverage" => emit(
                id,
                generation,
                "\"kind\":\"NoSpeech\",\"coverage_start\":100,\"coverage_end\":102,\"terminal\":true",
            ),
            "partial_coverage" => emit(
                id,
                generation,
                "\"kind\":\"NoSpeech\",\"coverage_start\":0,\"coverage_end\":1,\"terminal\":true",
            ),
            "hang" => {
                thread::sleep(Duration::from_secs(30));
                return;
            }
            "crash" => std::process::exit(23),
            "malformed" => {
                println!("not a JSON event");
                io::stdout().flush().unwrap();
            }
            "truncated" => {
                print!("{{\"protocol\":1");
                io::stdout().flush().unwrap();
                return;
            }
            "oversized" => {
                let mut output = io::stdout().lock();
                output.write_all(&vec![b'x'; 1_048_577]).unwrap();
                output.write_all(b"\n").unwrap();
                output.flush().unwrap();
            }
            "stderr_spam" => {
                let mut error = io::stderr().lock();
                for _ in 0..4_096 {
                    error.write_all(&[b'd'; 1024]).unwrap();
                }
                error.flush().unwrap();
                emit(
                    id,
                    generation,
                    "\"kind\":\"NoSpeech\",\"coverage_start\":0,\"coverage_end\":2,\"terminal\":true",
                );
            }
            "stale" => {
                emit(
                    id,
                    generation.saturating_sub(1),
                    "\"kind\":\"NoSpeech\",\"coverage_start\":0,\"coverage_end\":2,\"terminal\":true",
                );
                emit(
                    id.saturating_sub(1),
                    generation,
                    "\"kind\":\"NoSpeech\",\"coverage_start\":0,\"coverage_end\":2,\"terminal\":true",
                );
                emit(
                    id,
                    generation,
                    "\"kind\":\"NoSpeech\",\"coverage_start\":0,\"coverage_end\":2,\"terminal\":true",
                );
            }
            "duplicate" => {
                for _ in 0..2 {
                    emit(
                        id,
                        generation,
                        "\"kind\":\"NoSpeech\",\"coverage_start\":0,\"coverage_end\":2,\"terminal\":true",
                    );
                }
            }
            "segments" => {
                emit(
                    id,
                    generation,
                    "\"kind\":\"Progress\",\"fraction\":0.5,\"stage\":\"processing\",\"processed_samples\":1",
                );
                emit(
                    id,
                    generation,
                    "\"kind\":\"Segments\",\"segments\":[{\"start_sample\":0,\"end_sample\":2,\"text\":\"Olá, reunião\"}],\"coverage_start\":0,\"coverage_end\":2,\"terminal\":true",
                );
            }
            _ => emit(
                id,
                generation,
                "\"kind\":\"NoSpeech\",\"coverage_start\":0,\"coverage_end\":2,\"terminal\":true",
            ),
        }
    }
}

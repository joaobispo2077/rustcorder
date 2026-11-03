#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--asr-worker") {
        if let Err(error) = rustcorder::transcription::worker::run() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
}

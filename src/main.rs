#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--asr-worker") {
        if let Err(error) = rustcorder::transcription::worker::run() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("rustcorder {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([1040.0, 880.0])
            .with_min_inner_size([760.0, 600.0]),
        ..Default::default()
    };
    if let Err(error) = eframe::run_native(
        "rustcorder",
        options,
        Box::new(|context| Ok(Box::new(rustcorder::ui::Desktop::new(context)))),
    ) {
        eprintln!("Cannot open rustcorder: {error}");
        std::process::exit(1);
    }
}

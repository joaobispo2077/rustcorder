#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--asr-worker") {
        if let Err(error) = rustcorder::transcription::worker::run() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([860.0, 850.0])
            .with_min_inner_size([640.0, 600.0]),
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

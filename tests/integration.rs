//! Native-boundary scenarios are registered here as implementation slices add them.
//! Ordinary unit tests must not require a microphone or large model files.

#[path = "integration/worker_protocol.rs"]
mod worker_protocol;

#[path = "integration/asr_feasibility.rs"]
mod asr_feasibility;
#[path = "integration/asr_speech_gate.rs"]
mod asr_speech_gate;
#[path = "integration/combined_recording.rs"]
mod combined_recording;
#[path = "integration/file_transcription.rs"]
mod file_transcription;
#[path = "integration/microphone_recording.rs"]
mod microphone_recording;

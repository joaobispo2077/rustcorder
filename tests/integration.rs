//! Native-boundary scenarios are registered here as implementation slices add them.
//! Ordinary unit tests must not require a microphone or large model files.

#[path = "integration/worker_protocol.rs"]
mod worker_protocol;

#[path = "integration/combined_recording.rs"]
mod combined_recording;
#[path = "integration/microphone_recording.rs"]
mod microphone_recording;

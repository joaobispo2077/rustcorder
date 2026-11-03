//! Synthetic live-job and recording-independence scenarios, without audio hardware.

use super::transcription_actions::{fake_command, folder, model, next, wait_finished};
use rustcorder::audio::LiveChunk;
use rustcorder::recording::{RecordingStatus, WavRecording};
use rustcorder::transcription::EventKind;
use rustcorder::transcription::jobs::{Job, JobEvent};
use std::time::{Duration, Instant};

#[test]
fn live_stop_flushes_short_tail_and_closes_collector() {
    let (job, input) = Job::live_with_command(
        model(),
        fake_command("live_success"),
        Duration::from_secs(1),
    );
    assert!(matches!(next(&job), JobEvent::Ready));
    input
        .send(LiveChunk {
            start_sample: 0,
            samples: vec![0.1; 100],
        })
        .unwrap();
    drop(input);
    let mut final_tail = false;
    loop {
        match next(&job) {
            JobEvent::Window {
                final_window: true,
                event:
                    EventKind::Segments {
                        coverage_start: 0,
                        coverage_end: 100,
                        ..
                    },
            } => final_tail = true,
            JobEvent::Finished {
                result: Ok(()),
                end: 100,
                gap: false,
            } => break,
            JobEvent::Finished { result, .. } => panic!("unexpected live result: {result:?}"),
            _ => {}
        }
    }
    assert!(final_tail);
    assert!(wait_finished(&job, Duration::from_secs(2)));
}

#[test]
fn a_stop_during_hung_inference_applies_the_independent_finalization_deadline() {
    let (job, input) = Job::live_with_command(
        model(),
        fake_command("live_hang"),
        Duration::from_millis(150),
    );
    assert!(matches!(next(&job), JobEvent::Ready));
    input
        .send(LiveChunk {
            start_sample: 0,
            samples: vec![0.1; 32_000],
        })
        .unwrap();
    assert!(matches!(
        next(&job),
        JobEvent::Window {
            event: EventKind::Progress { .. },
            ..
        }
    ));
    let stopped = Instant::now();
    drop(input);
    assert!(matches!(
        next(&job),
        JobEvent::Finished {
            result: Err(_),
            gap: true,
            ..
        }
    ));
    assert!(wait_finished(&job, Duration::from_secs(2)));
    assert!(
        stopped.elapsed() < Duration::from_secs(2),
        "finalization deadline must interrupt in-flight native work, not start after it returns"
    );
}

#[test]
fn crashed_live_worker_does_not_own_or_prevent_synthetic_audio_saving() {
    let mut audio = WavRecording::create(&folder()).unwrap();
    audio.append_pcm(&[200, -200, 400, -400]).unwrap();
    let (job, input) =
        Job::live_with_command(model(), fake_command("live_crash"), Duration::from_secs(1));
    assert!(matches!(next(&job), JobEvent::Ready));
    input
        .send(LiveChunk {
            start_sample: 0,
            samples: vec![0.1; 32_000],
        })
        .unwrap();
    assert!(matches!(
        next(&job),
        JobEvent::Finished {
            result: Err(_),
            gap: true,
            ..
        }
    ));
    assert!(wait_finished(&job, Duration::from_secs(2)));
    assert!(matches!(
        input.try_send(LiveChunk {
            start_sample: 32_000,
            samples: vec![0.0; 100]
        }),
        Err(std::sync::mpsc::TrySendError::Disconnected(_))
    ));
    audio.append_pcm(&[600, -600]).unwrap();
    let saved = audio.finalize(None);
    assert_eq!(saved.status, RecordingStatus::Completed);
    assert_eq!(saved.frames, 3);
    assert_eq!(
        hound::WavReader::open(saved.path)
            .unwrap()
            .samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .unwrap(),
        [200, -200, 400, -400, 600, -600]
    );
}

#[test]
fn user_cancel_stops_a_live_collector_even_while_capture_sender_is_retained() {
    let (job, input) = Job::live_with_command(
        model(),
        fake_command("live_success"),
        Duration::from_secs(1),
    );
    assert!(matches!(next(&job), JobEvent::Ready));
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
    assert!(matches!(
        input.try_send(LiveChunk {
            start_sample: 0,
            samples: vec![0.0; 100]
        }),
        Err(std::sync::mpsc::TrySendError::Disconnected(_))
    ));
}

#[test]
fn finalization_deadline_reaps_work_even_with_a_saturated_ui_queue() {
    let (job, input) = Job::live_with_command(
        model(),
        fake_command("file_spam"),
        Duration::from_millis(150),
    );
    assert!(matches!(next(&job), JobEvent::Ready));
    input
        .send(LiveChunk {
            start_sample: 0,
            samples: vec![0.1; 32_000],
        })
        .unwrap();
    std::thread::sleep(Duration::from_millis(350));
    drop(input);
    assert!(
        wait_finished(&job, Duration::from_secs(2)),
        "a blocked event publisher cannot bypass the post-Stop deadline"
    );
    let completed: Vec<_> = job
        .events
        .try_iter()
        .filter(|event| matches!(event, JobEvent::Finished { .. }))
        .collect();
    assert_eq!(completed.len(), 1);
    assert!(matches!(
        completed[0],
        JobEvent::Finished {
            result: Err(_),
            gap: true,
            ..
        }
    ));
}

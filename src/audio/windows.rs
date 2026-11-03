//! Windows clients are created, used and released on their owning capture thread.

use super::{AudioError, DeviceInfo, DeviceKind, decode_packet};
use ::windows::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
use ::windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR, IAudioCaptureClient,
};
use ::windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use ::windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL, WaitForSingleObject,
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, SyncSender},
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use wasapi::{DeviceEnumerator, DeviceState, Direction, SampleType, StreamMode, WaveFormat};

struct ComApartment;
impl ComApartment {
    fn new() -> Result<Self, AudioError> {
        wasapi::initialize_mta().ok().map_err(error)?;
        Ok(Self)
    }
}
impl Drop for ComApartment {
    fn drop(&mut self) {
        wasapi::deinitialize();
    }
}
fn error(value: impl std::fmt::Display) -> AudioError {
    AudioError(format!("Windows audio: {value}"))
}

pub fn enumerate() -> Result<Vec<DeviceInfo>, AudioError> {
    thread::Builder::new()
        .name("audio-devices".into())
        .spawn(enumerate_owned)
        .map_err(error)?
        .join()
        .map_err(|_| AudioError("Windows audio enumeration stopped unexpectedly".into()))?
}
fn enumerate_owned() -> Result<Vec<DeviceInfo>, AudioError> {
    // COM interfaces are created and released on this caller's owning thread.
    let _com = ComApartment::new()?;
    let enumerator = DeviceEnumerator::new().map_err(error)?;
    let mut devices = Vec::new();
    for (direction, kind) in [
        (Direction::Capture, DeviceKind::Microphone),
        (Direction::Render, DeviceKind::ComputerOutput),
    ] {
        let default_id = enumerator
            .get_default_device(&direction)
            .and_then(|device| device.get_id())
            .ok();
        let collection = enumerator
            .get_device_collection(&direction)
            .map_err(error)?;
        for index in 0..collection.get_nbr_devices().map_err(error)? {
            let device = collection.get_device_at_index(index).map_err(error)?;
            let id = device.get_id().map_err(error)?;
            devices.push(DeviceInfo {
                is_default: default_id.as_ref() == Some(&id),
                id,
                name: device.get_friendlyname().map_err(error)?,
                kind,
            });
        }
    }
    Ok(devices)
}

pub(super) fn now_hns() -> Result<u64, AudioError> {
    let (mut counter, mut frequency) = (0, 0);
    unsafe {
        QueryPerformanceFrequency(&mut frequency).map_err(error)?;
        QueryPerformanceCounter(&mut counter).map_err(error)?;
    }
    if counter < 0 || frequency <= 0 {
        return Err(AudioError("The Windows audio clock is unavailable".into()));
    }
    Ok((counter as u128 * 10_000_000 / frequency as u128) as u64)
}

pub(super) fn prioritize() {
    let _ = unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL) };
}

pub(super) enum Message {
    Packet {
        kind: DeviceKind,
        timestamp: u64,
        frames: Vec<[f32; 2]>,
    },
    Quiet(DeviceKind),
    Error(String),
}
pub(super) struct Source {
    pub ready: Receiver<Result<(), AudioError>>,
    pub trigger: SyncSender<()>,
    pub thread: JoinHandle<()>,
}
pub(super) fn spawn(
    kind: DeviceKind,
    id: String,
    packets: SyncSender<Message>,
    stop: Arc<AtomicBool>,
    fault: Arc<Mutex<Option<String>>>,
) -> Result<Source, AudioError> {
    let (ready_tx, ready) = mpsc::sync_channel(2);
    let (trigger, go) = mpsc::sync_channel(1);
    let thread = thread::Builder::new()
        .name(format!("audio-{kind:?}"))
        .spawn(move || {
            let result = capture(kind, &id, &packets, &stop, &ready_tx, go);
            if let Err(failure) = result {
                if let Ok(mut first) = fault.lock() {
                    first.get_or_insert_with(|| failure.0.clone());
                }
                let _ = ready_tx.try_send(Err(failure.clone()));
                // A full packet queue is already an interruption, never discard audio silently.
                let _ = packets.try_send(Message::Error(failure.0));
                stop.store(true, Ordering::Release);
            }
        })
        .map_err(error)?;
    Ok(Source {
        ready,
        trigger,
        thread,
    })
}

fn publish(sender: &SyncSender<Message>, message: Message) -> Result<(), AudioError> {
    sender.try_send(message).map_err(|_| {
        AudioError("Audio could not be saved fast enough; recording was interrupted".into())
    })
}

fn capture(
    kind: DeviceKind,
    id: &str,
    packets: &SyncSender<Message>,
    stop: &AtomicBool,
    ready: &SyncSender<Result<(), AudioError>>,
    go: Receiver<()>,
) -> Result<(), AudioError> {
    let _com = ComApartment::new()?;
    prioritize();
    let enumerator = DeviceEnumerator::new().map_err(error)?;
    // Keep this endpoint ID for the whole recording, including default-device changes.
    let device = enumerator.get_device(id).map_err(error)?;
    let direction = if kind == DeviceKind::Microphone {
        Direction::Capture
    } else {
        Direction::Render
    };
    if device.get_direction() != direction {
        return Err(AudioError(
            "The selected endpoint has the wrong audio source type".into(),
        ));
    }
    if device.get_state().map_err(error)? != DeviceState::Active {
        return Err(AudioError(
            "The selected audio source is unavailable".into(),
        ));
    }
    let mut client = device.get_iaudioclient().map_err(error)?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
    let (period, _) = client.get_device_period().map_err(error)?;
    client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: period.max(100_000),
            },
        )
        .map_err(error)?;
    let event = client.set_get_eventhandle().map_err(error)?;
    let raw: IAudioCaptureClient = unsafe { client.as_iaudioclient().GetService().map_err(error)? };
    ready.send(Ok(())).map_err(error)?;
    loop {
        if stop.load(Ordering::Acquire) {
            return Ok(());
        }
        match go.recv_timeout(Duration::from_millis(30)) {
            Ok(()) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => return Ok(()),
        }
    }
    client.start_stream().map_err(error)?;
    let result = (|| {
        ready.send(Ok(())).map_err(error)?;
        let mut first_packet = true;
        let mut quiet = false;
        let mut last_packet = Instant::now();
        let mut last_poll = Instant::now();
        loop {
            let stopping = stop.load(Ordering::Acquire);
            if stopping {
                client.stop_stream().map_err(error)?;
            }
            loop {
                if unsafe { raw.GetNextPacketSize().map_err(error)? } == 0 {
                    break;
                }
                let (mut pointer, mut frames, mut flags, mut position, mut timestamp) =
                    (std::ptr::null_mut(), 0, 0, 0, 0);
                unsafe {
                    raw.GetBuffer(
                        &mut pointer,
                        &mut frames,
                        &mut flags,
                        Some(&mut position),
                        Some(&mut timestamp),
                    )
                    .map_err(error)?;
                }
                // SILENT may legally return NULL. Always release the packet before queue work.
                let converted = if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                    decode_packet(&[], frames as usize, true)
                } else if pointer.is_null() {
                    Err(AudioError(
                        "Windows returned an empty non-silent audio buffer".into(),
                    ))
                } else {
                    decode_packet(
                        unsafe { std::slice::from_raw_parts(pointer, frames as usize * 8) },
                        frames as usize,
                        false,
                    )
                };
                unsafe {
                    raw.ReleaseBuffer(frames).map_err(error)?;
                }
                let converted = converted?;
                if flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 != 0 {
                    return Err(AudioError(
                        "The selected audio source lost its recording clock".into(),
                    ));
                }
                if flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0
                    && !first_packet
                    && !(kind == DeviceKind::ComputerOutput && quiet)
                {
                    return Err(AudioError(
                        "The selected audio source reported missing audio".into(),
                    ));
                }
                publish(
                    packets,
                    Message::Packet {
                        kind,
                        timestamp,
                        frames: converted,
                    },
                )?;
                first_packet = false;
                quiet = false;
                last_packet = Instant::now();
            }
            if stopping {
                break;
            }
            let waited = unsafe { WaitForSingleObject(event.as_handle(), 30) };
            // wasapi::Handle::wait_for_event also labels WAIT_FAILED as a timeout.
            if waited != WAIT_OBJECT_0 && waited != WAIT_TIMEOUT {
                return Err(AudioError(
                    "Windows could not wait for the selected audio source".into(),
                ));
            }
            if last_poll.elapsed() > Duration::from_millis(500) {
                return Err(AudioError(
                    "Recording was interrupted by sleep or an audio scheduling delay".into(),
                ));
            }
            last_poll = Instant::now();
            let idle_threshold = if kind == DeviceKind::ComputerOutput {
                30
            } else {
                100
            };
            if last_packet.elapsed() > Duration::from_millis(idle_threshold) {
                if device.get_state().map_err(error)? != DeviceState::Active {
                    return Err(AudioError(
                        "The selected audio source was disconnected or disabled".into(),
                    ));
                }
                if kind == DeviceKind::ComputerOutput && !quiet {
                    publish(packets, Message::Quiet(kind))?;
                    quiet = true;
                } else if kind == DeviceKind::Microphone
                    && last_packet.elapsed() > Duration::from_millis(500)
                {
                    return Err(AudioError(
                        "The selected microphone stopped delivering audio".into(),
                    ));
                }
            }
        }
        Ok(())
    })();
    let _ = client.stop_stream();
    result
}

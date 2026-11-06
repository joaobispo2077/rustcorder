use rustcorder::transcription::{EventKind, PROTOCOL_VERSION, read_event};
use std::fs;
use std::io;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

static SETTINGS_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct EmptySettings {
    root: PathBuf,
    parent: PathBuf,
}

impl EmptySettings {
    fn new() -> Self {
        let repository = fs::canonicalize(env!("CARGO_MANIFEST_DIR")).unwrap();
        let parent = repository.join(".build");
        fs::create_dir_all(&parent).unwrap();
        assert_eq!(fs::canonicalize(&parent).unwrap(), parent);
        let root = parent.join(format!(
            "binary-identity-{}-{}",
            std::process::id(),
            SETTINGS_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("each child gets a new empty settings directory");
        Self { root, parent }
    }
}

impl Drop for EmptySettings {
    fn drop(&mut self) {
        let resolved = fs::canonicalize(&self.root).expect("owned test settings directory");
        assert_eq!(resolved.parent(), Some(self.parent.as_path()));
        assert_eq!(resolved, self.root, "refuse redirected test cleanup");
        fs::remove_dir_all(&resolved).expect("remove only the verified owned settings directory");
    }
}

fn bounded_binary(arguments: &[&str], settings: &EmptySettings) -> io::Result<(Output, bool)> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_rustcorder"))
        .args(arguments)
        .env("LOCALAPPDATA", &settings.root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW: no auxiliary console.
        .spawn()?;
    let deadline = Instant::now() + Duration::from_secs(4);
    let timed_out = loop {
        match child.try_wait() {
            Ok(Some(_)) => break false,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                child.kill()?; // Only the process handle created above is terminated.
                break true;
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
    };
    Ok((child.wait_with_output()?, timed_out))
}

#[test]
fn version_reports_the_built_identity_without_gui_or_model_startup() {
    let settings = EmptySettings::new();
    let (output, timed_out) = bounded_binary(&["--version"], &settings).unwrap();
    assert!(
        !timed_out,
        "--version must exit within four seconds without opening the GUI; stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.status.success(),
        "version probe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        output.stdout,
        format!("rustcorder {}\n", env!("CARGO_PKG_VERSION")).as_bytes()
    );
    assert!(
        output.stderr.is_empty(),
        "version reporting must not initialize inference"
    );
    assert!(fs::read_dir(&settings.root).unwrap().next().is_none());
}

#[test]
fn asr_worker_dispatch_takes_precedence_over_a_later_version_argument() {
    let settings = EmptySettings::new();
    let (output, timed_out) = bounded_binary(&["--asr-worker", "--version"], &settings).unwrap();
    assert!(
        !timed_out,
        "worker must stop when its closed stdin reaches EOF"
    );
    assert!(
        output.status.success(),
        "worker failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut bytes = io::Cursor::new(output.stdout);
    let ready = read_event(&mut bytes)
        .unwrap()
        .expect("worker Ready handshake");
    assert_eq!(ready.protocol, PROTOCOL_VERSION);
    assert_eq!((ready.id, ready.job_generation), (0, 0));
    assert_eq!(ready.event, EventKind::Ready { model: None });
    assert!(read_event(&mut bytes).unwrap().is_none());
    assert!(fs::read_dir(&settings.root).unwrap().next().is_none());
}

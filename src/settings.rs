//! Local preferences only; model readiness and transcript contents are transient.

use crate::app::AppConfig;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub schema_version: u32,
    #[serde(default)]
    pub model_folder: Option<PathBuf>,
    #[serde(default)]
    pub config: AppConfig,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            model_folder: None,
            config: AppConfig::default(),
        }
    }
}

#[derive(Debug)]
pub enum SettingsError {
    MissingLocalAppData,
    InvalidPath,
    InvalidSchema,
    UnsupportedSchema(u64),
    Json(serde_json::Error),
    Io(io::Error),
}

impl From<io::Error> for SettingsError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serde_json::Error> for SettingsError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingLocalAppData => {
                f.write_str("LOCALAPPDATA is unavailable; a settings path cannot be selected")
            }
            Self::InvalidPath => f.write_str("The settings path must name a file"),
            Self::InvalidSchema => f.write_str("Settings must contain an integer schema_version"),
            Self::UnsupportedSchema(version) => write!(
                f,
                "Settings schema {version} is unsupported; expected version 1"
            ),
            Self::Json(error) => write!(f, "Settings JSON is invalid: {error}"),
            Self::Io(error) => write!(f, "Settings file operation failed: {error}"),
        }
    }
}

impl std::error::Error for SettingsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(error) => Some(error),
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

pub fn default_path() -> Result<PathBuf, SettingsError> {
    std::env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .map(|value| PathBuf::from(value).join("rustcorder/settings.json"))
        .ok_or(SettingsError::MissingLocalAppData)
}

pub fn load(path: &Path) -> Result<Settings, SettingsError> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Settings::default()),
        Err(error) => return Err(error.into()),
    };
    let value: serde_json::Value = serde_json::from_reader(file)?;
    let version = value
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .ok_or(SettingsError::InvalidSchema)?;
    if version != 1 {
        return Err(SettingsError::UnsupportedSchema(version));
    }
    Ok(serde_json::from_value(value)?)
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), SettingsError> {
    if settings.schema_version != 1 {
        return Err(SettingsError::UnsupportedSchema(
            settings.schema_version.into(),
        ));
    }
    let filename = path.file_name().ok_or(SettingsError::InvalidPath)?;
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut bytes = serde_json::to_vec_pretty(settings)?;
    bytes.push(b'\n');
    fs::create_dir_all(parent)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    for attempt in 0..32 {
        let mut temporary_name = std::ffi::OsString::from(".");
        temporary_name.push(filename);
        temporary_name.push(format!(".tmp-{}-{nonce}-{attempt}", std::process::id()));
        let temporary = parent.join(temporary_name);
        match replace_with(path, &temporary, |file| file.write_all(&bytes)) {
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            result => return result.map_err(SettingsError::Io),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Could not reserve a unique temporary settings file",
    )
    .into())
}

fn replace_with(
    path: &Path,
    temporary: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temporary)?;
    let result = write(&mut file).and_then(|()| file.sync_all());
    drop(file);
    // Same-directory rename replaces atomically on Windows after data is complete.
    let result = result.and_then(|()| fs::rename(temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{Controller, Language, ModelConfig, ModelState, RecordingMode};
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir(PathBuf, PathBuf);

    impl TestDir {
        fn new() -> Self {
            let parent = std::env::current_dir()
                .unwrap()
                .join("target/settings-tests");
            fs::create_dir_all(&parent).unwrap();
            for attempt in 0..32 {
                let nonce = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos();
                let path = parent.join(format!(
                    "rustcorder-settings-{}-{nonce}-{attempt}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path, parent),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("test directory creation failed: {error}"),
                }
            }
            panic!("test directory names exhausted")
        }

        fn file(&self) -> PathBuf {
            self.0.join("settings.json")
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            if self.0.parent() == Some(self.1.as_path())
                && self
                    .0
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("rustcorder-settings-"))
            {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }

    fn configured() -> Settings {
        Settings {
            schema_version: 1,
            model_folder: Some("C:/modelos de voz".into()),
            config: AppConfig {
                mode: RecordingMode::MicrophoneAndComputer,
                microphone_id: Some("mic-1".into()),
                output_id: Some("headphones-2".into()),
                save_folder: "C:/gravações".into(),
                live_transcription: true,
                model: Some(ModelConfig {
                    path: "C:/modelos de voz/ggml-base.bin".into(),
                    language: Language::Portuguese,
                }),
            },
        }
    }

    #[test]
    fn default_path_uses_current_local_app_data_without_mutating_environment() {
        match std::env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty()) {
            Some(value) => assert_eq!(
                default_path().unwrap(),
                PathBuf::from(value).join("rustcorder/settings.json")
            ),
            None => assert!(matches!(
                default_path(),
                Err(SettingsError::MissingLocalAppData)
            )),
        }
    }

    #[test]
    fn missing_file_returns_defaults_without_creating_a_file() {
        let dir = TestDir::new();
        assert_eq!(load(&dir.file()).unwrap(), Settings::default());
        assert!(!dir.file().exists());
    }

    #[cfg(windows)]
    #[test]
    fn directory_path_reports_non_not_found_io_error_and_preserves_contents() {
        let dir = TestDir::new();
        let path = dir.file();
        fs::create_dir(&path).unwrap();
        let sentinel = path.join("preserve.txt");
        fs::write(&sentinel, b"existing directory contents").unwrap();

        let result = load(&path);

        assert!(
            matches!(&result, Err(SettingsError::Io(error)) if error.kind() != io::ErrorKind::NotFound),
            "An existing directory must report its I/O error instead of loading defaults: {result:?}"
        );
        assert!(path.is_dir());
        assert_eq!(fs::read(&sentinel).unwrap(), b"existing directory contents");
        assert_eq!(fs::read_dir(&path).unwrap().count(), 1);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn corrupt_json_reports_error_and_preserves_original() {
        let dir = TestDir::new();
        fs::write(dir.file(), b"not json").unwrap();
        assert!(matches!(load(&dir.file()), Err(SettingsError::Json(_))));
        assert_eq!(fs::read(dir.file()).unwrap(), b"not json");
    }

    #[test]
    fn newer_schema_is_rejected_before_reading_unknown_config() {
        let dir = TestDir::new();
        let bytes = br#"{"schema_version":2,"config":"future-layout"}"#;
        fs::write(dir.file(), bytes).unwrap();
        assert!(matches!(
            load(&dir.file()),
            Err(SettingsError::UnsupportedSchema(2))
        ));
        assert_eq!(fs::read(dir.file()).unwrap(), bytes);
    }

    #[test]
    fn absent_or_noninteger_schema_is_not_silently_assumed() {
        let dir = TestDir::new();
        for bytes in [br#"{}"#.as_slice(), br#"{"schema_version":"1"}"#.as_slice()] {
            fs::write(dir.file(), bytes).unwrap();
            assert!(matches!(
                load(&dir.file()),
                Err(SettingsError::InvalidSchema)
            ));
        }
    }

    #[test]
    fn choices_round_trip_without_readiness_or_text() {
        let dir = TestDir::new();
        let expected = configured();
        save(&dir.file(), &expected).unwrap();
        assert_eq!(load(&dir.file()).unwrap(), expected);
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.file()).unwrap()).unwrap();
        assert_eq!(json["config"]["model"]["language"], "pt");
        assert_eq!(json["config"]["mode"], "microphone_and_computer");
        for key in [
            "readiness",
            "ready",
            "transcript",
            "audio",
            "capture",
            "transcription",
        ] {
            assert!(json.get(key).is_none());
            assert!(json["config"].get(key).is_none());
        }
        let app = Controller::new(load(&dir.file()).unwrap().config);
        assert_eq!(app.model(), &ModelState::NotConfigured);
    }

    #[test]
    fn existing_settings_are_replaced_with_a_complete_new_document() {
        let dir = TestDir::new();
        save(&dir.file(), &Settings::default()).unwrap();
        save(&dir.file(), &configured()).unwrap();
        assert_eq!(load(&dir.file()).unwrap(), configured());
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn failed_temporary_write_preserves_old_bytes_and_removes_owned_temporary() {
        let dir = TestDir::new();
        fs::write(dir.file(), b"old settings").unwrap();
        let temporary = dir.0.join("chosen.tmp");
        let result = replace_with(&dir.file(), &temporary, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("injected disk-full error"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(dir.file()).unwrap(), b"old settings");
        assert!(!temporary.exists());
    }

    #[test]
    fn temporary_collision_never_overwrites_or_deletes_an_existing_file() {
        let dir = TestDir::new();
        let temporary = dir.0.join("chosen.tmp");
        fs::write(dir.file(), b"old settings").unwrap();
        fs::write(&temporary, b"another writer owns this").unwrap();
        let result = replace_with(&dir.file(), &temporary, |file| {
            file.write_all(b"new settings")
        });
        assert!(matches!(result, Err(ref error) if error.kind() == io::ErrorKind::AlreadyExists));
        assert_eq!(fs::read(dir.file()).unwrap(), b"old settings");
        assert_eq!(fs::read(temporary).unwrap(), b"another writer owns this");
    }

    #[cfg(windows)]
    #[test]
    fn windows_failed_replace_preserves_readonly_destination() {
        let dir = TestDir::new();
        fs::write(dir.file(), b"old settings").unwrap();
        let original_permissions = fs::metadata(dir.file()).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(dir.file(), permissions.clone()).unwrap();
        let result = save(&dir.file(), &configured());
        let remaining = fs::read(dir.file()).unwrap();
        fs::set_permissions(dir.file(), original_permissions).unwrap();
        assert!(matches!(result, Err(SettingsError::Io(_))));
        assert_eq!(remaining, b"old settings");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn unsupported_schema_is_never_saved_over_existing_data() {
        let dir = TestDir::new();
        fs::write(dir.file(), b"old settings").unwrap();
        let settings = Settings {
            schema_version: 2,
            ..Settings::default()
        };
        assert!(matches!(
            save(&dir.file(), &settings),
            Err(SettingsError::UnsupportedSchema(2))
        ));
        assert_eq!(fs::read(dir.file()).unwrap(), b"old settings");
    }

    #[test]
    fn creates_parent_directory_and_retains_unicode_paths() {
        let dir = TestDir::new();
        let path = dir.0.join("configuração/settings.json");
        save(&path, &configured()).unwrap();
        assert_eq!(load(&path).unwrap(), configured());
    }
}

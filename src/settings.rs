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

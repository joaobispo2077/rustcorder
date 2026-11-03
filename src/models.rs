//! Candidate discovery is local; only the inference child validates model bytes.
use crate::app::Language;
use crate::transcription::ModelMetadata;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelCandidate {
    pub path: PathBuf,
    pub display_name: String,
}

pub fn discover_models(folder: &Path) -> io::Result<Vec<ModelCandidate>> {
    const NAMES: [&str; 4] = [
        "ggml-base.bin",
        "ggml-small.bin",
        "ggml-base.en.bin",
        "ggml-small.en.bin",
    ];
    let folder = folder.canonicalize()?;
    let entries = std::fs::read_dir(&folder)?;
    let mut candidates = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        if NAMES.iter().any(|allowed| name == *allowed) && entry.file_type()?.is_file() {
            candidates.push(ModelCandidate {
                path: entry.path(),
                display_name: name.to_string_lossy().into_owned(),
            });
        }
    }
    candidates.sort_by_key(|entry| {
        NAMES
            .iter()
            .position(|name| *name == entry.display_name)
            .unwrap()
    });
    Ok(candidates)
}

pub fn supported_languages(metadata: &ModelMetadata) -> Result<Vec<Language>, String> {
    if !matches!(metadata.family.as_str(), "base" | "small") {
        return Err("Choose a compatible GGML base or small model".into());
    }
    Ok(if metadata.multilingual {
        vec![Language::Portuguese, Language::English]
    } else {
        vec![Language::English]
    })
}

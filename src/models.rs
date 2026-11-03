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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn folder() -> PathBuf {
        static ID: AtomicU64 = AtomicU64::new(0);
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/model-tests")
            .join(format!(
                "{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                ID.fetch_add(1, Ordering::Relaxed)
            ));
        std::fs::create_dir_all(&path).unwrap();
        path.canonicalize().unwrap()
    }

    #[test]
    fn discovery_is_immediate_supported_files_only_and_deterministic() {
        let root = folder();
        for name in [
            "ggml-small.bin",
            "ggml-base.en.bin",
            "unknown.bin",
            "ggml-base.bin",
        ] {
            std::fs::write(root.join(name), b"candidate, not validated weights").unwrap();
        }
        std::fs::create_dir(root.join("ggml-small.en.bin")).unwrap();
        std::fs::create_dir(root.join("nested")).unwrap();
        std::fs::write(root.join("nested/ggml-small.en.bin"), b"ignored").unwrap();
        let found = discover_models(&root).unwrap();
        assert_eq!(
            found
                .iter()
                .map(|item| item.display_name.as_str())
                .collect::<Vec<_>>(),
            ["ggml-base.bin", "ggml-small.bin", "ggml-base.en.bin"]
        );
        assert!(
            found
                .iter()
                .all(|item| item.path.is_absolute() && item.path.parent() == Some(root.as_path()))
        );
    }

    #[test]
    fn invalid_folder_fails_and_empty_folder_has_no_candidates() {
        let root = folder();
        assert!(discover_models(&root).unwrap().is_empty());
        assert!(discover_models(&root.join("missing")).is_err());
        std::fs::write(root.join("file"), b"not a directory").unwrap();
        assert!(discover_models(&root.join("file")).is_err());
    }

    #[test]
    fn detected_metadata_not_filename_controls_languages() {
        assert_eq!(
            supported_languages(&ModelMetadata {
                family: "base".into(),
                multilingual: true
            })
            .unwrap(),
            [Language::Portuguese, Language::English]
        );
        assert_eq!(
            supported_languages(&ModelMetadata {
                family: "small".into(),
                multilingual: false
            })
            .unwrap(),
            [Language::English]
        );
        assert!(
            supported_languages(&ModelMetadata {
                family: "large-v3".into(),
                multilingual: true
            })
            .is_err()
        );
    }
}

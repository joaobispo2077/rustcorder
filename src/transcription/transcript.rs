//! Stable text, replaceable live tail, and non-overwriting UTF-8 export.

use super::Segment;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::Path;

#[derive(Clone, Debug, Default)]
pub struct Transcript {
    stable: Vec<Segment>,
    pending: Vec<Segment>,
    stable_boundary: u64,
    covered_until: u64,
    incomplete: Option<String>,
    finished: bool,
    saved: bool,
}

impl Transcript {
    pub fn apply(&mut self, segments: Vec<Segment>, start: u64, end: u64, final_window: bool) {
        if self.finished || end < self.covered_until {
            return;
        }
        if start > self.covered_until {
            self.fail("Some audio was not transcribed; transcribe the saved recording to retry.");
        }
        self.covered_until = self.covered_until.max(end);
        let previous = std::mem::take(&mut self.pending);
        // Preserve an earlier tail that the new window no longer contains.
        for segment in previous.into_iter().filter(|s| s.start_sample < start) {
            self.commit(segment);
        }
        let cutoff = if final_window {
            end
        } else {
            end.saturating_sub(32_000)
        };
        for segment in segments {
            if segment.end_sample <= self.stable_boundary {
                continue;
            }
            if segment.end_sample <= cutoff {
                self.commit(segment);
            } else {
                self.pending.push(segment);
            }
        }
        if final_window {
            self.stable_boundary = self.stable_boundary.max(end);
        }
    }
    fn commit(&mut self, mut segment: Segment) {
        if segment.end_sample <= self.stable_boundary {
            return;
        }
        if let Some(last) = self.stable.last()
            && segment.start_sample < last.end_sample
        {
            let old: Vec<_> = self
                .stable
                .iter()
                .filter(|s| s.end_sample > segment.start_sample)
                .flat_map(|s| s.text.split_whitespace())
                .collect();
            let new: Vec<_> = segment.text.split_whitespace().collect();
            let normalize = |s: &str| {
                s.trim_matches(|c: char| !c.is_alphanumeric())
                    .to_lowercase()
            };
            let overlap = (1..=old.len().min(new.len()))
                .rev()
                .find(|&n| {
                    old[old.len() - n..]
                        .iter()
                        .zip(&new[..n])
                        .all(|(a, b)| normalize(a) == normalize(b))
                })
                .unwrap_or(0);
            segment.text = new[overlap..].join(" ");
        }
        self.stable_boundary = self.stable_boundary.max(segment.end_sample);
        if !segment.text.trim().is_empty() {
            self.stable.push(segment);
            self.saved = false;
        }
    }
    pub fn fail(&mut self, reason: impl Into<String>) {
        self.incomplete.get_or_insert_with(|| reason.into());
    }
    pub fn finish(&mut self, expected_end: u64) {
        if self.covered_until < expected_end {
            self.fail("The final audio tail was not transcribed.");
        } else {
            for segment in std::mem::take(&mut self.pending) {
                self.commit(segment);
            }
        }
        self.finished = true;
    }
    pub fn stable_text(&self) -> String {
        self.stable
            .iter()
            .map(|s| s.text.trim())
            .collect::<Vec<_>>()
            .join(" ")
    }
    pub fn pending_text(&self) -> String {
        self.pending
            .iter()
            .map(|s| s.text.trim())
            .collect::<Vec<_>>()
            .join(" ")
    }
    pub fn export_text(&self) -> String {
        let text = self.stable_text();
        if self.is_incomplete() || !self.finished {
            format!(
                "[INCOMPLETE TRANSCRIPT]\n{}\n\n{text}\n",
                self.reason()
                    .unwrap_or("Transcription is still running; only finalized text is included.")
            )
        } else {
            format!("{text}\n")
        }
    }
    pub fn is_incomplete(&self) -> bool {
        self.incomplete.is_some()
    }
    pub fn reason(&self) -> Option<&str> {
        self.incomplete.as_deref()
    }
    pub fn unsaved(&self) -> bool {
        !self.saved && !self.stable.is_empty()
    }
    pub fn save_new(&mut self, path: &Path) -> io::Result<()> {
        let mut output = OpenOptions::new().write(true).create_new(true).open(path)?;
        output.write_all(self.export_text().as_bytes())?;
        output.sync_all()?;
        self.saved = true;
        Ok(())
    }
}

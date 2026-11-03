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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_failure_reason_survives_later_cleanup_errors() {
        let mut t = Transcript::default();
        t.fail("audio conversion failed");
        t.fail("worker cancelled");
        assert_eq!(t.reason(), Some("audio conversion failed"));
    }
    #[test]
    fn overlap_across_several_committed_segments_deduplicates_once() {
        let mut t = Transcript::default();
        t.apply(
            vec![
                segment(0, 20_000, "um dois"),
                segment(20_000, 40_000, "três quatro"),
            ],
            0,
            80_000,
            false,
        );
        t.apply(
            vec![segment(10_000, 60_000, "dois três quatro cinco")],
            10_000,
            100_000,
            true,
        );
        assert_eq!(t.stable_text(), "um dois três quatro cinco");
    }
    fn segment(start: u64, end: u64, text: &str) -> Segment {
        Segment {
            start_sample: start,
            end_sample: end,
            text: text.into(),
        }
    }
    #[test]
    fn final_file_segments_keep_unicode() {
        let mut t = Transcript::default();
        t.apply(vec![segment(0, 100, "Olá, ação!")], 0, 100, true);
        t.finish(100);
        assert_eq!(t.stable_text(), "Olá, ação!");
        assert!(!t.is_incomplete());
    }
    #[test]
    fn live_tail_is_replaced_without_touching_stable_words() {
        let mut t = Transcript::default();
        t.apply(
            vec![
                segment(0, 40_000, "primeira frase"),
                segment(70_000, 100_000, "pendente"),
            ],
            0,
            128_000,
            false,
        );
        assert_eq!(t.stable_text(), "primeira frase");
        assert_eq!(t.pending_text(), "pendente");
        t.apply(
            vec![
                segment(70_000, 100_000, "corrigida"),
                segment(110_000, 150_000, "última"),
            ],
            32_000,
            160_000,
            false,
        );
        assert_eq!(t.stable_text(), "primeira frase corrigida");
        assert_eq!(t.pending_text(), "última");
    }
    #[test]
    fn overlapping_replayed_words_do_not_duplicate_stable_text() {
        let mut t = Transcript::default();
        t.apply(vec![segment(0, 64_000, "um dois três")], 0, 128_000, false);
        t.apply(
            vec![segment(50_000, 110_000, "três quatro cinco")],
            32_000,
            160_000,
            true,
        );
        assert_eq!(t.stable_text(), "um dois três quatro cinco");
    }
    #[test]
    fn actual_repeated_phrase_at_later_time_is_preserved() {
        let mut t = Transcript::default();
        t.apply(vec![segment(0, 10_000, "sim sim")], 0, 80_000, false);
        t.apply(
            vec![segment(90_000, 100_000, "sim sim")],
            80_000,
            120_000,
            true,
        );
        assert_eq!(t.stable_text(), "sim sim sim sim");
    }
    #[test]
    fn silence_establishes_coverage_without_words() {
        let mut t = Transcript::default();
        t.apply(vec![], 0, 32_000, true);
        t.finish(32_000);
        assert_eq!(t.covered_until, 32_000);
        assert!(!t.is_incomplete());
    }
    #[test]
    fn gaps_remain_incomplete_after_later_success() {
        let mut t = Transcript::default();
        t.apply(vec![segment(50, 100, "depois")], 50, 100, true);
        t.finish(100);
        assert!(t.is_incomplete());
        assert!(t.export_text().contains("INCOMPLETE"));
        assert!(t.export_text().contains("depois"));
    }
    #[test]
    fn final_tail_failure_retains_only_finalized_words() {
        let mut t = Transcript::default();
        t.apply(
            vec![
                segment(0, 40_000, "seguro"),
                segment(100_000, 120_000, "revisável"),
            ],
            0,
            128_000,
            false,
        );
        t.fail("worker exited");
        assert!(t.export_text().contains("seguro"));
        assert!(!t.export_text().contains("revisável"));
        assert!(t.is_incomplete());
    }
    #[test]
    fn finalizing_an_uncovered_tail_cannot_claim_complete() {
        let mut t = Transcript::default();
        t.apply(vec![], 0, 100, false);
        t.finish(101);
        assert!(t.is_incomplete());
    }
    #[test]
    fn stale_window_does_not_rewind_boundary_or_restore_pending() {
        let mut t = Transcript::default();
        t.apply(vec![segment(0, 100, "final")], 0, 100, true);
        t.apply(vec![segment(0, 50, "stale")], 0, 50, false);
        assert_eq!(t.stable_text(), "final");
        assert!(t.pending_text().is_empty());
    }
}

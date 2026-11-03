//! Bounded latest-window scheduling; capture never waits for inference.

use std::collections::VecDeque;

pub const WINDOW_SAMPLES: usize = 128_000;
pub const STRIDE_SAMPLES: u64 = 32_000;

#[derive(Clone, Debug)]
pub struct Window {
    pub start: u64,
    pub samples: Vec<f32>,
    pub final_window: bool,
}
impl Window {
    pub fn end(&self) -> u64 {
        self.start + self.samples.len() as u64
    }
}

#[derive(Default)]
pub struct Scheduler {
    samples: VecDeque<f32>,
    end: u64,
    scheduled: u64,
    pending: Option<Window>,
    pub gap: bool,
}
impl Scheduler {
    pub fn push(&mut self, start: u64, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        if start != self.end {
            self.gap = true;
            self.samples.clear();
        }
        self.end = start.saturating_add(samples.len() as u64);
        self.samples.extend(samples.iter().copied());
        let excess = self.samples.len().saturating_sub(WINDOW_SAMPLES);
        self.samples.drain(..excess);
        if self.end.saturating_sub(self.scheduled) >= STRIDE_SAMPLES {
            self.schedule(false);
        }
    }
    fn schedule(&mut self, final_window: bool) {
        if self.samples.is_empty() {
            return;
        }
        self.pending = Some(Window {
            start: self.end - self.samples.len() as u64,
            samples: self.samples.iter().copied().collect(),
            final_window,
        });
        self.scheduled = self.end;
    }
    pub fn finish(&mut self) {
        self.schedule(true);
    }
    pub fn take(&mut self) -> Option<Window> {
        self.pending.take()
    }
    pub fn end(&self) -> u64 {
        self.end
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn emits_after_stride_and_uses_absolute_offsets() {
        let mut s = Scheduler::default();
        s.push(0, &vec![0.0; 32_000]);
        let w = s.take().unwrap();
        assert_eq!((w.start, w.end()), (0, 32_000));
    }
    #[test]
    fn replaces_pending_and_bounds_memory_to_eight_seconds() {
        let mut s = Scheduler::default();
        for i in 0..100 {
            s.push(i * 16_000, &vec![0.5; 16_000]);
        }
        let w = s.take().unwrap();
        assert_eq!(w.samples.len(), WINDOW_SAMPLES);
        assert_eq!(w.end(), 1_600_000);
        assert!(s.take().is_none());
        assert!(s.samples.len() <= WINDOW_SAMPLES);
    }
    #[test]
    fn reports_dropped_capture_branch_samples() {
        let mut s = Scheduler::default();
        s.push(0, &vec![0.0; 16_000]);
        s.push(32_000, &vec![0.0; 32_000]);
        assert!(s.gap);
        assert_eq!(s.take().unwrap().start, 32_000);
    }
    #[test]
    fn stop_schedules_short_final_tail_without_new_audio() {
        let mut s = Scheduler::default();
        s.push(0, &vec![0.0; 100]);
        s.finish();
        let w = s.take().unwrap();
        assert!(w.final_window);
        assert_eq!(w.end(), 100);
    }
    #[test]
    fn empty_capture_has_no_inference_request() {
        let mut s = Scheduler::default();
        s.finish();
        assert!(s.take().is_none());
    }
}

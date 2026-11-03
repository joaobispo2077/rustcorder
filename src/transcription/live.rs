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

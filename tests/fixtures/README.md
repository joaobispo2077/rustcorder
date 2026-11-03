# Test fixtures

Cheap unit tests generate short PCM arrays and synthetic files in temporary
directories. They must not use a microphone, model download or internet connection.
Integration scenarios are registered through `tests/integration.rs`, not merely
placed in a nested directory. Real-device/model checks are separately invoked.

Large weights, private recordings and downloaded corpus audio stay outside Git.
The approved development models are under ignored `models/`; local test-corpus
files and manifests belong under ignored `.build/fixtures/`. The packaged app
contains no model/corpus downloader.

## Reference speech

Development corpus preparation uses Google FLEURS validation subsets `pt_br` and
`en_us`, with deterministic row selection totaling at least ten minutes each.
Source: [Google FLEURS](https://huggingface.co/datasets/google/fleurs),
licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Attribution: Google FLEURS contributors, as identified in the dataset card and
linked source material. Preserve corpus revision, subset/split, row identity,
sample counts, reference text and file SHA-256 in the local manifest.

Corpus reference transcripts are supplied by the dataset; they are not claimed
to have been independently audited by this agent. Spot-check recordings/references
before claiming human-checked product acceptance. Do not treat synthetic silence
or a short phrase as a substitute for the full reference set.

For reproducible word-error measurements, normalize both reference and prediction
to Unicode NFC, lowercase, replace punctuation with spaces, and collapse whitespace.
Preserve accents and the written form of digits; do not silently rewrite numbers
to improve scores. Compute total word edits divided by total reference words over
the declared set, not the unweighted mean of per-clip percentages. Report insertions
for speech-free fixtures separately rather than divide by a zero reference count.

Every recorded benchmark includes the model hash, selected language, CPU/RAM,
thread count, native build and relevant capture device/rate information.

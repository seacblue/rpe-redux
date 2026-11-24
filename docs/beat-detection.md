# Beat detection: fixed BPM and offset

- Status: current
- Scope: automatic fixed-BPM timing detection and one fixed offset
- Related: [Architecture](./architecture.md), [Testing](./testing.md)

## Runtime path

The editor always returns one fixed BPM and one offset. The worker combines the deterministic TypeScript detector with the project-trained ONNX beat-evidence model. The model ranks beat evidence; the deterministic path performs the fixed-grid search and raw-attack refit that supplies the final sub-frame offset. If model loading fails, the deterministic detector remains the fallback.

| Stage | Owner | Contract |
| --- | --- | --- |
| Onset and fixed-grid candidates | `src/core/media/beatDetection.ts` | One fixed-tempo candidate |
| Learned beat evidence | `learnedBeatDetector.ts` | Frame-level beat logits |
| Alias-resistant grid scoring | `learnedBeatDetector.ts` | Penalises half- and third-beat leakage |
| Attack refit | `src/core/media/beatDetection.ts` | Continuous BPM and offset refinement |
| Application | timing-detection worker | Writes one `[0, 0, 1]` timing entry |

The model frontend uses mono PCM resampled to 22050 Hz, a 1024-point periodic Hann window, a 441-sample hop, 128 Slaney mel bins, and `log1p(1000 * energy)`. The browser implementation mirrors the training frontend in TypeScript.

## Accuracy result

The current model was trained by `scripts/trainFixedBeatModel.py` for 900 optimization steps. The validation set contains 256 independently generated fixed-tempo examples spanning 70–240 BPM. The result is measured before the raw-attack refit, so it isolates the learned evidence and grid scorer.

| Metric                     |    Result |
| -------------------------- | --------: |
| Median absolute BPM error  | 0.151 BPM |
| P95 absolute BPM error     | 0.346 BPM |
| Maximum absolute BPM error | 1.033 BPM |
| Frame precision            |     0.992 |
| Frame recall               |     0.987 |
| Frame F1                   |     0.990 |

The decisive stability measure is the subdivision leakage penalty. In addition to the usual half-beat check, the scorer samples the one-third and two-thirds positions between candidate beats. This prevents a candidate that only touches every third real beat from tying the correct grid. The user does not select a detector or tempo level; the worker returns the strongest fixed result.

## Precision and limits

Raw attacks are fitted after the grid is selected. The fitted period is kept at continuous precision and the public result is rounded only for display. Offset is the fitted beat-zero time, not the first analysis-frame timestamp.

The feature intentionally does not infer tempo changes, time signatures, or downbeat intent. A track with changing tempo receives the best single fixed BPM the signal supports, because the product contract is one BPM and one offset.

The model artifact is `src/public/assets/redux/models/rpe_fixed_beat.onnx`. The training program is kept in the repository so the result can be reproduced without bundling training material.

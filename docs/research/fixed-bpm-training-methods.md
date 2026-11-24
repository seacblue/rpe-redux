# Fixed-BPM model training

This document records the current self-contained training method. The model is not a tempo-map predictor: it learns frame-level evidence for one steady beat grid, while the runtime remains responsible for selecting one BPM and one offset.

## Generated training task

Each batch is generated at 22050 Hz with a random fixed BPM between 70 and 240, a random phase, per-beat accents, short transients, a quiet periodic bed, and controlled noise. The label is a Gaussian pulse around every beat on the 50 FPS analysis grid. The generator never emits a tempo change or meter label.

The frontend is a 1024-point periodic-Hann spectrogram with a 441-sample hop, 128 Slaney mel bins from 30 to 11000 Hz, and a logarithmic magnitude transform. The browser frontend implements the same calculation in TypeScript.

## Model and objective

The model is a compact 1-D convolutional network over time-major log-mel features. Its output is one beat logit per analysis frame. Training uses weighted binary cross-entropy so the narrow beat targets are not drowned out by negative frames. The optimizer, seed, batch size, and step count are explicit in `scripts/trainFixedBeatModel.py`.

## Deterministic selection

At runtime, candidate BPM and phase grids are scored against the learned activation. The score rewards activation on the candidate beats and penalises activation at half-beat, one-third-beat, and two-thirds-beat positions. The extra subdivision checks are important: a grid that visits every third true beat can otherwise tie a correct grid when only the mean activation is used.

The winning grid is refined against raw attacks. This produces the continuous BPM and beat-zero offset used by the editor. The worker does not expose a model choice, a tempo-level choice, or a variable-tempo result.

## Current training result

The current run used 900 optimization steps and a fixed validation seed. It evaluated 256 independently generated fixed-tempo examples:

| Metric                     |    Result |
| -------------------------- | --------: |
| Median absolute BPM error  | 0.151 BPM |
| P95 absolute BPM error     | 0.346 BPM |
| Maximum absolute BPM error | 1.033 BPM |
| Frame precision            |     0.992 |
| Frame recall               |     0.987 |
| Frame F1                   |     0.990 |

The maximum is just above the one-BPM target, so this result is treated as a strong current baseline rather than a guarantee for every possible recording. The next useful improvement is more varied self-generated timbre and duration augmentation, not adding an external corpus to the shipped project.

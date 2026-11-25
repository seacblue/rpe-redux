# BPM and offset algorithm study

Status: current

## Current decision

The product emits one fixed BPM and one offset. The detector does not infer tempo changes, time signatures, or downbeat intent.

The implementation is original TypeScript and uses a project-trained ONNX beat-evidence model. The runtime keeps the existing deterministic onset and attack-refit path as the source of final timing precision. The model is only a learned evidence signal, so failure to load it safely falls back to the local detector.

## Implemented pipeline

1. Decode the signal once and build a mono analysis buffer.
2. Run the deterministic fixed-grid detector.
3. Run the project-trained frame-level beat model.
4. Score fixed BPM/phase candidates with half- and third-beat leakage checks.
5. Refit the winning grid against raw attacks.
6. Return one BPM/offset result and write one fixed timing entry.

## Training result

The model was trained for 900 steps and evaluated on 256 held-out generated fixed-tempo examples:

| Metric                     |    Result |
| -------------------------- | --------: |
| Median absolute BPM error  | 0.151 BPM |
| P95 absolute BPM error     | 0.346 BPM |
| Maximum absolute BPM error | 1.033 BPM |
| Frame precision            |     0.992 |
| Frame recall               |     0.987 |
| Frame F1                   |     0.990 |

The shipped project contains only the reproducible generator/trainer, validation code, and the ONNX weight artifact. No generated media, feature arrays, or label files are packaged.

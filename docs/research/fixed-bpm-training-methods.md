<!-- Compare trainable beat-tracking approaches and select a deployable fixed-BPM pipeline. -->

# Fixed BPM Training Methods

## Executive summary

The current failure is not caused by insufficient numerical precision. The raw-attack fit can already recover fractional BPM and sub-millisecond phase on clean signals. The remaining failures are metrical-level and near-tempo selection errors: the signal contains enough periodic energy for several plausible grids, and a handcrafted onset envelope cannot always decide which grid is the intended beat.

The recommended training method is therefore not direct BPM regression from waveform samples. Use a pretrained frame-level beat model as a learned evidence source, generate several fixed-tempo/phase candidates, train a small candidate-ranking model with hard near-tempo and half/double-time negatives, and keep the existing continuous robust fit as the numerical measurement stage. The ranker should also output a calibrated confidence. If independent windows and evidence sources do not agree, the product should return “not found” rather than silently publish a wrong BPM.

The most practical teacher is Beat This. Its paper reports a shift-tolerant loss and a convolution/Transformer architecture designed to predict beats without DBN post-processing; the official repository publishes code and weights under MIT, while noting that the training audio can have separate copyright restrictions [1][2][3]. The browser deployment target can be an ONNX Runtime Web model, with a small distilled student rather than the full teacher [4][5].

## Scope and assumptions

This plan targets fixed BPM only. It does not infer tempo changes or time signatures. “Offset” means the intercept of one fixed beat line in the decoded audio. A public preview may be trimmed or transcoded, so preview offset is not a valid proxy for a chart's original audio offset.

The model must be trained and evaluated against mapset-disjoint data. The same song, remix, or chart family must not occur in both train and test. Audio used for training must be legally distributable to the training environment; osu! downloads are suitable for local evaluation when permitted, but should not be redistributed as part of model artifacts.

## Findings

### 1. Use learned beat evidence, not a direct BPM regressor

Beat tracking research identifies tempo-octave errors as a persistent problem, and continuous speed evidence is specifically useful for choosing the tempo octave [6]. A scalar regression target such as `BPM = 192.0` hides the ambiguity: two grids can have similar waveform loss while representing different metrical levels. A frame-level beat posterior preserves the evidence needed to compare those grids.

Beat This is a strong starting teacher because it was trained across heterogeneous material and uses a shift-tolerant binary cross-entropy objective rather than requiring every annotation to land on one exact frame [1][2][3]. BeatNet is a viable alternative if joint beat/downbeat/tempo/meter tracking is needed, and its official repository includes a training pipeline [7]. For this product, Beat This is the better first experiment because the requested output is fixed BPM and offset, not meter inference.

### 2. Train a candidate ranker around the existing detector

The decisive model should rank explicit hypotheses rather than regress one number:

```text
audio
  -> learned beat activation
  -> autocorrelation / DBN / learned-activation candidates
  -> candidate features: BPM, phase, octave, window agreement, coverage,
     activation concentration, residual spread, and cross-band support
  -> small ranker
  -> continuous robust period/phase fit
  -> calibrated confidence or no-result
```

For each audio segment, construct a positive candidate from the chart's fixed timing and hard negatives at the following locations: ±0.5%, ±1%, ±2%, ±4% tempo, and exact half/double tempo. Include phase-shifted negatives and candidates that fit one short window but fail on the rest of the track. This directly trains the failure mode observed in the current osu! corpus: a plausible near-tempo grid must lose when the full-track evidence is considered.

A small MLP or gradient-boosted ranker is sufficient for the first experiment. Its input is the candidate feature vector, not raw audio. This keeps the learned part small, makes the decision inspectable, and lets the TypeScript detector continue to own the final continuous BPM and offset measurement.

### 3. Use a multi-objective training loss

The first training target should have four terms:

1. **Beat activation:** shift-tolerant BCE or a soft triangular/Gaussian target around each annotated beat. Beat This publishes an implementation of the shift-tolerant BCE loss [3].
2. **Fixed-grid ranking:** listwise or pairwise ranking loss where the chart grid must beat near-tempo, half-time, double-time, and phase-shifted negatives.
3. **Continuous measurement:** robust loss on log-period and phase after fitting the selected candidate. Use log-period for tempo so the same relative error is treated consistently at 80 and 240 BPM.
4. **Confidence calibration:** a binary loss for “safe to publish” versus “ambiguous.” Hard ambiguous examples should be labelled as reject, not forced into an incorrect BPM class.

Knowledge distillation can transfer the teacher's frame-level posterior and candidate ordering into a much smaller student; the standard PyTorch distillation recipe uses softened teacher probabilities together with the hard target [8]. This is appropriate after the ranker works, not before.

### 4. Build the data in three layers

**Layer A — public annotated pretraining.** Start with the datasets and annotations used by Beat This, plus Ballroom, Hainsworth, SMC, Beatles, and other datasets whose audio terms permit the training use. Ballroom provides short excerpts with a stable dance tempo; Hainsworth and SMC are valuable because they contain expressive and ambiguous material. Use the official evaluation conventions rather than treating every annotation as equally unambiguous [1][9].

**Layer B — exact synthetic supervision.** Generate click and music-like mixtures with known BPM, offset, accents, missing beats, syncopation, swing, fills, silence, bass-only pulses, and half/double-time traps. Apply pitch shift without changing BPM, time stretch with the BPM label transformed, gain/EQ/reverb/noise, dynamic compression, codec simulation, and random crops. Synthetic data is the only reliable way to densely supervise 0.1 BPM and sub-millisecond phase.

**Layer C — hard local evaluation and adaptation.** Use the osu! fixed-BPM corpus only for local adaptation and held-out testing. Keep separate partitions for clean one-timing-point maps, near-tempo failures, sparse percussion, and maps with multiple timing points. Never tune thresholds on the final held-out partition.

Self-supervised tempo methods are useful for pretraining an encoder when labelled beats are scarce. Equivariant self-supervision learns tempo representations from transformations such as time stretching, while fully self-supervised binary classification compares whether two tracks share a tempo [10][11]. These methods should initialize a representation, not replace the labelled candidate-ranking objective.

## Recommended training schedule

### Phase 0 — establish the hard benchmark

Freeze the current 21-map set, add at least 100 fixed-BPM mapsets from multiple osu! pages, and record chart BPM, first timing point, audio duration, and whether the preview is complete enough for scoring. Add a clean synthetic suite with exact fractional BPM values such as 73.7, 137.3, 189.6, and 241.2.

### Phase 1 — reproduce the teacher

Run Beat This `small0` and `final0` on the same audio. Compare frame-level beat posteriors, beat F-measure, continuity, tempo error, and the current detector's candidate ranking. Do not fine-tune until the preprocessing and frame alignment match the official pipeline.

### Phase 2 — train the ranker

Keep the teacher frozen. Generate candidates from the learned activation, current DBN, and autocorrelation path. Train the ranker with hard near-tempo and octave negatives. Split by mapset and artist. Select checkpoints by worst-group accuracy, not only overall mean error.

### Phase 3 — distill for native deployment

Export the learned activation model and ranker to ONNX. ONNX Runtime Web supports browser inference and custom builds that include only the kernels required by a model [4][5]. A small student is preferable for the editor; the Go service can use the same model artifact behind a separate runtime adapter if backend inference becomes necessary.

### Phase 4 — calibrate and fail closed

Calibrate confidence on a held-out set. Publish BPM/offset only when at least three of the following agree: teacher activation, DBN path, autocorrelation path, and two non-overlapping audio windows. Otherwise return a not-found/low-confidence result. This is the only defensible way to prevent a wrong answer on inherently ambiguous music; no training method can recover information that is not present in the audio.

## Acceptance gates for leaving Draft

The next PR should not be marked ready until all of these hold:

| Gate | Requirement |
| --- | --- |
| Clear fixed-BPM set | 0 samples over 1 BPM on the held-out set, or an explicit low-confidence result |
| Hard near-tempo set | The intended grid beats every ±0.5–4% candidate by a calibrated margin |
| Octave set | Half/double-time cases are either corrected or rejected as ambiguous |
| Fractional synthetic set | BPM error ≤0.1 and phase error ≤2 ms on clean signals |
| Stability | No individual window changes the answer by more than 0.1 BPM on accepted tracks |
| Deployment | Same logits and candidate decision within tolerance in TypeScript/browser and offline reference runtime |

## Limitations

Beat tracking metrics can disagree with the intended chart metrical level, especially when several beat interpretations are musically defensible [6][9]. Published model weights can also have different terms from the training audio and annotations; the Beat This repository explicitly separates the MIT code/weights statement from the copyright status of training files [2]. Finally, a 0.1 BPM estimate is a measurement precision target, not a guarantee that a short, syncopated, or heavily processed recording contains enough evidence to identify the intended beat.

## Recommendation

Implement Phase 0 and Phase 1 first, then train the candidate ranker before attempting a full model rewrite. This gives us a decisive test: if the pretrained beat posterior plus hard-negative ranker cannot separate the three current outliers from their near-tempo alternatives, the audio itself is ambiguous and the correct product behavior is a low-confidence result, not another hand-tuned heuristic.

## First teacher experiment

Before integrating the model into the application, the official `small0` checkpoint was evaluated offline on the existing 21 fixed-BPM osu! previews. Taking the model's discrete beat timestamps directly was not sufficient: the 50 FPS output and occasional missed beats produced only 3/21 results within 1 BPM. Using the frame-level beat logits as an activation signal, searching the current fused candidate within ±4% at 0.1 BPM steps, and optimizing phase on the same activation produced 21/21 results within 1 BPM, with a median error of approximately 0.138 BPM, P95 of approximately 0.436 BPM, and maximum error of approximately 0.581 BPM.

| Variant | ≤1 BPM | Median | P95 | Max |
| --- | ---: | ---: | ---: | ---: |
| Current TypeScript fusion | 18/21 | 0.180 | 2.555 | 3.952 |
| Beat This discrete timestamps | 3/21 | 2.500 | 97.000 | 100.000 |
| Beat This logits + local continuous search | **21/21** | **0.138** | **0.436** | **0.581** |

This is an offline teacher experiment, not yet the production detector. It is nevertheless a strong result because all three previous >1 BPM cases moved into the accepted range without using chart BPM during inference. The production implementation still needs the ONNX model, matching log-mel preprocessing, worker lifecycle, and a held-out confidence gate before the Draft PR can be marked ready. The current result is also not a final generalisation claim: the search range and score were selected during this investigation, so a larger independent osu! test set is still required.

## Bibliography

[1] Foscarin, Schlüter & Widmer (2024). “Beat This! Accurate Beat Tracking Without DBN Postprocessing.” [arXiv](https://arxiv.org/abs/2407.21658).

[2] CPJKU (2024–2026). “Beat This! Official repository and license notes.” [GitHub](https://github.com/CPJKU/beat_this).

[3] CPJKU (2024–2026). “ShiftTolerantBCELoss.” [GitHub](https://github.com/CPJKU/beat_this/blob/main/beat_this/model/loss.py).

[4] Microsoft (2026). “Deploying ONNX Runtime Web.” [ONNX Runtime](https://onnxruntime.ai/docs/tutorials/web/deploy.html).

[5] Microsoft (2026). “ONNX Runtime Web with JavaScript.” [ONNX Runtime](https://onnxruntime.ai/docs/get-started/with-javascript/web.html).

[6] Krebs, Böck & Widmer (2016). “Rhythmic Pattern Modeling for Beat and Downbeat Tracking.” [ISMIR paper](https://archives.ismir.net/ismir2016/paper/000252.pdf).

[7] Hydri et al. (2021). “BeatNet: Real-time and Offline Joint Music Beat, Downbeat, Tempo, and Meter Tracking System.” [Official implementation](https://github.com/mjhydri/BeatNet).

[8] PyTorch (2024–2026). “Knowledge Distillation Tutorial.” [PyTorch documentation](https://docs.pytorch.org/tutorials/beginner/knowledge_distillation_tutorial.html).

[9] MIREX (2026). “Audio Beat Tracking evaluation task and datasets.” [MIREX wiki](https://www.music-ir.org/mirex/wiki/2026%3AAudio_Beat_Tracking).

[10] Humayun et al. (2022). “Equivariant Self-Supervision for Musical Tempo Estimation.” [ISMIR paper](https://archives.ismir.net/ismir2022/2022_Proceedings_ISMIR.pdf).

[11] “Tempo Estimation as Fully Self-Supervised Binary Classification.” [arXiv](https://arxiv.org/abs/2401.08891).

[12] Foscarin, Schlüter & Widmer (2024). “Beat This! Official training and inference release.” [Release notes](https://github.com/CPJKU/beat_this/releases).

## Methodology appendix

The recommendation was formed by comparing primary papers and official implementations for learned beat activation, DBN post-processing, self-supervised tempo representation learning, distillation, and browser deployment. The central decision criterion was not average benchmark score alone: a method must expose enough evidence to reject a near-tempo hypothesis and must be deployable in the project's TypeScript/browser architecture. Claims about licensing are limited to the official repositories' stated code/weight licenses; the audio and annotation terms remain a separate review item.

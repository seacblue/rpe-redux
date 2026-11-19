# Beat detection: decoders and the madmom port

- Status: current
- Scope: automatic fixed-BPM timing detection (`src/core/media/beatDetection.ts`, `beatDbn.ts`, `beatActivation.ts`)
- Related: [Architecture](./architecture.md), [Testing](./testing.md)

## 1. Two decoders, one result shape

The editor can detect timing with either of two decoders. Both return the same `BeatDetectionResult`, so a caller previews, edits, or commits the answer the same way.

| Decoder | Entry point | How it commits to a tempo |
| --- | --- | --- |
| Harmonic autocorrelation | `detectBeatGridFromSamples` | Scores candidate periods against the onset envelope, then fits the winner |
| DBN (madmom) | `detectBeatGridWithDbnFromSamples` | Keeps every tempo hypothesis alive and picks the most probable path |

The autocorrelation detector is the default: it needs one pass over the onset envelope and no state space. The DBN decoder is stronger on syncopated material and near-miss tempi, because a single grid fitted to onset energy can lock onto the wrong metrical level, while a path through the joint tempo/phase state space cannot jump tempo without paying a transition cost.

## 2. What was ported

`src/core/media/beatDbn.ts` is madmom's `DBNBeatTrackingProcessor` offline path, rewritten in TypeScript. The pieces and their madmom counterparts:

| Module export           | madmom                                           |
| ----------------------- | ------------------------------------------------ |
| `createBeatStateSpace`  | `BeatStateSpace`                                 |
| `createBeatTransitions` | `BeatTransitionModel` + `exponential_transition` |
| `createBeatObservation` | `RNNBeatTrackingObservationModel`                |
| `decodeBeatPath`        | `HiddenMarkovModel.viterbi`                      |
| `decodeBeats`           | `DBNBeatTrackingProcessor.process_offline`       |

The algorithm is kept intact, including the parts that look like implementation detail but decide where beats land:

- **Integer intervals.** The state space models whole-frame beat intervals, so a tempo that is not a whole number of frames alternates between the neighbouring intervals. A three-minute decode runs in tens of milliseconds.
- **Exponential tempo transitions.** Switching tempo at a beat boundary costs `exp(-lambda * |ratio - 1|)`, normalised per origin interval. This is what keeps the path steady instead of chasing every accent.
- **Peak correction.** With `correct` enabled, each decode region reports the frame with the strongest activation inside it, which removes the whole-frame quantisation of the state space.

## 3. What was not ported

The beat activation function. madmom derives it from an ensemble of trained bidirectional LSTMs; the weights are the part that cannot be shipped and are not needed to port the decoder.

`src/core/media/beatActivation.ts` supplies the same interface instead — one activation value per frame at a known frame rate — from a spectral-flux analysis with multi-resolution windows and log-spaced bands. Three details make it usable as a decoder input:

- **Frame centres.** A window's spectrum describes the signal at its centre, so each window's flux is shifted by half its length before the windows are summed. Without that shift a long window reports a transient later than a short one, and the two disagree by tens of milliseconds.
- **Short smoothing.** One percussive attack spans several analysis frames and can produce more than one flux rise inside a single hit. A 40 ms triangular window leaves one bump per attack; without it the decoder reads double tempo.
- **Half-wave rectification.** Only rising flux counts, so a sustaining tone is not an event.
- **A floor and a percentile scale, not a peak.** The activation of a noisy track is mostly floor with a few hits above it. Subtracting the median removes that floor, and scaling by the 95th percentile stops one noise spike from setting the scale. Both were needed: with a plain global-peak normalisation, noise 0.1 took the visible peak count from 132 to 1, because the beats were still there but divided down out of reach.

## 4. Where the precision comes from

The decoder alone is not precise enough to report: it locates each beat on an analysis frame, and a tempo that is not a whole number of frames alternates between the two neighbouring intervals. Reading the tempo off that spacing is off by percent — 128 BPM at 50 fps (23.44 frames) measured as 130.4.

The decode rate is another trap. Resampling the activation before decoding flattens its peaks, because a beat peak is only a frame or two wide. At 50 fps, 190 BPM came out as 95 and 205 BPM as 68; at the activation's own rate both are exact. The decoder therefore runs at the rate the activation was built at, and a long track is kept within the memory budget by coarsening the tempo grid rather than the timebase.

Four steps then sit between the decoded path and the number the author sees:

1. **Attack refit.** Every decoded beat is matched to the strongest raw attack near it, and one least-squares line is fitted through those attack times. The refit resolves the period and beat zero below a sample, and the frame quantisation — being zero mean — cancels in the fit. A second pass drops attacks that disagree by more than two frames, which handles a beat whose attack was found on a syncopated hit. A fit whose residuals stay wider than a tenth of a beat is rejected: on sparse material under noise the slope then describes the scatter rather than the pulse, and measured 107 BPM for a 50 BPM track.
2. **A search window that scales with the period.** The window is a fraction of a beat, not a fixed number of milliseconds, because a fixed 35 ms window is far too small at a slow tempo: at 70 BPM only 2 of 28 beats found an attack at 35 ms, while 80 ms found all 28 and took the phase error from 43 ms to 0.8 ms. The fraction stops short of half a beat so the metrical test below cannot find an onset where there is none.
3. **Metrical level.** An accent pattern can pull the decoder onto every second beat, which is how a 128 BPM track gets reported as 64. Amplitude cannot decide this: a pattern of `1.0 / 0.3 / 0.5 / 0.3` has quiet but real hits between the loud ones, and its midway level is close to that of a pattern with nothing there at all. The test asks whether the waveform _rises_ at the midway points — the same onset detection the refit uses — and doubles the tempo when most of them do.
4. **Refined offset.** The fitted intercept is beat zero, so the reported offset is exact rather than the frame time of the first decoded beat. When the refit cannot run — a sparse pattern with only a handful of onsets — the decode is used directly, with its period taken from the median interval rather than an end-to-end average, which a single misplaced beat would otherwise skew.

`decodeBeats` itself deliberately does not round its output to a grid: it returns the positions it decoded, and the caller decides what to measure.

## 5. Measured accuracy

Synthetic click tracks with every onset placed at a known sample index, 24–30 s each, deterministic noise. The expected tempo in each case is the pulse the pattern actually carries, not the nominal BPM.

| Material                                    | BPM                | Phase  |
| ------------------------------------------- | ------------------ | ------ |
| Clean quarters, 70–205 BPM                  | exact              | 0–1 ms |
| 112, 133, 145, 163 BPM + noise              | exact              | 1 ms   |
| Quarters at 100, 128, 190 BPM, noise to 0.1 | exact              | < 1 ms |
| Accented backbeat (1.0 / 0.3 / 0.5 / 0.3)   | exact              | 1 ms   |
| Backbeat only, beats 1&3, beats 2&4         | exact              | 1 ms   |
| 3/4, 5/4, 7/4 with first-beat accent        | exact              | 1 ms   |
| Beat one only per bar                       | exact (doubled up) | 1 ms   |
| Five start phases at 133 BPM                | exact              | < 2 ms |

The tempi are chosen because they are _not_ whole frames; 120 BPM (exactly 25 frames) would hide the quantisation instead of testing it. A sweep of 25 rhythm patterns passes 24; the one that does not is tresillo (3+3+2), a cross-rhythm whose "beat" is a matter of interpretation.

### Tolerance

`beatTolerance.test.mjs` holds the reported values to **0.01 BPM** and **3 ms** of offset. How close the fit lands depends on how many beats it has to work with, because the line is fitted through every matched attack:

| Track length | Raw tempo error (before rounding) |
| ------------ | --------------------------------- |
| 10 s         | up to 0.005 BPM                   |
| 30 s         | 0.0000 BPM                        |
| 60 s         | 0.0000 BPM                        |

The reported value keeps three decimals, so a full-length track reports the exact tempo. A ten-second clip is the case that uses the tolerance rather than beating it: too few attacks for the fit to average the frame quantisation away.

Limits worth stating plainly:

- **Some material has no single right answer.** A swing feel, a pattern with hits only every second beat, and a cross-rhythm are all cases where two tempi describe the same audio. The detector reports the pulse it can defend from the onsets; it does not guess a metrical intent that is not audible.
- **Very short buffers degrade.** The refit needs roughly eight matched attacks to be exact, so a few seconds of audio reports a frame-accurate tempo.

## 6. Why not bundle madmom

| Constraint         | Effect                                                         |
| ------------------ | -------------------------------------------------------------- |
| Python + Cython    | Needs a Python runtime inside the desktop package              |
| TensorFlow / Keras | Hundreds of MB of native libraries per platform                |
| Model weights      | Separate licence and distribution obligation                   |
| Tauri + Go host    | Neither the frontend nor the Go service can call it in-process |

Packaging it would make the installer an order of magnitude larger and turn every platform build into a Python/TensorFlow build. The decoder is the part that carries the algorithm, and it ports cleanly; the model is the part that does not.

madmom is also a beat/downbeat tracker, not a waveform alignment tool, so it does not address audio-to-picture offset.

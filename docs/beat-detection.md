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

## 4. Measured accuracy

On synthetic click tracks with the attack placed at known sample indices (`src/test/media/audio/`), both decoders report the beat phase within **0.8 ms** across four different starting phases, and the tempo within 0.5 BPM. The DBN path reaches that precision because it hands its grid to the same raw-attack refit the autocorrelation detector uses; the state space alone is only accurate to one analysis frame.

## 5. Why not bundle madmom

| Constraint         | Effect                                                         |
| ------------------ | -------------------------------------------------------------- |
| Python + Cython    | Needs a Python runtime inside the desktop package              |
| TensorFlow / Keras | Hundreds of MB of native libraries per platform                |
| Model weights      | Separate licence and distribution obligation                   |
| Tauri + Go host    | Neither the frontend nor the Go service can call it in-process |

Packaging it would make the installer an order of magnitude larger and turn every platform build into a Python/TensorFlow build. The decoder is the part that carries the algorithm, and it ports cleanly; the model is the part that does not.

madmom is also a beat/downbeat tracker, not a waveform alignment tool, so it does not address audio-to-picture offset.

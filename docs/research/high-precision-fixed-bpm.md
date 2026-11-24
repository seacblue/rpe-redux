# High-precision fixed BPM research

Status: proposal

## Conclusion

The current DBN/autocorrelation fusion is a useful candidate selector, but it cannot guarantee 0.1 BPM because its largest errors are metrical-level errors, not numerical fitting errors. The next detector should separate tempo-octave selection from continuous BPM/phase refinement and keep several hypotheses until the final scoring stage.

## Evidence from primary sources

- [ISMIR 2016 tempo octave and drift paper](https://archives.ismir.net/ismir2016/paper/000252.pdf) uses a continuous speed estimate to compare tempo candidates, then refines phase and drift with a CQT/driftogram instead of trusting one discrete DBN path. Its candidate features and pairwise octave comparison are directly applicable to fixed-BPM chart timing.
- [madmom tempo processor](https://github.com/CPJKU/madmom/blob/main/madmom/features/tempo.py) exposes a tempo histogram with multiple candidates and relative strengths; this is safer than retaining only the Viterbi winner.
- [madmom beat processor](https://github.com/CPJKU/madmom/blob/main/madmom/features/beats.py) uses multi-resolution neural beat activations before DBN tracking. The current port has the DBN but intentionally does not ship madmom's trained activation model, which is the largest remaining quality gap.
- [Beat This inference](https://github.com/CPJKU/beat_this/blob/main/beat_this/inference.py) demonstrates a modern learned beat/downbeat activation followed by an optional DBN post-processor; it is a candidate reference for a small ONNX backend, subject to model-license review.

## Recommended design

1. Generate a top-k tempo histogram from several onset bands and retain the factors `0.5, 2/3, 1, 3/2, 2` instead of committing to one BPM early.
2. Score each candidate with beat coverage, offbeat leakage, local tempo stability, phase concentration, and a continuous speed estimate. A small calibrated classifier trained on annotated fixed-tempo audio should choose the musical octave; a hand-tuned 90–240 BPM prior should not be the final authority.
3. For the winning candidate, align raw onset peaks with a bounded dynamic program, then optimize phase and period jointly over the full audio. Use a coarse-to-fine continuous search or CQT/driftogram around the candidate, followed by robust weighted linear regression of beat time versus beat index.
4. Return the best fixed BPM/offset, plus an internal confidence and octave gap. A result can still be emitted automatically when confidence is low, but low confidence must prevent the product from claiming 0.1 BPM accuracy.

## Accuracy boundary

For genuinely fixed tempo, a long enough track and sub-frame onset timing can support 0.1 BPM after the correct beat level is chosen. A ten-second preview is not a reliable offset benchmark because it may be trimmed or codec-shifted, and real music with drift or an ambiguous backbeat has no unique single BPM. The acceptance set should therefore use complete, licensed audio and report octave errors separately from continuous BPM error.

## Suggested implementation order

1. Pure TypeScript: top-k histogram, candidate features, continuous period/ phase optimizer, robust fit, and confidence diagnostics.
2. Re-run a larger fixed-tempo corpus and gate on octave accuracy first, then `<=1 BPM` and `<=0.1 BPM` on non-ambiguous cases.
3. If octave accuracy remains the bottleneck, add a small ONNX beat activation model in the Go service or worker; keep the final precision fitter native.

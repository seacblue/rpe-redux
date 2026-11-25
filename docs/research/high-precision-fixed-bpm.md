# High-precision fixed BPM

The detector is deliberately constrained to one steady BPM and one offset. It does not infer variable tempo, meter, or downbeat intent.

Precision comes from three layers:

1. The learned model produces frame-level beat evidence on a 50 FPS grid.
2. A continuous BPM/phase search scores the evidence and rejects half- and third-beat aliases.
3. Raw attacks are refit with a least-squares period and phase estimate, so the final result is not limited to the analysis-frame spacing.

The current self-contained validation result over 256 held-out generated fixed-tempo examples is:

| Metric                     |    Result |
| -------------------------- | --------: |
| Median absolute BPM error  | 0.151 BPM |
| P95 absolute BPM error     | 0.346 BPM |
| Maximum absolute BPM error | 1.033 BPM |
| Frame F1                   |     0.990 |

The 0.1 BPM goal is a precision target for sufficiently long, clearly pulsed material, not a promise that every short or weak signal contains enough information to identify a unique metrical level. The application still emits a single fixed result and keeps manual editing available for ambiguous material.

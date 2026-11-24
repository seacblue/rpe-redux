# osu! BPM, beat, and offset detector evaluation

Status: research note

## Recommendation

Use a two-lane corpus:

1. **Chart truth:** obtain dated, chart-only `.osu` files from the official [ppy data index](https://data.ppy.sh/), which publishes `*_osu_files.tar.bz2` archives. Do not treat the archive as production-licensed data: its [licence](https://data.ppy.sh/LICENCE.txt) permits statistical analysis and testing, but says public exposure or production use requires contacting ppy.
2. **Audio:** use audio snippets supplied by the evaluator or otherwise licensed. osu!’s API exposes a `preview_url` in the beatmapset object, and the website provides short previews, but a preview is not enough to validate a full-map tempo map. Keep the preview/full-audio distinction in the manifest.

The official osu! API is useful for inventory and metadata, not as the primary timing-point source: `GET /api/v2/beatmaps/{beatmap}` returns beatmap metadata such as BPM, while `GET /api/v2/beatmapsets/{beatmapset}` exposes beatmapset metadata including `preview_url`; the documented API does not expose the complete `[TimingPoints]` section. API routes require OAuth, support batching up to 50 beatmap IDs, and osu! asks clients to cache data, stay near 60 requests/minute, and use `data.ppy.sh` for mass sample data. See the [official API documentation](https://osu.ppy.sh/docs/index.html).

## Ground-truth construction

Parse each `.osu` file using the official [file-format specification](https://osu.ppy.sh/wiki/en/Client/File_formats/osu_%28file_format%29):

- Read `[TimingPoints]` in chronological order. For each **uninherited** point (`uninherited=1`), `time` is the timing-section start in milliseconds and `beatLength` is milliseconds per beat, so `BPM = 60,000 / beatLength`.
- Generate the reference beat lattice from each uninherited point until the next uninherited point (or the end of the evaluation window). A new uninherited point resets the metronome; inherited points are for slider velocity, hitsounds, and effects, not a new metronomic BPM. This distinction is also stated in the [osu! timing-tab documentation](https://osu.ppy.sh/wiki/en/Client/Beatmap_editor/Timing).
- Preserve `meter` and the first-beat/downbeat phase separately. A beat detector can be correct at the beat level while being wrong about the bar’s downbeat.
- Keep the map’s audio-time origin explicit. The file format defines timing-point times relative to the beginning of the beatmap audio; record any `AudioLeadIn`, preview start, resampling, trimming, or codec delay applied to the audio sample.
- Treat ranked-map timing as chart truth, not an unquestionable perceptual annotation. osu!’s [ranking criteria](https://osu.ppy.sh/wiki/en/Ranking_criteria) says BPM and offset of uninherited timing points should be synchronised with the song, while acknowledging that constantly changing BPM can be impossible to time perfectly.

For a detector that emits only one BPM/offset, start with a fixed-grid subset containing one dominant uninherited section. Evaluate variable-tempo maps separately as a piecewise timing task; otherwise a single global score hides drift and timing-section failures.

## Metrics and report

Report per-map results first, then macro-average by map (and optionally micro-average by beat count):

- **BPM:** absolute BPM error, relative error, and octave-error flags (0.5×/2×). For variable maps, report section-weighted errors and the number of missed/extra timing changes. `mir_eval.tempo` is a useful reference for relative tempo accuracy and uses an 8% default hit tolerance, but a chart integration should also publish stricter engineering thresholds rather than relying on that one score; see the [tempo API](https://mir-eval.readthedocs.io/stable/api/tempo.html).
- **Beat locations:** use [mir_eval.beat](https://mir-eval.readthedocs.io/latest/api/beat.html): F-measure at its documented ±70 ms default, Cemgil, P-score, and continuity metrics CMLc/CMLt/AMLc/AMLt. CML exposes strict phase/period correctness; AML is useful as a diagnostic for half/double/off-beat hypotheses.
- **Offset/phase:** additionally report signed first-beat error, median and 95th-percentile absolute phase error, and the fraction within 5/10/20 ms. F-measure alone can hide a constant phase bias.
- **Drift:** fit beat residual versus time and report slope in ms/min plus maximum absolute residual. This catches a detector whose initial offset is good but whose BPM is slightly wrong.
- **Operational quality:** no-output rate, false-positive density, runtime, and peak memory. Do not collapse detector failure into an ordinary zero score.

Use a fixed, documented preprocessing pipeline and a manifest containing beatmap ID, set ID, map revision/checksum, timing-section summary, audio source/license, clip bounds, sample rate, and any lead-in/trim transform. Split by beatmap set and audio identity—not by difficulty—so sibling difficulties cannot leak the same song into both train and test. Stratify held-out maps by BPM range, meter, duration, number of uninherited timing changes, and status.

## High-trust references

- [osu! API v2 documentation](https://osu.ppy.sh/docs/index.html)
- [osu! `.osu` file format](https://osu.ppy.sh/wiki/en/Client/File_formats/osu_%28file_format%29)
- [osu! Timing tab](https://osu.ppy.sh/wiki/en/Client/Beatmap_editor/Timing)
- [osu! ranking criteria — timing](https://osu.ppy.sh/wiki/en/Ranking_criteria)
- [ppy official data index](https://data.ppy.sh/) and [data licence](https://data.ppy.sh/LICENCE.txt)
- [mir_eval beat metrics](https://mir-eval.readthedocs.io/latest/api/beat.html) and [tempo metrics](https://mir-eval.readthedocs.io/stable/api/tempo.html)
- [Official open-source MIREX evaluation pipelines](https://github.com/ismir-mirex/mirex-evaluation)

## Batch results for the current fixed-result detector

The current worker path was exercised locally on two lanes:

1. 58 deterministic synthetic PCM cases: 30 clean fixed pulses, 12 noisy pulses, 8 short clips, 4 accented patterns, and 4 backbeat patterns. The click phase was known, so both BPM and circular phase error could be measured.
2. 35 unique recent ranked osu! beatmapset previews: 21 sets had one fixed uninherited BPM section and were scored; 14 had multiple uninherited BPM values and were kept as out-of-scope policy checks. All 35 previews produced a fixed BPM/offset result. The chart timing truth came from the downloaded `.osu` file, while the audio was only the public ten-second preview clip.

The synthetic threshold was BPM absolute error ≤1 and circular phase error ≤10 ms:

| Synthetic lane | Cases | Detection | Pass | Notes |
| --- | --: | --: | --: | --- |
| Clean fixed pulses | 30 | 30/30 | 30/30 | BPM range 60–350 |
| Noise | 12 | 12/12 | 12/12 | Deterministic low and moderate noise |
| Short clips | 8 | 8/8 | 8/8 | 6–8 seconds |
| Accented pattern | 4 | 4/4 | 3/4 | One 200 BPM case selected half-time |
| Backbeat pattern | 4 | 4/4 | 2/4 | Two cases selected half-time |
| **Total** | **58** | **58/58** | **55/58 (94.8%)** | Phase mean 0.824 ms; phase p95 0.832 ms |

The real-music fixed-BPM lane is materially less stable, but fusion removes most octave errors:

| Threshold                 |      DBN only |        Fusion |
| ------------------------- | ------------: | ------------: |
| Detection                 |         21/21 |         21/21 |
| BPM error ≤1              |  8/21 (38.1%) | 17/21 (81.0%) |
| BPM error ≤2              | 10/21 (47.6%) | 19/21 (90.5%) |
| BPM error ≤5              | 13/21 (61.9%) |  21/21 (100%) |
| Median BPM error          |     2.073 BPM |     0.211 BPM |
| 95th-percentile BPM error |   174.087 BPM |     2.623 BPM |

The remaining fusion errors were:

|              Beatmapset | Chart BPM | Detected BPM | Failure shape   |
| ----------------------: | --------: | -----------: | --------------- |
|    2564707 — Whyte pain |       190 |      192.623 | near-tempo miss |
| 2621236 — Abyss to Eden |       190 |      192.073 | competing pulse |

The osu! offset was not scored as an absolute error: a public preview is trimmed/encoded independently of the beatmap audio origin, so its first detected attack cannot be compared directly with the `.osu` timing-point offset. Synthetic circular phase was scored and stayed sub-millisecond; the real-music weakness is BPM metrical-level selection.

For an exploratory comparison on the first 15 fixed previews, the DBN path had 40.0% within 1 BPM, while the autocorrelation path had 53.8% among its 13 non-null results. The implementation now runs both and ranks their fixed-grid candidates automatically. On the expanded 21-map fixed-BPM set, the fused result reached 17/21 within 1 BPM, 19/21 within 2 BPM, and 21/21 within 5 BPM. It also keeps the user-facing contract simple: one BPM and one offset, with no detector or tempo-level choice in the UI. The remaining errors are concentrated in ambiguous recorded-music metrical levels, not variable-tempo inference.

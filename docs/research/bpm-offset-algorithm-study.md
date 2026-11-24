# BPM and offset algorithm study

Status: current

## Conclusion

Tempora is useful as a product and data-model reference, but its source is not suitable for direct translation into RPE Redux. The repository's `LICENSE.txt` is CC BY-NC-ND 4.0: it permits non-commercial sharing with attribution, but forbids sharing adapted material. A translated C# implementation would be an adaptation, and RPE Redux's distribution/commercial licensing makes that boundary unsafe. We therefore use Tempora only for high-level ideas and do not copy its source or assets.

`Bpm-Measurer-Util` is Apache-2.0. Its license permits modification and distribution with the license, notices, and modified-file markings retained. It is safe to study and, if needed, to reuse isolated code with attribution, but its useful contribution here is primarily a simple timing-map representation rather than an automatic detector.

## What each project contributes

| Project | Evidence | Reusable idea | RPE Redux decision |
| --- | --- | --- | --- |
| Tempora | [README](https://github.com/teamkongehund/Tempora/blob/master/README.md), [Timing.cs](https://github.com/teamkongehund/Tempora/blob/master/Classes/TimingClasses/Timing.cs), [license](https://raw.githubusercontent.com/teamkongehund/Tempora/master/LICENSE.txt) | Keep audio immutable and map it to a musical timeline with timing points; allow tempo and time-signature edits independently of playback | Reimplemented as an original data-flow decision: detected audio-time segments become chart `BPMList` beat positions; no Tempora code or asset is copied |
| Tempora | [SpectrogramHelper.cs](https://github.com/teamkongehund/Tempora/blob/master/Classes/DataHelpers/SpectrogramHelper.cs), [PcmData.cs](https://github.com/teamkongehund/Tempora/blob/master/Classes/Audio/PcmData.cs) | Decode PCM once and derive visualization data from a reusable analysis buffer | Already covered by RPE's decoded `AudioBuffer` and TypeScript onset/DBN pipeline |
| Bpm-Measurer-Util | [timingUtils.ts](https://github.com/iExploder/Bpm-Measurer-Util/blob/main/utils/timingUtils.ts), [Visualizer.tsx](https://github.com/iExploder/Bpm-Measurer-Util/blob/main/components/Visualizer.tsx), [license](https://raw.githubusercontent.com/iExploder/Bpm-Measurer-Util/main/LICENSE) | Represent an offset plus beat-indexed BPM points; schedule a metronome by finding the active point | RPE keeps the detected BPM/offset pair editable and applies one fixed `BPMList` entry |
| Bpm-Measurer-Util | [audioUtils.ts](https://github.com/iExploder/Bpm-Measurer-Util/blob/main/utils/audioUtils.ts) | Hann-window FFT and spectrogram rendering for visual/manual alignment | Not used as the detector; RPE's existing onset envelope and DBN decoder are stronger and already worker-safe |

## Implemented integration

The automatic timing worker now runs `detectBeatGridWithDbnFromSamples` first and falls back to `detectAutoTimingFromSamples` when DBN cannot produce a result. DBN uses its tempo/phase hypotheses internally to improve fixed-grid selection, but the public result is always one BPM and one offset. Applying the result always writes one `BPMList` entry at `[0, 0, 1]` and stores the detected beat-zero time in `META.offset`.

## osu! preview checks

The following checks used the public ten-second preview clips for real osu! beatmap sets. The clips were kept outside the repository and decoded to mono PCM only for the local run. They are useful smoke tests, not a replacement for testing the complete audio file.

| Case | Reference | Clip result | Effect |
| --- | --- | --- | --- |
| Fixed BPM, fixed meter | [YOASOBI - Love Letter](https://osu.ppy.sh/beatmapsets/1572525#osu/3210825), first uninherited timing point: 300 ms/beat = 200 BPM | 200.105 BPM, offset 75.599 ms, one fixed result | BPM error 0.105; the preview's encoded start makes its offset unsuitable for a strict comparison with the full map's 7.465 ms timing-point offset |
| Fixed BPM, fixed meter | [ONE OK ROCK - Skyfall (Cut Ver.)](https://osu.ppy.sh/beatmapsets/1566750#osu/3199021), published map request lists 183 BPM | 182.540 BPM, offset 121.648 ms, one fixed result | BPM error 0.460; the short preview again prevents a reliable full-song offset comparison |
| Variable BPM candidate | [Aren't You Quiet?](https://osu.ppy.sh/beatmapsets/2581178#mania/5753313), published as 160–250 BPM | 201.032 BPM, offset 25.032 ms, one fixed result from the ten-second clip | Correctly finds a local pulse, but the clip is too short to prove or reject the full-song tempo map; use the complete audio for acceptance |
| Variable BPM input | 30 s rendered step, 100 → 130 BPM | one fixed BPM/offset result | The detector remains usable as a fixed-grid proposal; no tempo map is emitted |
| Variable meter | synthetic pulse with a meter change | one fixed BPM/offset result | Deliberately remains manual: time-signature/downbeat choice is not inferred |

The fixed-BPM preview results show that the worker path is useful on actual music. The variable-tempo candidate is intentionally only a fixed-grid smoke check because osu!'s public preview endpoint returns only a short excerpt; it must not be presented as a full-song tempo-map claim.

## Scope boundary

The current feature intentionally emits only one BPM point and one offset. The detector can identify a pulse in regular 3/4, 5/4, or 7/4 material, but choosing the bar's first beat is still authoring intent rather than an audio-only fact; time signatures and tempo maps remain manually authored.

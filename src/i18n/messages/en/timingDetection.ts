/** English copy for the fixed-tempo detector and its new-chart prompt. */
export default {
  "editorPanels.timingDetection.newChart.title": "Detect BPM and offset for this chart?",
  "editorPanels.timingDetection.newChart.description":
    'Optional and skippable. Audio is analyzed locally; "Always detect" and "Never detect" are remembered, the other answers apply only to this chart.',
  "editorPanels.timingDetection.newChart.always": "Always detect",
  "editorPanels.timingDetection.newChart.never": "Never detect",
  "editorPanels.timingDetection.newChart.once": "Detect once",
  "editorPanels.timingDetection.newChart.skip": "Skip once",
  "editorPanels.timingDetection.button": "Auto-detect BPM & offset",
  "editorPanels.timingDetection.title": "Detect BPM and offset",
  "editorPanels.timingDetection.intro":
    "BPM and offset detected and filled in. Adjust them to the values you want.",
  "editorPanels.timingDetection.analyzing": "Analyzing the beat…",
  "editorPanels.timingDetection.analyzingHint": "Sampling the track for its dominant pulse.",
  "editorPanels.timingDetection.notFound":
    "Couldn't find a clear beat. Enter the BPM and offset by hand.",
  "editorPanels.timingDetection.noAudioTitle": "No audio yet",
  "editorPanels.timingDetection.noAudioBody":
    "Choose the chart's audio track first, then run the detector.",
  "editorPanels.timingDetection.pickAudio": "Choose audio",
  "editorPanels.timingDetection.errorTitle": "Detection failed",
  "editorPanels.timingDetection.errorBody":
    "The audio could not be analyzed. Check that it decodes and try again.",
  "editorPanels.timingDetection.retry": "Try again",
  "editorPanels.timingDetection.bpm": "BPM",
  "editorPanels.timingDetection.offset": "Offset",
  "editorPanels.timingDetection.bpmHalf": "Halve BPM",
  "editorPanels.timingDetection.bpmDouble": "Double BPM",
  "editorPanels.timingDetection.offsetBeatDown": "Move offset one beat earlier",
  "editorPanels.timingDetection.offsetBeatUp": "Move offset one beat later",
  "editorPanels.timingDetection.offsetBeatDownShort": "−1 beat",
  "editorPanels.timingDetection.offsetBeatUpShort": "+1 beat",
  "editorPanels.timingDetection.cancel": "Cancel",
  "editorPanels.timingDetection.apply": "Apply timing",
  "editorPanels.timingDetection.replaceAndApply": "Replace all timing and apply",
  "editorPanels.timingDetection.commit": "Apply detected timing",
  "editorPanels.timingDetection.invalidValues": "Enter a positive BPM and a finite offset.",
  "editorPanels.timingDetection.pendingHint":
    "Timing detection is waiting for audio. Choose the track and it will run automatically.",
  "editorPanels.timingDetection.pendingPick": "Choose audio",
} as const;

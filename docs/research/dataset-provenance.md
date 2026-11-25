# Fixed-beat training boundary

The fixed-beat model is trained and evaluated from project-generated material only. The generator creates mono PCM with a known fixed BPM, phase, accents, transients, background tone, and controlled noise. Labels are generated from the same fixed grid. No source recordings, chart files, or annotation bundles are required by the training script.

The repository ships the generator, training code, validation procedure, and the resulting ONNX weights. It does not ship generated PCM, intermediate features, label dumps, or evaluation media. The model file is the only learned artifact used by the application.

The public runtime contract remains fixed-tempo: tempo changes and meter are not inferred or emitted. The learned stage supplies beat evidence; the TypeScript detector selects one fixed BPM/phase pair and refits the offset.

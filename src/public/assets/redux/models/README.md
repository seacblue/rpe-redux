# Beat This small0 model

`beat_this_small0.onnx` is the ONNX export of Beat This `small0`, used only as
a frame-level beat-evidence model. The upstream Beat This code and published
weights are released under the MIT License; the training audio and annotations
remain subject to their own terms.

Source: <https://github.com/CPJKU/beat_this>

The model is not a BPM regressor. RPE Redux searches fixed BPM/phase candidates
against its beat logits and then refines the selected grid against raw audio
attacks.

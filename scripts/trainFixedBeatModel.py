"""Train the project's fixed-BPM beat-evidence model from generated PCM only."""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

import numpy as np
import torch
from torch import Tensor, nn
from torch.nn import functional as F
import torchaudio


SAMPLE_RATE = 22050
FFT_SIZE = 1024
HOP_SIZE = 441
MEL_BINS = 128
F_MIN = 30
F_MAX = 11000


class FixedBeatNet(nn.Module):
    """Predict one fixed-grid beat activation per log-mel frame."""

    def __init__(self) -> None:
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv1d(MEL_BINS, 64, kernel_size=9, padding=4),
            nn.GELU(),
            nn.Conv1d(64, 64, kernel_size=9, padding=4),
            nn.GELU(),
            nn.Conv1d(64, 32, kernel_size=9, padding=4),
            nn.GELU(),
            nn.Conv1d(32, 1, kernel_size=1),
        )

    def forward(self, mel: Tensor) -> Tensor:
        """Return beat logits for a `[batch, time, mel]` tensor."""
        return self.layers(mel.transpose(1, 2)).squeeze(1)


def make_mel(device: torch.device) -> torchaudio.transforms.MelSpectrogram:
    """Create the frontend shared by training and browser inference."""
    return torchaudio.transforms.MelSpectrogram(
        sample_rate=SAMPLE_RATE,
        n_fft=FFT_SIZE,
        hop_length=HOP_SIZE,
        f_min=F_MIN,
        f_max=F_MAX,
        n_mels=MEL_BINS,
        mel_scale="slaney",
        normalized="frame_length",
        power=1,
    ).to(device)


def synthesize_batch(
    batch_size: int,
    duration: float,
    device: torch.device,
    generator: torch.Generator,
    mel: torchaudio.transforms.MelSpectrogram,
) -> tuple[Tensor, Tensor, Tensor, Tensor]:
    """Generate fixed-BPM music-like PCM and its beat/BPM/offset labels."""
    length = round(duration * SAMPLE_RATE)
    time = torch.arange(length, device=device, dtype=torch.float32) / SAMPLE_RATE
    bpm = torch.empty(batch_size, device=device).uniform_(70, 240, generator=generator)
    period = 60 / bpm
    offset = torch.empty(batch_size, device=device).uniform_(0.08, 0.45, generator=generator)
    offset = torch.minimum(offset, period * 0.7)
    samples = torch.zeros(batch_size, length, device=device)
    max_beats = math.ceil(duration / 60 * 240) + 2
    for beat_index in range(max_beats):
        beat_time = offset + beat_index * period
        delta = time.unsqueeze(0) - beat_time.unsqueeze(1)
        active = (delta >= 0) & (delta < 0.24)
        accent = torch.empty(batch_size, device=device).uniform_(0.45, 1.2, generator=generator)
        accent *= torch.where(torch.rand(batch_size, device=device, generator=generator) > 0.78, 1.35, 1.0)
        kick = accent.unsqueeze(1) * torch.exp(-delta.clamp_min(0) / 0.045)
        kick *= torch.sin(2 * math.pi * (75 + 22 * torch.rand(batch_size, 1, device=device, generator=generator)) * delta)
        click = 0.28 * accent.unsqueeze(1) * torch.exp(-delta.clamp_min(0) / 0.008)
        samples += torch.where(active, kick + click, 0)
        if beat_index % 2 == 0:
            half_delta = time.unsqueeze(0) - (beat_time + period * 0.5).unsqueeze(1)
            half_active = (half_delta >= 0) & (half_delta < 0.12)
            half = 0.18 * accent.unsqueeze(1) * torch.exp(-half_delta.clamp_min(0) / 0.025)
            samples += torch.where(half_active, half, 0)

    frequency = torch.empty(batch_size, 1, device=device).uniform_(110, 420, generator=generator)
    phase = torch.rand(batch_size, 1, device=device, generator=generator) * 2 * math.pi
    samples += 0.07 * torch.sin(2 * math.pi * frequency * time.unsqueeze(0) + phase)
    noise = torch.randn(batch_size, length, device=device, generator=generator) * 0.018
    samples += noise
    samples /= samples.abs().amax(dim=1, keepdim=True).clamp_min(1)

    mel_values = torch.log1p(1000 * mel(samples)).transpose(1, 2)
    frame_time = torch.arange(mel_values.shape[1], device=device, dtype=torch.float32) * HOP_SIZE / SAMPLE_RATE
    target = torch.zeros(batch_size, mel_values.shape[1], device=device)
    for beat_index in range(max_beats):
        beat_time = offset + beat_index * period
        distance = (frame_time.unsqueeze(0) - beat_time.unsqueeze(1)).abs()
        target = torch.maximum(target, torch.exp(-0.5 * (distance / 0.045) ** 2))
    return mel_values, target, bpm, offset


def grid_score(activation: np.ndarray, bpm: float, phases: np.ndarray) -> float:
    """Return the best fixed-grid score over a vector of candidate phases."""
    period = 50 * 60 / bpm
    beat_count = max(4, int(np.ceil((len(activation) - phases.min()) / period)))
    beat_numbers = np.arange(beat_count)[None, :]
    positions = phases[:, None] + beat_numbers * period
    indices = np.arange(len(activation))
    on = np.interp(positions, indices, activation, left=0, right=0)
    off_half = np.interp(positions + period / 2, indices, activation, left=0, right=0)
    off_third_a = np.interp(positions + period / 3, indices, activation, left=0, right=0)
    off_third_b = np.interp(positions + (2 * period) / 3, indices, activation, left=0, right=0)
    valid = positions < len(activation)
    counts = valid.sum(axis=1).clip(min=1)
    on_mean = (on * valid).sum(axis=1) / counts
    off_mean = (
        (off_half + 0.5 * off_third_a + 0.5 * off_third_b) * valid
    ).sum(axis=1) / (2 * counts)
    quantile = np.quantile(np.where(valid, on, 0), 0.75, axis=1)
    return float(np.max(on_mean - 0.35 * off_mean + 0.1 * quantile))


def estimate_bpm(activation: np.ndarray) -> float:
    """Estimate BPM with a coarse-to-fine fixed-grid search."""
    coarse_candidates = np.arange(70, 240.01, 1.0)
    coarse_scores = np.array(
        [grid_score(activation, candidate, np.linspace(0, 50 * 60 / candidate, 8, endpoint=False)) for candidate in coarse_candidates]
    )
    coarse_bpm = float(coarse_candidates[int(coarse_scores.argmax())])
    fine_candidates = np.arange(coarse_bpm - 1.0, coarse_bpm + 1.001, 0.05)
    fine_scores = np.array(
        [grid_score(activation, candidate, np.linspace(0, 50 * 60 / candidate, 16, endpoint=False)) for candidate in fine_candidates]
    )
    return float(fine_candidates[int(fine_scores.argmax())])


def measure(model: nn.Module, mel: torchaudio.transforms.MelSpectrogram, device: torch.device) -> dict[str, float]:
    """Measure held-out synthetic BPM error and framewise activation quality."""
    generator = torch.Generator(device=device).manual_seed(20261124)
    model.eval()
    errors: list[float] = []
    true_frames = 0
    hit_frames = 0
    false_frames = 0
    with torch.no_grad():
        for _ in range(32):
            features, target, bpm, _ = synthesize_batch(8, 8.0, device, generator, mel)
            probabilities = model(features).sigmoid().cpu().numpy()
            target_numpy = target.cpu().numpy()
            truth = target_numpy >= 0.5
            predicted = probabilities >= 0.5
            true_frames += int(truth.sum())
            hit_frames += int((truth & predicted).sum())
            false_frames += int((~truth & predicted).sum())
            for index in range(len(probabilities)):
                estimate = estimate_bpm(probabilities[index])
                errors.append(abs(estimate - float(bpm[index])))
    precision = hit_frames / max(hit_frames + false_frames, 1)
    recall = hit_frames / max(true_frames, 1)
    return {
        "examples": 256,
        "bpm_median_abs_error": float(np.median(errors)),
        "bpm_p95_abs_error": float(np.percentile(errors, 95)),
        "bpm_max_abs_error": float(max(errors)),
        "frame_precision": precision,
        "frame_recall": recall,
        "frame_f1": 2 * precision * recall / max(precision + recall, 1e-9),
    }


def main() -> None:
    """Train, export, and measure the model using generated samples only."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=900)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()
    random.seed(20261124)
    torch.manual_seed(20261124)
    device = torch.device(args.device)
    generator = torch.Generator(device=device).manual_seed(20261125)
    model = FixedBeatNet().to(device)
    mel = make_mel(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=1e-4)
    model.train()
    for step in range(args.steps):
        features, target, _, _ = synthesize_batch(16, 8.0, device, generator, mel)
        logits = model(features)
        weights = 1 + 7 * target
        loss = F.binary_cross_entropy_with_logits(logits, target, weight=weights)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        if (step + 1) % 100 == 0:
            print(json.dumps({"step": step + 1, "loss": float(loss)}), flush=True)

    metrics = measure(model, mel, device)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    model.eval().cpu()
    example = torch.zeros(1, 64, MEL_BINS)
    torch.onnx.export(
        model,
        example,
        args.output,
        input_names=["mel"],
        output_names=["beat_logits"],
        dynamic_axes={"mel": {1: "time"}, "beat_logits": {1: "time"}},
        opset_version=17,
        dynamo=False,
    )
    print(json.dumps({"output": str(args.output), "metrics": metrics}, indent=2), flush=True)


if __name__ == "__main__":
    main()

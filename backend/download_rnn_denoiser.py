#!/usr/bin/env python3
"""
Download the GTCRN RNN speech denoiser ONNX model for AI karaoke.
GTCRN (Gated Temporal Convolutional Recurrent Network) is a lightweight
RNN-style model from sherpa-onnx, 16 kHz mono, ~523 KB.

Usage:
  python download_rnn_denoiser.py [--out path]
  Default output: ../models/denoise.onnx (or DENOISER_MODEL env)
"""

import argparse
import os
import sys
import urllib.request

GTCRN_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx"


def main():
    parser = argparse.ArgumentParser(description="Download RNN (GTCRN) denoiser ONNX for AI karaoke")
    parser.add_argument(
        "--out",
        default=None,
        help="Output path for denoise.onnx (default: ../models/denoise.onnx from this script dir)",
    )
    args = parser.parse_args()

    out = args.out
    if not out:
        base = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(base, "..", "models")
        os.makedirs(models_dir, exist_ok=True)
        out = os.path.join(models_dir, "denoise.onnx")

    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    print(f"Downloading GTCRN RNN denoiser from {GTCRN_URL}")
    print(f"Output: {out}")

    try:
        urllib.request.urlretrieve(GTCRN_URL, out)
    except Exception as e:
        print(f"Download failed: {e}", file=sys.stderr)
        sys.exit(1)

    size = os.path.getsize(out)
    print(f"Saved {size} bytes. Use 16 kHz mono PCM with this model.")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)

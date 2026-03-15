# AI Karaoke Remixer Roadmap

## Sprint 1
- Backend skeleton: FastAPI app with `/health` and WebSocket echo for audio chunks.
- Frontend skeleton: Next.js page with mic capture, waveform display, WebSocket echo playback.
- Dev tooling: Docker Compose, lint/format, pre-commit, make targets (dev, test, format).
- Latency harness: simple RTT logger for chunk send/receive in browser console.

## Sprint 2
- Audio pipeline: RNNoise (or WebRTC VAD) + pitch correction (PyTorch/onnxruntime), streaming chunks.
- Voice conversion: integrate a single pretrained VC + HiFi-GAN; Torchscript/ONNX export; config for one preset.
- Before/After mixer in frontend with toggle.

## Sprint 3
- Beat/onset detection (librosa/essentia) -> event stream.
- Light orchestrator: JSON pattern generator; mock DMX/WLED sender; UI preview of colors over time.
- Multiple presets (3 artist styles), parameter tuning UI (wet/dry mix, formant shift).

## Sprint 4
- Packaging: record & download session, simple auth/rate limit, logging of model + preset versions.
- Demo polish: landing page explainer, in-app latency meter, canned sample song.
- Blog post draft and demo script in `docs/`.

## Stretch (time permitting)
- Personal voice clone (short reference capture) with explicit safety gating.
- Lyrics sync + on-screen karaoke.
- Edge/CPU mode with quantized models.

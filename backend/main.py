from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio
import numpy as np
import os

try:
    import onnxruntime as ort
except ImportError:
    ort = None

app = FastAPI(title="AI Karaoke Remixer Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws/audio")
async def audio_ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive()
            # Pass-through echo for now; future step: noise suppression + VC inference.
            if "bytes" in data and data["bytes"] is not None:
                enhanced = await enhance_audio(data["bytes"])
                await ws.send_bytes(enhanced)
            elif "text" in data and data["text"] is not None:
                await ws.send_text(data["text"])
            else:
                await ws.send_text("unsupported payload")
    except WebSocketDisconnect:
        return


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


# --- Simple AI hook: ONNX denoiser if available ---
_denoiser_session = None
_denoiser_input = None
_denoiser_output = None


def load_denoiser():
    global _denoiser_session, _denoiser_input, _denoiser_output
    if ort is None:
        return
    model_path = os.getenv("DENOISER_MODEL", os.path.join(os.path.dirname(__file__), "..", "models", "denoise.onnx"))
    if not os.path.isfile(model_path):
        return
    _denoiser_session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    inputs = _denoiser_session.get_inputs()
    outputs = _denoiser_session.get_outputs()
    _denoiser_input = inputs[0].name if inputs else None
    _denoiser_output = outputs[0].name if outputs else None


async def enhance_audio(raw: bytes) -> bytes:
    """
    Expects 16-bit mono PCM. If ONNX denoiser is available, apply; otherwise passthrough.
    """
    if _denoiser_session is None:
        load_denoiser()
    if _denoiser_session is None or _denoiser_input is None or _denoiser_output is None:
        return raw
    # Convert bytes to float32 [-1,1]
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    pcm = np.expand_dims(pcm, axis=0)  # shape (1, N)
    out = _denoiser_session.run([_denoiser_output], {_denoiser_input: pcm})[0].squeeze()
    out = np.clip(out, -1.0, 1.0)
    return (out * 32767.0).astype(np.int16).tobytes()

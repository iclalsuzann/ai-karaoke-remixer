from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio

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
                await ws.send_bytes(data["bytes"])
            elif "text" in data and data["text"] is not None:
                await ws.send_text(data["text"])
            else:
                await ws.send_text("unsupported payload")
    except WebSocketDisconnect:
        return


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

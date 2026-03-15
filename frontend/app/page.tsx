"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "recording" | "connecting" | "streaming";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const lastSendRef = useRef<number>(0);
  const audioQueueRef = useRef<Blob[]>([]);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, []);

  const appendLog = (line: string) =>
    setLog((l) => [...l.slice(-5), `${new Date().toLocaleTimeString()} ${line}`]);

  const connectWs = () => {
    const ws = new WebSocket("ws://localhost:8000/ws/audio");
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      appendLog("WebSocket connected");
      setStatus("streaming");
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        appendLog(`text: ${event.data}`);
      } else if (event.data instanceof ArrayBuffer) {
        if (lastSendRef.current) {
          setLatencyMs(Math.round(performance.now() - lastSendRef.current));
        }
        audioQueueRef.current.push(new Blob([event.data], { type: "audio/webm" }));
        playBuffered();
      }
    };
    ws.onclose = () => {
      appendLog("WebSocket closed");
      setStatus("idle");
    };
    ws.onerror = () => appendLog("WebSocket error");
    wsRef.current = ws;
  };

  const playBuffered = () => {
    if (audioQueueRef.current.length === 0) return;
    const next = audioQueueRef.current.shift();
    if (!next) return;
    const url = URL.createObjectURL(next);
    setPlayingUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const startStreaming = async () => {
    if (status !== "idle") return;
    setStatus("connecting");
    appendLog("Requesting mic access");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    mediaRecorderRef.current = mr;
    connectWs();
    mr.ondataavailable = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (e.data.size > 0) {
        lastSendRef.current = performance.now();
        wsRef.current.send(e.data);
      }
    };
    mr.start(200); // 200ms chunks
    setStatus("recording");
    appendLog("Recording started");
  };

  const stopStreaming = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("idle");
    appendLog("Stopped");
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px",
        maxWidth: 1000,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 12 }}>AI Karaoke Remixer</h1>
      <p style={{ opacity: 0.8, marginBottom: 24 }}>
        WebRTC/WebSocket prototipi — şu an echo modunda, stil transferi sonraki adım.
      </p>

      <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Canlı Akış</h2>
          <p style={{ marginBottom: 12 }}>
            Durum: <strong>{status}</strong>{" "}
            {latencyMs !== null && <span>(RTT ~{latencyMs} ms)</span>}
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              className="button"
              disabled={status !== "idle"}
              onClick={startStreaming}
            >
              Mikrofonu Aç ve Gönder
            </button>
            <button className="button" disabled={status === "idle"} onClick={stopStreaming}>
              Durdur
            </button>
          </div>

          <div style={{ marginTop: 20 }}>
            <h3>Before / After</h3>
            <audio
              controls
              src={playingUrl ?? undefined}
              style={{ width: "100%", marginTop: 8 }}
            />
            <p style={{ fontSize: 12, opacity: 0.7 }}>
              Şimdilik echo; stil transferi eklendiğinde “After” kanalı olacak.
            </p>
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Log</h2>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              background: "rgba(0,0,0,0.3)",
              padding: 12,
              borderRadius: 8,
              minHeight: 180,
            }}
          >
            {log.slice().reverse().map((l, idx) => (
              <div key={idx}>{l}</div>
            ))}
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Sonraki Adımlar</h2>
        <ul>
          <li>Noise suppression + pitch correction pipeline (RNNoise + torch/onnxruntime).</li>
          <li>Voice conversion modeli (tek sanatçı preset’i) ve “After” kanalı.</li>
          <li>Beat detection ve ışık pattern JSON üretimi + frontend önizleme.</li>
        </ul>
      </section>
    </main>
  );
}

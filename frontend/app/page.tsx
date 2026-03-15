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
  const audioCtxRef = useRef<AudioContext | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const wetGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [vu, setVu] = useState(0);
  const [lightColor, setLightColor] = useState("#9f7aea");

  useEffect(() => {
    return () => {
      stopStreaming();
      audioCtxRef.current?.close();
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
    setupLocalFx(stream);
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

  const setupLocalFx = (stream: MediaStream) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    const source = ctx.createMediaStreamSource(stream);

    // Dry path (before)
    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.9;
    dryGainRef.current = dryGain;

    // Wet path (after) with simple chain: highpass -> compressor -> delay -> reverb
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 120;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -25;
    comp.knee.value = 20;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;

    const delay = ctx.createDelay();
    delay.delayTime.value = 0.045;

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulseResponse(ctx);

    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.8;
    wetGainRef.current = wetGain;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;

    // Routing
    source.connect(dryGain).connect(ctx.destination);
    source.connect(hp).connect(comp).connect(delay).connect(reverb).connect(wetGain).connect(ctx.destination);
    source.connect(analyser);

    animateVU();
  };

  const makeImpulseResponse = (ctx: AudioContext) => {
    const length = ctx.sampleRate * 0.9;
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const buf = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        buf[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.5);
      }
    }
    return impulse;
  };

  const animateVU = () => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] - 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length) / 128; // 0..1
      setVu(rms);
      // simple beat-ish pulse to drive light color
      const hue = Math.min(300, 180 + rms * 400);
      setLightColor(`hsl(${hue}, 85%, 65%)`);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  const setFxMix = (value: number) => {
    if (!dryGainRef.current || !wetGainRef.current) return;
    const dry = Math.max(0, Math.min(1, 1 - value));
    const wet = Math.max(0, Math.min(1, value));
    dryGainRef.current.gain.value = dry;
    wetGainRef.current.gain.value = wet;
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
        WebRTC/WebSocket prototipi + tarayıcı içi “After” efekt zinciri (reverb + delay + comp).
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
            <audio controls src={playingUrl ?? undefined} style={{ width: "100%", marginTop: 8 }} />
            <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
              “Before”: doğrudan monitor; “After”: reverb+delay+compressor (basit stil efekti).
            </p>
            <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>
              After Mix
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                defaultValue={0.6}
                onChange={(e) => setFxMix(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </label>
          </div>

          <div style={{ marginTop: 20 }}>
            <h3>Işık Önizleme</h3>
            <div
              style={{
                height: 24,
                borderRadius: 12,
                background: `linear-gradient(90deg, ${lightColor}, #111)`,
                boxShadow: `0 0 ${12 + vu * 24}px ${lightColor}`,
                transition: "background 80ms linear, box-shadow 80ms linear",
              }}
            />
            <div
              style={{
                marginTop: 8,
                height: 8,
                width: `${Math.min(100, Math.round(vu * 140))}%`,
                maxWidth: "100%",
                background: "#22c55e",
                borderRadius: 4,
                transition: "width 60ms linear",
              }}
            />
            <p style={{ fontSize: 12, opacity: 0.7 }}>
              RMS tabanlı vurgu; backend beat/onset geldiğinde DMX/WLED’e gönderilecek.
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

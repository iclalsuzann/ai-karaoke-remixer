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
  const recordedChunksRef = useRef<Blob[]>([]);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const wetGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recordBusRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mixRef = useRef<number>(0.6);
  const [vu, setVu] = useState(0);
  const [lightColor, setLightColor] = useState("#9f7aea");
  const [monitorOn, setMonitorOn] = useState(true);

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
      }
    };
    ws.onclose = () => {
      appendLog("WebSocket closed");
      setStatus("idle");
    };
    ws.onerror = () => appendLog("WebSocket error");
    wsRef.current = ws;
  };

  const pickMimeType = () => {
    const preferred = [
      "audio/webm;codecs=pcm",
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
    ];
    for (const mt of preferred) {
      if ((window as any).MediaRecorder && MediaRecorder.isTypeSupported(mt)) return mt;
    }
    return undefined;
  };

  const startStreaming = async () => {
    if (status !== "idle") return;
    setStatus("connecting");
    appendLog("Requesting mic access");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunksRef.current = [];
    const recordStream = setupLocalFx(stream);
    const mr = new MediaRecorder(recordStream, {
      mimeType: pickMimeType(),
      audioBitsPerSecond: 256_000,
    });
    mediaRecorderRef.current = mr;
    connectWs();
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          lastSendRef.current = performance.now();
          wsRef.current.send(e.data);
        }
      }
    };
    mr.onstop = async () => {
      if (recordedChunksRef.current.length > 0) {
        const url = await buildPlaybackUrl(recordedChunksRef.current);
        setPlayingUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        recordedChunksRef.current = [];
      }
    };
    mr.start(100); // 100ms chunks for smoother playback
    setStatus("recording");
    appendLog("Recording started");
  };

  const setupLocalFx = (stream: MediaStream) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    const recordBus = ctx.createMediaStreamDestination();
    recordBusRef.current = recordBus;
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
    wetGain.gain.value = mixRef.current;
    wetGainRef.current = wetGain;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;

    // Routing
    // Monitor to speakers
    source.connect(dryGain).connect(ctx.destination);
    source.connect(hp).connect(comp).connect(delay).connect(reverb).connect(wetGain).connect(ctx.destination);

    // Record bus (clean after FX)
    source.connect(dryGain);
    hp.connect(comp).connect(delay).connect(reverb).connect(wetGain);
    dryGain.connect(recordBus);
    wetGain.connect(recordBus);
    source.connect(analyser);

    animateVU();
    applyMix();
    return recordBus.stream;
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
    mixRef.current = Math.max(0, Math.min(1, value));
    applyMix();
  };

  const stopStreaming = () => {
    mediaRecorderRef.current?.stop(); // triggers onstop to build playback URL
    mediaRecorderRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("idle");
    appendLog("Stopped");
  };

  const buildPlaybackUrl = async (chunks: Blob[]) => {
    const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
    const arrayBuffer = await blob.arrayBuffer();
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const decoded = await audioCtxRef.current.decodeAudioData(arrayBuffer.slice(0));
    const wavBlob = audioBufferToWav(decoded);
    return URL.createObjectURL(wavBlob);
  };

  const audioBufferToWav = (buffer: AudioBuffer) => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const result = new ArrayBuffer(length);
    const view = new DataView(result);
    let offset = 0;

    const writeString = (s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
    };

    const floatTo16BitPCM = (channelData: Float32Array, offsetStart: number) => {
      let pos = offsetStart;
      for (let i = 0; i < channelData.length; i++, pos += 2) {
        let s = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      return pos;
    };

    writeString("RIFF");
    view.setUint32(offset, length - 8, true);
    offset += 4;
    writeString("WAVE");
    writeString("fmt ");
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, numOfChan, true);
    offset += 2;
    view.setUint32(offset, buffer.sampleRate, true);
    offset += 4;
    view.setUint32(offset, buffer.sampleRate * numOfChan * 2, true);
    offset += 4;
    view.setUint16(offset, numOfChan * 2, true);
    offset += 2;
    view.setUint16(offset, 16, true);
    offset += 2;
    writeString("data");
    view.setUint32(offset, length - offset - 4, true);
    offset += 4;

    const channelData = [];
    for (let i = 0; i < numOfChan; i++) {
      channelData.push(buffer.getChannelData(i));
    }

    let interleavedOffset = offset;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numOfChan; channel++) {
        const sample = channelData[channel][i];
        let s = Math.max(-1, Math.min(1, sample));
        view.setInt16(interleavedOffset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        interleavedOffset += 2;
      }
    }

    return new Blob([result], { type: "audio/wav" });
  };

  const toggleMonitor = (checked: boolean) => {
    setMonitorOn(checked);
    applyMix(checked);
  };

  const applyMix = (monitorState = monitorOn) => {
    if (!dryGainRef.current || !wetGainRef.current) return;
    const wet = monitorState ? mixRef.current : 0;
    const dry = monitorState ? 1 - mixRef.current : 0;
    dryGainRef.current.gain.value = dry;
    wetGainRef.current.gain.value = wet;
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
          <label style={{ display: "block", marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            <input
              type="checkbox"
              checked={monitorOn}
              onChange={(e) => toggleMonitor(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Kendimi duymak (monitor). Eko rahatsız ediyorsa kapat.
          </label>

          <div style={{ marginTop: 20 }}>
            <h3>Before / After</h3>
            <audio controls src={playingUrl ?? undefined} style={{ width: "100%", marginTop: 8 }} />
            <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
              Kaydı durdurduktan sonra burada dinleyebilirsin. Canlı “After” efekti mikser kontrolü aşağıda.
            </p>
            <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>
              After Mix (canlı FX)
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

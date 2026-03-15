# AI Karaoke Remixer

Tarayıcıda canlı sesini yakalayıp kayıt sonrası çoklu efektlerle yeniden şekillendiren demo. Portföy odaklı: WebAudio işleme, WebSocket akışı ve modern UI’ı bir arada gösterir.

## Mevcut Özellikler
- Canlı mikrofon yakalama, monitor aç/kapa ve input gain ayarı.
- Kayıt sonrası playback (tek blob, WAV render).
- Çoklu efektler: Echo, Hall, Plate, Chorus, Lo‑Fi, Robot/Distortion; kombinasyon yapılabilir.
- Hazır preset’ler (Pop Live, Studio Tight, Robot Vox, Arena Echo, Lo-Fi Tape, Plate Shine) tek tıkla FX + ıslak oranı ayarlar.
- Kayıt efekt seviyesi (wet mix) ve canlı FX dengesi slider’ları.
- Basit ışık önizleme barı (ses enerjisi tepki veriyor).
- WebSocket RTT göstergesi; WS yoksa lokal kayıt devam eder.

## Çalıştırma (lokal)
Backend (echo WS)  
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Frontend  
```bash
cd frontend
npm install
npm run dev -- --hostname 0.0.0.0 --port 3000
```
Varsayılan WS: `ws://localhost:8000/ws/audio`.

## Canlı Yayın Önerisi
- Backend: Railway/Render/Fly’de `uvicorn main:app --host 0.0.0.0 --port $PORT`.
- Frontend: Vercel’de root `frontend/`, env `NEXT_PUBLIC_WS_URL=wss://<backend>/ws/audio`.

## Notlar
- Şu an backend sadece echo yapıyor; efektler tarayıcı içinde offline render ediliyor.
- Pitch/formant, noise gate/de-esser ve beat-synced ışık gibi özellikler sonraki sürümlere bırakıldı.

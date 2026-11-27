# TEFECİ // Faz 2 — Canlı Piyasa & Tahsilat Terminali

Gerçek zamanlı **Binance USD-M Futures** WebSocket verisi, 5 algoritmik mahalle trader'ı, bileşik faizli borç defteri, **Supabase PostgreSQL Realtime** senkronizasyonu ve neon **Dopamin UI** kontrol terminali.

## Öne Çıkan Özellikler (Faz 2)

- **Gerçek Zamanlı Binance Futures Akışı (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`)**: `bookTicker`, `aggTrade`, `markPrice@1s`, `forceOrder`, `depth20@100ms` + OKX Swap Open Interest otomatik fallback.
- **Gerçekçi Futures Simülasyon Motoru**: Emir defteri VWAP slippage yürüyüşü, %0.04 taker / %0.02 maker komisyonu ve Binance kademeli Maintenance Margin Bracket tablosuyla izole likidasyon hesabı.
- **5 Algoritmik Trader Karakteri**:
  - **Selo Roket** (`75x`): 1 saniyelik agresif hacim patlaması & momentum scalper.
  - **Fitilci Mehmet** (`50x`): Büyük `forceOrder` likidasyon fitil dönüş avcısı.
  - **Fonlama Nuri** (`25x`): Funding rate & Open Interest ayrışma arbitrajcısı.
  - **Tahta Kemal** (`20x`): Emir defteri dengesizliği (OBI) & spoofing filtresi.
  - **Madam Sevil** (`8x`): Soğukkanlı 1s Bollinger Alt Bandı + RSI ortalamaya dönüş.
- **Supabase Realtime + Komut Kuyruğu (RLS Etkin)**:
  - `traders`, `debts`, `positions`, `events`, `equity_snapshots` tabloları.
  - Arayüzden gönderilen **FAİZİ KATLA**, **ÇIRAĞI GÖNDER** (3 işlem korku modu & 1/2 kaldıraç), **TAHSİL ET**, **BORÇ VER**, **ZORLA KAPAT** ve **PİYASAYI KIŞKIRT** emirleri Python worker tarafından canlı işlenir.
- **Dopamin UI & Ses Motoru**:
  - Tailwind CSS v4 neon terminal tasarımı, canlı etkileşimli Equity & PnL SVG eğrisi, likidasyon tehlike barları, filtreli İntikam Defteri (JSON & Markdown export), Web Audio API procedural SFX + Türkçe Web Speech TTS ve likidasyon konfeti/ekran flaşı.

## Kurulum

1. **Veritabanı**: `supabase/schema.sql` dosyasını Supabase projenizde çalıştırın.
2. **Ortam Değişkenleri**: `.env.example` dosyasını `.env` olarak kopyalayıp kendi `SUPABASE_URL`, `SUPABASE_KEY` (service role) ve `VITE_SUPABASE_*` (anon) bilgilerinizi girin.
3. **Backend Worker**:
   ```bash
   pip install -r requirements.txt
   python -m src.backend.worker
   ```
4. **Frontend Terminali**:
   ```bash
   npm install
   npm run dev
   ```
5. **Testler**:
   ```bash
   pytest -v
   ```

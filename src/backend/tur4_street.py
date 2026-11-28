"""
TEFECI Tur 4 — 8-Agent Deterministic Street Simulation Engine.
Zero randomness, zero mock prices:
  - Riza RADAR: Real Binance/OKX funding-rate parsing & candle gap diagnostics
  - Kemal TAHTA: Rate-limited candle persistence guard
  - Nuri FONLAMA: Real-data-driven human behavioral flaw / tilt strategies
  - Selo ROKET: Anti-repetition street-slang voice engine (male/female + prosody shift)
  - Sevil DOPAMIN: Deterministic Yeralti Kahvehanesi zone mapper
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

TraderId = Literal["selo", "mehmet", "nuri", "kemal", "sevil", "tefeci"]
VoiceGender = Literal["masculine", "feminine"]
StreetEventKind = Literal[
    "big_profit",
    "big_loss",
    "liquidation",
    "wick_catch",
    "funding_squeeze",
    "debt_pressure",
    "tilt_revenge",
]
KahvehaneZone = Literal[
    "likidasyon_cukuru",
    "tefeci_masasi",
    "kaldirac_masasi",
    "cay_ocagi",
]

INTERVAL_MS: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
}

SPEAKER_GENDERS: dict[str, VoiceGender] = {
    "selo": "masculine",
    "mehmet": "masculine",
    "nuri": "masculine",
    "kemal": "masculine",
    "tefeci": "masculine",
    "sevil": "feminine",
}


@dataclass(frozen=True)
class FundingSnapshot:
    symbol: str
    funding_rate: float
    next_funding_ms: int
    source: str


def parse_okx_funding_rate(symbol: str, payload: dict[str, Any]) -> FundingSnapshot:
    """Parse real OKX /api/v5/public/funding-rate payload."""
    if payload.get("code") != "0":
        raise ValueError("OKX funding payload error")
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        raise ValueError("OKX funding payload missing data")
    row = data[0]
    rate = float(row["fundingRate"])
    next_ms = int(row.get("nextFundingTime") or 0)
    return FundingSnapshot(
        symbol=symbol.upper(),
        funding_rate=rate,
        next_funding_ms=next_ms,
        source="okx_swap",
    )


def detect_candle_gaps(timestamps_ms: list[int], interval: str) -> list[tuple[int, int]]:
    """Riza RADAR: Report any real missing OHLCV candle gaps between consecutive timestamps."""
    step = INTERVAL_MS.get(interval)
    if step is None:
        raise ValueError(f"Unsupported interval: {interval}")
    if len(timestamps_ms) < 2:
        return []
    ordered = sorted(set(int(ts) for ts in timestamps_ms))
    gaps: list[tuple[int, int]] = []
    for prev_ts, cur_ts in zip(ordered, ordered[1:]):
        if cur_ts - prev_ts > step:
            gaps.append((prev_ts + step, cur_ts - step))
    return gaps


def should_persist_candle_batch(
    last_persisted_ms: int | None, now_ms: int, cooldown_ms: int = 30_000
) -> bool:
    """Kemal TAHTA: Rate-limit guard so Supabase candle upserts never spam DB/API limits."""
    if last_persisted_ms is None:
        return True
    return (now_ms - last_persisted_ms) >= cooldown_ms


@dataclass(frozen=True)
class HumanTraderDecision:
    side: Literal["LONG", "SHORT"] | None
    leverage: int
    flaw_tag: str
    reason: str


def evaluate_human_trader_decision(
    *,
    trader_id: str,
    base_leverage: int,
    fear_trades_remaining: int,
    mood: str,
    wins: int,
    losses: int,
    change_pct_24h: float,
    imbalance: float,
    funding_rate: float,
) -> HumanTraderDecision:
    """
    Nuri FONLAMA: Deterministic human-like strategy + realistic behavioral mistakes
    driven strictly by real market telemetry (price %, OBI, real funding rate, PnL state).
    """
    eff_lev = max(2, base_leverage // 2) if fear_trades_remaining > 0 else base_leverage
    abs_chg = abs(change_pct_24h)
    abs_obi = abs(imbalance)
    abs_fund = abs(funding_rate)

    if trader_id == "selo":
        if abs_chg >= 0.45 or abs_obi >= 0.32:
            side: Literal["LONG", "SHORT"] = (
                ("LONG" if imbalance >= 0 else "SHORT")
                if abs_obi >= 0.32
                else ("LONG" if change_pct_24h >= 0 else "SHORT")
            )
            # Human FOMO/Tilt revenge mistake: chases breakout with bumped leverage after losses
            if mood in ("tilted", "panicked") or losses > wins:
                revenge_lev = min(75, eff_lev + 15) if fear_trades_remaining == 0 else eff_lev
                return HumanTraderDecision(
                    side=side,
                    leverage=revenge_lev,
                    flaw_tag="FOMO_TILT_REVENGE",
                    reason=f"Tilt intikam girişi! FOMO ile {revenge_lev}x daldı (24s {change_pct_24h:+.2f}%, OBI {imbalance:+.2f})",
                )
            return HumanTraderDecision(
                side=side,
                leverage=eff_lev,
                flaw_tag="MOMENTUM_CHASE",
                reason=f"Hacim/OBI patlaması ({change_pct_24h:+.2f}%, OBI {imbalance:+.2f})",
            )

    elif trader_id == "mehmet":
        if abs_chg >= 0.9 or abs_obi >= 0.28:
            # Human mistake: tries catching falling knife counter-wick too early during strong bleed
            if abs_chg >= 2.2:
                side = "LONG" if change_pct_24h < 0 else "SHORT"
                return HumanTraderDecision(
                    side=side,
                    leverage=min(50, eff_lev + 5) if fear_trades_remaining == 0 else eff_lev,
                    flaw_tag="FALLING_KNIFE_WICK",
                    reason=f"Erken fitil avı hatası — düşen bıçağa atladı (24s {change_pct_24h:+.2f}%)",
                )
            side = "LONG" if change_pct_24h < 0 else "SHORT"
            return HumanTraderDecision(
                side=side,
                leverage=eff_lev,
                flaw_tag="COUNTER_WICK",
                reason=f"Fitil tepki taraması (24s {change_pct_24h:+.2f}%, OBI {imbalance:+.2f})",
            )

    elif trader_id == "nuri":
        if abs_fund >= 0.00004:
            side = "SHORT" if funding_rate > 0 else "LONG"
            # Human mistake: overconfident funding fade when momentum is ripping against him
            against_trend = (side == "SHORT" and change_pct_24h >= 1.5) or (
                side == "LONG" and change_pct_24h <= -1.5
            )
            flaw = "FUNDING_SQUEEZE_TRAP" if against_trend else "FUNDING_ARBITRAGE"
            reason = (
                f"İnatçı funding tersi — squeeze riski! (Funding {funding_rate * 100:+.4f}%)"
                if against_trend
                else f"Canlı funding arbitrajı (Funding {funding_rate * 100:+.4f}%)"
            )
            return HumanTraderDecision(side=side, leverage=eff_lev, flaw_tag=flaw, reason=reason)

    elif trader_id == "kemal":
        if abs_obi >= 0.18:
            side = "LONG" if imbalance >= 0 else "SHORT"
            stubborn = losses > wins and abs_obi >= 0.35
            return HumanTraderDecision(
                side=side,
                leverage=eff_lev,
                flaw_tag="STUBBORN_BOOK_BIAS" if stubborn else "OBI_PRESSURE",
                reason=(
                    f"Tahta inadı — derinlik tersine dönse de yüklendi (OBI {imbalance:+.2f})"
                    if stubborn
                    else f"Gerçek tahta dengesizliği (OBI {imbalance:+.2f})"
                ),
            )

    elif trader_id == "sevil":
        if abs_chg >= 1.3 or (abs_obi >= 0.25 and abs_fund >= 0.00003):
            side = "SHORT" if change_pct_24h > 1.0 else "LONG"
            greed_slip = abs_fund >= 0.00012 and fear_trades_remaining == 0
            lev = min(15, eff_lev + 3) if greed_slip else eff_lev
            return HumanTraderDecision(
                side=side,
                leverage=lev,
                flaw_tag="RARE_GREED_SLIP" if greed_slip else "DISCIPLINED_MEAN_REV",
                reason=(
                    f"Nadir hırs anı — kademeyi {lev}x yaptı (Funding {funding_rate * 100:+.4f}%)"
                    if greed_slip
                    else f"Soğukkanlı ortalamaya dönüş (24s {change_pct_24h:+.2f}%)"
                ),
            )

    return HumanTraderDecision(side=None, leverage=eff_lev, flaw_tag="WAIT", reason="Sinyal bekleniyor")


STREET_BANK: dict[StreetEventKind, list[str]] = {
    "big_profit": [
        "Tahtayı söküp aldık reis, çaylar bu masadan!",
        "Tefeci defteri açmadan kârı cebe indirdik, gözü kamaştı!",
        "Sokak soğuk ama bizim pozisyon alev gibi kâr yazıyor!",
        "Fitilin ucundan yakaladık, masa bugün bize çalışıyor!",
        "Kasa şişti, senetçinin kapısına güle oynaya gidiyoruz!",
        "Bu hamle kahvehanenin duvarına asılır, tertemiz kâr!",
        "Döviz bürosunun camı titredi, kasayı doldurduk!",
    ],
    "big_loss": [
        "Fena ters köşe yedik, çay bile boğazımda kaldı!",
        "Tahta altımızdan kaydı, panikle erken dalmanın bedeli!",
        "Göz göre göre fitile kafa attık, masa fena vurdu!",
        "Kasa eridi, tefecinin ayak sesleri koridordan geliyor!",
        "İnat ettik piyasa affetmedi, ders pahalıya patladı!",
        "Stopu geç görünce sokak ışıkları söndü, ağır yara!",
        "Borsa acımadı, bir bardak soğuk su söyleyin!",
    ],
    "liquidation": [
        "SİREN ÇALDI! Pozisyon duman oldu, likidasyon çukuruna düştük!",
        "FİTİL KAFAMIZI KOPARDI! Teminat sıfırlandı, geçmiş olsun!",
        "Bitti! Tahta bizi yuttu, tefeci kapıya dayandı!",
        "Kaldıracın gazabı! Tek mumda hesap kül oldu!",
        "Kahvehane sustu, masadan likidasyon dumanı tütüyor!",
        "Sıfırlandık reis! Acımasız fitil tüm marjini süpürdü!",
        "Işıklar kapandı, likidasyon defterine yeni satır yazıldı!",
    ],
    "wick_catch": [
        "Tam iğnenin ucundan yakaladık, fitil avı şov başladı!",
        "Herkes korkarken biz fitilin dibine oturduk!",
        "Milimetrik hamle! Borsa iğnesini cebimize soktuk!",
        "Saniyelik okuma! Kahvehanede alkış koptu!",
        "Fitil avcısı affetmez, iğneyi tam on ikiden vurduk!",
        "Piyasa şaşırttı ama gözümüz kaçırmadı, harika giriş!",
        "Gürültüde soğukkanlı kalan kazandı, tertemiz fitil!",
    ],
    "funding_squeeze": [
        "Fonlama oranı fırladı, kalabalık ters tarafta sıkıştı!",
        "Herkes aynı yöne yığıldı, fonlama tuzağı çalışıyor!",
        "Döviz panosu kıpkırmızı, funding baskısı masayı yakıyor!",
        "Ters akıntıda bekleyenler fonlamayla eziliyor!",
        "Fonlama saati yaklaşıyor, kalabalığın nefesi kesildi!",
        "Kalabalık açgözlü olunca funding faturası ağır kesilir!",
        "Gerçek borsa fonlaması sinyal verdi, sıkışma başlıyor!",
    ],
    "debt_pressure": [
        "Senet saati doluyor, tefeci masada tespih çekiyor!",
        "Bileşik faiz kudurdu, gecikenin yüzü bembeyaz!",
        "Tefeci kapıya not bıraktı: vade doldu, ödeme vakti!",
        "Faiz sayacı tik tak işliyor, nefesler tutuldu!",
        "Borç defteri kabardı, çay ocağında fısıltılar arttı!",
        "Gecikme zammı bindi, masadaki stres tavan yaptı!",
        "Senet masada bekliyor, kasa dayanacak mı bakalım!",
    ],
    "tilt_revenge": [
        "Gözüm döndü, zararı tek hamlede çıkarmaya daldım — büyük hata!",
        "Tilt oldum reis, sinirle kaldıracı bastım, sonumuz hayrolsun!",
        "Sabır taştı! FOMO dürtüsüyle piyasanın peşine düştüm!",
        "Akıl durdu ego konuştu, intikam işlemine atladık!",
        "Kırmızı mum sinirimi bozdu, duygusal giriş yaptım!",
        "Planı çöpe attım, kahvehanede herkes 'yapma' diye bağırıyor!",
        "İnat gözü kör etti, yüksek kaldıraçla ateşe yürüdük!",
    ],
}


@dataclass(frozen=True)
class VoiceDelivery:
    speaker: str
    gender: VoiceGender
    text: str
    pitch: float
    rate: float


class AntiRepeatStreetVoice:
    """Selo ROKET: Anti-repetition street-slang picker with deterministic prosody modulation."""

    def __init__(self, history_window: int = 6) -> None:
        self.history_window = max(1, history_window)
        self._recent: list[str] = []

    def next_delivery(
        self,
        speaker: str,
        event_kind: StreetEventKind,
        seed_number: float,
    ) -> VoiceDelivery:
        bank = STREET_BANK[event_kind]
        gender: VoiceGender = SPEAKER_GENDERS.get(speaker, "masculine")

        # Deterministic index from real market number (ZERO random)
        basis = abs(int(round(seed_number * 100))) + len(self._recent) * 3 + len(speaker)
        start_idx = basis % len(bank)

        chosen = bank[start_idx]
        for offset in range(len(bank)):
            candidate = bank[(start_idx + offset) % len(bank)]
            if candidate not in self._recent:
                chosen = candidate
                break

        self._recent.append(chosen)
        if len(self._recent) > self.history_window:
            self._recent = self._recent[-self.history_window :]

        # Base gender/persona prosody + deterministic micro-variation so delivery never sounds robotic
        base_pitch = 1.18 if gender == "feminine" else (0.76 if speaker in ("kemal", "tefeci") else 0.96)
        base_rate = 1.06 if event_kind in ("liquidation", "tilt_revenge") else 0.96
        micro = ((basis % 7) - 3) * 0.03  # -0.09 .. +0.09
        pitch = round(max(0.65, min(1.45, base_pitch + micro)), 2)
        rate = round(max(0.82, min(1.28, base_rate + micro * 0.5)), 2)

        return VoiceDelivery(
            speaker=speaker,
            gender=gender,
            text=chosen,
            pitch=pitch,
            rate=rate,
        )


def assign_kahvehane_zone(
    *,
    mood: str,
    open_positions_count: int,
    open_pnl: float,
    overdue_debt_count: int,
    recent_liquidations: int,
) -> KahvehaneZone:
    """Sevil DOPAMIN: Deterministic placement inside the Yeralti Kahvehanesi & Doviz Burosu map."""
    if mood == "panicked" or (recent_liquidations > 0 and open_pnl <= -120):
        return "likidasyon_cukuru"
    if overdue_debt_count > 0:
        return "tefeci_masasi"
    if open_positions_count > 0:
        return "kaldirac_masasi"
    return "cay_ocagi"

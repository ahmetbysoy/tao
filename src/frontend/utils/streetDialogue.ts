// Selo ROKET + Nuri FONLAMA: Anti-repetition Turkish street-slang dialogue bank
// 100% deterministic selection (ZERO Math.random), distinct male/female voices,
// dynamic prosody modulation, strictly framed inside the fictional game universe.

export type TraderVoiceId = "selo" | "kemal" | "mehmet" | "nuri" | "sevil" | "tefeci";
export type VoiceGender = "masculine" | "feminine";

export type StreetEventKind =
  | "big_profit"
  | "big_loss"
  | "liquidation"
  | "wick_catch"
  | "funding_squeeze"
  | "debt_pressure"
  | "tilt_revenge"
  | "enter_neighborhood";

export interface StreetVoiceDelivery {
  speaker: TraderVoiceId;
  gender: VoiceGender;
  text: string;
  pitch: number;
  rate: number;
  eventKind: StreetEventKind;
}

export const SPEAKER_GENDERS: Record<TraderVoiceId, VoiceGender> = {
  selo: "masculine",
  mehmet: "masculine",
  nuri: "masculine",
  kemal: "masculine",
  tefeci: "masculine",
  sevil: "feminine",
};

export const SPEAKER_DISPLAY_NAMES: Record<TraderVoiceId, string> = {
  selo: "Selo Roket",
  mehmet: "Fitilci Mehmet",
  nuri: "Fonlama Nuri",
  kemal: "Tahta Kemal",
  sevil: "Madam Sevil",
  tefeci: "Tefeci Reis",
};

const STREET_BANKS: Record<StreetEventKind, string[]> = {
  big_profit: [
    "Tahtayı söküp aldık reis, kahvehanede çaylar benden!",
    "Tefeci defteri açmadan kârı cebe indirdik, masa şaşırdı!",
    "Sokak soğuk ama bizim pozisyon alev gibi yeşil yakıyor!",
    "Fitilin tam ucundan kaptık, kasa bugün bize çalışıyor!",
    "Döviz panosunun camı titredi, tertemiz kâr yazdık!",
    "Bu hamle kahvehanenin duvarına asılır, disiplin kazandı!",
    "Senet masasına gülerek yürüyoruz, hesap şaha kalktı!",
  ],
  big_loss: [
    "Fena ters köşe yedik, çay bile boğazımda kaldı!",
    "Tahta altımızdan kaydı, panikle erken dalmanın bedeli ağır!",
    "Göz göre göre fitile kafa attık, masa affetmedi!",
    "Kasa eridi, tefecinin ayak sesleri koridordan geliyor!",
    "İnat ettik piyasa dersi verdi, pahalı bir tecrübe oldu!",
    "Stopu geç görünce sokak ışıkları söndü, fena yara aldık!",
    "Borsa acımadı reis, masaya bir bardak soğuk su söyle!",
  ],
  liquidation: [
    "SİREN ÇALDI! Pozisyon duman oldu, likidasyon çukuruna düştük!",
    "FİTİL KAFAMIZI KOPARDI! Teminat sıfırlandı, geçmiş olsun!",
    "Bitti! Tahta bizi yuttu, tefeci kapıya dayandı!",
    "Kaldıracın gazabı! Tek mumda tüm marjin kül oldu!",
    "Kahvehane buz kesti, masadan likidasyon dumanı tütüyor!",
    "Sıfırlandık reis! Acımasız iğne bütün teminatı süpürdü!",
    "Işıklar kapandı, intikam defterine kırmızı bir satır eklendi!",
  ],
  wick_catch: [
    "Tam iğnenin ucundan yakaladık, fitil avı şov başladı!",
    "Herkes paniklerken biz fitilin dibine oturduk!",
    "Milimetrik okuma! Borsa iğnesini cebimize soktuk!",
    "Saniyelik refleks! Kahvehanede masalar alkışladı!",
    "Fitil avcısı affetmez, yönü tam on ikiden vurduk!",
    "Piyasa şaşırttı ama gözümüz kaçırmadı, tertemiz tahmin!",
    "Gürültüde soğukkanlı kalan kazandı, nokta atışı!",
  ],
  funding_squeeze: [
    "Fonlama oranı fırladı, kalabalık ters tarafta sıkıştı!",
    "Herkes aynı yöne yığıldı, fonlama tuzağı devreye girdi!",
    "Döviz panosu kıpkırmızı, funding faturası ağır kesiliyor!",
    "Ters akıntıda bekleyenler fonlama saatinde eziliyor!",
    "Fonlama sayacı sıfıra iniyor, kalabalığın nefesi kesildi!",
    "Açgözlü sürü aynı masaya oturunca funding sopası iner!",
    "Gerçek borsa fonlaması alarm verdi, sıkışma başlıyor!",
  ],
  debt_pressure: [
    "Senet saati doluyor, tefeci masada tespih çekiyor!",
    "Bileşik faiz kudurdu, gecikenin yüzü bembeyaz!",
    "Tefeci masaya not bıraktı: vade bitti, tahsilat vakti!",
    "Faiz sayacı tik tak işliyor, kahvehanede çıt çıkmıyor!",
    "Borç defteri kabardı, çay ocağında fısıltılar yükseldi!",
    "Gecikme zammı bindi, masadaki tansiyon tavana vurdu!",
    "Senet masada bekliyor, bakalım kasa bu faize dayanacak mı!",
  ],
  tilt_revenge: [
    "Gözüm döndü, zararı tek hamlede çıkarmaya daldım — büyük hata!",
    "Tilt oldum reis, sinirle kaldıracı bastım, sonumuz hayrolsun!",
    "Sabır taştı! FOMO dürtüsüyle mumun tepesinden atladım!",
    "Akıl durdu ego konuştu, intikam işlemine daldık!",
    "Kırmızı mum sinirimi bozdu, plana uymadan giriş yaptım!",
    "Kahvehanede herkes 'dur' dedi ama inat gözümü kör etti!",
    "Duygusal karar verdik, yüksek kaldıraçla ateşe yürüdük!",
  ],
  enter_neighborhood: [
    "Yeraltı kahvehanesine hoş geldin reis! Döviz panosu canlı, bakalım bugün kim ayakta kalacak!",
    "Kapı açıldı! Çaylar taze, gerçek borsa verisi akıyor — simülasyon masası seni bekliyor!",
    "Tefeci masası hazır! Gerçek mumlar akıyor, senetler kesildi, oyun başlıyor!",
    "Döviz bürosu ışıkları yandı! Beş mahalle traderı gerçek tahtada kozlarını paylaşıyor!",
  ],
};

// Speaker-specific signature flair prefixes so Madam Sevil & male personas feel unmistakably distinct
const SPEAKER_PREFIX: Record<TraderVoiceId, string> = {
  sevil: "Madam Sevil bildiriyor: ",
  selo: "Selo Roket bağırdı: ",
  mehmet: "Fitilci Mehmet kesti: ",
  nuri: "Fonlama Nuri hesapladı: ",
  kemal: "Tahta Kemal fısıldadı: ",
  tefeci: "",
};

const RECENT_HISTORY_LIMIT = 6;
const recentSpokenRing: string[] = [];
let deliveryCounter = 0;

/**
 * Pick a guaranteed non-repeating street dialogue line and deterministic pitch/rate modulation.
 * ZERO Math.random(): index & prosody micro-shift come strictly from real market telemetry + sequence.
 */
export function pickNonRepeatingStreetDelivery(
  speaker: TraderVoiceId,
  eventKind: StreetEventKind,
  seedNumber: number,
  includeSpeakerPrefix = false
): StreetVoiceDelivery {
  const bank = STREET_BANKS[eventKind] ?? STREET_BANKS.big_profit;
  const gender = SPEAKER_GENDERS[speaker] ?? "masculine";
  deliveryCounter += 1;

  const basis =
    Math.abs(Math.round((Number.isFinite(seedNumber) ? seedNumber : 100) * 100)) +
    deliveryCounter * 5 +
    speaker.length * 7;

  const startIdx = basis % bank.length;
  let chosen = bank[startIdx];
  for (let offset = 0; offset < bank.length; offset++) {
    const candidate = bank[(startIdx + offset) % bank.length];
    if (!recentSpokenRing.includes(candidate)) {
      chosen = candidate;
      break;
    }
  }

  recentSpokenRing.push(chosen);
  if (recentSpokenRing.length > RECENT_HISTORY_LIMIT) {
    recentSpokenRing.splice(0, recentSpokenRing.length - RECENT_HISTORY_LIMIT);
  }

  // Distinct vocal base per persona + gender + event intensity
  let basePitch = 0.96;
  let baseRate = 0.98;
  if (speaker === "sevil") {
    basePitch = 1.24; // Distinct feminine contour
    baseRate = 0.95;
  } else if (speaker === "selo") {
    basePitch = 1.08;
    baseRate = 1.15;
  } else if (speaker === "kemal" || speaker === "tefeci") {
    basePitch = 0.76;
    baseRate = 0.88;
  } else if (speaker === "mehmet") {
    basePitch = 0.95;
    baseRate = 1.08;
  } else if (speaker === "nuri") {
    basePitch = 0.88;
    baseRate = 0.94;
  }

  if (eventKind === "liquidation" || eventKind === "tilt_revenge") {
    baseRate += 0.08;
    basePitch += speaker === "sevil" ? 0.06 : 0.04;
  } else if (eventKind === "debt_pressure") {
    baseRate -= 0.04;
  }

  // Deterministic micro-shift (-0.09 .. +0.09) so even repeated events sound organically varied
  const micro = ((basis % 7) - 3) * 0.03;
  const pitch = Number(Math.max(0.65, Math.min(1.48, basePitch + micro)).toFixed(2));
  const rate = Number(Math.max(0.82, Math.min(1.3, baseRate + micro * 0.5)).toFixed(2));

  const prefix = includeSpeakerPrefix ? SPEAKER_PREFIX[speaker] : "";
  return {
    speaker,
    gender,
    text: `${prefix}${chosen}`,
    pitch,
    rate,
    eventKind,
  };
}

"""Real-time Binance Futures WebSocket feed and REST client.

Connects to wss://fstream.binance.com/stream for combined streams:
  - <symbol>@bookTicker
  - <symbol>@aggTrade
  - <symbol>@markPrice@1s
  - <symbol>@forceOrder
  - <symbol>@depth20@100ms

Includes exponential backoff + jitter reconnection, a 30s silence watchdog,
and automatic OKX Swap REST fallback for Open Interest when Binance REST is geo-restricted.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List, Optional, Sequence, Tuple

import aiohttp
import websockets
from websockets.exceptions import ConnectionClosed

logger = logging.getLogger("tefeci.feed")

BINANCE_FSTREAM_BASE = "wss://fstream.binance.com/stream"
BINANCE_FAPI_REST = "https://fapi.binance.com"
OKX_PUBLIC_OI_REST = "https://www.okx.com/api/v5/public/open-interest"


@dataclass(frozen=True, slots=True)
class BookTickerEvent:
    symbol: str
    bid_price: float
    bid_qty: float
    ask_price: float
    ask_qty: float
    event_time_ms: int


@dataclass(frozen=True, slots=True)
class AggTradeEvent:
    symbol: str
    price: float
    qty: float
    quote_qty: float
    is_buyer_maker: bool  # True => market sell, False => market buy
    trade_time_ms: int


@dataclass(frozen=True, slots=True)
class MarkPriceEvent:
    symbol: str
    mark_price: float
    index_price: float
    funding_rate: float
    next_funding_time_ms: int
    event_time_ms: int


@dataclass(frozen=True, slots=True)
class ForceOrderEvent:
    symbol: str
    side: str  # "BUY" (short liquidated) or "SELL" (long liquidated)
    price: float
    avg_price: float
    qty: float
    notional_usdt: float
    trade_time_ms: int


@dataclass(frozen=True, slots=True)
class DepthEvent:
    symbol: str
    bids: Tuple[Tuple[float, float], ...]  # (price, qty)
    asks: Tuple[Tuple[float, float], ...]  # (price, qty)
    event_time_ms: int


MarketEvent = (
    BookTickerEvent | AggTradeEvent | MarkPriceEvent | ForceOrderEvent | DepthEvent
)
EventCallback = Callable[[MarketEvent], Awaitable[None]]


def build_stream_url(symbols: Sequence[str]) -> str:
    streams: List[str] = []
    for raw in symbols:
        sym = raw.lower().strip()
        streams.extend(
            [
                f"{sym}@bookTicker",
                f"{sym}@aggTrade",
                f"{sym}@markPrice@1s",
                f"{sym}@forceOrder",
                f"{sym}@depth20@100ms",
            ]
        )
    return f"{BINANCE_FSTREAM_BASE}?streams={'/'.join(streams)}"


def parse_stream_message(raw_payload: str) -> Optional[MarketEvent]:
    """Parse a Binance combined-stream JSON payload into a typed MarketEvent."""
    msg = json.loads(raw_payload)
    stream: str = msg.get("stream", "")
    data: dict = msg.get("data", {})
    if not stream or not data:
        return None

    if stream.endswith("@bookTicker"):
        return BookTickerEvent(
            symbol=data["s"],
            bid_price=float(data["b"]),
            bid_qty=float(data["B"]),
            ask_price=float(data["a"]),
            ask_qty=float(data["A"]),
            event_time_ms=int(data.get("E", int(time.time() * 1000))),
        )

    if stream.endswith("@aggTrade"):
        price = float(data["p"])
        qty = float(data["q"])
        return AggTradeEvent(
            symbol=data["s"],
            price=price,
            qty=qty,
            quote_qty=price * qty,
            is_buyer_maker=bool(data["m"]),
            trade_time_ms=int(data["T"]),
        )

    if "@markPrice" in stream:
        return MarkPriceEvent(
            symbol=data["s"],
            mark_price=float(data["p"]),
            index_price=float(data["i"]),
            funding_rate=float(data["r"]),
            next_funding_time_ms=int(data["T"]),
            event_time_ms=int(data["E"]),
        )

    if stream.endswith("@forceOrder"):
        o = data["o"]
        avg_price = float(o["ap"])
        qty = float(o["q"])
        return ForceOrderEvent(
            symbol=o["s"],
            side=o["S"],
            price=float(o["p"]),
            avg_price=avg_price,
            qty=qty,
            notional_usdt=avg_price * qty,
            trade_time_ms=int(o["T"]),
        )

    if "@depth" in stream:
        bids = tuple((float(p), float(q)) for p, q in data.get("b", []))
        asks = tuple((float(p), float(q)) for p, q in data.get("a", []))
        symbol = data.get("s") or stream.split("@")[0].upper()
        return DepthEvent(
            symbol=symbol,
            bids=bids,
            asks=asks,
            event_time_ms=int(data.get("E", int(time.time() * 1000))),
        )

    return None


class BinanceFuturesFeed:
    """Resilient async WebSocket feed for Binance USD-M Futures."""

    def __init__(
        self,
        symbols: Sequence[str] = ("btcusdt", "ethusdt", "solusdt"),
        silence_timeout_s: float = 30.0,
        base_backoff_s: float = 0.5,
        max_backoff_s: float = 30.0,
    ) -> None:
        self.symbols = [s.lower() for s in symbols]
        self.url = build_stream_url(self.symbols)
        self.silence_timeout_s = silence_timeout_s
        self.base_backoff_s = base_backoff_s
        self.max_backoff_s = max_backoff_s

        self._callbacks: List[EventCallback] = []
        self._running = False
        self._last_msg_monotonic = 0.0
        self.latest_book: Dict[str, BookTickerEvent] = {}
        self.latest_mark: Dict[str, MarkPriceEvent] = {}
        self.latest_depth: Dict[str, DepthEvent] = {}

    def on_event(self, callback: EventCallback) -> None:
        self._callbacks.append(callback)

    async def _dispatch(self, event: MarketEvent) -> None:
        if isinstance(event, BookTickerEvent):
            self.latest_book[event.symbol] = event
        elif isinstance(event, MarkPriceEvent):
            self.latest_mark[event.symbol] = event
        elif isinstance(event, DepthEvent):
            self.latest_depth[event.symbol] = event

        for cb in self._callbacks:
            try:
                await cb(event)
            except Exception:
                logger.exception("Unhandled error in market event callback")

    async def run(self) -> None:
        self._running = True
        attempt = 0
        while self._running:
            try:
                logger.info("Connecting to Binance Futures WSS: %s", self.url)
                async with websockets.connect(
                    self.url,
                    ping_interval=15,
                    ping_timeout=10,
                    max_queue=4096,
                ) as ws:
                    attempt = 0
                    self._last_msg_monotonic = time.monotonic()
                    sym_list = ", ".join(s.upper().replace("USDT", "") for s in self.symbols)
                    logger.info("[FEED] Connected to Binance Futures WSS (%s).", sym_list)

                    while self._running:
                        try:
                            raw = await asyncio.wait_for(
                                ws.recv(), timeout=self.silence_timeout_s
                            )
                        except asyncio.TimeoutError:
                            logger.warning(
                                "No WSS message for %.1fs; killing and reconnecting",
                                self.silence_timeout_s,
                            )
                            break

                        self._last_msg_monotonic = time.monotonic()
                        event = parse_stream_message(raw)
                        if event is not None:
                            await self._dispatch(event)

            except (ConnectionClosed, OSError, websockets.WebSocketException) as exc:
                logger.warning("WSS connection lost (%s)", exc)
            except asyncio.CancelledError:
                self._running = False
                raise
            except Exception:
                logger.exception("Unexpected error in BinanceFuturesFeed loop")

            if not self._running:
                break

            attempt += 1
            exp = min(self.max_backoff_s, self.base_backoff_s * (2 ** (attempt - 1)))
            jitter = random.uniform(0.0, min(1.0, exp * 0.5))
            delay = min(self.max_backoff_s, exp + jitter)
            logger.info("Reconnecting in %.2fs (attempt %d)", delay, attempt)
            await asyncio.sleep(delay)

    def stop(self) -> None:
        self._running = False


class BinanceRestClient:
    """Lightweight async REST client for Open Interest polling with OKX geo-fallback."""

    def __init__(self, session: Optional[aiohttp.ClientSession] = None) -> None:
        self._external_session = session
        self._session: Optional[aiohttp.ClientSession] = session
        self._binance_geo_blocked = False

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10)
            )
        return self._session

    @staticmethod
    def _to_okx_inst_id(symbol: str) -> str:
        sym = symbol.upper()
        if sym.endswith("USDT"):
            base = sym[:-4]
            return f"{base}-USDT-SWAP"
        return f"{sym}-SWAP"

    async def fetch_open_interest(self, symbol: str) -> float:
        session = await self._get_session()
        if not self._binance_geo_blocked:
            url = f"{BINANCE_FAPI_REST}/fapi/v1/openInterest"
            try:
                async with session.get(url, params={"symbol": symbol.upper()}) as resp:
                    if resp.status == 451:
                        self._binance_geo_blocked = True
                        logger.info(
                            "Binance REST OI geo-restricted (HTTP 451); switching to OKX Swap OI fallback"
                        )
                    else:
                        resp.raise_for_status()
                        data = await resp.json()
                        return float(data["openInterest"])
            except aiohttp.ClientError:
                self._binance_geo_blocked = True

        # Fallback: OKX public perpetual swap open interest (in coin units)
        inst_id = self._to_okx_inst_id(symbol)
        async with session.get(
            OKX_PUBLIC_OI_REST, params={"instType": "SWAP", "instId": inst_id}
        ) as resp:
            resp.raise_for_status()
            payload = await resp.json()
            rows = payload.get("data") or []
            if not rows:
                return 0.0
            return float(rows[0].get("oiCcy") or rows[0].get("oi") or 0.0)

    async def close(self) -> None:
        if self._external_session is None and self._session is not None:
            await self._session.close()

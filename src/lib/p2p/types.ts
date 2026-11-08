export type Side = "SELL" | "BUY";

export interface P2PAd {
  id: string;
  nickname: string;
  price: number;
  minAmount: number;
  maxAmount: number;
  executeRate: number;
  payments: string[];
  merchantLevel?: string;
  isOnline: boolean;
}

export interface AdQuery {
  cryptoCurrency: string;
  fiatCurrency: string;
  side: Side;
  page: number;
  pageSize: number;
}

export type DataSource = "direct" | "proxy" | "demo";

export interface FetchResult {
  ads: P2PAd[];
  source: DataSource;
  fetchedAt: number;
  total: number;
  /** какой именно прокси сработал (для режима proxy) */
  via?: string;
}

export type P2PErrorKind = "network" | "http" | "parse" | "auth";

export class P2PApiError extends Error {
  kind: P2PErrorKind;
  status?: number;
  hint?: string;

  constructor(kind: P2PErrorKind, message: string, options?: { status?: number; hint?: string }) {
    super(message);
    this.name = "P2PApiError";
    this.kind = kind;
    this.status = options?.status;
    this.hint = options?.hint;
  }
}

export interface WatchItem {
  id: string;
  crypto: string;
  fiat: string;
  side: Side;
}

export type AlertOp = "above" | "below";

export interface AlertRule {
  id: string;
  crypto: string;
  fiat: string;
  side: Side;
  op: AlertOp;
  target: number;
  active: boolean;
  lastTriggeredAt?: number;
}

export interface HistoryPoint {
  t: number;
  best: number;
}

export type ConnMode = "demo" | "direct" | "proxy";

/* ------------------------------------------------------------------ */
/* Децентрализованная P2P-сеть (WebRTC между браузерами)               */
/* ------------------------------------------------------------------ */

/** Лучший курс по паре, полученный напрямую от другого пользователя */
export interface PeerQuote {
  crypto: string;
  fiat: string;
  side: Side;
  best: number | null;
  onlineCount: number;
  totalCount: number;
  fetchedAt: number;
}

export type PeerStatus = "signaling" | "connecting" | "connected" | "failed" | "closed";

export interface PeerInfo {
  id: string;
  name: string;
  status: PeerStatus;
  connectedAt: number;
  lastSeen: number;
  /** RTT последнего ping/pong, мс */
  rttMs: number | null;
}

/** Что прислал пир (его данные рынка и списки) */
export interface PeerPayload {
  name: string;
  at: number;
  quotes: PeerQuote[];
  watchlist?: WatchItem[];
  alerts?: AlertRule[];
}

/** Состояние для синхронизации между вкладками одного браузера */
export interface SyncStatePayload {
  crypto: string;
  fiat: string;
  side: Side;
  watchlist: WatchItem[];
  alerts: AlertRule[];
  history: Record<string, HistoryPoint[]>;
  settings: {
    mode: ConnMode;
    proxyList: string[];
    refreshSec: number;
    pageSize: number;
    peerName: string;
    tabSync: boolean;
  };
}

export interface PairQuote {
  bestBuy: number | null; // минимальная цена среди SELL-объявлений (мы покупаем)
  bestSell: number | null; // максимальная цена среди BUY-объявлений (мы продаём)
  onlineCount: number;
  totalCount: number;
}

export const CRYPTOS = ["USDT", "USDC", "BTC", "ETH", "TON", "BNB"] as const;
export const FIATS = ["RUB", "USD", "EUR", "KZT", "UAH", "TRY", "AED"] as const;

export const FIAT_LABEL: Record<string, string> = {
  RUB: "Рубль",
  USD: "Доллар США",
  EUR: "Евро",
  KZT: "Тенге",
  UAH: "Гривна",
  TRY: "Лира",
  AED: "Дирхам",
};

export const SIDE_LABEL: Record<Side, string> = {
  SELL: "Купить криптовалюту",
  BUY: "Продать криптовалюту",
};

export function pairKey(crypto: string, fiat: string, side: Side): string {
  return `${crypto}-${fiat}-${side}`;
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

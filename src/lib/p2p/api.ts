import {
  AdQuery,
  DataSource,
  FetchResult,
  P2PAd,
  P2PApiError,
  Side,
} from "./types";

export const P2P_API_URL = "https://p2p.walt.io/p2p/integration-api/v1/item/online";

/** адрес локального CORS-релея по умолчанию (scripts/relay-proxy.ts) */
export const DEFAULT_RELAY_URL = "http://localhost:8765/";

const DEMO_TOTAL_BASE = 96;

/* ------------------------------------------------------------------ */
/* Реальный запрос                                                     */
/* ------------------------------------------------------------------ */

const PROXY_TIMEOUT_MS = 10_000;

function buildRequestUrl(proxyUrl?: string): string {
  const proxy = (proxyUrl ?? "").trim();
  if (!proxy) return P2P_API_URL;
  if (proxy.includes("{url}")) {
    return proxy.replace("{url}", encodeURIComponent(P2P_API_URL));
  }
  return proxy.endsWith("=") || proxy.endsWith("?")
    ? proxy + encodeURIComponent(P2P_API_URL)
    : proxy + P2P_API_URL;
}

/** Запрос с таймаутом — чтобы «мертвый» прокси не подвешивал интерфейс */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Быстрая проверка доступности прокси (для настроек) */
export async function testProxy(
  proxyUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; ms: number; message: string }> {
  const started = performance.now();
  try {
    const res = await fetchWithTimeout(
      buildRequestUrl(proxyUrl),
      {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          cryptoCurrency: "USDT",
          fiatCurrency: "USD",
          side: "SELL",
          page: 1,
          pageSize: 1,
        }),
      },
      PROXY_TIMEOUT_MS,
    );
    const ms = Math.round(performance.now() - started);
    if (!res.ok) return { ok: false, ms, message: `HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
    if (!json || !Array.isArray(json.data)) {
      return { ok: false, ms, message: "ответ без массива data" };
    }
    return { ok: true, ms, message: `${ms} мс` };
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, ms, message: aborted ? "таймаут 10 с" : "сеть недоступна" };
  }
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value.replace(/\s/g, "").replace(",", ".")) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeAd(raw: Record<string, unknown>, index: number): P2PAd {
  // защита от мусора в ответе API: элемент массива может оказаться null/строкой
  const r: Record<string, unknown> =
    raw && typeof raw === "object" ? raw : { nickname: raw != null ? String(raw) : undefined };
  return {
    id: String(r.id ?? `ad-${index}`),
    nickname: String(r.nickname ?? r.nick ?? "—"),
    price: num(r.price),
    minAmount: num(r.minAmount ?? r.minLimit),
    maxAmount: num(r.maxAmount ?? r.maxLimit),
    executeRate: num(r.executeRate ?? r.rating, 0),
    payments: Array.isArray(r.payments) ? r.payments.map(String) : [],
    merchantLevel: r.merchantLevel ? String(r.merchantLevel) : undefined,
    isOnline: Boolean(r.isOnline ?? true),
  };
}

export interface FetchOptions {
  mode: DataSource;
  apiKey?: string;
  /** список CORS-прокси: пробуем по очереди, запоминаем рабочий */
  proxyUrls?: string[];
}

/** последний сработавший прокси — начинаем следующую пачку запросов с него */
let lastGoodProxy: string | null = null;

export async function fetchAds(query: AdQuery, opts: FetchOptions): Promise<FetchResult> {
  if (opts.mode === "demo") {
    await sleep(200 + Math.random() * 350);
    const demo = demoAds(query);
    return { ads: demo.ads, source: "demo", fetchedAt: Date.now(), total: demo.total };
  }

  // режимы, которые ходят через список адресов-посредников (CORS-прокси или локальный релей)
  const viaProxyList = opts.mode === "proxy" || opts.mode === "relay";

  let proxies = (opts.proxyUrls ?? []).map((p) => p.trim()).filter(Boolean);
  // для релея без явного списка берём адрес по умолчанию
  if (opts.mode === "relay" && !proxies.length) proxies = [DEFAULT_RELAY_URL];

  const candidates =
    lastGoodProxy && proxies.includes(lastGoodProxy)
      ? [lastGoodProxy, ...proxies.filter((p) => p !== lastGoodProxy)]
      : proxies;

  let res: Response | null = null;
  let lastNetError: unknown = null;
  // ошибка, которую показываем как есть (HTTP-статус цели, а не «проблема с сетью»)
  let httpAbort: P2PApiError | null = null;

  if (viaProxyList && !candidates.length) {
    throw new P2PApiError("network", "Список прокси пуст", {
      hint: "Добавьте хотя бы один адрес прокси в настройках (режим «через прокси»).",
    });
  }

  for (const proxy of viaProxyList ? candidates : [undefined]) {
    const url = buildRequestUrl(proxy);
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "X-API-Key": opts.apiKey ?? "",
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(query),
        },
        PROXY_TIMEOUT_MS,
      );
      if (!res.ok && (res.status >= 500 || res.status === 429)) {
        lastNetError = new P2PApiError("http", `HTTP ${res.status}`);
        if (!viaProxyList) {
          // прямому запросу переключиться на другой прокси некуда —
          // показываем честный статус сервера вместо «проблемы CORS»
          httpAbort = new P2PApiError(
            "http",
            `Сервер P2P API вернул ошибку HTTP ${res.status}`,
            {
              status: res.status,
              hint:
                res.status === 429
                  ? "Слишком много запросов — увеличьте интервал автообновления в настройках."
                  : "Возможен сбой на стороне API — попробуйте позже.",
            },
          );
          break;
        }
        // временная ошибка прокси/цели — пробуем следующий
        res = null;
        continue;
      }
      if (proxy) lastGoodProxy = proxy;
      break;
    } catch (e) {
      lastNetError = e;
      res = null;
    }
  }

  if (!res) {
    if (httpAbort) throw httpAbort;
    if (opts.mode === "relay") {
      throw new P2PApiError(
        "network",
        "Локальный релей не отвечает",
        { hint: "Запустите релей командой «bun scripts/relay-proxy.ts» и убедитесь, что он слушает указанный порт." },
      );
    }
    if (opts.mode === "proxy") {
      throw new P2PApiError(
        "network",
        `Ни один прокси не ответил (проверено: ${candidates.length})`,
        { hint: "Проверьте адреса прокси в настройках — кнопка «Проверить прокси» покажет статус каждого." },
      );
    }
    throw new P2PApiError("network", "Не удалось связаться с p2p.walt.io из браузера", {
      hint: "Скорее всего API не отдаёт CORS-заголовки для сторонних сайтов. Попробуйте режим «через прокси» или демо-данные.",
    });
  }
  void lastNetError;

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new P2PApiError("auth", `Доступ запрещён (HTTP ${res.status})`, {
        hint: "Проверьте API-ключ в настройках. Ключ передаётся в заголовке X-API-Key.",
      });
    }
    throw new P2PApiError("http", `Сервер вернул ошибку HTTP ${res.status}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new P2PApiError("parse", "Не удалось разобрать ответ сервера");
  }

  const rawAds = (json as { data?: unknown })?.data;
  if (!Array.isArray(rawAds)) {
    throw new P2PApiError("parse", "Ответ не содержит массив data с объявлениями");
  }

  const ads = rawAds.map((r, i) => normalizeAd(r as Record<string, unknown>, i));
  return {
    ads,
    source: viaProxyList ? opts.mode : "direct",
    fetchedAt: Date.now(),
    total: ads.length,
    via: viaProxyList ? lastGoodProxy ?? undefined : undefined,
  };
}

export function bestPrice(ads: P2PAd[], side: Side): number | null {
  const prices = ads.map((a) => a.price).filter((p) => p > 0);
  if (!prices.length) return null;
  return side === "SELL" ? Math.min(...prices) : Math.max(...prices);
}

/* ------------------------------------------------------------------ */
/* Демо-данные (симуляция рынка)                                       */
/* ------------------------------------------------------------------ */

const CRYPTO_BASE_USD: Record<string, number> = {
  USDT: 1.0,
  USDC: 0.9998,
  BTC: 96450,
  ETH: 2685,
  TON: 4.85,
  BNB: 642,
};

const FIAT_PER_USD: Record<string, number> = {
  RUB: 96.4,
  USD: 1,
  EUR: 0.925,
  KZT: 486,
  UAH: 41.6,
  TRY: 34.8,
  AED: 3.673,
};

const PAYMENTS: Record<string, string[]> = {
  RUB: ["СБП", "Т-Банк", "Сбербанк", "ВТБ", "Альфа-Банк", "Райффайзен", "ЮMoney", "Газпромбанк"],
  USD: ["PayPal", "Wise", "Zelle", "Банковский перевод", "Revolut"],
  EUR: ["SEPA", "Revolut", "PayPal", "Wise"],
  KZT: ["Kaspi Bank", "Halyk Bank", "Fortebank"],
  UAH: ["Monobank", "Privat24", "Райффайзен UA"],
  TRY: ["Ziraat Bankası", "Papara", "Garanti BBVA"],
  AED: ["Mashreq", "ADCB", "Банковский перевод"],
};

const NICKNAMES = [
  "CryptoWhale", "Anna_Trades", "MoscowCoin", "QuickExchange", "SafeDealPro",
  "Victor88", "NorthernLight", "FastCash_ru", "Tver_Trader", "AlexP2P",
  "MeridianX", "SilverFox", "KazakhGold", "Istanbul Swap", "Dmitry_Fiat",
  "GreenCandle", "OceanExchange", "Maria_P2P", "DeltaTrader", "ReliableDeal",
  "ArtemExchange", "NeoMarket", "Sofia_Coins", "TopRate24", "IronHand",
  "UralCapital", "BalticSwap", "KirillDeal", "AurumDesk", "SmartExchange",
];

const LEVELS = ["Новичок", "Бронза", "Серебро", "Золото", "Платина", "Меркурий"];
const LEVEL_WEIGHTS = [0.08, 0.27, 0.32, 0.2, 0.09, 0.04];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Детерминированный ПСЧ, чтобы пагинация и таблица были стабильны внутри такта обновления */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function demoMidPrice(crypto: string, fiat: string): number {
  const base = CRYPTO_BASE_USD[crypto] ?? 1;
  const rate = FIAT_PER_USD[fiat] ?? 1;
  // дрейф привязан к 30-секундному такту: SELL- и BUY-выборки внутри такта
  // считаются от одной «середины рынка», поэтому спред не инвертируется
  const bucket = Math.floor(Date.now() / 30000);
  const drift = Math.sin(bucket / 7) * 0.004 + Math.sin(bucket / 1.7) * 0.0012;
  return base * rate * (1 + drift);
}

function pickLevel(rnd: number): string {
  let acc = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    acc += LEVEL_WEIGHTS[i];
    if (rnd <= acc) return LEVELS[i];
  }
  return LEVELS[2];
}

export function demoAds(query: AdQuery): { ads: P2PAd[]; total: number } {
  const { cryptoCurrency, fiatCurrency, side, page, pageSize } = query;
  const bucket = Math.floor(Date.now() / 30000); // такт 30 секунд, как в реальном API
  const seed = hashString(`${cryptoCurrency}|${fiatCurrency}|${side}|${bucket}`);
  const rnd = mulberry32(seed);

  const mid = demoMidPrice(cryptoCurrency, fiatCurrency);
  const total = DEMO_TOTAL_BASE + Math.floor(rnd() * 28);
  const paymentsPool = PAYMENTS[fiatCurrency] ?? ["Банковский перевод"];
  const fiatScale = Math.max(FIAT_PER_USD[fiatCurrency] ?? 1, 1);

  const ads: P2PAd[] = [];
  for (let i = 0; i < total; i++) {
    // чем дальше от «лучшей» позиции, тем хуже цена
    const step = i * 0.00045 + rnd() * 0.0006;
    const bias = side === "SELL" ? 1 + 0.0006 + step : 1 - 0.0006 - step;
    const price = mid * bias * (1 + (rnd() - 0.5) * 0.0008);
    const decimals = price > 100 ? 2 : price > 5 ? 3 : 4;

    const minAmount = Math.round((300 + rnd() * rnd() * 4500) * fiatScale);
    const maxAmount = Math.round(minAmount * (4 + rnd() * 90));
    const payCount = 1 + Math.floor(rnd() * 3);
    const payments: string[] = [];
    for (let p = 0; p < payCount; p++) {
      const pay = paymentsPool[Math.floor(rnd() * paymentsPool.length)];
      if (!payments.includes(pay)) payments.push(pay);
    }

    ads.push({
      id: `${cryptoCurrency}${fiatCurrency}${side}-${bucket}-${i}`,
      nickname: NICKNAMES[Math.floor(rnd() * NICKNAMES.length)],
      price: Number(price.toFixed(decimals)),
      minAmount,
      maxAmount,
      executeRate: Number((72 + rnd() * 27.9).toFixed(1)),
      payments,
      merchantLevel: pickLevel(rnd()),
      isOnline: rnd() < 0.78,
    });
  }

  const start = Math.max(0, (page - 1) * pageSize);
  return { ads: ads.slice(start, start + pageSize), total };
}

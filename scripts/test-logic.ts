/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 *
 * Автотесты чистой логики Walt P2P Терминала (пользовательские сценарии).
 * Запуск: bun scripts/test-logic.ts
 */
import { bestPrice, demoAds, demoMidPrice, normalizeAd, buildRequestUrl, P2P_API_URL, describeApiError } from "../src/lib/p2p/api";
import { filterAds, fitsAmount, isInverted, parseAmount, sanitizeCode, sortAds, spreadPercent, uniquePayments, bestAd, bestAdForAmount } from "../src/lib/p2p/filters";
import { formatMoney, formatPercent, formatPrice } from "../src/lib/p2p/format";
import {
  HISTORY_LIMIT,
  MAX_HISTORY_PAIRS,
  appendHistoryPoint,
  pruneHistory,
} from "../src/lib/p2p/history";
import { CRYPTOS, FIATS, FIAT_LABEL, pairKey } from "../src/lib/p2p/types";
import { MAX_REFRESH_SEC, MIN_REFRESH_SEC, PAGE_SIZES, clampPageSize, clampRefreshSec } from "../src/lib/p2p/store";
import {
  MAX_HORIZON_MINUTES,
  MIN_POINTS_FOR_FORECAST,
  backtestMape,
  chronological,
  fitTrend,
  forecastInterval,
  forecastValue,
  trendDirection,
  trendPerHour,
  volatilityPerStep,
} from "../src/lib/p2p/forecast";
import type { AdQuery, HistoryPoint, P2PAd } from "../src/lib/p2p/types";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function T(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(name);
  }
}
function eq(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function near(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

const ad = (over: Partial<P2PAd>): P2PAd => ({
  id: "x",
  nickname: "n",
  price: 100,
  minAmount: 0,
  maxAmount: 0,
  executeRate: 90,
  payments: [],
  isOnline: true,
  ...over,
});

/* ── лучшие цены: семантика сторон ── */
const sellAds = [ad({ price: 95.1 }), ad({ price: 93.7 }), ad({ price: 99 })];
T("bestPrice SELL = min (выгодно купить)", bestPrice(sellAds, "SELL") === 93.7);
T("bestPrice BUY = max (выгодно продать)", bestPrice(sellAds, "BUY") === 99);
T("bestPrice: пусто → null", bestPrice([], "SELL") === null);
T("bestPrice: игнорирует ≤0", bestPrice([ad({ price: 0 }), ad({ price: -5 }), ad({ price: 12 })], "SELL") === 12);

/* ── спред и инверсия рынка ── */
const bb = bestPrice(sellAds, "SELL");
const buyAds = [ad({ price: 92.0 }), ad({ price: 91.5 }), ad({ price: 90.8 })];
const bs = bestPrice(buyAds, "BUY");
// здоровый рынок: лучший ask (покупка) выше лучшего bid (продажа)
T("спред: положительный на здоровом рынке", (bb as number) > (bs as number));
T("спред: положительное значение", (spreadPercent(bb, bs) as number) > 0);
T("спред: к середине рынка (93,7 и 92,0 → 1,83%)", near(spreadPercent(93.7, 92.0) as number, ((93.7 - 92) / ((93.7 + 92) / 2)) * 100));
T("спред: симметричен по модулю", near(Math.abs(spreadPercent(110, 100) as number), Math.abs(spreadPercent(100, 110) as number)));
T("спред: нулевой при равных курсах", near(spreadPercent(95, 95) as number, 0));
T("спред: null если нет покупки", spreadPercent(null, 90) === null);
T("спред: null если нет продажи", spreadPercent(90, null) === null);
T("спред: null на нулевых/отрицательных", spreadPercent(0, 90) === null && spreadPercent(90, -1) === null);
T("спред: null на NaN", spreadPercent(NaN, 90) === null);

// инверсия: покупатели дают больше, чем минимум продавцов → арбитражная возможность.
// Реальный случай (USDT/RUB): SELL от 85,00, BUY до 98,00 с лимитом 4 999–5 000
const buyAds2 = [ad({ price: 96.5 }), ad({ price: 97 })];
T("инверсия (bid > ask) распознаётся", (bestPrice(buyAds2, "BUY") as number) > (bb as number));
T("инверсия: isInverted = true", isInverted(85.0, 98.0));
T("инверсия: спред отрицательный", (spreadPercent(85.0, 98.0) as number) < 0);
T("инверсия: модуль спреда разумен (−14,2%, а не −15,3% к ask)",
  Math.abs(spreadPercent(85.0, 98.0) as number) < 15 && Math.abs(spreadPercent(85.0, 98.0) as number) > 14);
T("инверсия: здоровый рынок не инвертирован", !isInverted(93.7, 92.0));
T("инверсия: равные курсы не инверсия", !isInverted(95, 95));
T("инверсия: null → false", !isInverted(null, 98) && !isInverted(85, null) && !isInverted(0, 0));

/* ── нормализация ответа API ── */
const na = normalizeAd({ id: 7, nickname: "tr", price: "94,3", minAmount: "1000", executeRate: 0.95 }, 0);
T("normalize: строка-цена с запятой → число", na.price === 94.3);
T("normalize: payments не массив → []", normalizeAd({ payments: "Сбербанк" }, 0).payments.length === 0);
T("normalize: null не падает", normalizeAd(null as never, 0).nickname === "—");
T("normalize: executeRate 95 остаётся 95", normalizeAd({ executeRate: 95 }, 0).executeRate === 95);
T("normalize: isOnline по умолчанию true", normalizeAd({}, 0).isOnline === true);

/* ── сумма сделки: разбор ── */
T("parseAmount: «15 000» → 15000", parseAmount("15 000") === 15000);
T("parseAmount: «15,5» → 15.5", parseAmount("15,5") === 15.5);
T("parseAmount: «0» → null (фильтр выкл)", parseAmount("0") === null);
T("parseAmount: мусор → null", parseAmount("abc") === null);
T("parseAmount: пусто → null", parseAmount("") === null);
T("parseAmount: отрицательное → null", parseAmount("-5") === null);

/* ── сумма сделки: интервал лимитов ── */
const lim = { minAmount: 1000, maxAmount: 50000 };
T("интервал: ниже min отсекает", !fitsAmount(lim, 500));
T("интервал: граница min включена", fitsAmount(lim, 1000));
T("интервал: внутри проходит", fitsAmount(lim, 15000));
T("интервал: граница max включена", fitsAmount(lim, 50000));
T("интервал: выше max отсекает", !fitsAmount(lim, 50001));
T("интервал: null → фильтр выкл", fitsAmount(lim, null));
T("интервал: max=0 → без максимума", fitsAmount({ minAmount: 1000, maxAmount: 0 }, 999999));
T("интервал: min=0 → без минимума", fitsAmount({ minAmount: 0, maxAmount: 5000 }, 1));

/* ── способы оплаты ── */
const payAds = [
  ad({ payments: ["СБП", "Т-Банк"] }),
  ad({ payments: ["СБП"] }),
  ad({ payments: ["QIWI"] }),
];
T("uniquePayments: по частоте", eq(uniquePayments(payAds), ["СБП", "Т-Банк", "QIWI"]));

/* ── конвейер фильтров ── */
const F: P2PAd[] = [
  ad({ id: "1", isOnline: true, minAmount: 1000, maxAmount: 50000, payments: ["Сбербанк"] }),
  ad({ id: "2", isOnline: false, minAmount: 1000, maxAmount: 50000, payments: ["Сбербанк"] }),
  ad({ id: "3", isOnline: true, minAmount: 0, maxAmount: 5000, payments: ["QIWI"] }),
  ad({ id: "4", isOnline: true, minAmount: 2000, maxAmount: 0, payments: ["Сбербанк", "Т-Банк"] }),
];
const base = { search: "", onlyOnline: false, amount: null, payments: [] };
T("фильтр: без условий — все 4", filterAds(F, base).length === 4);
T("фильтр: только онлайн — 3", filterAds(F, { ...base, onlyOnline: true }).length === 3);
T("фильтр: сумма 5000 — все 4 (границы включительно)", filterAds(F, { ...base, amount: 5000 }).length === 4);
T("фильтр: сумма 600 — только без min и max=0", filterAds(F, { ...base, amount: 600 }).length === 1);
T("фильтр: сумма 60000 — только max=0", filterAds(F, { ...base, amount: 60000 }).length === 1);
T("фильтр: оплата «Т-Банк» — 1", filterAds(F, { ...base, payments: ["Т-Банк"] }).length === 1);
T("фильтр: оплата + сумма — пересечение условий", filterAds(F, { ...base, amount: 60000, payments: ["Сбербанк"] }).length === 1);
T("фильтр: поиск по нику", filterAds(F, { ...base, search: "НИК" }).length === 0);

/* ── объявление с лучшим курсом (подсветка строки в таблице) ── */
T("bestAd SELL: минимальная цена", bestAd(sellAds, "SELL")?.price === 93.7);
T("bestAd BUY: максимальная цена", bestAd(sellAds, "BUY")?.price === 99);
T("bestAd: пустой список → null", bestAd([], "SELL") === null);
// регресс: мусорная цена ≤ 0 в начале списка не должна «съедать» подсветку
const dirty = [ad({ id: "zero", price: 0 }), ad({ id: "neg", price: -3 }), ad({ id: "ok", price: 91 })];
T("bestAd: цена ≤ 0 не побеждает валидную", bestAd(dirty, "SELL")?.id === "ok");
T("bestAd: только мусор → null", bestAd([ad({ price: 0 }), ad({ price: -1 })], "SELL") === null);
T("bestAd: NaN игнорируется", bestAd([ad({ id: "nan", price: NaN }), ad({ id: "ok", price: 5 })], "SELL")?.id === "ok");
T("bestAd: согласован с bestPrice", bestAd(sellAds, "SELL")?.price === bestPrice(sellAds, "SELL"));
// регресс: bestPrice раньше считал min/max по своему и мог «выбрать» мусор,
// на который bestAd не ставит подсветку — сводка и таблица расходились
T("bestPrice = bestAd: мусорная цена не побеждает", bestPrice(dirty, "SELL") === 91);
T("bestPrice = bestAd: только мусор → null", bestPrice([ad({ price: 0 }), ad({ price: -1 })], "SELL") === null);
T("bestPrice = bestAd: NaN игнорируется", bestPrice([ad({ price: NaN }), ad({ price: 5 })], "SELL") === 5);
T("bestPrice = bestAd: BUY берёт максимум", bestPrice(sellAds, "BUY") === bestAd(sellAds, "BUY")?.price);

/* ── лучший курс с учётом суммы сделки (подсветка в отфильтрованной таблице) ── */
// регресс: при инверсии лучший курс держится объявлением с узким лимитом.
// Если пользователь задал сумму, этот лидер отфильтрован — бейдж «лучший курс»
// исчезал из таблицы, и подсвеченной строки не оставалось вовсе.
const narrow = [
  ad({ id: "narrow", price: 90, minAmount: 4999, maxAmount: 5000 }),
  ad({ id: "wide", price: 93, minAmount: 1000, maxAmount: 100000 }),
  ad({ id: "wide2", price: 95, minAmount: 1000, maxAmount: 100000 }),
];
T("bestAdForAmount: null → как bestAd (узкий лидер)", bestAdForAmount(narrow, "SELL", null)?.id === "narrow");
T("bestAdForAmount: сумма 50 000 → лучший среди доступных", bestAdForAmount(narrow, "SELL", 50_000)?.id === "wide");
T("bestAdForAmount: сумма 4 999 → узкий лидер снова доступен", bestAdForAmount(narrow, "SELL", 4999)?.id === "narrow");
T("bestAdForAmount: ни одно не подходит → null", bestAdForAmount(narrow, "SELL", 10) === null);
T("bestAdForAmount: BUY берёт максимум среди доступных", bestAdForAmount(narrow, "BUY", 50_000)?.id === "wide2");

/* ── сортировка ── */
const S = [ad({ id: "a", price: 10 }), ad({ id: "b", price: 2 }), ad({ id: "c", price: 0 }), ad({ id: "d", price: 1 })];
T("сортировка asc числовая (1,2,10), 0 в конце", eq(sortAds(S, "price", "asc").map((a) => a.price), [1, 2, 10, 0]));
T("сортировка desc (10,2,1), 0 в конце", eq(sortAds(S, "price", "desc").map((a) => a.price), [10, 2, 1, 0]));
T("sortAds не мутирует вход", S[0].price === 10);
T("сортировка по рейтингу desc", eq(sortAds([ad({ executeRate: 50 }), ad({ executeRate: 90 })], "executeRate", "desc").map((a) => a.executeRate), [90, 50]));
T("сортировка по maxAmount asc", eq(sortAds([ad({ maxAmount: 500 }), ad({ maxAmount: 100 })], "maxAmount", "asc").map((a) => a.maxAmount), [100, 500]));

/* ── коды валют (своя пара) ── */
T("sanitizeCode: lower → upper", sanitizeCode("usdt") === "USDT");
T("sanitizeCode: мусор вычищается", sanitizeCode("u!s@dt") === "USDT");
T("sanitizeCode: один символ → null", sanitizeCode("U") === null);
T("sanitizeCode: длиннее 10 → null", sanitizeCode("ABCDEFGHIJKL") === null);
T("sanitizeCode: пусто → null", sanitizeCode("") === null);
T("sanitizeCode: пробелы не мешают", sanitizeCode(" US DT ") === "USDT");

/* ── история курсов: защита от дублей и рост localStorage ── */
const T0 = 1_700_000_000_000;
let h1 = appendHistoryPoint(undefined, 90, T0);
T("history: первая точка пишется", h1.length === 1 && h1[0].best === 90);
h1 = appendHistoryPoint(h1, 91, T0 + 1000);
T("history: точка в окне 5 с игнорируется", h1.length === 1);
h1 = appendHistoryPoint(h1, 91, T0 + 5001);
T("history: после окна точка пишется", h1.length === 2 && h1[1].best === 91);
T("history: вход не мутируется", h1[0].best === 90);

let long = appendHistoryPoint(undefined, 1, T0);
for (let i = 1; i <= HISTORY_LIMIT + 40; i++) long = appendHistoryPoint(long, i, T0 + i * 10_000);
T("history: ряд ограничен HISTORY_LIMIT", long.length === HISTORY_LIMIT);
T("history: хранятся последние точки", long[long.length - 1].best === HISTORY_LIMIT + 40);

// регресс: пары можно открывать бесконечно — история не должна расти без предела
let many: Record<string, HistoryPoint[]> = {};
for (let i = 0; i < MAX_HISTORY_PAIRS + 6; i++) {
  many = pruneHistory({ ...many, [`C${i}-RUB-SELL`]: [{ t: T0 + i, best: i }] });
}
T("history: число пар ограничено", Object.keys(many).length === MAX_HISTORY_PAIRS);
T("history: вытесняются самые старые пары", !("C0-RUB-SELL" in many) && !("C5-RUB-SELL" in many));
T("history: свежие пары остаются", `C${MAX_HISTORY_PAIRS + 5}-RUB-SELL` in many);
const few = { "A-RUB-SELL": [{ t: T0, best: 1 }] };
T("history: до лимита объект не копируется", pruneHistory(few) === few);

/* ── форматирование ── */
T("formatPrice: null → тире", formatPrice(null) === "—");
T("formatMoney: 15000 → 15\u00A0000,00", formatMoney(15000) === "15\u00A0000,00");
T("formatPercent: дробная запятая", formatPercent(12.5, 1) === "12,5%");
T("formatPercent: отрицательное — типографский минус", formatPercent(-6.39) === "−6,39%");
T("formatPercent: без «+» у положительного", formatPercent(1.5, 1) === "1,5%");
T("pairKey собирает ключ", pairKey("USDT", "RUB", "SELL") === "USDT-RUB-SELL");

/* ── списки валют: только то, что принимает боевой API ── */
// регресс: USDC/BNB и AED стояли в списках, но API отвечает на них 400
// CRYPTO/FIAT_CURRENCY_NOT_SUPPORTED — матрица рынков висела на скелетонах
T("CRYPTOS: не содержит USDC", !(CRYPTOS as readonly string[]).includes("USDC"));
T("CRYPTOS: не содержит BNB", !(CRYPTOS as readonly string[]).includes("BNB"));
T("FIATS: не содержит AED", !(FIATS as readonly string[]).includes("AED"));
T("CRYPTOS: содержит проверенные USDT/BTC/ETH/TON/NOT",
  ["USDT", "BTC", "ETH", "TON", "NOT"].every((c) => (CRYPTOS as readonly string[]).includes(c)));
T("FIATS: содержит проверенные RUB/USD/EUR/KZT/UAH/TRY",
  ["RUB", "USD", "EUR", "KZT", "UAH", "TRY"].every((f) => (FIATS as readonly string[]).includes(f)));
T("FIAT_LABEL: подпись есть для каждого фиата",
  FIATS.every((f) => typeof FIAT_LABEL[f] === "string" && FIAT_LABEL[f].length > 0));

/* ── разбор ошибок API (HTTP 400 с errorCode) ── */
const q = (cryptoCurrency: string, fiatCurrency: string): AdQuery => ({
  cryptoCurrency, fiatCurrency, side: "SELL", page: 1, pageSize: 50,
});
const eCrypto = describeApiError(
  { errorCode: "CRYPTO_CURRENCY_NOT_SUPPORTED", errorMessage: "crypto currency BNB is not supported." },
  q("BNB", "RUB"),
);
T("describeApiError: крипта → понятное сообщение", eCrypto?.message.includes("BNB") === true);
T("describeApiError: крипта → подсказка про пару", eCrypto?.hint?.includes("BNB/RUB") === true);
const eFiat = describeApiError({ errorCode: "FIAT_CURRENCY_NOT_SUPPORTED" }, q("USDT", "AED"));
T("describeApiError: фиат → понятное сообщение", eFiat?.message.includes("AED") === true);
T("describeApiError: неизвестный код → текст из API",
  describeApiError({ errorCode: "WEIRD", errorMessage: "something odd" }, q("USDT", "RUB"))?.message.includes("something odd") === true);
T("describeApiError: пустой ответ → null", describeApiError(null, q("USDT", "RUB")) === null);
T("describeApiError: без errorCode → null", describeApiError({ errorMessage: "x" }, q("USDT", "RUB")) === null);

/* ── демо-генератор ── */
const d1 = demoAds({ cryptoCurrency: "USDT", fiatCurrency: "RUB", side: "SELL", page: 1, pageSize: 50 });
const d2 = demoAds({ cryptoCurrency: "USDT", fiatCurrency: "RUB", side: "SELL", page: 1, pageSize: 50 });
T("demoAds: детерминирован внутри такта", eq(d1, d2));
T("demoAds: цены положительные", d1.ads.every((a) => a.price > 0));
T("demoAds: у каждого ≥1 метод оплаты", d1.ads.every((a) => a.payments.length >= 1));
const mid = demoMidPrice("USDT", "RUB");
T("demoMidPrice: положительный", mid > 0);
const page2 = demoAds({ cryptoCurrency: "USDT", fiatCurrency: "RUB", side: "SELL", page: 2, pageSize: 50 });
T("demoAds: страница 2 не совпадает со страницей 1", !eq(d1.ads, page2.ads));

/* ── интеграция: normalize → filter → bestPrice ── */
const raw = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  nickname: `tr_${i}`,
  price: String(90 + (i % 7)),
  minAmount: 1000,
  maxAmount: 100000,
  executeRate: 0.9,
  payments: ["Сбербанк"],
  isOnline: i % 5 !== 0,
}));
const normalized = raw.map((r, i) => normalizeAd(r, i));
const onlineFiltered = filterAds(normalized, { search: "", onlyOnline: true, amount: null, payments: [] });
T("конвейер: офлайн отсеяны (24 из 30)", onlineFiltered.length === 24);
T(
  "конвейер: лучший SELL = min",
  bestPrice(onlineFiltered, "SELL") === Math.min(...onlineFiltered.map((a) => a.price)),
);

/* ── построение URL через прокси/релей ── */
T("proxy: пусто → прямой URL API", buildRequestUrl("") === P2P_API_URL);
T("proxy: undefined → прямой URL API", buildRequestUrl(undefined) === P2P_API_URL);
T("proxy: шаблон {url} подставляется кодированным",
  buildRequestUrl("https://p.example/?url={url}") ===
  `https://p.example/?url=${encodeURIComponent(P2P_API_URL)}`);
T("proxy: хвост '=' → целевой URL кодируется",
  buildRequestUrl("https://p.example/?target=") ===
  `https://p.example/?target=${encodeURIComponent(P2P_API_URL)}`);
T("proxy: хвост '?' → целевой URL кодируется",
  buildRequestUrl("https://p.example/?") ===
  `https://p.example/?${encodeURIComponent(P2P_API_URL)}`);
T("proxy: хвост '&' → целевой URL кодируется (не ломает query)",
  buildRequestUrl("https://p.example/?a=1&") ===
  `https://p.example/?a=1&${encodeURIComponent(P2P_API_URL)}`);
T("proxy: префикс с '/' → путь-стиль, URL без кодирования (релей)",
  buildRequestUrl("http://localhost:8765/") === `http://localhost:8765/${P2P_API_URL}`);
T("proxy: пробелы по краям обрезаются",
  buildRequestUrl("  https://p.example/?url={url}  ") ===
  `https://p.example/?url=${encodeURIComponent(P2P_API_URL)}`);
T("proxy: в коде URL нет небезопасных для query символов",
  !buildRequestUrl("https://p.example/?url={url}").slice("https://p.example/?url=".length).includes("?"));

/* ── прогноз: линейный тренд, интервал, качество ── */
const F0 = 1_700_000_000_000;
// синтетика: ровно линейный рост 100 → 107 с шагом 30 с (шаг 1 в нормированной оси)
const linear = Array.from({ length: 8 }, (_, i) => ({ t: F0 + i * 30_000, best: 100 + i }));
const linearFit = fitTrend(linear);
T("forecast: мало точек → null", fitTrend(linear.slice(0, MIN_POINTS_FOR_FORECAST - 1)) === null);
T("forecast: ровно минимум точек → прямая есть", linearFit !== null);
T("forecast: наклон = 1 за шаг", near(linearFit!.slope, 1, 1e-9));
T("forecast: прямая совпадает с данными (R²=1)", near(linearFit!.r2 as number, 1, 1e-9));
T("forecast: значение в последней точке = 107", near(linearFit!.valueAtLast, 107, 1e-9));
T("forecast: шаг = 30 с", linearFit!.stepMs === 30_000);
T("forecast: прогноз продолжает прямую", near(forecastValue(linearFit!, 2), 109, 1e-9));
T("forecast: тренд вверх значим", trendDirection(linearFit!) === "up");
T("forecast: рост за час = 120 шагов", near(trendPerHour(linearFit!) as number, (120 / 107) * 100, 1e-6));

// падение
const falling = Array.from({ length: 10 }, (_, i) => ({ t: F0 + i * 30_000, best: 200 - i * 2 }));
T("forecast: тренд вниз", trendDirection(fitTrend(falling)!) === "down");
T("forecast: падение за час отрицательно", (trendPerHour(fitTrend(falling)!) as number) < 0);

// ровный ряд: наклон нулевой, но R² не определён (объяснять нечего)
const flat = Array.from({ length: 9 }, (_, i) => ({ t: F0 + i * 30_000, best: 50 }));
const flatFit = fitTrend(flat)!;
T("forecast: ровный ряд → наклон 0", near(flatFit.slope, 0, 1e-12));
T("forecast: ровный ряд → R² null", flatFit.r2 === null);
T("forecast: ровный ряд → тренд flat", trendDirection(flatFit) === "flat");
T("forecast: ровный ряд → 0% в час", near(trendPerHour(flatFit) as number, 0, 1e-12));

// шум без тренда: наклон не должен объявляться значимым
const noise = [
  100, 103, 99, 104, 98, 102, 99, 103, 98, 101, 100, 102,
].map((best, i) => ({ t: F0 + i * 30_000, best }));
T("forecast: шум без тренда → flat (наклон незначим)", trendDirection(fitTrend(noise)!) === "flat");

// порядок точек не важен: после перезагрузки вкладки стор мог отдать вперемешку
const shuffled = [linear[3], linear[0], linear[7], linear[1], linear[5], linear[2], linear[6], linear[4]];
const shuffledFit = fitTrend(shuffled)!;
T("forecast: неотсортированный вход даёт тот же наклон", near(shuffledFit.slope, 1, 1e-9));
T("forecast: вход не мутируется", shuffled[0].best === 103);

// вырожденные случаи
T("forecast: пустой массив → null", fitTrend([]) === null);
T("forecast: одинаковая метка времени → null",
  fitTrend(Array.from({ length: 10 }, () => ({ t: F0, best: 100 }))) === null);
T("forecast: NaN в цене отфильтровывается",
  fitTrend([...linear, { t: F0 + 999_000, best: NaN }])?.n === 8);

// интервал: растёт с горизонтом и накрывает точечный прогноз
const iv1 = forecastInterval(linearFit!, 1);
const iv10 = forecastInterval(linearFit!, 10);
T("forecast: интервал накрывает точечный прогноз",
  iv1.low <= forecastValue(linearFit!, 1) && forecastValue(linearFit!, 1) <= iv1.high);
// на идеальной прямой остатки нулевые, поэтому интервал вырожден — расширение
// проверяем на шумном ряду, где неопределённость реально существует
const noiseFit = fitTrend(noise)!;
const nv1 = forecastInterval(noiseFit, 1);
const nv10 = forecastInterval(noiseFit, 10);
T("forecast: интервал расширяется с горизонтом",
  (nv10.high - nv10.low) > (nv1.high - nv1.low));
T("forecast: на идеальной прямой ширина интервала нулевая",
  near(iv1.high - iv1.low, 0, 1e-9));

// волатильность
T("forecast: волатильность ровного ряда = 0", near(volatilityPerStep(flat) as number, 0, 1e-12));
T("forecast: волатильность растёт с разбросом",
  (volatilityPerStep(noise) as number) > (volatilityPerStep(flat) as number));
T("forecast: волатильность: мало точек → null", volatilityPerStep([{ t: F0, best: 1 }]) === null);

// backtest: на линейном ряде ошибка нулевая, на шумном — заметная
T("forecast: backtest на прямой → 0%", near(backtestMape(linear) as number, 0, 1e-9));
T("forecast: backtest на шуме → ошибка больше нуля", (backtestMape(noise) as number) > 0);
T("forecast: backtest: мало точек → null", backtestMape(linear.slice(0, 5)) === null);
// MAPE считается по тестовой части, а не по всей истории
T("forecast: backtest не подгоняется под тест (ошибка на тренде больше нуля)",
  (backtestMape(noise.map((p, i) => ({ ...p, best: p.best * (1 + (i % 3) * 0.02) }))) as number) > 0);

/* ── chronological: нормализация ряда ── */
T("chronological: пустой массив", chronological([]).length === 0);
T("chronological: null → пустой", chronological(null as unknown as HistoryPoint[]).length === 0);
T("chronological: NaN/Infinity фильтруются",
  chronological([{ t: 1, best: 1 }, { t: 2, best: NaN }, { t: 3, best: 3 }]).length === 2);
T("chronological: сортирует по времени",
  chronological([{ t: 3, best: 30 }, { t: 1, best: 10 }, { t: 2, best: 20 }])
    .map((p) => p.t).join(",") === "1,2,3");
T("chronological: обратный порядок → прямой",
  chronological([...linear].reverse())
    .map((p) => p.best).join(",") ===
  linear.map((p) => p.best).join(","));
T("chronological: наклон совпадает для обратного ряда",
  near(fitTrend(chronological([...linear].reverse()))!.slope, 1, 1e-9));

/* ── MAX_HORIZON_MINUTES: ограничение горизонта по времени ── */
T("MAX_HORIZON_MINUTES: определена и > 0", MAX_HORIZON_MINUTES > 0);
T("MAX_HORIZON_MINUTES: два часа", MAX_HORIZON_MINUTES === 120);
// потолок по времени, а не по шагам: иначе при быстром автообновлении
// все подписи горизонтов слились бы в одну
T("MAX_HORIZON_MINUTES: в шагах по 30 с это 240", (MAX_HORIZON_MINUTES * 60_000) / 30_000 === 240);

/* ── границы настроек: защита от шторма запросов ── */
// регресс: повреждённый localStorage или чужой файл экспорта с refreshSec: 0
// превращали обратный отсчёт в «всегда пора обновляться» — вкладка опрашивала
// API каждую секунду и получала HTTP 429
T("настройки: MIN_REFRESH_SEC = 10", MIN_REFRESH_SEC === 10);
T("настройки: MAX_REFRESH_SEC = 120", MAX_REFRESH_SEC === 120);
T("настройки: PAGE_SIZES только допустимые", eq([...PAGE_SIZES], [20, 50, 100]));
T("clampRefreshSec: 0 → минимум", clampRefreshSec(0) === MIN_REFRESH_SEC);
T("clampRefreshSec: отрицательное → минимум", clampRefreshSec(-30) === MIN_REFRESH_SEC);
T("clampRefreshSec: 9999 → максимум", clampRefreshSec(9999) === MAX_REFRESH_SEC);
T("clampRefreshSec: NaN → 30", clampRefreshSec(Number.NaN) === 30);
T("clampRefreshSec: строка «45» → 45", clampRefreshSec("45") === 45);
T("clampRefreshSec: дробное округляется", clampRefreshSec(31.7) === 32);
T("clampRefreshSec: значение в диапазоне не меняется", clampRefreshSec(60) === 60);
T("clampPageSize: 7 → 50", clampPageSize(7) === 50);
T("clampPageSize: 20/50/100 сохраняются",
  clampPageSize(20) === 20 && clampPageSize(50) === 50 && clampPageSize(100) === 100);
T("clampPageSize: строка «20» → 20", clampPageSize("20") === 20);

/* ── forecastInterval: не-отрицательная нижняя граница ── */
// линейный ряд: нижняя граница всегда ≥ 0
const iv = forecastInterval(linearFit!, 100);
T("forecast: интервал low ≥ 0 на линейном ряде", iv.low >= 0);
// длинный горизонт: даже если предсказание уходит в минус, границы корректны
const ivLong = forecastInterval(linearFit!, 240);
T("forecast: интервал low ≥ 0 на длинном горизонте", ivLong.low >= 0);
T("forecast: high никогда не меньше low", ivLong.high >= ivLong.low);
// обвальный тренд: точка прогноза уходит в отрицательную зону,
// и верхняя граница не должна оказаться ниже обрезанной нижней
const crash = Array.from({ length: 12 }, (_, i) => ({ t: F0 + i * 30_000, best: 3000 - i * 280 }));
const crashIv = forecastInterval(fitTrend(crash)!, 240);
T("forecast: при обвале low ≥ 0 и high ≥ low", crashIv.low >= 0 && crashIv.high >= crashIv.low);

console.log(`\nИТОГО: PASS ${passed} / FAIL ${failed}`);
if (failures.length) {
  console.error("Провалены:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

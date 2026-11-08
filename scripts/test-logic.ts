/**
 * Автотесты чистой логики Walt P2P Терминала (пользовательские сценарии).
 * Запуск: bun scripts/test-logic.ts
 */
import { bestPrice, demoAds, demoMidPrice, normalizeAd } from "../src/lib/p2p/api";
import { filterAds, fitsAmount, parseAmount, sanitizeCode, sortAds, uniquePayments } from "../src/lib/p2p/filters";
import { formatMoney, formatPercent, formatPrice } from "../src/lib/p2p/format";
import { pairKey } from "../src/lib/p2p/types";
import type { P2PAd } from "../src/lib/p2p/types";

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

/* ── спред: направление считается в UI как (minSELL − maxBUY)… проверяем данные ── */
const bb = bestPrice(sellAds, "SELL");
const buyAds = [ad({ price: 92.0 }), ad({ price: 91.5 }), ad({ price: 90.8 })];
const bs = bestPrice(buyAds, "BUY");
// здоровый рынок: лучший ask (покупка) выше лучшего bid (продажа)
T("спред положительный на здоровом рынке", (bb as number) > (bs as number));
// инверсия: покупатели дают больше, чем минимум продавцов → арбитражная возможность
const buyAds2 = [ad({ price: 96.5 }), ad({ price: 97 })];
T("инверсия (bid > ask) распознаётся", (bestPrice(buyAds2, "BUY") as number) > (bb as number));

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

/* ── форматирование ── */
T("formatPrice: null → тире", formatPrice(null) === "—");
T("formatMoney: 15000 → 15\u00A0000,00", formatMoney(15000) === "15\u00A0000,00");
T("formatPercent: дробная запятая", formatPercent(12.5, 1) === "12,5%");
T("pairKey собирает ключ", pairKey("USDT", "RUB", "SELL") === "USDT-RUB-SELL");

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

console.log(`\nИТОГО: PASS ${passed} / FAIL ${failed}`);
if (failures.length) {
  console.error("Провалены:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

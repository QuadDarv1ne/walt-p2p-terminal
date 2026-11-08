import { P2PAd, Side } from "./types";

/**
 * Чистая логика фильтрации объявлений — пользовательские сценарии.
 * Вынесена из UI, чтобы её можно было покрыть автотестами
 * (scripts/test-logic.ts) и исключить расхождение между таблицей и тестами.
 */

/** Разбор суммы пользователя: «15 000», «15,5» → число > 0, иначе null */
export function parseAmount(input: string | null | undefined): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[\s\u00A0]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Проверка лимитов объявления под сумму сделки пользователя.
 *
 * Правила (границы включительны):
 *  - minAmount ≤ 0 — «без минимума» (API/демо иногда отдают 0);
 *  - maxAmount ≤ 0 — «без максимума»;
 *  - amount === null — фильтр выключен, проходят все объявления.
 *
 * Пример: объявление [1 000 … 50 000] подходит под 1 000, 15 000 и 50 000,
 * но не под 500 и не под 50 001.
 */
export function fitsAmount(
  ad: { minAmount: number; maxAmount: number },
  amount: number | null,
): boolean {
  if (amount === null) return true;
  if (ad.minAmount > 0 && amount < ad.minAmount) return false;
  if (ad.maxAmount > 0 && amount > ad.maxAmount) return false;
  return true;
}

/** Уникальные способы оплаты из объявлений, по убыванию частоты (потом по алфавиту) */
export function uniquePayments(ads: P2PAd[]): string[] {
  const count = new Map<string, number>();
  for (const a of ads) {
    for (const p of a.payments) count.set(p, (count.get(p) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "ru"))
    .map(([p]) => p);
}

export interface AdFilterState {
  search: string;
  onlyOnline: boolean;
  /** сумма сделки пользователя в фиате; null — фильтр выключен */
  amount: number | null;
  /** выбранные способы оплаты; пустой массив — фильтр выключен */
  payments: string[];
}

/** Последовательное применение всех фильтров к списку объявлений */
export function filterAds(ads: P2PAd[], f: AdFilterState): P2PAd[] {
  const q = f.search.trim().toLowerCase();
  return ads.filter((a) => {
    if (f.onlyOnline && !a.isOnline) return false;
    if (!fitsAmount(a, f.amount)) return false;
    if (f.payments.length && !a.payments.some((p) => f.payments.includes(p))) return false;
    if (
      q &&
      !a.nickname.toLowerCase().includes(q) &&
      !a.payments.some((p) => p.toLowerCase().includes(q))
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Код валюты для запроса к API: только латиница, верхний регистр, 2–10 символов.
 * Возвращает null, если после очистки код невалиден (пользовательский ввод).
 */
export function sanitizeCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const clean = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (clean.length < 2 || clean.length > 10) return null;
  return clean;
}

export type AdSortKey = "price" | "executeRate" | "maxAmount";

/**
 * Числовая сортировка объявлений (не лексикографическая!), вход не мутируется.
 * Пустые значения (NaN) и цена ≤ 0 — в конец при любом направлении,
 * чтобы «мусорные» строки не занимали верх списка.
 */
export function sortAds(ads: P2PAd[], key: AdSortKey, dir: "asc" | "desc"): P2PAd[] {
  const mul = dir === "asc" ? 1 : -1;
  const valid = (v: number) => Number.isFinite(v) && (key !== "price" || v > 0);
  return [...ads].sort((a, b) => {
    const av = a[key] as number;
    const bv = b[key] as number;
    if (valid(av) && valid(bv)) return (av - bv) * mul;
    if (valid(av)) return -1;
    if (valid(bv)) return 1;
    return 0;
  });
}

/**
 * Объявление с лучшей ценой для указанной стороны.
 *
 * SELL-объявления продают криптовалюту нам — выгодна минимальная цена;
 * BUY-объявления покупают её у нас — выгодна максимальная.
 *
 * Объявления с ценой ≤ 0 (мусор в ответе API) игнорируются полностью:
 * раньше «лучшим» мог остаться первый элемент с нулевой ценой, и подсветка
 * не появлялась ни на одной строке, хотя валидные предложения были.
 * Возвращает null, если валидных цен нет вовсе.
 */
export function bestAd(ads: P2PAd[], side: Side): P2PAd | null {
  let best: P2PAd | null = null;
  for (const a of ads) {
    if (!Number.isFinite(a.price) || a.price <= 0) continue;
    if (!best) {
      best = a;
      continue;
    }
    if (side === "SELL" ? a.price < best.price : a.price > best.price) best = a;
  }
  return best;
}

import { HistoryPoint } from "./types";

/**
 * Чистая логика истории курсов.
 *
 * Вынесена из стора, чтобы её можно было покрыть автотестами
 * (scripts/test-logic.ts) и исключить расхождение между хранилищем и тестами.
 */

/** Сколько точек храним на одну пару */
export const HISTORY_LIMIT = 240;

/**
 * Сколько разных пар храним одновременно.
 *
 * Без этого лимита история росла бесконечно: пары можно открывать любые
 * (произвольный код валюты), и каждая оставляла в localStorage свои 240 точек —
 * несколько сотен пар переполняли квоту и ломали сохранение всего состояния.
 */
export const MAX_HISTORY_PAIRS = 12;

/** Окно защиты от дублей: чаще, чем раз в 5 с, точку не пишем */
export const HISTORY_DEDUP_MS = 5000;

/**
 * Добавляет точку к ряду пары.
 *
 * Возвращает новый массив, вход не мутирует. Если последняя точка добавлена
 * меньше HISTORY_DEDUP_MS назад — ряд возвращается как есть (защита от дублей
 * при нескольких параллельных запросах).
 */
export function appendHistoryPoint(
  series: HistoryPoint[] | undefined,
  best: number,
  now: number,
): HistoryPoint[] {
  const points = series ?? [];
  const last = points[points.length - 1];
  if (last && now - last.t < HISTORY_DEDUP_MS) return points;
  return [...points, { t: now, best }].slice(-HISTORY_LIMIT);
}

/**
 * Оставляет только MAX_HISTORY_PAIRS самых «свежих» пар.
 *
 * Свежесть определяется последней точкой ряда: пары, которые пользователь
 * открывал давно, вытесняются первыми. Порядок ключей в результате
 * сохраняется по убыванию свежести — так проще проверять в тестах.
 */
export function pruneHistory(
  history: Record<string, HistoryPoint[]>,
): Record<string, HistoryPoint[]> {
  const keys = Object.keys(history);
  if (keys.length <= MAX_HISTORY_PAIRS) return history;

  const lastAt = (key: string) => {
    const series = history[key];
    return series?.[series.length - 1]?.t ?? 0;
  };

  const sorted = [...keys].sort((a, b) => lastAt(b) - lastAt(a));
  const out: Record<string, HistoryPoint[]> = {};
  for (const key of sorted.slice(0, MAX_HISTORY_PAIRS)) out[key] = history[key];
  return out;
}

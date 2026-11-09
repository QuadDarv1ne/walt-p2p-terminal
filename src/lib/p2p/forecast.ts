/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */
import { HistoryPoint } from "./types";

/**
 * Чистая логика прогноза курса по собранной истории.
 *
 * Вынесена из UI, чтобы её можно было покрыть автотестами
 * (scripts/test-logic.ts) и исключить расхождение между графиком и тестами.
 *
 * Честная рамка: это экстраполяция линейного тренда методом наименьших
 * квадратов с оценкой неопределённости — не машинное обучение и не
 * инвестиционная рекомендация. Терминал не имеет ни обучающей выборки,
 * ни данных о стакане, поэтому прогноз ограничен тем, что видно в ряду.
 */

/**
 * Минимум точек, при котором прогноз имеет смысл.
 *
 * Меньше восьми точек — наклон слишком чувствителен к одной-двум сделкам:
 * при шаге обновления 30 с это всего ~4 минуты наблюдений.
 */
export const MIN_POINTS_FOR_FORECAST = 8;

/**
 * Максимальный горизонт прогноза в минутах.
 *
 * Два часа: при типичном интервале 30 с это ровно 240 точек ряда. Дальше
 * экстраполяция линейного тренда теряет смысл настолько, что интервал
 * становится шире самого рынка.
 *
 * Ограничение именно по времени, а не по числу шагов: иначе при быстром
 * автообновлении (10 с) все четыре горизонта упёрлись бы в один и тот же
 * потолок и подписи кнопок слились бы в одинаковые.
 */
export const MAX_HORIZON_MINUTES = 120;

/** Доля истории, отдаваемая под обучение при проверке качества (backtest) */
const BACKTEST_TRAIN_RATIO = 0.7;

/** z-квантиль для 95% интервала (нормальное приближение) */
const Z_95 = 1.96;

/** Наклон считается значимым, если превышает две стандартные ошибки */
const SIGNIFICANCE_SIGMAS = 2;

export interface TrendFit {
  /** число точек, по которым построена прямая */
  n: number;
  /** медианный интервал между точками, мс */
  stepMs: number;
  /** время первой точки — начало отсчёта нормированной оси */
  t0: number;
  /** нормированная координата последней точки (в шагах от t0) */
  lastX: number;
  /** значение прямой в момент последней точки */
  valueAtLast: number;
  /** прирост цены за один шаг обновления */
  slope: number;
  /** свободный член прямой в нормированных координатах */
  intercept: number;
  /** стандартная ошибка наклона */
  slopeStd: number;
  /** стандартная ошибка остатков (в единицах цены) */
  residualStd: number;
  /** доля объяснённой дисперсии; null — цена не менялась вовсе */
  r2: number | null;
  /** среднее нормированной оси — нужна для интервала прогноза */
  meanX: number;
  /** сумма квадратов отклонений по оси времени */
  sxx: number;
}

/**
 * Медианный интервал между соседними точками.
 *
 * Именно медиана, а не среднее: ряд собирается по таймеру, но при возврате
 * на вкладку появляются «дырки» в несколько минут, и среднее сильно уехало бы.
 */
function medianStep(points: HistoryPoint[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i].t - points[i - 1].t;
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return 1;
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
}

/**
 * Ряд в хронологическом порядке и только с валидными точками.
 *
 * Порядок в сторе не гарантирован: история приезжает из localStorage, а при
 * синхронизации вкладок (`applySyncState`) целиком заменяется снапшотом другой
 * вкладки. Любая статистика (наклон, волатильность, ломаная графика) обязана
 * считаться по времени, а не по порядку массива — иначе «приращение»
 * считается между случайными по датам точками.
 */
export function chronological(points: HistoryPoint[]): HistoryPoint[] {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.best))
    .sort((a, b) => a.t - b.t);
}

/**
 * Линейный тренд по точкам истории (метод наименьших квадратов).
 *
 * Ось времени нормируется шагом обновления: тогда `slope` — это прирост цены
 * за один шаг, и он не зависит от того, в миллисекундах или секундах пришло
 * время. Точки сортируются по времени: после перезагрузки вкладки порядок
 * в сторе может не совпадать с хронологией.
 *
 * Возвращает null, если точек мало (< MIN_POINTS_FOR_FORECAST) или все они
 * имеют одинаковую метку времени (вырожденная ось — наклон не определён).
 */
export function fitTrend(points: HistoryPoint[]): TrendFit | null {
  const sorted = chronological(points);
  if (sorted.length < MIN_POINTS_FOR_FORECAST) return null;

  const stepMs = medianStep(sorted);
  const t0 = sorted[0].t;
  const n = sorted.length;

  const xs = sorted.map((p) => (p.t - t0) / stepMs);
  const ys = sorted.map((p) => p.best);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (!(sxx > 0)) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (intercept + slope * xs[i]);
    ssRes += r * r;
  }

  const dof = Math.max(1, n - 2);
  const residualStd = Math.sqrt(ssRes / dof);
  const slopeStd = residualStd / Math.sqrt(sxx);
  const lastX = xs[n - 1];

  return {
    n,
    stepMs,
    t0,
    lastX,
    valueAtLast: intercept + slope * lastX,
    slope,
    intercept,
    slopeStd,
    residualStd,
    // при нулевой дисперсии цены объяснять нечего — коэффициент не определён
    r2: syy > 0 ? 1 - ssRes / syy : null,
    meanX,
    sxx,
  };
}

/** Значение прямой через `steps` шагов после последней точки ряда */
export function forecastValue(fit: TrendFit, steps: number): number {
  return fit.intercept + fit.slope * (fit.lastX + steps);
}

/**
 * Границы 95% интервала прогноза через `steps` шагов.
 *
 * Ширина растёт с горизонтом: (x − среднее)² уходит от центра ряда, поэтому
 * прогноз на сутки вперёд по получасовой истории честно выглядит широким.
 */
export function forecastInterval(fit: TrendFit, steps: number): { low: number; high: number } {
  const x = fit.lastX + steps;
  const se = fit.residualStd * Math.sqrt(1 + 1 / fit.n + ((x - fit.meanX) ** 2) / fit.sxx);
  const value = forecastValue(fit, steps);
  // нижняя граница не бывает отрицательной: курс валюты физически > 0,
  // иначе UI показывал бы абсурд вида «−500 … +900» на длинном горизонте
  const low = Math.max(0, value - Z_95 * se);
  // при обвальном тренде сама точка прогноза может уйти в минус — верхняя
  // граница не должна оказаться ниже нижней
  return { low, high: Math.max(low, value + Z_95 * se) };
}

export type TrendDirection = "up" | "down" | "flat";

/**
 * Направление тренда с проверкой значимости.
 *
 * Слабый наклон на шумном ряду — это не тренд, а случайность: сравниваем
 * наклон с его стандартной ошибкой. Иначе интерфейс объявлял бы рост там,
 * где цена просто дрожит.
 *
 * Нулевая стандартная ошибка означает идеальную подгонку (все точки лежат на
 * прямой) — это не повод считать тренд отсутствующим: тогда значим любой
 * ненулевой наклон.
 */
export function trendDirection(fit: TrendFit): TrendDirection {
  if (!(fit.slopeStd > 0)) return fit.slope !== 0 ? (fit.slope > 0 ? "up" : "down") : "flat";
  if (Math.abs(fit.slope) < SIGNIFICANCE_SIGMAS * fit.slopeStd) return "flat";
  return fit.slope > 0 ? "up" : "down";
}

/** Ожидаемое изменение цены за час в процентах от текущего уровня */
export function trendPerHour(fit: TrendFit): number | null {
  if (!(fit.valueAtLast > 0) || !(fit.stepMs > 0)) return null;
  const stepsPerHour = 3_600_000 / fit.stepMs;
  return ((fit.slope * stepsPerHour) / fit.valueAtLast) * 100;
}

/**
 * Волатильность: стандартное отклонение относительных изменений цены
 * за один шаг. Возвращается в долях (0,004 = 0,4%).
 */
export function volatilityPerStep(points: HistoryPoint[]): number | null {
  const sorted = chronological(points);
  if (sorted.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].best;
    if (prev > 0) returns.push((sorted[i].best - prev) / prev);
  }
  if (returns.length < 2) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

/**
 * Проверка качества прогноза на собранной истории: обучаем прямую на первых
 * 70% точек и измеряем среднюю абсолютную ошибку (MAPE) на оставшихся 30%.
 *
 * Это честная оценка «как модель вела бы себя на новых данных», а не подгонка:
 * тестовые точки в построение прямой не входят. Возвращает проценты либо null,
 * если данных для разделения не хватает.
 */
export function backtestMape(points: HistoryPoint[]): number | null {
  const sorted = chronological(points);
  if (sorted.length < MIN_POINTS_FOR_FORECAST) return null;

  const trainCount = Math.floor(sorted.length * BACKTEST_TRAIN_RATIO);
  if (trainCount < MIN_POINTS_FOR_FORECAST || sorted.length - trainCount < 2) return null;

  const fit = fitTrend(sorted.slice(0, trainCount));
  if (!fit) return null;

  let sum = 0;
  let counted = 0;
  for (const p of sorted.slice(trainCount)) {
    if (!(p.best > 0)) continue;
    const x = (p.t - fit.t0) / fit.stepMs;
    const pred = fit.intercept + fit.slope * x;
    sum += Math.abs((p.best - pred) / p.best);
    counted++;
  }
  if (!counted) return null;
  return (sum / counted) * 100;
}

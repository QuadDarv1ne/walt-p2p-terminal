"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BrainCircuit, Info, Minus, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "@/lib/p2p/forecast";
import { formatPercent, formatPrice, formatTime, formatSignedPercent } from "@/lib/p2p/format";
import { useP2PStore } from "@/lib/p2p/store";
import { pairKey } from "@/lib/p2p/types";

/**
 * Горизонты прогноза в минутах.
 *
 * Именно в минутах, а не в «шагах обновления»: пользователь мыслит временем,
 * а шаг зависит от интервала автообновления. В шагах раньше получалось два
 * одинаковых пункта «+1 мин» при интервале 30 с.
 */
const HORIZON_MINUTES = [5, 15, 60, MAX_HORIZON_MINUTES];

/** Ширина 95% интервала, выше которой прогноз перестаёт быть полезным */
const WIDE_INTERVAL_PCT = 5;

/**
 * Максимум точек прогноза на графике.
 *
 * При шаге 10 с и горизонте 2 ч их получилось бы 720 — график бы тормозил.
 * Прогноз линейный: достаточно ~20 точек, чтобы форма не отличалась от прямой.
 */
const MAX_FORECAST_POINTS = 20;

/**
 * Сколько шагов ряда соответствует горизонту в минутах.
 *
 * Потолок — MAX_HORIZON_MINUTES: дальше линейная экстраполяция даёт интервал
 * шире самого рынка. Подпись кнопки считается по фактическому числу шагов,
 * иначе при редком автообновлении она обещала бы время, которого на графике нет.
 */
function stepsForHorizon(minutes: number, stepMs: number): number {
  if (!(stepMs > 0)) return 1;
  const capped = Math.min(minutes, MAX_HORIZON_MINUTES);
  return Math.max(1, Math.round((capped * 60_000) / stepMs));
}

/** Человекочитаемая длительность горизонта по фактическому числу шагов */
function horizonLabel(steps: number, stepMs: number): string {
  const minutes = Math.round((steps * stepMs) / 60_000);
  if (minutes < 60) return `+${Math.max(1, minutes)} мин`;
  const hours = minutes / 60;
  return `+${Number.isInteger(hours) ? hours : hours.toFixed(1)} ч`;
}

function directionMeta(dir: "up" | "down" | "flat") {
  switch (dir) {
    case "up":
      return { label: "рост", icon: TrendingUp, className: "text-emerald-600 dark:text-emerald-400" };
    case "down":
      return { label: "снижение", icon: TrendingDown, className: "text-rose-600 dark:text-rose-400" };
    default:
      return { label: "боковик", icon: Minus, className: "text-muted-foreground" };
  }
}

/**
 * Оценка «уверенности» прогноза — не вероятность из модели, а сводная
 * характеристика качества подгонки: доля объяснённой дисперсии и ошибка
 * backtest. Пользователю важно видеть, что прогноз бывает бесполезен.
 */
function confidenceScore(r2: number | null, mape: number | null): number {
  const r2Part = r2 === null ? 0.5 : Math.max(0, Math.min(1, r2));
  const mapePart = mape === null ? 0.5 : Math.max(0, 1 - mape / 5);
  return Math.round(((r2Part + mapePart) / 2) * 100);
}

export function ForecastPanel() {
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);
  const side = useP2PStore((s) => s.side);
  const refreshSec = useP2PStore((s) => s.settings.refreshSec);
  const history = useP2PStore((s) => s.history[pairKey(crypto, fiat, side)]);

  const [horizonMin, setHorizonMin] = useState(HORIZON_MINUTES[1]);

  // ряд нормализуется один раз: и fitTrend, и график должны видеть одну и ту
  // же хронологию, иначе линия рисует « назад по времени» после синхронизации
  // вкладок, а ReferenceLine встаёт не на последнюю точку
  const points = useMemo(() => chronological(history), [history]);
  const fit = useMemo(() => fitTrend(points), [points]);
  const mape = useMemo(() => backtestMape(points), [points]);
  const vol = useMemo(() => volatilityPerStep(points), [points]);

  // Горизонт, точки графика и все производные метрики считаются в одном useMemo:
  // `steps` зависит от шага ряда, поэтому раздельные мемоизации
  // рассинхронизировались бы при смене интервала автообновления (и ломали бы
  // preserve-manual-memoization у React Compiler).
  const forecast = useMemo(() => {
    if (!fit) return null;
    const steps = stepsForHorizon(horizonMin, fit.stepMs);
    const series = points.map((p) => ({
      t: p.t,
      actual: p.best as number | undefined,
      forecast: undefined as number | undefined,
    }));
    // соединяем историю и прогноз в последней фактической точке
    const last = series[series.length - 1];
    if (last) last.forecast = fit.valueAtLast;
    // Прогноз — отрезок прямой, лишних точек ему не нужно: при шаге 10 с и
    // горизонте 2 ч их получилось бы 720, и график тормозил бы без всякой
    // пользы. Прореживаем, всегда оставляя конечную точку, чтобы подпись
    // горизонта совпадала с нарисованным.
    const stride = Math.max(1, Math.ceil(steps / MAX_FORECAST_POINTS));
    for (let s = stride; s < steps; s += stride) {
      series.push({
        t: fit.t0 + (fit.lastX + s) * fit.stepMs,
        actual: undefined,
        forecast: forecastValue(fit, s),
      });
    }
    const value = forecastValue(fit, steps);
    const interval = forecastInterval(fit, steps);
    series.push({
      t: fit.t0 + (fit.lastX + steps) * fit.stepMs,
      actual: undefined,
      forecast: value,
    });
    const changePct =
      fit.valueAtLast > 0 ? ((value - fit.valueAtLast) / fit.valueAtLast) * 100 : null;
    const widthPct =
      fit.valueAtLast > 0 ? ((interval.high - interval.low) / fit.valueAtLast) * 100 : null;
    return {
      steps,
      label: horizonLabel(steps, fit.stepMs),
      value,
      changePct,
      interval,
      widthPct,
      series,
    };
  }, [fit, points, horizonMin]);

  if (!fit || !forecast) {
    const need = Math.max(0, MIN_POINTS_FOR_FORECAST - points.length);
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-primary" />
            Прогноз курса
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center text-xs text-muted-foreground">
            <span>
              Нужно минимум {MIN_POINTS_FOR_FORECAST} точек истории — сейчас {points.length}.
            </span>
            <span>
              Осталось набрать: {need}. При интервале {refreshSec} с это примерно{" "}
              {Math.ceil((need * refreshSec) / 60)} мин работы вкладки.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const dir = trendDirection(fit);
  const meta = directionMeta(dir);
  const DirIcon = meta.icon;
  const { value, changePct, widthPct, label: horizonText, interval: { low, high } } = forecast;
  const perHour = trendPerHour(fit);
  const confidence = confidenceScore(fit.r2, mape);

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-primary" />
            Прогноз курса
          </CardTitle>
          <Badge variant="outline" className={`gap-1 ${meta.className}`}>
            <DirIcon className="h-3 w-3" />
            {meta.label}
          </Badge>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {crypto}/{fiat} · {side === "SELL" ? "покупка" : "продажа"} · точек: {fit.n}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={String(horizonMin)} onValueChange={(v) => setHorizonMin(Number(v))}>
          <TabsList className="grid w-full grid-cols-4">
            {HORIZON_MINUTES.map((m) => (
              <TabsTrigger key={m} value={String(m)}>
                {horizonLabel(stepsForHorizon(m, fit.stepMs), fit.stepMs)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <div className="text-[11px] text-muted-foreground">Прогноз через {horizonText.replace("+", "")}</div>
            <div className="num mt-1 text-lg font-semibold">
              {formatPrice(value)} <span className="text-xs font-normal text-muted-foreground">{fiat}</span>
            </div>
            <div className={`num mt-0.5 text-xs ${meta.className}`}>
              {changePct === null ? "—" : formatSignedPercent(changePct)}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="text-[11px] text-muted-foreground">Интервал 95%</div>
            <div className="num mt-1 text-sm font-medium">
              {formatPrice(low)} … {formatPrice(high)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              ширина {widthPct === null ? "—" : formatPercent(widthPct)}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="text-[11px] text-muted-foreground">Тренд в час</div>
            <div className={`num mt-1 text-sm font-medium ${meta.className}`}>
              {perHour === null ? "—" : formatSignedPercent(perHour)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              волатильность за шаг: {vol === null ? "—" : formatPercent(vol * 100)}
            </div>
          </div>
        </div>

        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={forecast.series} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="grad-actual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-forecast" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.2)" />
              <XAxis
                dataKey="t"
                tickFormatter={formatTime}
                minTickGap={48}
                tick={{ fontSize: 10 }}
                stroke="rgba(128,128,128,0.5)"
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 10 }}
                width={64}
                tickFormatter={(v: number) => formatPrice(v)}
                stroke="rgba(128,128,128,0.5)"
              />
              <Tooltip
                formatter={(val, name) => [
                  `${formatPrice(Number(val))} ${fiat}`,
                  name === "forecast" ? "прогноз" : "факт",
                ]}
                labelFormatter={(label) => formatTime(Number(label))}
                contentStyle={{
                  // цвет берём из переменной темы: захардкоженный фон делал
                  // тултип тёмным пятном в светлой и небесной темах
                  background: "var(--popover)",
                  color: "var(--popover-foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              {/* граница «факт → прогноз»: правее этой линии данных уже нет */}
              <ReferenceLine
                x={points[points.length - 1].t}
                stroke="rgba(139,92,246,0.6)"
                strokeDasharray="4 4"
              />
              <Area
                type="monotone"
                dataKey="actual"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#grad-actual)"
                dot={false}
                connectNulls={false}
                name="actual"
              />
              <Area
                type="monotone"
                dataKey="forecast"
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="5 4"
                fill="url(#grad-forecast)"
                dot={false}
                connectNulls={false}
                name="forecast"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              Надёжность подгонки
              {fit.r2 === null ? " (цена не менялась)" : ""}
            </span>
            <span className="num">{confidence}%</span>
          </div>
          <Progress value={confidence} className="h-1.5" aria-label="Надёжность прогноза" />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>R²: {fit.r2 === null ? "—" : formatPercent(fit.r2 * 100, 1)}</span>
            <span>ошибка на тесте: {mape === null ? "—" : formatPercent(mape)}</span>
            <span>шаг: {Math.round(fit.stepMs / 1000)} с</span>
          </div>
        </div>

        {widthPct !== null && widthPct > WIDE_INTERVAL_PCT && (
          <Alert className="border-amber-500/50">
            <TriangleAlert className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-[11px] leading-snug">
              Интервал шире {formatPercent(WIDE_INTERVAL_PCT, 0)} — на таком горизонте ряд слишком
              шумный, чтобы прогноз был практичным. Смотрите короткие горизонты или накопите больше истории.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Прогноз — линейная экстраполяция собранной истории (метод наименьших квадратов) с
            проверкой значимости наклона: слабый наклон на шумном ряду показывается как «боковик».
            Это не машинное обучение и не инвестиционная рекомендация: ряд собирается только из
            лучших курсов, которые видел ваш браузер.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

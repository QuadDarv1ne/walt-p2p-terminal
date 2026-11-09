"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Activity, Percent, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatMoney, formatPercent, formatPrice, formatSignedPercent, timeAgo } from "@/lib/p2p/format";
import { chronological } from "@/lib/p2p/forecast";
import { useP2PStore } from "@/lib/p2p/store";
import { P2PAd, PairQuote, pairKey } from "@/lib/p2p/types";

interface StatsCardsProps {
  quote: PairQuote;
  spreadPct: number | null;
  /** bid > ask: лучший курс продажи выше лучшего курса покупки */
  spreadInverted: boolean;
  /** объявления, задающие лучшие курсы — показываем их лимиты при инверсии */
  bestAds: { buy: P2PAd | null; sell: P2PAd | null };
  lastUpdated: number | null;
}

function Delta({ pairId }: { pairId: string }) {
  const rawHistory = useP2PStore((s) => s.history[pairId]);
  // порядок в сторе не гарантирован: история приезжает из localStorage, а при
  // синхронизации вкладок заменяется снапшотом другой вкладки. Без сортировки
  // «предыдущая» точка могла быть хронологически новее последней, и стрелка
  // показывала обратное направление.
  const history = useMemo(() => chronological(rawHistory), [rawHistory]);
  if (history.length < 2) {
    return <span className="text-xs text-muted-foreground">копим статистику…</span>;
  }
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  if (!(prev.best > 0)) {
    return <span className="text-xs text-muted-foreground">копим статистику…</span>;
  }
  const delta = ((last.best - prev.best) / prev.best) * 100;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) {
    return <span className="text-xs text-muted-foreground">без изменений</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {formatSignedPercent(delta)}
    </span>
  );
}

/** «1 000 – 5 000 RUB» или null, если лимиты не заданы */
function limitsLabel(ad: P2PAd | null, fiat: string): string | null {
  if (!ad) return null;
  const hasMin = ad.minAmount > 0;
  const hasMax = ad.maxAmount > 0;
  if (!hasMin && !hasMax) return null;
  if (hasMin && hasMax) {
    return `${formatMoney(ad.minAmount, 0)} – ${formatMoney(ad.maxAmount, 0)} ${fiat}`;
  }
  return hasMin ? `от ${formatMoney(ad.minAmount, 0)} ${fiat}` : `до ${formatMoney(ad.maxAmount, 0)} ${fiat}`;
}

export function StatsCards({ quote, spreadPct, spreadInverted, bestAds, lastUpdated }: StatsCardsProps) {
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);

  const onlinePct = quote.totalCount ? (quote.onlineCount / quote.totalCount) * 100 : 0;

  // при инверсии подсказываем лимиты лидера по продаже: именно они делают курс
  // недоступным на произвольную сумму, и это единственное объяснение минуса
  const invertedAd = bestAds.sell;
  const invertedLimits = spreadInverted ? limitsLabel(invertedAd, fiat) : null;
  const invertedMaker = spreadInverted && invertedAd?.nickname ? ` (${invertedAd.nickname})` : "";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="border-emerald-500/25">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Купить {crypto} · лучший курс</span>
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
          </div>
          <div className="num mt-1.5 text-2xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatPrice(quote.bestBuy)} <span className="text-sm font-normal text-muted-foreground">{fiat}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <Delta pairId={pairKey(crypto, fiat, "SELL")} />
            <span className="text-[11px] text-muted-foreground">по SELL-объявлениям</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-rose-500/25">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Продать {crypto} · лучший курс</span>
            <span className="h-2 w-2 rounded-full bg-rose-500" />
          </div>
          <div className="num mt-1.5 text-2xl font-semibold tracking-tight text-rose-600 dark:text-rose-400">
            {formatPrice(quote.bestSell)} <span className="text-sm font-normal text-muted-foreground">{fiat}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <Delta pairId={pairKey(crypto, fiat, "BUY")} />
            <span className="text-[11px] text-muted-foreground">по BUY-объявлениям</span>
          </div>
        </CardContent>
      </Card>

      <Card className={spreadInverted ? "border-amber-500/50" : undefined}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Спред рынка</span>
            <Percent className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="num text-2xl font-semibold tracking-tight text-amber-600 dark:text-amber-400">
              {spreadPct === null ? "—" : formatPercent(spreadPct)}
            </span>
            {spreadInverted && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/60 text-[10px] text-amber-700 dark:text-amber-400"
                title="Продать можно дороже, чем купить: выгодный курс ограничен лимитами объявления"
              >
                <TriangleAlert className="h-3 w-3" />
                инверсия
              </Badge>
            )}
          </div>
          <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {spreadInverted ? (
              <>
                продажа дороже покупки: лучший курс держится
                {invertedLimits ? <> на лимите {invertedLimits}</> : " на узком лимите объявления"}
                {invertedMaker}. На вашу сумму курс может быть другим.
              </>
            ) : (
              "разница между курсами продажи и покупки относительно середины рынка"
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Активность мейкеров</span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="num mt-1.5 text-2xl font-semibold tracking-tight">
            {quote.onlineCount}
            <span className="text-base font-normal text-muted-foreground"> / {quote.totalCount} в сети</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Progress value={onlinePct} className="h-1.5" aria-label="Доля мейкеров в сети" />
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">обновлено: {timeAgo(lastUpdated)}</div>
        </CardContent>
      </Card>
    </div>
  );
}

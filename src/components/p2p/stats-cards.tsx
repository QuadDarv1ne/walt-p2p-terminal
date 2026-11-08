"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { ArrowDownRight, ArrowUpRight, Activity, Percent } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatPercent, formatPrice, formatSignedPercent, timeAgo } from "@/lib/p2p/format";
import { useP2PStore } from "@/lib/p2p/store";
import { PairQuote, pairKey } from "@/lib/p2p/types";

interface StatsCardsProps {
  quote: PairQuote;
  spreadPct: number | null;
  lastUpdated: number | null;
}

function Delta({ pairId }: { pairId: string }) {
  const history = useP2PStore((s) => s.history[pairId]);
  if (!history || history.length < 2) {
    return <span className="text-xs text-muted-foreground">копим статистику…</span>;
  }
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const delta = ((last.best - prev.best) / prev.best) * 100;
  if (Math.abs(delta) < 0.0001) {
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

export function StatsCards({ quote, spreadPct, lastUpdated }: StatsCardsProps) {
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);

  const onlinePct = quote.totalCount ? (quote.onlineCount / quote.totalCount) * 100 : 0;

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

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Спред рынка</span>
            <Percent className="h-4 w-4 text-amber-500" />
          </div>
          <div className="num mt-1.5 text-2xl font-semibold tracking-tight text-amber-600 dark:text-amber-400">
            {spreadPct === null ? "—" : formatPercent(spreadPct)}
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            разница между курсами продажи и покупки
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

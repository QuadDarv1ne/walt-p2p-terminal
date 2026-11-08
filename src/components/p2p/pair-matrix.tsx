"use client";

import { ExternalLink, LayoutGrid, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPercent, formatPrice } from "@/lib/p2p/format";
import { useP2PStore } from "@/lib/p2p/store";
import { CRYPTOS } from "@/lib/p2p/types";
import type { MatrixEntry } from "@/hooks/use-p2p-data";

const CRYPTO_COLOR: Record<string, string> = {
  USDT: "#10b981",
  USDC: "#14b8a6",
  BTC: "#f59e0b",
  ETH: "#a78bfa",
  TON: "#f43f5e",
  BNB: "#eab308",
};

interface PairMatrixProps {
  fiat: string;
  matrix: Record<string, MatrixEntry>;
  loading: boolean;
  selectedCrypto: string;
  onRefresh: () => void;
}

export function PairMatrix({ fiat, matrix, loading, selectedCrypto, onRefresh }: PairMatrixProps) {
  const setPair = useP2PStore((s) => s.setPair);

  const select = (crypto: string) => {
    setPair(crypto, fiat);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutGrid className="h-4 w-4 text-primary" />
          Все рынки · <span className="text-muted-foreground">{fiat}</span>
        </CardTitle>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CRYPTOS.map((c) => {
            const entry = matrix[`${c}|${fiat}`];
            // единая формула со сводкой сверху: (лучшая покупка ask − лучшая продажа bid) / ask
            const spread =
              entry?.bestBuy && entry?.bestSell
                ? ((entry.bestBuy - entry.bestSell) / entry.bestBuy) * 100
                : null;
            const selected = c === selectedCrypto;
            return (
              <button
                key={c}
                onClick={() => select(c)}
                className={`rounded-xl border p-3.5 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 ${
                  selected ? "border-primary/70 bg-primary/5 ring-1 ring-primary/40" : "border-border"
                }`}
                aria-label={`Открыть пару ${c}/${fiat}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: CRYPTO_COLOR[c] ?? "#71717a" }}
                  >
                    {c.slice(0, 2)}
                  </span>
                  <span className="text-sm font-semibold">
                    {c}
                    <span className="text-muted-foreground">/{fiat}</span>
                  </span>
                  {selected && (
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      открыта
                    </Badge>
                  )}
                </div>
                {!entry ? (
                  <div className="mt-3 space-y-1.5">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : (
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Купить по</span>
                      <span className="num font-medium text-emerald-600 dark:text-emerald-400">
                        {formatPrice(entry.bestBuy)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Продать по</span>
                      <span className="num font-medium text-rose-600 dark:text-rose-400">
                        {formatPrice(entry.bestSell)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Спред</span>
                      <span className="num text-amber-600 dark:text-amber-400">
                        {spread === null ? "—" : formatPercent(spread)}
                      </span>
                    </div>
                    <div className="pt-1 text-[11px] text-muted-foreground">
                      в сети: {entry.onlineCount} из {entry.totalCount}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ExternalLink className="h-3 w-3" />
          Нажмите на карточку, чтобы открыть пару в терминале
        </p>
      </CardContent>
    </Card>
  );
}

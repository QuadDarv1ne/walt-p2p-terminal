"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { useMemo, useState } from "react";
import { Calculator as CalcIcon, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, formatPercent, formatPrice } from "@/lib/p2p/format";
import { useP2PStore } from "@/lib/p2p/store";
import { PairQuote } from "@/lib/p2p/types";

function fmtCrypto(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const frac = v >= 100 ? 2 : v >= 1 ? 4 : 6;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: frac }).format(v);
}

interface CalcResult {
  primaryLabel: string;
  primaryValue: string;
  roundTripLabel: string;
  roundTripValue: string;
  profit: number | null;
  profitPct: number | null;
}

export function Calculator({ quote }: { quote: PairQuote }) {
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("10000");
  const [fee, setFee] = useState("0");

  const res: CalcResult | null = useMemo(() => {
    const amt = Number(amount.replace(",", "."));
    const feePct = Math.max(0, Number(fee.replace(",", ".")) || 0);
    if (!Number.isFinite(amt) || amt <= 0) return null;
    const { bestBuy, bestSell } = quote;
    if (!bestBuy || !bestSell) return null;

    if (mode === "buy") {
      // покупаем крипту за фиат по лучшему курсу (SELL-объявления)
      const cryptoGot = (amt * (1 - feePct / 100)) / bestBuy;
      // сразу продаём её по лучшему курсу (BUY-объявления)
      const fiatBack = cryptoGot * bestSell * (1 - feePct / 100);
      const profit = fiatBack - amt;
      return {
        primaryLabel: `Получите по лучшему курсу покупки`,
        primaryValue: `${fmtCrypto(cryptoGot)} ${crypto}`,
        roundTripLabel: "Обратная продажа принесёт",
        roundTripValue: `${formatMoney(fiatBack, 2)} ${fiat}`,
        profit,
        profitPct: (profit / amt) * 100,
      };
    }

    // продаём крипту за фиат по лучшему курсу (BUY-объявления)
    const fiatBack = amt * bestSell * (1 - feePct / 100);
    // и выкупаем её обратно
    const cryptoBack = (fiatBack * (1 - feePct / 100)) / bestBuy;
    const profit = cryptoBack - amt;
    return {
      primaryLabel: "Получите по лучшему курсу продажи",
      primaryValue: `${formatMoney(fiatBack, 2)} ${fiat}`,
      roundTripLabel: "Обратная покупка вернёт",
      roundTripValue: `${fmtCrypto(cryptoBack)} ${crypto}`,
      profit,
      profitPct: amt > 0 ? (profit / amt) * 100 : null,
    };
  }, [amount, fee, mode, quote, crypto, fiat]);

  const presets = mode === "buy" ? ["5000", "10000", "50000"] : ["100", "500", "1000"];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_120px]">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {mode === "buy" ? `Сумма в ${fiat}` : `Количество ${crypto}`}
          </Label>
          <div className="flex gap-2">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={mode === "buy" ? "Сумма в фиате" : "Количество криптовалюты"}
              className="num"
            />
            <div className="flex shrink-0 gap-1">
              {presets.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="num h-9 px-2 text-[11px]"
                  onClick={() => setAmount(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Операция</Label>
          <div className="flex gap-1.5">
            <Button
              variant={mode === "buy" ? "default" : "outline"}
              size="sm"
              className="h-9 flex-1"
              onClick={() => setMode("buy")}
              aria-pressed={mode === "buy"}
            >
              Куплю
            </Button>
            <Button
              variant={mode === "sell" ? "default" : "outline"}
              size="sm"
              className="h-9 flex-1"
              onClick={() => setMode("sell")}
              aria-pressed={mode === "sell"}
            >
              Продам
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="calc-fee" className="text-xs text-muted-foreground">
            Комиссия, %
          </Label>
          <Input
            id="calc-fee"
            inputMode="decimal"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="num"
            aria-label="Комиссия в процентах"
          />
        </div>
      </div>

      {res ? (
        <div className="space-y-2.5 rounded-lg border border-border p-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">{res.primaryLabel}</span>
            <span className="num text-lg font-semibold">{res.primaryValue}</span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border/70 pt-2.5">
            <span className="text-xs text-muted-foreground">{res.roundTripLabel}</span>
            <span className="num text-sm font-medium">{res.roundTripValue}</span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border/70 pt-2.5">
            <span className="text-xs text-muted-foreground">Круговая сделка (купить → продать)</span>
            <span className="flex items-center gap-2">
              {res.profit !== null && (
                <span
                  className={`num text-sm font-semibold ${
                    res.profit > 0.000001
                      ? "text-emerald-600 dark:text-emerald-400"
                      : res.profit < -0.000001
                        ? "text-rose-600 dark:text-rose-400"
                        : ""
                  }`}
                >
                  {res.profit >= 0 ? "+" : "−"}
                  {mode === "buy"
                    ? formatMoney(Math.abs(res.profit), 2)
                    : fmtCrypto(Math.abs(res.profit))}
                  {mode === "buy" ? ` ${fiat}` : ` ${crypto}`}
                </span>
              )}
              {res.profitPct !== null && (
                <Badge
                  variant="outline"
                  className={`num ${
                    res.profitPct > 0
                      ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                      : res.profitPct < 0
                        ? "border-rose-500/50 text-rose-600 dark:text-rose-400"
                        : ""
                  }`}
                >
                  {formatPercent(Math.abs(res.profitPct))}
                </Badge>
              )}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
          Введите сумму — расчёт появится, когда известны оба лучших курса
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Расчёт по лучшим курсам {crypto}/{fiat}: покупка {formatPrice(quote.bestBuy)} · продажа{" "}
          {formatPrice(quote.bestSell)}. Комиссия платформы в P2P API не публикуется — при необходимости
          укажите её вручную. Сделка совершается в интерфейсе P2P Маркета Walt.
        </span>
      </div>
    </div>
  );
}

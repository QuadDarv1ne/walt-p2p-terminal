"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useP2PStore } from "@/lib/p2p/store";
import { sanitizeCode } from "@/lib/p2p/filters";
import { CRYPTOS, FIATS, FIAT_LABEL, Side } from "@/lib/p2p/types";

function CustomPairPopover() {
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);
  const setPair = useP2PStore((s) => s.setPair);
  const [open, setOpen] = useState(false);
  const [cryptoText, setCryptoText] = useState("");
  const [fiatText, setFiatText] = useState("");

  const submit = () => {
    const c = sanitizeCode(cryptoText);
    const f = sanitizeCode(fiatText);
    if (!c || !f) {
      toast.error("Коды валют: только латиница, 2–10 символов", {
        description: "Например: USDT и RUB, BTC и KZT…",
      });
      return;
    }
    setPair(c, f);
    toast.success(`Пара ${c}/${f} открыта`, {
      description: "Если Walt не поддерживает её — объявлений не будет.",
    });
    setOpen(false);
    setCryptoText("");
    setFiatText("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setCryptoText(crypto);
          setFiatText(fiat);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full"
          aria-label="Открыть произвольную пару"
          title="Своя пара — любой код валюты, который поддерживает Walt"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div className="text-sm font-medium">Своя пара</div>
        <p className="text-xs text-muted-foreground">
          В списках выше — популярные варианты. Здесь можно ввести любой код,
          который поддерживает Walt P2P Маркет.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="custom-crypto" className="text-xs text-muted-foreground">
            Криптовалюта
          </Label>
          <Input
            id="custom-crypto"
            value={cryptoText}
            onChange={(e) => setCryptoText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="USDT"
            maxLength={10}
            className="num uppercase"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-fiat" className="text-xs text-muted-foreground">
            Фиат
          </Label>
          <Input
            id="custom-fiat"
            value={fiatText}
            onChange={(e) => setFiatText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="RUB"
            maxLength={10}
            className="num uppercase"
            autoComplete="off"
          />
        </div>
        <Button size="sm" className="w-full" onClick={submit}>
          Открыть пару
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function MarketFilters() {
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);
  const side = useP2PStore((s) => s.side);
  const setPair = useP2PStore((s) => s.setPair);
  const setSide = useP2PStore((s) => s.setSide);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end">
        <div className="flex items-center gap-1 text-lg font-semibold tracking-tight">
          <span className="text-primary">{crypto}</span>
          <span className="text-muted-foreground">/</span>
          <span>{fiat}</span>
          <CustomPairPopover />
        </div>

        <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Криптовалюта</Label>
            <Select value={crypto} onValueChange={(v) => setPair(v, fiat)}>
              <SelectTrigger className="w-full sm:w-[140px]" aria-label="Криптовалюта">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CRYPTOS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                {!CRYPTOS.includes(crypto as (typeof CRYPTOS)[number]) && (
                  <SelectItem value={crypto}>{crypto}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Фиат</Label>
            <Select value={fiat} onValueChange={(v) => setPair(crypto, v)}>
              <SelectTrigger className="w-full sm:w-[190px]" aria-label="Фиатная валюта">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    <span className="font-medium">{f}</span>
                    <span className="ml-1.5 text-muted-foreground">{FIAT_LABEL[f]}</span>
                  </SelectItem>
                ))}
                {!FIATS.includes(fiat as (typeof FIATS)[number]) && (
                  <SelectItem value={fiat}>
                    <span className="font-medium">{fiat}</span>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Операция</Label>
            <div className="flex gap-2">
              <Button
                variant={side === "SELL" ? "default" : "outline"}
                size="sm"
                className="h-9 flex-1 sm:flex-none"
                onClick={() => setSide("SELL" as Side)}
                aria-pressed={side === "SELL"}
              >
                <ArrowDownCircle className="mr-1.5 h-4 w-4" />
                Покупаю
              </Button>
              <Button
                variant={side === "BUY" ? "default" : "outline"}
                size="sm"
                className="h-9 flex-1 sm:flex-none"
                onClick={() => setSide("BUY" as Side)}
                aria-pressed={side === "BUY"}
              >
                <ArrowUpCircle className="mr-1.5 h-4 w-4" />
                Продаю
              </Button>
            </div>
          </div>
        </div>

        <p className="text-[11px] leading-snug text-muted-foreground lg:max-w-[220px]">
          «Покупаю» — мейкеры продают криптовалюту (объявления SELL). «Продаю» — мейкеры
          покупают (объявления BUY).
        </p>
      </CardContent>
    </Card>
  );
}

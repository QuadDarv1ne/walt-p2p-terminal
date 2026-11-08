"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BellPlus,
  BellRing,
  Crosshair,
  Plus,
  Star,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator } from "@/components/p2p/calculator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPrice, formatTime, timeAgo } from "@/lib/p2p/format";
import { parseAmount } from "@/lib/p2p/filters";
import { useP2PStore } from "@/lib/p2p/store";
import { AlertOp, Side, pairKey } from "@/lib/p2p/types";
import type { ExtraQuote } from "@/hooks/use-p2p-data";
import type { PairQuote } from "@/lib/p2p/types";

interface MonitorPanelProps {
  quote: PairQuote;
  extraQuotes: Record<string, ExtraQuote>;
}

function ChartSection() {
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);
  const side = useP2PStore((s) => s.side);
  const history = useP2PStore((s) => s.history[pairKey(crypto, fiat, side)]);
  const { resolvedTheme } = useTheme();

  const data = useMemo(
    () => (history ?? []).map((p) => ({ t: p.t, best: p.best })),
    [history],
  );

  const stroke = side === "SELL" ? "#10b981" : "#f43f5e";
  const fillId = `grad-${side.toLowerCase()}`;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Лучший курс {crypto}/{fiat} · {side === "SELL" ? "покупка" : "продажа"}
        </span>
        <span className="num">точек: {data.length}</span>
      </div>
      {data.length < 2 ? (
        <div className="flex h-[210px] items-center justify-center rounded-lg border border-dashed border-border text-center text-xs text-muted-foreground">
          Собираем данные…
          <br />
          График появится после нескольких автообновлений.
        </div>
      ) : (
        <div className="h-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
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
                tickFormatter={(v: number) =>
                  new Intl.NumberFormat("ru-RU", { notation: "compact" }).format(v)
                }
                stroke="rgba(128,128,128,0.5)"
              />
              <Tooltip
                formatter={(value) => [`${formatPrice(Number(value))} ${fiat}`, "Лучший курс"]}
                labelFormatter={(label) => formatTime(Number(label))}
                contentStyle={{
                  background: {
                    light: "#ffffff",
                    sky: "#ffffff",
                    dark: "#1c221f",
                    orange: "#241a12",
                    purple: "#1e1725",
                  }[resolvedTheme ?? "dark"] ?? "#ffffff",
                  border: "1px solid rgba(128,128,128,0.25)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="best"
                stroke={stroke}
                strokeWidth={2}
                fill={`url(#${fillId})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function WatchSection({ extraQuotes }: { extraQuotes: Record<string, ExtraQuote> }) {
  const watchlist = useP2PStore((s) => s.watchlist);
  const toggleWatch = useP2PStore((s) => s.toggleWatch);
  const removeWatch = useP2PStore((s) => s.removeWatch);
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);
  const side = useP2PStore((s) => s.side);
  const setPair = useP2PStore((s) => s.setPair);
  const setSide = useP2PStore((s) => s.setSide);

  const alreadyAdded = watchlist.some(
    (w) => w.crypto === crypto && w.fiat === fiat && w.side === side,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Отслеживаемые пары (до 8). Курс берётся из лучших объявлений.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={alreadyAdded || watchlist.length >= 8}
          onClick={() => {
            toggleWatch(crypto, fiat, side);
            toast.success(`Пара ${crypto}/${fiat} добавлена в избранное`);
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Текущую пару
        </Button>
      </div>

      {!watchlist.length && (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
          Список пуст — добавьте пару кнопкой выше
        </div>
      )}

      <div className="space-y-2">
        {watchlist.map((w) => {
          const key = pairKey(w.crypto, w.fiat, w.side);
          const q = extraQuotes[key];
          return (
            <div
              key={w.id}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
            >
              <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  setPair(w.crypto, w.fiat);
                  setSide(w.side);
                }}
                title="Открыть пару"
              >
                <div className="text-sm font-medium">
                  {w.crypto}/{w.fiat}
                  <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                    {w.side === "SELL" ? "покупка" : "продажа"}
                  </Badge>
                </div>
                <div className="num text-xs text-muted-foreground">
                  {q?.best ? `${formatPrice(q.best)} ${w.fiat}` : "загрузка…"}
                  {q ? ` · обновлено ${timeAgo(q.fetchedAt)}` : ""}
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => removeWatch(w.id)}
                aria-label="Убрать из избранного"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlertsSection({ quote }: { quote: PairQuote }) {
  const alerts = useP2PStore((s) => s.alerts);
  const addAlert = useP2PStore((s) => s.addAlert);
  const toggleAlert = useP2PStore((s) => s.toggleAlert);
  const removeAlert = useP2PStore((s) => s.removeAlert);
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);
  const side = useP2PStore((s) => s.side);

  const currentBest = side === "SELL" ? quote.bestBuy : quote.bestSell;
  const [op, setOp] = useState<AlertOp>("below");
  const [target, setTarget] = useState<string>("");

  const canCreate = parseAmount(target) !== null;

  const create = () => {
    const value = parseAmount(target);
    if (value === null) return;
    addAlert({ crypto, fiat, side, op, target: value });
    toast.success("Алерт создан", {
      description: `${crypto}/${fiat} · ${op === "above" ? "выше" : "ниже"} ${formatPrice(value)} ${fiat}`,
    });
    setTarget("");
  };

  const requestNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("Браузер не поддерживает уведомления");
      return;
    }
    const res = await Notification.requestPermission();
    if (res === "granted") {
      toast.success("Уведомления включены");
      new Notification("P2P Терминал", { body: "Уведомления о ценах включены." });
    } else {
      toast.info("Уведомления не разрешены — алерты будут приходить во всплывающих окнах сайта");
    }
  };

  const notifState =
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "denied";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3 space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <BellPlus className="h-3.5 w-3.5 text-primary" />
          Новый алерт для {crypto}/{fiat} · {side === "SELL" ? "покупка" : "продажа"}
        </div>
        <div className="grid grid-cols-[110px_1fr_auto] items-end gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Условие</Label>
            <Select value={op} onValueChange={(v) => setOp(v as AlertOp)}>
              <SelectTrigger aria-label="Условие алерта">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="above">Выше</SelectItem>
                <SelectItem value="below">Ниже</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Цена {currentBest ? `(сейчас ${formatPrice(currentBest)})` : ""}
            </Label>
            <Input
              inputMode="decimal"
              placeholder="0"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canCreate && create()}
              aria-label="Целевая цена"
            />
          </div>
          <Button size="sm" disabled={!canCreate} onClick={create}>
            Создать
          </Button>
        </div>
        {notifState !== "granted" && (
          <Button variant="outline" size="sm" className="w-full" onClick={requestNotifications}>
            <BellRing className="mr-1.5 h-3.5 w-3.5" />
            Разрешить системные уведомления
          </Button>
        )}
      </div>

      {!alerts.length && (
        <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
          Алертов пока нет — например, «уведоми, если USDT/RUB дешевле 95»
        </div>
      )}

      <div className="space-y-2">
        {alerts.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <Switch
              checked={a.active}
              onCheckedChange={() => toggleAlert(a.id)}
              aria-label="Включить или выключить алерт"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {a.crypto}/{a.fiat}
                <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                  {a.side === "SELL" ? "покупка" : "продажа"}
                </Badge>
              </div>
              <div className="num text-xs text-muted-foreground">
                {a.op === "above" ? "выше" : "ниже"} {formatPrice(a.target)} {a.fiat}
                {a.lastTriggeredAt ? ` · сработал ${timeAgo(a.lastTriggeredAt)}` : ""}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => removeAlert(a.id)}
              aria-label="Удалить алерт"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonitorPanel({ quote, extraQuotes }: MonitorPanelProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Crosshair className="h-4 w-4 text-primary" />
          Мониторинг
          <TrendingUp className="ml-auto h-4 w-4 text-muted-foreground" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="chart">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="chart">Курс</TabsTrigger>
            <TabsTrigger value="watch">Избранное</TabsTrigger>
            <TabsTrigger value="alerts">Алерты</TabsTrigger>
            <TabsTrigger value="calc">Калькулятор</TabsTrigger>
          </TabsList>
          <TabsContent value="chart" className="mt-3">
            <ChartSection />
          </TabsContent>
          <TabsContent value="watch" className="mt-3">
            <WatchSection extraQuotes={extraQuotes} />
          </TabsContent>
          <TabsContent value="alerts" className="mt-3">
            <AlertsSection quote={quote} />
          </TabsContent>
          <TabsContent value="calc" className="mt-3">
            <Calculator quote={quote} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export type { Side };

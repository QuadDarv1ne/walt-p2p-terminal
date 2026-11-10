"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FilterX,
  Search,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { downloadCsv, formatMoney, formatPrice, copyText } from "@/lib/p2p/format";
import { TimeAgo } from "@/components/p2p/time-ago";
import { filterAds, parseAmount, sortAds, uniquePayments, bestAdForAmount } from "@/lib/p2p/filters";
import { P2PAd, Side } from "@/lib/p2p/types";

interface OrdersTableProps {
  ads: P2PAd[];
  side: Side;
  crypto: string;
  fiat: string;
  loading: boolean;
  lastUpdated: number | null;
  /** ошибка загрузки — пустая таблица объясняется ею, а не «фильтрами» */
  hasError?: boolean;
  onRefresh: () => void;
}

type SortKey = "price" | "executeRate" | "maxAmount";
const ROWS_PER_PAGE = 12;

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  return dir === "asc" ? (
    <ArrowUp className="h-3 w-3 text-primary" />
  ) : (
    <ArrowDown className="h-3 w-3 text-primary" />
  );
}

function ratingColor(rate: number): string {
  if (rate >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (rate >= 85) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function copyDealInfo(ad: P2PAd, crypto: string, fiat: string) {
  const text = [
    `Сделка P2P: ${crypto}/${fiat}`,
    `Мейкер: ${ad.nickname}${ad.merchantLevel ? ` (${ad.merchantLevel})` : ""}`,
    `Цена: ${formatPrice(ad.price)} ${fiat}`,
    `Лимиты: ${formatMoney(ad.minAmount, 0)} – ${formatMoney(ad.maxAmount, 0)} ${fiat}`,
    `Оплата: ${ad.payments.join(", ") || "—"}`,
    `Рейтинг: ${ad.executeRate}%`,
  ].join("\n");
  void copyText(text).then((ok) =>
    ok
      ? toast.success("Данные сделки скопированы", {
          description: "Совершите обмен в приложении Walt P2P Маркет",
        })
      : toast.error("Не удалось скопировать", {
          description: "Браузер запретил доступ к буферу обмена — скопируйте данные вручную.",
        }),
  );
}

export function OrdersTable({ ads, side, crypto, fiat, loading, lastUpdated, hasError, onRefresh }: OrdersTableProps) {
  const [search, setSearch] = useState("");
  const [amountText, setAmountText] = useState("");
  const [paySel, setPaySel] = useState<string[]>([]);
  const [onlineOnly, setOnlineOnly] = useState(false);
  // сортировка/страница сбрасываются при смене пары через key-ремаунт компонента
  const [sortKey, setSortKey] = useState<SortKey>("price");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(side === "SELL" ? "asc" : "desc");
  const [page, setPage] = useState(1);

  const amount = useMemo(() => parseAmount(amountText), [amountText]);
  const paymentOptions = useMemo(() => uniquePayments(ads), [ads]);

  const filtered = useMemo(
    () =>
      sortAds(
        filterAds(ads, { search, onlyOnline: onlineOnly, amount, payments: paySel }),
        sortKey,
        sortDir,
      ),
    [ads, search, onlineOnly, amount, paySel, sortKey, sortDir],
  );

  // лучший курс по ВСЕМ полученным объявлениям — бейдж ставится только этой строке,
  // на какой бы странице она ни находилась.
  // При включённом фильтре по сумме «лучшим» считается лучший курс среди объявлений,
  // принимающих эту сумму: иначе бейдж уезжал на строку, отфильтрованную прочь,
  // и в списке не оставалось ни одной подсвеченной цены.
  const bestAdId = useMemo(
    () => bestAdForAmount(ads, side, amount)?.id ?? null,
    [ads, side, amount],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);

  const filtersActive = Boolean(search.trim()) || onlineOnly || amount !== null || paySel.length > 0;
  const resetFilters = () => {
    setSearch("");
    setAmountText("");
    setPaySel([]);
    setOnlineOnly(false);
    setPage(1);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "price" ? (side === "SELL" ? "asc" : "desc") : "desc");
    }
    setPage(1);
  };

  const togglePayment = (p: string) => {
    setPaySel((sel) => (sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p]));
    setPage(1);
  };

  const exportCsv = () => {
    if (!filtered.length) {
      toast.info("Нет данных для экспорта");
      return;
    }
    downloadCsv(
      `p2p-${crypto}-${fiat}-${side}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Никнейм", "Цена", "Мин. лимит", "Макс. лимит", "Рейтинг", "Способы оплаты", "Статус мейкера", "В сети", "ID объявления"],
      filtered.map((a) => [
        a.nickname,
        a.price,
        a.minAmount,
        a.maxAmount,
        a.executeRate,
        a.payments.join(", "),
        a.merchantLevel ?? "",
        a.isOnline ? "да" : "нет",
        a.id,
      ]),
    );
    toast.success(`Экспортировано объявлений: ${filtered.length}`);
  };

  const sideTitle = side === "SELL" ? "покупка" : "продажа";

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            Объявления · <span className="text-muted-foreground">{sideTitle}</span>
          </CardTitle>
          <Badge variant="secondary" className="num">
            {filtered.length}
          </Badge>
          {amount !== null && (
            <Badge variant="outline" className="num gap-1 border-primary/40 text-[10px] font-normal">
              <Wallet className="h-3 w-3" />
              под сумму {formatMoney(amount, 0)} {fiat}
            </Badge>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            обновлено: <TimeAgo ts={lastUpdated} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[160px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Поиск по нику или способу оплаты…"
              className="pl-8"
              aria-label="Поиск по объявлениям"
            />
          </div>

          <div className="relative w-[150px]">
            <Wallet className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={amountText}
              onChange={(e) => {
                setAmountText(e.target.value);
                setPage(1);
              }}
              inputMode="decimal"
              placeholder={`Сумма, ${fiat}`}
              className="num pl-8"
              aria-label={`Фильтр по сумме сделки в ${fiat}`}
              title={`Показать объявления, принимающие сумму: minAmount ≤ сумма ≤ maxAmount`}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9" aria-label="Фильтр по способу оплаты">
                Оплата
                {paySel.length > 0 && (
                  <Badge variant="secondary" className="num ml-1.5 h-4 px-1 text-[10px]">
                    {paySel.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto thin-scroll">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Способы оплаты из объявлений
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {paymentOptions.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground">Пока нет данных</div>
              )}
              {paymentOptions.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p}
                  checked={paySel.includes(p)}
                  onCheckedChange={() => togglePayment(p)}
                  onSelect={(e) => e.preventDefault()}
                  className="text-sm"
                >
                  {p}
                </DropdownMenuCheckboxItem>
              ))}
              {paySel.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <button
                    className="w-full rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      setPaySel([]);
                      setPage(1);
                    }}
                  >
                    Сбросить выбор
                  </button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-2">
            <Switch
              id="online-only"
              checked={onlineOnly}
              onCheckedChange={(v) => {
                setOnlineOnly(v);
                setPage(1);
              }}
              aria-label="Только мейкеры в сети"
            />
            <Label htmlFor="online-only" className="text-xs text-muted-foreground cursor-pointer">
              Только в сети
            </Label>
          </div>

          {filtersActive && (
            <Button variant="ghost" size="sm" className="h-9" onClick={resetFilters}>
              <FilterX className="mr-1.5 h-4 w-4" />
              Сбросить
            </Button>
          )}

          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-1.5 h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              Обновить
            </Button>
            <Button variant="default" size="sm" asChild>
              <a
                href="https://walt.io/"
                target="_blank"
                rel="noopener noreferrer"
                title="Сделка совершается вручную в интерфейсе P2P Маркета Walt"
              >
                <ExternalLink className="mr-1.5 h-4 w-4" />
                P2P Маркет
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 px-0 pb-0">
        <div className="overflow-x-auto thin-scroll">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("price")}
                  >
                    Цена <SortIcon active={sortKey === "price"} dir={sortDir} />
                  </button>
                </TableHead>
                <TableHead>Мейкер</TableHead>
                <TableHead className="hidden md:table-cell">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("maxAmount")}
                  >
                    Лимиты <SortIcon active={sortKey === "maxAmount"} dir={sortDir} />
                  </button>
                </TableHead>
                <TableHead className="hidden sm:table-cell">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("executeRate")}
                  >
                    Рейтинг <SortIcon active={sortKey === "executeRate"} dir={sortDir} />
                  </button>
                </TableHead>
                <TableHead className="hidden lg:table-cell">Оплата</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((ad) => {
                const isBest = ad.id === bestAdId;
                return (
                  <TableRow key={ad.id} className={isBest ? "bg-primary/5" : undefined}>
                    <TableCell>
                      <div className="num text-sm font-semibold">
                        {formatPrice(ad.price)}{" "}
                        <span className="text-[11px] font-normal text-muted-foreground">{fiat}</span>
                      </div>
                      {isBest && (
                        <Badge className="mt-1 bg-primary/15 text-primary hover:bg-primary/15">
                          лучший курс
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${ad.isOnline ? "bg-emerald-500" : "bg-zinc-400/50"}`}
                          title={ad.isOnline ? "В сети" : "Не в сети"}
                        />
                        <div className="min-w-0">
                          <div className="max-w-[140px] truncate text-sm font-medium">{ad.nickname}</div>
                          {ad.merchantLevel && (
                            <div className="text-[11px] text-muted-foreground">{ad.merchantLevel}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="num hidden text-xs md:table-cell">
                      {formatMoney(ad.minAmount, 0)} – {formatMoney(ad.maxAmount, 0)}{" "}
                      <span className="text-muted-foreground">{fiat}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className={`num text-sm font-medium ${ratingColor(ad.executeRate)}`}>
                        {ad.executeRate.toFixed(1).replace(".", ",")}%
                      </div>
                      <div className="mt-1 h-1 w-14 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${
                            ad.executeRate >= 95
                              ? "bg-emerald-500"
                              : ad.executeRate >= 85
                                ? "bg-amber-500"
                                : "bg-rose-500"
                          }`}
                          style={{ width: `${Math.min(100, ad.executeRate)}%` }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {ad.payments.slice(0, 3).map((p) => (
                          <Badge key={p} variant="outline" className="text-[10px] font-normal">
                            {p}
                          </Badge>
                        ))}
                        {ad.payments.length > 3 && (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            +{ad.payments.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => copyDealInfo(ad, crypto, fiat)}
                        aria-label="Скопировать данные сделки"
                        title="Скопировать данные для сделки"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!pageRows.length && (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                    {loading
                      ? "Загружаем объявления…"
                      : hasError
                        ? "Данные недоступны — устраните ошибку подключения (баннер вверху страницы)."
                        : filtersActive
                          ? "Под фильтры ничего не подошло — увеличьте сумму или сбросьте фильтры."
                          : "Подходящих объявлений не найдено — измените фильтры или пару."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
            <span className="num text-xs text-muted-foreground">
              стр. {safePage} из {totalPages}
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Предыдущая страница"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Следующая страница"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

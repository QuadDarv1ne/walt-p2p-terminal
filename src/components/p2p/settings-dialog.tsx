"use client";

import { useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { testProxy, DEFAULT_RELAY_URL } from "@/lib/p2p/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchAds } from "@/lib/p2p/api";
import { useP2PStore } from "@/lib/p2p/store";
import { ConnMode, HistoryPoint, Side } from "@/lib/p2p/types";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

interface ProxyTestResult {
  ok: boolean;
  message: string;
}

const EXPORT_APP = "walt-p2p-terminal";

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const settings = useP2PStore((s) => s.settings);
  const patchSettings = useP2PStore((s) => s.patchSettings);
  const resetAll = useP2PStore((s) => s.resetAll);
  const [resetOpen, setResetOpen] = useState(false);

  // диалог перемонтируется при каждом открытии (key в page.tsx),
  // поэтому локальное состояние всегда актуально на момент открытия
  const [mode, setMode] = useState<ConnMode>(settings.mode);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  // для релея — предзаполнить адрес по умолчанию
  const relayDefault = mode === "relay" && settings.proxyList.length === 0
    ? [DEFAULT_RELAY_URL]
    : [];
  const [proxyText, setProxyText] = useState(
    settings.proxyList.length > 0
      ? settings.proxyList.join("\n")
      : relayDefault.join("\n"),
  );
  const [refreshSec, setRefreshSec] = useState(settings.refreshSec);
  const [pageSize, setPageSize] = useState(settings.pageSize);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [proxyResults, setProxyResults] = useState<Record<number, ProxyTestResult>>({});
  const [testingProxies, setTestingProxies] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const proxyUrls = proxyText
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

  const runTest = async () => {
    setTest({ kind: "running" });
    try {
      const res = await fetchAds(
        { cryptoCurrency: "USDT", fiatCurrency: "RUB", side: "SELL", page: 1, pageSize: 5 },
        { mode, apiKey: apiKey.trim(), proxyUrls },
      );
      setTest({
        kind: "ok",
        message:
          mode === "demo"
            ? "Демо-режим отвечает корректно."
            : `Соединение установлено, получено объявлений: ${res.ads.length}${
                res.via ? ` (через прокси)` : ""
              }.`,
      });
    } catch (e) {
      setTest({ kind: "error", message: e instanceof Error ? e.message : "Неизвестная ошибка" });
    }
  };

  const checkProxies = async () => {
    if (!proxyUrls.length) {
      toast.info("Список прокси пуст");
      return;
    }
    setTestingProxies(true);
    setProxyResults({});
    const results: Record<number, ProxyTestResult> = {};
    // последовательно, чтобы не устроить DDoS самому себе
    for (let i = 0; i < proxyUrls.length; i++) {
      const r = await testProxy(proxyUrls[i], apiKey.trim());
      results[i] = { ok: r.ok, message: r.message };
      setProxyResults({ ...results });
    }
    setTestingProxies(false);
    const good = Object.values(results).filter((r) => r.ok).length;
    if (good) toast.success(`Рабочих прокси: ${good} из ${proxyUrls.length}`);
    else toast.error("Ни один прокси не ответил");
  };

  const save = () => {
    patchSettings({ mode, apiKey: apiKey.trim(), proxyList: proxyUrls, refreshSec, pageSize });
    toast.success("Настройки сохранены");
    onOpenChange(false);
  };

  const exportState = () => {
    const st = useP2PStore.getState();
    const payload = {
      app: EXPORT_APP,
      version: 1,
      exportedAt: new Date().toISOString(),
      crypto: st.crypto,
      fiat: st.fiat,
      side: st.side,
      watchlist: st.watchlist,
      alerts: st.alerts,
      history: st.history,
      settings: {
        mode: st.settings.mode,
        proxyList: st.settings.proxyList,
        peerName: st.settings.peerName,
        tabSync: st.settings.tabSync,
        refreshSec: st.settings.refreshSec,
        pageSize: st.settings.pageSize,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `p2p-terminal-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Состояние экспортировано", { description: "API-ключ в файл не включён" });
  };

  const importState = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        app?: string;
        crypto?: string;
        fiat?: string;
        side?: Side;
        watchlist?: unknown;
        alerts?: unknown;
        history?: Record<string, unknown>;
        settings?: Record<string, unknown>;
      };
      if (data.app !== EXPORT_APP) {
        toast.error("Это не файл экспорта P2P Терминала");
        return;
      }
      const st = useP2PStore.getState();
      if (data.crypto && data.fiat) st.setPair(String(data.crypto), String(data.fiat));
      if (data.side === "SELL" || data.side === "BUY") st.setSide(data.side);
      if (Array.isArray(data.watchlist)) {
        st.mergeWatchlist(data.watchlist as never);
      }
      if (Array.isArray(data.alerts)) {
        st.mergeAlerts(data.alerts as never);
      }
      if (data.history && typeof data.history === "object") {
        useP2PStore.setState((s) => ({
          history: { ...s.history, ...(data.history as Record<string, HistoryPoint[]>) },
        }));
      }
      if (data.settings && typeof data.settings === "object") {
        const s = data.settings;
        patchSettings({
          ...(typeof s.mode === "string" && ["demo", "direct", "proxy", "relay"].includes(s.mode)
            ? { mode: s.mode as ConnMode }
            : {}),
          ...(Array.isArray(s.proxyList) ? { proxyList: s.proxyList.map(String) } : {}),
          ...(typeof s.peerName === "string" ? { peerName: s.peerName } : {}),
          ...(typeof s.tabSync === "boolean" ? { tabSync: s.tabSync } : {}),
          ...(typeof s.refreshSec === "number" ? { refreshSec: s.refreshSec } : {}),
          ...(typeof s.pageSize === "number" ? { pageSize: s.pageSize } : {}),
        });
      }
      toast.success("Состояние импортировано", { description: "Списки объединены без дублей" });
      onOpenChange(false);
    } catch {
      toast.error("Не удалось прочитать файл");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto thin-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Настройки подключения</DialogTitle>
          <DialogDescription>
            Данные хранятся только в вашем браузере (localStorage) и никуда не отправляются.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="space-y-2">
            <Label>Режим данных</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as ConnMode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="demo">Демо-данные (без ключа)</SelectItem>
                <SelectItem value="direct">Реальный API — напрямую</SelectItem>
                <SelectItem value="proxy">Реальный API — через прокси</SelectItem>
              <SelectItem value="relay">Реальный API — через локальный релей</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Демо-режим показывает симуляцию рынка. Реальный режим обращается к
              p2p.walt.io прямо из вашего браузера.
            </p>
          </div>

          {mode !== "demo" && (
            <div className="space-y-2">
              <Label htmlFor="api-key" className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />
                API-ключ
              </Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showKey ? "text" : "password"}
                  placeholder="Вставьте ваш API-ключ"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pr-10"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showKey ? "Скрыть ключ" : "Показать ключ"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <details className="group rounded-md border border-border bg-muted/40 px-3 py-2">
                <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" />
                    Как получить API-ключ
                  </span>
                </summary>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                  <li>В главном меню Walt нажмите «Пополнить».</li>
                  <li>Откройте P2P Маркет → Мой профиль → API ключи → Создать API ключ.</li>
                  <li>Укажите имя ключа и нажмите «Создать».</li>
                  <li>Скопируйте ключ и вставьте его сюда. До 10 ключей на аккаунт.</li>
                </ol>
              </details>
            </div>
          )}

          {(mode === "proxy" || mode === "relay") && (
            <>
              <div className="space-y-2">
                <Label htmlFor="proxy-list" className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  {mode === "relay"
                    ? "Адрес локального релея (один в строке)"
                    : "CORS-прокси (один в строке)"}
                </Label>
                <Textarea
                  id="proxy-list"
                  placeholder={mode === "relay"
                    ? DEFAULT_RELAY_URL
                    : "https://мой-прокси.example/?url={url}\nhttps://резервный-прокси.example/?url={url}"}
                  value={proxyText}
                  onChange={(e) => setProxyText(e.target.value)}
                  className="num h-24 resize-y text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {mode === "relay"
                    ? "Локальный релей принимает запросы с браузера и ходит к API Walt напрямую (или через upstream-прокси). Запустите его командой: `bun scripts/relay-proxy.ts`"
                    : "Запросы идут по списку до первого рабочего: если прокси упал, терминал автоматически переключается на следующий. Шаблон "}<code className="rounded bg-muted px-1">{"{url}"}</code>{mode === "relay" ? "" : " заменяется на адрес API."}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={checkProxies} disabled={testingProxies}>
                    {testingProxies ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-1.5 h-4 w-4" />
                    )}
                    Проверить прокси
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {proxyUrls.length ? `${proxyUrls.length} в списке` : "список пуст"}
                  </span>
                </div>
                {Object.keys(proxyResults).length > 0 && (
                  <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2">
                    {proxyUrls.map((p, i) =>
                      proxyResults[i] ? (
                        <div key={i} className="num flex items-center gap-2 text-[11px]">
                          {proxyResults[i].ok ? (
                            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                          ) : (
                            <TriangleAlert className="h-3 w-3 shrink-0 text-rose-500" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{p}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {proxyResults[i].message}
                          </Badge>
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
              {/* пояснение про MTProto-прокси */}
              <details className="group rounded-md border border-border/50 bg-amber-50/50 px-3 py-2 dark:bg-amber-950/20">
                <summary className="cursor-pointer list-none text-xs font-medium text-amber-700 hover:text-amber-900 dark:text-amber-400">
                  <span className="inline-flex items-center gap-1.5">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    Ссылки t.me/proxy не подходят
                  </span>
                </summary>
                <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  <p>
                    Ссылки вида <code>t.me/proxy?server=...&amp;secret=...</code> — это
                    <strong> MTProto-прокси для мессенджера Telegram</strong>. Они переносят
                    только зашифрованный трафик Telegram API и <strong>не могут
                    использоваться для HTTP-запросов</strong> к p2p.walt.io.
                  </p>
                  <p>
                    Для обхода блокировок используйте:
                  </p>
                  <ul className="list-disc space-y-1 pl-4">
                    <li>
                      <strong>Локальный релей</strong> — «через локальный релей» в режиме данных +
                      <code> bun scripts/relay-proxy.ts</code>. Релей ходит в интернет через
                      системный прокси/VPN.
                    </li>
                    <li>
                      <strong>MTProto-прокси для сайта</strong> — поднимите локальный HTTP/SOCKS-выход
                      через <code>mihomo</code> (Clash Meta) или <code>Xray</code>, укажите его
                      <code>PROXY=socks5://127.0.0.1:1080</code> при запуске релея.
                    </li>
                    <li>
                      <strong>Публичные CORS-прокси</strong> — добавьте URL в режиме «через прокси».
                    </li>
                  </ul>
                </div>
              </details>
            </>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Интервал автообновления</Label>
              <Badge variant="secondary" className="num">
                {refreshSec} сек
              </Badge>
            </div>
            <Slider
              value={[refreshSec]}
              onValueChange={([v]) => setRefreshSec(v)}
              min={10}
              max={120}
              step={5}
              aria-label="Интервал автообновления в секундах"
            />
            <p className="text-xs text-muted-foreground">
              Цены на P2P Маркете обновляются примерно каждые 30 секунд.
            </p>
          </div>

          {mode !== "demo" && (
            <div className="space-y-2">
              <Label>Объявлений за один запрос</Label>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <Separator />

          {/* -------------------- децентрализация -------------------- */}
          <div className="space-y-3">
            <Label className="text-sm">Децентрализация</Label>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Синхронизация вкладок</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Вкладки договариваются напрямую (BroadcastChannel): пара, избранное и алерты
                  зеркалятся, а обновления к API делает только вкладка-лидер.
                </p>
              </div>
              <Switch
                checked={settings.tabSync}
                onCheckedChange={(v) => patchSettings({ tabSync: v })}
                aria-label="Синхронизация вкладок"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={exportState}>
                <Download className="mr-1.5 h-4 w-4" />
                Экспорт состояния
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-1.5 h-4 w-4" />
                Импорт из файла
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importState(f);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Экспорт переносит избранное, алерты, историю и настройки в JSON-файл — портативность
              без всякого сервера. API-ключ не выгружается.
            </p>
          </div>

          <Separator />

          {/* -------------------- сброс данных -------------------- */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-sm text-rose-600 dark:text-rose-400">
              <TriangleAlert className="h-4 w-4" />
              Опасная зона
            </Label>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-500/30 p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Сброс данных терминала</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Удаляет историю, избранное, алерты и настройки соединения. API-ключ останется.
                </p>
              </div>
              <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="shrink-0 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Сбросить
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Сбросить все данные терминала?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Будут удалены история курсов, избранное, алерты и настройки соединения
                      (режим вернётся к демо-данным). API-ключ останется сохранённым. Действие
                      необратимо.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-rose-600 text-white hover:bg-rose-700"
                      onClick={() => {
                        resetAll();
                        toast.success("Данные терминала сброшены", {
                          description: "Режим данных возвращён к демо, списки очищены.",
                        });
                      }}
                    >
                      Да, сбросить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {test.kind === "ok" && (
            <Alert className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Проверка пройдена</AlertTitle>
              <AlertDescription>{test.message}</AlertDescription>
            </Alert>
          )}
          {test.kind === "error" && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Не удалось подключиться</AlertTitle>
              <AlertDescription>{test.message}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={runTest} disabled={test.kind === "running"}>
            {test.kind === "running" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 h-4 w-4" />
            )}
            Проверить соединение
          </Button>
          <Button onClick={save}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

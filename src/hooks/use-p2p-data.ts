"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { bestPrice, fetchAds } from "@/lib/p2p/api";
import { tabSync } from "@/lib/p2p/broadcast";
import { peerNetwork } from "@/lib/p2p/webrtc";
import { useP2PStore } from "@/lib/p2p/store";
import { formatPrice } from "@/lib/p2p/format";
import {
  AdQuery,
  CRYPTOS,
  DataSource,
  FetchResult,
  P2PAd,
  P2PApiError,
  PairQuote,
  PeerQuote,
  Side,
  SyncStatePayload,
  pairKey,
} from "@/lib/p2p/types";

export interface ExtraQuote {
  best: number | null;
  onlineCount: number;
  totalCount: number;
  fetchedAt: number;
}

export interface MatrixEntry extends PairQuote {
  crypto: string;
}

interface CycleQuoteMeta {
  crypto: string;
  fiat: string;
  side: Side;
}

/** Ключ кеша синхронизации вкладок для объявлений */
const adsCacheKey = (crypto: string, fiat: string, side: Side) => `ads|${side}|${crypto}|${fiat}`;

function notify(title: string, body: string) {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: "p2p-alert" });
    } catch {
      /* ignore */
    }
  }
}

/** Реактивный флаг ре-гидратации persisted-стора (защита от гонки первого запроса) */
function useStoreHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const unsub = useP2PStore.persist.onFinishHydration(onChange);
      if (useP2PStore.persist.hasHydrated()) onChange();
      return unsub;
    },
    () => useP2PStore.persist.hasHydrated(),
    () => false,
  );
}

export function useP2pData() {
  const crypto = useP2PStore((s) => s.crypto);
  const fiat = useP2PStore((s) => s.fiat);
  const side = useP2PStore((s) => s.side);
  const settings = useP2PStore((s) => s.settings);
  const alerts = useP2PStore((s) => s.alerts);
  const watchlist = useP2PStore((s) => s.watchlist);
  const pushHistory = useP2PStore((s) => s.pushHistory);
  const touchAlert = useP2PStore((s) => s.touchAlert);
  const clearHistory = useP2PStore((s) => s.clearHistory);

  const [sellRes, setSellRes] = useState<FetchResult | null>(null);
  const [buyRes, setBuyRes] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<P2PApiError | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(settings.refreshSec);
  const [matrix, setMatrix] = useState<Record<string, MatrixEntry>>({});
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [extraQuotes, setExtraQuotes] = useState<Record<string, ExtraQuote>>({});

  const nextAtRef = useRef(Date.now());
  const refreshRef = useRef<() => void>(() => {});
  const cycleRef = useRef<() => void>(() => {});
  const matrixRef = useRef<(fiat: string) => void>(() => {});
  const errorToastKeyRef = useRef<string>("");
  const applyingRemoteRef = useRef(false);
  const lastSyncJsonRef = useRef<string>("");
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCycleRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  const hydrated = useStoreHydrated();
  const hydratedRef = useRef(hydrated);
  hydratedRef.current = hydrated;

  const opts = useMemo(
    () => ({
      mode: settings.mode,
      apiKey: settings.apiKey,
      proxyUrls: settings.proxyList,
    }),
    [settings.mode, settings.apiKey, settings.proxyList],
  );

  /** Последние результаты — провайдер снапшота для P2P-сети читает их без ре-рендера */
  const latestRef = useRef({
    sellRes: null as FetchResult | null,
    buyRes: null as FetchResult | null,
    extraQuotes: {} as Record<string, ExtraQuote>,
  });
  latestRef.current = { sellRes, buyRes, extraQuotes };

  const queryFor = useCallback(
    (cryptoCur: string, fiatCur: string, s: Side, pageSize: number): AdQuery => ({
      cryptoCurrency: cryptoCur,
      fiatCurrency: fiatCur,
      side: s,
      page: 1,
      pageSize,
    }),
    [],
  );

  /* --------------------- синхронизация вкладок ---------------------- */

  // запуск канала и P2P-провайдера — один раз
  useEffect(() => {
    tabSync.start();
    peerNetwork.setProvider(() => {
      const st = useP2PStore.getState();
      const latest = latestRef.current;
      const quotes: PeerQuote[] = [];
      const addQ = (c: string, f: string, sd: Side, res: FetchResult | null) => {
        if (!res) return;
        quotes.push({
          crypto: c,
          fiat: f,
          side: sd,
          best: bestPrice(res.ads, sd),
          onlineCount: res.ads.filter((a) => a.isOnline).length,
          // та же популяция, что и счётчик онлайн — иначе «41 из 120» смешивает
          // 50 полученных объявлений с оценкой полного рынка
          totalCount: res.ads.length,
          fetchedAt: res.fetchedAt,
        });
      };
      addQ(st.crypto, st.fiat, "SELL", latest.sellRes);
      addQ(st.crypto, st.fiat, "BUY", latest.buyRes);
      for (const [key, q] of Object.entries(latest.extraQuotes)) {
        const parts = key.split("-");
        if (parts.length !== 3) continue;
        const [c, f, sd] = parts as [string, string, Side];
        if (st.crypto === c && st.fiat === f) continue; // уже добавили выше
        quotes.push({
          crypto: c,
          fiat: f,
          side: sd,
          best: q.best,
          onlineCount: q.onlineCount,
          totalCount: q.totalCount,
          fetchedAt: q.fetchedAt,
        });
      }
      return {
        name: st.settings.peerName,
        quotes,
        watchlist: st.watchlist,
        alerts: st.alerts,
      };
    });
    return () => {
      peerNetwork.setProvider(null);
      tabSync.stop();
    };
  }, []);

  // рассылка локального состояния соседним вкладкам (с защитой от эха)
  useEffect(() => {
    if (!hydrated || !settings.tabSync) return;

    const buildPayload = (): SyncStatePayload => {
      const st = useP2PStore.getState();
      return {
        crypto: st.crypto,
        fiat: st.fiat,
        side: st.side,
        watchlist: st.watchlist,
        alerts: st.alerts,
        history: st.history,
        settings: {
          mode: st.settings.mode,
          proxyList: st.settings.proxyList,
          refreshSec: st.settings.refreshSec,
          pageSize: st.settings.pageSize,
          peerName: st.settings.peerName,
          tabSync: st.settings.tabSync,
        },
      };
    };

    const unsub = useP2PStore.subscribe(() => {
      if (applyingRemoteRef.current) return;
      const json = JSON.stringify(buildPayload());
      if (json === lastSyncJsonRef.current) return;
      lastSyncJsonRef.current = json;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        syncTimerRef.current = null;
        tabSync.publishState(buildPayload());
      }, 350);
    });

    // новичок в канале — сразу делимся состоянием
    const offHello = tabSync.onHello(() => {
      const payload = buildPayload();
      lastSyncJsonRef.current = JSON.stringify(payload);
      tabSync.publishState(payload);
    });

    // приём состояния из других вкладок
    const offState = tabSync.onState((remote) => {
      applyingRemoteRef.current = true;
      try {
        useP2PStore.getState().applySyncState(remote);
      } finally {
        setTimeout(() => {
          applyingRemoteRef.current = false;
        }, 0);
      }
    });

    return () => {
      unsub();
      offHello();
      offState();
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [hydrated, settings.tabSync]);

  /* ------------------------- основной цикл ------------------------- */

  const refresh = useCallback(async () => {
    nextAtRef.current = Date.now() + settings.refreshSec * 1000;
    setSecondsLeft(settings.refreshSec);
    setLoading(true);
    try {
      let sell: FetchResult | null = null;
      let buy: FetchResult | null = null;

      // последователь берёт готовые данные лидера — без запроса к API
      if (settings.tabSync && tabSync.isFollower()) {
        const maxAge = settings.refreshSec * 1000 + 10_000;
        sell = tabSync.getFresh<FetchResult>(adsCacheKey(crypto, fiat, "SELL"), maxAge);
        buy = tabSync.getFresh<FetchResult>(adsCacheKey(crypto, fiat, "BUY"), maxAge);
      }

      if (!(sell && buy)) {
        [sell, buy] = await Promise.all([
          fetchAds(queryFor(crypto, fiat, "SELL", settings.pageSize), opts),
          fetchAds(queryFor(crypto, fiat, "BUY", settings.pageSize), opts),
        ]);
        // делимся результатом с соседними вкладками
        tabSync.publish(adsCacheKey(crypto, fiat, "SELL"), sell);
        tabSync.publish(adsCacheKey(crypto, fiat, "BUY"), buy);
      }

      setSellRes(sell);
      setBuyRes(buy);
      setError(null);
      errorToastKeyRef.current = "";

      const bb = bestPrice(sell.ads, "SELL");
      const bs = bestPrice(buy.ads, "BUY");
      if (bb) pushHistory(crypto, fiat, "SELL", bb);
      if (bs) pushHistory(crypto, fiat, "BUY", bs);
      peerNetwork.broadcastSnapshot();
    } catch (e) {
      const err = e instanceof P2PApiError ? e : new P2PApiError("network", String(e));
      setError(err);
      // ошибка в реальном режиме не должна оставлять на экране демо-цены:
      // пользователь примет симуляцию за настоящий рынок
      setSellRes((prev) => (prev?.source === "demo" && opts.mode !== "demo" ? null : prev));
      setBuyRes((prev) => (prev?.source === "demo" && opts.mode !== "demo" ? null : prev));
      const toastKey = `${err.kind}:${err.message}`;
      if (errorToastKeyRef.current !== toastKey) {
        errorToastKeyRef.current = toastKey;
        toast.error("Ошибка получения данных", {
          description: err.hint ? `${err.message}. ${err.hint}` : err.message,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [crypto, fiat, opts, pushHistory, queryFor, settings.pageSize, settings.refreshSec, settings.tabSync]);

  refreshRef.current = () => void refresh();

  /* ------------------- цикл избранного и алертов ------------------- */

  const evaluateAlerts = useCallback(
    (quotes: Record<string, number>) => {
      if (!alerts.length) return;
      const now = Date.now();
      const cooldownMs = Math.max(300, settings.refreshSec * 2) * 1000;
      for (const a of alerts) {
        if (!a.active) continue;
        if (a.lastTriggeredAt && now - a.lastTriggeredAt < cooldownMs) continue;
        const best = quotes[pairKey(a.crypto, a.fiat, a.side)];
        if (!best) continue;
        const hit = a.op === "above" ? best >= a.target : best <= a.target;
        if (!hit) continue;
        touchAlert(a.id, now);
        const label = `${a.crypto}/${a.fiat}`;
        const desc =
          a.op === "above"
            ? `курс ${a.side === "SELL" ? "покупки" : "продажи"} поднялся до ${formatPrice(best)} (цель: выше ${formatPrice(a.target)})`
            : `курс ${a.side === "SELL" ? "покупки" : "продажи"} опустился до ${formatPrice(best)} (цель: ниже ${formatPrice(a.target)})`;
        toast(`🔔 Алерт: ${label}`, { description: desc, duration: 12000 });
        notify(`Алерт ${label}`, desc);
      }
    },
    [alerts, settings.refreshSec, touchAlert],
  );

  const cycle = useCallback(async () => {
    // последователь: берём курсы избранного от лидера
    if (settings.tabSync && tabSync.isFollower()) {
      const maxAge = settings.refreshSec * 1000 + 10_000;
      const cachedExtra = tabSync.getFresh<Record<string, ExtraQuote>>("extra", maxAge);
      if (cachedExtra) {
        setExtraQuotes((prev) => ({ ...prev, ...cachedExtra }));
        const collected: Record<string, number> = {};
        for (const [key, q] of Object.entries(cachedExtra)) {
          if (q.best) collected[key] = q.best;
        }
        evaluateAlerts(collected);
        return;
      }
    }

    const needed: CycleQuoteMeta[] = [];
    for (const w of watchlist) needed.push({ crypto: w.crypto, fiat: w.fiat, side: w.side });
    for (const a of alerts) {
      if (a.active) needed.push({ crypto: a.crypto, fiat: a.fiat, side: a.side });
    }
    const unique = new Map<string, CycleQuoteMeta>();
    for (const n of needed) unique.set(pairKey(n.crypto, n.fiat, n.side), n);

    // защита от повторного опроса того же набора пар подряд (двойной вызов
    // на монтировании и т.п.): тик по расписанию проходит всегда,
    // потому что между тиками проходит больше окна
    const cycleKey = [...unique.keys()].sort().join("|");
    const now = Date.now();
    if (
      cycleKey === lastCycleRef.current.key &&
      now - lastCycleRef.current.at < Math.max(8000, settings.refreshSec * 1000 - 3000)
    ) {
      return;
    }
    lastCycleRef.current = { key: cycleKey, at: now };

    if (!unique.size) return;
    const results = await Promise.all(
      [...unique.values()].map(async (n) => {
        try {
          const res = await fetchAds(queryFor(n.crypto, n.fiat, n.side, 20), opts);
          return { key: pairKey(n.crypto, n.fiat, n.side), res, meta: n };
        } catch {
          return null;
        }
      }),
    );

    const collected: Record<string, number> = {};
    const published: Record<string, ExtraQuote> = {};
    setExtraQuotes((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (!r) continue;
        const best = bestPrice(r.res.ads, r.meta.side);
        published[r.key] = {
          best,
          onlineCount: r.res.ads.filter((a) => a.isOnline).length,
          totalCount: r.res.ads.length,
          fetchedAt: r.res.fetchedAt,
        };
        next[r.key] = published[r.key];
        if (best) collected[r.key] = best;
      }
      return next;
    });
    if (Object.keys(published).length) {
      tabSync.publish("extra", published);
      peerNetwork.broadcastSnapshot();
    }
    evaluateAlerts(collected);
  }, [alerts, evaluateAlerts, opts, queryFor, settings.tabSync, watchlist]);

  cycleRef.current = () => void cycle();

  /* ------------------------- матрица рынков ------------------------ */

  const refreshMatrix = useCallback(
    async (fiatCur: string) => {
      // последователь: матрица от лидера
      if (settings.tabSync && tabSync.isFollower()) {
        const maxAge = settings.refreshSec * 1000 + 10_000;
        const cached = tabSync.getFresh<Record<string, MatrixEntry>>(`matrix|${fiatCur}`, maxAge);
        if (cached) {
          setMatrix((prev) => ({ ...prev, ...cached }));
          return;
        }
      }

      setMatrixLoading(true);
      try {
        const entries = await Promise.all(
          CRYPTOS.map(async (c) => {
            try {
              const [sell, buy] = await Promise.all([
                fetchAds(queryFor(c, fiatCur, "SELL", 15), opts),
                fetchAds(queryFor(c, fiatCur, "BUY", 15), opts),
              ]);
              const entry: MatrixEntry = {
                crypto: c,
                bestBuy: bestPrice(sell.ads, "SELL"),
                bestSell: bestPrice(buy.ads, "BUY"),
                onlineCount: sell.ads.filter((a) => a.isOnline).length,
                totalCount: sell.ads.length,
              };
              return entry;
            } catch {
              return null;
            }
          }),
        );
        const map: Record<string, MatrixEntry> = {};
        for (const e of entries) if (e) map[`${e.crypto}|${fiatCur}`] = e;
        setMatrix((prev) => ({ ...prev, ...map }));
        if (Object.keys(map).length) tabSync.publish(`matrix|${fiatCur}`, map);
      } finally {
        setMatrixLoading(false);
      }
    },
    [opts, queryFor, settings.tabSync],
  );

  matrixRef.current = (f: string) => void refreshMatrix(f);

  /* --------------------------- эффекты ----------------------------- */

  // первичная загрузка + реакция на смену пары/режима/ключа (только после гидратации стора)
  useEffect(() => {
    if (!hydrated) return;
    void refresh();
    nextAtRef.current = Date.now() + settings.refreshSec * 1000;
    setSecondsLeft(settings.refreshSec);
    void cycle();
  }, [hydrated, crypto, fiat, settings.mode, settings.apiKey, settings.proxyList, settings.pageSize, settings.tabSync]);

  // смена типа источника (демо ↔ реальный API): результаты прошлого режима
  // вводят в заблуждение — демо-цены нельзя смешивать с реальными на карточках,
  // в графике и дельтах. Историю и матрицу сбрасываем целиком, они без метки источника.
  const modeRef = useRef(settings.mode);
  useEffect(() => {
    if (!hydrated) return;
    if (modeRef.current === settings.mode) return;
    modeRef.current = settings.mode;
    setSellRes((prev) => (settings.mode === "demo" ? null : prev?.source === "demo" ? null : prev));
    setBuyRes((prev) => (settings.mode === "demo" ? null : prev?.source === "demo" ? null : prev));
    setExtraQuotes({});
    setMatrix({});
    clearHistory();
  }, [hydrated, settings.mode, clearHistory]);

  // смена интервала обновления — пересчитываем обратный отсчёт сразу,
  // а не после следующего такта (иначе после уменьшения интервала
  // интерфейс долго показывает старое время)
  const refreshSecRef = useRef(settings.refreshSec);
  useEffect(() => {
    if (!hydrated) return;
    if (refreshSecRef.current === settings.refreshSec) return;
    refreshSecRef.current = settings.refreshSec;
    nextAtRef.current = Date.now() + settings.refreshSec * 1000;
    setSecondsLeft(settings.refreshSec);
  }, [hydrated, settings.refreshSec]);

  // такт 1 сек: обратный отсчёт и автообновление
  useEffect(() => {
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((nextAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0 && hydratedRef.current && document.visibilityState !== "hidden") {
        refreshRef.current();
        cycleRef.current();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // возврат на вкладку → немедленное обновление
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= nextAtRef.current) {
        refreshRef.current();
        cycleRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // новое избранное или активный алерт → опрос сразу, не ждём ближайшего такта
  // (иначе новая пара до 30 секунд показывает «загрузка…»)
  const watchKey = watchlist.map((w) => pairKey(w.crypto, w.fiat, w.side)).join("|");
  const alertsKey = alerts
    .filter((a) => a.active)
    .map((a) => pairKey(a.crypto, a.fiat, a.side))
    .sort()
    .join("|");
  useEffect(() => {
    if (!hydrated) return;
    cycleRef.current();
  }, [hydrated, watchKey, alertsKey]);

  // матрица: при смене фиата, режима или ключа (иначе после переключения
  // с демо на реальный API карточки рынков показывают старые цены)
  useEffect(() => {
    if (!hydratedRef.current) return;
    matrixRef.current(fiat);
  }, [hydrated, fiat, settings.mode, settings.apiKey, settings.proxyList]);

  const currentQuote: PairQuote = useMemo(() => {
    const bb = sellRes ? bestPrice(sellRes.ads, "SELL") : null;
    const bs = buyRes ? bestPrice(buyRes.ads, "BUY") : null;
    return {
      bestBuy: bb,
      bestSell: bs,
      onlineCount: (sellRes?.ads ?? []).filter((a) => a.isOnline).length,
      // единообразно с таблицей и матрицей: счёт по полученным объявлениям
      totalCount: sellRes?.ads.length ?? 0,
    };
  }, [sellRes, buyRes]);

  const spreadPct = useMemo(() => {
    if (!currentQuote.bestBuy || !currentQuote.bestSell) return null;
    // классический спред: (лучшая цена покупки ask − лучшая цена продажи bid) / ask
    return ((currentQuote.bestBuy - currentQuote.bestSell) / currentQuote.bestBuy) * 100;
  }, [currentQuote]);

  return {
    crypto,
    fiat,
    side,
    settings,
    sellRes,
    buyRes,
    loading,
    error,
    secondsLeft,
    currentQuote,
    spreadPct,
    matrix,
    matrixLoading,
    extraQuotes,
    refresh: () => {
      refreshRef.current();
      cycleRef.current();
    },
    refreshMatrix: () => matrixRef.current(fiat),
    dataSource: (sellRes?.source ?? "demo") as DataSource,
  };
}

export type { P2PAd };

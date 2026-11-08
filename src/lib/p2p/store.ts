import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  AlertRule,
  AlertOp,
  ConnMode,
  HistoryPoint,
  Side,
  SyncStatePayload,
  WatchItem,
  pairKey,
} from "./types";

const HISTORY_LIMIT = 240;
const MAX_WATCH = 8;
const MAX_ALERTS = 12;

interface P2PSettings {
  mode: ConnMode;
  apiKey: string;
  /** @deprecated используйте proxyList (мигрируется автоматически) */
  proxyUrl?: string;
  proxyList: string[];
  /** никнейм в P2P-сети (WebRTC между пользователями) */
  peerName: string;
  /** синхронизация вкладок одного браузера + экономия запросов через лидера */
  tabSync: boolean;
  refreshSec: number;
  pageSize: number;
  demoBannerDismissed: boolean;
}

interface P2PState {
  settings: P2PSettings;
  crypto: string;
  fiat: string;
  side: Side;
  watchlist: WatchItem[];
  alerts: AlertRule[];
  history: Record<string, HistoryPoint[]>;
  patchSettings: (patch: Partial<P2PSettings>) => void;
  setPair: (crypto: string, fiat: string) => void;
  setSide: (side: Side) => void;
  toggleWatch: (crypto: string, fiat: string, side: Side) => void;
  removeWatch: (id: string) => void;
  addAlert: (rule: Omit<AlertRule, "id" | "active">) => void;
  toggleAlert: (id: string) => void;
  touchAlert: (id: string, at: number) => void;
  removeAlert: (id: string) => void;
  pushHistory: (crypto: string, fiat: string, side: Side, best: number) => void;
  /** полная очистка истории (например, при смене источника данных демо ↔ реальный) */
  clearHistory: () => void;
  /** применить состояние, пришедшее из другой вкладки (BroadcastChannel) */
  applySyncState: (state: SyncStatePayload) => void;
  /** добавить избранное, полученное от пира по WebRTC (без дублей) */
  mergeWatchlist: (items: WatchItem[]) => void;
  /** объединить алерты, полученные от пира (без дублей) */
  mergeAlerts: (items: AlertRule[]) => void;
  /** сбросить историю, списки и настройки (кроме apiKey) */
  resetAll: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export const useP2PStore = create<P2PState>()(
  persist(
    (set, get) => ({
      settings: {
        mode: "demo",
        apiKey: "",
        proxyList: [],
        peerName: `Трейдер-${Math.floor(1000 + Math.random() * 9000)}`,
        tabSync: true,
        refreshSec: 30,
        pageSize: 50,
        demoBannerDismissed: false,
      },
      crypto: "USDT",
      fiat: "RUB",
      side: "SELL",
      watchlist: [],
      alerts: [],
      history: {},

      patchSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      setPair: (crypto, fiat) => set({ crypto, fiat }),
      setSide: (side) => set({ side }),

      toggleWatch: (crypto, fiat, side) => {
        const exists = get().watchlist.find(
          (w) => w.crypto === crypto && w.fiat === fiat && w.side === side,
        );
        if (exists) {
          set((s) => ({ watchlist: s.watchlist.filter((w) => w.id !== exists.id) }));
          return;
        }
        set((s) => {
          const item: WatchItem = { id: uid(), crypto, fiat, side };
          const list = [item, ...s.watchlist].slice(0, MAX_WATCH);
          return { watchlist: list };
        });
      },

      removeWatch: (id) =>
        set((s) => ({ watchlist: s.watchlist.filter((w) => w.id !== id) })),

      addAlert: (rule) =>
        set((s) => {
          if (s.alerts.length >= MAX_ALERTS) return s;
          const alert: AlertRule = { ...rule, id: uid(), active: true };
          return { alerts: [alert, ...s.alerts] };
        }),

      toggleAlert: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) => (a.id === id ? { ...a, active: !a.active } : a)),
        })),

      touchAlert: (id, at) =>
        set((s) => ({
          alerts: s.alerts.map((a) => (a.id === id ? { ...a, lastTriggeredAt: at } : a)),
        })),

      removeAlert: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),

      pushHistory: (crypto, fiat, side, best) => {
        if (!Number.isFinite(best) || best <= 0) return;
        const key = pairKey(crypto, fiat, side);
        set((s) => {
          const series = s.history[key] ?? [];
          const last = series[series.length - 1];
          if (last && Date.now() - last.t < 5000) return s; // защита от дублей
          const point: HistoryPoint = { t: Date.now(), best };
          const next = [...series, point].slice(-HISTORY_LIMIT);
          return { history: { ...s.history, [key]: next } };
        });
      },

      clearHistory: () => set({ history: {} }),

      applySyncState: (remote) =>
        set((s) => ({
          crypto: remote.crypto || s.crypto,
          fiat: remote.fiat || s.fiat,
          side: remote.side || s.side,
          watchlist: remote.watchlist ?? s.watchlist,
          alerts: remote.alerts ?? s.alerts,
          history: remote.history ?? s.history,
          settings: {
            ...s.settings,
            ...(remote.settings ?? {}),
            // ключ и баннер остаются локальными
            apiKey: s.settings.apiKey,
            demoBannerDismissed: s.settings.demoBannerDismissed,
          },
        })),

      mergeWatchlist: (items) =>
        set((s) => {
          const seen = new Set(
            s.watchlist.map((w) => pairKey(w.crypto, w.fiat, w.side)),
          );
          const add = items.filter(
            (w) =>
              w && w.crypto && w.fiat && (w.side === "SELL" || w.side === "BUY") &&
              !seen.has(pairKey(w.crypto, w.fiat, w.side)),
          );
          if (!add.length) return s;
          return { watchlist: [...add, ...s.watchlist].slice(0, MAX_WATCH) };
        }),

      mergeAlerts: (items) =>
        set((s) => {
          const seen = new Set(
            s.alerts.map((a) => pairKey(a.crypto, a.fiat, a.side) + a.op + a.target),
          );
          const add = items
            .filter(
              (a) =>
                a && a.crypto && a.fiat && (a.side === "SELL" || a.side === "BUY") &&
                Number.isFinite(a.target) && a.target > 0 &&
                !seen.has(pairKey(a.crypto, a.fiat, a.side) + a.op + a.target),
            )
            .map((a) => ({
              ...a,
              id: Math.random().toString(36).slice(2, 10),
              active: false,
              lastTriggeredAt: undefined,
            }));
          if (!add.length) return s;
          return { alerts: [...add, ...s.alerts].slice(0, MAX_ALERTS) };
        }),

      resetAll: () =>
        set((s) => ({
          crypto: "USDT",
          fiat: "RUB",
          side: "SELL",
          watchlist: [],
          alerts: [],
          history: {},
          settings: {
            ...s.settings,
            mode: "demo",
            proxyList: [],
            demoBannerDismissed: false,
          },
        })),
    }),
    {
      name: "walt-p2p-terminal",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        settings: s.settings,
        crypto: s.crypto,
        fiat: s.fiat,
        side: s.side,
        watchlist: s.watchlist,
        alerts: s.alerts,
        history: s.history,
      }),
      migrate: (persisted) => {
        const st = persisted as Partial<P2PState> & {
          settings?: Partial<P2PSettings>;
        };
        if (st?.settings) {
          // миграция v0 → v1: одиночный прокси превращается в список
          if (st.settings.proxyUrl && !st.settings.proxyList?.length) {
            st.settings.proxyList = [st.settings.proxyUrl];
          }
          delete st.settings.proxyUrl;
          st.settings.proxyList ??= [];
          if (!st.settings.peerName) {
            st.settings.peerName = `Трейдер-${Math.floor(1000 + Math.random() * 9000)}`;
          }
          st.settings.tabSync ??= true;
        }
        return st as P2PState;
      },
    },
  ),
);

export type { AlertOp };

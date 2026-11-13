/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { appendHistoryPoint, pruneHistory } from "./history";
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

/**
 * Лимиты списков. Экспортированы, потому что интерфейс обязан показывать их
 * пользователю: без этого добавление «13-го алерта» выглядело успешным,
 * хотя стор молча его отбрасывал.
 */
export const MAX_WATCH = 8;
export const MAX_ALERTS = 12;

/**
 * Допустимые границы интервала автообновления и размера страницы.
 *
 * Раньше значения из localStorage и из импортированного JSON принимались как
 * есть. Повреждённое состояние или чужой файл с `refreshSec: 0` превращали
 * обратный отсчёт в «всегда пора обновляться»: вкладка начинала опрашивать API
 * каждую секунду, получала HTTP 429 и тратила лимит ключа. Теперь любое
 * значение вне диапазона приводится к ближайшей границе.
 */
export const MIN_REFRESH_SEC = 10;
export const MAX_REFRESH_SEC = 120;
export const PAGE_SIZES = [20, 50, 100] as const;

export function clampRefreshSec(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_REFRESH_SEC, Math.max(MIN_REFRESH_SEC, Math.round(n)));
}

export function clampPageSize(value: unknown): number {
  const n = Number(value);
  // только из списка допустимых: произвольное число API всё равно не примет
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : 50;
}

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
  /**
   * Добавляет правило. Возвращает false, если алерт не создан — достигнут
   * лимит или такое правило уже есть. Интерфейс обязан показать причину,
   * а не рапортовать об успехе.
   */
  addAlert: (rule: Omit<AlertRule, "id" | "active">) => boolean;
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
        set((s) => {
          const next = { ...s.settings, ...patch };
          // границы применяются на входе: и слайдер, и импорт, и синхронизация
          // вкладок проходят через этот же метод
          if (patch.refreshSec !== undefined) next.refreshSec = clampRefreshSec(patch.refreshSec);
          if (patch.pageSize !== undefined) next.pageSize = clampPageSize(patch.pageSize);
          return { settings: next };
        }),

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

      addAlert: (rule) => {
        const current = get().alerts;
        if (current.length >= MAX_ALERTS) return false;
        const key = pairKey(rule.crypto, rule.fiat, rule.side) + rule.op + rule.target;
        // повторный клик с теми же параметрами создавал второй такой же алерт:
        // он срабатывал дважды и присылал два одинаковых уведомления
        const exists = current.some(
          (a) => pairKey(a.crypto, a.fiat, a.side) + a.op + a.target === key,
        );
        if (exists) return false;
        const alert: AlertRule = { ...rule, id: uid(), active: true };
        set({ alerts: [alert, ...current] });
        return true;
      },

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
          const next = appendHistoryPoint(s.history[key], best, Date.now());
          if (next === s.history[key]) return s; // дубль в окне защиты — не пишем
          // вытесняем давно не открывавшиеся пары, иначе localStorage переполнится
          return { history: pruneHistory({ ...s.history, [key]: next }) };
        });
      },

      clearHistory: () => set({ history: {} }),

      applySyncState: (remote) =>
        set((s) => {
          const remoteSettings = remote.settings ?? {};
          return {
            crypto: remote.crypto || s.crypto,
            fiat: remote.fiat || s.fiat,
            side: remote.side || s.side,
            watchlist: remote.watchlist ?? s.watchlist,
            alerts: remote.alerts ?? s.alerts,
            history: remote.history ?? s.history,
            settings: {
              ...s.settings,
              ...remoteSettings,
              // границы соблюдаются и для данных из соседней вкладки
              refreshSec: clampRefreshSec(remoteSettings.refreshSec ?? s.settings.refreshSec),
              pageSize: clampPageSize(remoteSettings.pageSize ?? s.settings.pageSize),
              // ключ и баннер остаются локальными
              apiKey: s.settings.apiKey,
              demoBannerDismissed: s.settings.demoBannerDismissed,
            },
          };
        }),

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
          // локальные элементы приоритетнее: сначала старые, потом новые;
          // при превышении лимита обрезаем с конца — отбрасываем новые, а не старые
          return { watchlist: [...s.watchlist, ...add].slice(0, MAX_WATCH) };
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
              id: uid(),
              active: false,
              lastTriggeredAt: undefined,
            }));
          if (!add.length) return s;
          // локальные приоритетнее: сначала старые, потом новые;
          // при превышении лимита обрезаем с конца — отбрасываем новые, а не старые
          return { alerts: [...s.alerts, ...add].slice(0, MAX_ALERTS) };
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
          // повреждённое состояние не должно запускать шторм запросов к API
          st.settings.refreshSec = clampRefreshSec(st.settings.refreshSec);
          st.settings.pageSize = clampPageSize(st.settings.pageSize);
        }
        return st as P2PState;
      },
    },
  ),
);

export type { AlertOp };

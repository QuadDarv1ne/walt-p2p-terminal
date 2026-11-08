/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */
import { SyncStatePayload } from "./types";

/**
 * Децентрализованная синхронизация вкладок одного браузера.
 *
 * Никакого сервера: вкладки договариваются напрямую через BroadcastChannel.
 *  - зеркало состояния (пара, избранное, алерты, настройки) — во всех вкладках;
 *  - выборы «лидера» (вкладка с минимальным id): только она ходит в сеть,
 *    остальные вкладки получают готовые данные и экономят запросы к API.
 *
 * Если BroadcastChannel недоступен, всё работает по-старому: каждая вкладка
 * запрашивает данные сама.
 */

const CHANNEL_NAME = "walt-p2p-terminal-sync";
const HB_INTERVAL_MS = 4000;
const PEER_TTL_MS = 12_000;

type SyncMessage =
  | { type: "hb"; tabId: string; at: number }
  | { type: "bye"; tabId: string }
  | { type: "hello"; tabId: string }
  | { type: "state"; tabId: string; state: SyncStatePayload }
  | { type: "data"; tabId: string; key: string; payload: unknown };

interface CacheEntry {
  payload: unknown;
  at: number;
}

function makeTabId(): string {
  // sessionStorage сохраняет id при перезагрузке той же вкладки
  try {
    const KEY = "p2p-tab-id";
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

class TabSync {
  readonly tabId = makeTabId();

  private ch: BroadcastChannel | null = null;
  private peers = new Map<string, number>(); // tabId -> lastSeen
  private cache = new Map<string, CacheEntry>();
  private stateListeners = new Set<(state: SyncStatePayload, fromTab: string) => void>();
  private helloListeners = new Set<() => void>();
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  get available(): boolean {
    return typeof BroadcastChannel !== "undefined";
  }

  start(): void {
    if (this.started || !this.available || typeof window === "undefined") return;
    this.started = true;

    try {
      this.ch = new BroadcastChannel(CHANNEL_NAME);
      this.ch.onmessage = (event: MessageEvent<SyncMessage>) => this.handle(event.data);
    } catch {
      this.ch = null;
      return;
    }

    this.hbTimer = setInterval(() => {
      this.post({ type: "hb", tabId: this.tabId, at: Date.now() });
      this.peers.set(this.tabId, Date.now()); // чтобы isLeader учитывал и себя
    }, HB_INTERVAL_MS);

    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, seen] of this.peers) {
        if (id !== this.tabId && now - seen > PEER_TTL_MS) this.peers.delete(id);
      }
    }, PEER_TTL_MS);

    this.post({ type: "hello", tabId: this.tabId });
  }

  stop(): void {
    if (!this.started) return;
    this.post({ type: "bye", tabId: this.tabId });
    if (this.hbTimer) clearInterval(this.hbTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.hbTimer = null;
    this.pruneTimer = null;
    try {
      this.ch?.close();
    } catch {
      /* ignore */
    }
    this.ch = null;
    this.started = false;
    this.peers.clear();
    this.cache.clear();
  }

  private post(msg: SyncMessage): void {
    try {
      this.ch?.postMessage(msg);
    } catch {
      /* канал мог закрыться */
    }
  }

  private handle(msg: SyncMessage): void {
    if (!msg || msg.tabId === this.tabId) return;

    switch (msg.type) {
      case "hb":
        this.peers.set(msg.tabId, Date.now());
        break;
      case "hello":
        this.peers.set(msg.tabId, Date.now());
        for (const cb of this.helloListeners) cb();
        break;
      case "bye":
        this.peers.delete(msg.tabId);
        break;
      case "state":
        this.peers.set(msg.tabId, Date.now());
        for (const cb of this.stateListeners) cb(msg.state, msg.tabId);
        break;
      case "data":
        this.peers.set(msg.tabId, Date.now());
        this.cache.set(msg.key, { payload: msg.payload, at: Date.now() });
        break;
    }
  }

  /** Есть ли живые соседние вкладки */
  hasPeers(): boolean {
    if (!this.started) return false;
    const now = Date.now();
    for (const [id, seen] of this.peers) {
      if (id !== this.tabId && now - seen <= PEER_TTL_MS) return true;
    }
    return false;
  }

  /** Я — лидер (минимальный tabId среди живых вкладок) */
  isLeader(): boolean {
    if (!this.started || !this.hasPeers()) return true;
    const mine = this.tabId;
    for (const id of this.peers.keys()) {
      if (id !== this.tabId && id < mine) return false;
    }
    return true;
  }

  isFollower(): boolean {
    return this.started && this.hasPeers() && !this.isLeader();
  }

  /** Свежие данные от лидера (для последователей) */
  getFresh<T>(key: string, maxAgeMs: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > maxAgeMs) return null;
    return entry.payload as T;
  }

  /** Опубликовать данные для остальных вкладок */
  publish(key: string, payload: unknown): void {
    this.cache.set(key, { payload, at: Date.now() });
    this.post({ type: "data", tabId: this.tabId, key, payload });
  }

  onState(cb: (state: SyncStatePayload, fromTab: string) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  onHello(cb: () => void): () => void {
    this.helloListeners.add(cb);
    return () => this.helloListeners.delete(cb);
  }

  /** Разослать текущее состояние соседним вкладкам */
  publishState(state: SyncStatePayload): void {
    this.post({ type: "state", tabId: this.tabId, state });
  }
}

export const tabSync = new TabSync();

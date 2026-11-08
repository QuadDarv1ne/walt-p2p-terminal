/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */
import {
  AlertRule,
  PeerInfo,
  PeerQuote,
  PeerStatus,
  WatchItem,
  pairKey,
} from "./types";

/**
 * Децентрализованная P2P-сеть между пользователями (WebRTC DataChannel).
 *
 * Никакого сигналинг-сервера: два браузера обмениваются «кодами приглашения»
 * любым удобным способом (мессенджер, почта, QR) и получают прямой
 * соединение. Поверх него участники обмениваются свежими курсами,
 * избранным и алертами — данные не проходят через чей-то сервер.
 *
 * STUN-серверы используются только для обхода NAT (определение адреса),
 * они не видят содержимое трафика. В одной локальной сети соединение
 * устанавливается даже без STUN.
 */

const CODE_PREFIX = "WALT1:";
const DC_LABEL = "walt-p2p-terminal";
const PING_INTERVAL_MS = 10_000;
const MAX_LOG = 30;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
  iceCandidatePoolSize: 2,
};

/* ------------------------- кодирование кодов ------------------------- */

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Сжимаем SDP, чтобы код приглашения было проще переслать */
async function encodeCode(payload: unknown): Promise<string> {
  const json = JSON.stringify(payload);
  if (typeof CompressionStream !== "undefined") {
    try {
      const cs = new CompressionStream("deflate-raw");
      const buf = await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer();
      return CODE_PREFIX + "Z" + bytesToBase64Url(new Uint8Array(buf));
    } catch {
      /* без сжатия */
    }
  }
  return CODE_PREFIX + "J" + bytesToBase64Url(new TextEncoder().encode(json));
}

async function decodeCode<T>(code: string): Promise<T> {
  const clean = code.trim().replace(/\s+/g, "");
  if (!clean.startsWith(CODE_PREFIX)) {
    throw new Error("Это не код приглашения P2P Терминала");
  }
  const body = clean.slice(CODE_PREFIX.length);
  const kind = body[0];
  let bytes: Uint8Array;
  if (kind === "Z") {
    const ds = new DecompressionStream("deflate-raw");
    const bytesPart = base64UrlToBytes(body.slice(1)) as unknown as BlobPart;
    const buf = await new Response(new Blob([bytesPart]).stream().pipeThrough(ds)).arrayBuffer();
    bytes = new Uint8Array(buf);
  } else {
    bytes = base64UrlToBytes(body.slice(1));
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function waitIce(pc: RTCPeerConnection, timeoutMs = 8000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
  });
}

/* ----------------------------- протокол ------------------------------ */

type WireMessage =
  | { t: "hello"; name: string }
  | {
      t: "snap";
      name: string;
      at: number;
      quotes: PeerQuote[];
      watchlist?: WatchItem[];
      alerts?: AlertRule[];
    }
  | { t: "ping"; id: string; at: number }
  | { t: "pong"; id: string; at: number }
  | { t: "bye" };

export interface RemoteQuote extends PeerQuote {
  from: string;
  /** id соединения — по нему данные пира удаляются при отключении */
  peerId: string;
  receivedAt: number;
}

export interface PeerNetworkSnapshot {
  supported: boolean;
  peers: PeerInfo[];
  quotes: Record<string, RemoteQuote>;
  incoming: { name: string; at: number; watchlist: WatchItem[]; alerts: AlertRule[] }[];
  log: { at: number; text: string }[];
}

export interface LocalSnapshotProvider {
  (): {
    name: string;
    quotes: PeerQuote[];
    watchlist?: WatchItem[];
    alerts?: AlertRule[];
  };
}

interface PeerConn {
  id: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  name: string;
  status: PeerStatus;
  connectedAt: number;
  lastSeen: number;
  rttMs: number | null;
  pings: Map<string, number>;
  pingTimer: ReturnType<typeof setInterval> | null;
  saidHello: boolean;
}

const EMPTY_SNAPSHOT: PeerNetworkSnapshot = {
  supported: true,
  peers: [],
  quotes: {},
  incoming: [],
  log: [],
};

class PeerNetwork {
  private peers = new Map<string, PeerConn>();
  private pending = new Map<string, PeerConn>(); // id соединения, ждущего ответа
  private listeners = new Set<() => void>();
  private provider: LocalSnapshotProvider | null = null;
  private snap: PeerNetworkSnapshot = EMPTY_SNAPSHOT;
  private quotes: Record<string, RemoteQuote> = {};
  private incoming = new Map<string, { name: string; at: number; watchlist: WatchItem[]; alerts: AlertRule[] }>();
  private logEntries: { at: number; text: string }[] = [];

  get supported(): boolean {
    return typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined";
  }

  /* ------------------------- подписка React ------------------------- */

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): PeerNetworkSnapshot => this.snap;

  private notify(): void {
    this.snap = {
      supported: this.supported,
      peers: [...this.peers.values()].map(
        (p): PeerInfo => ({
          id: p.id,
          name: p.name || "…",
          status: p.status,
          connectedAt: p.connectedAt,
          lastSeen: p.lastSeen,
          rttMs: p.rttMs,
        }),
      ),
      quotes: { ...this.quotes },
      incoming: [...this.incoming.values()],
      log: [...this.logEntries],
    };
    for (const cb of this.listeners) cb();
  }

  private addLog(text: string): void {
    this.logEntries = [{ at: Date.now(), text }, ...this.logEntries].slice(0, MAX_LOG);
  }

  /* --------------------------- провайдер ---------------------------- */

  /** Хук регистрирует функцию, отдающую локальные данные для рассылки */
  setProvider(fn: LocalSnapshotProvider | null): void {
    this.provider = fn;
  }

  broadcastSnapshot(): void {
    if (!this.provider || !this.connectedCount()) return;
    const local = this.provider();
    const msg: WireMessage = {
      t: "snap",
      name: local.name,
      at: Date.now(),
      quotes: local.quotes,
      watchlist: local.watchlist,
      alerts: local.alerts,
    };
    for (const p of this.peers.values()) {
      if (p.status === "connected") this.send(p, msg);
    }
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.status === "connected") n++;
    return n;
  }

  /* ---------------------------- сигналинг --------------------------- */

  /** Шаг 1 (инициатор): создать код приглашения */
  async createInvite(): Promise<{ inviteId: string; code: string }> {
    if (!this.supported) throw new Error("Браузер не поддерживает WebRTC");
    // закрываем незавершённые прошлые приглашения — иначе RTCPeerConnection утекают
    for (const old of this.pending.values()) {
      try {
        old.pc.close();
      } catch {
        /* ignore */
      }
    }
    this.pending.clear();
    const inviteId = Math.random().toString(36).slice(2, 10);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const conn: PeerConn = {
      id: inviteId,
      pc,
      dc: null,
      name: "",
      status: "signaling",
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      rttMs: null,
      pings: new Map(),
      pingTimer: null,
      saidHello: false,
    };
    this.pending.set(inviteId, conn);
    this.bindConnection(conn);

    const dc = pc.createDataChannel(DC_LABEL, { ordered: true });
    this.bindChannel(conn, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    const code = await encodeCode({ role: "offer", sdp: pc.localDescription?.sdp });
    this.addLog("Создан код приглашения — отправьте его напарнику");
    this.notify();
    return { inviteId, code };
  }

  /** Шаг 2 (принимающий): принять код приглашения, вернуть код ответа */
  async acceptInvite(code: string): Promise<string> {
    if (!this.supported) throw new Error("Браузер не поддерживает WebRTC");
    const payload = await decodeCode<{ role: string; sdp?: string }>(code);
    if (payload.role !== "offer" || !payload.sdp) {
      throw new Error("Ожидался код приглашения, а получен код ответа");
    }
    const peerId = Math.random().toString(36).slice(2, 10);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const conn: PeerConn = {
      id: peerId,
      pc,
      dc: null,
      name: "",
      status: "connecting",
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      rttMs: null,
      pings: new Map(),
      pingTimer: null,
      saidHello: false,
    };
    this.peers.set(peerId, conn);
    this.bindConnection(conn);

    pc.ondatachannel = (event) => this.bindChannel(conn, event.channel);

    await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIce(pc);
    const answerCode = await encodeCode({ role: "answer", sdp: pc.localDescription?.sdp });
    this.addLog("Приглашение принято — верните напарнику код ответа");
    this.notify();
    return answerCode;
  }

  /** Шаг 3 (инициатор): вставить код ответа и соединиться */
  async completeInvite(inviteId: string, answerCode: string): Promise<void> {
    const conn = this.pending.get(inviteId);
    if (!conn) throw new Error("Приглашение не найдено — создайте новое");
    const payload = await decodeCode<{ role: string; sdp?: string }>(answerCode);
    if (payload.role !== "answer" || !payload.sdp) {
      throw new Error("Ожидался код ответа, а получен код приглашения");
    }
    await conn.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
    conn.status = "connecting";
    this.addLog("Код ответа принят — устанавливаем соединение…");
    this.notify();
  }

  disconnect(peerId: string): void {
    const conn = this.peers.get(peerId);
    if (!conn) return;
    this.send(conn, { t: "bye" });
    this.teardown(conn);
    this.addLog(`Отключён пир ${conn.name || peerId}`);
    this.notify();
  }

  disconnectAll(): void {
    for (const conn of [...this.peers.values(), ...this.pending.values()]) {
      this.send(conn, { t: "bye" });
      this.teardown(conn);
    }
    this.pending.clear();
    this.notify();
  }

  /* ------------------------- внутреннее ----------------------------- */

  private bindConnection(conn: PeerConn): void {
    conn.pc.onconnectionstatechange = () => {
      const st = conn.pc.connectionState;
      if (st === "failed") {
        conn.status = "failed";
        this.addLog(`Соединение с ${conn.name || "пиром"} не удалось (проверьте коды и сеть)`);
        this.teardown(conn);
      } else if (st === "closed") {
        this.teardown(conn);
      } else if (st === "disconnected") {
        conn.status = "connecting";
      }
      this.notify();
    };
  }

  private bindChannel(conn: PeerConn, dc: RTCDataChannel): void {
    conn.dc = dc;
    dc.onopen = () => {
      conn.status = "connected";
      conn.connectedAt = Date.now();
      conn.lastSeen = Date.now();
      this.pending.delete(conn.id);
      this.peers.set(conn.id, conn);
      this.addLog(`Соединение установлено${conn.name ? `: ${conn.name}` : ""}`);
      this.sendHello(conn);
      this.broadcastSnapshot();
      conn.pingTimer = setInterval(() => this.sendPing(conn), PING_INTERVAL_MS);
      this.sendPing(conn);
      this.notify();
    };
    dc.onclose = () => {
      this.teardown(conn);
      this.addLog(`Пир ${conn.name || "неизвестный"} отключился`);
      this.notify();
    };
    dc.onmessage = (event) => this.onMessage(conn, event);
  }

  private teardown(conn: PeerConn): void {
    if (conn.pingTimer) clearInterval(conn.pingTimer);
    conn.pingTimer = null;
    conn.status = "closed";
    try {
      conn.dc?.close();
    } catch {
      /* ignore */
    }
    try {
      conn.pc.close();
    } catch {
      /* ignore */
    }
    this.peers.delete(conn.id);
    this.pending.delete(conn.id);
    this.dropPeerData(conn.id);
  }

  /**
   * Удаляет данные отключившегося пира.
   *
   * Без этого его курсы и списки навсегда оставались в интерфейсе: пользователь
   * видел «живые» котировки от собеседника, который давно ушёл из сети, и не мог
   * понять, что цифры устарели.
   */
  private dropPeerData(peerId: string): void {
    let changed = false;
    for (const [key, q] of Object.entries(this.quotes)) {
      if (q.peerId === peerId) {
        delete this.quotes[key];
        changed = true;
      }
    }
    if (this.incoming.delete(peerId)) changed = true;
    if (changed) this.notify();
  }

  private send(conn: PeerConn, msg: WireMessage): void {
    try {
      conn.dc?.send(JSON.stringify(msg));
    } catch {
      /* канал закрылся */
    }
  }

  private sendHello(conn: PeerConn): void {
    if (conn.saidHello) return;
    conn.saidHello = true;
    const local = this.provider?.();
    this.send(conn, { t: "hello", name: local?.name ?? "Без имени" });
  }

  private sendPing(conn: PeerConn): void {
    if (conn.status !== "connected") return;
    const id = Math.random().toString(36).slice(2, 8);
    conn.pings.set(id, Date.now());
    if (conn.pings.size > 8) {
      const oldest = [...conn.pings.keys()][0];
      conn.pings.delete(oldest);
    }
    this.send(conn, { t: "ping", id, at: Date.now() });
  }

  private onMessage(conn: PeerConn, event: MessageEvent): void {
    let msg: WireMessage;
    try {
      msg = JSON.parse(String(event.data)) as WireMessage;
    } catch {
      return;
    }
    conn.lastSeen = Date.now();

    switch (msg.t) {
      case "hello": {
        conn.name = String(msg.name || "Без имени").slice(0, 40);
        this.sendHello(conn); // отвечаем своим именем
        this.broadcastSnapshot(); // и сразу делимся данными
        this.addLog(`Пир представился: ${conn.name}`);
        break;
      }
      case "snap": {
        conn.name = String(msg.name || conn.name || "Без имени").slice(0, 40);
        const at = Number(msg.at) || Date.now();
        for (const q of msg.quotes ?? []) {
          if (!q || !q.crypto || !q.fiat || (q.side !== "SELL" && q.side !== "BUY")) continue;
          const key = pairKey(q.crypto, q.fiat, q.side);
          const prev = this.quotes[key];
          // берём самое свежее
          if (!prev || at >= prev.receivedAt) {
            this.quotes[key] = { ...q, from: conn.name, peerId: conn.id, receivedAt: at };
          }
        }
        this.incoming.set(conn.id, {
          name: conn.name,
          at,
          watchlist: msg.watchlist ?? [],
          alerts: msg.alerts ?? [],
        });
        this.addLog(`Данные от ${conn.name}: пар ${msg.quotes?.length ?? 0}`);
        break;
      }
      case "ping": {
        this.send(conn, { t: "pong", id: msg.id, at: msg.at });
        break;
      }
      case "pong": {
        const sentAt = conn.pings.get(msg.id);
        if (sentAt) {
          conn.rttMs = Date.now() - sentAt;
          conn.pings.delete(msg.id);
        }
        break;
      }
      case "bye": {
        this.teardown(conn);
        this.addLog(`Пир ${conn.name || "неизвестный"} отключился`);
        break;
      }
    }
    this.notify();
  }
}

export const peerNetwork = new PeerNetwork();

// отладочный дескриптор для консоли браузера (не используется приложением)
if (typeof window !== "undefined") {
  (window as unknown as { p2pPeerNetwork?: PeerNetwork }).p2pPeerNetwork = peerNetwork;
}

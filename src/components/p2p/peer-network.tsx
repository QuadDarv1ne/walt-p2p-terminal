"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Check,
  Copy,
  Network,
  PlugZap,
  RadioTower,
  Send,
  Star,
  Trash2,
  Unplug,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatPrice, timeAgo } from "@/lib/p2p/format";
import { useP2PStore } from "@/lib/p2p/store";
import { PeerInfo, PeerStatus } from "@/lib/p2p/types";
import { PeerNetworkSnapshot, peerNetwork } from "@/lib/p2p/webrtc";

const EMPTY: PeerNetworkSnapshot = {
  supported: true,
  peers: [],
  quotes: {},
  incoming: [],
  log: [],
};

const STATUS_LABEL: Record<PeerStatus, string> = {
  signaling: "создание кода",
  connecting: "соединение…",
  connected: "на связи",
  failed: "ошибка",
  closed: "отключён",
};

function statusDotClass(status: PeerStatus): string {
  switch (status) {
    case "connected":
      return "bg-emerald-500 animate-pulse";
    case "connecting":
    case "signaling":
      return "bg-amber-500 animate-pulse";
    case "failed":
      return "bg-rose-500";
    default:
      return "bg-zinc-400/60";
  }
}

function CopyButton({ text, label = "Копировать" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            toast.success("Скопировано");
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => toast.error("Не удалось скопировать"));
      }}
    >
      {copied ? <Check className="mr-1.5 h-4 w-4 text-emerald-500" /> : <Copy className="mr-1.5 h-4 w-4" />}
      {label}
    </Button>
  );
}

/** Ссылка на терминал с кодом в хеше — альтернатива копипасте самого кода */
function shareUrl(kind: "invite" | "answer", code: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}#${kind}=${encodeURIComponent(code)}`;
}

function ShareLinkButton({ kind, code }: { kind: "invite" | "answer"; code: string }) {
  const url = shareUrl(kind, code);
  return (
    <CopyButton text={url} label={kind === "invite" ? "Скопировать ссылку-приглашение" : "Скопировать ссылку с ответом"} />
  );
}

function PeerRow({ peer }: { peer: PeerInfo }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(peer.status)}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{peer.name}</div>
        <div className="num text-[11px] text-muted-foreground">
          {STATUS_LABEL[peer.status]}
          {peer.rttMs !== null ? ` · отклик ${peer.rttMs} мс` : ""}
          {peer.status === "connected" ? ` · с ${new Date(peer.connectedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => peerNetwork.disconnect(peer.id)}
        aria-label={`Отключить ${peer.name}`}
        disabled={peer.status !== "connected"}
      >
        <Unplug className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    </div>
  );
}

export function PeerNetworkCard() {
  const snap = useSyncExternalStore(peerNetwork.subscribe, peerNetwork.getSnapshot, () => EMPTY);
  const peerName = useP2PStore((s) => s.settings.peerName);
  const patchSettings = useP2PStore((s) => s.patchSettings);
  const mergeWatchlist = useP2PStore((s) => s.mergeWatchlist);
  const mergeAlerts = useP2PStore((s) => s.mergeAlerts);

  const [tab, setTab] = useState<"invite" | "join">("invite");
  const [invite, setInvite] = useState<{ id: string; code: string } | null>(null);
  const [answerInput, setAnswerInput] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [myAnswer, setMyAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // код из ссылки (#invite=… / #answer=…) — автозаполнение полей
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#invite=") && !hash.startsWith("#answer=")) return;
    const code = decodeURIComponent(hash.slice(hash.indexOf("=") + 1));
    const isInvite = hash.startsWith("#invite=");
    // убираем хеш, чтобы код не «прилипал» при перезагрузке
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (isInvite) {
      setTab("join");
      setInviteInput(code);
      toast.info("Код приглашения извлечён из ссылки", {
        description: "Нажмите «Принять приглашение», чтобы продолжить.",
        duration: 8000,
      });
    } else {
      setTab("invite");
      setAnswerInput(code);
      // приглашение всегда создаётся заново: код ответа в ссылке — это ответ
      // на конкретный offer, и привязывать его к прошлому (уже мог устареть) нельзя
      setInvite(null);
      toast.info("Код ответа извлечён из ссылки", {
        description: "Создайте новый код приглашения, затем вставьте этот ответ.",
        duration: 8000,
      });
    }
    document.getElementById("network")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // обновляем имя у пиров, если оно изменилось
  useEffect(() => {
    peerNetwork.broadcastSnapshot();
  }, [peerName]);

  const connected = snap.peers.filter((p) => p.status === "connected");
  const receivedQuotes = Object.entries(snap.quotes);

  const createInvite = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await peerNetwork.createInvite();
      setInvite({ id: res.inviteId, code: res.code });
      toast.success("Код приглашения готов", {
        description: "Перешлите его напарнику любым мессенджером",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setBusy(false);
    }
  };

  const completeInvite = async () => {
    if (!invite) return;
    setBusy(true);
    setError(null);
    try {
      await peerNetwork.completeInvite(invite.id, answerInput);
      toast.success("Код ответа принят", { description: "Устанавливаем прямое соединение…" });
      setInvite(null);
      setAnswerInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setBusy(false);
    }
  };

  const acceptInvite = async () => {
    setBusy(true);
    setError(null);
    try {
      const code = await peerNetwork.acceptInvite(inviteInput);
      setMyAnswer(code);
      toast.success("Код ответа готов", {
        description: "Отправьте его обратно инициатору — и соединение будет установлено",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="network">
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-primary" />
            P2P-сеть
          </CardTitle>
          <Badge variant={connected.length ? "default" : "outline"} className="num">
            {connected.length} / {snap.peers.length} на связи
          </Badge>
          {snap.peers.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                peerNetwork.disconnectAll();
                toast.info("Все соединения закрыты");
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Разорвать все
            </Button>
          )}
        </div>
        <Alert className="border-border/70">
          <RadioTower className="h-4 w-4 text-primary" />
          <AlertDescription className="text-xs leading-relaxed">
            Прямой обмен данными между браузерами через WebRTC — без сервера-посредника.
            Создайте код приглашения, отправьте напарнику в мессенджере, получите код ответа —
            и терминалы обмениваются курсами, избранным и алертами напрямую.
          </AlertDescription>
        </Alert>
      </CardHeader>

      <CardContent className="grid gap-5 lg:grid-cols-2">
        {/* --------------------- подключение --------------------- */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="peer-name" className="text-xs text-muted-foreground">
              Ваше имя в сети
            </Label>
            <Input
              id="peer-name"
              value={peerName}
              maxLength={40}
              onChange={(e) => patchSettings({ peerName: e.target.value })}
              aria-label="Ваше имя в P2P-сети"
            />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "invite" | "join")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="invite">Пригласить</TabsTrigger>
              <TabsTrigger value="join">Присоединиться</TabsTrigger>
            </TabsList>

            <TabsContent value="invite" className="mt-3 space-y-3">
              {!invite ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Создайте код приглашения и передайте его напарнику — например, в Telegram.
                  </p>
                  <Button onClick={createInvite} disabled={busy} className="w-full">
                    <Send className="mr-1.5 h-4 w-4" />
                    Создать код приглашения
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Шаг 1 — отправьте напарнику</Label>
                    <Textarea
                      readOnly
                      value={invite.code}
                      className="num h-24 resize-none text-[10px] leading-relaxed"
                      aria-label="Код приглашения"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <div className="flex flex-wrap gap-2">
                      <CopyButton text={invite.code} label="Скопировать код" />
                      <ShareLinkButton kind="invite" code={invite.code} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Ссылка удобнее: напарник откроет её — код вставится автоматически.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="answer-input" className="text-xs text-muted-foreground">
                      Шаг 2 — вставьте код ответа напарника
                    </Label>
                    <Textarea
                      id="answer-input"
                      value={answerInput}
                      onChange={(e) => setAnswerInput(e.target.value)}
                      placeholder="WALT1:…"
                      className="num h-20 resize-none text-[10px]"
                    />
                    <Button onClick={completeInvite} disabled={busy || !answerInput.trim()} className="w-full">
                      <PlugZap className="mr-1.5 h-4 w-4" />
                      Завершить подключение
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="join" className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="invite-input" className="text-xs text-muted-foreground">
                  Код приглашения от напарника
                </Label>
                <Textarea
                  id="invite-input"
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  placeholder="WALT1:…"
                  className="num h-24 resize-none text-[10px]"
                />
                <Button
                  onClick={acceptInvite}
                  disabled={busy || !inviteInput.trim()}
                  className="w-full"
                >
                  <PlugZap className="mr-1.5 h-4 w-4" />
                  Принять приглашение
                </Button>
              </div>
              {myAnswer && (
                <div className="space-y-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
                  <Label className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    Код ответа — отправьте его обратно
                  </Label>
                  <Textarea
                    readOnly
                    value={myAnswer}
                    className="num h-24 resize-none text-[10px] leading-relaxed"
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Код ответа"
                  />
                  <CopyButton text={myAnswer} label="Скопировать код" />
                  <ShareLinkButton kind="answer" code={myAnswer} />
                </div>
              )}
            </TabsContent>
          </Tabs>

          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {/* пиры */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              Участники ({snap.peers.length})
            </div>
            {!snap.peers.length && (
              <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                Пока никто не подключён
              </div>
            )}
            {snap.peers.map((p) => (
              <PeerRow key={p.id} peer={p} />
            ))}
          </div>
        </div>

        {/* ------------------ полученные данные ------------------ */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Курсы, полученные напрямую от пиров
            </div>
            {!receivedQuotes.length ? (
              <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
                После соединения здесь появятся курсы напарника — даже если у вас нет API-ключа
              </div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto thin-scroll pr-1">
                {receivedQuotes.map(([key, q]) => (
                  <div key={key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {q.crypto}/{q.fiat}
                        <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                          {q.side === "SELL" ? "покупка" : "продажа"}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        от {q.from} · {timeAgo(q.receivedAt)} · {q.onlineCount}/{q.totalCount} в сети
                      </div>
                    </div>
                    <div className="num shrink-0 text-sm font-semibold">
                      {formatPrice(q.best)} <span className="text-[11px] font-normal text-muted-foreground">{q.fiat}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {snap.incoming.map((inc) => (
            <div key={inc.name + inc.at} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                <span className="font-medium">{inc.name}</span>
                <span className="text-muted-foreground">
                  делится: {inc.watchlist.length} пар, {inc.alerts.length} алертов
                </span>
                <div className="ml-auto flex gap-1.5">
                  {inc.watchlist.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        mergeWatchlist(inc.watchlist);
                        toast.success(`Избранное ${inc.name} добавлено`);
                      }}
                    >
                      Взять пары
                    </Button>
                  )}
                  {inc.alerts.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        mergeAlerts(inc.alerts);
                        toast.success(`Алерты ${inc.name} добавлены (выключены)`);
                      }}
                    >
                      Взять алерты
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {snap.log.length > 0 && (
            <details className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">
                Журнал сети ({snap.log.length})
              </summary>
              <div className="mt-2 space-y-1">
                {snap.log.slice(0, 8).map((l, i) => (
                  <div key={`${l.at}-${i}`} className="num text-[11px] text-muted-foreground">
                    {new Date(l.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} — {l.text}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

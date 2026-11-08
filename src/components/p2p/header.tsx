"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { useSyncExternalStore } from "react";
import { ArrowLeftRight, Network, RefreshCw, Settings, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/p2p/theme-switcher";
import type { ConnMode } from "@/lib/p2p/types";
import { PeerNetworkSnapshot, peerNetwork } from "@/lib/p2p/webrtc";

const EMPTY_PEERS: PeerNetworkSnapshot = {
  supported: true,
  peers: [],
  quotes: {},
  incoming: [],
  log: [],
};

interface HeaderProps {
  mode: ConnMode;
  hasError: boolean;
  loading: boolean;
  secondsLeft: number;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

function PeerBadge() {
  const snap = useSyncExternalStore(peerNetwork.subscribe, peerNetwork.getSnapshot, () => EMPTY_PEERS);
  const connected = snap.peers.filter((p) => p.status === "connected").length;
  if (!connected) return null;
  return (
    <button
      type="button"
      title="P2P-сеть: участники на связи"
      onClick={() => document.getElementById("network")?.scrollIntoView({ behavior: "smooth" })}
      className="transition-opacity hover:opacity-80"
    >
      <Badge variant="outline" className="gap-1.5 border-violet-500/60 text-violet-600 dark:text-violet-400">
        <Network className="h-3 w-3" />
        <span className="num">{connected}</span>
      </Badge>
    </button>
  );
}

export function Header({ mode, hasError, loading, secondsLeft, onRefresh, onOpenSettings }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ArrowLeftRight className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">Walt P2P Терминал</div>
            <div className="hidden truncate text-[11px] text-muted-foreground sm:block">
              мониторинг курсов и объявлений
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <PeerBadge />
          {hasError ? (
            <Badge variant="destructive" className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              Нет связи
            </Badge>
          ) : mode === "demo" ? (
            <Badge variant="outline" className="gap-1.5 border-amber-500/60 text-amber-600 dark:text-amber-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Демо-данные
            </Badge>
          ) : mode === "relay" ? (
            <Badge variant="outline" className="gap-1.5 border-violet-500/60 text-violet-600 dark:text-violet-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
              Через релей
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-emerald-500/60 text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Реальный API
            </Badge>
          )}

          <div
            className="num hidden items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground sm:flex"
            title="До следующего автообновления"
          >
            <Timer className="h-3.5 w-3.5" />
            {secondsLeft} с
          </div>

          <Button variant="outline" size="icon" onClick={onRefresh} disabled={loading} aria-label="Обновить сейчас">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="icon" onClick={onOpenSettings} aria-label="Настройки">
            <Settings className="h-4 w-4" />
          </Button>
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}

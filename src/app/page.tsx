"use client";

import { useState } from "react";
import { Info, Settings2, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/p2p/header";
import { MarketFilters } from "@/components/p2p/market-filters";
import { MonitorPanel } from "@/components/p2p/monitor-panel";
import { OrdersTable } from "@/components/p2p/orders-table";
import { PairMatrix } from "@/components/p2p/pair-matrix";
import { PeerNetworkCard } from "@/components/p2p/peer-network";
import { StatsCards } from "@/components/p2p/stats-cards";
import { Footer } from "@/components/p2p/footer";
import { SettingsDialog } from "@/components/p2p/settings-dialog";
import { useP2pData } from "@/hooks/use-p2p-data";
import { useMounted } from "@/hooks/use-mounted";
import { useP2PStore } from "@/lib/p2p/store";
import type { P2PApiError } from "@/lib/p2p/types";

function DemoBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const mode = useP2PStore((s) => s.settings.mode);
  const dismissed = useP2PStore((s) => s.settings.demoBannerDismissed);
  const patchSettings = useP2PStore((s) => s.patchSettings);

  if (mode !== "demo" || dismissed) return null;
  return (
    <Alert className="border-amber-500/40">
      <Info className="h-4 w-4 text-amber-500" />
      <AlertTitle>Включены демо-данные</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="flex-1">
          Это симуляция рынка для знакомства с интерфейсом. Чтобы видеть реальные курсы,
          вставьте API-ключ Walt в настройках.
        </span>
        <Button size="sm" variant="outline" onClick={onOpenSettings} className="shrink-0">
          <Settings2 className="mr-1.5 h-3.5 w-3.5" />
          Подключить API
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={() => patchSettings({ demoBannerDismissed: true })}
          aria-label="Скрыть напоминание"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function ErrorBanner({ error, onOpenSettings }: { error: P2PApiError | null; onOpenSettings: () => void }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>Не удалось получить данные из P2P API</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="flex-1">{error.hint ? `${error.message}. ${error.hint}` : error.message}</span>
        <Button size="sm" variant="outline" onClick={onOpenSettings} className="shrink-0">
          <Settings2 className="mr-1.5 h-3.5 w-3.5" />
          Настройки
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 terminal-bg">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Загружаем P2P Терминал…</p>
    </div>
  );
}

export default function Page() {
  const mounted = useMounted();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const data = useP2pData();

  if (!mounted) return <Splash />;

  const ads = data.side === "SELL" ? (data.sellRes?.ads ?? []) : (data.buyRes?.ads ?? []);
  const lastUpdated = data.side === "SELL" ? data.sellRes?.fetchedAt : data.buyRes?.fetchedAt;
  const cryptoKey = `${data.crypto}-${data.fiat}-${data.side}`;

  return (
    <div className="flex min-h-screen flex-col terminal-bg">
      <Header
        mode={data.settings.mode}
        hasError={!!data.error}
        loading={data.loading}
        secondsLeft={data.secondsLeft}
        onRefresh={data.refresh}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        <DemoBanner onOpenSettings={() => setSettingsOpen(true)} />
        <ErrorBanner error={data.error} onOpenSettings={() => setSettingsOpen(true)} />

        <StatsCards
          quote={data.currentQuote}
          spreadPct={data.spreadPct}
          lastUpdated={data.sellRes?.fetchedAt ?? null}
        />

        <MarketFilters />

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <OrdersTable
              key={`${cryptoKey}`}
              ads={ads}
              side={data.side}
              crypto={data.crypto}
              fiat={data.fiat}
              loading={data.loading}
              lastUpdated={lastUpdated ?? null}
              hasError={!!data.error}
              onRefresh={data.refresh}
            />
          </div>
          <MonitorPanel quote={data.currentQuote} extraQuotes={data.extraQuotes} />
        </div>

        <PairMatrix
          fiat={data.fiat}
          matrix={data.matrix}
          loading={data.matrixLoading}
          selectedCrypto={data.crypto}
          onRefresh={data.refreshMatrix}
        />

        <PeerNetworkCard />
      </main>

      <Footer />
      <SettingsDialog
        key={settingsOpen ? "open" : "closed"}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </div>
  );
}

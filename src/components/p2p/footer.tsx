"use client";

import { BookOpen, ShieldCheck } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border/70 bg-background/60">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
        <p className="flex items-start gap-1.5 sm:items-center">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" />
          Децентрализованно: данные идут из вашего браузера прямо в P2P API Walt, обмен между
          пользователями — напрямую через WebRTC, вкладки синхронизируются без сервера. Сделки
          совершаются в интерфейсе P2P Маркета Walt. Ключ хранится локально.
        </p>
        <a
          href="https://help.ru.walt.io/article/933-p2p-api-ru"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Документация P2P API
        </a>
      </div>
      <div className="mx-auto w-full max-w-7xl px-4 pb-4 text-[11px] text-muted-foreground sm:px-6">
        © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7). Код является
        интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
      </div>
    </footer>
  );
}

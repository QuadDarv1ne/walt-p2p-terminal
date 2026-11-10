"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/p2p/format";

/**
 * Относительное время, которое действительно идёт.
 *
 * `timeAgo()` — чистая функция от `Date.now()`, поэтому подпись «обновлено:
 * только что» застывала на экране навсегда: ре-рендер случался только при
 * следующем автообновлении, а при ошибке сети — вообще никогда. Пользователь
 * видел «5 с назад» через десять минут после последнего запроса и считал данные
 * свежими. Компонент тикает сам, пока вкладка видима.
 */
export function TimeAgo({
  ts,
  className,
}: {
  ts: number | null | undefined;
  className?: string;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    // скрытая вкладка не рисуется — незачем будить её таймером
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => setTick((n) => n + 1), 5000);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setTick((n) => n + 1); // сразу догоняем пропущенное время
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <span className={className}>{timeAgo(ts)}</span>;
}

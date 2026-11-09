"use client";
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */

import { useEffect } from "react";

/**
 * Регистрация Service Worker — офлайн-режим и установка терминала как
 * приложения (PWA). После первой загрузки интерфейс не зависит от сервера.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Service Worker требует безопасный контекст. Напрямую сравнивать протокол
    // с https: неверно: спецификация считает безопасными и 127.0.0.1, и ::1,
    // из-за чего офлайн-режим молча не работал при доступе по IP-адресу.
    if (!window.isSecureContext) return;
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() => {
          /* офлайн-режим недоступен — не критично */
        });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

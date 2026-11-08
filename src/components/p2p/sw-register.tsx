"use client";

import { useEffect } from "react";

/**
 * Регистрация Service Worker — офлайн-режим и установка терминала как
 * приложения (PWA). После первой загрузки интерфейс не зависит от сервера.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      // SW требует безопасный контекст
      return;
    }
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

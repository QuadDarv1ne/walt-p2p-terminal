#!/usr/bin/env bun
/**
 * Локальный CORS-релей для Walt P2P Terminal.
 *
 * Браузер не умеет ходить через MTProto/SOCKS/HTTP-прокси напрямую (ссылки
 * вида https://t.me/proxy?... — это MTProto-прокси Telegram, они переносят
 * только трафик мессенджера, а не HTTP-запросы к API). Поэтому прокси-трафик
 * берёт на себя этот локальный процесс, а браузер общается с ним по localhost.
 *
 * Что делает релей:
 *   1. Принимает запросы от терминала (fetch с localhost).
 *   2. Ходит к p2p.walletbot.me — напрямую или через upstream-прокси.
 *   3. Отдаёт ответ браузеру с CORS-заголовками.
 *
 * Запуск:
 *   bun scripts/relay-proxy.ts                 — порт 8765
 *   PORT=9000 bun scripts/relay-proxy.ts        — порт 9000
 *
 * В настройках терминала → «Реальный API — через локальный релей» укажите:
 *   http://localhost:8765/
 *
 * Upstream-прокси (нужен, только если API блокируется на сетевом уровне):
 *   PROXY=socks5://127.0.0.1:1080 bun scripts/relay-proxy.ts
 *   PROXY=http://user:pass@host:8080 bun scripts/relay-proxy.ts
 * Также читаются стандартные https_proxy / http_proxy.
 *
 * API-ключ (необязательно):
 *   P2P_API_KEY=... — релей подставит его в X-API-Key, если браузер ключ не прислал.
 *   Имя без префикса NEXT_PUBLIC_ принципиально: иначе Next.js вкомпилирует ключ
 *   в клиентский бандл и он станет публичным.
 *
 * ВАЖНО: MTProto-прокси (t.me/proxy) здесь НЕ подходит — это не HTTP/SOCKS-прокси.
 * Проверено на TgWsProxy: порт открывается, но ни SOCKS5-greeting, ни MTProto-
 * хендшейк не получают ответа, а `curl --socks5` возвращает http=000.
 * Чтобы использовать такой прокси, поднимите локальный HTTP/SOCKS-выход через
 * клиент (например, mihomo/Clash) и укажите в PROXY уже его адрес.
 */

// Bun сам подхватывает .env из корня проекта — адрес API можно задать там.
// Внимание: в официальной документации Walt до сих пор указан p2p.walt.io, но
// этот хост не резолвится (NXDOMAIN). Рабочий адрес — p2p.walletbot.me.
const TARGET =
  process.env.NEXT_PUBLIC_P2P_API_URL?.trim() ||
  "https://p2p.walletbot.me/p2p/integration-api/v1/item/online";
const PORT = Number(process.env.PORT) || 8765;
const UPSTREAM = process.env.PROXY || process.env.https_proxy || process.env.http_proxy || "";

/**
 * Ключ API живёт только на сервере: переменная без префикса NEXT_PUBLIC_ не
 * попадает в клиентский бандл. Если браузер не прислал X-API-Key, релей
 * подставляет ключ из .env — так он не покидает локальную машину.
 */
const SERVER_API_KEY = process.env.P2P_API_KEY?.trim() || "";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, accept",
  "Access-Control-Max-Age": "86400",
};

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const origin = req.headers.get("origin") ?? "*";
    const allow = { ...corsHeaders, "Access-Control-Allow-Origin": origin || "*" };

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: allow });
    }

    // health-check для диагностики
    const path = new URL(req.url).pathname;
    if (path === "/health") {
      return Response.json(
        {
          status: "ok",
          upstream: UPSTREAM || "none",
          target: TARGET,
          // только факт наличия ключа — значение наружу не отдаём
          apiKey: SERVER_API_KEY ? "set" : "missing",
          ts: Date.now(),
        },
        { headers: allow },
      );
    }

    const body = await req.arrayBuffer();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      accept: "application/json",
    };
    // ключ из запроса имеет приоритет; иначе берём серверный из .env
    const key = req.headers.get("x-api-key")?.trim() || SERVER_API_KEY;
    if (key) headers["X-API-Key"] = key;

    try {
      const upstream = await fetch(TARGET, {
        method: "POST",
        headers,
        body: body.byteLength ? body : undefined,
        signal: AbortSignal.timeout(15_000),
        // Bun-native: трафик идёт через upstream-прокси, если он задан
        ...(UPSTREAM ? { proxy: UPSTREAM } : {}),
      } as RequestInit);

      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: { ...allow, "Content-Type": "application/json" },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[relay] ошибка проксирования: ${detail}`);
      return Response.json(
        { error: "Релей не смог достучаться до API", detail },
        { status: 502, headers: allow },
      );
    }
  },
});

console.log(`\n[relay] CORS-релей запущен на http://localhost:${server.port}`);
console.log(`[relay] upstream-прокси: ${UPSTREAM || "нет (прямое подключение)"}`);
console.log(`[relay] API-ключ из .env (P2P_API_KEY): ${SERVER_API_KEY ? "найден" : "не задан"}`);
console.log(`[relay] Добавьте в настройки терминала (режим «через прокси»):`);
console.log(`          http://localhost:${server.port}/`);
console.log(`[relay] Проверка: http://localhost:${server.port}/health`);
console.log(`[relay] Ctrl+C — остановить\n`);


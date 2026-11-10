#!/usr/bin/env bun
/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */
/**
 * Кроссплатформенная сборка.
 *
 * Раньше в package.json стояло `next build && cp -r .next/static … && cp -r public …`.
 * На Windows такого `cp` нет (а тот, что есть, не понимает `-r`), поэтому
 * `bun run build` падал уже после успешной компиляции: standalone-сервер
 * оставался без статики и без public/ — приложение поднималось, но не отдавало
 * ни JS-чанков, ни иконок, ни Service Worker.
 *
 * Здесь те же шаги выполняются на TypeScript через node:fs — одинаково на
 * Windows, Linux и macOS.
 *
 *   bun scripts/build.ts            — standalone-сборка (по умолчанию)
 *   bun scripts/build.ts --static   — статический экспорт в out/
 */
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const staticExport = process.argv.includes("--static");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runNextBuild(): Promise<void> {
  const proc = Bun.spawn(["bunx", "next", "build"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      ...(staticExport ? { NEXT_OUTPUT: "export" } : {}),
    },
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`\n[build] next build завершился с кодом ${code}`);
    process.exit(code);
  }
}

/** Копирование поверх существующего каталога (аналог `cp -r`). */
async function copyInto(from: string, to: string): Promise<void> {
  if (!(await exists(from))) return;
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true, force: true });
}

async function main(): Promise<void> {
  await runNextBuild();

  if (staticExport) {
    const out = join(ROOT, "out");
    if (!(await exists(out))) {
      console.error("[build] next build не создал out/ — проверьте NEXT_OUTPUT=export");
      process.exit(1);
    }
    console.log("\n[build] статический экспорт готов: out/");
    return;
  }

  const standalone = join(ROOT, ".next", "standalone");
  if (!(await exists(standalone))) {
    console.error("[build] нет .next/standalone — проверьте output: 'standalone' в next.config.ts");
    process.exit(1);
  }

  // статика и public нужны серверу рядом с server.js
  await rm(join(standalone, ".next", "static"), { recursive: true, force: true });
  await copyInto(join(ROOT, ".next", "static"), join(standalone, ".next", "static"));
  await copyInto(join(ROOT, "public"), join(standalone, "public"));

  if (!existsSync(join(standalone, "server.js"))) {
    console.error("[build] .next/standalone/server.js отсутствует — сборка неполная");
    process.exit(1);
  }
  console.log("\n[build] standalone готов: .next/standalone (запуск: bun run start)");
}

await main();

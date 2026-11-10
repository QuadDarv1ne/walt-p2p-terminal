/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 */
export function formatMoney(value: number | null | undefined, maxFrac = 2, minFrac = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const max = Math.max(0, Math.min(Math.round(maxFrac), 20));
  const min = Math.max(0, Math.min(Math.round(minFrac), max));
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value);
}

/**
 * Лимиты объявления в человеческом виде.
 *
 * API и демо-генератор отдают `maxAmount = 0` в значении «без максимума».
 * В таблице это печаталось как «1 000 – 0 RUB» — цифры, которая читается как
 * ошибка данных и вводит в заблуждение при выборе объявления.
 */
export function formatLimits(
  minAmount: number | null | undefined,
  maxAmount: number | null | undefined,
  fiat: string,
): string {
  const hasMin = typeof minAmount === "number" && Number.isFinite(minAmount) && minAmount > 0;
  const hasMax = typeof maxAmount === "number" && Number.isFinite(maxAmount) && maxAmount > 0;
  if (!hasMin && !hasMax) return `без ограничений ${fiat}`;
  if (hasMin && hasMax) {
    return `${formatMoney(minAmount, 0)} – ${formatMoney(maxAmount, 0)} ${fiat}`;
  }
  return hasMin ? `от ${formatMoney(minAmount, 0)} ${fiat}` : `до ${formatMoney(maxAmount, 0)} ${fiat}`;
}

export function formatPrice(value: number | null | undefined): string {  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const frac = value >= 1000 ? 2 : value >= 10 ? 2 : value >= 1 ? 4 : 6;
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Math.min(2, frac),
    maximumFractionDigits: frac,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  // типографский минус вместо ASCII: в интерфейсе рядом с числами он читается
  // ровнее и не «прыгает» по ширине в карточках и таблицах
  const sign = value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits).replace(".", ",")}%`;
}

export function formatSignedPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits).replace(".", ",")}%`;
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 5) return "только что";
  if (sec < 60) return `${sec} с назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Экранирование одной ячейки CSV.
 *
 * Разделитель — «;», поэтому ячейку с точкой с запятой, кавычкой или переводом
 * строки нужно заключать в кавычки, а не «чинить» заменой символа: раньше
 * `;` внутри значения превращался в `,` и данные тихо искажались (список
 * способов оплаты «Сбербанк; Т-Банк» уезжал в файл как «Сбербанк, Т-Банк»).
 */
function csvCell(cell: string | number): string {
  if (typeof cell === "number") {
    // Excel с русской локалью ждёт десятичную запятую
    return String(cell).replace(".", ",");
  }
  const s = String(cell);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Копирование в буфер обмена с внятным результатом.
 *
 * `navigator.clipboard` существует только в безопасном контексте: при открытии
 * терминала по IP локальной сети (http://192.168.x.x) его нет вовсе, и прямой
 * вызов `navigator.clipboard.writeText(...)` бросал TypeError прямо в обработчике
 * клика — пользователь не получал ни копии, ни объяснения. Здесь пробуем
 * современный API, затем старый execCommand, и честно возвращаем false.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* нет разрешения или API недоступен — пробуем fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // вне экрана, но всё ещё фокусируемый: иначе selection не создаётся
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Экспорт массива объектов в CSV (Excel-совместимый, разделитель «;», десятичная запятая) */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const lines = [headers.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))];
  // BOM нужен, иначе Excel открывает кириллицу как mojibake
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Firefox игнорирует click() у ссылки, которой нет в документе
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // отзывать URL сразу нельзя: браузер ещё не начал скачивание и получит пустой файл
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

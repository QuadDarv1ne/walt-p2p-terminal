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

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const frac = value >= 1000 ? 2 : value >= 10 ? 2 : value >= 1 ? 4 : 6;
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Math.min(2, frac),
    maximumFractionDigits: frac,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits).replace(".", ",")}%`;
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
  return `${hours} ч назад`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Экспорт массива объектов в CSV (Excel-совместимый, разделитель «;», десятичная запятая) */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escapeCell = (cell: string | number) => {
    const s = String(cell).replace(/;/g, ",");
    return /["\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCell = (cell: string | number) =>
    typeof cell === "number" ? String(cell).replace(".", ",") : escapeCell(cell);

  const lines = [headers.map(toCell).join(";"), ...rows.map((r) => r.map(toCell).join(";"))];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

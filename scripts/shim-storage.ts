/**
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия CC BY-SA 4.0.
 *
 * Заглушка localStorage для запуска автотестов в bun (в среде Node/bun её нет).
 * Без неё persist-middleware zustand на каждое изменение стора печатает
 * «Unable to update item ... storage is currently unavailable», и полезный
 * вывод тестов тонет в предупреждениях.
 *
 * Импортируется ПЕРВЫМ в scripts/test-logic.ts: модули ES исполняются в порядке
 * объявления импортов, поэтому заглушка успевает появиться до создания стора.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
if (typeof g.localStorage === "undefined") g.localStorage = new MemoryStorage();
if (typeof g.sessionStorage === "undefined") g.sessionStorage = new MemoryStorage();

export {};

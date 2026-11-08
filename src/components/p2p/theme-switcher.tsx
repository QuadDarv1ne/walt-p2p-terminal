"use client";

import { useTheme } from "next-themes";
import { Check, Cloud, Flame, Moon, Palette, Sun, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMounted } from "@/hooks/use-mounted";

interface ThemeOption {
  value: string;
  label: string;
  icon: LucideIcon;
  /** цвета-превью: фон, акцент, текст — как в теме */
  preview: { bg: string; accent: string; text: string };
}

/**
 * Порядок и палитра совпадают с CSS-переменными в globals.css —
 * превью показывает реальные цвета темы, а не произвольные.
 */
const THEMES: ThemeOption[] = [
  {
    value: "light",
    label: "Светлая",
    icon: Sun,
    preview: { bg: "oklch(0.985 0.002 160)", accent: "oklch(0.55 0.13 163)", text: "oklch(0.16 0.01 165)" },
  },
  {
    value: "dark",
    label: "Тёмная",
    icon: Moon,
    preview: { bg: "oklch(0.14 0.006 165)", accent: "oklch(0.76 0.17 163)", text: "oklch(0.94 0.005 165)" },
  },
  {
    value: "orange",
    label: "Оранжевая",
    icon: Flame,
    preview: { bg: "oklch(0.16 0.018 55)", accent: "oklch(0.72 0.17 50)", text: "oklch(0.94 0.025 65)" },
  },
  {
    value: "purple",
    label: "Фиолетовая",
    icon: Sparkles,
    preview: { bg: "oklch(0.15 0.02 300)", accent: "oklch(0.72 0.18 310)", text: "oklch(0.94 0.01 300)" },
  },
  {
    value: "sky",
    label: "Небесная",
    icon: Cloud,
    preview: { bg: "oklch(0.975 0.012 240)", accent: "oklch(0.58 0.16 230)", text: "oklch(0.20 0.03 240)" },
  },
];

function ThemeSwatch({ preview }: { preview: ThemeOption["preview"] }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/60"
      style={{ background: preview.bg }}
      aria-hidden
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: preview.accent }} />
    </span>
  );
}

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  // до гидрации неизвестно, какая тема применится, — показываем заглушку
  if (!mounted) return <div className="h-9 w-9" />;

  const active = THEMES.find((t) => t.value === theme) ?? THEMES[1];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Тема оформления: ${active.label}`}
          title="Тема оформления"
        >
          <ActiveIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Palette className="h-3.5 w-3.5" />
          Тема оформления
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map((t) => {
          const Icon = t.icon;
          return (
            <DropdownMenuItem
              key={t.value}
              onSelect={() => setTheme(t.value)}
              className="gap-2.5"
            >
              <ThemeSwatch preview={t.preview} />
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">{t.label}</span>
              {theme === t.value && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

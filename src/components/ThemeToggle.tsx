"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY, type ThemeChoice } from "@/lib/theme";

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}
function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch { return "system"; }
}
function choose(v: ThemeChoice) {
  try {
    if (v === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, v);
  } catch { /* storage blocked: still apply for this page */ }
  const apply = (window as { __applyTheme?: () => void }).__applyTheme;
  if (apply) apply();
  else document.documentElement.classList.toggle("dark", v === "dark" || (v === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
  listeners.forEach((l) => l());
}

const ICONS: Record<ThemeChoice, React.ReactNode> = {
  light: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />,
  system: <path d="M4 5h16v11H4zM9 20h6m-3-4v4" />,
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
};

export function ThemeToggle({ labels }: { labels: Record<ThemeChoice, string> }) {
  const current = useSyncExternalStore(subscribe, read, () => "system" as ThemeChoice);
  return (
    <div role="radiogroup" aria-label={labels.system} className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
      {(["light", "system", "dark"] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={current === v} title={labels[v]} aria-label={labels[v]}
          onClick={() => choose(v)}
          className={`px-2 py-1 ${current === v ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[v]}
          </svg>
        </button>
      ))}
    </div>
  );
}

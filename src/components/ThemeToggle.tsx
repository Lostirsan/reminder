"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY, type ThemeChoice } from "@/lib/theme";

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}
/** The theme on screen (the init script already resolved the first-visit default). */
function read(): ThemeChoice {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
function choose(v: ThemeChoice) {
  try { localStorage.setItem(THEME_KEY, v); } catch { /* storage blocked: still apply for this page */ }
  document.documentElement.classList.toggle("dark", v === "dark");
  listeners.forEach((l) => l());
}

const ICONS: Record<ThemeChoice, React.ReactNode> = {
  light: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />,
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
};

export function ThemeToggle({ labels }: { labels: Record<ThemeChoice, string> & { group: string } }) {
  const current = useSyncExternalStore(subscribe, read, () => null);
  return (
    <div role="radiogroup" aria-label={labels.group} className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
      {(["light", "dark"] as const).map((v) => (
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

"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ayuda_theme";

/**
 * The theme is state owned outside React — `localStorage` and the OS's
 * `prefers-color-scheme` — so it's read through `useSyncExternalStore`
 * rather than mirrored into a `useState` from an effect. That also gives the
 * hydration answer for free: React renders `getServerSnapshot`'s value first
 * to match the server output, then re-renders with the real client value
 * right after, with no manual "mounted" flag to get wrong.
 */
let listeners: Array<() => void> = [];
function notify() {
  for (const l of listeners) l();
}

function subscribe(callback: () => void) {
  listeners.push(callback);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", callback);
  return () => {
    listeners = listeners.filter((l) => l !== callback);
    mq.removeEventListener("change", callback);
  };
}

/** What's actually showing right now: a stored choice wins, otherwise the device's own preference. */
function getSnapshot(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** No `localStorage` on the server: matches the light-mode default in globals.css. */
function getServerSnapshot(): boolean {
  return false;
}

function setTheme(next: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing or a full quota: the toggle still works for this
    // page load, it just won't be remembered next visit.
  }
  // `storage` events only reach OTHER tabs; this tab has to be told directly.
  notify();
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.3" />
      <path d="M12 2.5v2.3M12 19.2v2.3M4.5 4.5l1.6 1.6M17.9 17.9l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.5 19.5l1.6-1.6M17.9 6.1l1.6-1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

/**
 * Overrides the device's `prefers-color-scheme` with an explicit choice.
 *
 * The device is still the default (see globals.css): this only writes
 * `data-theme` on `<html>` when a person actively picks a side, and reads it
 * back from localStorage next visit.
 *
 * The icon shows the theme that's actually active, which means it can't be
 * known during the server render — localStorage doesn't exist there — so it
 * renders the sun (the light-mode default) for that first pass and corrects
 * to the real value the instant React can read the client's own state.
 */
export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className="border-official-text/40 hover:bg-black/10 grid h-11 w-11 shrink-0 place-items-center border"
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

/**
 * Runs before hydration (see the plain `<script>` tag in layout.tsx) so a
 * remembered choice applies before first paint instead of flashing the
 * device's own preference first.
 */
export const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem("${STORAGE_KEY}");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
`;

import { useEffect, useState } from "react";

/** Prototype state never shares keys or write endpoints with the live app. */
export function usePrototypeState<T>(key: string, initial: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(`tankapp-concept:${key}`) ?? "null");
      return valid(stored) ? stored : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(`tankapp-concept:${key}`, JSON.stringify(value)); } catch { /* Private mode: session state still works. */ }
  }, [key, value]);
  return [value, setValue] as const;
}
export type Toast = { text: string; undo?: () => void };
export const experiments = ["Wochenprognose", "Umweg-Rechner", "Smarter Preisalarm"] as const;
export function profileSavings(liters: number, patience: number) {
  const filling = liters * [0, 0.035, 0.08][patience];
  return { filling, annual: filling * 24 };
}
export function routeUrl(street: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${street}, München`)}&travelmode=driving`;
}

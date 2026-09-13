// C8-Rest: Pull-to-Refresh abschalten, solange eine Fläche eigenen
// Zieh-Gesten folgt (Karte, Slider). `overscroll-behavior` greift nur an
// Scroll-Containern, deshalb setzt dieses Modul die Klasse `ptr-off` am
// Wurzelelement — nur während der Berührung.
export const PTR_OFF_CLASS = "ptr-off";

export function setPtrOff(on: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(PTR_OFF_CLASS, on);
}

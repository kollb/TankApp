// V3 (GUI-TEXT-BEFUND): ein Mitteilungs-Register mit Rang.
//
// Vorher konnte die Root bis zu acht Blöcke über den Inhalt setzen —
// Rückmeldung, Datenstand, Installationshinweis, Update, Offline-Queue,
// „Browser ist offline“, E5-Hinweis und Verbindungsproblem — jede Zeile mit
// eigener Dauer und ohne Ordnung. Auf 390 px war das der halbe erste
// Bildschirm, bevor irgendetwas aus „Jetzt“ zu sehen war.
//
// Deshalb entscheidet hier ein Rang, welche Meldung gewinnt:
//   error  > warn  > hint  > success
// (je höher, desto wichtiger). Gleichrangige Meldungen werden aneinandergereiht,
// sodass nie mehr als ein Block über dem Inhalt steht. Die übrigen Meldungen
// sind nicht verschwunden: ihre Quellen bleiben in den Bereichen sichtbar
// (z. B. der Datenstand in der Frische-Zeile), nur der Banner-Stapel ist weg.

import {
  NOTICE_NORMAL_MS,
  NOTICE_RANK,
  noticeRankKey,
  type NoticeRank,
} from "../data";

/** Eine eingehende Meldung — die Felder, die der Banner zum Reden braucht. */
export type NoticeItem = {
  /** Eindeutig je Quelle, damit dieselbe Meldung nicht doppelt einfließt. */
  id: string;
  rank: NoticeRank;
  text: string;
  /** Zweitzeile (z. B. „Nichts ist verloren …“) — optional. */
  note?: string | null;
  /** Optionaler Knopf („Log ansehen“, „Einrichtung ansehen“ …). */
  actionLabel?: string | null;
  onAction?: () => void;
};

export type NoticesResult = {
  rank: NoticeRank;
  text: string;
  note: string | null;
  /** true, wenn gleichrangige Meldungen zu einer Zeile zusammengezogen wurden. */
  merged: boolean;
  /** Der Handlungs-Knopf der wichtigsten Meldung (falls vorhanden). */
  actionLabel: string | null;
  onAction: (() => void) | null;
};

/**
 * Pure Reduktion des Registers:
 *   1. nur sichtbare Einträge (mindestens ein Wort),
 *   2. die höchste Rangstufe gewinnt,
 *   3. Gleichrangige werden aneinandergereiht („ · “), niemals gestapelt,
 *   4. bei genau einem Eintrag bleibt dessen Text unverändert.
 */
export function reduceNotices(items: NoticeItem[]): NoticesResult | null {
  const visible = items.filter((item) => item.text.trim().length > 0);
  if (visible.length === 0) return null;

  const top = Math.max(...visible.map((item) => noticeRankKey(item.rank)));
  const topItems = visible.filter((item) => noticeRankKey(item.rank) === top);

  return {
    rank: topItems[0].rank,
    text: topItems.map((item) => item.text).join(" · "),
    note: topItems
      .map((item) => item.note)
      .filter((note): note is string => typeof note === "string" && note.length > 0)
      .join(" · ") || null,
    merged: topItems.length > 1,
    actionLabel: topItems.find((item) => item.actionLabel)?.actionLabel ?? null,
    onAction: topItems.find((item) => item.actionLabel)?.onAction ?? null,
  };
}

/** Der Rang, den eine eingehende Meldung tatsächlich beansprucht. */
export function noticeOrder(rank: NoticeRank): number {
  return noticeRankKey(rank);
}

/** Gemeinsame Dauer für zeitbegrenzte Rückmeldungen (DoD V3: 6 Sekunden). */
export const NOTICE_DURATION_MS = NOTICE_NORMAL_MS;

/**
 * Anzeige-Dauer je Rang. Nur `error` bleibt stehen — eine Störung darf sich
 * nicht von selbst wegblenden, während die Ursache noch besteht.
 */
export function noticeDurationMs(rank: NoticeRank): number | null {
  return rank === "error" ? null : NOTICE_DURATION_MS;
}

/** Die drei Ränge, die ein Fortschritts-Feedback grundsätzlich sein kann. */
export const NOTICE_RANKS: readonly NoticeRank[] = ["error", "warn", "hint", "success"];

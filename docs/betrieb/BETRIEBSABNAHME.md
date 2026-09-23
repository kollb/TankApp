# Betriebsabnahme NAS/Pi — Messprotokoll und Messrezept

> Stand: 22.09.2026 · Aufgabe A21-B5.4 (Issue #214) · Verbindliche Messlatte,
> Handgriffe und Protokollvorlage für Latenz, Pollkadenz und Recovery/Restore
>
> **Status: DIESE ABNAHME IST NICHT DURCHGEFÜHRT.** Ohne Zugang zu NAS und
> Raspberry Pi (LAN/Shell) gibt es keine Messung — *fehlender Zugang ist ein
> Blocker, kein erfolgreicher Test*. Diese Doku und das Tooling bereiten den
> Lauf vor; die Zeilen im Protokoll bleiben offen, bis er stattgefunden hat
> (docs/planung/LUECKEN.md).

## Inhaltsverzeichnis

- [Messlatte](#messlatte)
- [Voraussetzungen](#voraussetzungen)
- [Messrezept](#messrezept)
- [Protokollvorlage](#protokollvorlage)
- [Blocker und Grenzen](#blocker-und-grenzen)

## Messlatte

Vor dem Lauf festgelegt (`data-tools/ops_acceptance.py:ACCEPTANCE_TARGETS`):

| Strecke | Ziel | Quelle des Ziels |
|---|---|---|
| Latenz Kern-Endpunkte (`/api/v1/health`, `/api/v1/overview`, `/api/v1/decide`) | p95 ≤ 300 ms im LAN | Audit M3.8 (Overview p95 2,00 s als Untergrenze des Problems) |
| Pollkadenz Sammler | 300 s je Stadtset, Fenster 06:00–24:00, Toleranz 20 % | `data-tools/collect_prices.py` (1 Poll / 5 min, Token-Bucket) |
| RPO | ≤ 30 min | Betriebsziel Backup (`ops/nas/backup.sh`) |
| RTO | ≤ 240 min | Betriebsziel Restore (`ops/nas/restore.sh`) |
| Restore-Verifikation | fachlich bestanden | `ops/nas/verify_restore.py` (A21-B3.2) |

## Voraussetzungen

1. Arbeitsrechner im selben LAN wie das NAS; URL der App (Standard-Port aus
   `ops/nas/app/compose.yml`).
2. Shell auf dem NAS-Host (Poll-Log-Export, Restore-Handgriffe) und am Pi
   (Pollkadenz-Quelle, siehe `data-tools/polling_plan.py`).
3. Wartungsfenster: Der Restore-Test schreibt in eine **Test-Runtime**, nie in
   den Live-Bestand (Schema: `ops/nas/restore.sh` + Verifizierer).
4. Stopuhr (RPO/RTO) und ein Notizblatt für Abweichungen — beides fließt ins
   Protokoll ein, nichts wird „aufgerundet“.

## Messrezept

Alle Befehle aus dem Repository-Root; das Tool ist Standardbibliothek und
läuft auch mit dem python3 des NAS-Hosts.

1. **Latenz** (drei Durchgänge, je 30 Requests nach 3 Warm-up):

   ```bash
   .venv/bin/python data-tools/ops_acceptance.py \
       --base-url http://<nas-host>:<port> --samples 30 \
       --out results/ops-acceptance
   ```

   p50/p95/p99 je Endpunkt; Abweichungen (andere WLAN-Hops, parallel laufende
   Modell-Jobs) notieren — der Messlauf soll im Ruhezustand des Systems
   stattfinden und zusätzlich im Modell-Job-Betrieb wiederholt werden.
2. **Pollkadenz**: Zeitstempel-Export des Sammlers (CSV/JSONL mit
   `fetched_at`/`timestamp`, z. B. aus dem Ringpuffer `data/poll/` auf dem Pi)
   abziehen und mit `--poll-log <datei>` nachreichen. Berücksichtigt werden
   nur Lücken im Fenster 06:00–24:00 ohne Mitternachtsübertritt; die nächtliche
   Schließung ist Betriebskonzept.
3. **Recovery/Restore** (Handgriffe, in dieser Reihenfolge):
   a. Backup laufen lassen (`ops/nas/backup.sh`), Erfolgsmanifest prüfen;
      **Zeitpunkt des letzten vollständigen Backups = RPO-Nullpunkt**.
   b. Test-Runtime per `ops/nas/restore.sh` einspielen; Stopuhr start.
   c. `python3 ops/nas/verify_restore.py --runtime <pfad> --compare <quelle>`
      muss fachlich bestehen (Belegzahlen, Summen, Stornos, Archiv, Revisionen).
   d. Stopuhr stop = RTO; Datenverlust zwischen RPO-Nullpunkt und Ausfall
      auswerten = RPO. Beide Zeiten in Minuten ins Protokoll eintragen.
4. **Protokoll vervollständigen**: fehlende Strecken bleiben als Blocker
   stehen (Tool-Exit 2 = mindestens eine Marge nicht erfüllt/offen). Erst ein
   vollständig gemessenes Protokoll darf insgesamt „bestanden“ lauten.

## Protokollvorlage

Das Tool schreibt `report.json` (maschinenlesbar) und `report.md` (Lesefassung)
mit fester Struktur: Latenz-Tabelle, Pollkadenz-Abschnitt, RPO/RTO-Abschnitt,
Einzurteilen und Gesamturteil. Regeln:

- „nicht gemessen“ ist **nie** „erfüllt“ — das Tool kennzeichnet solche
  Strecken als offen und hält den Satz *fehlender Zugang ist ein Blocker,
  kein erfolgreicher Test* im Bericht fest.
- Zahlen ohne Einheit sind unzulässig (ms, s, min); Prozentwerte nur über die
  Formatter der GUI-Regeln, hier roh mit Einheit.
- Jeder Lauf bekommt Datum, Host und Betriebszustand (Ruhe/Modell-Job) als
  Kopfzeile ins `report.md`.

## Blocker und Grenzen

- **Hardware-/Feldabnahme offen** (Blocker): kein Zugang zu NAS/Pi in dieser
  Arbeitsumgebung — weder Latenz noch Pollkadenz noch RPO/RTO sind gemessen.
  Der Befund „Overview p95 2,00 s“ aus dem Audit M3.8 bleibt die einzige
  bekannte Messung und verfehlt die Messlatte deutlich.
- Keine Docker-/Lastabnahme: Container-Start, Speicher-/Threadbudgets und
  Verhalten unter Modell-Job-Last sind Teil derselben Feldabnahme
  (`ops/nas/measure-phase-b.sh` misst die Phase-B-Ressourcen getrennt).
- Der Restore-Verifizierer prüft die **Fachlichkeit** des wiederhergestellten
  Laufzeitstands; die datenbankkonsistente Influx-Sicherung bleibt separat
  offen (docs/planung/LUECKEN.md).

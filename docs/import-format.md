# Import format: Hours Tracker CSV

Settings → Import Data (both clients) imports a CSV export from the [Hours
Tracker](https://www.hourstrackerapp.com/) app as Clocker jobs, shifts, and breaks. This
doc is the exact column reference the parser
(`shared/src/importFormat.ts`) implements — the in-app screen shows the same header row
inline (`HOURS_TRACKER_CSV_HEADER`), so the two can't drift apart.

## Expected header row

```
Job,Clocked In,Clocked Out,Duration,Hourly Rate,Earnings,Comment,Tags,Breaks,Adjustments,Mileage
```

Only three columns are actually required — **`Job`**, **`Clocked In`**, **`Clocked
Out`** — matched by name, not position, so a harmless future reordering or an added
column in a newer Hours Tracker export still works. Every other column is used when
present and silently skipped when it isn't.

## Column-by-column

| Column | Used for | Notes |
| --- | --- | --- |
| `Job` | The job a shift belongs to | A job whose name **exactly** matches (case-sensitive) one you already have gets its shifts added to it. Any other name creates a new job — see "New jobs" below. |
| `Clocked In` | Shift clock-in | Format: `M/D/YYYY h:mm AM/PM`, e.g. `3/17/2026 3:55 PM`. Parsed explicitly (not handed to the platform's ambient date parser), since that isn't guaranteed to agree between web's V8 and mobile's Hermes for this exact string shape. |
| `Clocked Out` | Shift clock-out | Same format as `Clocked In`. A row where this isn't after `Clocked In` is skipped. |
| `Duration` | *(not imported)* | Redundant with `Clocked In`/`Clocked Out` (and, once breaks are subtracted, doesn't always agree with them to the minute) — Clocker derives worked time itself from the actual clock-in/out/break timestamps rather than trusting a precomputed total. |
| `Hourly Rate` | A new job's starting rate | Only used when the `Job` value doesn't already exist in Clocker. Across that job's own rows, whichever rate value appears most often becomes the new job's rate, effective from that job's earliest imported shift (so every imported shift for it resolves a real rate, not $0). An **existing** job's own rate configuration is never touched by import. |
| `Earnings` | *(not imported)* | Derived from `Duration` × `Hourly Rate` on Hours Tracker's side; Clocker computes pay itself from the rate history it just set up. |
| `Comment` | Shift notes | Copied verbatim into Clocker's shift notes field (its only free-text field). |
| `Tags` | Folded into shift notes | Appended as a `Tags: ...` line — Clocker has no separate tags field. |
| `Breaks` | Break start/end times | e.g. `0.25h (12:45 PM to 1:00 PM);0.17h (1:50 PM to 2:00 PM)` — semicolon-separated, each one a time-of-day range in parentheses. The leading `<duration>h` prefix is ignored (it's redundant with, and occasionally rounds differently than, the times themselves); the actual break start/end come from the times. A break's date is inferred from whichever day (the shift's start day, or the next one) actually places it inside the shift — needed because both a shift and a break within it can genuinely cross midnight. |
| `Adjustments` | Folded into shift notes | Appended as an `Adjustment (not applied to pay): ...` line — Hours Tracker's manual pay adjustments have no Clocker equivalent, so the value is preserved as a note rather than silently dropped, but it does **not** change the computed pay the way it did in Hours Tracker. |
| `Mileage` | Folded into shift notes | Appended as a `Mileage: ...` line, only when the value is a number greater than 0 — Clocker has no mileage field or calculation. |

## New jobs

A CSV row whose `Job` value doesn't exactly match an existing job creates one, with:

- **Color**: chosen automatically, cycling through the same default palette the Jobs tab
  itself offers (`#1d4ed8`, `#b91c1c`, `#16a34a`, `#d97706`, `#7c3aed`, `#0891b2`) — not
  configurable from the import screen; rename or recolor the job afterward like any other.
- **Rate**: the most common `Hourly Rate` seen across that job's rows in the file (ties
  broken by whichever value was seen first), as a single "Standard" rate tier effective
  from that job's earliest imported shift. If a job's rate genuinely changed over the
  imported period, only one rate is captured — add the others as new rate-tier versions
  by hand afterward (Settings → Backups doesn't touch this; the job's own detail screen
  does, same as setting up rates manually always has).
- **Everything else** (overtime, rounding, timesheet period, weekly-hours target, etc.)
  starts at Clocker's normal defaults, same as creating the job by hand.

## Duplicate safety

A row is skipped if a shift already exists for its resolved job with the **exact same
clock-in timestamp** (import doesn't compare `Clocked Out` or anything else). This makes
re-importing the same file — or a newer export that overlaps a previous import — safe: it
adds only what's actually new. It does not detect a duplicate that was entered *by hand*
with a slightly different clock-in time than the CSV row for the same real shift; only
exact clock-in matches are caught.

## What isn't imported

- `Duration` and `Earnings` (derived figures — see the table above).
- Rate history beyond one rate per new job (see "New jobs" above).
- Anything about a job that CSV export doesn't carry: overtime settings, rounding,
  timesheet period/submission preferences, a weekly-hours target, assigned managers.

## Where the code lives

- **Parsing** (CSV → structured rows, pure, no client dependencies):
  `shared/src/importFormat.ts` (`parseHoursTrackerCsv`, `buildImportPreview`,
  `groupRowsByJob`).
- **Writing** (matching/creating jobs, inserting shifts/breaks — client-specific since it
  calls each client's own mutation functions): `web/src/lib/importHoursTracker.ts` (one
  batched `pushChanges` call, since web has no local database and would otherwise trigger
  a network round-trip *and* a full re-pull per row) and
  `app/src/lib/importHoursTracker.ts` (a sequential loop through the normal
  `clockIn`/`clockOut`/`startBreak`/`endBreak` SQLite functions, fast enough locally that
  batching isn't needed, and it gets the same outbox bookkeeping every other write already
  gets for free).
- **UI**: `{app,web}/src/screens/ImportScreen.tsx`, reachable from Settings → Import Data
  on both clients.

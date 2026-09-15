# User Guide

This guide is for anyone **using** Clocker — clocking in and out, tracking hours across
jobs, and sending timesheets. It assumes no technical background at all. If you're
looking for how to install, develop, or host Clocker instead, see
[the documentation index](./README.md) for the right guide.

Clocker works the same way whether you're using the phone app or the website — every
screen described below exists in both, doing the same thing. A few small differences
between phone and browser are called out where they come up (for example, how you send
an email).

## Contents

- [Getting started](#getting-started)
- [Signing in](#signing-in)
- [Finding your way around](#finding-your-way-around)
- [Setting up a job](#setting-up-a-job)
- [Clocking in and out](#clocking-in-and-out)
- [Clocking in and out automatically by location](#clocking-in-and-out-automatically-by-location)
- [Taking breaks](#taking-breaks)
- [Adding a note to a shift](#adding-a-note-to-a-shift)
- [Recording miles driven](#recording-miles-driven)
- [Getting reminded if you forget to clock out](#getting-reminded-if-you-forget-to-clock-out)
- [Weekly hours targets](#weekly-hours-targets)
- [Overtime](#overtime)
- [Reviewing and fixing past shifts (History)](#reviewing-and-fixing-past-shifts-history)
- [Timesheets: getting paid](#timesheets-getting-paid)
- [Invoicing a client](#invoicing-a-client)
- [Exporting your hours](#exporting-your-hours)
- [Settings](#settings)
- [Backups (if you run your own Clocker server)](#backups-if-you-run-your-own-clocker-server)
- [Getting help inside the app](#getting-help-inside-the-app)
- [Frequently asked questions](#frequently-asked-questions)

## Getting started

**On your phone**: open the Clocker app (installed by whoever set it up for you — ask them
for the installation link if you don't have it yet).

**In a web browser**: go to the web address your Clocker server is hosted at (again, ask
whoever set it up if you don't know it). No installation needed — it works in any modern
browser, on a computer, phone, or tablet.

Both are the same app with the same features — use whichever is more convenient for you at
the moment. Anything you do on one shows up on the other within moments, as long as you're
connected to the internet (see [Working offline](#working-offline) below for what happens
without one).

## Signing in

The first time you open Clocker, you'll see a sign-in screen.

- **Already have an account?** Enter your email and password, then tap/click **Sign In**.
- **New here?** Tap **Need an account? Register** (web) or the equivalent link on the
  phone app, then enter an email address and a password (at least 8 characters). You'll be
  asked to answer a simple math question — this just proves you're a real person, not a
  robot trying to create accounts automatically.
- **Remember me** — leave this switched on (the default) so you stay signed in. Turn it
  off only on a shared or public device, where you want to be signed out automatically
  after a day.

Your Clocker account is separate on each *server* — if you sign in through the phone app
and the website but they're pointed at different Clocker servers, you'll need to register
on each one separately. Ask whoever set up your Clocker if you're not sure.

## Finding your way around

Across the bottom of the screen (phone) or the bottom of the page (web), you'll find five
tabs:

| Tab | What it's for |
|---|---|
| **Clock** | Clock in and out, start and end breaks — the screen you'll use most, every day |
| **Jobs** | Add, edit, or archive the jobs you track time for |
| **History** | Look back at past shifts, fix mistakes, delete an entry |
| **Timesheets** | Review a pay period and email it to whoever needs it |
| **Export** | Download or email a CSV/spreadsheet of your hours for any date range |

There's also a menu (☰, top-right of the screen) with two more destinations:

- **Settings** — appearance, your account, and (if you run your own server) backups
- **Help** — a short, in-app reference for every feature, written for quick lookup while
  you're using the app

## Setting up a job

A "job" in Clocker is anything you want to track hours against separately — a workplace, a
specific role, a client if you freelance, and so on. You need at least one job before you
can clock in.

1. Open the **Jobs** tab.
2. Under "Add a job," type a name (e.g. "Coffee Shop" or "Warehouse — Weekends").
3. Optionally enter an hourly rate — this is what Clocker uses to calculate how much
   you've earned. You can leave it blank and add it later, or if your pay varies (see
   [more than one pay rate](#more-than-one-pay-rate-for-one-job) below).
4. Pick a color — this is just a visual label to tell jobs apart at a glance in History and
   on the Clock screen; it has no effect on anything else.
5. Tap/click **Add Job**.

Your new job now appears in the list below, and it's ready to clock into.

**To edit a job later** — its name, color, pay rate, or any of the more advanced settings
below — tap/click on it in the Jobs list.

**To stop seeing a job you no longer use**, without losing its history: tap **Archive**
next to it. An archived job disappears from the Clock screen and from job pickers
elsewhere, but its past shifts stay exactly where they are in History, Timesheets, and
Export. Tap **Show Archived Jobs** at the top of the Jobs tab to find it again, and
**Unarchive** if you need to clock into it again.

**To permanently remove a job**, tap **Delete**. Its recorded shifts stay in your history
(they aren't deleted with it), but you won't be able to clock into that job again. This
can't be undone — archiving is almost always the better choice if you're not sure.

### More than one pay rate for one job

Some jobs pay differently depending on what you're doing — a "Standard" rate and a
"Holiday" rate, for example. Open the job's settings and look for the rate section:

1. Add a new rate tier (give it a name, like "Holiday").
2. Set its hourly rate.

The next time you clock in to that job, if it has more than one rate you'll be asked which
one applies for that shift — a job with only one rate never asks, so most jobs never need
to think about this at all.

**Changing a rate never rewrites history.** If you give yourself a raise, everything you
worked *before* the raise still shows the old rate; only shifts from the raise date
forward use the new one. You can even backdate a rate change — Clocker keeps a full
history of every rate a job has ever had and when each one started applying.

### Weekly overtime

If your job automatically pays extra past a certain number of hours in a week (for
example, time-and-a-half after 40 hours), you can set that up once and Clocker applies it
automatically to every future shift:

1. Open the job's settings.
2. Turn on weekly overtime.
3. Enter the weekly hours threshold (e.g. `40`) and the multiplier (e.g. `1.5` for
   time-and-a-half).

Clocker then automatically calculates, for every week, how many of that job's hours were
regular and how many were overtime — including splitting a single shift across the
boundary if it's the one that pushes you over. You don't have to do anything differently
day to day; this only affects the pay totals shown in History, Timesheets, and Export.

This is separate from the per-shift overtime checkbox described in [Overtime](#overtime)
below, which is for marking one specific shift as overtime by hand (for example, a
manager explicitly approved extra hours as overtime regardless of your weekly total).

### Rounding your time to the nearest few minutes

Some workplaces round punches to the nearest 15 minutes (or some other increment), the
way an old-fashioned time clock would. If yours does:

1. Open the job's settings.
2. Turn on time entry rounding.
3. Choose an increment (5, 10, 15, 20, 30, 60, or 120 minutes) and a direction — round up,
   round down, or round to the nearest.

This never changes the actual clock-in/clock-out time you recorded — only the hours used
for totals, pay, and exports are rounded. If you ever turn rounding off, your real,
unrounded times are still there, unaffected.

## Clocking in and out

Open the **Clock** tab.

- **To clock in**: tap the job you're starting, then tap **Clock In Now**. A timer starts
  immediately, counting up how long you've been on the clock.
- **To clock out**: tap **Clock Out** on that job's card. The timer stops and the shift is
  saved to your History.

**Forgot to clock in or out at the actual time?** Tap **Start At...** (before clocking in)
or **At...** next to Clock Out (while clocked in) to pick the real date and time instead of
using the current moment. This is the normal way to fix a forgotten punch — no need to
clock in now and edit it in History afterward, though you can always do that too (see
[Reviewing and fixing past shifts](#reviewing-and-fixing-past-shifts-history)).

**Clocked into the wrong job, or picked the wrong time by mistake?** Tap the small **✕**
on the job's card to cancel that clock-in entirely — no shift is recorded at all, as if it
never happened. This is different from clocking out immediately, which *does* create a
(very short) recorded shift.

**Working more than one job at the same time** (for example, two part-time jobs on
different schedules) is fine — clock into each one separately, and each gets its own card
on the Clock screen with its own timer, breaks, and clock-out. You can't clock into the
*same* job twice at once, though — clock out first if you need to correct something.

**On Android**, long-press the Clocker app icon on your home screen for a shortcut that
clocks you straight into whichever job you used most recently, without opening the app
first.

## Clocking in and out automatically by location

Available on the phone app only (a website can't run anything once you close the tab, so
there's nothing for it to do here). If you'd rather not tap Clock In/Clock Out by hand
every time, a job can be set up to notice when you arrive at or leave its location instead.

Open a job (**Jobs** tab → tap the job → **Location**), and:

1. **Set the job's location**, either by standing there and tapping **Use My Current
   Location**, or by tapping **Choose on Map** and dropping a pin anywhere. Pick how wide
   an area should count (100m/250m/500m/1000m) — wider is more forgiving of GPS drift,
   narrower avoids false triggers from a job site close to somewhere else you spend time.
2. Turn on **Location awareness**. This *prompts* you — arrive or leave, and Clocker asks
   "Clock in?"/"Clock out?" the next time you open the app (with a notification too, so
   you notice even before you open it). Nothing happens until you answer.
3. Optionally, turn on **Auto clock in/out** too (only available once Awareness is on).
   This skips the question and just does it, then shows a quick notification confirming
   what happened.

The first time you turn on Location awareness, your phone will ask for location
permission — say yes, and for the "Always Allow"/background option if you want this to
still work while the app is closed (with only "while using the app," it'll only notice
arrivals/departures while Clocker is actually open). Your phone's Settings app can always
revoke this later if you change your mind.

**A privacy note**: the only thing stored is the one location (and radius) you set for a
job — Clocker doesn't track or record everywhere you go, only whether you're inside or
outside that one area, and that check happens on your phone. That job location syncs
along with the rest of your job data, the same as its pay rate or color would.

## Taking breaks

While clocked in, each job's card has a **Start Break** button. Tap it when you step away,
and **End Break** when you're back. Break time is automatically subtracted from your
worked hours — you don't need to do any math.

The same **At...** trick from clocking in/out works here too, if you forgot to start or
end a break at the actual time.

## Adding a note to a shift

Sometimes you want to jot something down about a shift — what you worked on, why it ran
long, anything worth remembering later.

- **While still clocked in**: tap **Add note** on the job's card on the Clock screen, type
  your note, and save. If a note's already there, this shows the note itself instead of
  "Add note" — tap it again to edit.
- **After the fact**: open **History**, tap the shift, and edit its note there — see
  [Reviewing and fixing past shifts](#reviewing-and-fixing-past-shifts-history).

Some jobs are also set up to *ask* you for a note automatically right after you clock out
— if you'd like that for a job you manage, look for "Prompt for notes on clock out" in
that job's settings.

## Recording miles driven

Open a shift from **History** (or edit it right after clocking out) and enter a number in
**Miles driven** — it's optional, and there's no automatic GPS tracking involved, so
enter whatever your car or a map lookup tells you. It shows up on that shift, and gets
totaled per job on your Export/Timesheets output and on a generated invoice, right
alongside hours and pay.

## Getting reminded if you forget to clock out

In a job's settings, turn on **Remind me if I forget to clock out** and choose how many
hours (8, by default). If a shift on that job runs longer than that continuously, Clocker
sends you a notification — even if the app is closed — so a forgotten clock-out doesn't
sit there all night inflating your hours. Set it to whatever's actually unusual for that
job; a job with regular 10-12 hour shifts should use a higher number than one that's
normally a quick 2-hour visit.

## Weekly hours targets

If you want Clocker to track how close you are to a weekly hours goal — full-time hours, a
part-time cap, whatever you're aiming for — set a weekly target in that job's settings
(look for "Weekly hours target"). Once it's set:

- The Clock screen shows how many hours you have **left this week** toward that goal, both
  before you clock in and while you're on the clock.
- While you're clocked in, it also shows an **expected clock-out time** — when you'd hit
  your target if you worked straight through with no more breaks. This is just a
  projection based on your target, not a schedule — it updates as you actually work.
- Once you reach the target, it tells you so — and if you keep working past it, it shows
  exactly **how much over** you are (e.g. "Weekly target reached — 2h 15m over"), so you
  always know where you stand.

The "week" for this target resets on whichever day you chose when setting it up (Monday by
default) — it doesn't have to match your job's pay period.

## Overtime

Beyond the automatic weekly overtime described under [Setting up a
job](#weekly-overtime), you can also mark **one specific shift** as overtime by hand, from
that shift's entry in History (see the next section for how to open a shift). This is for
a shift you know should be paid as overtime regardless of your weekly total — for example,
a manager approved it separately.

Checking the **Overtime** box on a shift does two things:

- **Pays the entire shift at the overtime rate** (if your job has a rate multiplier set up
  — see [Weekly overtime](#weekly-overtime)), instead of the normal rate.
- **Removes it from your weekly hours target** — since it's overtime, it shouldn't count
  toward a target that's meant to track your regular hours.

You can uncheck it at any time to put the shift back to normal.

## Reviewing and fixing past shifts (History)

Open the **History** tab to see every past shift, grouped by day, with each day's total
hours at the top.

**To fix a mistake** — the wrong clock-in/clock-out time, a missing break, a note you want
to add or change, or to mark it as overtime — tap the shift. You can:

- Adjust the clock-in or clock-out time
- Add, edit, or remove breaks
- Edit the note
- Check or uncheck **Overtime** (see above)

Tap **Done** to save your changes, or **Cancel** to back out without saving.

**To delete a shift**, swipe it to the side (phone) and tap the trash icon, or tap-and-hold
(or click) to select it and use the trash icon that appears at the top — this also lets
you select and delete several shifts at once.

**To find a specific shift**, tap **Filters** at the top to narrow down by date range (this
week, last 90 days, a custom range you choose, and more) and by job — handy once you have
a long history.

**To see your shifts on a calendar** instead of a list, tap **Calendar** at the top. Each
day with a shift shows a small colored dot per job you worked that day; tap a day to jump
back to the list, already narrowed down to just that one day. Use the arrows to move
between months.

**Deleted a job or shift by mistake?** Open **Settings → Recently Deleted** — everything
you've ever deleted stays there, recoverable, for as long as you keep it (nothing is
purged automatically). Tap **Restore** on whatever you want back.

## Timesheets: getting paid

The **Timesheets** tab is built around actually getting paid — it groups your hours into
whatever pay period your employer uses (weekly, every two weeks, or monthly — each job
sets its own, in that job's settings), rather than a fixed calendar window like Export
does.

1. Pick a job at the top.
2. Use **← Prev** / **Next →** to move to the pay period you want to submit.
3. Review the entries and total shown.
4. Tap **Submit Timesheet** to email it to that job's assigned recipients — set these up
   once in the job's settings under "Submit to," as a name and email address for whoever
   needs to receive it (a manager, payroll, yourself for your own records).

Depending on that job's settings, a submission can be a CSV spreadsheet attachment, a
nicely formatted plain-text summary, or both. Your phone/computer's mail app opens with
everything already filled in — review it and hit send from there, same as any other email
you'd send yourself.

## Invoicing a client

If you bill a client directly for a job rather than submitting a timesheet, tap
**Generate Invoice** on the Timesheets tab (same job/period you've already picked). This
creates a real invoice — hours, rate, and total, computed once and frozen at that moment,
so it won't change later even if you edit a shift or change that job's rate. You get:

- **A shareable link** — anyone with it can view the invoice, and download a PDF of it,
  with no Clocker account of their own needed. Tap **Copy Link** to grab it, or
  **Send by Email** to open your mail app with it already filled in.
- **A downloadable PDF** — a clean, one-page invoice, available right from the link.

Your job's saved coordinates (if you use location awareness) or any of your other jobs'
data are never part of an invoice — just that one job's hours, rate, and total for the
period you picked.

## Exporting your hours

The **Export** tab is for a specific date range you choose on the spot, rather than a
recurring pay period — handy for a one-off report, tax purposes, or sharing hours outside
your normal pay cycle.

1. Choose a range: this week, last week, this month, the last 90 days, or a custom start
   and end date.
2. Choose which job(s) to include.
3. Choose a format:
   - **CSV** — a spreadsheet file, saved to your device or shared however you like (a
     download on the web, your phone's share sheet on mobile — attach it to an email,
     save it, send it through a messaging app, whatever you'd normally do with a file).
   - **Email** — opens a formatted draft in your mail app, with toggles for whether to
     include earnings, notes, and exact times.

## Settings

Open the menu (☰) and choose **Settings**.

- **Appearance** — System (matches your phone/browser's own light or dark mode), Light, or
  Dark.
- **Last synced** — when your data last finished updating with the server, and a **Sync
  Now** button to force it immediately (useful right after switching devices, or if you
  suspect something didn't update yet).
- **App version** — which version of Clocker you're running, and (on the phone app, if the
  person who set up your Clocker enabled it) a way to check for and install updates
  without needing to reinstall the app.
- **Server** *(only if you run your own Clocker server)* — an **Update Server** button;
  see [Backups](#backups-if-you-run-your-own-clocker-server) below.
- **Backups** *(only if you run your own Clocker server)* — see below.
- **Import Data** — bring in a CSV export from the Hours Tracker app, if you're switching
  from it. Clocker matches job names automatically and skips anything it's already
  imported, so it's safe to run more than once (e.g. after a newer export).
- **Recently Deleted** — see [Reviewing and fixing past shifts](#reviewing-and-fixing-past-shifts-history)
  above.
- **Require fingerprint to open** *(Android, if your phone supports it)* — locks the app
  behind your fingerprint. You'll need it again on a fresh launch, or after the app's been
  in the background a little while (a quick app-switch doesn't ask again).
- **Sign Out** — signs you out of this device. Your data stays safely on the server;
  signing back in brings it all back.

### Working offline

The phone app keeps working with no internet connection at all — clock in, clock out,
take breaks, add notes, everything — and quietly catches up with the server the next time
you're back online (automatically, or via **Sync Now**). The web version needs a
connection for anything to save, since it doesn't keep its own copy of your data the way
the phone app does.

## Backups (if you run your own Clocker server)

This section only applies if you (or someone you know) manages your own Clocker server,
rather than using one someone else runs for you. If you're not sure, this probably doesn't
apply to you — skip ahead to [Getting help inside the app](#getting-help-inside-the-app).

Open **Settings → Backups**. The screen itself walks through setup step by step, but
briefly:

1. Choose where backups are stored — a folder on the server itself, or (better, since it
   protects you if the server itself is ever lost or damaged) another machine reachable
   over the network.
2. Set a passphrase. **Write this down somewhere safe** — backups are encrypted with it,
   and there is no way to recover a backup if the passphrase is lost. Clocker never shows
   it to you again once it's saved.
3. Optionally set a schedule (daily, weekly, or monthly) so backups happen automatically,
   or just use **Back Up Now** whenever you want one.
4. Once you have at least one backup, **do a test restore** so you know it actually works
   before you ever really need it.

**Restoring** offers four choices, so you can restore exactly what you need:

- **Data only** — just your jobs/shifts/hours, leaving the app's own configuration alone.
- **App config only** — the server's own settings and secrets, leaving your data alone.
- **App version only** — rolls the app's code itself back to whatever was running when
  that backup was taken.
- **Full** — all three together, from the same backup — the only option guaranteed to put
  everything back exactly as it was at that moment, since data, config, and code can
  otherwise end up out of step with each other.

If you're not sure which to pick, **Full** is the safest choice for restoring after
something has gone genuinely wrong.

## Getting help inside the app

Every feature in this guide also has a short entry in the app's own **Help** screen (menu
→ Help) — handy for a quick reminder while you're actually using Clocker, without leaving
the app.

## Frequently asked questions

**Do I need internet access to use Clocker?**
Not on the phone app — see [Working offline](#working-offline) above. The website needs a
connection.

**I clocked in on my phone — will it show up if I open the website?**
Yes, as soon as both have had a chance to sync (usually within moments if both are
online). Tap **Sync Now** in Settings on either one if you want to be sure right away.

**Can two people share one account?**
Technically yes, but it's not really designed for that — anyone signed into the account
sees and can edit all the same data, with no way to tell whose entry is whose. Separate
accounts (and, if your employer supports it, separate jobs) are a better fit if you need
to track more than one person's hours.

**I accidentally deleted a shift — can I get it back?**
Not from within the app — deleting a shift is permanent. If your Clocker server has
backups configured (see above), whoever manages it may be able to restore an earlier
backup, but that would also revert anything else changed since that backup was taken, so
it's a last resort, not an undo button.

**What's the difference between "left this week" and "over"?**
Both come from a job's weekly hours target (see [Weekly hours
targets](#weekly-hours-targets)). "Left this week" means you haven't hit your goal yet and
shows how much more you'd need to work; once you reach it, it switches to telling you how
much past it you've gone instead.

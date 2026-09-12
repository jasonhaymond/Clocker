import { useState } from "react";

interface HelpTopic {
  title: string;
  body: string[];
}

// Written for the person using the app day to day, not a developer — the full technical
// docs (architecture, sync protocol, API reference) live in docs/ in the repo instead.
// Keep this in sync with what each screen actually does when a feature changes, and in
// sync with app/src/screens/HelpScreen.tsx's content (same topics, both clients).
const TOPICS: HelpTopic[] = [
  {
    title: "Clocking in and out",
    body: [
      "Click a job on the Clock screen to clock in. You can be clocked into more than one job at once, but not into the same job twice.",
      "Use the \"At...\" option to clock in or out at a specific past time instead of right now — handy if you forgot to clock in when you actually started.",
      "Start/end a break the same way, from the card for whichever job you're clocked into.",
      "If a job has a weekly hours target set (Jobs → that job's settings), the Clock screen shows how many hours are left this week and an expected clock-out time while you're on the clock.",
    ],
  },
  {
    title: "Jobs, rates, and overtime",
    body: [
      "Add a job with a name and color from the Jobs tab. Each job can have one or more named rate tiers (e.g. \"Standard\", \"Holiday\") if you're paid differently for different kinds of shifts.",
      "Changing a rate today never rewrites past shifts' pay — each tier keeps a dated history, and a shift is paid at whatever rate was in effect when it happened.",
      "Optional per-job settings (open the job to edit it): weekly overtime multiplier and threshold, time rounding (round punches to the nearest 5/10/15/20/30/60/120 minutes for pay purposes only — the times you actually punched are never changed), whether to prompt for a note right after clocking out, and a weekly hours target.",
      "Archiving a job hides it from the Clock screen without deleting its history; deleting a job removes it and its shifts for good.",
    ],
  },
  {
    title: "History",
    body: [
      "Shifts are grouped by day, most recent first, showing computed hours and pay.",
      "Click a shift to correct its clock-in/out time, add or edit its breaks, or edit its note — no need to delete and redo it.",
      "Select several shifts for bulk delete using the selection controls above the list.",
    ],
  },
  {
    title: "Timesheets",
    body: [
      "Pick a job at the top, then step through its pay periods (weekly, biweekly, or monthly — configured per job in that job's settings).",
      "\"Submit Timesheet\" downloads a CSV and/or copies formatted text to your clipboard, then opens a pre-filled email — the browser equivalent of the native email draft the mobile app can open directly. Recipients are whichever Managers you've assigned to that job.",
      "Managers are a simple saved address book (name + email) — add or archive them from a job's settings, under \"Submit to\".",
    ],
  },
  {
    title: "Export",
    body: [
      "Export CSV or a formatted summary for a date range and (optionally) a specific job — this week, last week, this month, last 90 days, or a custom range you pick yourself.",
      "This is separate from Timesheets: Export is a one-off pull of data for any range; Timesheets is built around a job's own recurring pay period and who to send it to.",
    ],
  },
  {
    title: "Sync",
    body: [
      "The web client always talks directly to the server — there's no offline mode or local database, unlike the mobile app.",
      "Settings shows when the page last refreshed its data and has a manual \"Refresh\" if something looks out of date, e.g. after making a change on another device.",
    ],
  },
  {
    title: "Backups",
    body: [
      "Settings → Backups covers taking encrypted, scheduled backups of your data on the server and restoring from one if you ever need to.",
      "That screen has its own step-by-step setup guide at the top — start there.",
    ],
  },
];

function TopicRow({ topic, expanded, onToggle }: { topic: HelpTopic; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="help-topic">
      <button className="help-topic-header" onClick={onToggle}>
        <span className="row-title">{topic.title}</span>
        <span className="help-chevron">{expanded ? "▴" : "▾"}</span>
      </button>
      {expanded && (
        <div className="help-topic-body">
          {topic.body.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export function HelpScreen({ onClose }: { onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(TOPICS[0].title);

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="link" onClick={onClose}>
          ← Back to Settings
        </button>
      </div>

      <section className="help-section">
        {TOPICS.map((topic) => (
          <TopicRow
            key={topic.title}
            topic={topic}
            expanded={expanded === topic.title}
            onToggle={() => setExpanded(expanded === topic.title ? null : topic.title)}
          />
        ))}
      </section>
    </div>
  );
}

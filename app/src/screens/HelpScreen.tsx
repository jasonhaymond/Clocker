import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";

interface HelpTopic {
  title: string;
  body: string[];
}

// Written for the person using the app day to day, not a developer — the full technical
// docs (architecture, sync protocol, API reference) live in docs/ in the repo instead.
// Keep this in sync with what each screen actually does when a feature changes.
const TOPICS: HelpTopic[] = [
  {
    title: "Clocking in and out",
    body: [
      "Tap a job on the Clock screen to clock in. You can be clocked into more than one job at once, but not into the same job twice.",
      "Use the \"At...\" buttons to clock in or out at a specific past time instead of right now — handy if you forgot to clock in when you actually started.",
      "Start/end a break the same way, from the card for whichever job you're clocked into.",
      "If a job has a weekly hours target set (Jobs → that job's settings), the Clock screen shows how many hours are left this week and an expected clock-out time while you're on the clock.",
    ],
  },
  {
    title: "Jobs, rates, and overtime",
    body: [
      "Add a job with a name and color from the Jobs tab. Each job can have one or more named rate tiers (e.g. \"Standard\", \"Holiday\") if you're paid differently for different kinds of shifts.",
      "Changing a rate today never rewrites past shifts' pay — each tier keeps a dated history, and a shift is paid at whatever rate was in effect when it happened.",
      "Optional per-job settings (tap the job to open its settings): weekly overtime multiplier and threshold, time rounding (round punches to the nearest 5/10/15/20/30/60/120 minutes for pay purposes only — the times you actually punched are never changed), whether to prompt for a note right after clocking out, and a weekly hours target.",
      "Archiving a job hides it from the Clock screen without deleting its history; deleting a job removes it and its shifts for good.",
    ],
  },
  {
    title: "History",
    body: [
      "Shifts are grouped by day, most recent first, showing computed hours and pay.",
      "Tap a shift to correct its clock-in/out time, add or edit its breaks, or edit its note — no need to delete and redo it.",
      "Long-press a shift (or tap while already selecting) to multi-select several shifts for bulk delete.",
    ],
  },
  {
    title: "Timesheets",
    body: [
      "Pick a job at the top, then step through its pay periods (weekly, biweekly, or monthly — configured per job in that job's settings).",
      "\"Submit Timesheet\" emails the period's hours to whichever Managers you've assigned to that job, as CSV, formatted plain text, or both — configured per job alongside its rate/rounding settings.",
      "Managers are a simple saved address book (name + email) — add or archive them from a job's settings, under \"Submit to\".",
    ],
  },
  {
    title: "Export",
    body: [
      "Export CSV or an email summary for a date range and (optionally) a specific job — this week, last week, this month, last 90 days, or a custom range you pick yourself.",
      "This is separate from Timesheets: Export is a one-off pull of data for any range; Timesheets is built around a job's own recurring pay period and who to send it to.",
    ],
  },
  {
    title: "Import",
    body: [
      "Settings → Import Data brings in a CSV export from the Hours Tracker app — jobs, shifts, and breaks.",
      "A job name that exactly matches one you already have gets its shifts added to it; any other name creates a new job automatically, with its color picked for you and its starting rate set from whichever rate shows up most often in its rows.",
      "You'll see a preview (how many shifts, how many new jobs) before anything is actually imported, and importing the same file twice is safe — a shift that's already there (same job, same clock-in time) is skipped rather than duplicated.",
    ],
  },
  {
    title: "Sync",
    body: [
      "Everything you do saves locally right away and syncs to the server automatically in the background and whenever you reopen the app.",
      "Settings shows when the app last synced and has a manual \"Sync Now\" if you want to force it — useful right before you're about to lose signal, or right after switching devices.",
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.topic}>
      <TouchableOpacity style={styles.topicHeader} onPress={onToggle}>
        <Text style={styles.topicTitle}>{topic.title}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted3} />
      </TouchableOpacity>
      {expanded && (
        <View style={styles.topicBody}>
          {topic.body.map((line, i) => (
            <Text key={i} style={styles.topicLine}>
              {line}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

export function HelpScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState<string | null>(TOPICS[0].title);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Help</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>

        {TOPICS.map((topic) => (
          <TopicRow
            key={topic.title}
            topic={topic}
            expanded={expanded === topic.title}
            onToggle={() => setExpanded(expanded === topic.title ? null : topic.title)}
          />
        ))}
      </ScrollView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.card },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    title: { fontSize: 17, fontWeight: "700", color: colors.text },
    doneText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
    topic: { borderBottomWidth: 1, borderBottomColor: colors.border },
    topicHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 },
    topicTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
    topicBody: { paddingBottom: 12, gap: 8 },
    topicLine: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  });
}

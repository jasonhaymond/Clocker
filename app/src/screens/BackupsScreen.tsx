import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  getBackupArchives,
  getBackupConfig,
  getBackupRuns,
  getBackupStatus,
  restoreBackup,
  triggerBackup,
  updateBackupConfig,
  type BackupArchive,
  type BackupConfig,
  type BackupOpStatus,
  type BackupRun,
} from "../sync/api";

const FREQUENCIES = ["off", "daily", "weekly", "monthly"] as const;
type Frequency = (typeof FREQUENCIES)[number];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ArchiveRestoreRow({ archive, onRestored }: { archive: BackupArchive; onRestored: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [restoreDb, setRestoreDb] = useState(true);
  const [restoreEnv, setRestoreEnv] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doRestore() {
    setBusy(true);
    setError(null);
    try {
      await restoreBackup(archive.name, restoreDb, restoreEnv);
      setExpanded(false);
      setConfirmText("");
      onRestored();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't start the restore");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.archiveRow}>
      <View style={styles.archiveRowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{archive.name}</Text>
          <Text style={styles.hint}>{new Date(archive.time).toLocaleString()}</Text>
        </View>
        <TouchableOpacity onPress={() => setExpanded(!expanded)}>
          <Text style={styles.link}>{expanded ? "Cancel" : "Restore..."}</Text>
        </TouchableOpacity>
      </View>
      {expanded && (
        <View style={styles.restorePanel}>
          <TouchableOpacity style={styles.checkboxRow} onPress={() => setRestoreDb(!restoreDb)}>
            <View style={[styles.checkboxBox, restoreDb && styles.checkboxBoxChecked]}>
              {restoreDb && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>Restore database</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.checkboxRow} onPress={() => setRestoreEnv(!restoreEnv)}>
            <View style={[styles.checkboxBox, restoreEnv && styles.checkboxBoxChecked]}>
              {restoreEnv && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>Restore secrets (.env.prod) — every device will need to sign in again if this changes JWT_SECRET</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>This overwrites live data. Type the archive name to confirm.</Text>
          <TextInput style={styles.input} value={confirmText} onChangeText={setConfirmText} placeholder={archive.name} autoCapitalize="none" />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.button, styles.dangerButton]}
            onPress={doRestore}
            disabled={busy || confirmText !== archive.name || (!restoreDb && !restoreEnv)}
          >
            {busy ? <ActivityIndicator color="#dc2626" /> : <Text style={styles.dangerButtonText}>Restore</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function BackupsScreen({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [retentionCount, setRetentionCount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("off");
  const [hour, setHour] = useState("3");
  const [minute, setMinute] = useState("0");
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [opStatus, setOpStatus] = useState<BackupOpStatus | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [archives, setArchives] = useState<BackupArchive[]>([]);
  const [archivesError, setArchivesError] = useState<string | null>(null);
  const [runs, setRuns] = useState<BackupRun[]>([]);

  const loadConfig = useCallback(() => {
    getBackupConfig().then((cfg) => {
      setConfig(cfg);
      setRepoUrl(cfg.repoUrl ?? "");
      setRetentionCount(cfg.retentionCount != null ? String(cfg.retentionCount) : "");
      if (cfg.schedule) {
        setFrequency(cfg.schedule.frequency);
        setHour(String(cfg.schedule.hour));
        setMinute(String(cfg.schedule.minute));
        if (cfg.schedule.weekday != null) setWeekday(cfg.schedule.weekday);
        if (cfg.schedule.dayOfMonth != null) setDayOfMonth(String(cfg.schedule.dayOfMonth));
      } else {
        setFrequency("off");
      }
    });
  }, []);

  const loadArchives = useCallback(() => {
    getBackupArchives()
      .then((r) => {
        setArchives(r.archives);
        setArchivesError(null);
      })
      .catch((e: any) => setArchivesError(e?.message ?? "Couldn't load archives"));
  }, []);

  const loadRuns = useCallback(() => {
    getBackupRuns().then((r) => setRuns(r.runs));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(() => {
    getBackupStatus()
      .then((status) => {
        setOpStatus(status);
        if (!status.running) {
          stopPolling();
          loadArchives();
          loadRuns();
        }
      })
      .catch(() => {});
  }, [stopPolling, loadArchives, loadRuns]);

  useEffect(() => {
    loadConfig();
    loadArchives();
    loadRuns();
    getBackupStatus()
      .then((status) => {
        setOpStatus(status);
        if (status.running) pollRef.current = setInterval(pollStatus, 3000);
      })
      .catch(() => {});
    return stopPolling;
  }, [loadConfig, loadArchives, loadRuns, pollStatus, stopPolling]);

  async function saveConfig() {
    setSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    try {
      await updateBackupConfig({
        repoUrl,
        ...(passphrase ? { passphrase } : {}),
        retentionCount: retentionCount.trim() ? Number(retentionCount) : null,
        schedule:
          frequency === "off"
            ? null
            : { frequency, hour: Number(hour) || 0, minute: Number(minute) || 0, weekday, dayOfMonth: Number(dayOfMonth) || 1 },
      });
      setPassphrase("");
      setSavedMessage("Saved.");
      loadConfig();
    } catch (e: any) {
      setSaveError(e?.message ?? "Couldn't save backup settings");
    } finally {
      setSaving(false);
    }
  }

  function confirmClearPassphrase() {
    Alert.alert("Clear passphrase", "Backups will stop working until a new one is set.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          await updateBackupConfig({ passphrase: "" });
          loadConfig();
        },
      },
    ]);
  }

  async function backUpNow() {
    setTriggering(true);
    setTriggerError(null);
    try {
      await triggerBackup();
      stopPolling();
      pollRef.current = setInterval(pollStatus, 3000);
      pollStatus();
    } catch (e: any) {
      setTriggerError(e?.message ?? "Couldn't start the backup");
    } finally {
      setTriggering(false);
    }
  }

  function onRestored() {
    stopPolling();
    pollRef.current = setInterval(pollStatus, 3000);
    pollStatus();
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Backups</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Backup destination (SSH)</Text>
        <Text style={styles.hint}>For a remote repository, grant this key access on the backup server — see docs/deployment.md#the-host-agent.</Text>
        <Text style={styles.logText}>{config?.sshPublicKey ?? "Generating…"}</Text>

        <Text style={styles.sectionLabel}>Repository</Text>
        <Text style={styles.fieldLabel}>Repo URL (local path or user@host:path)</Text>
        <TextInput style={styles.input} value={repoUrl} onChangeText={setRepoUrl} placeholder="/mnt/backups/clocker" autoCapitalize="none" />
        <Text style={styles.fieldLabel}>Passphrase {config?.passphraseSet ? "(configured — leave blank to keep)" : "(not set)"}</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={passphrase}
            onChangeText={setPassphrase}
            placeholder="Leave blank to keep current"
            secureTextEntry
          />
          {config?.passphraseSet && (
            <TouchableOpacity onPress={confirmClearPassphrase} style={styles.clearButton}>
              <Text style={styles.link}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.fieldLabel}>Keep last N archives (blank = never auto-prune)</Text>
        <TextInput style={styles.input} value={retentionCount} onChangeText={setRetentionCount} keyboardType="number-pad" placeholder="14" />

        <Text style={styles.sectionLabel}>Schedule</Text>
        <View style={styles.chipRow}>
          {FREQUENCIES.map((f) => (
            <TouchableOpacity key={f} style={[styles.chip, frequency === f && styles.chipSelected]} onPress={() => setFrequency(f)}>
              <Text style={[styles.chipText, frequency === f && styles.chipTextSelected]}>{f === "off" ? "Off" : f[0].toUpperCase() + f.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {frequency !== "off" && (
          <>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Hour (0-23)</Text>
                <TextInput style={styles.input} value={hour} onChangeText={setHour} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Minute</Text>
                <TextInput style={styles.input} value={minute} onChangeText={setMinute} keyboardType="number-pad" />
              </View>
            </View>
            {frequency === "weekly" && (
              <>
                <Text style={styles.fieldLabel}>Day of week</Text>
                <View style={styles.chipRow}>
                  {WEEKDAYS.map((d, i) => (
                    <TouchableOpacity key={d} style={[styles.dayChip, weekday === i && styles.chipSelected]} onPress={() => setWeekday(i)}>
                      <Text style={[styles.chipText, weekday === i && styles.chipTextSelected]}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            {frequency === "monthly" && (
              <>
                <Text style={styles.fieldLabel}>Day of month (1-28)</Text>
                <TextInput style={styles.input} value={dayOfMonth} onChangeText={setDayOfMonth} keyboardType="number-pad" />
              </>
            )}
          </>
        )}

        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        {savedMessage ? <Text style={styles.hint}>{savedMessage}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={saveConfig} disabled={saving || !repoUrl.trim()}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Settings</Text>}
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Back up now</Text>
        {opStatus?.running ? (
          <Text style={styles.hint}>{opStatus.kind === "restore" ? "Restoring…" : "Backing up…"} this can take a while.</Text>
        ) : opStatus?.finishedAt ? (
          <Text style={styles.hint}>
            Last {opStatus.kind}: {opStatus.exitCode === 0 ? "succeeded" : `failed (exit ${opStatus.exitCode})`}
            {" · "}
            {new Date(opStatus.finishedAt).toLocaleString()}
          </Text>
        ) : null}
        {triggerError ? <Text style={styles.error}>{triggerError}</Text> : null}
        <TouchableOpacity
          style={styles.button}
          onPress={backUpNow}
          disabled={triggering || !!opStatus?.running || !config?.repoUrl || !config?.passphraseSet}
        >
          {triggering || opStatus?.running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Back Up Now</Text>}
        </TouchableOpacity>
        {opStatus?.log ? (
          <>
            <TouchableOpacity onPress={() => setShowLog(!showLog)}>
              <Text style={styles.link}>{showLog ? "Hide log" : "Show log"}</Text>
            </TouchableOpacity>
            {showLog && <Text style={styles.logText}>{opStatus.log}</Text>}
          </>
        ) : null}

        <Text style={styles.sectionLabel}>Archives</Text>
        {archivesError ? <Text style={styles.error}>{archivesError}</Text> : null}
        {archives.length === 0 && !archivesError && <Text style={styles.hint}>No archives yet.</Text>}
        {archives.map((a) => (
          <ArchiveRestoreRow key={a.name} archive={a} onRestored={onRestored} />
        ))}

        <Text style={styles.sectionLabel}>Recent runs</Text>
        {runs.length === 0 && <Text style={styles.hint}>No runs yet.</Text>}
        {runs.map((r, i) => (
          <View key={i} style={styles.runRow}>
            <Text style={[styles.runStatus, r.status === "success" ? styles.runStatusSuccess : styles.runStatusError]}>{r.status}</Text>
            <Text style={styles.rowTitle}>{r.kind}</Text>
            <Text style={styles.hint}>{new Date(r.finishedAt).toLocaleString()}</Text>
            <Text style={styles.hint}>{r.message}</Text>
          </View>
        ))}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  title: { fontSize: 17, fontWeight: "700" },
  doneText: { color: "#2563eb", fontWeight: "600", fontSize: 15 },
  sectionLabel: { fontWeight: "600", color: "#444", marginTop: 16, marginBottom: 6, fontSize: 13 },
  fieldLabel: { color: "#666", fontSize: 12, marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, backgroundColor: "#fff" },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  hint: { color: "#999", fontSize: 11, marginTop: 4, marginBottom: 4 },
  error: { color: "#dc2626", fontSize: 12, marginTop: 4, marginBottom: 4 },
  link: { color: "#2563eb", fontWeight: "600", fontSize: 13 },
  clearButton: { paddingHorizontal: 6 },
  button: { backgroundColor: "#2563eb", borderRadius: 10, padding: 12, alignItems: "center", marginTop: 10 },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  dangerButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#dc2626", marginTop: 8 },
  dangerButtonText: { color: "#dc2626", fontSize: 14, fontWeight: "600" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  dayChip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6 },
  chipSelected: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  logText: { fontFamily: "monospace", fontSize: 10, color: "#ddd", backgroundColor: "#111", padding: 8, borderRadius: 6, marginTop: 4 },
  rowTitle: { fontSize: 14, fontWeight: "500" },
  archiveRow: { borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 8 },
  archiveRowHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  restorePanel: { marginTop: 10, padding: 10, backgroundColor: "#fef2f2", borderRadius: 8, borderWidth: 1, borderColor: "#fecaca" },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  checkboxBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: "#999", alignItems: "center", justifyContent: "center" },
  checkboxBoxChecked: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  checkmark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  checkboxLabel: { flex: 1, fontSize: 12, color: "#333" },
  runRow: { borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 6, gap: 2 },
  runStatus: { fontWeight: "700", fontSize: 10, textTransform: "uppercase", alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  runStatusSuccess: { backgroundColor: "#dcfce7", color: "#166534" },
  runStatusError: { backgroundColor: "#fef2f2", color: "#991b1b" },
});

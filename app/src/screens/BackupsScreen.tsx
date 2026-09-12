import { buildBackupRemoteUserScript } from "@clocker/shared";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
            {busy ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.dangerButtonText}>Restore</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// The SSH key is generated once on the host (`ssh-keygen`, not in any container) and is
// near-instant when it works — but if it fails (most commonly: OpenSSH's client tools
// aren't installed on the host), the server has nothing to return and previously the UI
// just showed "Generating..." forever with no error and no way to retry short of manually
// re-opening this screen. Every GET/PATCH /backup/config now retries generation
// server-side, so a few quick automatic re-fetches cover the normal near-instant case,
// and a real error (surfaced via sshPublicKeyError) plus a manual Retry button covers a
// genuinely broken host instead of spinning silently forever.
const KEY_POLL_ATTEMPTS = 5;
const KEY_POLL_INTERVAL_MS = 1500;

export function BackupsScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [keyPollAttempt, setKeyPollAttempt] = useState(0);
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
  const [showRemoteSetup, setShowRemoteSetup] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [archives, setArchives] = useState<BackupArchive[]>([]);
  const [runs, setRuns] = useState<BackupRun[]>([]);

  const loadConfig = useCallback(() => {
    getBackupConfig()
      .then((cfg) => {
        if (!cfg) return;
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
      })
      // A malformed/empty response leaves `config` null — the retry effect below no
      // longer requires `config` to already be set to keep trying, so this doesn't need
      // to do anything beyond not crashing; swallowed so it doesn't spam the console on
      // every retry attempt against a server stuck in that state.
      .catch(() => {});
  }, []);

  // Auto-retry a few times while we don't yet have either a key or an error, then stop
  // and let the manual-retry UI below take over rather than polling forever. Previously
  // this required `config` to already be non-null before it would even start — meaning
  // if /backup/config itself never resolved to a real object (the same "empty response"
  // failure mode fixed for /backup/archives above), the retry loop never began at all:
  // keyPollAttempt stayed 0 forever, and the UI was stuck on "Generating..." permanently
  // with no fallback and no way to recover short of reloading the app. This is exactly
  // the bug behind a real report of the key staying stuck even after a redeploy.
  useEffect(() => {
    const haveResolution = !!config?.sshPublicKey || !!config?.sshPublicKeyError;
    if (!haveResolution && keyPollAttempt < KEY_POLL_ATTEMPTS) {
      const timer = setTimeout(() => {
        setKeyPollAttempt((n) => n + 1);
        loadConfig();
      }, KEY_POLL_INTERVAL_MS);
      return () => clearTimeout(timer);
    }
  }, [config, keyPollAttempt, loadConfig]);

  function retryKeyGeneration() {
    setKeyPollAttempt(0);
    loadConfig();
  }

  // Same treatment as loadRuns below: a malformed/empty response (seen in practice
  // against a stale or misbehaving deployment) previously crashed here with a raw
  // "Cannot read properties of undefined" — now it's just an empty list, same as
  // genuinely having no archives yet. Not worth a dedicated error state; there's nothing
  // actionable to tell the user beyond what the SSH key / server sections already
  // surface if the host agent itself is unreachable.
  const loadArchives = useCallback(() => {
    getBackupArchives()
      .then((r) => setArchives(r?.archives ?? []))
      .catch(() => {});
  }, []);

  const loadRuns = useCallback(() => {
    getBackupRuns()
      .then((r) => setRuns(r?.runs ?? []))
      .catch(() => {});
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

        <Text style={styles.sectionLabel}>How to set this up</Text>
        <View style={styles.setupSteps}>
          <Text style={styles.setupStep}>
            1. If backing up to a remote server over SSH, that server needs a dedicated
            account that recognizes the key below — see "Set up a dedicated backup user"
            underneath the key for copy-pasteable commands to create one (a local folder
            path needs no key at all — skip to step 2).
          </Text>
          <Text style={styles.setupStep}>2. Enter the repository location and a passphrase below, then Save Settings.</Text>
          <Text style={styles.setupStep}>3. Set a schedule so backups happen on their own, or just use Back Up Now whenever you want one.</Text>
          <Text style={styles.setupStep}>4. Once you have at least one archive, do a test restore below so you know it actually works before you ever need it for real.</Text>
        </View>

        <Text style={styles.sectionLabel}>Backup destination (SSH)</Text>
        <Text style={styles.hint}>For a remote repository, grant this key access on the backup server — see docs/deployment.md#the-host-agent.</Text>
        {config?.sshPublicKey ? (
          <Text style={styles.logText} selectable>
            {config.sshPublicKey}
          </Text>
        ) : config?.sshPublicKeyError ? (
          <>
            <Text style={styles.error}>Couldn't generate a backup key: {config.sshPublicKeyError}</Text>
            <TouchableOpacity onPress={retryKeyGeneration}>
              <Text style={styles.link}>Retry</Text>
            </TouchableOpacity>
          </>
        ) : keyPollAttempt >= KEY_POLL_ATTEMPTS ? (
          // No sshPublicKeyError doesn't necessarily mean nothing's wrong — an older
          // deployed host agent (predating that field), or /backup/config itself never
          // resolving to a real object at all, would both leave this branch permanently
          // unreachable via config alone, which is exactly what previously left this
          // stuck on "Generating..." forever with no way out (see the retry effect's
          // comment above). Deliberately does NOT require `config` to be set — once the
          // auto-retry budget is spent with still no key, always offer a manual retry.
          <>
            <Text style={styles.error}>
              Still generating a backup key after several tries — the host agent may be running an older version. Try
              Update Server (Settings) if this persists, then Retry here.
            </Text>
            <TouchableOpacity onPress={retryKeyGeneration}>
              <Text style={styles.link}>Retry</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.logText}>Generating…</Text>
        )}

        <TouchableOpacity onPress={() => setShowRemoteSetup(!showRemoteSetup)}>
          <Text style={styles.link}>
            {showRemoteSetup ? "Hide remote server setup instructions" : "Set up a dedicated backup user on the remote server"}
          </Text>
        </TouchableOpacity>
        {showRemoteSetup && (
          <>
            <Text style={styles.hint}>
              Recommended over granting this key access to your own login: a dedicated
              account restricted to only running "borg serve" against one path means the
              key is useless for anything else, even if it were ever leaked. Run these on
              the remote backup server itself (not this app's own server). Tap and hold to
              copy.
            </Text>
            <Text style={styles.logText} selectable>
              {buildBackupRemoteUserScript({ repoUrl, sshPublicKey: config?.sshPublicKey })}
            </Text>
          </>
        )}

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
        {archives.length === 0 && <Text style={styles.hint}>No archives yet.</Text>}
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.card },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    title: { fontSize: 17, fontWeight: "700", color: colors.text },
    doneText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
    sectionLabel: { fontWeight: "600", color: colors.textSecondary, marginTop: 16, marginBottom: 6, fontSize: 13 },
    setupSteps: { gap: 6 },
    setupStep: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
    fieldLabel: { color: colors.textMuted3, fontSize: 12, marginTop: 8, marginBottom: 4 },
    input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 8, padding: 8, backgroundColor: colors.card, color: colors.text },
    row: { flexDirection: "row", gap: 8, alignItems: "center" },
    hint: { color: colors.textMuted2, fontSize: 11, marginTop: 4, marginBottom: 4 },
    error: { color: colors.danger, fontSize: 12, marginTop: 4, marginBottom: 4 },
    link: { color: colors.primary, fontWeight: "600", fontSize: 13 },
    clearButton: { paddingHorizontal: 6 },
    button: { backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: "center", marginTop: 10 },
    buttonText: { color: colors.onPrimary, fontSize: 14, fontWeight: "600" },
    dangerButton: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.danger, marginTop: 8 },
    dangerButtonText: { color: colors.danger, fontSize: 14, fontWeight: "600" },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
    chip: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.card },
    dayChip: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.card },
    chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textSecondary, fontSize: 13 },
    chipTextSelected: { color: colors.onPrimary, fontWeight: "600" },
    logText: { fontFamily: "monospace", fontSize: 10, color: colors.invertText, backgroundColor: colors.invertBg, padding: 8, borderRadius: 6, marginTop: 4 },
    rowTitle: { fontSize: 14, fontWeight: "500", color: colors.text },
    archiveRow: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 8 },
    archiveRowHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    restorePanel: { marginTop: 10, padding: 10, backgroundColor: colors.dangerBg, borderRadius: 8, borderWidth: 1, borderColor: colors.dangerBorder },
    checkboxRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    checkboxBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: colors.textMuted2, alignItems: "center", justifyContent: "center" },
    checkboxBoxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkmark: { color: colors.onPrimary, fontSize: 13, fontWeight: "700" },
    checkboxLabel: { flex: 1, fontSize: 12, color: colors.textSecondary },
    runRow: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6, gap: 2 },
    runStatus: { fontWeight: "700", fontSize: 10, textTransform: "uppercase", alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    runStatusSuccess: { backgroundColor: colors.successBg, color: colors.successText },
    runStatusError: { backgroundColor: colors.dangerBg, color: colors.dangerText },
  });
}

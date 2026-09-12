import { buildImportPreview, HOURS_TRACKER_CSV_HEADER, parseHoursTrackerCsv, type ImportPreview, type ParsedImportRow } from "@clocker/shared";
import { File } from "expo-file-system";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listJobs } from "../db/database";
import { runImport, type ImportSummary } from "../lib/importHoursTracker";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";

export function ImportScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  function reset() {
    setFileName(null);
    setRows([]);
    setParseErrors([]);
    setPreview(null);
    setImportError(null);
    setSummary(null);
  }

  async function pickFile() {
    const picked = await File.pickFileAsync({ mimeTypes: ["text/csv", "text/comma-separated-values", "*/*"] });
    if (picked.canceled) return;
    setSummary(null);
    setImportError(null);
    setFileName(picked.result.name);
    try {
      const text = await picked.result.text();
      const { rows: parsedRows, errors } = parseHoursTrackerCsv(text);
      setRows(parsedRows);
      setParseErrors(errors);
      const existingJobs = await listJobs(true);
      setPreview(buildImportPreview(parsedRows, existingJobs));
    } catch (e: any) {
      setImportError(e?.message ?? "Couldn't read that file");
    }
  }

  async function doImport() {
    setImporting(true);
    setImportError(null);
    setProgress({ done: 0, total: rows.length });
    try {
      const existingJobs = await listJobs(true);
      const result = await runImport(rows, existingJobs, (done, total) => setProgress({ done, total }));
      setSummary(result);
      setRows([]);
      setPreview(null);
    } catch (e: any) {
      setImportError(e?.message ?? "Import failed");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 14, paddingTop: insets.top + 14 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Import Data</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Import from Hours Tracker</Text>
        <Text style={styles.hint}>
          Imports a CSV export from the Hours Tracker app as jobs, shifts, and breaks. A
          job whose name exactly matches one you already have gets its shifts added to it;
          any other job name creates a new job (its color chosen automatically, and its
          starting rate set from whichever hourly rate appears most often in its rows). A
          shift that already exists — same job, same clock-in time — is skipped, so
          importing the same file twice (or an export that overlaps one you already
          imported) is safe.
        </Text>
        <Text style={styles.hint}>Expected header row:</Text>
        <Text style={styles.logText} selectable>
          {HOURS_TRACKER_CSV_HEADER}
        </Text>
        <Text style={styles.hint}>
          See docs/import-format.md for the full column reference — only Job, Clocked In,
          and Clocked Out are required; the rest are used when present and skipped otherwise.
        </Text>

        <TouchableOpacity style={styles.button} onPress={pickFile} disabled={importing}>
          <Text style={styles.buttonText}>Choose CSV File</Text>
        </TouchableOpacity>
        {fileName && <Text style={styles.hint}>Selected: {fileName}</Text>}

        {parseErrors.length > 0 && (
          <>
            <Text style={styles.error}>
              {parseErrors.length} row{parseErrors.length === 1 ? "" : "s"} couldn't be read and will be skipped:
            </Text>
            <Text style={styles.logText}>
              {parseErrors.slice(0, 20).join("\n")}
              {parseErrors.length > 20 ? `\n…and ${parseErrors.length - 20} more` : ""}
            </Text>
          </>
        )}

        {preview && preview.totalRows > 0 && (
          <>
            <Text style={styles.hint}>
              {preview.totalRows} shift{preview.totalRows === 1 ? "" : "s"} found across{" "}
              {preview.newJobNames.length + preview.existingJobNames.length} job
              {preview.newJobNames.length + preview.existingJobNames.length === 1 ? "" : "s"}.
            </Text>
            {preview.newJobNames.length > 0 && (
              <Text style={styles.hint}>
                {preview.newJobNames.length} new job{preview.newJobNames.length === 1 ? "" : "s"} will be created: {preview.newJobNames.join(", ")}
              </Text>
            )}
            {preview.existingJobNames.length > 0 && (
              <Text style={styles.hint}>
                Adding to {preview.existingJobNames.length} existing job{preview.existingJobNames.length === 1 ? "" : "s"}: {preview.existingJobNames.join(", ")}
              </Text>
            )}
            {importError ? <Text style={styles.error}>{importError}</Text> : null}
            <TouchableOpacity style={styles.button} onPress={doImport} disabled={importing}>
              {importing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>
                  Import {preview.totalRows} Shift{preview.totalRows === 1 ? "" : "s"}
                </Text>
              )}
            </TouchableOpacity>
            {progress && (
              <Text style={styles.hint}>
                Importing {progress.done} of {progress.total}…
              </Text>
            )}
          </>
        )}

        {preview && preview.totalRows === 0 && parseErrors.length === 0 && <Text style={styles.hint}>No importable rows found in this file.</Text>}

        {summary && (
          <View>
            <Text style={styles.hint}>
              Imported {summary.shiftsImported} shift{summary.shiftsImported === 1 ? "" : "s"}
              {summary.jobsCreated > 0 ? ` (${summary.jobsCreated} new job${summary.jobsCreated === 1 ? "" : "s"})` : ""}.
              {summary.shiftsSkipped > 0 ? ` Skipped ${summary.shiftsSkipped} already-imported shift${summary.shiftsSkipped === 1 ? "" : "s"}.` : ""}
            </Text>
            <TouchableOpacity onPress={reset}>
              <Text style={styles.link}>Import another file</Text>
            </TouchableOpacity>
          </View>
        )}
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
    hint: { color: colors.textMuted2, fontSize: 12, marginTop: 4, marginBottom: 4, lineHeight: 17 },
    error: { color: colors.danger, fontSize: 12, marginTop: 4, marginBottom: 4 },
    link: { color: colors.primary, fontWeight: "600", fontSize: 13, marginTop: 8 },
    button: { backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: "center", marginTop: 10 },
    buttonText: { color: colors.onPrimary, fontSize: 14, fontWeight: "600" },
    logText: { fontFamily: "monospace", fontSize: 10, color: colors.invertText, backgroundColor: colors.invertBg, padding: 8, borderRadius: 6, marginTop: 4 },
  });
}

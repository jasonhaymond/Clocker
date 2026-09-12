import { buildImportPreview, HOURS_TRACKER_CSV_HEADER, parseHoursTrackerCsv, type ImportPreview, type ParsedImportRow } from "@clocker/shared";
import { useRef, useState } from "react";
import { runImport, type ImportSummary } from "../lib/importHoursTracker";
import { useStore } from "../store";

export function ImportScreen({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  function reset() {
    setFileName(null);
    setRows([]);
    setParseErrors([]);
    setPreview(null);
    setImportError(null);
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSummary(null);
    setImportError(null);
    setFileName(file.name);
    const text = await file.text();
    const { rows: parsedRows, errors } = parseHoursTrackerCsv(text);
    setRows(parsedRows);
    setParseErrors(errors);
    setPreview(buildImportPreview(parsedRows, store.jobs));
  }

  async function doImport() {
    setImporting(true);
    setImportError(null);
    try {
      const result = await runImport(rows, store.jobs, store.shifts);
      await store.refresh();
      setSummary(result);
      setRows([]);
      setPreview(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="link" onClick={onClose}>
          ← Back to Settings
        </button>
      </div>

      <section>
        <div className="row-title">Import from Hours Tracker</div>
        <p className="hint">
          Imports a CSV export from the Hours Tracker app as jobs, shifts, and breaks. A
          job whose name exactly matches one you already have gets its shifts added to it;
          any other job name creates a new job (its color chosen automatically, and its
          starting rate set from whichever hourly rate appears most often in its rows). A
          shift that already exists — same job, same clock-in time — is skipped, so
          importing the same file twice (or an export that overlaps one you already
          imported) is safe.
        </p>
        <p className="hint">Expected header row:</p>
        <pre className="update-log">{HOURS_TRACKER_CSV_HEADER}</pre>
        <p className="hint">
          See <code>docs/import-format.md</code> for the full column reference — only{" "}
          <code>Job</code>, <code>Clocked In</code>, and <code>Clocked Out</code> are
          required; the rest are used when present and skipped otherwise.
        </p>
      </section>

      <section>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={onFileSelected} />
        {fileName && <p className="hint">Selected: {fileName}</p>}

        {parseErrors.length > 0 && (
          <>
            <p className="error">
              {parseErrors.length} row{parseErrors.length === 1 ? "" : "s"} couldn't be read and will be skipped:
            </p>
            <pre className="update-log">{parseErrors.slice(0, 20).join("\n")}{parseErrors.length > 20 ? `\n…and ${parseErrors.length - 20} more` : ""}</pre>
          </>
        )}

        {preview && preview.totalRows > 0 && (
          <>
            <p className="hint">
              {preview.totalRows} shift{preview.totalRows === 1 ? "" : "s"} found across{" "}
              {preview.newJobNames.length + preview.existingJobNames.length} job
              {preview.newJobNames.length + preview.existingJobNames.length === 1 ? "" : "s"}.
            </p>
            {preview.newJobNames.length > 0 && (
              <p className="hint">
                {preview.newJobNames.length} new job{preview.newJobNames.length === 1 ? "" : "s"} will be created: {preview.newJobNames.join(", ")}
              </p>
            )}
            {preview.existingJobNames.length > 0 && (
              <p className="hint">
                Adding to {preview.existingJobNames.length} existing job{preview.existingJobNames.length === 1 ? "" : "s"}: {preview.existingJobNames.join(", ")}
              </p>
            )}
            {importError && <p className="error">{importError}</p>}
            <button className="primary-button" onClick={doImport} disabled={importing}>
              {importing ? "Importing…" : `Import ${preview.totalRows} Shift${preview.totalRows === 1 ? "" : "s"}`}
            </button>
          </>
        )}

        {preview && preview.totalRows === 0 && parseErrors.length === 0 && <p className="hint">No importable rows found in this file.</p>}

        {summary && (
          <p className="hint">
            Imported {summary.shiftsImported} shift{summary.shiftsImported === 1 ? "" : "s"}
            {summary.jobsCreated > 0 ? ` (${summary.jobsCreated} new job${summary.jobsCreated === 1 ? "" : "s"})` : ""}.
            {summary.shiftsSkipped > 0 ? ` Skipped ${summary.shiftsSkipped} already-imported shift${summary.shiftsSkipped === 1 ? "" : "s"}.` : ""}{" "}
            <button className="link" onClick={reset}>
              Import another file
            </button>
          </p>
        )}
      </section>
    </div>
  );
}

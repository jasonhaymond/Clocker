import { useMemo, useState } from "react";
import type { Job } from "@clocker/shared";
import { JobEditor } from "../components/JobEditor";
import { useStore } from "../store";

const PALETTE = ["#1d4ed8", "#b91c1c", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

function activeRateLabel(store: ReturnType<typeof useStore>, jobId: string): string | null {
  const tier = store.rateTiers.find((t) => t.jobId === jobId && t.isDefault) ?? store.rateTiers.find((t) => t.jobId === jobId);
  if (!tier) return null;
  const now = Date.now();
  let best: { effectiveFrom: string; hourlyRateCents: number } | null = null;
  for (const v of store.rateVersions) {
    if (v.tierId !== tier.id) continue;
    if (new Date(v.effectiveFrom).getTime() > now) continue;
    if (!best || new Date(v.effectiveFrom).getTime() > new Date(best.effectiveFrom).getTime()) best = v;
  }
  return best ? `$${(best.hourlyRateCents / 100).toFixed(2)}/hr` : null;
}

export function JobsScreen() {
  const store = useStore();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  // The Jobs screen is the one place archived jobs are still reachable at all (every
  // other screen filters them out entirely) — but even here, hidden by default so a long
  // history of old jobs doesn't clutter the list; this toggle is the deliberate exception.
  const [showArchived, setShowArchived] = useState(false);

  // The server returns jobs in no particular order — sort archived ones after active
  // ones (matching mobile's own listJobs, which already does this via SQL), alphabetical
  // within each group so the list reads predictably either way.
  const sortedJobs = useMemo(
    () =>
      [...store.jobs].sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }),
    [store.jobs],
  );
  const archivedCount = useMemo(() => store.jobs.filter((j) => j.archived).length, [store.jobs]);
  const visibleJobs = useMemo(() => (showArchived ? sortedJobs : sortedJobs.filter((j) => !j.archived)), [sortedJobs, showArchived]);

  async function addJob() {
    if (!name.trim()) return;
    const initialHourlyRateCents = rate.trim() ? Math.round(parseFloat(rate) * 100) : null;
    await store.createJob({ name: name.trim(), colorHex: color, initialHourlyRateCents });
    setName("");
    setRate("");
  }

  function confirmDelete(job: Job) {
    if (window.confirm(`Delete "${job.name}"? Its recorded shifts stay in your history.`)) {
      store.deleteJob(job);
    }
  }

  return (
    <div className="screen">
      <section>
        <h3>Add a job</h3>
        <div className="form-row">
          <input placeholder="Job name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Hourly rate (optional)" value={rate} onChange={(e) => setRate(e.target.value)} style={{ maxWidth: 140 }} />
        </div>
        <div className="swatches">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch${c === color ? " selected" : ""}`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
              aria-label={c}
            />
          ))}
        </div>
        <button className="primary-button" onClick={addJob}>
          Add Job
        </button>
      </section>

      <section>
        <h3>Jobs</h3>
        {archivedCount > 0 && (
          <button className="link" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide Archived Jobs" : `Show Archived Jobs (${archivedCount})`}
          </button>
        )}
        {visibleJobs.length === 0 && (
          <p className="muted">
            {sortedJobs.length > 0 ? 'No active jobs — click "Show Archived Jobs" above to see archived ones.' : "No jobs yet. Add your first one above."}
          </p>
        )}
        {visibleJobs.map((job) => (
          <div key={job.id} className="row clickable" onClick={() => setEditingJob(job)}>
            <span className="dot" style={{ backgroundColor: job.colorHex }} />
            <div className="row-main">
              <div className={`row-title${job.archived ? " archived" : ""}`}>{job.name}</div>
              {activeRateLabel(store, job.id) && <div className="row-subtitle">{activeRateLabel(store, job.id)}</div>}
            </div>
            <button
              className="link-button"
              onClick={(e) => {
                e.stopPropagation();
                store.setJobArchived(job, !job.archived);
              }}
            >
              {job.archived ? "Unarchive" : "Archive"}
            </button>
            <button
              className="link-button muted"
              onClick={(e) => {
                e.stopPropagation();
                confirmDelete(job);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </section>

      {editingJob && <JobEditor job={store.jobs.find((j) => j.id === editingJob.id) ?? editingJob} onClose={() => setEditingJob(null)} />}
    </div>
  );
}

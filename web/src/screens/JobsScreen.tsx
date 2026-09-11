import { useState } from "react";
import type { Job } from "@clocker/shared";
import { JobEditor } from "../components/JobEditor";
import { useStore } from "../store";

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

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
        {store.jobs.length === 0 && <p className="muted">No jobs yet. Add your first one above.</p>}
        {store.jobs.map((job) => (
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

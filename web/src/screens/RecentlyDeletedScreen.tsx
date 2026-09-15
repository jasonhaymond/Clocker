import { formatClock, formatDay } from "@clocker/shared";
import { useStore } from "../store";

// See app/src/screens/RecentlyDeletedScreen.tsx's comment — same feature, same scope
// (jobs and shifts only), same "kept recoverable forever, nothing purged" model. The web
// store already receives every soft-deleted row on every pull (see store.tsx's refresh);
// this screen just renders the deletedJobs/deletedShifts arrays it already keeps.
export function RecentlyDeletedScreen({ onClose }: { onClose: () => void }) {
  const store = useStore();

  const jobById: Record<string, (typeof store.jobs)[number]> = {};
  for (const j of [...store.jobs, ...store.deletedJobs]) jobById[j.id] = j;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="link" onClick={onClose}>
          ← Back to Settings
        </button>
      </div>

      <section>
        <div className="row-title">Recently Deleted</div>
        <p className="hint">
          Deleted jobs and shifts stay here, recoverable, for as long as you keep them —
          nothing is ever purged automatically.
        </p>
      </section>

      <section>
        <div className="row-title">Jobs</div>
        {store.deletedJobs.length === 0 && <p className="muted">No deleted jobs.</p>}
        {store.deletedJobs.map((job) => (
          <div key={job.id} className="row">
            <span className="dot" style={{ backgroundColor: job.colorHex }} />
            <div className="row-main">
              <div className="row-title">{job.name}</div>
              <div className="row-subtitle">Deleted {formatDay(job.deletedAt!)}</div>
            </div>
            <button className="link" onClick={() => store.restoreJob(job)}>
              Restore
            </button>
          </div>
        ))}
      </section>

      <section>
        <div className="row-title">Shifts</div>
        {store.deletedShifts.length === 0 && <p className="muted">No deleted shifts.</p>}
        {store.deletedShifts.map((shift) => {
          const job = jobById[shift.jobId];
          return (
            <div key={shift.id} className="row">
              <span className="dot" style={{ backgroundColor: job?.colorHex ?? "var(--text-muted)" }} />
              <div className="row-main">
                <div className="row-title">
                  {job?.name ?? "Unknown job"}
                  {job?.deletedAt ? " (also deleted)" : ""}
                </div>
                <div className="row-subtitle">
                  {formatDay(shift.clockIn)} · {formatClock(shift.clockIn)} – {shift.clockOut ? formatClock(shift.clockOut) : "still open"}
                </div>
              </div>
              <button className="link" onClick={() => store.restoreShift(shift)}>
                Restore
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}

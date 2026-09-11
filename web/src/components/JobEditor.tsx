import { useState } from "react";
import {
  ROUNDING_INCREMENT_MINUTES,
  type Job,
  type PeriodType,
  type RateTier,
  type RoundingMode,
  type TimesheetExportFormat,
} from "@clocker/shared";
import { useStore } from "../store";

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];
const PERIOD_TYPES: { key: PeriodType; label: string }[] = [
  { key: "weekly", label: "Weekly" },
  { key: "biweekly", label: "Biweekly" },
  { key: "monthly", label: "Monthly" },
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FORMATS: { key: TimesheetExportFormat; label: string }[] = [
  { key: "csv", label: "CSV" },
  { key: "text", label: "Formatted text" },
  { key: "both", label: "Both" },
];
const ROUNDING_MODES: { key: RoundingMode; label: string }[] = [
  { key: "nearest", label: "Nearest" },
  { key: "up", label: "Up" },
  { key: "down", label: "Down" },
];
function incrementLabel(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60}hr` : `${minutes}min`;
}

function currentRateCents(store: ReturnType<typeof useStore>, tierId: string): number | null {
  const now = Date.now();
  let best: { effectiveFrom: string; hourlyRateCents: number } | null = null;
  for (const v of store.rateVersions) {
    if (v.tierId !== tierId) continue;
    if (new Date(v.effectiveFrom).getTime() > now) continue;
    if (!best || new Date(v.effectiveFrom).getTime() > new Date(best.effectiveFrom).getTime()) best = v;
  }
  return best ? best.hourlyRateCents : null;
}

function TierRow({ tier }: { tier: RateTier }) {
  const store = useStore();
  const [newRate, setNewRate] = useState("");
  const [editing, setEditing] = useState(false);
  const activeCents = currentRateCents(store, tier.id);

  async function saveRate() {
    const cents = Math.round(parseFloat(newRate) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    await store.addRateVersion(tier.id, cents);
    setNewRate("");
    setEditing(false);
  }

  return (
    <div className="row">
      <div className="row-main">
        <div className="row-title">
          {tier.name}
          {tier.isDefault ? " (default)" : ""}
        </div>
        <div className="row-subtitle">{activeCents != null ? `$${(activeCents / 100).toFixed(2)}/hr` : "No rate set"}</div>
      </div>
      {editing ? (
        <>
          <input className="tier-rate-input" placeholder="0.00" value={newRate} onChange={(e) => setNewRate(e.target.value)} autoFocus />
          <button className="link-button" onClick={saveRate}>
            Save
          </button>
        </>
      ) : (
        <button className="link-button" onClick={() => setEditing(true)}>
          Change rate
        </button>
      )}
      {!tier.isDefault && (
        <button className="link-button muted" onClick={() => store.setRateTierArchived(tier, !tier.archived)}>
          {tier.archived ? "Unarchive" : "Archive"}
        </button>
      )}
    </div>
  );
}

function ManagerAssignment({ jobId }: { jobId: string }) {
  const store = useStore();
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const assignments = store.jobManagers.filter((jm) => jm.jobId === jobId);
  const assignmentByManagerId = new Map(assignments.map((a) => [a.managerId, a]));

  async function toggle(managerId: string) {
    const existing = assignmentByManagerId.get(managerId);
    if (existing) await store.removeJobManager(existing);
    else await store.addJobManager(jobId, managerId);
  }

  async function addManager() {
    if (!newName.trim() || !newEmail.trim()) return;
    const manager = await store.createManager({ name: newName.trim(), email: newEmail.trim() });
    await store.addJobManager(jobId, manager.id);
    setNewName("");
    setNewEmail("");
  }

  function confirmDelete(managerId: string, name: string) {
    if (window.confirm(`Remove "${name}" everywhere (not just this job)?`)) {
      store.deleteManager(store.managers.find((m) => m.id === managerId)!);
    }
  }

  return (
    <>
      {store.managers.length === 0 && <p className="hint">No managers yet — add one below.</p>}
      {store.managers.map((m) => {
        const assigned = assignmentByManagerId.has(m.id);
        return (
          <div key={m.id} className="row">
            <label className="checkbox">
              <input type="checkbox" checked={assigned} onChange={() => toggle(m.id)} />
            </label>
            <div className="row-main">
              <div className={`row-title${m.archived ? " archived" : ""}`}>{m.name}</div>
              <div className="row-subtitle">{m.email}</div>
            </div>
            <button className="link-button" onClick={() => store.setManagerArchived(m, !m.archived)}>
              {m.archived ? "Unarchive" : "Archive"}
            </button>
            <button className="link-button muted" onClick={() => confirmDelete(m.id, m.name)}>
              Remove
            </button>
          </div>
        );
      })}
      <div className="form-row">
        <input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
      </div>
      <button className="secondary-button" onClick={addManager}>
        + Add Manager
      </button>
    </>
  );
}

export function JobEditor({ job, onClose }: { job: Job; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState(job.name);
  const [overtimeEnabled, setOvertimeEnabled] = useState(job.overtimeMultiplier != null);
  const [multiplier, setMultiplier] = useState(job.overtimeMultiplier != null ? String(job.overtimeMultiplier) : "1.5");
  const [threshold, setThreshold] = useState(job.overtimeWeeklyThresholdHours != null ? String(job.overtimeWeeklyThresholdHours) : "40");
  const [newTierName, setNewTierName] = useState("");
  const [newTierRate, setNewTierRate] = useState("");

  const tiers = store.rateTiers.filter((t) => t.jobId === job.id);

  async function saveName() {
    if (name.trim() && name.trim() !== job.name) await store.updateJobDetails(job, { name: name.trim() });
  }

  async function saveColor(c: string) {
    await store.updateJobDetails(job, { colorHex: c });
  }

  async function addTier() {
    if (!newTierName.trim()) return;
    const cents = newTierRate.trim() ? Math.round(parseFloat(newTierRate) * 100) : null;
    await store.createRateTier(job.id, newTierName.trim(), cents, false);
    setNewTierName("");
    setNewTierRate("");
  }

  async function saveOvertime(enabled: boolean, mult: string, thresh: string) {
    if (!enabled) {
      await store.updateJobOvertime(job, { overtimeMultiplier: null, overtimeWeeklyThresholdHours: null });
      return;
    }
    const multValue = parseFloat(mult);
    const threshValue = parseFloat(thresh);
    if (!Number.isFinite(multValue) || !Number.isFinite(threshValue)) return;
    await store.updateJobOvertime(job, { overtimeMultiplier: multValue, overtimeWeeklyThresholdHours: threshValue });
  }

  async function saveRounding(patch: Partial<Pick<Job, "roundingEnabled" | "roundingMode" | "roundingIncrementMinutes">>) {
    await store.updateJobRounding(job, {
      roundingEnabled: patch.roundingEnabled ?? job.roundingEnabled,
      roundingMode: patch.roundingMode ?? job.roundingMode,
      roundingIncrementMinutes: patch.roundingIncrementMinutes ?? job.roundingIncrementMinutes,
    });
  }

  async function saveTimesheet(patch: Parameters<typeof store.updateJobTimesheetSettings>[1]) {
    await store.updateJobTimesheetSettings(job, patch);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card-large">
        <div className="modal-header">
          <h2>Edit Job</h2>
          <button className="link-button" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="modal-scroll">
          <h4>Name</h4>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} />

          <h4>Color</h4>
          <div className="swatches">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`swatch${c === job.colorHex ? " selected" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => saveColor(c)}
                aria-label={c}
              />
            ))}
          </div>

          <h4>Rates</h4>
          {tiers.map((tier) => (
            <TierRow key={tier.id} tier={tier} />
          ))}
          <div className="form-row">
            <input placeholder="New rate name (e.g. Holiday)" value={newTierName} onChange={(e) => setNewTierName(e.target.value)} />
            <input placeholder="$/hr" value={newTierRate} onChange={(e) => setNewTierRate(e.target.value)} style={{ maxWidth: 90 }} />
          </div>
          <button className="secondary-button" onClick={addTier}>
            + Add Rate Tier
          </button>

          <div className="switch-row">
            <h4>Weekly overtime</h4>
            <label className="switch">
              <input
                type="checkbox"
                checked={overtimeEnabled}
                onChange={(e) => {
                  setOvertimeEnabled(e.target.checked);
                  saveOvertime(e.target.checked, multiplier, threshold);
                }}
              />
              <span className="switch-track" />
            </label>
          </div>
          {overtimeEnabled && (
            <div className="form-row">
              <div style={{ flex: 1 }}>
                <label className="hint">Threshold (hrs/week)</label>
                <input
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  onBlur={() => saveOvertime(overtimeEnabled, multiplier, threshold)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="hint">Multiplier</label>
                <input
                  value={multiplier}
                  onChange={(e) => setMultiplier(e.target.value)}
                  onBlur={() => saveOvertime(overtimeEnabled, multiplier, threshold)}
                />
              </div>
            </div>
          )}
          <p className="hint">Hours worked on this job beyond the threshold in a given week are paid at rate × multiplier.</p>

          <div className="switch-row">
            <h4>Round time entries</h4>
            <label className="switch">
              <input type="checkbox" checked={job.roundingEnabled} onChange={(e) => saveRounding({ roundingEnabled: e.target.checked })} />
              <span className="switch-track" />
            </label>
          </div>
          {job.roundingEnabled && (
            <>
              <p className="hint">Round to nearest</p>
              <div className="chip-row">
                {ROUNDING_INCREMENT_MINUTES.map((m) => (
                  <button
                    key={m}
                    className={`chip${job.roundingIncrementMinutes === m ? " selected" : ""}`}
                    onClick={() => saveRounding({ roundingIncrementMinutes: m })}
                  >
                    {incrementLabel(m)}
                  </button>
                ))}
              </div>
              <p className="hint">Direction</p>
              <div className="chip-row">
                {ROUNDING_MODES.map((m) => (
                  <button
                    key={m.key}
                    className={`chip${job.roundingMode === m.key ? " selected" : ""}`}
                    onClick={() => saveRounding({ roundingMode: m.key })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="hint">
            Rounds each clock-in/out to the nearest increment before computing hours and pay, like a physical timeclock. The actual
            punch times you recorded are never changed.
          </p>

          <h4>Timesheet period</h4>
          <div className="chip-row">
            {PERIOD_TYPES.map((p) => (
              <button
                key={p.key}
                className={`chip${job.timesheetPeriodType === p.key ? " selected" : ""}`}
                onClick={() => saveTimesheet({ timesheetPeriodType: p.key })}
              >
                {p.label}
              </button>
            ))}
          </div>

          {(job.timesheetPeriodType === "weekly" || job.timesheetPeriodType === "biweekly") && (
            <>
              <p className="hint">Period starts on</p>
              <div className="chip-row">
                {WEEKDAYS.map((d, i) => (
                  <button
                    key={d}
                    className={`chip${job.timesheetWeekStartDay === i ? " selected" : ""}`}
                    onClick={() => saveTimesheet({ timesheetWeekStartDay: i })}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}
          {job.timesheetPeriodType === "biweekly" && (
            <>
              <p className="hint">First day of a current period (fixes which week pairs with which)</p>
              <input
                type="date"
                value={job.timesheetBiweeklyAnchor.slice(0, 10)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  saveTimesheet({ timesheetBiweeklyAnchor: new Date(e.target.value).toISOString() });
                }}
              />
            </>
          )}
          {job.timesheetPeriodType === "monthly" && (
            <>
              <p className="hint">Day of month period starts (1-28)</p>
              <input
                type="number"
                min={1}
                max={28}
                value={job.timesheetMonthlyStartDay}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(28, parseInt(e.target.value, 10) || 1));
                  saveTimesheet({ timesheetMonthlyStartDay: n });
                }}
              />
            </>
          )}

          <h4>Include in timesheet</h4>
          <div className="switch-row">
            <span className="hint">Earnings</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={job.timesheetIncludeEarnings}
                onChange={(e) => saveTimesheet({ timesheetIncludeEarnings: e.target.checked })}
              />
              <span className="switch-track" />
            </label>
          </div>
          <div className="switch-row">
            <span className="hint">Notes</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={job.timesheetIncludeNotes}
                onChange={(e) => saveTimesheet({ timesheetIncludeNotes: e.target.checked })}
              />
              <span className="switch-track" />
            </label>
          </div>
          <div className="switch-row">
            <span className="hint">Start/end times</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={job.timesheetIncludeTimes}
                onChange={(e) => saveTimesheet({ timesheetIncludeTimes: e.target.checked })}
              />
              <span className="switch-track" />
            </label>
          </div>

          <h4>Submission format</h4>
          <div className="chip-row">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                className={`chip${job.timesheetFormat === f.key ? " selected" : ""}`}
                onClick={() => saveTimesheet({ timesheetFormat: f.key })}
              >
                {f.label}
              </button>
            ))}
          </div>

          <h4>Submit to</h4>
          <ManagerAssignment jobId={job.id} />
        </div>
      </div>
    </div>
  );
}

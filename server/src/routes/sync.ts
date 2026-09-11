import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth.js";

// Sync protocol: the client keeps a local SQLite mirror of jobs/rateTiers/rateVersions/
// shifts/breaks and a `lastSyncedAt` cursor. `push` upserts (by client-generated uuid)
// whatever the client changed since the last sync and soft-deletes whatever it removed.
// `pull` returns every row (including tombstones) whose `updatedAt` is newer than `since`,
// which the client then merges into its local mirror. Conflicts resolve last-write-wins
// on `updatedAt`. See docs/sync-protocol.md for the full writeup.

const jobInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  colorHex: z.string(),
  archived: z.boolean().optional(),
  overtimeMultiplier: z.number().positive().nullable().optional(),
  overtimeWeeklyThresholdHours: z.number().positive().nullable().optional(),
  timesheetPeriodType: z.enum(["weekly", "biweekly", "monthly"]).optional(),
  timesheetWeekStartDay: z.number().int().min(0).max(6).optional(),
  timesheetBiweeklyAnchor: z.string().datetime().optional(),
  timesheetMonthlyStartDay: z.number().int().min(1).max(28).optional(),
  timesheetFormat: z.enum(["csv", "text", "both"]).optional(),
  timesheetIncludeEarnings: z.boolean().optional(),
  timesheetIncludeNotes: z.boolean().optional(),
  timesheetIncludeTimes: z.boolean().optional(),
  roundingEnabled: z.boolean().optional(),
  roundingMode: z.enum(["up", "down", "nearest"]).optional(),
  roundingIncrementMinutes: z.union([
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(20),
    z.literal(30),
    z.literal(60),
    z.literal(120),
  ]).optional(),
  promptForNotesOnClockOut: z.boolean().optional(),
});

const rateTierInput = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  name: z.string().min(1),
  isDefault: z.boolean().optional(),
  archived: z.boolean().optional(),
});

const rateVersionInput = z.object({
  id: z.string().uuid(),
  tierId: z.string().uuid(),
  hourlyRateCents: z.number().int(),
  effectiveFrom: z.string().datetime(),
});

const shiftInput = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  rateTierId: z.string().uuid().nullable().optional(),
  clockIn: z.string().datetime(),
  clockOut: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const breakInput = z.object({
  id: z.string().uuid(),
  shiftId: z.string().uuid(),
  start: z.string().datetime(),
  end: z.string().datetime().nullable().optional(),
});

const managerInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  archived: z.boolean().optional(),
});

// Assigns a manager as a timesheet-submission recipient for a job. A plain join row (see
// server/prisma/schema.prisma's JobManager) — no fields of its own beyond the two ids.
const jobManagerInput = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  managerId: z.string().uuid(),
});

const pushSchema = z.object({
  jobs: z.array(jobInput).default([]),
  rateTiers: z.array(rateTierInput).default([]),
  rateVersions: z.array(rateVersionInput).default([]),
  shifts: z.array(shiftInput).default([]),
  breaks: z.array(breakInput).default([]),
  managers: z.array(managerInput).default([]),
  jobManagers: z.array(jobManagerInput).default([]),
  deletedJobIds: z.array(z.string().uuid()).default([]),
  deletedRateTierIds: z.array(z.string().uuid()).default([]),
  deletedRateVersionIds: z.array(z.string().uuid()).default([]),
  deletedShiftIds: z.array(z.string().uuid()).default([]),
  deletedBreakIds: z.array(z.string().uuid()).default([]),
  deletedManagerIds: z.array(z.string().uuid()).default([]),
  deletedJobManagerIds: z.array(z.string().uuid()).default([]),
});

// Update the row if this user already owns it, otherwise create it under this user.
// Prevents one account from overwriting rows it doesn't own via a guessed/duplicate id.
async function upsertOwnedJob(userId: string, data: z.infer<typeof jobInput>) {
  const { id, timesheetBiweeklyAnchor, ...rest } = data;
  const fields = {
    ...rest,
    ...(timesheetBiweeklyAnchor !== undefined ? { timesheetBiweeklyAnchor: new Date(timesheetBiweeklyAnchor) } : {}),
  };
  const updated = await prisma.job.updateMany({ where: { id, userId }, data: fields });
  if (updated.count === 0) {
    await prisma.job.create({ data: { id, userId, ...fields } });
  }
}

async function upsertOwnedRateTier(userId: string, data: z.infer<typeof rateTierInput>) {
  const { id, jobId, ...fields } = data;
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!job) return; // silently drop tiers referencing a job we don't own
  const updated = await prisma.rateTier.updateMany({ where: { id, job: { userId } }, data: fields });
  if (updated.count === 0) {
    await prisma.rateTier.create({ data: { id, jobId, ...fields } });
  }
}

async function upsertOwnedRateVersion(userId: string, data: z.infer<typeof rateVersionInput>) {
  const { id, tierId, hourlyRateCents, effectiveFrom } = data;
  const tier = await prisma.rateTier.findFirst({ where: { id: tierId, job: { userId } } });
  if (!tier) return; // silently drop versions referencing a tier we don't own
  const fields = { tierId, hourlyRateCents, effectiveFrom: new Date(effectiveFrom) };
  const updated = await prisma.rateVersion.updateMany({ where: { id, tier: { job: { userId } } }, data: fields });
  if (updated.count === 0) {
    await prisma.rateVersion.create({ data: { id, ...fields } });
  }
}

async function upsertOwnedShift(userId: string, data: z.infer<typeof shiftInput>) {
  const { id, jobId, rateTierId, clockIn, clockOut, notes } = data;
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!job) return; // silently drop shifts referencing a job we don't own
  if (rateTierId) {
    const tier = await prisma.rateTier.findFirst({ where: { id: rateTierId, jobId } });
    if (!tier) return; // silently drop shifts referencing a tier that isn't this job's
  }
  const fields = {
    jobId,
    rateTierId: rateTierId ?? null,
    clockIn: new Date(clockIn),
    clockOut: clockOut ? new Date(clockOut) : null,
    notes: notes ?? null,
  };
  const updated = await prisma.shift.updateMany({ where: { id, userId }, data: fields });
  if (updated.count === 0) {
    await prisma.shift.create({ data: { id, userId, ...fields } });
  }
}

async function upsertOwnedBreak(userId: string, data: z.infer<typeof breakInput>) {
  const { id, shiftId, start, end } = data;
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, userId } });
  if (!shift) return; // silently drop breaks referencing a shift we don't own
  const fields = { shiftId, start: new Date(start), end: end ? new Date(end) : null };
  const updated = await prisma.break.updateMany({
    where: { id, shift: { userId } },
    data: fields,
  });
  if (updated.count === 0) {
    await prisma.break.create({ data: { id, ...fields } });
  }
}

async function upsertOwnedManager(userId: string, data: z.infer<typeof managerInput>) {
  const { id, ...fields } = data;
  const updated = await prisma.manager.updateMany({ where: { id, userId }, data: fields });
  if (updated.count === 0) {
    await prisma.manager.create({ data: { id, userId, ...fields } });
  }
}

async function upsertOwnedJobManager(userId: string, data: z.infer<typeof jobManagerInput>) {
  const { id, jobId, managerId } = data;
  const [job, manager] = await Promise.all([
    prisma.job.findFirst({ where: { id: jobId, userId } }),
    prisma.manager.findFirst({ where: { id: managerId, userId } }),
  ]);
  if (!job || !manager) return; // silently drop assignments referencing a job/manager we don't own
  const fields = { jobId, managerId };
  const updated = await prisma.jobManager.updateMany({ where: { id, job: { userId } }, data: fields });
  if (updated.count === 0) {
    await prisma.jobManager.create({ data: { id, ...fields } });
  }
}

export async function syncRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.post("/sync/push", async (request, reply) => {
    const parsed = pushSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const userId = request.userId as string;
    const {
      jobs,
      rateTiers,
      rateVersions,
      shifts,
      breaks,
      managers,
      jobManagers,
      deletedJobIds,
      deletedRateTierIds,
      deletedRateVersionIds,
      deletedShiftIds,
      deletedBreakIds,
      deletedManagerIds,
      deletedJobManagerIds,
    } = parsed.data;

    // Order matters: jobs before tiers before versions before shifts before breaks, so
    // each upsert's ownership check finds its parent already written this same push.
    // Managers have no dependency on the others, so their order doesn't matter, but
    // jobManagers depends on both a job and a manager already existing, so it goes last.
    for (const job of jobs) await upsertOwnedJob(userId, job);
    for (const tier of rateTiers) await upsertOwnedRateTier(userId, tier);
    for (const version of rateVersions) await upsertOwnedRateVersion(userId, version);
    for (const shift of shifts) await upsertOwnedShift(userId, shift);
    for (const brk of breaks) await upsertOwnedBreak(userId, brk);
    for (const manager of managers) await upsertOwnedManager(userId, manager);
    for (const jobManager of jobManagers) await upsertOwnedJobManager(userId, jobManager);

    if (deletedJobManagerIds.length) {
      await prisma.jobManager.updateMany({
        where: { id: { in: deletedJobManagerIds }, job: { userId } },
        data: { deletedAt: new Date() },
      });
    }
    if (deletedManagerIds.length) {
      await prisma.manager.updateMany({ where: { id: { in: deletedManagerIds }, userId }, data: { deletedAt: new Date() } });
    }
    if (deletedJobIds.length) {
      await prisma.job.updateMany({ where: { id: { in: deletedJobIds }, userId }, data: { deletedAt: new Date() } });
    }
    if (deletedRateTierIds.length) {
      await prisma.rateTier.updateMany({
        where: { id: { in: deletedRateTierIds }, job: { userId } },
        data: { deletedAt: new Date() },
      });
    }
    if (deletedRateVersionIds.length) {
      await prisma.rateVersion.updateMany({
        where: { id: { in: deletedRateVersionIds }, tier: { job: { userId } } },
        data: { deletedAt: new Date() },
      });
    }
    if (deletedShiftIds.length) {
      await prisma.shift.updateMany({ where: { id: { in: deletedShiftIds }, userId }, data: { deletedAt: new Date() } });
    }
    if (deletedBreakIds.length) {
      await prisma.break.updateMany({
        where: { id: { in: deletedBreakIds }, shift: { userId } },
        data: { deletedAt: new Date() },
      });
    }

    return reply.send({ serverTimestamp: new Date().toISOString() });
  });

  app.get("/sync/pull", async (request, reply) => {
    const query = z.object({ since: z.string().datetime().optional() }).safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten() });
    }
    const userId = request.userId as string;
    const since = query.data.since ? new Date(query.data.since) : new Date(0);
    const serverTimestamp = new Date();

    const [jobs, rateTiers, rateVersions, shifts, breaks, managers, jobManagers] = await Promise.all([
      prisma.job.findMany({ where: { userId, updatedAt: { gt: since } } }),
      prisma.rateTier.findMany({ where: { job: { userId }, updatedAt: { gt: since } } }),
      prisma.rateVersion.findMany({ where: { tier: { job: { userId } }, updatedAt: { gt: since } } }),
      prisma.shift.findMany({ where: { userId, updatedAt: { gt: since } } }),
      prisma.break.findMany({ where: { shift: { userId }, updatedAt: { gt: since } } }),
      prisma.manager.findMany({ where: { userId, updatedAt: { gt: since } } }),
      prisma.jobManager.findMany({ where: { job: { userId }, updatedAt: { gt: since } } }),
    ]);

    return reply.send({
      serverTimestamp: serverTimestamp.toISOString(),
      jobs,
      rateTiers,
      rateVersions,
      shifts,
      breaks,
      managers,
      jobManagers,
    });
  });
}

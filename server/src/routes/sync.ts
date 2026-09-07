import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth.js";

// Sync protocol: the client keeps a local SQLite mirror of jobs/shifts/breaks and a
// `lastSyncedAt` cursor. `push` upserts (by client-generated uuid) whatever the client
// changed since the last sync and soft-deletes whatever it removed. `pull` returns every
// row (including tombstones) whose `updatedAt` is newer than `since`, which the client
// then merges into its local mirror. Conflicts resolve last-write-wins on `updatedAt`.

const jobInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  colorHex: z.string(),
  hourlyRateCents: z.number().int().nullable().optional(),
  archived: z.boolean().optional(),
});

const shiftInput = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
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

const pushSchema = z.object({
  jobs: z.array(jobInput).default([]),
  shifts: z.array(shiftInput).default([]),
  breaks: z.array(breakInput).default([]),
  deletedJobIds: z.array(z.string().uuid()).default([]),
  deletedShiftIds: z.array(z.string().uuid()).default([]),
  deletedBreakIds: z.array(z.string().uuid()).default([]),
});

// Update the row if this user already owns it, otherwise create it under this user.
// Prevents one account from overwriting rows it doesn't own via a guessed/duplicate id.
async function upsertOwnedJob(userId: string, data: z.infer<typeof jobInput>) {
  const { id, ...fields } = data;
  const updated = await prisma.job.updateMany({ where: { id, userId }, data: fields });
  if (updated.count === 0) {
    await prisma.job.create({ data: { id, userId, ...fields } });
  }
}

async function upsertOwnedShift(userId: string, data: z.infer<typeof shiftInput>) {
  const { id, jobId, clockIn, clockOut, notes } = data;
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!job) return; // silently drop shifts referencing a job we don't own
  const fields = { jobId, clockIn: new Date(clockIn), clockOut: clockOut ? new Date(clockOut) : null, notes: notes ?? null };
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

export async function syncRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.post("/sync/push", async (request, reply) => {
    const parsed = pushSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const userId = request.userId as string;
    const { jobs, shifts, breaks, deletedJobIds, deletedShiftIds, deletedBreakIds } = parsed.data;

    for (const job of jobs) await upsertOwnedJob(userId, job);
    for (const shift of shifts) await upsertOwnedShift(userId, shift);
    for (const brk of breaks) await upsertOwnedBreak(userId, brk);

    if (deletedJobIds.length) {
      await prisma.job.updateMany({ where: { id: { in: deletedJobIds }, userId }, data: { deletedAt: new Date() } });
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

    const [jobs, shifts, breaks] = await Promise.all([
      prisma.job.findMany({ where: { userId, updatedAt: { gt: since } } }),
      prisma.shift.findMany({ where: { userId, updatedAt: { gt: since } } }),
      prisma.break.findMany({ where: { shift: { userId }, updatedAt: { gt: since } } }),
    ]);

    return reply.send({ serverTimestamp: serverTimestamp.toISOString(), jobs, shifts, breaks });
  });
}

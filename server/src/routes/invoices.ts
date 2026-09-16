import { formatCents, groupShiftsByJob, roundedWorkedMillis, type Break, type Job, type RateTier, type RateVersion, type Shift } from "@clocker/shared";
import type { FastifyInstance } from "fastify";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { publicBaseUrl } from "../lib/publicUrl.js";

// Invoices are the one part of this app meant to be viewed by someone who doesn't have a
// Clocker account at all (a client) — see docs/data-model.md's Invoice model comment and
// docs/architecture.md for the full reasoning. Two authenticated routes create/list them;
// two public routes (keyed by an unguessable shareToken, not a login) serve the result.

function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

const createInvoiceSchema = z.object({
  jobId: z.string().uuid(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  rangeLabel: z.string().min(1),
});

// Loads everything groupShiftsByJob (shared/src/exportFormat.ts) needs for one job's
// shifts in a date range, and maps Prisma's Date fields to the ISO strings the shared,
// framework-free calculation layer expects — the same shape app/ and web/ already hand
// it, just sourced from Postgres instead of SQLite/the web store.
async function loadJobDataForInvoice(userId: string, jobId: string, periodStart: Date, periodEnd: Date) {
  const jobRow = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!jobRow) return null;

  const [shiftRows, tierRows] = await Promise.all([
    prisma.shift.findMany({
      where: { jobId, userId, deletedAt: null, clockIn: { gte: periodStart, lt: periodEnd } },
      orderBy: { clockIn: "asc" },
    }),
    prisma.rateTier.findMany({ where: { jobId, deletedAt: null } }),
  ]);
  const versionRows = tierRows.length
    ? await prisma.rateVersion.findMany({ where: { tierId: { in: tierRows.map((t) => t.id) }, deletedAt: null } })
    : [];
  const breakRows = shiftRows.length
    ? await prisma.break.findMany({ where: { shiftId: { in: shiftRows.map((s) => s.id) }, deletedAt: null } })
    : [];

  const job: Job = {
    ...jobRow,
    timesheetBiweeklyAnchor: jobRow.timesheetBiweeklyAnchor.toISOString(),
    timesheetPeriodType: jobRow.timesheetPeriodType as Job["timesheetPeriodType"],
    timesheetFormat: jobRow.timesheetFormat as Job["timesheetFormat"],
    roundingMode: jobRow.roundingMode as Job["roundingMode"],
    updatedAt: jobRow.updatedAt.toISOString(),
    deletedAt: toIso(jobRow.deletedAt),
  };
  const tiers: RateTier[] = tierRows.map((t) => ({ ...t, updatedAt: t.updatedAt.toISOString(), deletedAt: toIso(t.deletedAt) }));
  const versions: RateVersion[] = versionRows.map((v) => ({
    ...v,
    effectiveFrom: v.effectiveFrom.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    deletedAt: toIso(v.deletedAt),
  }));
  const shifts: Shift[] = shiftRows.map((s) => ({
    ...s,
    clockIn: s.clockIn.toISOString(),
    clockOut: toIso(s.clockOut),
    updatedAt: s.updatedAt.toISOString(),
    deletedAt: toIso(s.deletedAt),
  }));
  const breaksByShift: Record<string, Break[]> = {};
  for (const b of breakRows) {
    const mapped: Break = { ...b, start: b.start.toISOString(), end: toIso(b.end), updatedAt: b.updatedAt.toISOString(), deletedAt: toIso(b.deletedAt) };
    (breaksByShift[b.shiftId] ??= []).push(mapped);
  }

  return { job, tiers, versions, shifts, breaksByShift };
}

// A one-page invoice PDF built directly with pdfkit's drawing primitives — no headless
// browser (see the plan this shipped from for why: this project is meant to self-host in
// a small Docker container, and a Chromium dependency would meaningfully bloat every
// self-hoster's image for a document this simple).
function renderInvoicePdf(invoice: {
  jobName: string;
  jobColorHex: string;
  rangeLabel: string;
  createdAt: Date;
  lineItems: { date: string; hours: number; cents: number | null }[];
  totalHours: number;
  totalCents: number;
}): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: 50 });
  doc.fontSize(20).fillColor(invoice.jobColorHex).text(invoice.jobName, { continued: false });
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor("#444").text(`Invoice for ${invoice.rangeLabel}`);
  doc.fontSize(9).fillColor("#888").text(`Generated ${invoice.createdAt.toLocaleDateString()}`);
  doc.moveDown(1);

  const tableTop = doc.y;
  doc.fontSize(10).fillColor("#333");
  doc.text("Date", 50, tableTop, { width: 200 });
  doc.text("Hours", 300, tableTop, { width: 80, align: "right" });
  doc.text("Amount", 420, tableTop, { width: 100, align: "right" });
  doc.moveTo(50, tableTop + 16).lineTo(520, tableTop + 16).strokeColor("#333").stroke();

  let y = tableTop + 24;
  doc.fontSize(10).fillColor("#111");
  for (const item of invoice.lineItems) {
    doc.text(item.date, 50, y, { width: 200 });
    doc.text(item.hours.toFixed(2), 300, y, { width: 80, align: "right" });
    doc.text(item.cents != null ? formatCents(item.cents) : "", 420, y, { width: 100, align: "right" });
    y += 18;
  }
  doc.moveTo(50, y + 4).lineTo(520, y + 4).strokeColor("#333").stroke();
  doc.fontSize(12).fillColor("#111");
  doc.text("Total", 300, y + 12, { width: 80, align: "right" });
  doc.text(`${invoice.totalHours.toFixed(2)} hrs`, 300, y + 30, { width: 80, align: "right" });
  doc.text(formatCents(invoice.totalCents), 420, y + 12, { width: 100, align: "right" });

  doc.end();
  return doc;
}

export async function invoiceRoutes(app: FastifyInstance) {
  app.post("/invoices", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createInvoiceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = request.userId as string;
    const { jobId, rangeLabel } = parsed.data;
    const periodStart = new Date(parsed.data.periodStart);
    const periodEnd = new Date(parsed.data.periodEnd);

    const data = await loadJobDataForInvoice(userId, jobId, periodStart, periodEnd);
    if (!data) return reply.code(404).send({ error: "Job not found" });
    const { job, tiers, versions, shifts, breaksByShift } = data;

    const { groups, payByShiftId } = groupShiftsByJob({ shifts, jobsById: { [job.id]: job }, tiers, versions, breaksByShift });
    const group = groups[0];
    const lineItems = (group?.shifts ?? []).map((shift) => {
      const pay = payByShiftId.get(shift.id);
      const hours = pay ? pay.regularHours + pay.overtimeHours : roundedWorkedMillis(shift, breaksByShift[shift.id] ?? [], job) / 3_600_000;
      return {
        date: new Date(shift.clockIn).toLocaleDateString(),
        hours,
        cents: pay && pay.rateCentsPerHour != null ? pay.totalCents : null,
        notes: shift.notes,
      };
    });

    const invoice = await prisma.invoice.create({
      data: {
        userId,
        jobId: job.id,
        periodStart,
        periodEnd,
        rangeLabel,
        jobName: job.name,
        jobColorHex: job.colorHex,
        lineItems,
        totalHours: group?.totalHours ?? 0,
        totalCents: group?.totalCents ?? 0,
      },
    });

    return { ...invoice, shareUrl: `${publicBaseUrl(request)}/invoices/${invoice.shareToken}` };
  });

  app.get("/invoices", { preHandler: requireAuth }, async (request, reply) => {
    const query = z.object({ jobId: z.string().uuid() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() });
    const userId = request.userId as string;
    const invoices = await prisma.invoice.findMany({
      where: { userId, jobId: query.data.jobId },
      orderBy: { createdAt: "desc" },
    });
    return invoices.map((invoice) => ({ ...invoice, shareUrl: `${publicBaseUrl(request)}/invoices/${invoice.shareToken}` }));
  });

  // Public — no requireAuth. shareToken (a UUID) is the only credential; anyone with the
  // link can view this one invoice, same trust model as a payment-link URL.
  app.get(
    "/invoices/:shareToken",
    { config: { rateLimit: { max: 60, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const params = z.object({ shareToken: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: "Invoice not found" });
      const invoice = await prisma.invoice.findUnique({ where: { shareToken: params.data.shareToken } });
      if (!invoice) return reply.code(404).send({ error: "Invoice not found" });

      const lineItems = invoice.lineItems as { date: string; hours: number; cents: number | null; notes: string | null }[];
      const rows = lineItems
        .map(
          (item) =>
            `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;">${item.date}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;">${item.hours.toFixed(2)}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;">${item.cents != null ? formatCents(item.cents) : ""}</td></tr>`,
        )
        .join("");

      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice — ${invoice.jobName}</title></head>
        <body style="font-family:sans-serif;color:#111;max-width:640px;margin:40px auto;padding:0 16px;">
          <h1 style="color:${invoice.jobColorHex};margin-bottom:4px;">${invoice.jobName}</h1>
          <p style="color:#444;">Invoice for ${invoice.rangeLabel}</p>
          <table style="border-collapse:collapse;width:100%;">
            <thead><tr>
              <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #333;">Date</th>
              <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #333;">Hours</th>
              <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #333;">Amount</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="font-size:18px;text-align:right;margin-top:12px;"><strong>Total: ${invoice.totalHours.toFixed(2)} hrs &middot; ${formatCents(invoice.totalCents)}</strong></p>
          <p><a href="./${invoice.shareToken}/pdf" style="display:inline-block;margin-top:16px;padding:10px 18px;background:${invoice.jobColorHex};color:#fff;text-decoration:none;border-radius:8px;">Download PDF</a></p>
        </body></html>`;

      reply.type("text/html").send(html);
    },
  );

  app.get(
    "/invoices/:shareToken/pdf",
    { config: { rateLimit: { max: 60, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const params = z.object({ shareToken: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: "Invoice not found" });
      const invoice = await prisma.invoice.findUnique({ where: { shareToken: params.data.shareToken } });
      if (!invoice) return reply.code(404).send({ error: "Invoice not found" });

      const doc = renderInvoicePdf({
        jobName: invoice.jobName,
        jobColorHex: invoice.jobColorHex,
        rangeLabel: invoice.rangeLabel,
        createdAt: invoice.createdAt,
        lineItems: invoice.lineItems as { date: string; hours: number; cents: number | null }[],
        totalHours: invoice.totalHours,
        totalCents: invoice.totalCents,
      });
      reply.type("application/pdf").header("Content-Disposition", `inline; filename="invoice-${invoice.jobName}.pdf"`);
      return reply.send(doc);
    },
  );
}

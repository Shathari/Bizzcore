import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { listCategories, ensureBuiltInCategories } from "../lib/customerCategories";

// Tenant-scoped customer/booking categorization management — lets a tenant
// Admin add, rename, and delete their own categories instead of being
// limited to a hardcoded Regular/VIP/Bridal set. See
// lib/customerCategories.ts and schema.prisma's CustomerCategory comment for
// why Customer.segment/ScheduledContent.targetSegment store a category's
// `name` directly rather than a foreign key to this table.
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

router.get("/", async (req, res) => {
  const categories = await listCategories(req.tenantId!); // tenant-scoped
  res.json(categories);
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(50),
  isPriority: z.boolean().optional(),
});

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const tenantId = req.tenantId!;
  await ensureBuiltInCategories(tenantId);

  const existing = await prisma.customerCategory.findMany({ where: { tenantId }, select: { name: true } });
  if (existing.some((c) => c.name.toLowerCase() === parsed.data.name.toLowerCase())) {
    res.status(400).json({ error: `A category named "${parsed.data.name}" already exists.` });
    return;
  }

  const category = await prisma.customerCategory.create({
    data: {
      tenantId, // tenant-scoped
      name: parsed.data.name,
      isPriority: parsed.data.isPriority ?? false,
      isBuiltIn: false,
      sortOrder: existing.length,
    },
  });
  res.status(201).json(category);
});

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(50).optional(),
  isPriority: z.boolean().optional(),
});

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const tenantId = req.tenantId!;

  const existing = await prisma.customerCategory.findFirst({
    where: { id: req.params.id, tenantId }, // tenant-scoped
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const newName = parsed.data.name?.trim();
  const renaming = newName !== undefined && newName !== existing.name;

  if (renaming) {
    const others = await prisma.customerCategory.findMany({
      where: { tenantId, id: { not: existing.id } },
      select: { name: true },
    });
    if (others.some((c) => c.name.toLowerCase() === newName!.toLowerCase())) {
      res.status(400).json({ error: `A category named "${newName}" already exists.` });
      return;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const category = await tx.customerCategory.update({
      where: { id: existing.id }, // tenant-scoped (existence already verified above)
      data: {
        name: newName ?? undefined,
        isPriority: parsed.data.isPriority ?? undefined,
      },
    });

    // Category name is stored as a plain string on Customer.segment /
    // ScheduledContent.targetSegment (see schema.prisma's comment on why),
    // so a rename has to propagate to every row currently carrying the old
    // name — otherwise they'd silently point at a name that no longer
    // exists as a category.
    if (renaming) {
      await tx.customer.updateMany({
        where: { tenantId, segment: existing.name },
        data: { segment: category.name },
      });
      await tx.scheduledContent.updateMany({
        where: { tenantId, targetSegment: existing.name },
        data: { targetSegment: category.name },
      });
    }

    return category;
  });

  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const tenantId = req.tenantId!;
  const existing = await prisma.customerCategory.findFirst({
    where: { id: req.params.id, tenantId }, // tenant-scoped
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const inUse = await prisma.customer.count({ where: { tenantId, segment: existing.name } });
  if (inUse > 0) {
    res.status(400).json({
      error: `${inUse} customer${inUse === 1 ? "" : "s"} ${inUse === 1 ? "is" : "are"} using this category — reassign them first.`,
    });
    return;
  }

  await prisma.customerCategory.delete({ where: { id: existing.id } }); // tenant-scoped (existence already verified above)
  res.status(204).send();
});

export default router;

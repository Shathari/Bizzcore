import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { passwordSchema } from "../lib/password";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { resolveTenant } from "../middleware/resolveTenant";
import { requirePasswordSet } from "../middleware/requirePasswordSet";

const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));
const select = { id: true, name: true, email: true, disabledAt: true, createdAt: true, mustChangePassword: true } as const;
const createSchema = z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(254), temporaryPassword: passwordSchema }).strict();
router.get("/", async (req, res) => {
  res.json(await prisma.user.findMany({ where: { tenantId: req.tenantId!, role: "EMPLOYEE" }, select, orderBy: { createdAt: "desc" } }));
});
router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a name, valid email and password of at least 8 characters and at most 72 UTF-8 bytes. Do not supply role or tenant." }); return; }
  const { name, email, temporaryPassword } = parsed.data;
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  try {
    const employee = await prisma.user.create({ data: { name, email: email.toLowerCase(), passwordHash, role: "EMPLOYEE", tenantId: req.tenantId!, mustChangePassword: true }, select });
    res.status(201).json(employee);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") { res.status(409).json({ error: "This login email is unavailable" }); return; }
    // Prisma errors can include insertion arguments. Never forward a credential
    // write error whose diagnostic could contain password material.
    res.status(500).json({ error: "Could not create employee" });
  }
});
router.patch("/:id", async (req, res) => {
  const parsed = z.object({ active: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide only the active status" }); return; }
  const updated = await prisma.user.updateMany({ where: { id: req.params.id, tenantId: req.tenantId!, role: "EMPLOYEE" }, data: parsed.data.active ? { disabledAt: null } : { disabledAt: new Date(), authVersion: { increment: 1 } } });
  if (!updated.count) { res.status(404).json({ error: "Employee not found" }); return; }
  res.json({ ok: true });
});
export default router;

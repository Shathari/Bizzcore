import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { encrypt, decrypt } from "../lib/crypto";

// Per-tenant integration credentials — entered by the tenant admin here,
// separate from Super Admin's business-provisioning flow. These payload
// shapes must stay in sync with what integrations/whatsapp.ts and
// integrations/metaCredentials.ts expect to read.
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

type MetaPayload = { appId?: string; pageId?: string; igBusinessAccountId?: string; accessToken: string };
type WhatsAppPayload = { phoneNumberId: string; accessToken: string };

function readPayload<T>(encryptedPayload: string): T | null {
  try {
    return JSON.parse(decrypt(encryptedPayload)) as T;
  } catch {
    return null;
  }
}

router.get("/integrations", async (req, res) => {
  const tenantId = req.tenantId!;
  const [metaRecord, whatsappRecord] = await Promise.all([
    prisma.integrationCredential.findUnique({ where: { tenantId_provider: { tenantId, provider: "META" } } }), // tenant-scoped
    prisma.integrationCredential.findUnique({ where: { tenantId_provider: { tenantId, provider: "WHATSAPP" } } }), // tenant-scoped
  ]);

  const meta = metaRecord ? readPayload<MetaPayload>(metaRecord.encryptedPayload) : null;
  const whatsapp = whatsappRecord ? readPayload<WhatsAppPayload>(whatsappRecord.encryptedPayload) : null;

  // Access tokens are write-only — never sent back to the client once
  // saved, same principle as a password field. Only non-secret fields and
  // a boolean "is one set" are returned.
  res.json({
    meta: {
      connected: Boolean(meta?.accessToken),
      appId: meta?.appId ?? null,
      pageId: meta?.pageId ?? null,
      igBusinessAccountId: meta?.igBusinessAccountId ?? null,
      hasAccessToken: Boolean(meta?.accessToken),
      updatedAt: metaRecord?.updatedAt ?? null,
    },
    whatsapp: {
      connected: Boolean(whatsapp?.accessToken),
      phoneNumberId: whatsapp?.phoneNumberId ?? null,
      hasAccessToken: Boolean(whatsapp?.accessToken),
      updatedAt: whatsappRecord?.updatedAt ?? null,
    },
  });
});

const metaSchema = z.object({
  appId: z.string().trim().optional(),
  pageId: z.string().trim().optional(),
  igBusinessAccountId: z.string().trim().optional(),
  accessToken: z.string().trim().optional(),
});

router.put("/integrations/meta", async (req, res) => {
  const parsed = metaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const tenantId = req.tenantId!;
  const existing = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider: { tenantId, provider: "META" } }, // tenant-scoped
  });
  const existingPayload = existing ? readPayload<MetaPayload>(existing.encryptedPayload) : null;

  // Blank access token on an edit means "keep the current one" — the field
  // starts empty in the UI since we never send the real value back.
  const accessToken = parsed.data.accessToken || existingPayload?.accessToken;
  if (!accessToken) {
    res.status(400).json({ error: "Access token is required" });
    return;
  }
  const pageId = parsed.data.pageId || existingPayload?.pageId;
  const igBusinessAccountId = parsed.data.igBusinessAccountId || existingPayload?.igBusinessAccountId;
  if (!pageId && !igBusinessAccountId) {
    res.status(400).json({ error: "Provide at least a Page ID or an Instagram Business Account ID" });
    return;
  }

  const payload: MetaPayload = {
    appId: parsed.data.appId || existingPayload?.appId,
    pageId,
    igBusinessAccountId,
    accessToken,
  };

  await prisma.integrationCredential.upsert({
    where: { tenantId_provider: { tenantId, provider: "META" } }, // tenant-scoped
    create: { tenantId, provider: "META", encryptedPayload: encrypt(JSON.stringify(payload)) },
    update: { encryptedPayload: encrypt(JSON.stringify(payload)) },
  });

  res.json({ ok: true });
});

router.delete("/integrations/meta", async (req, res) => {
  await prisma.integrationCredential.deleteMany({
    where: { tenantId: req.tenantId, provider: "META" }, // tenant-scoped
  });
  res.status(204).send();
});

const whatsappSchema = z.object({
  phoneNumberId: z.string().trim().min(1, "Phone Number ID is required"),
  accessToken: z.string().trim().optional(),
});

router.put("/integrations/whatsapp", async (req, res) => {
  const parsed = whatsappSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const tenantId = req.tenantId!;
  const existing = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider: { tenantId, provider: "WHATSAPP" } }, // tenant-scoped
  });
  const existingPayload = existing ? readPayload<WhatsAppPayload>(existing.encryptedPayload) : null;

  const accessToken = parsed.data.accessToken || existingPayload?.accessToken;
  if (!accessToken) {
    res.status(400).json({ error: "Access token is required" });
    return;
  }

  const payload: WhatsAppPayload = { phoneNumberId: parsed.data.phoneNumberId, accessToken };

  await prisma.integrationCredential.upsert({
    where: { tenantId_provider: { tenantId, provider: "WHATSAPP" } }, // tenant-scoped
    create: { tenantId, provider: "WHATSAPP", encryptedPayload: encrypt(JSON.stringify(payload)) },
    update: { encryptedPayload: encrypt(JSON.stringify(payload)) },
  });

  res.json({ ok: true });
});

router.delete("/integrations/whatsapp", async (req, res) => {
  await prisma.integrationCredential.deleteMany({
    where: { tenantId: req.tenantId, provider: "WHATSAPP" }, // tenant-scoped
  });
  res.status(204).send();
});

export default router;

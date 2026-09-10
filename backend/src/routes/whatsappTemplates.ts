import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { getTenantWhatsAppCredentials } from "../integrations/whatsapp";

// WhatsApp Message Template management — Meta's Template Management API
// (whatsapp_business_management's actual App Review use case), scoped to a
// tenant's own WhatsApp Business Account. Deliberately a thin pass-through
// with no local Template model: Meta is the only source of truth for a
// template's approval status, so there's nothing this app could cache that
// wouldn't just go stale — GET always re-fetches live. This also means
// there's no cross-tenant leak surface to worry about beyond the credential
// lookup itself: every call authenticates to Meta with the requesting
// tenant's own token against their own WABA, so Meta itself refuses
// anything that isn't theirs.
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

type MetaTemplate = {
  id: string;
  name: string;
  status: string; // APPROVED | PENDING | REJECTED | ...
  category: string;
  language: string;
};

// Meta's error envelope is the same shape across every Graph API endpoint —
// {"error": {"message": "...", ...}} on a non-2xx response.
type MetaApiResponse = { error?: { message?: string }; data?: MetaTemplate[] };

router.get("/", async (req, res) => {
  const creds = await getTenantWhatsAppCredentials(req.tenantId!);
  if (!creds) {
    res.json({ connected: false, wabaConfigured: false, templates: [] });
    return;
  }
  if (!creds.wabaId) {
    // Pre-existing connections saved before wabaId was required — surfaced
    // distinctly from "not connected at all" so the UI can point at the
    // right fix (re-save the WhatsApp card in Settings, not "connect
    // WhatsApp" from scratch).
    res.json({ connected: true, wabaConfigured: false, templates: [] });
    return;
  }

  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${apiVersion}/${creds.wabaId}/message_templates?fields=name,status,category,language&limit=100`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` } }
    );
    const json = (await resp.json().catch(() => null)) as MetaApiResponse | null;
    if (!resp.ok) {
      res.status(502).json({ error: json?.error?.message ?? `WhatsApp API error ${resp.status}` });
      return;
    }
    res.json({ connected: true, wabaConfigured: true, templates: json?.data ?? [] });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not reach WhatsApp API" });
  }
});

const createTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Template name is required")
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only (Meta's naming rule)"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"], {
    errorMap: () => ({ message: "Choose Marketing, Utility, or Authentication" }),
  }),
  language: z.string().trim().min(1, "Language is required"),
  bodyText: z.string().trim().min(1, "Body text is required").max(1024, "Body text must be 1024 characters or fewer"),
});

router.post("/", async (req, res) => {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const creds = await getTenantWhatsAppCredentials(req.tenantId!);
  if (!creds) {
    res.status(400).json({ error: "Connect WhatsApp in Settings before creating a template." });
    return;
  }
  if (!creds.wabaId) {
    res.status(400).json({ error: "Add your WhatsApp Business Account ID in Settings before creating a template." });
    return;
  }

  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";
  try {
    const resp = await fetch(`https://graph.facebook.com/${apiVersion}/${creds.wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: parsed.data.name,
        category: parsed.data.category,
        language: parsed.data.language,
        components: [{ type: "BODY", text: parsed.data.bodyText }],
      }),
    });
    const json = (await resp.json().catch(() => null)) as (MetaApiResponse & { id?: string; status?: string; category?: string }) | null;
    if (!resp.ok) {
      res.status(502).json({ error: json?.error?.message ?? `WhatsApp API error ${resp.status}` });
      return;
    }
    // { id, status: "PENDING", category } — Meta always starts a new
    // template in review; there's no synchronous "approved" outcome.
    res.status(201).json(json);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not reach WhatsApp API" });
  }
});

export default router;

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

// Meta rejects a template outright if its BODY variables don't follow a strict
// shape: {{n}} with no internal whitespace, numbered 1..N with no gaps/repeats
// out of order, never leading/trailing the text, and never two in a row with
// no static text between them. We validate all of that up front — Meta's own
// error messages for these cases are generic ("Param text is invalid") and
// don't point at what's wrong, so we produce actionable messages instead of
// forwarding a request we already know will bounce.
//
// The token regex is deliberately loose ([^}]*, not \d+) so malformed
// placeholders — {{ 1 }}, {{name}}, {{1a}} — are still captured as tokens and
// reported with a specific message, rather than silently ignored as plain text.
const VARIABLE_TOKEN_RE = /\{\{([^}]*)\}\}/g;

type VariableToken = { raw: string; inner: string; index: number };

function extractVariableTokens(text: string): VariableToken[] {
  const tokens: VariableToken[] = [];
  let match: RegExpExecArray | null;
  VARIABLE_TOKEN_RE.lastIndex = 0;
  while ((match = VARIABLE_TOKEN_RE.exec(text)) !== null) {
    tokens.push({ raw: match[0], inner: match[1], index: match.index });
  }
  return tokens;
}

// Returns an error message describing the first problem found, or undefined
// if the body's placeholders (there may be none) are all Meta-compliant.
function validateBodyPlaceholders(bodyText: string): string | undefined {
  const tokens = extractVariableTokens(bodyText);
  if (tokens.length === 0) return undefined;

  for (const token of tokens) {
    if (!/^\d+$/.test(token.inner)) {
      return `Invalid placeholder "${token.raw}" — variables must be digits only with no spaces, e.g. {{1}} (Meta's syntax rule)`;
    }
  }

  // Numbering must start at {{1}} and increase monotonically with no gaps,
  // tracked by each number's first appearance (a variable may repeat later
  // in the body without re-triggering this check).
  const firstAppearanceOrder: number[] = [];
  const seen = new Set<number>();
  for (const token of tokens) {
    const n = Number(token.inner);
    if (!seen.has(n)) {
      seen.add(n);
      firstAppearanceOrder.push(n);
    }
  }
  for (let i = 0; i < firstAppearanceOrder.length; i++) {
    const expected = i + 1;
    if (firstAppearanceOrder[i] !== expected) {
      return `Variables must start at {{1}} and increase sequentially with no gaps (expected {{${expected}}}, found {{${firstAppearanceOrder[i]}}})`;
    }
  }

  const trimmed = bodyText.trim();
  if (/^\{\{\d+\}\}/.test(trimmed)) {
    return "Body text can't start directly with a variable — add static text before it";
  }
  if (/\{\{\d+\}\}$/.test(trimmed)) {
    return "Body text can't end directly with a variable — add static text after it";
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const between = bodyText.slice(tokens[i].index + tokens[i].raw.length, tokens[i + 1].index);
    if (between.trim().length === 0) {
      return `"${tokens[i].raw}" and "${tokens[i + 1].raw}" can't sit next to each other — add static text between them`;
    }
  }

  return undefined;
}

// Distinct variable count in an already-validated body (validateBodyPlaceholders
// guarantees, when it returns no error, that the numbers present are exactly
// 1..N) — used to size the example.body_text sample array.
function countBodyVariables(bodyText: string): number {
  const numbers = new Set(extractVariableTokens(bodyText).map((t) => t.inner));
  return numbers.size;
}

// HEADER text and a URL button both cap out at exactly one variable, and it
// must be {{1}} — unlike BODY, Meta doesn't allow a run of {{1}}, {{2}}, ...
// in either place, so this is a narrower sibling of validateBodyPlaceholders
// rather than a reuse of it.
function validateSingleVariablePlaceholder(text: string, context: "header" | "URL button"): string | undefined {
  const tokens = extractVariableTokens(text);
  if (tokens.length === 0) return undefined;

  for (const token of tokens) {
    if (!/^\d+$/.test(token.inner)) {
      return `Invalid placeholder "${token.raw}" in ${context} — variables must be digits only with no spaces, e.g. {{1}}`;
    }
  }
  if (tokens.length > 1) {
    return `A ${context} supports only one variable ({{1}})`;
  }
  if (tokens[0].inner !== "1") {
    return `A ${context}'s variable must be {{1}} (found {{${tokens[0].inner}}})`;
  }
  return undefined;
}

// --- HEADER ------------------------------------------------------------
//
// TEXT headers carry their own (at most one) variable + example.header_text.
// MEDIA headers (IMAGE/DOCUMENT/VIDEO) never have static content — the actual
// image/document/video is always supplied per-message — so Meta requires a
// sample media *handle* even when nothing in the header is a {{n}} variable.
// That handle comes from uploading a representative file via Meta's Resumable
// Upload API (POST /{app-id}/uploads) beforehand; we only accept the
// resulting handle string here, we don't do the upload ourselves.
const headerSchema = z
  .object({
    format: z.enum(["TEXT", "IMAGE", "DOCUMENT", "VIDEO"], {
      errorMap: () => ({ message: "Header format must be TEXT, IMAGE, DOCUMENT, or VIDEO" }),
    }),
    text: z.string().trim().max(60, "Header text must be 60 characters or fewer").optional(),
    mediaHandle: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.format === "TEXT") {
      if (!val.text) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Header text is required for a TEXT header", path: ["text"] });
        return;
      }
      const error = validateSingleVariablePlaceholder(val.text, "header");
      if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ["text"] });
    } else if (!val.mediaHandle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A sample media handle is required for a ${val.format} header (upload a representative file via Meta's Resumable Upload API and pass the returned handle)`,
        path: ["mediaHandle"],
      });
    }
  });

// --- BUTTONS -------------------------------------------------------------
//
// url carries its own field-level placeholder check; the "a sample is
// required when the URL is dynamic" cross-field rule and the one-per-type
// caps live in the array-level superRefine below, since a discriminated
// union's branches must stay plain objects (an object-level .superRefine
// turns a branch into a ZodEffects that discriminatedUnion can't read the
// literal off of).
const quickReplyButtonSchema = z.object({
  type: z.literal("QUICK_REPLY"),
  text: z.string().trim().min(1, "Button text is required").max(25, "Button text must be 25 characters or fewer"),
});

const phoneNumberButtonSchema = z.object({
  type: z.literal("PHONE_NUMBER"),
  text: z.string().trim().min(1, "Button text is required").max(25, "Button text must be 25 characters or fewer"),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "Phone number must be in E.164 format, e.g. +14155552671"),
});

// Meta's docs call this REQUEST_CONTACT_INFO; it's newer and thinner on
// documentation than the other three button types, so double-check the
// exact payload shape against Meta's current template reference before
// relying on this in production.
const requestContactInfoButtonSchema = z.object({
  type: z.literal("REQUEST_CONTACT_INFO"),
  text: z.string().trim().min(1, "Button text is required").max(25, "Button text must be 25 characters or fewer"),
});

const urlButtonSchema = z.object({
  type: z.literal("URL"),
  text: z.string().trim().min(1, "Button text is required").max(25, "Button text must be 25 characters or fewer"),
  url: z
    .string()
    .trim()
    .min(1, "A URL is required")
    .max(2000, "URL must be 2000 characters or fewer")
    .superRefine((val, ctx) => {
      const error = validateSingleVariablePlaceholder(val, "URL button");
      if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
    }),
  // The sample value Meta substitutes for {{1}} when a human reviews the
  // template, e.g. "12345" for a url of ".../orders/{{1}}" — required only
  // when the url actually contains a variable.
  urlExample: z.string().trim().max(2000).optional(),
});

const buttonSchema = z.discriminatedUnion("type", [
  quickReplyButtonSchema,
  phoneNumberButtonSchema,
  urlButtonSchema,
  requestContactInfoButtonSchema,
]);

const buttonsSchema = z
  .array(buttonSchema)
  .min(1, "At least one button is required when the BUTTONS component is included")
  .max(10, "A template can have at most 10 buttons")
  .superRefine((buttons, ctx) => {
    let urlCount = 0;
    let phoneCount = 0;
    buttons.forEach((button, i) => {
      if (button.type === "URL") {
        urlCount++;
        if (extractVariableTokens(button.url).length > 0 && !button.urlExample) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Button ${i + 1}: a sample value is required for a dynamic URL (e.g. a real id to replace {{1}})`,
            path: [i, "urlExample"],
          });
        }
      }
      if (button.type === "PHONE_NUMBER") phoneCount++;
    });
    // Meta allows at most one button of each call-to-action type per template.
    if (urlCount > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A template can have at most one URL button" });
    }
    if (phoneCount > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A template can have at most one phone number button" });
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
  bodyText: z
    .string()
    .trim()
    .min(1, "Body text is required")
    .max(1024, "Body text must be 1024 characters or fewer")
    .superRefine((val, ctx) => {
      const error = validateBodyPlaceholders(val);
      if (error) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
      }
    }),
  header: headerSchema.optional(),
  buttons: buttonsSchema.optional(),
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

  // Meta requires components in HEADER, BODY, [FOOTER,] BUTTONS order.
  const components: Record<string, unknown>[] = [];

  if (parsed.data.header) {
    const header = parsed.data.header;
    if (header.format === "TEXT") {
      // header.text is guaranteed set here — headerSchema's superRefine
      // rejects a TEXT header with no text before this handler ever runs.
      const headerComponent: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: header.text };
      if (extractVariableTokens(header.text!).length > 0) {
        headerComponent.example = { header_text: ["Sample Header Value"] };
      }
      components.push(headerComponent);
    } else {
      // Media headers have no static content to show a reviewer — the
      // sample handle *is* the example, unconditionally (headerSchema
      // already required header.mediaHandle for this branch).
      components.push({
        type: "HEADER",
        format: header.format,
        example: { header_handle: [header.mediaHandle] },
      });
    }
  }

  // Meta rejects a template with variables unless the BODY component also
  // carries a matching example.body_text — a 2D array (one example *set*,
  // holding one sample string per {{n}} variable). validateBodyPlaceholders
  // already guarantees the body's variables are exactly {{1}}..{{N}}, so N
  // is just the distinct-variable count.
  const variableCount = countBodyVariables(parsed.data.bodyText);
  const bodyComponent: { type: "BODY"; text: string; example?: { body_text: string[][] } } = {
    type: "BODY",
    text: parsed.data.bodyText,
  };
  if (variableCount > 0) {
    bodyComponent.example = {
      body_text: [Array.from({ length: variableCount }, (_, i) => `Sample ${i + 1}`)],
    };
  }
  components.push(bodyComponent);

  if (parsed.data.buttons && parsed.data.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: parsed.data.buttons.map((button) => {
        switch (button.type) {
          case "QUICK_REPLY":
            return { type: "QUICK_REPLY", text: button.text };
          case "PHONE_NUMBER":
            return { type: "PHONE_NUMBER", text: button.text, phone_number: button.phoneNumber };
          case "REQUEST_CONTACT_INFO":
            return { type: "REQUEST_CONTACT_INFO", text: button.text };
          case "URL": {
            const urlButton: Record<string, unknown> = { type: "URL", text: button.text, url: button.url };
            // buttonsSchema's superRefine already required urlExample here
            // whenever button.url contains a variable.
            if (extractVariableTokens(button.url).length > 0) {
              urlButton.example = [button.urlExample];
            }
            return urlButton;
          }
        }
      }),
    });
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
        components,
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

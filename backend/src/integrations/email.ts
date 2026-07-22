import nodemailer, { type Transporter } from "nodemailer";

export type EmailResult = { delivered: boolean; mode: "live" | "mock"; error?: string };

// Mock-first, same pattern as sms.ts: EMAIL_PROVIDER selects which adapter
// is active (defaults to "smtp", preserving pre-existing behavior for
// anyone who already set SMTP_*). Switching providers — or going from mock
// to live — is purely an env var change, no code change.
//
// "smtp" is also the recommended path for Amazon SES: SES's own docs favor
// its SMTP interface for straightforward integrations, and hand-rolling AWS
// SigV4 request signing for the HTTP API would add real complexity for no
// practical benefit over SMTP here.
type Provider = "resend" | "sendgrid" | "postmark" | "smtp";

function getProvider(): Provider {
  const raw = (process.env.EMAIL_PROVIDER ?? "smtp").toLowerCase();
  return raw === "resend" || raw === "sendgrid" || raw === "postmark" ? raw : "smtp";
}

function getFrom(): string {
  return process.env.EMAIL_FROM ?? process.env.SMTP_FROM ?? "BizzCore <no-reply@bizzcore.example>";
}

function isConfigured(provider: Provider): boolean {
  switch (provider) {
    case "resend":
      return Boolean(process.env.RESEND_API_KEY);
    case "sendgrid":
      return Boolean(process.env.SENDGRID_API_KEY);
    case "postmark":
      return Boolean(process.env.POSTMARK_SERVER_TOKEN);
    case "smtp":
      return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
  }
}

let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

type SendParams = { to: string; subject: string; text: string; html?: string };

// One provider attempt's outcome, before the retry loop wraps it.
// `retryable` distinguishes a transient failure (network error, 5xx, 429 —
// worth another attempt) from a permanent one (bad API key, invalid
// recipient, malformed request — retrying just delays the caller for no
// benefit).
type AttemptResult = { ok: true } | { ok: false; error: string; retryable: boolean };

function parseFromHeader(raw: string): { email: string; name?: string } {
  const match = raw.match(/^(.*)<(.+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "");
    return { email: match[2].trim(), name: name || undefined };
  }
  return { email: raw.trim() };
}

async function attemptResend(params: SendParams): Promise<AttemptResult> {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: getFrom(),
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: params.html,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `Resend error ${resp.status}: ${text.slice(0, 200)}`,
        retryable: resp.status >= 500 || resp.status === 429,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error calling Resend", retryable: true };
  }
}

async function attemptSendgrid(params: SendParams): Promise<AttemptResult> {
  const from = parseFromHeader(getFrom());
  try {
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: params.to }] }],
        from,
        subject: params.subject,
        content: [
          { type: "text/plain", value: params.text },
          ...(params.html ? [{ type: "text/html", value: params.html }] : []),
        ],
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `SendGrid error ${resp.status}: ${text.slice(0, 200)}`,
        retryable: resp.status >= 500 || resp.status === 429,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error calling SendGrid", retryable: true };
  }
}

async function attemptPostmark(params: SendParams): Promise<AttemptResult> {
  try {
    const resp = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        From: getFrom(),
        To: params.to,
        Subject: params.subject,
        TextBody: params.text,
        HtmlBody: params.html,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `Postmark error ${resp.status}: ${text.slice(0, 200)}`,
        retryable: resp.status >= 500 || resp.status === 429,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error calling Postmark", retryable: true };
  }
}

async function attemptSmtp(params: SendParams): Promise<AttemptResult> {
  try {
    await getTransporter().sendMail({
      from: getFrom(),
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    return { ok: true };
  } catch (err) {
    // nodemailer doesn't expose a clean permanent-vs-transient split like
    // the HTTP adapters' status codes — connection/greeting failures are
    // common enough here to be worth retrying regardless.
    return { ok: false, error: err instanceof Error ? err.message : "Unknown SMTP delivery error", retryable: true };
  }
}

function attemptFor(provider: Provider, params: SendParams): Promise<AttemptResult> {
  switch (provider) {
    case "resend":
      return attemptResend(params);
    case "sendgrid":
      return attemptSendgrid(params);
    case "postmark":
      return attemptPostmark(params);
    case "smtp":
      return attemptSmtp(params);
  }
}

// 3 attempts total (1 initial + 2 retries), exponential backoff. Only runs
// again when the previous attempt was itself marked retryable.
const RETRY_DELAYS_MS = [300, 900];

async function sendWithRetries(provider: Provider, params: SendParams): Promise<{ delivered: boolean; error?: string }> {
  let lastError: string | undefined;
  for (let attemptIndex = 0; attemptIndex <= RETRY_DELAYS_MS.length; attemptIndex++) {
    const result = await attemptFor(provider, params);
    if (result.ok) return { delivered: true };
    lastError = result.error;
    if (!result.retryable || attemptIndex === RETRY_DELAYS_MS.length) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attemptIndex]));
  }
  return { delivered: false, error: lastError };
}

export async function sendEmail(params: SendParams): Promise<EmailResult> {
  const provider = getProvider();

  if (!isConfigured(provider)) {
    // Deliberately does not log the message body — it may contain a
    // temporary password or a password-reset link. Callers that need a
    // local-dev fallback (e.g. routes/passwordReset.ts) log just what they
    // need from the mode: "mock" result themselves.
    console.log(`[email:mock] Would send "${params.subject}" to ${params.to} via ${provider} (not configured)`);
    return { delivered: false, mode: "mock" };
  }

  const { delivered, error } = await sendWithRetries(provider, params);
  return { delivered, mode: "live", error };
}

export type SmsResult = { delivered: boolean; mode: "live" | "mock"; error?: string };

// Mock-first, same pattern as email.ts, but multi-provider: SMS_PROVIDER
// selects which one is active (defaults to "twilio"), each with its own
// credential env vars. Switching providers — or going from mock to live —
// is purely an env var change, no code change.
type Provider = "twilio" | "msg91" | "textlocal";

function getProvider(): Provider {
  const raw = (process.env.SMS_PROVIDER ?? "twilio").toLowerCase();
  return raw === "msg91" || raw === "textlocal" ? raw : "twilio";
}

function isConfigured(provider: Provider): boolean {
  switch (provider) {
    case "twilio":
      return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
    case "msg91":
      return Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID);
    case "textlocal":
      return Boolean(process.env.TEXTLOCAL_API_KEY && process.env.TEXTLOCAL_SENDER);
  }
}

async function sendViaTwilio(to: string, body: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER!;

  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { delivered: false, mode: "live", error: `Twilio error ${resp.status}: ${text.slice(0, 200)}` };
  }
  return { delivered: true, mode: "live" };
}

async function sendViaMsg91(to: string, body: string): Promise<SmsResult> {
  const authKey = process.env.MSG91_AUTH_KEY!;
  const sender = process.env.MSG91_SENDER_ID!;
  const route = process.env.MSG91_ROUTE ?? "4"; // 4 = transactional route

  const resp = await fetch("https://api.msg91.com/api/v2/sendsms", {
    method: "POST",
    headers: {
      authkey: authKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender,
      route,
      country: process.env.MSG91_COUNTRY_CODE ?? "91",
      sms: [{ message: body, to: [to] }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { delivered: false, mode: "live", error: `MSG91 error ${resp.status}: ${text.slice(0, 200)}` };
  }
  return { delivered: true, mode: "live" };
}

async function sendViaTextlocal(to: string, body: string): Promise<SmsResult> {
  const apiKey = process.env.TEXTLOCAL_API_KEY!;
  const sender = process.env.TEXTLOCAL_SENDER!;

  const resp = await fetch("https://api.textlocal.in/send/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ apikey: apiKey, numbers: to, message: body, sender }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { delivered: false, mode: "live", error: `Textlocal error ${resp.status}: ${text.slice(0, 200)}` };
  }
  // Textlocal returns 200 even for application-level failures (invalid
  // key, insufficient credit, etc.) — the real status is in the body.
  const data = (await resp.json().catch(() => null)) as { status?: string; errors?: Array<{ message?: string }> } | null;
  if (data?.status && data.status !== "success") {
    const message = data.errors?.[0]?.message ?? "Textlocal reported failure";
    return { delivered: false, mode: "live", error: message };
  }
  return { delivered: true, mode: "live" };
}

export async function sendSms(params: { to: string; body: string }): Promise<SmsResult> {
  const provider = getProvider();

  if (!isConfigured(provider)) {
    // Deliberately does not log the message body — see email.ts note.
    console.log(`[sms:mock] Would send SMS via ${provider} to ${params.to} (SMS provider not configured)`);
    return { delivered: false, mode: "mock" };
  }

  try {
    switch (provider) {
      case "twilio":
        return await sendViaTwilio(params.to, params.body);
      case "msg91":
        return await sendViaMsg91(params.to, params.body);
      case "textlocal":
        return await sendViaTextlocal(params.to, params.body);
    }
  } catch (err) {
    return {
      delivered: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown SMS delivery error",
    };
  }
}

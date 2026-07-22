import { z } from "zod";
import { encrypt, decrypt } from "./crypto";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { logConnectorAccess } from "./connectorAccessLog";
import { fetchWithTimeout, REQUEST_TIMEOUT_MS, type CredentialRefresher } from "./websiteApiClient";
import { getFeatureByKey } from "./featureCatalog";

// "Log in with admin credentials" — an alternative to authType "bearer"
// (paste a raw token) for a connector whose external site only exposes a
// login endpoint, not a way to mint a long-lived token by hand. The tenant
// Admin gives us THEIR site's login URL + their own login email/password
// (never a BizzCore credential); we log in on their behalf and keep the
// resulting access token (and the password itself, encrypted) so it can be
// refreshed again later without asking the tenant to re-enter anything —
// see buildCredentialRefresher below for the automatic-on-401 path, and
// manualRefreshToken for the "Get / Refresh Access Token" button.

// ---------------------------------------------------------------------------
// Per-integration login-attempt rate limiting
// ---------------------------------------------------------------------------
// In-memory, keyed by WebsiteIntegration.id (inherently tenant-scoped — one
// id belongs to exactly one tenant's one connector, so this can never leak
// across tenants). Deliberately NOT express-rate-limit, since this needs to
// gate the automatic 401-triggered re-login too, which doesn't originate
// from a fresh incoming HTTP request. Caps how often we'll hit the
// TENANT'S OWN login endpoint with a password that might now be wrong —
// protects their site from being hammered by a stuck retry loop, not ours.
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS_PER_WINDOW = 5;
const loginAttempts = new Map<string, number[]>();

export function checkLoginRateLimit(integrationId: string): boolean {
  const now = Date.now();
  const recent = (loginAttempts.get(integrationId) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (recent.length >= LOGIN_MAX_ATTEMPTS_PER_WINDOW) {
    loginAttempts.set(integrationId, recent);
    return false;
  }
  recent.push(now);
  loginAttempts.set(integrationId, recent);
  return true;
}

// ---------------------------------------------------------------------------
// The actual login call
// ---------------------------------------------------------------------------

export type ExternalLoginResult =
  | { ok: true; accessToken: string; refreshToken: string | null; expiresAt: Date | null }
  | { ok: false; error: string };

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

// Best-effort, NEVER a security decision — decodes (does not verify) a JWT
// payload to read a standard `exp` claim purely so the UI has something to
// display. Real expiry is discovered live via an actual 401, not by
// trusting this. Silently returns null for anything that isn't a
// 3-segment JWT or has no numeric `exp`.
function tryDecodeJwtExpiry(token: string): Date | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadJson = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    if (typeof payload.exp === "number") return new Date(payload.exp * 1000);
  } catch {
    // Not decodable — fine, expiresAt just stays null.
  }
  return null;
}

// Some login APIs wrap the token payload one level deep — tolerate the
// common envelope key names rather than requiring every tenant's external
// site to return the token at the response body's top level.
function unwrapLoginBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const obj = body as Record<string, unknown>;
  for (const key of ["data", "result", "payload"]) {
    const inner = obj[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as Record<string, unknown>;
  }
  return obj;
}

const ACCESS_TOKEN_KEYS = ["accessToken", "access_token", "token", "authToken", "auth_token", "jwt"];
const REFRESH_TOKEN_KEYS = ["refreshToken", "refresh_token"];
const EXPIRES_IN_KEYS = ["expiresIn", "expires_in"]; // seconds from now
const EXPIRES_AT_KEYS = ["expiresAt", "expires_at", "expiry"]; // absolute timestamp/ISO string

// POSTs { email, password } to the tenant's own login endpoint and tries a
// handful of common response shapes to find the token — external "log in,
// get a token" APIs vary in key naming (accessToken vs token vs
// access_token, sometimes nested under data/result), and requiring every
// tenant's site to match one exact contract isn't realistic.
export async function performExternalLogin(loginUrl: string, email: string, password: string): Promise<ExternalLoginResult> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      loginUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
      REQUEST_TIMEOUT_MS
    );
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: isTimeout
        ? `The login endpoint didn't respond within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`
        : err instanceof Error
          ? err.message
          : "Unknown network error",
    };
  }

  const rawText = await resp.text().catch(() => "");
  let parsedBody: unknown = null;
  if (rawText) {
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      parsedBody = null;
    }
  }

  if (!resp.ok) {
    const bodyMessage =
      parsedBody && typeof parsedBody === "object" && "message" in (parsedBody as Record<string, unknown>)
        ? String((parsedBody as Record<string, unknown>).message)
        : null;
    return { ok: false, error: bodyMessage ?? `Login failed with status ${resp.status}` };
  }

  const body = unwrapLoginBody(parsedBody);
  const accessToken = firstString(body, ACCESS_TOKEN_KEYS);
  if (!accessToken) {
    return { ok: false, error: "Login succeeded but no access token was found in the response." };
  }
  const refreshToken = firstString(body, REFRESH_TOKEN_KEYS);

  let expiresAt: Date | null = null;
  const expiresInRaw = body[EXPIRES_IN_KEYS[0]] ?? body[EXPIRES_IN_KEYS[1]];
  if (typeof expiresInRaw === "number") {
    expiresAt = new Date(Date.now() + expiresInRaw * 1000);
  } else {
    const expiresAtStr = firstString(body, EXPIRES_AT_KEYS);
    if (expiresAtStr) {
      const parsedDate = new Date(expiresAtStr);
      if (!Number.isNaN(parsedDate.getTime())) expiresAt = parsedDate;
    }
  }
  if (!expiresAt) expiresAt = tryDecodeJwtExpiry(accessToken);

  return { ok: true, accessToken, refreshToken, expiresAt };
}

// ---------------------------------------------------------------------------
// Save (initial login-mode setup)
// ---------------------------------------------------------------------------

// Same "TLS-only" rule as the rest of the connector subsystem, with one
// narrow, explicit exception: plain http:// is allowed for localhost/
// 127.0.0.1 specifically, so this can be exercised against
// routes/mockExternalSite.ts (this repo's own dev/test stand-in for a
// tenant's external site, which has no TLS listener) without weakening
// the requirement for an actual tenant's real, network-reachable site —
// same "local dev/demo purposes only" carve-out mockExternalSite.ts's own
// file comment already documents for baseUrl.
function isAllowedLoginUrl(u: string): boolean {
  const lower = u.toLowerCase();
  if (lower.startsWith("https://")) return true;
  try {
    const { hostname } = new URL(u);
    return lower.startsWith("http://") && (hostname === "localhost" || hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export const saveLoginCredentialsSchema = z.object({
  loginUrl: z
    .string()
    .trim()
    .url("Enter a valid URL")
    .refine(isAllowedLoginUrl, "URL must use https:// (plain http:// is only allowed for localhost, for local testing)"),
  email: z.string().trim().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

export type SaveLoginResult = { ok: true; tokenExpiresAt: Date | null } | { ok: false; error: string };

// Persists loginUrl + encrypted email/password regardless of whether the
// immediate login attempt succeeds — a failed first attempt (typo'd
// password, wrong URL) shouldn't force the tenant Admin to re-enter
// everything to try again via "Refresh"; it should just show as
// CredentialsExpired until they fix it.
export async function saveLoginCredentials(
  tenantId: string,
  featureKey: string,
  input: unknown,
  actorId: string
): Promise<SaveLoginResult> {
  const feature = await getFeatureByKey(tenantId, featureKey);
  if (!feature) return { ok: false, error: "Unknown content type" };

  const parsed = saveLoginCredentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const integration = await prisma.websiteIntegration.findUnique({ where: { tenantId_featureId: { tenantId, featureId: feature.id } } });
  if (!integration) {
    return { ok: false, error: "Set up this connector's base URL first, then configure login-based credentials." };
  }

  const loginResult = await performExternalLogin(parsed.data.loginUrl, parsed.data.email, parsed.data.password);

  await prisma.websiteIntegration.update({
    where: { id: integration.id },
    data: {
      authType: "login",
      encryptedCredentials: null,
      loginUrl: parsed.data.loginUrl,
      loginEmailEncrypted: encrypt(parsed.data.email),
      loginPasswordEncrypted: encrypt(parsed.data.password),
      accessTokenEncrypted: loginResult.ok ? encrypt(loginResult.accessToken) : integration.accessTokenEncrypted,
      refreshTokenEncrypted: loginResult.ok ? (loginResult.refreshToken ? encrypt(loginResult.refreshToken) : null) : integration.refreshTokenEncrypted,
      tokenExpiresAt: loginResult.ok ? loginResult.expiresAt : integration.tokenExpiresAt,
      credentialStatus: loginResult.ok ? "OK" : "CredentialsExpired",
    },
  });

  await logConnectorAccess({
    tenantId,
    featureId: feature.id,
    websiteIntegrationId: integration.id,
    actorId,
    action: "CREDENTIAL_LOGIN",
    outcome: loginResult.ok ? "success" : "failure",
    // Never the password — see the module comment. Only the login URL and
    // (on failure) the external site's own error text.
    details: loginResult.ok ? { trigger: "save" } : { trigger: "save", error: loginResult.error },
  });

  if (!loginResult.ok) {
    return { ok: false, error: `Saved your login details, but couldn't sign in: ${loginResult.error}` };
  }
  return { ok: true, tokenExpiresAt: loginResult.expiresAt };
}

// ---------------------------------------------------------------------------
// Manual "Get / Refresh Access Token" button
// ---------------------------------------------------------------------------

export type RefreshResult = { ok: true; tokenExpiresAt: Date | null } | { ok: false; error: string; rateLimited?: boolean };

export async function manualRefreshToken(tenantId: string, featureKey: string, actorId: string): Promise<RefreshResult> {
  const feature = await getFeatureByKey(tenantId, featureKey);
  if (!feature) return { ok: false, error: "Unknown content type" };

  const integration = await prisma.websiteIntegration.findUnique({ where: { tenantId_featureId: { tenantId, featureId: feature.id } } });
  if (!integration) return { ok: false, error: "Not found" };
  if (integration.authType !== "login" || !integration.loginUrl || !integration.loginEmailEncrypted || !integration.loginPasswordEncrypted) {
    return { ok: false, error: "This connector isn't using login-based credentials." };
  }

  if (!checkLoginRateLimit(integration.id)) {
    await logConnectorAccess({
      tenantId,
      featureId: feature.id,
      websiteIntegrationId: integration.id,
      actorId,
      action: "CREDENTIAL_LOGIN",
      outcome: "failure",
      details: { trigger: "manual", reason: "rate_limited" },
    });
    return { ok: false, error: "Too many login attempts — please wait a minute and try again.", rateLimited: true };
  }

  const email = decrypt(integration.loginEmailEncrypted);
  const password = decrypt(integration.loginPasswordEncrypted);
  const result = await performExternalLogin(integration.loginUrl, email, password);

  if (!result.ok) {
    await prisma.websiteIntegration.update({ where: { id: integration.id }, data: { credentialStatus: "CredentialsExpired" } });
    await logConnectorAccess({
      tenantId,
      featureId: feature.id,
      websiteIntegrationId: integration.id,
      actorId,
      action: "CREDENTIAL_LOGIN",
      outcome: "failure",
      details: { trigger: "manual", error: result.error },
    });
    return { ok: false, error: result.error };
  }

  await prisma.websiteIntegration.update({
    where: { id: integration.id },
    data: {
      accessTokenEncrypted: encrypt(result.accessToken),
      refreshTokenEncrypted: result.refreshToken ? encrypt(result.refreshToken) : null,
      tokenExpiresAt: result.expiresAt,
      credentialStatus: "OK",
    },
  });
  await logConnectorAccess({
    tenantId,
    featureId: feature.id,
    websiteIntegrationId: integration.id,
    actorId,
    action: "CREDENTIAL_LOGIN",
    outcome: "success",
    details: { trigger: "manual" },
  });
  return { ok: true, tokenExpiresAt: result.expiresAt };
}

// ---------------------------------------------------------------------------
// Automatic 401-triggered re-login (see websiteApiClient.ts's
// CredentialRefresher — this is what builds the callback it invokes)
// ---------------------------------------------------------------------------

type LoginCapableIntegration = {
  id: string;
  featureId: string;
  authType: string;
  loginUrl: string | null;
  loginEmailEncrypted: string | null;
  loginPasswordEncrypted: string | null;
};

// ---------------------------------------------------------------------------
// Proactive refresh — checked BEFORE a call is even attempted, not just
// reactively after a 401 (see buildCredentialRefresher below for that
// safety net, which still matters: not every login response tells us an
// expiry, and a token can go bad for reasons other than time). A token
// like the 15-minute one that motivated this feature would otherwise cost
// every write/import a guaranteed-failing first attempt before the 401
// handler kicked in — this skips straight to a working token when we
// already know the old one is stale.
// ---------------------------------------------------------------------------

type ExpiryAwareIntegration = LoginCapableIntegration & {
  tokenExpiresAt: Date | null;
  accessTokenEncrypted: string | null;
  credentialStatus: string;
};

// Treated as "already expired" a little early — refreshing at T-30s instead
// of exactly at T avoids a call that starts just before expiry and lands
// just after it.
const EXPIRY_BUFFER_MS = 30_000;

// Returns the SAME integration object when no proactive refresh was
// needed or possible (nothing to change), or a shallow copy with the new
// accessTokenEncrypted/tokenExpiresAt/credentialStatus when one succeeded.
// Callers should use the RETURNED value to build headers/refreshers for
// the call they're about to make — a proactive refresh failure is not
// itself an error to surface (the reactive 401 path below, and the
// rate limiter both of them share, still cover it if the actual call also
// fails).
export async function ensureFreshToken<T extends ExpiryAwareIntegration>(integration: T, tenantId: string, actorId: string | null): Promise<T> {
  if (integration.authType !== "login" || !integration.tokenExpiresAt) return integration;
  if (integration.tokenExpiresAt.getTime() - EXPIRY_BUFFER_MS > Date.now()) return integration; // still comfortably valid
  if (!integration.loginUrl || !integration.loginEmailEncrypted || !integration.loginPasswordEncrypted) return integration;

  if (!checkLoginRateLimit(integration.id)) {
    logger.warn({ websiteIntegrationId: integration.id, tenantId }, "connector login: proactive refresh skipped — rate limited");
    return integration;
  }

  const email = decrypt(integration.loginEmailEncrypted);
  const password = decrypt(integration.loginPasswordEncrypted);
  const result = await performExternalLogin(integration.loginUrl, email, password);

  if (!result.ok) {
    await prisma.websiteIntegration.update({ where: { id: integration.id }, data: { credentialStatus: "CredentialsExpired" } });
    await logConnectorAccess({
      tenantId,
      featureId: integration.featureId,
      websiteIntegrationId: integration.id,
      actorId,
      action: "CREDENTIAL_LOGIN",
      outcome: "failure",
      details: { trigger: "proactive_expiry", error: result.error },
    });
    return integration;
  }

  const accessTokenEncrypted = encrypt(result.accessToken);
  await prisma.websiteIntegration.update({
    where: { id: integration.id },
    data: {
      accessTokenEncrypted,
      refreshTokenEncrypted: result.refreshToken ? encrypt(result.refreshToken) : null,
      tokenExpiresAt: result.expiresAt,
      credentialStatus: "OK",
    },
  });
  await logConnectorAccess({
    tenantId,
    featureId: integration.featureId,
    websiteIntegrationId: integration.id,
    actorId,
    action: "CREDENTIAL_LOGIN",
    outcome: "success",
    details: { trigger: "proactive_expiry" },
  });

  return { ...integration, accessTokenEncrypted, tokenExpiresAt: result.expiresAt, credentialStatus: "OK" };
}

// Returns undefined when this integration has no stored login credentials
// to retry with (authType isn't "login", or the fields aren't all set) —
// callers treat "no refresher" as "just mark CredentialsExpired, nothing
// to retry."
export function buildCredentialRefresher(
  integration: LoginCapableIntegration,
  tenantId: string,
  actorId: string | null
): CredentialRefresher | undefined {
  if (integration.authType !== "login" || !integration.loginUrl || !integration.loginEmailEncrypted || !integration.loginPasswordEncrypted) {
    return undefined;
  }

  return async () => {
    if (!checkLoginRateLimit(integration.id)) {
      logger.warn({ websiteIntegrationId: integration.id, tenantId }, "connector login: automatic re-login skipped — rate limited");
      await logConnectorAccess({
        tenantId,
        featureId: integration.featureId,
        websiteIntegrationId: integration.id,
        actorId,
        action: "CREDENTIAL_LOGIN",
        outcome: "failure",
        details: { trigger: "automatic_401", reason: "rate_limited" },
      });
      return { refreshed: false };
    }

    const email = decrypt(integration.loginEmailEncrypted!);
    const password = decrypt(integration.loginPasswordEncrypted!);
    const result = await performExternalLogin(integration.loginUrl!, email, password);

    if (!result.ok) {
      await prisma.websiteIntegration.update({ where: { id: integration.id }, data: { credentialStatus: "CredentialsExpired" } });
      await logConnectorAccess({
        tenantId,
        featureId: integration.featureId,
        websiteIntegrationId: integration.id,
        actorId,
        action: "CREDENTIAL_LOGIN",
        outcome: "failure",
        details: { trigger: "automatic_401", error: result.error },
      });
      return { refreshed: false };
    }

    await prisma.websiteIntegration.update({
      where: { id: integration.id },
      data: {
        accessTokenEncrypted: encrypt(result.accessToken),
        refreshTokenEncrypted: result.refreshToken ? encrypt(result.refreshToken) : null,
        tokenExpiresAt: result.expiresAt,
        credentialStatus: "OK",
      },
    });
    await logConnectorAccess({
      tenantId,
      featureId: integration.featureId,
      websiteIntegrationId: integration.id,
      actorId,
      action: "CREDENTIAL_LOGIN",
      outcome: "success",
      details: { trigger: "automatic_401" },
    });
    return { refreshed: true, headers: { Authorization: `Bearer ${result.accessToken}` } };
  };
}

// ---------------------------------------------------------------------------
// credentialStatus reconciliation — called by lib/websiteContentService.ts
// after every write-back/import attempt with whatever HTTP status the
// FINAL (post any auto-refresh-and-retry) response carried.
// ---------------------------------------------------------------------------

export async function reconcileCredentialStatus(integrationId: string, currentStatus: string, responseStatus: number | undefined): Promise<void> {
  if (responseStatus === 401 && currentStatus !== "CredentialsExpired") {
    await prisma.websiteIntegration.update({ where: { id: integrationId }, data: { credentialStatus: "CredentialsExpired" } });
  } else if (responseStatus !== undefined && responseStatus < 400 && currentStatus !== "OK") {
    await prisma.websiteIntegration.update({ where: { id: integrationId }, data: { credentialStatus: "OK" } });
  }
}

import { encrypt, decrypt } from "./crypto";
import { logger } from "./logger";

// `status`: the raw HTTP status of the final (post-retry) response, when
// one was actually received (absent for a network/timeout failure that
// never got an HTTP response at all). Exists so a caller with DB access
// (lib/websiteContentService.ts) can reconcile WebsiteIntegration.
// credentialStatus (401 -> "CredentialsExpired", 2xx -> "OK") without
// string-matching the human-readable `error` message.
export type WebsiteApiResult = { success: boolean; externalId?: string; error?: string; status?: number };
export type WebsiteApiListResult = { success: boolean; items?: Record<string, unknown>[]; error?: string; status?: number };

// Standardized query filters for the admin GET/import contract — content
// type decides which of these it honors (e.g. `category`/`collection` for
// Products, `code` for Offers, `featured`/`position` for Banners) but the
// shape is uniform across every content type and every tenant's site, so
// the dashboard doesn't need per-content-type filter logic.
export type WebsiteApiImportFilters = {
  slug?: string;
  id?: string;
  category?: string;
  collection?: string;
  featured?: boolean;
  position?: number;
  code?: string;
};

// `pagination` is appended alongside filters (same query string, one
// request) — see fetchWebsiteApi's pagination loop. A site that doesn't
// paginate at all is expected to just ignore page/pageSize like any
// unrecognized query param, same tolerance already relied on for a site
// that ignores the standardized filters.
function buildQueryString(filters?: WebsiteApiImportFilters, pagination?: { page: number; pageSize: number }): string {
  const params = new URLSearchParams();
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === "") continue;
      params.set(key, String(value));
    }
  }
  if (pagination) {
    params.set("page", String(pagination.page));
    params.set("pageSize", String(pagination.pageSize));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export type EndpointOverride = {
  method: string;
  url: string | null;
  authType: string | null;
  encryptedCredentials: string | null;
};

// Injected by a Prisma-aware caller (lib/connectorLogin.ts's
// buildCredentialRefresher, via lib/websiteContentService.ts) so this file
// stays a pure HTTP client with no DB/encryption knowledge of its own —
// loggedFetch just knows "call this once, on a 401, to maybe get fresh
// headers to retry with." Never invoked more than once per outbound call
// (see loggedFetch: the retried request is issued without a refresher, so
// a 401 on the retry is final).
export type CredentialRefreshResult = { refreshed: true; headers: Record<string, string> } | { refreshed: false };
export type CredentialRefresher = () => Promise<CredentialRefreshResult>;

type IntegrationConfig = {
  baseUrl: string;
  authType: string;
  encryptedCredentials: string | null;
  // authType "login" only — see connectorLogin.ts. The token lives on the
  // shared DataSource (one login per connected website, not per feature),
  // never on a per-method EndpointOverride (login-based auth is
  // base-integration-only, not supported per-method).
  dataSource?: { accessTokenEncrypted: string | null } | null;
  fieldMapping?: string | null;
  responseMapping?: string | null;
  endpoints?: EndpointOverride[];
  lookupKey?: string | null;
  // Feature.isSingleton (see lib/websiteContentService.ts's ActiveIntegration)
  // — a singleton content type has exactly one record on the external site
  // and, per every external API this was tested against, is addressed at
  // the bare baseUrl for every method (GET *and* write), never
  // baseUrl/:id — there is no per-record id segment in its route table at
  // all. See resolveWriteRequest's convention-URL branch.
  isSingleton?: boolean;
};

// Substitutes a literal "{id}" placeholder in a Super-Admin-configured
// override URL with the item's actual externalId. Without this, an override
// URL was previously used byte-for-byte, so a tenant site needing the id
// somewhere other than a trailing path segment (e.g. "?id={id}", or a
// nested path like "/collections/{id}/products") could never be addressed
// correctly — only the default convention (baseUrl/externalId) had the id
// in the URL at all. Left untouched (not blanked out) when there's no
// externalId to substitute — PUT/PATCH/DELETE always have one by the time
// they reach here (see websiteContentService.ts), so this only matters for
// a misconfigured override; leaving "{id}" literal makes that failure
// loud and traceable in the request log instead of silently wrong.
function substituteIdPlaceholder(url: string, externalId: string | null): string {
  if (externalId === null || !url.includes("{id}")) return url;
  return url.split("{id}").join(encodeURIComponent(externalId));
}

// Resolves the URL and auth to use for one HTTP method: an explicit
// per-method override (routes/superAdminWebsiteIntegrations.ts's "endpoints"
// input) wins if present, otherwise falls back to the shared baseUrl +
// REST convention and the shared authType/credentials — this is what
// "shared authentication across methods, with optional per-method
// override" means in practice. `fallbackUrl` is the convention-derived URL
// (baseUrl, or `${baseUrl}/${externalId}`) for this call. An override URL
// may reference `{id}` (see substituteIdPlaceholder) for sites that need
// the id somewhere other than a trailing path segment.
function resolveEndpoint(
  integration: IntegrationConfig,
  method: string,
  fallbackUrl: string,
  externalId: string | null
): { url: string; authType: string; encryptedCredentials: string | null; accessTokenEncrypted: string | null } {
  const override = integration.endpoints?.find((e) => e.method === method);
  return {
    url: override?.url ? substituteIdPlaceholder(override.url, externalId) : fallbackUrl,
    authType: override?.authType ?? integration.authType,
    encryptedCredentials: override?.authType ? override.encryptedCredentials : integration.encryptedCredentials,
    accessTokenEncrypted: override?.authType ? null : (integration.dataSource?.accessTokenEncrypted ?? null),
  };
}

type LookupUrlResult = { ok: true; url: string } | { ok: false; error: string };

// Builds the query-parameter-addressed convention URL for PUT/PATCH/DELETE
// when a lookup key is configured (WebsiteIntegration.lookupKey) — e.g.
// baseUrl + "?slug=moonga-silk-saree" instead of baseUrl/externalId. The
// lookup key names a DASHBOARD payload field — never hardcoded to any
// specific feature, always read fresh from whichever payload this
// particular call carries (the new data being saved for PUT/PATCH, or the
// item's stored payload for DELETE — see websiteContentService.ts). If
// that field has been renamed via fieldMapping, the mapped (external) name
// is used as the query parameter name, since that's the name the tenant's
// own API actually expects — unless the mapped value is a nested path
// (contains "." or "["), which is meaningless as a flat query parameter
// name, in which case the lookup key itself is used verbatim.
function buildLookupQueryUrl(
  base: string,
  lookupKey: string,
  payload: Record<string, unknown> | undefined,
  mapping: FieldMapping | null
): LookupUrlResult {
  const value = payload ? payload[lookupKey] : undefined;
  if (value === undefined || value === null || value === "") {
    return { ok: false, error: `Cannot address this item: lookup key "${lookupKey}" has no value in its payload.` };
  }
  const mappedName = mapping?.[lookupKey];
  const paramName = mappedName && !mappedName.includes(".") && !mappedName.includes("[") ? mappedName : lookupKey;
  const params = new URLSearchParams({ [paramName]: String(value) });
  const separator = base.includes("?") ? "&" : "?";
  return { ok: true, url: `${base}${separator}${params.toString()}` };
}

type ResolvedWriteRequest =
  | { ok: true; url: string; authType: string; encryptedCredentials: string | null; accessTokenEncrypted: string | null }
  | { ok: false; error: string };

// Resolves the URL and auth for one create/update/delete call, in
// priority order:
//   1. An explicit per-method override URL containing a literal "{id}" is
//      substituted with the externalId and used verbatim — a genuine
//      path-parameter API (see substituteIdPlaceholder), and always wins.
//   2. Otherwise, if a lookup key is configured (WebsiteIntegration.
//      lookupKey), address by a query parameter instead — based on THIS
//      method's own override URL when one exists, else the shared
//      baseUrl. Using the override's URL as the base (rather than
//      requiring lookupKey to only ever work against the shared baseUrl)
//      is what lets a tenant whose admin write endpoints live at a
//      different path than the public read baseUrl (e.g.
//      "/api/public/admin/x" vs "/api/public/x", each with its own
//      apiKey credentials) use lookup-key addressing at all — otherwise
//      the only way to reach that admin path would be a static override
//      URL with no way to reference a per-item value.
//   3. Otherwise, the override URL as configured (or the default
//      baseUrl/externalId convention, if there's no override for this
//      method at all) — the original behavior, unchanged.
// POST never addresses an existing item — always the override URL (if
// any) or the shared baseUrl, no id/lookup key involved. Auth is always
// the override's own authType/credentials when it sets one, else the
// integration's shared authType/credentials — independent of which of
// the three URL rules above applied.
function resolveWriteRequest(
  integration: IntegrationConfig,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  externalId: string | null,
  payload: Record<string, unknown> | undefined,
  mapping: FieldMapping | null
): ResolvedWriteRequest {
  const base = integration.baseUrl.replace(/\/$/, "");
  const override = integration.endpoints?.find((e) => e.method === method);
  const authType = override?.authType ?? integration.authType;
  const encryptedCredentials = override?.authType ? override.encryptedCredentials : integration.encryptedCredentials;
  const accessTokenEncrypted = override?.authType ? null : (integration.dataSource?.accessTokenEncrypted ?? null);

  if (method === "POST") {
    return { ok: true, url: override?.url || base, authType, encryptedCredentials, accessTokenEncrypted };
  }

  if (override?.url?.includes("{id}")) {
    return { ok: true, url: substituteIdPlaceholder(override.url, externalId), authType, encryptedCredentials, accessTokenEncrypted };
  }

  if (integration.lookupKey) {
    const lookupBase = override?.url || base;
    const lookupResult = buildLookupQueryUrl(lookupBase, integration.lookupKey, payload, mapping);
    if (!lookupResult.ok) return { ok: false, error: lookupResult.error };
    return { ok: true, url: lookupResult.url, authType, encryptedCredentials, accessTokenEncrypted };
  }

  // A singleton content type (e.g. an "About" section) never gets an id
  // segment appended — there's exactly one record, and its update route is
  // the bare baseUrl, not baseUrl/:id (confirmed live: an id-suffixed PATCH
  // 404s "Route not found" against a real external API that only defines
  // the bare route). A genuine collection (Products) still addresses a
  // specific record by externalId as before.
  const conventionUrl = integration.isSingleton ? base : externalId ? `${base}/${externalId}` : base;
  return { ok: true, url: override?.url || conventionUrl, authType, encryptedCredentials, accessTokenEncrypted };
}

// Tenant-specific { dashboardFieldKey: externalFieldPath } rename, applied
// around the free-form payload only — never to protocol-level fields like
// `id`/`externalId`, which are a REST convention, not a dashboard field a
// Super Admin would remap. externalFieldPath is usually just a flat key
// (e.g. "price") but may be a dot/bracket path into a nested response
// field (e.g. "category.name", "images[0].url") — see getByPath/setByPath.
type FieldMapping = Record<string, string>;

function parseFieldMapping(raw: string | null | undefined): FieldMapping | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

type PathSegment = { key: string; index?: number };

// "images[0].url" -> [{key:"images",index:0},{key:"url"}]; "price" ->
// [{key:"price"}] — a plain flat key is just a 1-segment path, which is
// what every mapping saved before nested-path support existed already is.
function parsePath(path: string): PathSegment[] {
  return path.split(".").map((part) => {
    const match = part.match(/^([^[]+)(\[(\d+)])?$/);
    if (!match) return { key: part };
    const [, key, , indexStr] = match;
    return indexStr !== undefined ? { key, index: Number(indexStr) } : { key };
  });
}

// Exported for direct unit tests of the backward-compatibility proof (see
// tests/website-field-mapping-paths.test.ts) — path parsing/resolution is
// the highest-risk part of this change, worth testing in isolation from
// the full HTTP-mocked route tests that already exercise it indirectly.
export function getByPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const segment of parsePath(path)) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment.key];
    if (segment.index !== undefined) {
      if (!Array.isArray(current)) return undefined;
      current = current[segment.index];
    }
  }
  return current;
}

export function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = parsePath(path);
  let current: Record<string, unknown> = target;
  segments.forEach((segment, i) => {
    const isLast = i === segments.length - 1;
    if (segment.index !== undefined) {
      if (!Array.isArray(current[segment.key])) current[segment.key] = [];
      const arr = current[segment.key] as unknown[];
      if (isLast) {
        arr[segment.index] = value;
        return;
      }
      if (typeof arr[segment.index] !== "object" || arr[segment.index] === null) arr[segment.index] = {};
      current = arr[segment.index] as Record<string, unknown>;
    } else {
      if (isLast) {
        current[segment.key] = value;
        return;
      }
      if (typeof current[segment.key] !== "object" || current[segment.key] === null) current[segment.key] = {};
      current = current[segment.key] as Record<string, unknown>;
    }
  });
}

// Dashboard payload -> external payload (used building create/update
// bodies). For a flat mapping (the overwhelming common case, and every
// mapping saved before nested paths existed) this is byte-identical to a
// simple key rename: setByPath with a 1-segment path is a direct
// assignment, same as the old `mapped[mapping[key] ?? key] = value`. A
// nested path (e.g. "category.id") builds the corresponding nested
// object/array in the outbound payload instead.
export function toExternalKeys(payload: Record<string, unknown>, mapping: FieldMapping | null): Record<string, unknown> {
  if (!mapping) return payload;
  const mapped: Record<string, unknown> = {};
  for (const [dashboardKey, value] of Object.entries(payload)) {
    const externalPath = mapping[dashboardKey];
    if (externalPath) {
      setByPath(mapped, externalPath, value);
    } else {
      mapped[dashboardKey] = value;
    }
  }
  return mapped;
}

// External payload -> dashboard payload (used parsing import responses).
// Unmapped external fields still pass through under their own name (same
// as before nested-path support). A mapping is only allowed to suppress
// its source field's raw pass-through when it's an exact flat 1:1 rename
// of that top-level key — the same case the old implementation handled —
// so a nested-path mapping (which only claims one leaf out of a larger
// object, e.g. "category.name" out of "category") never discards the rest
// of that object's data; it's just also promoted to a proper field.
export function toDashboardKeys(payload: Record<string, unknown>, mapping: FieldMapping | null): Record<string, unknown> {
  if (!mapping) return payload;
  const mapped: Record<string, unknown> = {};
  const consumedTopLevelKeys = new Set<string>();
  for (const [dashboardKey, externalPath] of Object.entries(mapping)) {
    const value = getByPath(payload, externalPath);
    if (value === undefined) continue;
    mapped[dashboardKey] = value;
    if (!externalPath.includes(".") && !externalPath.includes("[")) consumedTopLevelKeys.add(externalPath);
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!consumedTopLevelKeys.has(key) && !(key in mapped)) mapped[key] = value;
  }
  return mapped;
}

// Logged alongside every outbound call so a failed sync can be traced back
// to which tenant/content-type/item triggered it.
type CallContext = { tenantId: string; contentType: string; itemId?: string };

// authType-specific credential shapes, stored encrypted as JSON:
//   bearer        -> { token: string }
//   apiKey        -> { headerName: string; apiKey: string }
//   basic         -> { username: string; password: string }
//   customHeaders -> { [headerName: string]: headerValue } (arbitrary pairs)
//   none          -> (no credentials stored)
export type WebsiteCredentials =
  | { token: string }
  | { headerName: string; apiKey: string }
  | { username: string; password: string }
  | Record<string, string>
  | Record<string, never>;

export function encryptCredentials(credentials: WebsiteCredentials): string {
  return encrypt(JSON.stringify(credentials));
}

// Exported for lib/websiteIntegrationConfig.ts's testEndpointConnection —
// the Test button (WebsiteIntegrationsPanel.tsx) needs the exact same
// header-building logic used for a real call, just aimed at a probe
// request instead.
export function buildAuthHeaders(authType: string, encryptedCredentials: string | null, accessTokenEncrypted: string | null = null): Record<string, string> {
  // Not the generic JSON-blob credentials field — the current token lives
  // in its own column (WebsiteIntegration.accessTokenEncrypted), refreshed
  // via connectorLogin.ts rather than pasted in once. Same Bearer shape as
  // "bearer" otherwise.
  if (authType === "login") {
    return accessTokenEncrypted ? { Authorization: `Bearer ${decrypt(accessTokenEncrypted)}` } : {};
  }
  if (authType === "none" || !encryptedCredentials) return {};
  let creds: Record<string, string>;
  try {
    creds = JSON.parse(decrypt(encryptedCredentials));
  } catch {
    return {};
  }
  switch (authType) {
    case "bearer":
      return creds.token ? { Authorization: `Bearer ${creds.token}` } : {};
    case "apiKey":
      return creds.apiKey ? { [creds.headerName || "X-API-Key"]: creds.apiKey } : {};
    case "basic":
      return creds.username && creds.password
        ? { Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}` }
        : {};
    case "customHeaders":
      return creds;
    default:
      return {};
  }
}

// Header names only — never log credential values, even at debug level.
function redactedHeaderNames(headers: Record<string, string>): string[] {
  return Object.keys(headers);
}

// Most external APIs (including the real-world one this was built against)
// wrap their payload as { ok: true, data: {...} } rather than returning the
// resource bare. Unwrap that envelope so downstream code (externalId
// extraction, imported item shape) sees the actual resource either way.
function unwrapResource(body: unknown): unknown {
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data;
  }
  return body;
}

// An external API can return HTTP 200 while its body still reports failure
// (e.g. { ok: false, error: "..." }). Only trust the HTTP status when the
// body doesn't make an explicit claim either way.
function bodyReportsSuccess(body: unknown, httpOk: boolean): boolean {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.ok === "boolean") return record.ok;
    if (typeof record.success === "boolean") return record.success;
  }
  return httpOk;
}

function extractId(resource: unknown): string | undefined {
  if (!resource || typeof resource !== "object") return undefined;
  const record = resource as Record<string, unknown>;
  const id = record.id ?? record.externalId;
  return id !== undefined && id !== null ? String(id) : undefined;
}

// Explicit Super-Admin-configured override for where records live in a
// response body (routes/superAdminWebsiteIntegrations.ts's "responseMapping"
// input) — consulted before the auto-detect heuristics below, for external
// APIs whose shape doesn't match any of the recognized envelopes.
type ResponseMapping = { listPath?: string; itemPath?: string };

function parseResponseMapping(raw: string | null | undefined): ResponseMapping | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Walks a dot-path (e.g. "data.products") into a parsed response body.
// "" means the body itself is the target — the explicit way to say "don't
// walk anywhere, use the root".
function resolvePath(body: unknown, path: string): unknown {
  if (path === "") return body;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, body);
}

// Extracts a list of items from any of the common list-response shapes:
// a bare array, { data: [...] } (with or without an { ok } / { success }
// wrapper around it — unwrapResource strips the envelope either way), or
// the "items"/"results"/"records" synonyms some APIs use instead of "data"
// — or, when listPath is set, exactly the array at that dot-path, bypassing
// the heuristic entirely. A single bare resource object (not a list, and
// not one of the recognized envelopes) is auto-wrapped into a one-item
// array rather than rejected, since a filtered GET that narrows to exactly
// one match sometimes comes back as that record bare.
function extractList(body: unknown, listPath?: string): Record<string, unknown>[] | null {
  if (listPath !== undefined) {
    const resolved = resolvePath(body, listPath);
    if (Array.isArray(resolved)) return resolved as Record<string, unknown>[];
    if (resolved && typeof resolved === "object") return [resolved as Record<string, unknown>];
    return null;
  }
  const resource = unwrapResource(body);
  if (Array.isArray(resource)) return resource as Record<string, unknown>[];
  if (resource && typeof resource === "object") {
    for (const key of ["items", "results", "records"]) {
      const value = (resource as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
    return [resource as Record<string, unknown>];
  }
  return null;
}

// Singleton counterpart to extractList — the resource at itemPath when set,
// otherwise the same unwrap-and-check-it's-a-single-object heuristic
// fetchWebsiteApiSingle used inline before responseMapping existed.
function extractSingle(body: unknown, itemPath?: string): Record<string, unknown> | null {
  if (itemPath !== undefined) {
    const resolved = resolvePath(body, itemPath);
    return resolved && typeof resolved === "object" && !Array.isArray(resolved) ? (resolved as Record<string, unknown>) : null;
  }
  const resource = unwrapResource(body);
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) return null;
  return resource as Record<string, unknown>;
}

// Configurable so a slow-but-legitimate external site (or a CI/test
// environment) isn't cut off by an unrealistic default; 20s comfortably
// covers a real tenant site's worst-case cold response without leaving a
// hung request blocking a dashboard action indefinitely. Used for Test
// Connection, schema discovery, and import (all read-only/probing calls).
export const REQUEST_TIMEOUT_MS = Number(process.env.WEBSITE_API_TIMEOUT_MS ?? 20000);

// Write-back calls (create/update/delete pushed to a tenant's external
// site) get a longer, single-attempt budget instead of REQUEST_TIMEOUT_MS
// — reproduced live against a real free-tier host (Render) going cold: a
// 20s window wasn't enough for it to finish waking up, so BOTH of two
// sequential 20s attempts timed out back-to-back (~40s total) before
// failing anyway. 30s comfortably covers a realistic serverless cold start
// in one try; see loggedFetch below for why a timeout specifically doesn't
// get auto-retried on top of this.
export const WRITEBACK_TIMEOUT_MS = Number(process.env.WEBSITE_API_WRITEBACK_TIMEOUT_MS ?? 30000);

// POST always creates a NEW resource on the tenant's site — if its response
// is lost to a network error, we can't tell whether the create actually
// went through before the connection dropped, so automatically retrying it
// risks a duplicate we'd have no way to detect or undo. GET/PUT/PATCH/
// DELETE are all idempotent in how this system actually uses them (PUT and
// PATCH always send the complete resource payload here, never a partial
// diff — see websiteContentService.ts's pushUpdate — so redoing one after a
// transient failure produces the same end state either way), so those are
// safe to retry automatically. A failed POST still gets a manual retry path
// via "Sync Now" (see websiteContentService.ts's pushRetryCreate), which is
// the deliberately user-visible place for that ambiguity to be resolved.
//
// Capped at 2 total attempts (1 retry), not 3 — these calls run
// synchronously inside a Business Admin's HTTP request (create/update/
// delete/import all await this before responding), so every extra attempt
// at REQUEST_TIMEOUT_MS each is that much longer the browser sits waiting.
// A single retry already gets the real-world benefit (a genuine transient
// blip resolves on the second try); a second retry mostly just adds worst-
// case latency for diminishing returns, especially now that a DELETE whose
// retry lands on an already-gone resource is handled as a success in its
// own right (see callWebsiteApi's 404-on-DELETE handling below) rather
// than needing more attempts to "get lucky."
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

function isAutoRetryableMethod(method: string): boolean {
  return method !== "POST";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exported for testEndpointConnection (lib/websiteIntegrationConfig.ts) —
// the Test button's own probe previously used a bare `fetch`, the one
// outbound call path in this subsystem that didn't share this timeout,
// so a hung target site could block that request indefinitely.
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loggedFetch(
  context: CallContext,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  headers: Record<string, string>,
  body?: Record<string, unknown>,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  credentialRefresher?: CredentialRefresher
): Promise<{ httpOk: boolean; status: number; rawText: string; parsedBody: unknown } | { networkError: string }> {
  const requestLog = {
    tenantId: context.tenantId,
    contentType: context.contentType,
    itemId: context.itemId,
    method,
    url,
    headerNames: redactedHeaderNames(headers),
    body: method === "DELETE" || method === "GET" ? undefined : body,
  };
  logger.info({ websiteApiRequest: requestLog }, "website integration: outbound request");

  const maxAttempts = isAutoRetryableMethod(method) ? MAX_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let resp: Response;
    try {
      resp = await fetchWithTimeout(
        url,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: method === "DELETE" || method === "GET" ? undefined : JSON.stringify(body ?? {}),
        },
        timeoutMs
      );
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const message = isTimeout
        ? `The connected website didn't respond within ${Math.round(timeoutMs / 1000)}s — it may be waking up from being idle (common on free hosting tiers). Please try again in a moment.`
        : err instanceof Error
          ? err.message
          : "Unknown network error";
      // A timeout does NOT get retried, even when the method is otherwise
      // auto-retryable — reproduced live against a real cold-starting host
      // (see WRITEBACK_TIMEOUT_MS above): the timeout window is already
      // sized to comfortably cover a realistic cold start, so a second
      // timeout mostly just means the same wait again for no benefit (the
      // host needs wall-clock time to finish booting, not a second
      // request) — worse, doubling it risks the browser/proxy giving up
      // first. Better to fail clearly once; a manual retry after that will
      // hit an already-warm host and be fast. A connection-level network
      // error (DNS failure, connection refused) is a different signal —
      // that still gets its one retry with a short backoff, in case it's
      // transient congestion clearing.
      const canRetry = attempt < maxAttempts && !isTimeout;
      if (canRetry) {
        logger.warn(
          { websiteApiRequest: requestLog, attempt, maxAttempts, error: message, timedOut: isTimeout },
          "website integration: outbound request failed, retrying"
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      logger.error(
        { websiteApiRequest: requestLog, error: message, attempts: attempt, timedOut: isTimeout },
        "website integration: outbound request failed (network error)"
      );
      return { networkError: message };
    }

    // A 5xx is the server's own signal that this was likely transient (vs.
    // a 4xx, which retrying can't fix and would only delay a real error).
    const canRetryOnServerError = attempt < maxAttempts;
    if (resp.status >= 500 && canRetryOnServerError) {
      logger.warn(
        { websiteApiRequest: requestLog, attempt, maxAttempts, status: resp.status },
        "website integration: outbound request got a server error, retrying"
      );
      await sleep(RETRY_DELAY_MS);
      continue;
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

    logger.info(
      {
        websiteApiRequest: requestLog,
        websiteApiResponse: { status: resp.status, body: parsedBody ?? rawText.slice(0, 2000) },
      },
      "website integration: outbound response"
    );

    // Exactly one credential-refresh retry per outbound call — the
    // recursive call below passes no refresher, so a 401 on the retried
    // request is final (falls through to the return below) rather than
    // looping. Not counted against maxAttempts (that budget is for
    // transient network/5xx issues, a different failure class).
    if (resp.status === 401 && credentialRefresher) {
      const refresh = await credentialRefresher();
      if (refresh.refreshed) {
        logger.info({ websiteApiRequest: requestLog }, "website integration: 401 received, retrying once with a refreshed credential");
        return loggedFetch(context, method, url, refresh.headers, body, timeoutMs);
      }
      logger.warn({ websiteApiRequest: requestLog }, "website integration: 401 received, credential refresh unavailable or failed");
    }

    return { httpOk: resp.ok, status: resp.status, rawText, parsedBody };
  }

  throw new Error("unreachable: loggedFetch retry loop exited without returning");
}

// Dispatches a create/update/delete to a tenant's own external website API.
// Default REST convention (used whenever no per-method endpoint override is
// configured): POST to the base URL for create; PUT/PATCH/DELETE to
// `${baseUrl}/${externalId}` for update/delete. A Super-Admin-configured
// per-method override (WebsiteIntegrationEndpoint) takes precedence over
// this convention for its method — see resolveEndpoint.
//
// A POST is only ever reported as a success when the response body actually
// yields an id/externalId (see extractId) — every subsequent update/delete
// for this item is keyed on that externalId (never the dashboard row's own
// id, which only ever appears in logs for correlation, see CallContext).
// An item with no externalId can't be addressed on the external site again,
// so "HTTP 200 but no id in the body" is treated as a failed create, not a
// successful one with a null id — see websiteContentService.ts's pushCreate.
export async function callWebsiteApi(
  integration: IntegrationConfig,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  externalId: string | null,
  payload: Record<string, unknown> | undefined,
  context: CallContext,
  credentialRefresher?: CredentialRefresher
): Promise<WebsiteApiResult> {
  const mapping = parseFieldMapping(integration.fieldMapping);
  const resolved = resolveWriteRequest(integration, method, externalId, payload, mapping);

  // One consolidated log line per call with the final verdict (success,
  // extracted externalId, error) — loggedFetch below already logs the raw
  // request (URL, payload) and raw response (status, body) separately; this
  // ties them to the decision actually made from them, so "why did this
  // item end up the way it did" is answerable from logs alone.
  function logOutcome(outcome: WebsiteApiResult, note?: string): WebsiteApiResult {
    const level = outcome.success ? "info" : "warn";
    logger[level](
      {
        websiteApiOutcome: {
          tenantId: context.tenantId,
          contentType: context.contentType,
          itemId: context.itemId,
          method,
          url: resolved.ok ? resolved.url : integration.baseUrl,
          success: outcome.success,
          externalId: outcome.externalId ?? null,
          error: outcome.error ?? null,
          note: note ?? null,
        },
      },
      "website integration: sync outcome"
    );
    return outcome;
  }

  if (!resolved.ok) {
    return logOutcome(
      { success: false, error: resolved.error },
      `could not build a request URL — lookup key "${integration.lookupKey}" is configured but unresolvable for this item`
    );
  }

  const headers = buildAuthHeaders(resolved.authType, resolved.encryptedCredentials, resolved.accessTokenEncrypted);
  const mappedPayload = payload ? toExternalKeys(payload, mapping) : payload;

  // WRITEBACK_TIMEOUT_MS, not REQUEST_TIMEOUT_MS — this is the create/
  // update/delete push path (see that constant's comment for why it needs
  // more time than a read/probe call).
  const result = await loggedFetch(context, method, resolved.url, headers, mappedPayload, WRITEBACK_TIMEOUT_MS, credentialRefresher);

  if ("networkError" in result) {
    return logOutcome({ success: false, error: result.networkError });
  }

  // A DELETE that finds nothing to delete is already in the exact end
  // state it was asked to reach — treat it as success (idempotent DELETE),
  // not failure. Without this, a DELETE whose first response was lost to a
  // network blip (genuinely reached the site and succeeded, but we timed
  // out waiting) gets auto-retried, the retry lands on an already-gone
  // resource, the site correctly answers 404, and — without this check —
  // that would be reported as a failed delete even though the site's state
  // is exactly what was asked for. The local dashboard row would then be
  // kept (marked "failed") while the item is actually already gone on the
  // site — a real, confirmed divergence (reproduced end-to-end against a
  // live server: see the outbound-request/outbound-response/sync-outcome
  // log sequence this produces). PUT/PATCH deliberately do NOT get this
  // treatment — a 404 there genuinely means "nothing to update," which is
  // a real failure, not an already-satisfied goal.
  if (method === "DELETE" && result.status === 404) {
    return logOutcome({ success: true, status: result.status }, "external API returned 404 for DELETE — treated as already deleted");
  }

  if (!result.httpOk) {
    return logOutcome({ success: false, status: result.status, error: `External API error ${result.status}: ${result.rawText.slice(0, 300)}` });
  }

  if (!bodyReportsSuccess(result.parsedBody, result.httpOk)) {
    return logOutcome({ success: false, status: result.status, error: `External API reported failure: ${result.rawText.slice(0, 300)}` });
  }

  if (method === "POST") {
    const createdId = extractId(unwrapResource(result.parsedBody));
    if (!createdId) {
      return logOutcome({
        success: false,
        status: result.status,
        error: `External API returned a success response but no id/externalId was found in it: ${result.rawText.slice(0, 300)}`,
      });
    }
    return logOutcome({ success: true, status: result.status, externalId: createdId });
  }
  return logOutcome({ success: true, status: result.status });
}

// Describes what was actually received when extractList/extractSingle
// couldn't find a list or item, so "Unexpected response shape" is
// diagnosable from the error message alone (surfaced all the way to the
// Super Admin's UI) rather than requiring a server log lookup. In
// particular, distinguishes "the response wasn't JSON at all" (e.g. an
// HTML login/error page — the actual cause when a site's GET endpoint
// silently redirects to an auth wall or a SPA's catch-all page) from
// "it was valid JSON, just not a shape we recognize".
function describeUnexpectedBody(parsedBody: unknown, rawText: string): string {
  if (parsedBody === null) {
    const trimmed = rawText.trim();
    if (!trimmed) return "the response body was empty";
    const preview = trimmed.slice(0, 150);
    return `the response was not valid JSON (starts with: ${preview}${trimmed.length > 150 ? "…" : ""})`;
  }
  if (Array.isArray(parsedBody)) return "got a JSON array";
  if (parsedBody && typeof parsedBody === "object") {
    const keys = Object.keys(parsedBody as Record<string, unknown>);
    return `got a JSON object with keys: ${keys.length > 0 ? keys.join(", ") : "(none)"}`;
  }
  return `got a JSON ${typeof parsedBody}`;
}

// Consolidated "what actually happened" log line for a GET/import call —
// the counterpart to callWebsiteApi's logOutcome, so an import's final
// verdict (success, item count, error) is answerable from logs alone the
// same way a create/update/delete's is, instead of only showing up as an
// audit-log row (FEATURE_ITEM_IMPORTED) with no matching structured log.
function logImportOutcome(
  context: CallContext,
  url: string,
  outcome: { success: boolean; count?: number; error?: string }
): void {
  const level = outcome.success ? "info" : "warn";
  logger[level](
    {
      websiteApiOutcome: {
        tenantId: context.tenantId,
        contentType: context.contentType,
        method: "GET",
        url,
        success: outcome.success,
        count: outcome.count ?? null,
        error: outcome.error ?? null,
      },
    },
    "website integration: import outcome"
  );
}

// One page of the standardized admin GET contract — always requests
// page/pageSize alongside the caller's filters (see buildQueryString) so a
// site that DOES paginate its own list endpoint hands back the page asked
// for; a site that doesn't is expected to just ignore those params, same
// as any other unrecognized query param.
const IMPORT_PAGE_SIZE = 100;

// Bounds worst-case work against a site that doesn't actually honor
// page/pageSize and keeps returning the same (or an unbounded) set on
// every "page" — 20 pages × 100 items is a generous 2000-item ceiling per
// import, the same order of magnitude as customers.ts's own
// MAX_IMPORT_ROWS. In practice a non-paginating site only ever costs 2
// requests, not all 20 — see the "stop when a page adds nothing new" check
// below — this cap is a safety floor, not the expected path.
const MAX_IMPORT_PAGES = 20;

type PageFetchResult =
  | { ok: true; items: Record<string, unknown>[]; url: string }
  | { ok: false; error: string; url: string; status?: number };

async function fetchOnePage(
  context: CallContext,
  resolved: { url: string; authType: string; encryptedCredentials: string | null },
  headers: Record<string, string>,
  responseMapping: ResponseMapping | null,
  filters: WebsiteApiImportFilters | undefined,
  page: number,
  credentialRefresher?: CredentialRefresher
): Promise<PageFetchResult> {
  const url = resolved.url + buildQueryString(filters, { page, pageSize: IMPORT_PAGE_SIZE });
  const result = await loggedFetch(context, "GET", url, headers, undefined, undefined, credentialRefresher);
  if ("networkError" in result) return { ok: false, error: result.networkError, url };
  if (!result.httpOk) return { ok: false, error: `External API error ${result.status}: ${result.rawText.slice(0, 300)}`, url, status: result.status };
  if (!bodyReportsSuccess(result.parsedBody, result.httpOk)) {
    return { ok: false, error: `External API reported failure: ${result.rawText.slice(0, 300)}`, url, status: result.status };
  }

  const items = extractList(result.parsedBody, responseMapping?.listPath);
  if (items === null) {
    return {
      ok: false,
      error: `Unexpected response shape: expected a list of items — ${describeUnexpectedBody(result.parsedBody, result.rawText)}`,
      url,
      status: result.status,
    };
  }
  return { ok: true, items, url };
}

// Fetches the tenant's FULL list of items for a content type from their
// external API — the counterpart to callWebsiteApi's push direction, used
// to import/sync existing website data into the dashboard. Filters are the
// standardized admin GET contract's query params — same ones for every
// tenant's site (see WebsiteApiImportFilters), passed through as-is so an
// external site can narrow the result (e.g. only one category) without the
// dashboard needing to know that site's specific field names.
//
// Pages through the site's own pagination (if any) rather than trusting a
// single response to be the complete list — a site whose real catalog
// exceeds one page previously had everything past page 1 silently
// unreachable. Keeps fetching while a page comes back full (>= page size)
// AND still contributes items not already seen (by externalId) — either
// condition failing means "that was the last page" or "this site isn't
// actually paginating," both of which stop the loop safely.
export async function fetchWebsiteApi(
  integration: IntegrationConfig,
  context: CallContext,
  filters?: WebsiteApiImportFilters,
  credentialRefresher?: CredentialRefresher
): Promise<WebsiteApiListResult> {
  const conventionUrl = integration.baseUrl.replace(/\/$/, "");
  const resolved = resolveEndpoint(integration, "GET", conventionUrl, null);
  const headers = buildAuthHeaders(resolved.authType, resolved.encryptedCredentials, resolved.accessTokenEncrypted);
  const responseMapping = parseResponseMapping(integration.responseMapping);

  const seenExternalIds = new Set<string>();
  const accumulated: Record<string, unknown>[] = [];
  let lastUrl = resolved.url;

  for (let page = 1; page <= MAX_IMPORT_PAGES; page++) {
    const pageResult = await fetchOnePage(context, resolved, headers, responseMapping, filters, page, credentialRefresher);
    lastUrl = pageResult.url;

    if (!pageResult.ok) {
      // Page 1 failing is a genuine import failure. A later page failing
      // (e.g. the site 500s once it's past its own real last page)
      // degrades gracefully instead — return what was already
      // successfully accumulated rather than discarding a
      // partially-successful multi-page import.
      if (page === 1) {
        logImportOutcome(context, lastUrl, { success: false, error: pageResult.error });
        return { success: false, error: pageResult.error, status: pageResult.status };
      }
      break;
    }

    if (pageResult.items.length === 0) break;

    let newCount = 0;
    for (const item of pageResult.items) {
      const id = extractId(item);
      if (id === undefined) {
        // No stable id to de-dup on — include as-is (matches importItems'
        // own slug-fallback tolerance for id-less feeds).
        accumulated.push(item);
        newCount++;
        continue;
      }
      if (seenExternalIds.has(id)) continue;
      seenExternalIds.add(id);
      accumulated.push(item);
      newCount++;
    }
    // A "page" that contributed nothing new means this site isn't
    // actually honoring page/pageSize (it's returning the same set every
    // time) — stop instead of grinding through MAX_IMPORT_PAGES for no
    // benefit.
    if (newCount === 0) break;

    if (pageResult.items.length < IMPORT_PAGE_SIZE) break;
  }

  const mapping = parseFieldMapping(integration.fieldMapping);
  const mappedItems = accumulated.map((item) => toDashboardKeys(item, mapping));
  logImportOutcome(context, lastUrl, { success: true, count: mappedItems.length });
  // Synthetic — a successful import implies at least page 1 returned 2xx;
  // exact per-page status isn't tracked through the pagination loop, and
  // reconcileCredentialStatus only needs "< 400" to clear CredentialsExpired.
  return { success: true, items: mappedItems, status: 200 };
}

export type WebsiteApiItemResult = { success: boolean; item?: Record<string, unknown>; error?: string; status?: number };

// Singleton counterpart to fetchWebsiteApi — for content types where the
// external API's GET returns one resource (e.g. Contact Details) rather
// than a list.
export async function fetchWebsiteApiSingle(
  integration: IntegrationConfig,
  context: CallContext,
  filters?: WebsiteApiImportFilters,
  credentialRefresher?: CredentialRefresher
): Promise<WebsiteApiItemResult> {
  const conventionUrl = integration.baseUrl.replace(/\/$/, "");
  const resolved = resolveEndpoint(integration, "GET", conventionUrl, null);
  const url = resolved.url + buildQueryString(filters);
  const headers = buildAuthHeaders(resolved.authType, resolved.encryptedCredentials, resolved.accessTokenEncrypted);

  const result = await loggedFetch(context, "GET", url, headers, undefined, undefined, credentialRefresher);
  if ("networkError" in result) {
    logImportOutcome(context, url, { success: false, error: result.networkError });
    return { success: false, error: result.networkError };
  }

  if (!result.httpOk) {
    const error = `External API error ${result.status}: ${result.rawText.slice(0, 300)}`;
    logImportOutcome(context, url, { success: false, error });
    return { success: false, error, status: result.status };
  }

  if (!bodyReportsSuccess(result.parsedBody, result.httpOk)) {
    const error = `External API reported failure: ${result.rawText.slice(0, 300)}`;
    logImportOutcome(context, url, { success: false, error });
    return { success: false, error, status: result.status };
  }

  const responseMapping = parseResponseMapping(integration.responseMapping);
  const resource = extractSingle(result.parsedBody, responseMapping?.itemPath);
  if (!resource) {
    const error = `Unexpected response shape: expected a single item — ${describeUnexpectedBody(result.parsedBody, result.rawText)}`;
    logImportOutcome(context, url, { success: false, error });
    return { success: false, error, status: result.status };
  }
  const mapping = parseFieldMapping(integration.fieldMapping);
  logImportOutcome(context, url, { success: true, count: 1 });
  return { success: true, item: toDashboardKeys(resource, mapping), status: result.status };
}

// ---------------------------------------------------------------------------
// Schema discovery ("Analyze Endpoint" / "Refresh Schema")
// ---------------------------------------------------------------------------

export type DiscoveredFieldType = "string" | "number" | "boolean" | "date" | "array" | "object";
// Deliberately name/type only — no `sample`/value field. This is what a
// Super Admin confirming "is this pulling the right table" sees, and what
// gets persisted to WebsiteIntegration.discoveredSchema/
// WebsiteIntegrationSchemaSnapshot: schema shape only, never a real value
// from the tenant's live site (which could be another customer's PII,
// payment info, etc., depending on what that endpoint returns).
export type DiscoveredField = { path: string; type: DiscoveredFieldType };

// Conservative: only strings that both look like a date AND parse as one —
// an arbitrary numeric-looking string ("2024") shouldn't be misclassified.
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;

function inferType(value: unknown): DiscoveredFieldType {
  if (value === null || value === undefined) return "string";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string" && DATE_LIKE.test(value) && !Number.isNaN(Date.parse(value))) return "date";
  return "string";
}

// Walks a sample record into a flat list of leaf paths — objects recurse
// with a dot ("category" -> "category.id"), arrays of objects recurse into
// their first element with a "[0]" suffix ("images" -> "images[0].url"),
// and arrays of primitives (or empty arrays) are reported as a single
// "array"-typed leaf rather than decomposed further, since there's no
// stable per-element path to offer for those. This exactly produces the
// path shapes getByPath/setByPath above already know how to read/write.
export function walkSchema(value: unknown, prefix = ""): DiscoveredField[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [{ path: prefix, type: "array" }];
    if (value[0] !== null && typeof value[0] === "object" && !Array.isArray(value[0])) {
      return walkSchema(value[0], `${prefix}[0]`);
    }
    return [{ path: prefix, type: "array" }];
  }
  if (value !== null && typeof value === "object") {
    const fields: DiscoveredField[] = [];
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      fields.push(...(v !== null && typeof v === "object" ? walkSchema(v, path) : [{ path, type: inferType(v) }]));
    }
    return fields;
  }
  return [{ path: prefix, type: inferType(value) }];
}

export type DiscoverSchemaResult = {
  success: boolean;
  fields?: DiscoveredField[];
  // Count of records in the discovered list (or 1 for a singleton
  // resource) — the other half of the redacted preview alongside `fields`,
  // giving a Super Admin "yes, this is pulling ~40 products" confidence
  // without ever showing a real product's actual name/price/etc.
  recordCount?: number;
  error?: string;
};

// Real GET (this is what "Analyze Endpoint" clicks trigger) — reuses the
// exact same list-location logic as fetchWebsiteApi (extractList,
// unwrapResource, responseMapping) so "where the records live" is
// answered identically for discovery and for a real import, then walks
// the first item into a field list. Deliberately does NOT apply
// fieldMapping — the whole point is to show the RAW external shape so a
// mapping can be built from it, not one already renamed by a prior
// mapping.
export async function discoverSchema(
  url: string,
  headers: Record<string, string>,
  listPath: string | undefined,
  context: CallContext
): Promise<DiscoverSchemaResult> {
  const result = await loggedFetch(context, "GET", url, headers);
  if ("networkError" in result) {
    return { success: false, error: `Unreachable: ${result.networkError}` };
  }
  if (!result.httpOk) {
    return { success: false, error: `External API error ${result.status}: ${result.rawText.slice(0, 300)}` };
  }
  if (!bodyReportsSuccess(result.parsedBody, result.httpOk)) {
    return { success: false, error: `External API reported failure: ${result.rawText.slice(0, 300)}` };
  }

  const items = extractList(result.parsedBody, listPath);
  const sample = items && items.length > 0 ? items[0] : extractSingle(result.parsedBody, listPath);
  if (!sample) {
    return {
      success: false,
      error: `Could not find a sample record to analyze — ${describeUnexpectedBody(result.parsedBody, result.rawText)}`,
    };
  }
  return { success: true, fields: walkSchema(sample), recordCount: items ? items.length : 1 };
}

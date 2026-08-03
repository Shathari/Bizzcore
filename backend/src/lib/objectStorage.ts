import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

// Cloudflare R2 (S3-compatible) — every tenant upload (logos, product/
// content images, social media) now lives here instead of local disk (see
// lib/upload.ts, which is the tenant-facing API built on top of this).
// Chosen over S3/Backblaze B2 for zero egress fees, which matters directly
// here since every object this app stores is eventually served publicly
// (a tenant's own storefront, or the dashboard UI itself) — R2 gets that
// for free with the same S3-compatible API this SDK already speaks,
// without needing a second vendor (e.g. B2 + a separate CDN) wired in to
// get the same result.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}

function getBucket(): string {
  return requireEnv("R2_BUCKET_NAME");
}

// No trailing slash — every URL this module builds/parses assumes that.
function getPublicUrlBase(): string {
  return requireEnv("R2_PUBLIC_URL").replace(/\/$/, "");
}

export async function uploadObject(key: string, buffer: Buffer, contentType: string): Promise<string> {
  await getClient().send(new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: buffer, ContentType: contentType }));
  return `${getPublicUrlBase()}/${key}`;
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const result = await getClient().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  if (!result.Body) throw new Error(`Object not found: ${key}`);
  const bytes = await result.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

// Used on permanent tenant deletion — replaces the old fs.rm(UPLOADS_ROOT/
// tenantId) local-disk cleanup. Every object key this module writes is
// namespaced "{tenantId}/..." (see lib/upload.ts), so a prefix delete here
// is the exact R2 equivalent of that recursive local rm.
export async function deleteObjectsByPrefix(prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const listed = await getClient().send(
      new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix, ContinuationToken: continuationToken })
    );
    const keys = (listed.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k));
    if (keys.length > 0) {
      await getClient().send(new DeleteObjectsCommand({ Bucket: getBucket(), Delete: { Objects: keys.map((Key) => ({ Key })) } }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

// Extracts the object key from one of OUR OWN public URLs (this exact
// bucket's public base) — null for anything else: an external URL, a
// legacy local /uploads/... path from before this migration, or a URL
// from a different R2 bucket/environment. Used both to know what to
// delete and, in lib/mediaSync.ts, to tell "our own not-yet-synced
// upload, still needs pushing to the tenant's destination site" apart
// from "already an external URL — nothing to do."
export function keyFromPublicUrl(url: string): string | null {
  const base = getPublicUrlBase();
  if (!url.startsWith(`${base}/`)) return null;
  return url.slice(base.length + 1);
}

export function isOurPublicUrl(url: string): boolean {
  return keyFromPublicUrl(url) !== null;
}

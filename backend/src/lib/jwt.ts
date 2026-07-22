import jwt from "jsonwebtoken";
import type { Role } from "./roles";

export type JwtPayload = {
  sub: string;
  role: Role;
  tenantId: string | null;
  mustChangePassword: boolean;
};

// Checked lazily (per call) rather than at module-import time. Practically
// identical fail-fast behavior for the real app — every route needs this
// on its very first request — but it avoids a module-load-order
// dependency between this file and whatever sets process.env.JWT_SECRET
// (dotenv in production, a test setup file in tests), which would
// otherwise make import order brittle.
function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set — refusing to sign/verify without it");
  }
  return secret;
}

export function signAuthToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAuthToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as unknown as JwtPayload;
}

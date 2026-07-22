import type { RequestHandler } from "express";
import { verifyAuthToken } from "../lib/jwt";

const COOKIE_NAME = process.env.COOKIE_NAME ?? "bizzcore_session";

// Verifies the httpOnly session cookie and attaches the decoded identity to
// req.user. This is the only place req.user is ever set — every downstream
// middleware/route trusts it without re-deriving identity from the request.
export const authenticate: RequestHandler = (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const payload = verifyAuthToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role,
      tenantId: payload.tenantId,
      mustChangePassword: payload.mustChangePassword,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
};

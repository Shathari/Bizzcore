import type { RequestHandler } from "express";
import { verifyAuthToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";

const COOKIE_NAME = process.env.COOKIE_NAME ?? "bizzcore_session";

// Verifies the httpOnly session cookie and attaches the decoded identity to
// req.user. This is the only place req.user is ever set — every downstream
// middleware/route trusts it without re-deriving identity from the request.
export const authenticate: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  let payload;
  try {
    payload = verifyAuthToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  try {
    const account = await prisma.user.findUnique({ where: { id: payload.sub }, select: { role: true, tenantId: true, disabledAt: true, mustChangePassword: true, authVersion: true } });
    if (!account || account.role !== payload.role || account.tenantId !== payload.tenantId) {
      res.status(401).json({ error: "Invalid or expired session" }); return;
    }
    if (payload.role === "EMPLOYEE") {
      if (account.disabledAt) {
        res.status(403).json({ error: "Employee access is unavailable" }); return;
      }
    }
    if ((payload.authVersion ?? 0) !== account.authVersion) {
      res.status(401).json({ error: "Invalid or expired session" }); return;
    }
    payload.mustChangePassword = account.mustChangePassword;
    req.user = {
      id: payload.sub,
      role: payload.role,
      tenantId: payload.tenantId,
      mustChangePassword: payload.mustChangePassword,
    };
    next();
  } catch (error) {
    next(error);
  }
};

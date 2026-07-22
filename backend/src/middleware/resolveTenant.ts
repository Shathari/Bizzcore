import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma";

// Sets req.tenantId strictly from the authenticated JWT payload (req.user,
// populated by `authenticate`) — never from req.params, req.query, or
// request headers. A client can never point a request at another tenant by
// supplying a different tenantId anywhere in the request.
//
// Must run after `authenticate`. SUPER_ADMIN tokens carry tenantId: null,
// so this middleware also doubles as the guard that keeps Super Admin out
// of tenant business-data routes (pair with authorize("ADMIN") on those
// routes for defense in depth).
//
// The JWT itself is stateless and only checked for Suspended/deleted status
// at login (routes/auth.ts) — without the DB check below, an Admin already
// logged in before their business was suspended or deleted would keep full
// API access until their token expires, which contradicts Business
// Management's "any change ... immediately ... reflected throughout the
// application". This is the one shared choke point every tenant-scoped
// Business Admin route already runs through, so it's where that gets
// enforced in real time instead.
export const resolveTenant: RequestHandler = async (req, res, next) => {
  if (!req.user?.tenantId) {
    res.status(403).json({ error: "Tenant context required" });
    return;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: req.user.tenantId },
    select: { status: true, deletedAt: true },
  });
  if (!tenant || tenant.deletedAt) {
    res.status(403).json({ error: "This business is no longer available." });
    return;
  }
  if (tenant.status === "Suspended") {
    res.status(403).json({ error: "This account has been suspended. Contact support." });
    return;
  }

  req.tenantId = req.user.tenantId;
  next();
};

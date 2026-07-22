import type { RequestHandler } from "express";
import type { Role } from "../lib/roles";

// Backend is the real enforcement point — any frontend role-checks are
// cosmetic only. Must run after `authenticate`.
export const authorize =
  (...roles: Role[]): RequestHandler =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };

import type { RequestHandler } from "express";

// Backend-side mirror of the frontend's forced "set new password" screen —
// blocks business-data routes while a freshly-provisioned admin still has a
// temporary password, since frontend gating alone is cosmetic. Must run
// after `authenticate`. Not applied to /api/auth/* itself, which is how the
// password actually gets changed.
export const requirePasswordSet: RequestHandler = (req, res, next) => {
  if (req.user?.mustChangePassword) {
    res.status(403).json({ error: "Password change required", code: "MUST_CHANGE_PASSWORD" });
    return;
  }
  next();
};

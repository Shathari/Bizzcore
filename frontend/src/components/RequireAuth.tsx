import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../api/auth";
import { FullScreenSpinner } from "./FullScreenSpinner";

// Frontend role-checks are cosmetic — the backend (authorize middleware)
// is the real enforcement. This just keeps the UI from ever rendering the
// wrong shell, and enforces the "forced password change screen before
// anything else is reachable" rule client-side (mirrored server-side by
// requirePasswordSet on tenant business-data routes).
export function RequireAuth({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <FullScreenSpinner />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  if (user.role !== role) {
    return <Navigate to={user.role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard"} replace />;
  }

  return <>{children}</>;
}

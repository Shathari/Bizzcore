import type { Role } from "../lib/roles";

declare global {
  namespace Express {
    interface Request {
      // Set by `authenticate` from the verified JWT — never trust any
      // client-supplied field for identity/tenancy, only this.
      user?: {
        id: string;
        role: Role;
        tenantId: string | null;
        mustChangePassword: boolean;
      };
      // Set by `resolveTenant`, derived solely from req.user.tenantId.
      tenantId?: string;
    }
  }
}

export {};

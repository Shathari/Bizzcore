import { apiClient } from "./client";

export type Role = "SUPER_ADMIN" | "ADMIN";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string | null;
  mustChangePassword: boolean;
  businessName: string | null;
  logoUrl: string | null;
};

export async function login(email: string, password: string): Promise<void> {
  await apiClient.post("/auth/login", { email, password });
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const { data } = await apiClient.get<CurrentUser>("/auth/me");
    return data;
  } catch {
    return null;
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post("/auth/change-password", { currentPassword, newPassword });
}

export async function forgotPassword(email: string): Promise<void> {
  await apiClient.post("/auth/forgot-password", { email });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiClient.post("/auth/reset-password", { token, newPassword });
}

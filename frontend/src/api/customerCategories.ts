import { apiClient } from "./client";

export type CustomerCategory = {
  id: string;
  name: string;
  isBuiltIn: boolean;
  isPriority: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

// Tenant-scoped, editable categories (seeded with Regular/VIP/Bridal) used
// to categorize Customers and target Communication Center broadcasts — see
// backend/src/lib/customerCategories.ts.
export async function listCustomerCategories(): Promise<CustomerCategory[]> {
  const { data } = await apiClient.get<CustomerCategory[]>("/customer-categories");
  return data;
}

export async function createCustomerCategory(input: { name: string; isPriority?: boolean }): Promise<CustomerCategory> {
  const { data } = await apiClient.post<CustomerCategory>("/customer-categories", input);
  return data;
}

export async function updateCustomerCategory(
  id: string,
  input: { name?: string; isPriority?: boolean }
): Promise<CustomerCategory> {
  const { data } = await apiClient.patch<CustomerCategory>(`/customer-categories/${id}`, input);
  return data;
}

export async function deleteCustomerCategory(id: string): Promise<void> {
  await apiClient.delete(`/customer-categories/${id}`);
}

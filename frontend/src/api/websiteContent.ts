import { apiClient } from "./client";
import type { WebsiteContentType, WebsiteContentImportFilters, ModuleInfo, WebsiteContentItem } from "./superAdminWebsite";

export type { ModuleInfo, WebsiteContentItem };

export async function listActiveModules(): Promise<ModuleInfo[]> {
  const { data } = await apiClient.get<ModuleInfo[]>("/website-content/modules");
  return data;
}

export async function listWebsiteContentItems(
  contentType: WebsiteContentType,
  options?: { search?: string; page?: number; pageSize?: number }
): Promise<{ items: WebsiteContentItem[]; total: number; page: number; pageSize: number }> {
  const { data } = await apiClient.get(`/website-content/${contentType}`, { params: options });
  return data;
}

export async function createWebsiteContentItem(
  contentType: WebsiteContentType,
  payload: Record<string, unknown>
): Promise<WebsiteContentItem> {
  const { data } = await apiClient.post<WebsiteContentItem>(`/website-content/${contentType}`, payload);
  return data;
}

export async function updateWebsiteContentItem(
  contentType: WebsiteContentType,
  id: string,
  payload: Record<string, unknown>
): Promise<WebsiteContentItem> {
  const { data } = await apiClient.patch<WebsiteContentItem>(`/website-content/${contentType}/${id}`, payload);
  return data;
}

export async function deleteWebsiteContentItem(contentType: WebsiteContentType, id: string): Promise<void> {
  await apiClient.delete(`/website-content/${contentType}/${id}`);
}

export async function importWebsiteContentItems(
  contentType: WebsiteContentType,
  filters?: WebsiteContentImportFilters
): Promise<{ imported: number; skipped: number; removed: number; items: WebsiteContentItem[] }> {
  const { data } = await apiClient.post(`/website-content/${contentType}/import`, filters ?? {});
  return data;
}

export async function syncWebsiteContentItems(
  contentType: WebsiteContentType
): Promise<{ retried: number; retriedFailed: number; imported: number; skipped: number; removed: number; items: WebsiteContentItem[] }> {
  const { data } = await apiClient.post(`/website-content/${contentType}/sync`);
  return data;
}

export async function uploadContentImage(contentType: WebsiteContentType, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<{ url: string }>(`/website-content/${contentType}/uploads`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.url;
}

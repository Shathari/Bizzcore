import { apiClient } from "./client";
export type Employee = { id: string; name: string; email: string; disabledAt: string | null; createdAt: string; mustChangePassword: boolean };
export async function listEmployees() { return (await apiClient.get<Employee[]>("/employees")).data; }
export async function createEmployee(input: { name: string; email: string; temporaryPassword: string }) { return (await apiClient.post<Employee>("/employees", input)).data; }
export async function setEmployeeActive(id: string, active: boolean) { await apiClient.patch(`/employees/${id}`, { active }); }

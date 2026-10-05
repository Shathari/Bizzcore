import { describe, it, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { app, createTenantWithAdmin, createTestCustomer, createSuperAdmin, loginAs, TEST_PASSWORD } from "./helpers";
import { prisma } from "../src/lib/prisma";

const input = () => ({ name: "Sales Staff", email: `staff-${randomUUID()}@test.example`, temporaryPassword: "Temporary123!" });
async function fixture() {
  const { tenant, admin } = await createTenantWithAdmin(); const cookie = await loginAs(admin.email);
  const data = input(); const response = await request(app).post("/api/employees").set("Cookie", cookie).send(data);
  expect(response.status).toBe(201);
  return { tenant, admin, cookie, data, employee: response.body };
}
async function signIn(email: string, password: string) {
  return request(app).post("/api/auth/login").send({ email, password });
}

describe("tenant employee management", () => {
  it("creates a hashed, forced-change employee and returns only safe fields", async () => {
    const f = await fixture(); const row = await prisma.user.findUniqueOrThrow({ where: { id: f.employee.id } });
    expect(row).toMatchObject({ role: "EMPLOYEE", tenantId: f.tenant.id, mustChangePassword: true, disabledAt: null });
    expect(row.passwordHash).not.toBe(f.data.temporaryPassword); expect(await bcrypt.compare(f.data.temporaryPassword, row.passwordHash)).toBe(true);
    const list = await request(app).get("/api/employees").set("Cookie", f.cookie);
    expect(list.status).toBe(200); expect(list.body.map((e: { id: string }) => e.id)).toEqual([row.id]);
    for (const body of [f.employee, ...list.body]) { expect(body).not.toHaveProperty("passwordHash"); expect(body).not.toHaveProperty("temporaryPassword"); }
  });
  it("rejects role/tenant spoofing, duplicate email and invalid inputs", async () => {
    const f = await fixture(); const other = await createTenantWithAdmin();
    for (const extra of [{ role: "SUPER_ADMIN" }, { role: "ADMIN" }, { tenantId: other.tenant.id }]) {
      expect((await request(app).post("/api/employees").set("Cookie", f.cookie).send({ ...input(), ...extra })).status).toBe(400);
    }
    for (const extra of [{ name: " " }, { email: "bad" }, { temporaryPassword: "short" }, { temporaryPassword: "x".repeat(129) }]) {
      expect((await request(app).post("/api/employees").set("Cookie", f.cookie).send({ ...input(), ...extra })).status).toBe(400);
    }
    expect((await request(app).post("/api/employees").set("Cookie", f.cookie).send({ ...f.data, email: f.data.email.toUpperCase() })).status).toBe(409);
    expect(await prisma.user.count({ where: { tenantId: other.tenant.id, role: "EMPLOYEE" } })).toBe(0);
  });
  it("reuses login and forced password change before permitting masked sales access", async () => {
    const f = await fixture(); const customer = await createTestCustomer(f.tenant.id, { phone: "+919800000088" });
    const login = await signIn(f.data.email, f.data.temporaryPassword); expect(login.status).toBe(200); expect(login.body.mustChangePassword).toBe(true);
    const cookie = login.headers["set-cookie"];
    expect((await request(app).post("/api/purchases/customer-lookup").set("Cookie", cookie).send({ phone: "919800000088" })).status).toBe(403);
    const change = await request(app).post("/api/auth/change-password").set("Cookie", cookie).send({ currentPassword: f.data.temporaryPassword, newPassword: TEST_PASSWORD });
    expect(change.status).toBe(200);
    const normal = change.headers["set-cookie"];
    expect((await request(app).post("/api/purchases/customer-lookup").set("Cookie", cookie).send({ phone: "919800000088" })).status).toBe(401);
    const lookup = await request(app).post("/api/purchases/customer-lookup").set("Cookie", normal).send({ phone: "919800000088" });
    expect(lookup.status).toBe(200); expect(lookup.body.customers[0].id).toBe(customer.id); expect(lookup.body.customers[0]).not.toHaveProperty("phone");
    expect((await request(app).post("/api/purchases").set("Cookie", normal).send({ customerId: customer.id, amount: 50, requestId: randomUUID() })).status).toBe(201);
  });
  it("disables existing sessions and new logins without deleting purchases, then reactivates", async () => {
    const f = await fixture(); await prisma.user.update({ where: { id: f.employee.id }, data: { mustChangePassword: false } });
    const customer = await createTestCustomer(f.tenant.id); const employeeCookie = await loginAs(f.data.email, f.data.temporaryPassword);
    expect((await request(app).post("/api/purchases").set("Cookie", employeeCookie).send({ customerId: customer.id, amount: 50, requestId: randomUUID() })).status).toBe(201);
    expect((await request(app).patch(`/api/employees/${f.employee.id}`).set("Cookie", f.cookie).send({ active: false })).status).toBe(200);
    expect((await signIn(f.data.email, f.data.temporaryPassword)).status).toBe(403);
    for (const path of ["/api/auth/me", `/api/purchases/customers/${customer.id}`]) expect((await request(app).get(path).set("Cookie", employeeCookie)).status).toBe(403);
    expect((await request(app).post("/api/purchases").set("Cookie", employeeCookie).send({ customerId: customer.id, amount: 50, requestId: randomUUID() })).status).toBe(403);
    expect((await request(app).post("/api/auth/change-password").set("Cookie", employeeCookie).send({ currentPassword: f.data.temporaryPassword, newPassword: TEST_PASSWORD })).status).toBe(403);
    expect(await prisma.purchase.count({ where: { tenantId: f.tenant.id } })).toBe(1);
    expect((await request(app).patch(`/api/employees/${f.employee.id}`).set("Cookie", f.cookie).send({ active: true })).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", employeeCookie)).status).toBe(401);
    expect((await signIn(f.data.email, f.data.temporaryPassword)).status).toBe(200);
    const freshCookie = await loginAs(f.data.email, f.data.temporaryPassword);
    expect((await request(app).get(`/api/purchases/customers/${customer.id}`).set("Cookie", freshCookie)).status).toBe(200);
  });
  it("isolates employee list and updates from other tenants and admin accounts", async () => {
    const a = await fixture(); const b = await fixture();
    const list = await request(app).get("/api/employees").query({ tenantId: b.tenant.id }).set("Cookie", a.cookie);
    expect(list.body.map((e: { id: string }) => e.id)).toEqual([a.employee.id]);
    for (const id of [b.employee.id, a.admin.id]) expect((await request(app).patch(`/api/employees/${id}`).set("Cookie", a.cookie).send({ active: false })).status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.employee.id } })).disabledAt).toBeNull();
    expect((await request(app).patch(`/api/employees/${a.employee.id}`).set("Cookie", a.cookie).send({ role: "ADMIN", active: true })).status).toBe(400);
    await prisma.user.update({ where: { id: a.employee.id }, data: { mustChangePassword: false } });
    const staff = await loginAs(a.data.email, a.data.temporaryPassword); const otherCustomer = await createTestCustomer(b.tenant.id);
    expect((await request(app).get(`/api/purchases/customers/${otherCustomer.id}`).set("Cookie", staff)).status).toBe(404);
    expect((await request(app).post("/api/purchases").set("Cookie", staff).send({ customerId: otherCustomer.id, amount: 50, requestId: randomUUID() })).status).toBe(404);
  });
  it("rejects unauthenticated and super-admin employee management", async () => {
    expect((await request(app).get("/api/employees")).status).toBe(401);
    const { user } = await createSuperAdmin(); const cookie = await loginAs(user.email);
    expect((await request(app).post("/api/employees").set("Cookie", cookie).send(input())).status).toBe(403);
  });
  it("denies every administrative route to an employee independently of navigation", async () => {
    const f = await fixture(); await prisma.user.update({ where: { id: f.employee.id }, data: { mustChangePassword: false } });
    const cookie = await loginAs(f.data.email, f.data.temporaryPassword);
    for (const path of ["/api/settings/integrations", "/api/billing/anything", "/api/subscription", "/api/whatsapp/templates", "/api/communication/anything", "/api/customers/export", "/api/customers/export-with-contact-info", "/api/website-content/anything", "/api/social/anything", "/api/ai/anything", "/api/content-research/anything", "/api/connector-config", "/api/connector-login", "/api/inquiries", "/api/customer-categories", "/api/employees", "/api/super-admin/businesses", "/api/dashboard/summary"]) {
      expect((await request(app).get(path).set("Cookie", cookie)).status, path).toBe(403);
    }
    for (const path of ["/api/employees", "/api/customers", "/api/customers/export-with-contact-info", "/api/communication/anything", "/api/settings/whatsapp"]) expect((await request(app).post(path).set("Cookie", cookie).send(input())).status).toBe(403);
    expect((await request(app).delete("/api/customers/missing").set("Cookie", cookie)).status).toBe(403);
    expect((await request(app).patch(`/api/employees/${f.employee.id}`).set("Cookie", cookie).send({ role: "ADMIN", active: true })).status).toBe(403);
  });
});

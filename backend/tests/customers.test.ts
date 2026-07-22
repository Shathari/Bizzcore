import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs } from "./helpers";
import { prisma } from "../src/lib/prisma";

describe("customers: CRUD", () => {
  it("requires name and phone, rejects missing fields", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).post("/api/customers").set("Cookie", cookie).send({ name: "No Phone" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email format", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/customers")
      .set("Cookie", cookie)
      .send({ name: "Bad Email", phone: "+919800000020", email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("creates a customer with defaults (Regular segment, 0 spend)", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/customers")
      .set("Cookie", cookie)
      .send({ name: "Priya Test", phone: "+919800000021" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Priya Test", segment: "Regular", totalSpent: 0 });
  });

  it("deletes a customer and confirms it's gone", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const created = await request(app)
      .post("/api/customers")
      .set("Cookie", cookie)
      .send({ name: "To Delete", phone: "+919800000022" });

    const deleteRes = await request(app).delete(`/api/customers/${created.body.id}`).set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);

    const getRes = await request(app).get(`/api/customers/${created.body.id}`).set("Cookie", cookie);
    expect(getRes.status).toBe(404);
  });

  it("filters by segment and searches by name/phone", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app).post("/api/customers").set("Cookie", cookie).send({ name: "Vip Customer", phone: "+919800000030", segment: "VIP" });
    await request(app).post("/api/customers").set("Cookie", cookie).send({ name: "Regular Customer", phone: "+919800000031" });

    const vipRes = await request(app).get("/api/customers").query({ segment: "VIP" }).set("Cookie", cookie);
    expect(vipRes.body).toHaveLength(1);
    expect(vipRes.body[0].name).toBe("Vip Customer");

    const searchRes = await request(app).get("/api/customers").query({ search: "regular" }).set("Cookie", cookie);
    expect(searchRes.body).toHaveLength(1);
    expect(searchRes.body[0].name).toBe("Regular Customer");
  });
});

describe("customers: PII protection", () => {
  it("never includes phone or birthday ciphertext in create/list/detail responses", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const created = await request(app)
      .post("/api/customers")
      .set("Cookie", cookie)
      .send({ name: "Priya PII", phone: "+919800000099", birthday: "1990-01-01" });
    expect(created.status).toBe(201);
    expect(created.body.phone).toBeUndefined();
    expect(created.body.birthday).toBeUndefined();
    expect(created.body.phoneHash).toBeUndefined();
    expect(created.body.birthdayMonthDay).toBeUndefined();
    expect(created.body.phoneMasked).toBe("+9198••••••99");
    expect(created.body.hasBirthday).toBe(true);

    const listRes = await request(app).get("/api/customers").set("Cookie", cookie);
    expect(listRes.body.length).toBeGreaterThan(0);
    for (const c of listRes.body) {
      expect(c.phone).toBeUndefined();
      expect(c.birthday).toBeUndefined();
      expect(c.phoneHash).toBeUndefined();
      expect(c.birthdayMonthDay).toBeUndefined();
    }

    const detailRes = await request(app).get(`/api/customers/${created.body.id}`).set("Cookie", cookie);
    expect(detailRes.body.phone).toBeUndefined();
    expect(detailRes.body.birthday).toBeUndefined();
  });

  it("reveals a field only via POST /:id/reveal, decrypts it correctly, and logs to AccessLog", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const created = await request(app)
      .post("/api/customers")
      .set("Cookie", cookie)
      .send({ name: "Reveal Me", phone: "+919800000098", birthday: "1985-06-15" });

    const revealPhone = await request(app)
      .post(`/api/customers/${created.body.id}/reveal`)
      .set("Cookie", cookie)
      .send({ field: "phone" });
    expect(revealPhone.status).toBe(200);
    expect(revealPhone.body.value).toBe("+919800000098");

    const revealBirthday = await request(app)
      .post(`/api/customers/${created.body.id}/reveal`)
      .set("Cookie", cookie)
      .send({ field: "birthday" });
    expect(revealBirthday.status).toBe(200);
    expect(revealBirthday.body.value).toBe(new Date("1985-06-15").toISOString());

    const logs = await prisma.accessLog.findMany({ where: { customerId: created.body.id }, orderBy: { field: "asc" } });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.field)).toEqual(["birthday", "phone"]);
    expect(logs.every((l) => l.reason === "manual_reveal")).toBe(true);
    expect(logs.every((l) => l.actorId === admin.id)).toBe(true);
    expect(logs.every((l) => l.tenantId === tenant.id)).toBe(true);
  });

  it("rejects a reveal request for a field other than phone/birthday", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const created = await request(app).post("/api/customers").set("Cookie", cookie).send({ name: "X", phone: "+919800000097" });

    const res = await request(app).post(`/api/customers/${created.body.id}/reveal`).set("Cookie", cookie).send({ field: "email" });
    expect(res.status).toBe(400);
  });

  it("labels system-triggered access (actorId null) as System (...), and user-triggered access with the actor's name", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const created = await request(app).post("/api/customers").set("Cookie", cookie).send({ name: "Audit Me", phone: "+919800000096" });

    await request(app).post(`/api/customers/${created.body.id}/reveal`).set("Cookie", cookie).send({ field: "phone" });
    await prisma.accessLog.create({
      data: { tenantId: tenant.id, actorId: null, customerId: created.body.id, field: "phone", reason: "broadcast_send" },
    });

    const res = await request(app).get(`/api/customers/${created.body.id}/access-log`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const systemEntry = res.body.find((e: { reason: string }) => e.reason === "broadcast_send");
    expect(systemEntry.actorLabel).toBe("System (scheduled broadcast)");

    const manualEntry = res.body.find((e: { reason: string }) => e.reason === "manual_reveal");
    expect(manualEntry.actorLabel).toBe(admin.name);
  });
});

describe("customers: CSV import commit", () => {
  it("inserts valid rows and reports per-row errors for invalid ones", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const mapping = { name: "Full Name", phone: "Mobile", email: null, segment: null, birthday: null, total_spent: null, last_purchase: null, notes: null };
    const rows = [
      { "Full Name": "Import Valid", Mobile: "+919800000040" },
      { "Full Name": "", Mobile: "+919800000041" }, // missing name -> error
      { "Full Name": "Import No Phone", Mobile: "" }, // missing phone -> error
    ];

    const res = await request(app).post("/api/customers/import/commit").set("Cookie", cookie).send({ mapping, rows });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.errors).toHaveLength(2);

    const listRes = await request(app).get("/api/customers").query({ search: "Import Valid" }).set("Cookie", cookie);
    expect(listRes.body).toHaveLength(1);
  });
});

describe("customers: CSV export", () => {
  it("default export never includes phone or birthday", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await request(app)
      .post("/api/customers")
      .set("Cookie", cookie)
      .send({ name: "Export Test", phone: "+919800000095", birthday: "1992-03-04", email: "export@example.com" });

    const res = await request(app).get("/api/customers/export").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const csv = res.text;
    expect(csv).toContain("Export Test");
    expect(csv).toContain("export@example.com");
    expect(csv.toLowerCase()).not.toContain("phone");
    expect(csv).not.toContain("+919800000095");
    expect(csv).not.toContain("1992-03-04");

    // Nothing decrypted for a default export — no AccessLog row at all.
    const logs = await prisma.accessLog.findMany({ where: { reason: "csv_export_with_contact" } });
    expect(logs).toHaveLength(0);
  });

  it("rejects the contact export without an explicit confirm:true", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app).post("/api/customers/export/contact").set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
  });

  it("confirmed contact export includes real phone/birthday and logs one bulk AccessLog row with the record count", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await request(app)
      .post("/api/customers")
      .set("Cookie", cookie)
      .send({ name: "Contact Export A", phone: "+919800000096", birthday: "1990-01-15" });
    await request(app).post("/api/customers").set("Cookie", cookie).send({ name: "Contact Export B", phone: "+919800000097" });

    const res = await request(app).post("/api/customers/export/contact").set("Cookie", cookie).send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const csv = res.text;
    expect(csv).toContain("Contact Export A");
    expect(csv).toContain("+919800000096");
    expect(csv).toContain("1990-01-15");
    expect(csv).toContain("Contact Export B");
    expect(csv).toContain("+919800000097");

    const logs = await prisma.accessLog.findMany({ where: { tenantId: tenant.id, reason: "csv_export_with_contact" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorId).toBe(admin.id);
    expect(logs[0].customerId).toBeNull();
    expect(logs[0].field).toBeNull();
    expect(logs[0].recordCount).toBeGreaterThanOrEqual(2);
  });

  it("contact export only includes this tenant's customers", async () => {
    const tenantA = await createTenantWithAdmin("Export A");
    const tenantB = await createTenantWithAdmin("Export B");
    const cookieA = await loginAs(tenantA.admin.email);
    await request(app).post("/api/customers").set("Cookie", cookieA).send({ name: "Tenant A Customer", phone: "+919800000098" });
    const cookieB = await loginAs(tenantB.admin.email);
    await request(app).post("/api/customers").set("Cookie", cookieB).send({ name: "Tenant B Customer", phone: "+919800000099" });

    const res = await request(app).post("/api/customers/export/contact").set("Cookie", cookieA).send({ confirm: true });
    expect(res.text).toContain("Tenant A Customer");
    expect(res.text).not.toContain("Tenant B Customer");
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs } from "./helpers";

// Business Admin must NEVER see or modify integrations/endpoints/
// credentials/feature mappings — there is deliberately no Business-Admin-
// facing route for any of that (see routes/superAdminWebsiteIntegrations.ts
// for the only place it's readable/writable). This codifies that as a
// regression test: any attempt from a Business Admin session to reach the
// old tenant-scoped integration-config surface must 404, same as any other
// nonexistent route — not 403 (which would confirm the surface exists but
// is merely forbidden).
describe("Business Admin has no route into integration config", () => {
  it("returns 404 for GET/PUT/DELETE on the (removed) tenant-facing website-integrations surface", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const get = await request(app).get("/api/website-integrations").set("Cookie", cookie);
    expect(get.status).toBe(404);

    const put = await request(app)
      .put("/api/website-integrations/PRODUCTS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/products", authType: "none" });
    expect(put.status).toBe(404);

    const del = await request(app).delete("/api/website-integrations/PRODUCTS").set("Cookie", cookie);
    expect(del.status).toBe(404);
  });
});

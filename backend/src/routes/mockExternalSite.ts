import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";

// Stand-in "external website" for local dev/demo purposes only — mirrors
// the mock-first pattern used by the other integration adapters
// (instagram.ts, sms.ts, etc.), but here it plays the role of a THIRD
// PARTY's own API so a freshly-seeded website integration has something
// real to hit out of the box. A production tenant would point their
// integration at their own actual site instead of this route. Deliberately
// unauthenticated — it's simulating a system outside this app entirely.
//
// The GET handler below is also the REFERENCE IMPLEMENTATION of the
// standardized admin import contract every tenant website is expected to
// expose (see lib/websiteApiClient.ts fetchWebsiteApi/WebsiteApiImportFilters):
//   GET {baseUrl}?slug=&id=&category=&collection=&featured=&position=&code=&page=&pageSize=
//   -> 200 { ok: true, data: [...] }
// Auth is whatever the tenant's own WebsiteIntegration specifies (none here,
// since this route is a stand-in for a site with no auth configured) — the
// same credentials already used for POST/PUT/DELETE apply automatically to
// this GET, no separate auth setup needed. page/pageSize are honored only
// when both are present — a real tenant site that doesn't paginate at all
// is expected to just ignore them and keep returning its full list, which
// fetchWebsiteApi's own pagination loop already tolerates.
const router = Router();

type MockItem = Record<string, unknown>;

const SAMPLE_DATA: Record<string, MockItem[]> = {
  products: [
    { id: "prod-1", slug: "moonga-silk-saree", name: "Moonga Silk Saree", category: "silk", collection: "wedding-edit", featured: true, position: 1, price: 8999 },
    { id: "prod-2", slug: "banarasi-bridal-saree", name: "Banarasi Bridal Saree", category: "banarasi", collection: "wedding-edit", featured: true, position: 2, price: 15999 },
    { id: "prod-3", slug: "everyday-cotton-saree", name: "Everyday Cotton Saree", category: "cotton", collection: "everyday-elegance", featured: false, position: 3, price: 1999 },
  ],
  categories: [
    { id: "cat-1", slug: "silk", name: "Silk", description: "Handwoven silk sarees" },
    { id: "cat-2", slug: "banarasi", name: "Banarasi", description: "Banarasi weaves" },
    { id: "cat-3", slug: "cotton", name: "Cotton", description: "Everyday cotton sarees" },
  ],
  collections: [
    { id: "col-1", slug: "wedding-edit", name: "Wedding Edit", featured: true, position: 1 },
    { id: "col-2", slug: "everyday-elegance", name: "Everyday Elegance", featured: false, position: 2 },
  ],
  banners: [
    { id: "ban-1", slug: "festive-sale", image: "https://example.com/banner1.jpg", featured: true, position: 1 },
    { id: "ban-2", slug: "new-arrivals", image: "https://example.com/banner2.jpg", featured: false, position: 2 },
  ],
  offers: [
    { id: "off-1", code: "FESTIVE20", title: "Festive Sale", discountPercent: 20, featured: true },
    { id: "off-2", code: "WELCOME10", title: "Welcome Offer", discountPercent: 10, featured: false },
  ],
};

const FILTER_KEYS = ["slug", "id", "category", "collection", "featured", "position", "code"] as const;

router.get("/:contentType", (req, res) => {
  const items =
    SAMPLE_DATA[req.params.contentType.toLowerCase()] ?? [
      { id: "item-1", slug: "sample-item-one", name: "Sample Item One" },
      { id: "item-2", slug: "sample-item-two", name: "Sample Item Two" },
    ];

  const filtered = items.filter((item) =>
    FILTER_KEYS.every((key) => {
      const wanted = req.query[key];
      if (wanted === undefined) return true;
      const have = item[key];
      if (typeof have === "boolean") return have === (String(wanted) === "true");
      return have !== undefined && String(have) === String(wanted);
    })
  );

  const page = Number(req.query.page);
  const pageSize = Number(req.query.pageSize);
  if (Number.isInteger(page) && page > 0 && Number.isInteger(pageSize) && pageSize > 0) {
    const start = (page - 1) * pageSize;
    res.json({ ok: true, data: filtered.slice(start, start + pageSize) });
    return;
  }

  res.json({ ok: true, data: filtered });
});

// Reference implementation of the "login, get a token" contract that
// authType "login" (lib/connectorLogin.ts) expects — a stand-in for a
// tenant's own site's login endpoint. Fixed demo credentials so this can
// be exercised end-to-end (including a deliberately wrong password, for
// proving CredentialsExpired) without needing a real external site.
//
// currentValidToken tracks the most recently issued token so the write
// routes below can reject a stale/wrong one with a real 401 — same
// behavior a real tenant site would have. Only enforced when an
// Authorization header is actually present, so every existing authType
// "none" test against this mock (no header sent at all) is unaffected.
let currentValidToken: string | null = null;

router.post("/login", (req, res) => {
  const { email, password } = req.body ?? {};
  if (email === "demo@example.com" && password === "demo-password") {
    currentValidToken = `mock-token-${randomUUID()}`;
    res.json({ accessToken: currentValidToken, expiresIn: 900 }); // 15 minutes, same as the real site that motivated this feature
    return;
  }
  res.status(401).json({ success: false, message: "Invalid credentials" });
});

function checkBearerIfPresent(req: Request, res: Response): boolean {
  const auth = req.headers.authorization;
  if (!auth) return true; // no auth attempted — unauthenticated content routes behave exactly as before
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token !== currentValidToken) {
    res.status(401).json({ success: false, message: "Invalid or expired access token." });
    return false;
  }
  return true;
}

router.post("/:contentType", (req, res) => {
  if (!checkBearerIfPresent(req, res)) return;
  res.status(201).json({ ok: true, data: { id: randomUUID(), ...req.body } });
});

router.put("/:contentType/:id", (req, res) => {
  if (!checkBearerIfPresent(req, res)) return;
  res.status(200).json({ ok: true, data: { id: req.params.id, ...req.body } });
});

router.delete("/:contentType/:id", (req, res) => {
  if (!checkBearerIfPresent(req, res)) return;
  res.status(204).send();
});

export default router;

// One-time bootstrap for the platform's first (or an additional) real Super
// Admin account. This is the ONLY supported way to provision a Super Admin
// outside of local dev — prisma/seed.ts's hardcoded demo Super Admin is
// local-dev-only (see its NODE_ENV guard) and must never run against a real
// deployment.
//
// Same discipline as every other Super-Admin-provisioned credential in this
// app (see routes/super-admin.ts's business-creation flow): a strong random
// password via lib/password.ts's generateTempPassword, never stored or
// logged in plaintext anywhere except this one-time stdout print, and
// mustChangePassword: true so it can't be used past a first login without
// being replaced.
//
// Run with:
//   npx tsx prisma/scripts/createSuperAdmin.ts --email you@yourcompany.com --name "Your Name"
// Or non-interactively (e.g. a deploy hook):
//   SUPER_ADMIN_EMAIL=you@yourcompany.com SUPER_ADMIN_NAME="Your Name" npx tsx prisma/scripts/createSuperAdmin.ts

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { generateTempPassword } from "../../src/lib/password";

const prisma = new PrismaClient();

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const emailSchema = z.string().trim().email();

async function main() {
  const email = (readArg("--email") ?? process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (readArg("--name") ?? process.env.SUPER_ADMIN_NAME ?? "").trim() || "Super Admin";

  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) {
    console.error("Provide a real email via --email you@yourcompany.com (or SUPER_ADMIN_EMAIL env var).");
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: parsedEmail.data } });
  if (existing) {
    console.error(`A user with email ${parsedEmail.data} already exists (role: ${existing.role}). Not creating a duplicate.`);
    process.exitCode = 1;
    return;
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const superAdmin = await prisma.user.create({
    data: {
      tenantId: null,
      name,
      email: parsedEmail.data,
      passwordHash,
      role: "SUPER_ADMIN",
      mustChangePassword: true,
    },
  });

  console.log("Super Admin account created.");
  console.log("");
  console.log(`  Email:    ${superAdmin.email}`);
  console.log(`  Password: ${tempPassword}`);
  console.log("");
  console.log("This password is shown ONCE and is not stored anywhere in plaintext.");
  console.log("Log in now and you'll be forced to set a new password before reaching the Control Tower.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("FAILED:", err);
    await prisma.$disconnect();
    process.exit(1);
  });

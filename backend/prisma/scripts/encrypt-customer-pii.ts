// One-off, idempotent migration script: re-encrypts any Customer rows whose
// phone/birthday are still plaintext (from before Customer PII encryption
// was introduced) and backfills phoneMasked/phoneHash/birthdayMonthDay.
//
// Idempotent by inspection, not by a "done" flag: a row is skipped if `phone`
// already matches the encrypted payload shape ("hex:hex:hex" from
// lib/crypto.ts), so this is safe to re-run (e.g. after a partial failure)
// without double-encrypting already-migrated rows.
//
// Run with: npx tsx prisma/scripts/encrypt-customer-pii.ts
// Logs counts only — never phone/birthday values, plaintext or ciphertext.

import { PrismaClient } from "@prisma/client";
import { encryptField, maskPhone, hashForLookup, monthDayOf, normalizePhone } from "../../src/lib/piiCrypto";

const prisma = new PrismaClient();

const ENCRYPTED_SHAPE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

function isAlreadyEncrypted(value: string): boolean {
  return ENCRYPTED_SHAPE.test(value);
}

async function main() {
  const customers = await prisma.customer.findMany({
    select: { id: true, phone: true, birthday: true },
  });

  let migrated = 0;
  let skipped = 0;

  for (const customer of customers) {
    if (isAlreadyEncrypted(customer.phone)) {
      skipped += 1;
      continue;
    }

    const plainPhone = customer.phone;
    const normalized = normalizePhone(plainPhone);

    // customer.birthday is still the pre-migration column's raw value at
    // this point. Prisma's SQLite connector stores DateTime as an epoch-
    // millisecond string (confirmed via `sqlite3 dev.db "SELECT
    // typeof(birthday) ..."` → e.g. "639878400000"), NOT an ISO string —
    // `new Date(thatString)` silently returns Invalid Date, it must be
    // parsed as a number first. Re-encoded to ISO before encrypting so the
    // stored ciphertext has one consistent, human-decodable format going
    // forward regardless of how it was originally written.
    const birthdayDate = customer.birthday ? new Date(Number(customer.birthday)) : null;

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        phone: encryptField(plainPhone),
        phoneMasked: maskPhone(plainPhone),
        phoneHash: hashForLookup(normalized),
        birthday: birthdayDate ? encryptField(birthdayDate.toISOString()) : null,
        birthdayMonthDay: birthdayDate ? monthDayOf(birthdayDate) : null,
      },
    });
    migrated += 1;
  }

  console.log(`Customer PII migration complete: ${migrated} migrated, ${skipped} already encrypted (skipped).`);
}

main()
  .catch((err) => {
    console.error("Customer PII migration failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

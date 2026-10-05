import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

export type ConsentStatus = "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";

export type ConsentEventSource = "CUSTOMER_REPLY" | "STAFF_ACTION" | "IMPORT" | "SYSTEM" | "CUSTOMER_SELF_SERVICE";

// The one and only way Customer.consentStatus is ever written — never a bare
// prisma.customer.update({ data: { consentStatus } }) anywhere else in the
// app. Both the status column and its ConsentEvent history row are written
// in one transaction, so the two can never drift apart (a status change
// with no event explaining it, or an event that doesn't match the
// customer's actual current state, would defeat the entire point of keeping
// an auditable history separate from the flag itself).
export async function recordConsentTransition(input: {
  tenantId: string;
  customerId: string;
  previousState: ConsentStatus;
  newState: ConsentStatus;
  source: ConsentEventSource;
  // Only meaningful for source: "STAFF_ACTION" — who actually asked the
  // customer and recorded the answer, distinct from the generic
  // STAFF_ACTION/CUSTOMER_REPLY source distinction. Omit (or pass
  // undefined) for every other source; callers must never pass an actorId
  // for a customer-originated transition.
  actorId?: string;
}, transaction?: Prisma.TransactionClient): Promise<void> {
  const transition = async (tx: Prisma.TransactionClient) => {
    const customer = await tx.customer.findFirstOrThrow({
      where: { id: input.customerId, tenantId: input.tenantId },
      select: { consentStatus: true },
    });
    if (customer.consentStatus === input.newState) return;
    // Compare-and-set serializes competing transitions on the customer row;
    // only the writer that actually changes state may append an event.
    const changed = await tx.customer.updateMany({
      where: { id: input.customerId, tenantId: input.tenantId, consentStatus: customer.consentStatus },
      data: { consentStatus: input.newState },
    });
    if (changed.count !== 1) throw new Error("Consent changed concurrently; retry transition");
    await tx.consentEvent.create({
      data: {
        tenantId: input.tenantId,
        customerId: input.customerId,
        previousState: customer.consentStatus,
        newState: input.newState,
        source: input.source,
        actorId: input.actorId ?? null,
      },
    });
  };
  if (transaction) await transition(transaction);
  else await prisma.$transaction(transition);
}

// Deliberately narrow and exact-match, not a substring search — a customer
// message that merely CONTAINS "stop" ("please stop calling after 9pm")
// must never be misread as an unsubscribe. English-only for now: guessing
// at translations risks a mistranslated word silently opting someone out
// (or a real non-English opt-out being missed) — flagged as a scope
// decision, not an oversight, to revisit once real usage shows what
// languages tenants' customers actually reply in. "No thanks" deliberately
// excluded — too likely to be a reply to an unrelated question ("want a
// discount code?") rather than an unsubscribe signal.
const OPT_OUT_KEYWORDS = new Set([
  "STOP",
  "UNSUBSCRIBE",
  "OPT OUT",
  "OPTOUT",
  "DONT WANT",
  "DO NOT WANT",
  "NO MORE MESSAGES",
  "NOT INTERESTED",
]);

export function isOptOutMessage(body: string): boolean {
  const normalized = body
    .trim()
    .toUpperCase()
    .replace(/[’']/g, "") // strip straight/curly apostrophes so "Don't want" and "Dont want" both match "DONT WANT"
    .replace(/[.!?]+$/, "");
  return OPT_OUT_KEYWORDS.has(normalized);
}

import Razorpay from "razorpay";

// Real payment gateway adapter — mirrors the provider-selection pattern used
// by email.ts/sms.ts (BILLING_PROVIDER env var picks the active adapter),
// even though Razorpay is the only one today, so a second gateway is a new
// adapter file + a switch branch, not a rewrite of every call site.
//
// Deliberately no "mock mode" the way email/sms have one: those can fake a
// delivered message and still exercise the rest of the app meaningfully.
// A fake Razorpay order can't be paid through Razorpay's real Checkout, so
// there's nothing useful to mock here — either real test-mode keys are
// configured, or checkout creation fails loudly with a clear error.
export type BillingProvider = "razorpay";

function getBillingProvider(): BillingProvider {
  return "razorpay";
}

function getKeyId(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) throw new Error("RAZORPAY_KEY_ID is not configured");
  return keyId;
}

function getKeySecret(): string {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw new Error("RAZORPAY_KEY_SECRET is not configured");
  return keySecret;
}

// The Key ID (not the secret) is safe to hand to the frontend — it's what
// Razorpay Checkout itself requires client-side to open the payment modal.
export function getPublicKeyId(): string {
  return getKeyId();
}

let client: Razorpay | null = null;
function getClient(): Razorpay {
  if (!client) {
    client = new Razorpay({ key_id: getKeyId(), key_secret: getKeySecret() });
  }
  return client;
}

export type CreateOrderParams = {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
};

export type CreateOrderResult = { orderId: string; amount: number; currency: string };

export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  const provider = getBillingProvider();
  if (provider !== "razorpay") throw new Error(`Unsupported billing provider: ${provider}`);

  const order = await getClient().orders.create({
    amount: params.amountPaise,
    currency: params.currency,
    receipt: params.receipt,
    notes: params.notes,
  });
  return { orderId: order.id, amount: Number(order.amount), currency: order.currency };
}

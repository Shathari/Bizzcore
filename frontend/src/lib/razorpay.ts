// Loads Razorpay's own hosted Checkout script on demand — never bundled,
// per Razorpay's integration docs, and never a locally-hosted card form:
// Checkout itself is the whole point (it keeps card/UPI data off this
// app's servers entirely, avoiding PCI scope).
const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

let loadPromise: Promise<void> | null = null;

export function loadRazorpayCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Could not load Razorpay Checkout. Check your connection and try again."));
    };
    document.body.appendChild(script);
  });
  return loadPromise;
}

export type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", handler: (response: { error: { description?: string } }) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
  }
}

export function openRazorpayCheckout(
  options: RazorpayCheckoutOptions,
  onFailed?: (message: string) => void
): void {
  if (!window.Razorpay) throw new Error("Razorpay Checkout script has not loaded yet");
  const instance = new window.Razorpay(options);
  if (onFailed) {
    instance.on("payment.failed", (response) => onFailed(response.error?.description ?? "Payment failed."));
  }
  instance.open();
}

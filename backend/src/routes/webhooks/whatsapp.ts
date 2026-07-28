import { Router } from "express";

// Meta's WhatsApp Cloud API webhook — the "Callback URL" Meta's app
// dashboard (WhatsApp > Configuration) requires before it'll let you finish
// connecting a phone number. Two jobs:
//  - GET: the one-time verification handshake Meta performs the moment you
//    save the Callback URL + Verify Token in its dashboard — echo back
//    hub.challenge if hub.verify_token matches ours, else reject.
//  - POST: actual event deliveries afterward (message status updates,
//    inbound messages to whichever number is subscribed).
//
// No request signature verification yet — Meta signs POST bodies with
// X-Hub-Signature-256 (HMAC-SHA256 over the raw payload, keyed by the Meta
// App Secret from App Dashboard > Settings > Basic). Add that once
// WHATSAPP_APP_SECRET is configured; not required just to get past the
// setup wizard, since this is dev-mode testing, not yet handling real
// customer traffic.
//
// No inbound-message processing yet either — same "accept and log, no live
// ingestion" precedent as the Social Media Manager's SocialComment model
// (see schema.prisma's comment there). Acknowledging fast with 200 is what
// Meta actually requires; wiring real events into a Conversation/Message
// row is separate follow-up work once there's a concrete need for it.
const router = Router();

router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
});

router.post("/", (req, res) => {
  console.log("[whatsapp:webhook] event received", JSON.stringify(req.body));
  res.sendStatus(200);
});

export default router;

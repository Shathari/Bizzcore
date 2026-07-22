import pino from "pino";

// Standalone logger for contexts outside the request/response cycle
// (outbound calls to tenants' own external website APIs) — pino-http in
// app.ts covers inbound requests to this app, this covers what this app
// calls out to.
export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

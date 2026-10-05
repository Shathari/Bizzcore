import type { Options } from "pino-http";

// Shared by production and log regression tests. Bodies are never serialized.
export const requestLoggingOptions: Options = {
  redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"],
};

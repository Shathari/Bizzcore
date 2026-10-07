# WhatsApp broadcast delivery semantics

`BroadcastRecipient.sentAt` records a live Meta-accepted send with a validated
nonblank opaque message ID. HTTP success alone is insufficient. The legacy
adapter `delivered` boolean remains a compatibility alias for acceptance for
existing reply/platform callers; broadcast code uses `accepted` explicitly.

`deliveredAt` and `readAt` require signed receipts. `failedAt`, `failureCode`
and `failureCategory` record delivery failure before delivery/read. A later
failure cannot contradict delivery/read; stronger delivery/read clears a
previous failure. First receipt timestamps survive duplicates. Accepted count
is never reduced by delivery failure. Financial attribution remains based on
accepted recipient evidence and is not changed by this milestone.

Underlying campaign statuses remain `scheduled`, `published`, `failed`.
`published` means dispatch completed without reported unsuccessful/skipped
sends, not customer delivery. Communication renders this as Sent with an
acceptance explanation. Dispatch failures with accepted recipients render
Partially Failed. Delivery failures are displayed in the separate Failed
metric and influence the presentation label, without rewriting dispatch status.

Outbound addresses reuse `normalizePhone`, allowing spaces, parentheses,
hyphens, periods and one leading plus. The resulting digits must match an
international-number shape (7–15 digits, first digit nonzero). The country code
is taken as entered: none is inferred, and historical encrypted phones/hash
values are not rewritten. Syntax validation cannot prove country-code intent,
WhatsApp account ownership or deliverability; staff must enter a country code.

Structured logs include broadcast/tenant/customer identifiers, template
name/language, validated message ID, result category, HTTP status, numeric Meta
codes/subcodes and a small allowlist of error types. Error text, raw response or
webhook bodies, phones, tokens, cookies and message content are excluded.
Stored failure diagnostics use numeric Int-range codes and the fixed category
`META_DELIVERY_FAILED`, never Meta's arbitrary text. Unknown/malformed IDs cannot
produce broad updates. HMAC verification remains mandatory.

Template sending preserves approved name/language and ordered BODY parameters.
Dynamic HEADER/button parameters are not supported. The scheduler remains
every minute with no distributed locking, automatic resend or receipt
reconciliation. Sending, charging and evidence persistence remain separate
operations. Repeated campaign/customer sends retain the first message ID.
Receipts arriving before evidence insertion are not replayed. Existing rows
without receipt evidence remain unknown; this migration does not backfill them.

After review and authorized deployment, verify Meta callback subscription,
Phone Number ID and app secret manually, then use one controlled broadcast to
correlate dispatch, accepted message ID and receipt logs. This implementation
does not itself change production configuration or apply the additive migration.

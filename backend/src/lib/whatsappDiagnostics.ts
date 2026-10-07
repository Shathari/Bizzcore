// Never copy Meta's free-text messages/details into logs or persisted errors.
export function safeMetaError(value: unknown) {
  const error = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const numeric = (input: unknown) => typeof input === "number" && Number.isSafeInteger(input) && input >= 0 && input <= 2147483647 ? input : undefined;
  const types = new Set(["OAuthException", "GraphMethodException", "APIException"]);
  return {
    failureCode: numeric(error.code),
    errorSubcode: numeric(error.error_subcode),
    errorType: typeof error.type === "string" && types.has(error.type) ? error.type : undefined,
  };
}

export function isWhatsAppMessageId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

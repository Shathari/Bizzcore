// Reference data for CustomDevelopmentRequest.serviceType — a request/quote
// queue for work that's inherently variable-priced, not the fixed-price
// Plan/AddOn system. Price ranges here are DISPLAY-ONLY reference text for
// whoever fills out the request form; nothing enforces or validates them
// against quotedAmount.

export const SERVICE_TYPES = [
  "UI_CHANGE",
  "NEW_MODULE",
  "CUSTOM_WORKFLOW",
  "API_INTEGRATION",
  "SCHEMA_CHANGE",
  "CUSTOM_FEATURE",
  "ENTERPRISE_CUSTOM",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_TYPE_INFO: Record<ServiceType, { label: string; priceRange: string }> = {
  UI_CHANGE: { label: "UI / Dashboard Component Changes", priceRange: "₹1,500–₹5,000 per change" },
  NEW_MODULE: { label: "New Dashboard Module", priceRange: "₹15,000–₹50,000" },
  CUSTOM_WORKFLOW: { label: "Custom Workflow", priceRange: "₹10,000–₹40,000" },
  API_INTEGRATION: { label: "Third-party API Integration", priceRange: "₹8,000–₹30,000" },
  SCHEMA_CHANGE: { label: "Database Schema Changes", priceRange: "₹5,000–₹20,000" },
  CUSTOM_FEATURE: { label: "Custom Website Feature", priceRange: "₹5,000–₹50,000" },
  ENTERPRISE_CUSTOM: { label: "Enterprise Custom Development", priceRange: "₹1,500/hour or fixed project quote" },
};

export const REQUEST_STATUSES = ["Requested", "Quoted", "Approved", "InProgress", "Completed", "Invoiced", "Cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// Shared between Super Admin's Plan editor and the tenant Subscription
// page's feature grid / plan comparison — same 9 FeatureCatalog categories
// (see backend/prisma/seedPlans.ts), same human-readable labels either way.
export const CATEGORY_LABELS: Record<string, string> = {
  AI_MARKETING: "AI & Marketing",
  SOCIAL_MEDIA: "Social Media Manager",
  COMMUNICATION: "Communication Center",
  WEBSITE: "Website",
  WEBSITE_CMS: "Website CMS",
  BUSINESS_DASHBOARD: "Business Dashboard",
  ANALYTICS: "Analytics",
  TEAM_ACCESS: "Team & Access",
  SUPPORT: "Support",
};

export function groupByCategory<T extends { category: string }>(rows: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!groups.has(row.category)) groups.set(row.category, []);
    groups.get(row.category)!.push(row);
  }
  return Array.from(groups.entries());
}

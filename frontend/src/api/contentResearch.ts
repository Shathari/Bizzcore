import { apiClient } from "./client";
import type { Tone } from "./ai";

export type ReportStatus = "PENDING" | "FETCHING" | "ANALYZING" | "COMPLETED" | "FAILED";
export type LinkFetchStatus = "PENDING" | "FETCHED" | "FAILED";
export type PatternType = "HOOK" | "FORMAT" | "TOPIC" | "STRUCTURE" | "CADENCE";

export type ResearchPattern = {
  id: string;
  type: PatternType;
  title: string;
  description: string;
  occurrenceCount: number;
  exampleLinkIds: string[];
};

export type ContentResearchLink = {
  id: string;
  url: string;
  platform: string;
  fetchStatus: LinkFetchStatus;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  durationSeconds: number | null;
  postedAt: string | null;
  hashtags: string | null; // JSON-encoded string[]
  errorMessage: string | null;
  createdAt: string;
};

export type ContentResearchReportSummary = {
  id: string;
  status: ReportStatus;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
  _count: { links: number };
};

export type ContentResearchReport = Omit<ContentResearchReportSummary, "_count"> & {
  seedLinks: string; // JSON-encoded string[]
  patterns: string | null; // JSON-encoded ResearchPattern[]
  links: ContentResearchLink[];
};

export type ResearchScriptGeneration = {
  id: string;
  contentType: string;
  tone: string;
  productName: string | null;
  context: string | null;
  output: string;
  createdAt: string;
  researchReportId: string;
  selectedPatternIds: string;
};

export async function getContentResearchStatus(): Promise<{ configured: boolean }> {
  const { data } = await apiClient.get<{ configured: boolean }>("/content-research/status");
  return data;
}

export async function listResearchReports(): Promise<ContentResearchReportSummary[]> {
  const { data } = await apiClient.get<ContentResearchReportSummary[]>("/content-research");
  return data;
}

export async function getResearchReport(id: string): Promise<ContentResearchReport> {
  const { data } = await apiClient.get<ContentResearchReport>(`/content-research/${id}`);
  return data;
}

export async function createResearchReport(links: string[]): Promise<ContentResearchReport> {
  const { data } = await apiClient.post<ContentResearchReport>("/content-research", { links });
  return data;
}

export async function generateResearchScript(
  reportId: string,
  input: { patternIds: string[]; tone: Tone; productName?: string; context?: string }
): Promise<ResearchScriptGeneration> {
  const { data } = await apiClient.post<ResearchScriptGeneration>(`/content-research/${reportId}/generate-script`, input);
  return data;
}

export function parseHashtags(hashtags: string | null): string[] {
  if (!hashtags) return [];
  try {
    return JSON.parse(hashtags);
  } catch {
    return [];
  }
}

export function parsePatterns(patterns: string | null): ResearchPattern[] {
  if (!patterns) return [];
  try {
    return JSON.parse(patterns);
  } catch {
    return [];
  }
}

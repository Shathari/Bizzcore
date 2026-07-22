import { apiClient } from "./client";

export type SocialChannel = "INSTAGRAM" | "FACEBOOK";
export type PostType = "POST" | "STORY" | "REEL";
export type DeliveryResult = { mode: "live" | "mock"; delivered: boolean; error?: string } | null;

export type SocialPost = {
  id: string;
  channel: SocialChannel;
  postType: PostType | null;
  caption: string | null;
  mediaUrl: string | null;
  scheduledAt: string;
  status: string;
  errorMessage: string | null;
  publishedAt: string | null;
};

export type SocialComment = {
  id: string;
  channel: SocialChannel;
  postCaption: string | null;
  authorName: string;
  body: string;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
};

export async function getIntegrationStatus(): Promise<{ connected: boolean }> {
  const { data } = await apiClient.get<{ connected: boolean }>("/social/integration-status");
  return data;
}

export async function listSocialPosts(): Promise<SocialPost[]> {
  const { data } = await apiClient.get<SocialPost[]>("/social/posts");
  return data;
}

export async function createSocialPost(input: {
  channel: SocialChannel;
  postType?: PostType;
  caption?: string;
  scheduledAt: string;
  media?: File;
}): Promise<SocialPost> {
  const form = new FormData();
  form.append("channel", input.channel);
  if (input.postType) form.append("postType", input.postType);
  if (input.caption) form.append("caption", input.caption);
  form.append("scheduledAt", input.scheduledAt);
  if (input.media) form.append("media", input.media);
  const { data } = await apiClient.post<SocialPost>("/social/posts", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function cancelSocialPost(id: string): Promise<void> {
  await apiClient.delete(`/social/posts/${id}`);
}

export async function listSocialComments(): Promise<SocialComment[]> {
  const { data } = await apiClient.get<SocialComment[]>("/social/comments");
  return data;
}

export async function replyToSocialComment(
  id: string,
  message: string
): Promise<{ comment: SocialComment; delivery: DeliveryResult }> {
  const { data } = await apiClient.post(`/social/comments/${id}/reply`, { message });
  return data;
}

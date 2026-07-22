import { apiClient } from "./client";
import type { Segment } from "./customers";

export type Channel = "WHATSAPP" | "WEBSITE_CHAT" | "INSTAGRAM_DM" | "FACEBOOK_DM";
export type Direction = "INBOUND" | "OUTBOUND";

export type ConversationSummary = {
  id: string;
  channel: Channel;
  contactName: string | null;
  contactHandle: string | null;
  customerId: string | null;
  lastMessageAt: string;
  lastMessage: { body: string; direction: Direction; sentAt: string } | null;
};

export type Message = {
  id: string;
  direction: Direction;
  body: string;
  status: string;
  sentAt: string;
};

export type DeliveryResult = { mode: "live" | "mock"; delivered: boolean; error?: string } | null;

export async function listConversations(channel?: Channel): Promise<ConversationSummary[]> {
  const { data } = await apiClient.get<ConversationSummary[]>("/communication/conversations", {
    params: channel ? { channel } : undefined,
  });
  return data;
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data } = await apiClient.get<Message[]>(`/communication/conversations/${conversationId}/messages`);
  return data;
}

export async function sendMessage(
  conversationId: string,
  body: string
): Promise<{ message: Message; delivery: DeliveryResult }> {
  const { data } = await apiClient.post(`/communication/conversations/${conversationId}/messages`, { body });
  return data;
}

export type Broadcast = {
  id: string;
  caption: string | null;
  targetSegment: Segment | null;
  targetCustomerId: string | null;
  targetCustomerName?: string | null;
  scheduledAt: string;
  status: string;
  errorMessage: string | null;
  publishedAt: string | null;
};

export async function listBroadcasts(): Promise<Broadcast[]> {
  const { data } = await apiClient.get<Broadcast[]>("/communication/broadcasts");
  return data;
}

export async function createBroadcast(input: {
  caption: string;
  targetSegment?: Segment;
  targetCustomerId?: string;
  scheduledAt: string;
}): Promise<Broadcast> {
  const { data } = await apiClient.post<Broadcast>("/communication/broadcasts", input);
  return data;
}

export async function cancelBroadcast(id: string): Promise<void> {
  await apiClient.delete(`/communication/broadcasts/${id}`);
}

import { apiClient } from "./client";
import type { Segment } from "./customers";
import type { PlaceholderMapping } from "../lib/whatsappPlaceholders";

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

// WEBSITE_CHAT is excluded — there's no live customer-facing chat widget in
// this build, so there's no real recipient a "new" website-chat thread
// could ever reach (matches OUTBOUND_CHANNELS in routes/communication.ts).
export type OutboundChannel = Exclude<Channel, "WEBSITE_CHAT">;

export type NewConversation = {
  id: string;
  channel: Channel;
  contactName: string | null;
  contactHandle: string | null;
  lastMessageAt: string;
};

export async function startConversation(input: {
  channel: OutboundChannel;
  contactHandle: string;
  contactName?: string;
  body: string;
}): Promise<{ conversation: NewConversation; message: Message; delivery: DeliveryResult }> {
  const { data } = await apiClient.post("/communication/conversations", input);
  return data;
}

export type Broadcast = {
  title?: string | null;
  offerEnabled?: boolean;
  offerCode?: string | null;
  offerDescription?: string | null;
  offerStartsAt?: string | null;
  offerEndsAt?: string | null;
  metrics?: { sent: number; delivered: number; read: number; failed: number; physicalSales: number; attributedRevenue: number; offerRedemptions: number };
  id: string;
  // The message text. In template mode this is the template's raw {{n}}
  // body text (set server-side from the approved template, for display
  // here) rather than what any individual recipient actually receives.
  caption: string | null;
  targetSegment: Segment | null;
  targetCustomerId: string | null;
  targetCustomerName?: string | null;
  // Null on a freeform (legacy) broadcast — set together on a template one.
  templateName: string | null;
  templateLanguage: string | null;
  scheduledAt: string;
  status: string;
  errorMessage: string | null;
  publishedAt: string | null;
};

export async function listBroadcasts(): Promise<Broadcast[]> {
  const { data } = await apiClient.get<Broadcast[]>("/communication/broadcasts");
  return data;
}

export async function createBroadcast(
  input: ({ title?: string; offerEnabled?: boolean; offerCode?: string; offerDescription?: string; offerStartsAt?: string; offerEndsAt?: string } & (
    | { caption: string; targetSegment?: Segment; targetCustomerId?: string; scheduledAt: string }
    | {
        templateName: string;
        templateLanguage: string;
        placeholders: PlaceholderMapping[];
        targetSegment?: Segment;
        targetCustomerId?: string;
        scheduledAt: string;
      }))
): Promise<Broadcast> {
  const { data } = await apiClient.post<Broadcast>("/communication/broadcasts", input);
  return data;
}

export async function cancelBroadcast(id: string): Promise<void> {
  await apiClient.delete(`/communication/broadcasts/${id}`);
}

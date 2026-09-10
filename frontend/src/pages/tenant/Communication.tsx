import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import axios from "axios";
import { MessageCircle, Globe, Instagram, Facebook, Send, X, Plus } from "lucide-react";
import {
  listConversations,
  getMessages,
  sendMessage,
  startConversation,
  listBroadcasts,
  createBroadcast,
  cancelBroadcast,
  type ConversationSummary,
  type Message,
  type Channel,
  type OutboundChannel,
  type Broadcast,
} from "../../api/communication";
import { listCustomers, type Customer, type Segment } from "../../api/customers";
import { listCustomerCategories, type CustomerCategory } from "../../api/customerCategories";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "../../components/Table";

const CHANNEL_META: Record<Channel, { label: string; icon: typeof MessageCircle; color: string }> = {
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle, color: "text-emerald-600" },
  WEBSITE_CHAT: { label: "Website Chat", icon: Globe, color: "text-blue-600" },
  INSTAGRAM_DM: { label: "Instagram", icon: Instagram, color: "text-pink-600" },
  FACEBOOK_DM: { label: "Facebook", icon: Facebook, color: "text-blue-600" },
};

// No WEBSITE_CHAT here — see api/communication.ts's OutboundChannel comment.
const OUTBOUND_CHANNELS: OutboundChannel[] = ["WHATSAPP", "INSTAGRAM_DM", "FACEBOOK_DM"];

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Communication() {
  const [tab, setTab] = useState<"inbox" | "broadcasts">("inbox");

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Communication Center</h1>
      <p className="mt-1 text-sm text-neutral-500">WhatsApp, website chat, and Instagram DMs in one place.</p>

      <div className="mt-6 flex gap-1 border-b border-neutral-200">
        <TabButton active={tab === "inbox"} onClick={() => setTab("inbox")}>
          Inbox
        </TabButton>
        <TabButton active={tab === "broadcasts"} onClick={() => setTab("broadcasts")}>
          Scheduled Broadcasts
        </TabButton>
      </div>

      {tab === "inbox" ? <Inbox /> : <Broadcasts />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
        active ? "border-maroon text-maroon" : "border-transparent text-neutral-500 hover:text-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

// Shared by the reply flow and the start-new-conversation flow below — same
// "what does this delivery result mean for the tenant" wording either way.
function deliveryNotice(
  delivery: { mode: "live" | "mock"; delivered: boolean; error?: string } | null,
  channelLabel: string
): string | null {
  if (!delivery) return null;
  if (delivery.mode === "mock") {
    return `Sent in mock mode — ${channelLabel} isn't connected for this business yet. Connect it in Settings.`;
  }
  if (!delivery.delivered) {
    return `Delivery failed: ${delivery.error ?? "unknown error"}`;
  }
  return null;
}

function Inbox() {
  const { showToast } = useToast();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mockNotice, setMockNotice] = useState<string | null>(null);
  const [newConvoOpen, setNewConvoOpen] = useState(false);

  async function loadConversations() {
    try {
      const data = await listConversations();
      setConversations(data);
      if (!selectedId && data.length > 0) setSelectedId(data[0].id);
    } catch {
      showToast("Could not load conversations.", "error");
    }
  }

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setMessages(null);
    setMockNotice(null);
    getMessages(selectedId)
      .then(setMessages)
      .catch(() => showToast("Could not load conversation.", "error"));
  }, [selectedId]);

  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    try {
      const res = await sendMessage(selectedId, draft.trim());
      setMessages((prev) => [...(prev ?? []), res.message]);
      setDraft("");
      setMockNotice(deliveryNotice(res.delivery, selected ? CHANNEL_META[selected.channel].label : "this channel"));
      loadConversations();
    } catch {
      showToast("Could not send message.", "error");
    } finally {
      setSending(false);
    }
  }

  // Called by NewConversationModal after it's already created the
  // conversation + first message server-side — this just brings the new
  // thread into view, same as clicking an existing one in the list below.
  function handleConversationStarted(conversationId: string, delivery: { mode: "live" | "mock"; delivered: boolean; error?: string } | null, channel: Channel) {
    setNewConvoOpen(false);
    loadConversations();
    setSelectedId(conversationId);
    setMockNotice(deliveryNotice(delivery, CHANNEL_META[channel].label));
  }

  return (
    <div className="mt-4 flex h-[560px] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex w-80 shrink-0 flex-col overflow-hidden border-r border-neutral-200">
        <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2.5">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Conversations</span>
          <button
            onClick={() => setNewConvoOpen(true)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-maroon hover:bg-maroon/5"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
        {conversations === null && <p className="p-4 text-sm text-neutral-400">Loading…</p>}
        {conversations?.length === 0 && <p className="p-4 text-sm text-neutral-400">No conversations yet.</p>}
        {conversations?.map((c) => {
          const meta = CHANNEL_META[c.channel];
          const Icon = meta.icon;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`flex w-full items-start gap-3 border-b border-neutral-100 px-4 py-3 text-left transition ${
                c.id === selectedId ? "bg-maroon/5" : "hover:bg-neutral-50"
              }`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.color}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {c.contactName ?? c.contactHandle ?? "Unknown"}
                  </p>
                  <span className="shrink-0 text-xs text-neutral-400">{formatTime(c.lastMessageAt)}</span>
                </div>
                <p className="truncate text-xs text-neutral-500">{c.lastMessage?.body ?? "No messages yet"}</p>
              </div>
            </button>
          );
        })}
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        {!selected && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-neutral-400">
            <p>Select a conversation</p>
            <button onClick={() => setNewConvoOpen(true)} className="text-xs font-medium text-maroon hover:underline">
              or start a new one
            </button>
          </div>
        )}
        {selected && (
          <>
            <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
              {(() => {
                const Icon = CHANNEL_META[selected.channel].icon;
                return <Icon className={`h-4 w-4 ${CHANNEL_META[selected.channel].color}`} />;
              })()}
              <div>
                <p className="text-sm font-medium text-neutral-900">{selected.contactName ?? selected.contactHandle}</p>
                <p className="text-xs text-neutral-400">{CHANNEL_META[selected.channel].label}</p>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages === null && <p className="text-sm text-neutral-400">Loading…</p>}
              {messages?.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                      m.direction === "OUTBOUND" ? "bg-maroon text-white" : "bg-neutral-100 text-neutral-800"
                    }`}
                  >
                    <p>{m.body}</p>
                    <p className={`mt-1 text-[10px] ${m.direction === "OUTBOUND" ? "text-white/70" : "text-neutral-400"}`}>
                      {formatTime(m.sentAt)}
                      {m.status === "failed" && " · failed to deliver"}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {mockNotice && (
              <div className="flex items-center justify-between gap-2 bg-amber-50 px-5 py-2 text-xs text-amber-700">
                <span>{mockNotice}</span>
                <button onClick={() => setMockNotice(null)} aria-label="Dismiss">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-neutral-200 p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a reply…"
                className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
              />
              <Button type="submit" disabled={sending || !draft.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </>
        )}
      </div>

      <NewConversationModal open={newConvoOpen} onClose={() => setNewConvoOpen(false)} onStarted={handleConversationStarted} />
    </div>
  );
}

function NewConversationModal({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (
    conversationId: string,
    delivery: { mode: "live" | "mock"; delivered: boolean; error?: string } | null,
    channel: Channel
  ) => void;
}) {
  const [channel, setChannel] = useState<OutboundChannel>("WHATSAPP");
  const [contactHandle, setContactHandle] = useState("");
  const [contactName, setContactName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetAndClose() {
    setChannel("WHATSAPP");
    setContactHandle("");
    setContactName("");
    setBody("");
    setError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await startConversation({
        channel,
        contactHandle: contactHandle.trim(),
        contactName: contactName.trim() || undefined,
        body: body.trim(),
      });
      onStarted(res.conversation.id, res.delivery, res.conversation.channel);
      resetAndClose();
    } catch (err) {
      setError(
        axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not start conversation.") : "Could not start conversation."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="New conversation">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as OutboundChannel)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          >
            {OUTBOUND_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_META[c].label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">
            {channel === "WHATSAPP" ? "Phone number" : "Handle / profile ID"}
          </label>
          <input
            required
            value={contactHandle}
            onChange={(e) => setContactHandle(e.target.value)}
            placeholder={channel === "WHATSAPP" ? "+91 98000 00000" : "e.g. @their.handle"}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Name (optional)</label>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Message</label>
          <textarea
            required
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the first message…"
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !contactHandle.trim() || !body.trim()}>
            {submitting ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const BROADCAST_STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  published: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

function Broadcasts() {
  const { showToast } = useToast();
  const [broadcasts, setBroadcasts] = useState<Broadcast[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function load() {
    try {
      setBroadcasts(await listBroadcasts());
    } catch {
      showToast("Could not load broadcasts.", "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCancel(id: string) {
    try {
      await cancelBroadcast(id);
      showToast("Broadcast canceled");
      load();
    } catch {
      showToast("Could not cancel broadcast.", "error");
    }
  }

  return (
    <div className="mt-4">
      <div className="flex justify-end">
        <Button onClick={() => setModalOpen(true)}>+ New Broadcast</Button>
      </div>

      <div className="mt-4">
        <Table>
          <TableHead>
            <tr>
              <Th>Message</Th>
              <Th>Target</Th>
              <Th>Scheduled for</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </TableHead>
          <TableBody>
            {broadcasts === null && (
              <TableRow>
                <Td colSpan={5} className="text-center text-neutral-400">
                  Loading…
                </Td>
              </TableRow>
            )}
            {broadcasts?.length === 0 && (
              <TableRow>
                <Td colSpan={5} className="text-center text-neutral-400">
                  No broadcasts scheduled.
                </Td>
              </TableRow>
            )}
            {broadcasts?.map((b) => (
              <TableRow key={b.id}>
                <Td className="max-w-xs truncate text-neutral-800">{b.caption}</Td>
                <Td className="text-neutral-600">
                  {b.targetCustomerName ?? (b.targetSegment ? `${b.targetSegment} segment` : "—")}
                </Td>
                <Td className="text-neutral-600">{formatTime(b.scheduledAt)}</Td>
                <Td>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      BROADCAST_STATUS_STYLES[b.status] ?? "bg-neutral-100 text-neutral-700"
                    }`}
                  >
                    {b.status}
                  </span>
                  {b.status === "failed" && b.errorMessage && (
                    <p className="mt-1 text-xs text-red-500">{b.errorMessage}</p>
                  )}
                </Td>
                <Td className="text-right">
                  {b.status === "scheduled" && (
                    <button onClick={() => handleCancel(b.id)} className="text-xs font-medium text-neutral-500 hover:text-red-600">
                      Cancel
                    </button>
                  )}
                </Td>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <NewBroadcastModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false);
          load();
        }}
      />
    </div>
  );
}

function NewBroadcastModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [caption, setCaption] = useState("");
  const [targetType, setTargetType] = useState<"segment" | "customer">("segment");
  const [segment, setSegment] = useState<Segment>("");
  const [customerId, setCustomerId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [categories, setCategories] = useState<CustomerCategory[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      listCustomers().then(setCustomers).catch(() => {});
      listCustomerCategories()
        .then((cats) => {
          setCategories(cats);
          setSegment((prev) => prev || cats.find((c) => c.isPriority)?.name || cats[0]?.name || "");
        })
        .catch(() => {});
    }
  }, [open]);

  function resetAndClose() {
    setCaption("");
    setTargetType("segment");
    setSegment("");
    setCustomerId("");
    setScheduledAt("");
    setError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (targetType === "customer" && !customerId) {
      setError("Choose a customer to message.");
      return;
    }
    if (targetType === "segment" && !segment) {
      setError("Choose a category to message.");
      return;
    }
    setSubmitting(true);
    try {
      await createBroadcast({
        caption,
        targetSegment: targetType === "segment" ? segment : undefined,
        targetCustomerId: targetType === "customer" ? customerId : undefined,
        scheduledAt: new Date(scheduledAt).toISOString(),
      });
      resetAndClose();
      onCreated();
    } catch (err) {
      setError(
        axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not schedule broadcast.") : "Could not schedule broadcast."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="New Broadcast">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700">Message</label>
          <textarea
            required
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Hi {{name}}, ..."
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
          <p className="mt-1 text-xs text-neutral-400">Use {"{{name}}"} to personalize with each customer's name.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Send to</label>
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={targetType === "segment"}
                onChange={() => setTargetType("segment")}
              />
              Segment
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={targetType === "customer"}
                onChange={() => setTargetType("customer")}
              />
              Individual customer
            </label>
          </div>
        </div>

        {targetType === "segment" ? (
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value as Segment)}
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          >
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.phoneMasked})
              </option>
            ))}
          </select>
        )}

        <div>
          <label className="block text-sm font-medium text-neutral-700">Scheduled for</label>
          <input
            required
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Scheduling…" : "Schedule Broadcast"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

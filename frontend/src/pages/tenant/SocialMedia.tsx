import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { Instagram, Facebook, Send } from "lucide-react";
import {
  getIntegrationStatus,
  listSocialPosts,
  createSocialPost,
  cancelSocialPost,
  listSocialComments,
  replyToSocialComment,
  type SocialPost,
  type SocialChannel,
  type PostType,
  type SocialComment,
} from "../../api/social";
import { listConversations, getMessages, sendMessage, type ConversationSummary, type Message } from "../../api/communication";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "../../components/Table";

const TABS = ["Post Scheduler", "DMs & Comments"] as const;
type Tab = (typeof TABS)[number];

const CHANNEL_ICON: Record<SocialChannel, typeof Instagram> = {
  INSTAGRAM: Instagram,
  FACEBOOK: Facebook,
};

const CHANNEL_COLOR: Record<SocialChannel, string> = {
  INSTAGRAM: "text-pink-600",
  FACEBOOK: "text-blue-600",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  published: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

export default function SocialMedia() {
  const [tab, setTab] = useState<Tab>("Post Scheduler");
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    getIntegrationStatus()
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false));
  }, []);

  return (
    <div className="px-8 py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Social Media Manager</h1>
      <p className="mt-1 text-sm text-neutral-500">Schedule Instagram and Facebook content, and manage DMs and comments.</p>

      {connected === false && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Meta isn't connected for this business yet — posts, DMs, and comment replies will run in{" "}
          <span className="font-semibold">mock mode</span> (visible here for review, not actually delivered) until
          you add Instagram/Facebook credentials in Settings.
        </div>
      )}
      {connected === true && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Meta is connected — posts, DMs, and comment replies deliver live.
        </div>
      )}

      <div className="mt-6 flex gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t ? "border-maroon text-maroon" : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Post Scheduler" ? <PostScheduler /> : <DmsAndComments />}
    </div>
  );
}

function PostScheduler() {
  const { showToast } = useToast();
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function load() {
    try {
      setPosts(await listSocialPosts());
    } catch {
      showToast("Could not load posts.", "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCancel(id: string) {
    try {
      await cancelSocialPost(id);
      showToast("Post canceled");
      load();
    } catch {
      showToast("Could not cancel post.", "error");
    }
  }

  return (
    <div className="mt-4">
      <div className="flex justify-end">
        <Button onClick={() => setModalOpen(true)}>+ New Post</Button>
      </div>

      <div className="mt-4">
        <Table>
          <TableHead>
            <tr>
              <Th></Th>
              <Th>Channel</Th>
              <Th>Type</Th>
              <Th>Caption</Th>
              <Th>Scheduled for</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </TableHead>
          <TableBody>
            {posts === null && (
              <TableRow>
                <Td colSpan={7} className="text-center text-neutral-400">
                  Loading…
                </Td>
              </TableRow>
            )}
            {posts?.length === 0 && (
              <TableRow>
                <Td colSpan={7} className="text-center text-neutral-400">
                  No posts scheduled.
                </Td>
              </TableRow>
            )}
            {posts?.map((p) => {
              const Icon = CHANNEL_ICON[p.channel];
              return (
                <TableRow key={p.id}>
                  <Td>
                    {p.mediaUrl ? (
                      <img src={p.mediaUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-neutral-100" />
                    )}
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center gap-1.5 ${CHANNEL_COLOR[p.channel]}`}>
                      <Icon className="h-4 w-4" /> {p.channel === "INSTAGRAM" ? "Instagram" : "Facebook"}
                    </span>
                  </Td>
                  <Td className="text-neutral-600">{p.postType ?? "POST"}</Td>
                  <Td className="max-w-xs truncate text-neutral-800">{p.caption ?? "—"}</Td>
                  <Td className="text-neutral-600">{formatTime(p.scheduledAt)}</Td>
                  <Td>
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] ?? "bg-neutral-100 text-neutral-700"}`}>
                      {p.status}
                    </span>
                    {p.status === "failed" && p.errorMessage && <p className="mt-1 text-xs text-red-500">{p.errorMessage}</p>}
                  </Td>
                  <Td className="text-right">
                    {p.status === "scheduled" && (
                      <button onClick={() => handleCancel(p.id)} className="text-xs font-medium text-neutral-500 hover:text-red-600">
                        Cancel
                      </button>
                    )}
                  </Td>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <NewPostModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={() => { setModalOpen(false); load(); }} />
    </div>
  );
}

function NewPostModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [channel, setChannel] = useState<SocialChannel>("INSTAGRAM");
  const [postType, setPostType] = useState<PostType>("POST");
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<File | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetAndClose() {
    setChannel("INSTAGRAM");
    setPostType("POST");
    setCaption("");
    setMedia(null);
    setScheduledAt("");
    setError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createSocialPost({
        channel,
        postType,
        caption: caption || undefined,
        scheduledAt: new Date(scheduledAt).toISOString(),
        media: media ?? undefined,
      });
      resetAndClose();
      onCreated();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not schedule post.") : "Could not schedule post.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="New Post">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as SocialChannel)}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            >
              <option value="INSTAGRAM">Instagram</option>
              <option value="FACEBOOK">Facebook</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">Type</label>
            <select
              value={postType}
              onChange={(e) => setPostType(e.target.value as PostType)}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            >
              <option value="POST">Post</option>
              <option value="STORY">Story</option>
              <option value="REEL">Reel</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Caption</label>
          <textarea
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Media</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setMedia(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-neutral-600 file:mr-4 file:rounded-lg file:border-0 file:bg-maroon file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-maroon-dark"
          />
        </div>

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

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Scheduling…" : "Schedule Post"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DmsAndComments() {
  return (
    <div className="mt-4 space-y-8">
      <CommentsSection />
      <DmsSection />
    </div>
  );
}

function CommentsSection() {
  const { showToast } = useToast();
  const [comments, setComments] = useState<SocialComment[] | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);

  async function load() {
    try {
      setComments(await listSocialComments());
    } catch {
      showToast("Could not load comments.", "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleReply(id: string) {
    const message = (replyDrafts[id] ?? "").trim();
    if (!message) return;
    setSending(id);
    try {
      const res = await replyToSocialComment(id, message);
      if (res.delivery?.mode === "mock") {
        showToast("Reply saved in mock mode — Meta isn't connected for this business yet.");
      } else {
        showToast("Reply sent");
      }
      setReplyDrafts((d) => ({ ...d, [id]: "" }));
      load();
    } catch {
      showToast("Could not send reply.", "error");
    } finally {
      setSending(null);
    }
  }

  return (
    <section>
      <h2 className="font-serif text-lg text-neutral-900">Comments</h2>
      <div className="mt-3 space-y-3">
        {comments === null && <p className="text-sm text-neutral-400">Loading…</p>}
        {comments?.length === 0 && <p className="text-sm text-neutral-400">No comments yet.</p>}
        {comments?.map((c) => {
          const Icon = CHANNEL_ICON[c.channel];
          return (
            <div key={c.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <Icon className={`h-3.5 w-3.5 ${CHANNEL_COLOR[c.channel]}`} />
                <span>{c.postCaption ?? "Post"}</span>
                <span>·</span>
                <span>{formatTime(c.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-neutral-800">
                <span className="font-medium">{c.authorName}</span>: {c.body}
              </p>

              {c.reply ? (
                <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                  <span className="font-medium text-neutral-800">Your reply:</span> {c.reply}
                </p>
              ) : (
                <div className="mt-3 flex gap-2">
                  <input
                    value={replyDrafts[c.id] ?? ""}
                    onChange={(e) => setReplyDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    placeholder="Write a reply…"
                    className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                  />
                  <Button
                    onClick={() => handleReply(c.id)}
                    disabled={sending === c.id || !(replyDrafts[c.id] ?? "").trim()}
                  >
                    Reply
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DmsSection() {
  const { showToast } = useToast();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function load() {
    try {
      const [ig, fb] = await Promise.all([listConversations("INSTAGRAM_DM"), listConversations("FACEBOOK_DM")]);
      const merged = [...ig, ...fb].sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      setConversations(merged);
      if (!selectedId && merged.length > 0) setSelectedId(merged[0].id);
    } catch {
      showToast("Could not load DMs.", "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setMessages(null);
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
      load();
    } catch {
      showToast("Could not send message.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <section>
      <h2 className="font-serif text-lg text-neutral-900">DMs</h2>
      <div className="mt-3 flex h-96 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-neutral-200">
          {conversations === null && <p className="p-4 text-sm text-neutral-400">Loading…</p>}
          {conversations?.length === 0 && <p className="p-4 text-sm text-neutral-400">No DMs yet.</p>}
          {conversations?.map((c) => {
            const Icon = CHANNEL_ICON[c.channel === "FACEBOOK_DM" ? "FACEBOOK" : "INSTAGRAM"];
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`flex w-full items-start gap-2 border-b border-neutral-100 px-3 py-2.5 text-left transition ${
                  c.id === selectedId ? "bg-maroon/5" : "hover:bg-neutral-50"
                }`}
              >
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${CHANNEL_COLOR[c.channel === "FACEBOOK_DM" ? "FACEBOOK" : "INSTAGRAM"]}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">{c.contactName ?? c.contactHandle}</p>
                  <p className="truncate text-xs text-neutral-500">{c.lastMessage?.body ?? "No messages yet"}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-1 flex-col">
          {!selected && <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">Select a conversation</div>}
          {selected && (
            <>
              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {messages === null && <p className="text-sm text-neutral-400">Loading…</p>}
                {messages?.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-xl px-3 py-1.5 text-sm ${
                        m.direction === "OUTBOUND" ? "bg-maroon text-white" : "bg-neutral-100 text-neutral-800"
                      }`}
                    >
                      {m.body}
                    </div>
                  </div>
                ))}
              </div>
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
      </div>
    </section>
  );
}


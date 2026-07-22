import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { Copy, RefreshCw, Sparkles } from "lucide-react";
import {
  generateContent,
  listGenerations,
  getAIStatus,
  CONTENT_TYPES,
  TONES,
  type AIGeneration,
  type ContentType,
  type Tone,
} from "../../api/ai";
import { useToast } from "../../components/Toast";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AIAssistant() {
  const { showToast } = useToast();
  const [contentType, setContentType] = useState<ContentType>("Instagram Caption");
  const [tone, setTone] = useState<Tone>("Elegant");
  const [productName, setProductName] = useState("");
  const [context, setContext] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<AIGeneration[] | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  async function loadHistory() {
    try {
      setHistory(await listGenerations());
    } catch {
      // Non-fatal — history is a convenience, not core to compose+generate.
    }
  }

  useEffect(() => {
    loadHistory();
    getAIStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
  }, []);

  async function runGenerate(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setGenerating(true);
    try {
      const result = await generateContent({
        contentType,
        tone,
        productName: productName || undefined,
        context: context || undefined,
      });
      setOutput(result.output);
      loadHistory();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error ?? "Could not generate content.");
      } else {
        setError("Could not generate content.");
      }
    } finally {
      setGenerating(false);
    }
  }

  function handleCopy() {
    if (!output) return;
    navigator.clipboard.writeText(output);
    showToast("Copied to clipboard");
  }

  function loadFromHistory(g: AIGeneration) {
    setContentType(g.contentType);
    setTone(g.tone);
    setProductName(g.productName ?? "");
    setContext(g.context ?? "");
    setOutput(g.output);
    setError(null);
  }

  return (
    <div className="px-8 py-8">
      <h1 className="font-serif text-2xl text-neutral-900">AI Marketing Assistant</h1>
      <p className="mt-1 text-sm text-neutral-500">Generate on-brand captions, descriptions, and more.</p>

      {configured === false && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          AI Assistant isn't configured yet — set <code className="font-mono">OPENAI_API_KEY</code> in the backend
          environment to start generating content.
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-serif text-lg text-neutral-900">Compose</h2>
          <form onSubmit={runGenerate} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700">Content type</label>
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value as ContentType)}
                  className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                >
                  {CONTENT_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700">Tone</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as Tone)}
                  className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700">Product / saree name</label>
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Kanjivaram Silk — Maroon Zari"
                className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700">Context / details</label>
              <textarea
                rows={4}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Any occasion, offer, or detail you want included…"
                className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
              />
            </div>

            <Button type="submit" disabled={generating || configured === false} className="w-full">
              <span className="flex items-center justify-center gap-2">
                <Sparkles className="h-4 w-4" />
                {generating ? "Generating…" : "Generate"}
              </span>
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="font-serif text-lg text-neutral-900">Output</h2>

          {error && (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          {!error && !output && <p className="mt-4 text-sm text-neutral-400">Generated content will appear here.</p>}

          {output && (
            <>
              <div className="mt-4 whitespace-pre-wrap rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-800">
                {output}
              </div>
              <div className="mt-4 flex gap-3">
                <Button variant="secondary" onClick={handleCopy}>
                  <span className="flex items-center gap-2">
                    <Copy className="h-4 w-4" /> Copy
                  </span>
                </Button>
                <Button variant="secondary" onClick={() => runGenerate()} disabled={generating || configured === false}>
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" /> Regenerate
                  </span>
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="font-serif text-lg text-neutral-900">Recent generations</h2>
        <div className="mt-4 space-y-2">
          {history === null && <p className="text-sm text-neutral-400">Loading…</p>}
          {history?.length === 0 && <p className="text-sm text-neutral-400">No generations yet.</p>}
          {history?.map((g) => (
            <button
              key={g.id}
              onClick={() => loadFromHistory(g)}
              className="flex w-full items-center justify-between rounded-xl border border-neutral-200 px-4 py-3 text-left text-sm hover:bg-neutral-50"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-neutral-900">
                  {g.contentType} · <span className="font-normal text-neutral-500">{g.tone}</span>
                  {g.productName && <span className="font-normal text-neutral-500"> · {g.productName}</span>}
                </p>
                <p className="truncate text-neutral-500">{g.output}</p>
              </div>
              <span className="ml-4 shrink-0 text-xs text-neutral-400">{formatTime(g.createdAt)}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

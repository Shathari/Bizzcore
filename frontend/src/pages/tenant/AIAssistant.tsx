import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { Copy, RefreshCw, Sparkles, Wand2, History } from "lucide-react";
import {
  generateContent,
  refineIdea,
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

  // "Refine my idea" — optional pre-step. `suggestions` holds the AI's
  // proposed briefs, editable in place before either is adopted into
  // `context` below. Null (not []) is "panel not open"; distinguishes from
  // successfully getting zero suggestions back, which shouldn't happen but
  // isn't the same state as "haven't asked yet".
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

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

  async function runRefine() {
    if (!context.trim()) return;
    setRefineError(null);
    setRefining(true);
    try {
      const result = await refineIdea({
        contentType,
        tone,
        productName: productName || undefined,
        rawIdea: context,
      });
      setSuggestions(result.suggestions);
    } catch (err) {
      setRefineError(
        axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not refine this idea.") : "Could not refine this idea."
      );
    } finally {
      setRefining(false);
    }
  }

  function useSuggestion(text: string) {
    setContext(text);
    setSuggestions(null);
  }

  function editSuggestion(index: number, text: string) {
    setSuggestions((prev) => (prev ? prev.map((s, i) => (i === index ? text : s)) : prev));
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
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      {/* ---------- Page header ---------- */}
      <div className="max-w-3xl">
        <h1 className="font-serif text-2xl text-neutral-900">AI Marketing Assistant</h1>
        <p className="mt-1 text-sm text-neutral-500">Generate on-brand captions, descriptions, and more.</p>
      </div>

      {configured === false && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          AI Assistant isn't configured yet — set <code className="font-mono">OPENAI_API_KEY</code> in the backend
          environment to start generating content.
        </div>
      )}

      {/* ---------- Compose + Output ---------- */}
      {/* items-start + lg:sticky on the Output column keeps it anchored to the
          top of the viewport as Compose grows (e.g. when suggestions open),
          instead of the two columns drifting out of height-sync. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <Card>
          <h2 className="font-serif text-lg text-neutral-900">Compose</h2>

          <form onSubmit={runGenerate} className="mt-5 space-y-6">
            {/* Section 1 — settings */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-neutral-700">Product / saree name</label>
                <input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Kanjivaram Silk — Maroon Zari"
                  className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                />
              </div>
            </div>

            <div className="h-px bg-neutral-100" />

            {/* Section 2 — idea, with refine as a clearly-scoped sub-step */}
            <div>
              <label className="block text-sm font-medium text-neutral-700">Context / details</label>
              <textarea
                rows={4}
                value={context}
                onChange={(e) => {
                  setContext(e.target.value);
                  setSuggestions(null);
                }}
                placeholder="Type a full brief, or just a rough idea (e.g. “diwali sale saree new collection”) and refine it below…"
                className="mt-1 w-full resize-y rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
              />

              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={runRefine}
                  disabled={refining || generating || configured === false || !context.trim()}
                  className="flex items-center gap-1.5 text-xs font-semibold text-maroon hover:underline disabled:cursor-not-allowed disabled:text-neutral-300 disabled:no-underline"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {refining ? "Refining…" : "Refine my idea"}
                </button>
                {refineError && (
                  <p className="text-xs text-red-600" role="alert">
                    {refineError}
                  </p>
                )}
              </div>

              {/* Grid-rows trick gives a smooth open/close instead of an
                  instant layout jump when suggestions appear or clear. */}
              <div
                className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                  suggestions && suggestions.length > 0 ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="space-y-2.5 rounded-xl border border-gold/40 bg-gold/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Pick a suggestion, edit it if you like, then generate
                    </p>
                    {suggestions?.map((s, i) => (
                      <div key={i} className="rounded-lg border border-neutral-200 bg-white p-2.5">
                        <textarea
                          rows={2}
                          value={s}
                          onChange={(e) => editSuggestion(i, e.target.value)}
                          className="w-full resize-none border-0 p-0 text-sm text-neutral-800 focus:outline-none focus:ring-0"
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => useSuggestion(s)}
                            className="rounded-lg bg-maroon px-3 py-1 text-xs font-semibold text-white hover:bg-maroon/90"
                          >
                            Use this
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <Button type="submit" disabled={generating || configured === false} className="w-full">
              <span className="flex items-center justify-center gap-2">
                <Sparkles className="h-4 w-4" />
                {generating ? "Generating…" : "Generate"}
              </span>
            </Button>
          </form>
        </Card>

        <Card className="lg:sticky lg:top-6">
          <h2 className="font-serif text-lg text-neutral-900">Output</h2>

          {error && (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          {!error && !output && (
            <div className="mt-4 flex min-h-[160px] items-center justify-center rounded-xl border border-dashed border-neutral-200 text-center">
              <p className="px-6 text-sm text-neutral-400">Generated content will appear here.</p>
            </div>
          )}

          {output && (
            <>
              {/* max-h + scroll keeps a very long generation from stretching
                  the whole page — the card stays a predictable size. */}
              <div className="mt-4 max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed text-neutral-800">
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

      {/* ---------- Recent generations ---------- */}
      <Card className="mt-6">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-neutral-400" />
          <h2 className="font-serif text-lg text-neutral-900">Recent generations</h2>
        </div>

        <div className="mt-4 space-y-2">
          {history === null && <p className="text-sm text-neutral-400">Loading…</p>}
          {history?.length === 0 && (
            <p className="text-sm text-neutral-400">Nothing generated yet — your history will show up here.</p>
          )}
          {history?.map((g) => (
            <button
              key={g.id}
              onClick={() => loadFromHistory(g)}
              className="flex w-full items-center justify-between gap-4 rounded-xl border border-neutral-200 px-4 py-3 text-left text-sm transition-colors hover:border-maroon/30 hover:bg-neutral-50"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-neutral-900">
                  {g.contentType} <span className="mx-1 text-neutral-300">·</span>
                  <span className="font-normal text-neutral-500">{g.tone}</span>
                  {g.productName && (
                    <>
                      <span className="mx-1 text-neutral-300">·</span>
                      <span className="font-normal text-neutral-500">{g.productName}</span>
                    </>
                  )}
                </p>
                <p className="mt-0.5 truncate text-neutral-500">{g.output}</p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs text-neutral-400">{formatTime(g.createdAt)}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
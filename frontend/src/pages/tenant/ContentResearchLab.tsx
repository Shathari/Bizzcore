import { useEffect, useState } from "react";
import axios from "axios";
import { Copy, ExternalLink, Search, Sparkles } from "lucide-react";
import {
  createResearchReport,
  generateResearchScript,
  getContentResearchStatus,
  getResearchReport,
  listResearchReports,
  parsePatterns,
  type ContentResearchReport,
  type ContentResearchReportSummary,
  type ResearchScriptGeneration,
} from "../../api/contentResearch";
import { TONES, type Tone } from "../../api/ai";
import { useToast } from "../../components/Toast";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatCount(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function errorMessage(err: unknown, fallback: string): string {
  return axios.isAxiosError(err) ? (err.response?.data?.error ?? fallback) : fallback;
}

export default function ContentResearchLab() {
  const { showToast } = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [history, setHistory] = useState<ContentResearchReportSummary[] | null>(null);

  const [linksText, setLinksText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [selectedReport, setSelectedReport] = useState<ContentResearchReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const [selectedPatternIds, setSelectedPatternIds] = useState<string[]>([]);
  const [tone, setTone] = useState<Tone>("Elegant");
  const [productName, setProductName] = useState("");
  const [context, setContext] = useState("");
  const [scriptResult, setScriptResult] = useState<ResearchScriptGeneration | null>(null);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  async function loadHistory() {
    try {
      setHistory(await listResearchReports());
    } catch {
      // Non-fatal — history is a convenience.
    }
  }

  useEffect(() => {
    loadHistory();
    getContentResearchStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
  }, []);

  async function openReport(id: string) {
    setLoadingReport(true);
    setSelectedPatternIds([]);
    setScriptResult(null);
    setScriptError(null);
    try {
      setSelectedReport(await getResearchReport(id));
    } catch (err) {
      showToast(errorMessage(err, "Could not load this report."));
    } finally {
      setLoadingReport(false);
    }
  }

  async function runResearch() {
    const links = linksText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (links.length === 0) {
      setSubmitError("Add at least one reference link.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    setScriptResult(null);
    setSelectedPatternIds([]);
    try {
      const report = await createResearchReport(links);
      setSelectedReport(report);
      setLinksText("");
      loadHistory();
      if (report.status !== "COMPLETED") {
        setSubmitError(report.errorMessage ?? "Research run did not complete successfully.");
      }
    } catch (err) {
      setSubmitError(errorMessage(err, "Could not run research on these links."));
    } finally {
      setSubmitting(false);
    }
  }

  function togglePattern(id: string) {
    setSelectedPatternIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
    setScriptResult(null);
  }

  async function runGenerateScript() {
    if (!selectedReport || selectedPatternIds.length === 0) return;
    setScriptError(null);
    setGeneratingScript(true);
    try {
      const result = await generateResearchScript(selectedReport.id, {
        patternIds: selectedPatternIds,
        tone,
        productName: productName || undefined,
        context: context || undefined,
      });
      setScriptResult(result);
    } catch (err) {
      setScriptError(errorMessage(err, "Could not generate a script from the selected pattern(s)."));
    } finally {
      setGeneratingScript(false);
    }
  }

  function handleCopyScript() {
    if (!scriptResult) return;
    navigator.clipboard.writeText(scriptResult.output);
    showToast("Copied to clipboard");
  }

  const patterns = selectedReport ? parsePatterns(selectedReport.patterns) : [];

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Content Research Lab</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Research what's working for creators in your niche, then generate an original script inspired by the patterns.
      </p>

      {configured === false && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Content Research Lab isn't configured yet — set <code className="font-mono">OPENAI_API_KEY</code> and{" "}
          <code className="font-mono">APIFY_API_TOKEN</code> in the backend environment to start using it.
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-serif text-lg text-neutral-900">1. Research reference links</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Paste Instagram, YouTube, or TikTok links from creators whose content performs well in your niche — one per line.
          </p>
          <div className="mt-4 space-y-4">
            <textarea
              rows={8}
              value={linksText}
              onChange={(e) => setLinksText(e.target.value)}
              placeholder={"https://www.instagram.com/reel/...\nhttps://www.youtube.com/watch?v=...\nhttps://www.tiktok.com/@.../video/..."}
              className="w-full rounded-xl border border-neutral-300 px-3 py-2 font-mono text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
            {submitError && (
              <p className="text-sm text-red-600" role="alert">
                {submitError}
              </p>
            )}
            <Button onClick={runResearch} disabled={submitting || configured === false} className="w-full">
              <span className="flex items-center justify-center gap-2">
                <Search className="h-4 w-4" />
                {submitting ? "Researching… this can take a minute" : "Research these links"}
              </span>
            </Button>
          </div>

          <h2 className="mt-8 font-serif text-lg text-neutral-900">Past reports</h2>
          <div className="mt-3 space-y-2">
            {history === null && <p className="text-sm text-neutral-400">Loading…</p>}
            {history?.length === 0 && <p className="text-sm text-neutral-400">No research runs yet.</p>}
            {history?.map((r) => (
              <button
                key={r.id}
                onClick={() => openReport(r.id)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm hover:bg-neutral-50 ${
                  selectedReport?.id === r.id ? "border-maroon" : "border-neutral-200"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-neutral-900">
                    {r._count.links} link{r._count.links === 1 ? "" : "s"} ·{" "}
                    <span className={`font-normal ${r.status === "FAILED" ? "text-red-600" : "text-neutral-500"}`}>{r.status}</span>
                  </p>
                  {r.summary && <p className="truncate text-neutral-500">{r.summary}</p>}
                </div>
                <span className="ml-4 shrink-0 text-xs text-neutral-400">{formatTime(r.createdAt)}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="font-serif text-lg text-neutral-900">2. Patterns & script</h2>

          {loadingReport && <p className="mt-4 text-sm text-neutral-400">Loading report…</p>}

          {!loadingReport && !selectedReport && (
            <p className="mt-4 text-sm text-neutral-400">Run research or pick a past report to see patterns here.</p>
          )}

          {!loadingReport && selectedReport && selectedReport.status === "FAILED" && (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {selectedReport.errorMessage ?? "This research run failed."}
            </p>
          )}

          {!loadingReport && selectedReport && selectedReport.status === "COMPLETED" && (
            <div className="mt-4 space-y-5">
              {selectedReport.summary && <p className="text-sm text-neutral-700">{selectedReport.summary}</p>}

              <div className="space-y-2">
                {selectedReport.links.map((link) => (
                  <div key={link.id} className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-xs">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 items-center gap-1.5 truncate text-neutral-600 hover:text-maroon"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{link.url}</span>
                    </a>
                    <span className="ml-3 shrink-0 text-neutral-400">
                      {link.fetchStatus === "FETCHED"
                        ? `${formatCount(link.viewCount)} views · ${formatCount(link.likeCount)} likes`
                        : link.fetchStatus}
                    </span>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Select pattern(s) to build a script from
                </p>
                <div className="mt-2 space-y-2">
                  {patterns.map((p) => (
                    <label
                      key={p.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${
                        selectedPatternIds.includes(p.id) ? "border-maroon bg-maroon/5" : "border-neutral-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPatternIds.includes(p.id)}
                        onChange={() => togglePattern(p.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-neutral-900">
                          {p.title}{" "}
                          <span className="ml-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-normal text-neutral-500">
                            {p.type} · seen in {p.occurrenceCount}
                          </span>
                        </p>
                        <p className="mt-0.5 text-neutral-500">{p.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Product / offer</label>
                  <input
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="What should this script feature?"
                    className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700">Extra direction (optional)</label>
                <textarea
                  rows={2}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                />
              </div>

              {scriptError && (
                <p className="text-sm text-red-600" role="alert">
                  {scriptError}
                </p>
              )}

              <Button
                onClick={runGenerateScript}
                disabled={generatingScript || selectedPatternIds.length === 0 || configured === false}
                className="w-full"
              >
                <span className="flex items-center justify-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  {generatingScript ? "Generating…" : "Generate original script"}
                </span>
              </Button>

              {scriptResult && (
                <div>
                  <div className="whitespace-pre-wrap rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-800">
                    {scriptResult.output}
                  </div>
                  <Button variant="secondary" onClick={handleCopyScript} className="mt-3">
                    <span className="flex items-center gap-2">
                      <Copy className="h-4 w-4" /> Copy
                    </span>
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

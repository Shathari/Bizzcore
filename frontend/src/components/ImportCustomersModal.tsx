import { useRef, useState } from "react";
import axios from "axios";
import { Modal } from "./Modal";
import { Button } from "./Button";
import {
  previewImport,
  commitImport,
  type ImportPreview,
  type ImportCommitResult,
} from "../api/customers";

const TARGET_FIELDS: Array<{ field: string; label: string; required: boolean }> = [
  { field: "name", label: "Name", required: true },
  { field: "phone", label: "Phone", required: true },
  { field: "email", label: "Email", required: false },
  { field: "birthday", label: "Birthday", required: false },
  { field: "segment", label: "Segment", required: false },
  { field: "total_spent", label: "Total spent", required: false },
  { field: "last_purchase", label: "Last purchase", required: false },
  { field: "notes", label: "Notes", required: false },
];

type Step = "pick" | "map" | "result";

function guessMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  for (const { field } of TARGET_FIELDS) {
    const match = headers.find((h) => h.trim().toLowerCase().replace(/\s+/g, "_") === field);
    mapping[field] = match ?? null;
  }
  return mapping;
}

export function ImportCustomersModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("pick");
    setPreview(null);
    setMapping({});
    setResult(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const data = await previewImport(file);
      setPreview(data);
      setMapping(guessMapping(data.headers));
      setStep("map");
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not read file.") : "Could not read file.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCommit() {
    if (!preview) return;
    const missingRequired = TARGET_FIELDS.filter((f) => f.required && !mapping[f.field]);
    if (missingRequired.length > 0) {
      setError(`Map a column for: ${missingRequired.map((f) => f.label).join(", ")}`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await commitImport(mapping, preview.rows);
      setResult(res);
      setStep("result");
      if (res.inserted > 0) onImported();
    } catch {
      setError("Import failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Import customers">
      {step === "pick" && (
        <div>
          <p className="text-sm text-neutral-600">
            Upload a CSV or Excel file. You'll map its columns to BizzCore's fields on the next step.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            disabled={busy}
            className="mt-4 block w-full text-sm text-neutral-600 file:mr-4 file:rounded-lg file:border-0 file:bg-maroon file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-maroon-dark"
          />
          {busy && <p className="mt-2 text-sm text-neutral-400">Reading file…</p>}
          {error && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {step === "map" && preview && (
        <div>
          <p className="text-sm text-neutral-600">
            {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"} detected. Map your columns below.
          </p>

          <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
            {TARGET_FIELDS.map(({ field, label, required }) => (
              <div key={field} className="flex items-center gap-3">
                <label className="w-32 shrink-0 text-sm text-neutral-700">
                  {label}
                  {required && <span className="text-red-500"> *</span>}
                </label>
                <select
                  value={mapping[field] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || null }))}
                  className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                >
                  <option value="">— none —</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200">
            <table className="min-w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-neutral-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {preview.rows.slice(0, 3).map((row, i) => (
                  <tr key={i}>
                    {preview.headers.map((h) => (
                      <td key={h} className="px-3 py-2 text-neutral-600">
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setStep("pick")} disabled={busy}>
              Back
            </Button>
            <Button onClick={handleCommit} disabled={busy}>
              {busy ? "Importing…" : `Import ${preview.totalRows} row${preview.totalRows === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div>
          <p className="text-sm text-neutral-800">
            <span className="font-semibold text-emerald-700">{result.inserted}</span> customer
            {result.inserted === 1 ? "" : "s"} imported.
            {result.errors.length > 0 && (
              <>
                {" "}
                <span className="font-semibold text-red-700">{result.errors.length}</span> row
                {result.errors.length === 1 ? "" : "s"} had errors.
              </>
            )}
          </p>

          {result.errors.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3">
              <ul className="space-y-1 text-xs text-red-700">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-3">
            <Button variant="secondary" onClick={reset}>
              Import another file
            </Button>
            <Button onClick={handleClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

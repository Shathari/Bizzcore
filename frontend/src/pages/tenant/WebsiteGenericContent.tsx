import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { Trash2, Pencil, Upload, Download, SlidersHorizontal, RefreshCw, Search, ChevronLeft, ChevronRight } from "lucide-react";
import type { ModuleInfo, FieldDef, WebsiteContentImportFilters, WebsiteContentItem } from "../../api/superAdminWebsite";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "../../components/Table";

// Minimal shape both api/websiteContent.ts (Business Admin, own tenant) and
// api/superAdminWebsite.ts (Super Admin, cross-tenant) satisfy — this
// component is bound to whichever the caller passes in, same pattern as
// components/WebsiteIntegrationsPanel.tsx.
export type ListItemsOptions = { search?: string; page?: number };
export type ListItemsResult = { items: WebsiteContentItem[]; total: number; page: number; pageSize: number };

export type WebsiteContentApi = {
  list: (options?: ListItemsOptions) => Promise<ListItemsResult>;
  create: (payload: Record<string, unknown>) => Promise<WebsiteContentItem>;
  update: (id: string, payload: Record<string, unknown>) => Promise<WebsiteContentItem>;
  remove: (id: string) => Promise<void>;
  importItems: (filters?: WebsiteContentImportFilters) => Promise<{ imported: number; items: WebsiteContentItem[] }>;
  // Retries any pending/failed local items, then re-imports — the
  // bidirectional counterpart to importItems (pull-only).
  syncItems: () => Promise<{ retried: number; retriedFailed: number; imported: number }>;
  uploadImage: (file: File) => Promise<string>;
};

const SYNC_BADGE: Record<WebsiteContentItem["syncStatus"], string> = {
  synced: "bg-emerald-100 text-emerald-700",
  pending: "bg-neutral-100 text-neutral-500",
  failed: "bg-red-100 text-red-700",
};

function singularLabel(module: ModuleInfo): string {
  return module.singularLabel ?? module.label.replace(/s$/, "");
}

function extractSavedItem(err: unknown): WebsiteContentItem | null {
  if (axios.isAxiosError(err) && err.response?.status === 502) {
    const data = err.response.data;
    return data?.item ?? data ?? null;
  }
  return null;
}

export function GenericContentTab({
  module,
  api,
  readOnly,
}: {
  module: ModuleInfo;
  api: WebsiteContentApi;
  readOnly: boolean;
}) {
  return module.isSingleton ? (
    <SingletonContentTab module={module} api={api} readOnly={readOnly} />
  ) : (
    <ListContentTab module={module} api={api} readOnly={readOnly} />
  );
}

function ReadOnlyBanner() {
  return (
    <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
      Website content is managed by Super Admin. Contact them to request edit access.
    </p>
  );
}

const IMPORT_FILTER_FIELDS: Array<{ key: keyof WebsiteContentImportFilters; label: string; type: "text" | "number" | "checkbox" }> = [
  { key: "slug", label: "Slug", type: "text" },
  { key: "id", label: "External ID", type: "text" },
  { key: "category", label: "Category", type: "text" },
  { key: "collection", label: "Collection", type: "text" },
  { key: "code", label: "Code", type: "text" },
  { key: "position", label: "Position", type: "number" },
  { key: "featured", label: "Featured only", type: "checkbox" },
];

function ImportButton({ api, onImported, disabled }: { api: WebsiteContentApi; onImported: () => void; disabled?: boolean }) {
  const { showToast } = useToast();
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const busy = importing || syncing;

  async function runImport(filters?: WebsiteContentImportFilters) {
    setImporting(true);
    try {
      const res = await api.importItems(filters);
      showToast(`Imported ${res.imported} item${res.imported === 1 ? "" : "s"} from your website.`);
      setFiltersOpen(false);
      onImported();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Import failed.") : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    try {
      const res = await api.syncItems();
      showToast(`Synced: ${res.retried} retried, ${res.imported} imported from your website.`);
      onImported();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Sync failed.") : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="flex overflow-hidden rounded-lg border border-neutral-300">
        <button
          onClick={() => runImport()}
          disabled={disabled || busy}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {importing ? "Importing…" : "Import from website"}
        </button>
        <button
          onClick={() => setFiltersOpen(true)}
          disabled={disabled || busy}
          aria-label="Import with filters"
          className="border-l border-neutral-300 px-2 text-neutral-500 hover:bg-neutral-50 disabled:opacity-50"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <button
          onClick={runSync}
          disabled={disabled || busy}
          aria-label="Sync now"
          title="Retry pending/failed items, then re-import"
          className="flex items-center gap-1.5 border-l border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {filtersOpen && (
        <ImportFiltersModal onClose={() => setFiltersOpen(false)} onImport={runImport} importing={importing} />
      )}
    </>
  );
}

function ImportFiltersModal({
  onClose,
  onImport,
  importing,
}: {
  onClose: () => void;
  onImport: (filters: WebsiteContentImportFilters) => void;
  importing: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const filters: WebsiteContentImportFilters = {};
    if (values.slug) filters.slug = values.slug;
    if (values.id) filters.id = values.id;
    if (values.category) filters.category = values.category;
    if (values.collection) filters.collection = values.collection;
    if (values.code) filters.code = values.code;
    if (values.position) filters.position = Number(values.position);
    if (values.featured === "true") filters.featured = true;
    onImport(filters);
  }

  return (
    <Modal open onClose={onClose} title="Import with filters">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-neutral-500">
          Only items matching every filter you set will be imported. Leave a field blank to not filter on it.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {IMPORT_FILTER_FIELDS.map((f) => (
            <div key={f.key}>
              {f.type === "checkbox" ? (
                <label className="mt-1 flex items-center gap-2 text-sm font-medium text-neutral-700">
                  <input
                    type="checkbox"
                    checked={values[f.key] === "true"}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked ? "true" : "" }))}
                    className="h-4 w-4 rounded border-neutral-300 text-maroon focus:ring-maroon"
                  />
                  {f.label}
                </label>
              ) : (
                <>
                  <label className="block text-sm font-medium text-neutral-700">{f.label}</label>
                  <input
                    type={f.type}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                  />
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={importing}>
            {importing ? "Importing…" : "Import"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ListContentTab({
  module,
  api,
  readOnly,
}: {
  module: ModuleInfo;
  api: WebsiteContentApi;
  readOnly: boolean;
}) {
  const { showToast } = useToast();
  const fields = module.fields;
  const [result, setResult] = useState<ListItemsResult | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [modalItem, setModalItem] = useState<WebsiteContentItem | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebsiteContentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load(options?: ListItemsOptions) {
    try {
      setResult(await api.list(options ?? { search: search || undefined, page }));
    } catch {
      showToast(`Could not load ${module.label.toLowerCase()}.`);
    }
  }

  useEffect(() => {
    setResult(null);
    setSearchInput("");
    setSearch("");
    setPage(1);
    load({ search: undefined, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module.key]);

  useEffect(() => {
    // Debounce free-typed search so every keystroke doesn't hit the API.
    const handle = setTimeout(() => {
      if (searchInput !== search) {
        setSearch(searchInput);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    load({ search: search || undefined, page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  // A delete (or a filter narrowing) can leave the current page past the
  // new last page (e.g. deleting the only item on the last page) — step
  // back rather than showing an empty table with "Page 3 of 2".
  useEffect(() => {
    if (result && result.items.length === 0 && result.total > 0 && page > 1) {
      setPage(Math.max(1, Math.ceil(result.total / result.pageSize)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.remove(deleteTarget.id);
      showToast("Deleted");
      setDeleteTarget(null);
      load();
    } catch (err) {
      const saved = extractSavedItem(err);
      if (saved) {
        showToast("Deleted locally, but the external site couldn't be reached — will need a retry.");
        setDeleteTarget(null);
        load();
      } else {
        showToast("Could not delete.");
      }
    } finally {
      setDeleting(false);
    }
  }

  const displayFields = fields.filter((f) => f.type !== "textarea" && f.key !== "slug");
  const items = result?.items ?? null;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="mt-4">
      {readOnly && <ReadOnlyBanner />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={`Search ${module.label.toLowerCase()}…`}
            className="w-full rounded-lg border border-neutral-300 py-1.5 pl-8 pr-3 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        <div className="flex gap-2">
          <ImportButton api={api} onImported={() => load()} disabled={readOnly} />
          {!readOnly && <Button onClick={() => setModalItem("new")}>+ Add {singularLabel(module)}</Button>}
        </div>
      </div>

      <div className="mt-4">
        <Table>
          <TableHead>
            <tr>
              {displayFields.map((f) => (
                <Th key={f.key}>{f.label}</Th>
              ))}
              <Th>Sync</Th>
              {!readOnly && <Th></Th>}
            </tr>
          </TableHead>
          <TableBody>
            {items === null && (
              <TableRow>
                <Td colSpan={displayFields.length + (readOnly ? 1 : 2)} className="text-center text-neutral-400">
                  Loading…
                </Td>
              </TableRow>
            )}
            {items?.length === 0 && (
              <TableRow>
                <Td colSpan={displayFields.length + (readOnly ? 1 : 2)} className="text-center text-neutral-400">
                  {search ? "No matches for this search." : "Nothing here yet."}
                </Td>
              </TableRow>
            )}
            {items?.map((item, rowIndex) => (
              <TableRow key={item.id}>
                {displayFields.map((f, i) => (
                  <Td key={f.key} className={i === 0 ? "font-medium text-neutral-900" : "text-neutral-600"}>
                    {renderCellValue(f, item.payload[f.key])}
                  </Td>
                ))}
                <Td>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${SYNC_BADGE[item.syncStatus]}`}>
                    {item.syncStatus}
                  </span>
                </Td>
                {!readOnly && (
                  <Td className="text-right">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => setModalItem(item)} className="text-neutral-400 hover:text-maroon" aria-label={`Edit row ${rowIndex + 1}`}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleteTarget(item)} className="text-neutral-400 hover:text-red-600" aria-label={`Delete row ${rowIndex + 1}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {result && result.total > result.pageSize && (
        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
          <span>
            Showing {(result.page - 1) * result.pageSize + 1}–{Math.min(result.page * result.pageSize, result.total)} of {result.total}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className="rounded-lg border border-neutral-300 p-1 text-neutral-500 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>
              Page {result.page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="rounded-lg border border-neutral-300 p-1 text-neutral-500 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {modalItem && (
        <GenericContentModal
          module={module}
          fields={fields}
          api={api}
          item={modalItem === "new" ? null : modalItem}
          onClose={() => setModalItem(null)}
          onSaved={() => {
            setModalItem(null);
            load();
          }}
        />
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={`Delete ${module.label.toLowerCase()}`}>
        <p className="text-sm text-neutral-600">This can't be undone.</p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function renderCellValue(field: FieldDef, value: unknown) {
  if (field.type === "image") {
    return value ? <img src={String(value)} alt="" className="h-10 w-10 rounded-lg object-cover" /> : "—";
  }
  if (field.type === "checkbox") {
    return (
      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${value ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
        {value ? "Yes" : "No"}
      </span>
    );
  }
  return value != null && value !== "" ? String(value) : "—";
}

// Shared field-by-field form inputs, used by both the list modal and the
// singleton (Contact Details) form below.
function FieldInputs({
  fields,
  values,
  onChange,
  api,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  api: WebsiteContentApi;
}) {
  const { showToast } = useToast();
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleImageSelect(key: string, file: File | null) {
    if (!file) return;
    setUploadingKey(key);
    try {
      const url = await api.uploadImage(file);
      onChange(key, url);
    } catch {
      showToast("Could not upload image.");
    } finally {
      setUploadingKey(null);
    }
  }

  return (
    <>
      {fields.map((f) => (
        <div key={f.key}>
          {f.type !== "checkbox" && (
            <label className="block text-sm font-medium text-neutral-700">
              {f.label}
              {"required" in f && f.required ? " *" : ""}
            </label>
          )}

          {f.type === "textarea" && (
            <textarea
              required={f.required}
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          )}

          {f.type === "select" && (
            <select
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            >
              <option value="">Select…</option>
              {f.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}

          {f.type === "checkbox" && (
            <label className="mt-1 flex items-center gap-2 text-sm font-medium text-neutral-700">
              <input
                type="checkbox"
                checked={values[f.key] === "true"}
                onChange={(e) => onChange(f.key, e.target.checked ? "true" : "")}
                className="h-4 w-4 rounded border-neutral-300 text-maroon focus:ring-maroon"
              />
              {f.label}
            </label>
          )}

          {f.type === "image" && (
            <div className="mt-1 flex items-center gap-3">
              {values[f.key] && <img src={values[f.key]} alt="" className="h-12 w-12 rounded-lg object-cover" />}
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50">
                <Upload className="h-4 w-4" />
                {uploadingKey === f.key ? "Uploading…" : values[f.key] ? "Replace image" : "Upload image"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImageSelect(f.key, e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          )}

          {f.key === "slug" && (
            <p className="mt-1 text-xs text-neutral-400">Auto-generated from the name if left blank.</p>
          )}

          {(f.type === "text" || f.type === "number" || f.type === "date") && (
            <input
              type={f.type}
              required={f.required}
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          )}
        </div>
      ))}
    </>
  );
}

function buildPayload(fields: FieldDef[], values: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.key] ?? "";
    if (f.type === "checkbox") {
      payload[f.key] = raw === "true";
    } else if (f.type === "number") {
      payload[f.key] = raw === "" ? undefined : Number(raw);
    } else {
      payload[f.key] = raw || undefined;
    }
  }
  return payload;
}

function valuesFromPayload(fields: FieldDef[], payload: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(
    fields.map((f) => {
      const raw = payload?.[f.key];
      if (f.type === "checkbox") return [f.key, raw ? "true" : ""];
      return [f.key, raw != null ? String(raw) : ""];
    })
  );
}

function GenericContentModal({
  module,
  fields,
  item,
  api,
  onClose,
  onSaved,
}: {
  module: ModuleInfo;
  fields: FieldDef[];
  item: WebsiteContentItem | null;
  api: WebsiteContentApi;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(() => valuesFromPayload(fields, item?.payload));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = buildPayload(fields, values);
      if (item) {
        await api.update(item.id, payload);
      } else {
        await api.create(payload);
      }
      onSaved();
    } catch (err) {
      const saved = extractSavedItem(err);
      if (saved) {
        showToast("Saved locally, but the external site couldn't be reached — will need a retry.");
        onSaved();
        return;
      }
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save.") : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${item ? "Edit" : "Add"} ${singularLabel(module)}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldInputs fields={fields} values={values} api={api} onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))} />

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SingletonContentTab({
  module,
  api,
  readOnly,
}: {
  module: ModuleInfo;
  api: WebsiteContentApi;
  readOnly: boolean;
}) {
  const { showToast } = useToast();
  const fields = module.fields;
  const [item, setItem] = useState<WebsiteContentItem | null | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const { items } = await api.list();
      const existing = items[0] ?? null;
      setItem(existing);
      setValues(valuesFromPayload(fields, existing?.payload));
    } catch {
      showToast(`Could not load ${module.label.toLowerCase()}.`);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module.key]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.create(buildPayload(fields, values));
      showToast(`${module.label} saved`);
      load();
    } catch (err) {
      const saved = extractSavedItem(err);
      if (saved) {
        showToast("Saved locally, but the external site couldn't be reached — will need a retry.");
        load();
        return;
      }
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save.") : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  }

  if (item === undefined) {
    return <p className="mt-4 text-sm text-neutral-400">Loading…</p>;
  }

  return (
    <div className="mt-4 max-w-xl space-y-4">
      {readOnly && <ReadOnlyBanner />}
      {!readOnly && (
        <div className="flex justify-end">
          <ImportButton api={api} onImported={load} />
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        {item && (
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${SYNC_BADGE[item.syncStatus]}`}>
            {item.syncStatus}
          </span>
        )}
        <fieldset disabled={readOnly} className="space-y-4">
          <FieldInputs fields={fields} values={values} api={api} onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))} />
        </fieldset>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {!readOnly && (
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        )}
      </form>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Pencil, Trash2, Plus, X } from "lucide-react";
import {
  listFeatureCatalog,
  createFeatureCatalogEntry,
  updateFeatureCatalogEntry,
  deleteFeatureCatalogEntry,
  type FeatureDefinition,
  type FieldDef,
} from "../../api/featureCatalog";
import { useToast } from "../../components/Toast";
import { Modal } from "../../components/Modal";
import { Button } from "../../components/Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "../../components/Table";

// Super-Admin-only: manage ONE business's own Feature catalog — this is
// what makes "unlimited custom features (Blogs, FAQs, Order Enquiries,
// ...) with zero code changes" a real, self-service capability rather than
// something only reachable via a direct API call. Since the tenant-scoping
// migration, every business has its own fully independent copy (built-ins
// included) — creating or editing a feature here can never affect any
// other business, even one using the exact same key. Reached from that
// business's own Business Detail page, not a global list.
const FIELD_TYPES: FieldDef["type"][] = ["text", "textarea", "number", "date", "image", "list", "repeater", "select", "checkbox"];

function fieldTypeLabel(type: FieldDef["type"]): string {
  switch (type) {
    case "text":
      return "Text";
    case "textarea":
      return "Long text";
    case "number":
      return "Number";
    case "date":
      return "Date";
    case "image":
      return "Image";
    case "list":
      return "List";
    case "repeater":
      return "Repeater (list of objects)";
    case "select":
      return "Dropdown";
    case "checkbox":
      return "Checkbox";
  }
}

// "key:Label" pairs, comma-separated — same compact convention as select's
// options input just below. e.g. "title:Title, description:Description"
// for a coreValues-style repeater.
function parseItemFieldsInput(raw: string): { key: string; label: string }[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [key, label] = part.split(":").map((s) => s.trim());
      return { key: key ?? "", label: label || key || "" };
    });
}

function itemFieldsToInput(itemFields: { key: string; label: string }[] | undefined): string {
  return (itemFields ?? []).map((f) => (f.label && f.label !== f.key ? `${f.key}:${f.label}` : f.key)).join(", ");
}

export default function FeatureCatalog() {
  const { id: tenantId } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [features, setFeatures] = useState<FeatureDefinition[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<"new" | FeatureDefinition | null>(null);

  async function load() {
    if (!tenantId) return;
    try {
      setFeatures(await listFeatureCatalog(tenantId));
    } catch {
      showToast("Could not load the feature catalog.", "error");
      setFeatures([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function handleDelete(feature: FeatureDefinition) {
    setBusyId(feature.id);
    try {
      await deleteFeatureCatalogEntry(feature.id);
      await load();
      showToast(`${feature.label} removed from the catalog`);
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not delete feature.") : "Could not delete feature.", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (!tenantId) return null;

  return (
    <div className="px-8 py-8">
      <Link to={`/super-admin/businesses/${tenantId}`} className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-maroon">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to business
      </Link>
      <div className="mt-3 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl text-neutral-900">Feature Catalog</h1>
          <p className="mt-1 text-sm text-neutral-500">
            The content types available to map to this business's website — Products, Categories, and any
            custom feature you add here (Blogs, FAQs, Order Enquiries, ...). This is this business's own
            independent copy — editing it never affects any other business.
          </p>
        </div>
        <Button onClick={() => setModalState("new")}>
          <Plus className="mr-1.5 h-4 w-4" /> New Feature
        </Button>
      </div>

      <div className="mt-6">
        {features === null ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : features.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-sm">
            No features yet.
          </div>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <Th>Feature</Th>
                <Th>Key</Th>
                <Th>Type</Th>
                <Th>Singleton</Th>
                <Th>Fields</Th>
                <Th></Th>
              </tr>
            </TableHead>
            <TableBody>
              {features.map((feature) => (
                <TableRow key={feature.id}>
                  <Td className="font-medium text-neutral-900">{feature.label}</Td>
                  <Td className="font-mono text-xs text-neutral-500">{feature.key}</Td>
                  <Td>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        feature.isBuiltIn ? "bg-neutral-100 text-neutral-600" : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {feature.isBuiltIn ? "Built-in" : "Custom"}
                    </span>
                  </Td>
                  <Td className="text-neutral-600">{feature.isSingleton ? "Yes" : "No"}</Td>
                  <Td className="text-neutral-600">{feature.fields.length}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setModalState(feature)}
                        aria-label={`Edit ${feature.label}`}
                        className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-maroon"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {!feature.isBuiltIn && (
                        <button
                          onClick={() => handleDelete(feature)}
                          disabled={busyId === feature.id}
                          aria-label={`Delete ${feature.label}`}
                          className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {modalState && (
        <FeatureModal
          tenantId={tenantId}
          feature={modalState === "new" ? null : modalState}
          onClose={() => setModalState(null)}
          onSaved={async () => {
            setModalState(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// Flat (non-discriminated) shape for the in-progress editor state — keeps
// `required`/`options` around regardless of the currently-selected type so
// switching a field's type back and forth doesn't lose data, and avoids
// TypeScript narrowing fights with FieldDef's discriminated union on every
// partial-patch update. Only converted to the strict FieldDef union (see
// toFieldDef) at submit time.
type FieldRow = {
  _uid: number;
  key: string;
  label: string;
  type: FieldDef["type"];
  required?: boolean;
  options?: string[];
  itemFields?: { key: string; label: string }[];
};

let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return uidCounter;
}

function blankFieldRow(): FieldRow {
  return { _uid: nextUid(), key: "", label: "", type: "text" };
}

function fieldRowsFrom(fields: FieldDef[]): FieldRow[] {
  return fields.map((f) => ({
    _uid: nextUid(),
    key: f.key,
    label: f.label,
    type: f.type,
    required: "required" in f ? f.required : undefined,
    options: "options" in f ? f.options : undefined,
    itemFields: "itemFields" in f ? f.itemFields : undefined,
  }));
}

function toFieldDef(row: FieldRow): FieldDef {
  if (row.type === "select") {
    return { key: row.key.trim(), label: row.label.trim(), type: "select", required: row.required, options: (row.options ?? []).filter((o) => o.trim()) };
  }
  if (row.type === "checkbox") {
    return { key: row.key.trim(), label: row.label.trim(), type: "checkbox" };
  }
  if (row.type === "repeater") {
    return {
      key: row.key.trim(),
      label: row.label.trim(),
      type: "repeater",
      required: row.required,
      itemFields: (row.itemFields ?? []).filter((f) => f.key.trim() && f.label.trim()),
    };
  }
  return { key: row.key.trim(), label: row.label.trim(), type: row.type, required: row.required };
}

function FeatureModal({
  tenantId,
  feature,
  onClose,
  onSaved,
}: {
  tenantId: string;
  feature: FeatureDefinition | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = feature !== null;
  const [key, setKey] = useState(feature?.key ?? "");
  const [label, setLabel] = useState(feature?.label ?? "");
  const [singularLabel, setSingularLabel] = useState(feature?.singularLabel ?? "");
  const [isSingleton, setIsSingleton] = useState(feature?.isSingleton ?? false);
  const [fieldRows, setFieldRows] = useState<FieldRow[]>(() => (feature ? fieldRowsFrom(feature.fields) : [blankFieldRow()]));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addFieldRow() {
    setFieldRows((rows) => [...rows, blankFieldRow()]);
  }

  function removeFieldRow(uid: number) {
    setFieldRows((rows) => rows.filter((r) => r._uid !== uid));
  }

  function updateFieldRow(uid: number, patch: Partial<FieldRow>) {
    setFieldRows((rows) => rows.map((r) => (r._uid === uid ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (fieldRows.length === 0) {
      setError("At least one field is required.");
      return;
    }
    for (const row of fieldRows) {
      if (!row.key.trim() || !row.label.trim()) {
        setError("Every field needs a key and a label.");
        return;
      }
      if (row.type === "select" && (!row.options || row.options.filter((o) => o.trim()).length === 0)) {
        setError(`Field "${row.label || row.key}" needs at least one dropdown option.`);
        return;
      }
      if (row.type === "repeater" && (!row.itemFields || row.itemFields.filter((f) => f.key.trim() && f.label.trim()).length === 0)) {
        setError(`Field "${row.label || row.key}" needs at least one sub-field.`);
        return;
      }
    }

    const fields = fieldRows.map(toFieldDef);

    setSaving(true);
    try {
      if (isEdit) {
        await updateFeatureCatalogEntry(feature.id, {
          label: label.trim(),
          singularLabel: singularLabel.trim() || null,
          isSingleton,
          fields,
        });
      } else {
        await createFeatureCatalogEntry(tenantId, {
          key: key.trim() || undefined,
          label: label.trim(),
          singularLabel: singularLabel.trim() || undefined,
          isSingleton,
          fields,
        });
      }
      onSaved();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save feature.") : "Could not save feature.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${feature.label}` : "New Feature"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700">Label</label>
          <input
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Order Enquiries"
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        {!isEdit && (
          <div>
            <label className="block text-sm font-medium text-neutral-700">Key</label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="Auto-generated from label if left blank"
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
            <p className="mt-1 text-xs text-neutral-400">Permanent once created — can't be changed later.</p>
          </div>
        )}
        {isEdit && (
          <div>
            <label className="block text-sm font-medium text-neutral-700">Key</label>
            <p className="mt-1 font-mono text-sm text-neutral-500">{feature.key}</p>
            {feature.isBuiltIn && (
              <p className="mt-1 text-xs text-neutral-400">
                Built-in — started from the shared starting-point template, but this is this business's own copy.
                Changes here are permanent and only ever apply to this business, even if you edit the same built-in
                feature for another business later.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-neutral-700">Singular label (optional)</label>
          <input
            type="text"
            value={singularLabel}
            onChange={(e) => setSingularLabel(e.target.value)}
            placeholder="e.g. Order Enquiry — used for '+ Add X'"
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={isSingleton} onChange={(e) => setIsSingleton(e.target.checked)} className="rounded border-neutral-300" />
          Singleton — at most one item per business (e.g. Contact Details)
        </label>

        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-neutral-700">Fields</label>
            <button
              type="button"
              onClick={addFieldRow}
              className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              + Add field
            </button>
          </div>

          <div className="mt-2 space-y-3">
            {fieldRows.map((row) => (
              <div key={row._uid} className="rounded-xl border border-neutral-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Field</span>
                  <button
                    type="button"
                    onClick={() => removeFieldRow(row._uid)}
                    aria-label="Remove field"
                    className="text-neutral-400 hover:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => updateFieldRow(row._uid, { key: e.target.value })}
                    placeholder="Field key (e.g. price)"
                    className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                  />
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateFieldRow(row._uid, { label: e.target.value })}
                    placeholder="Field label (e.g. Price)"
                    className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                  />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={row.type}
                    onChange={(e) => {
                      const type = e.target.value as FieldDef["type"];
                      if (type === "select") {
                        updateFieldRow(row._uid, { type, options: row.options ?? [""] });
                      } else if (type === "repeater") {
                        updateFieldRow(row._uid, {
                          type,
                          itemFields: row.itemFields ?? [
                            { key: "title", label: "Title" },
                            { key: "description", label: "Description" },
                          ],
                        });
                      } else {
                        updateFieldRow(row._uid, { type });
                      }
                    }}
                    className="rounded-lg border border-neutral-300 px-2 py-1 text-xs"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {fieldTypeLabel(t)}
                      </option>
                    ))}
                  </select>
                  {row.type !== "checkbox" && (
                    <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                      <input
                        type="checkbox"
                        checked={row.required ?? false}
                        onChange={(e) => updateFieldRow(row._uid, { required: e.target.checked })}
                        className="rounded border-neutral-300"
                      />
                      Required
                    </label>
                  )}
                </div>
                {row.type === "select" && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={row.options?.join(", ") ?? ""}
                      onChange={(e) => updateFieldRow(row._uid, { options: e.target.value.split(",").map((o) => o.trim()) })}
                      placeholder="Options, comma-separated (e.g. Small, Medium, Large)"
                      className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                    />
                  </div>
                )}
                {row.type === "repeater" && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={itemFieldsToInput(row.itemFields)}
                      onChange={(e) => updateFieldRow(row._uid, { itemFields: parseItemFieldsInput(e.target.value) })}
                      placeholder="Sub-fields, comma-separated as key:Label (e.g. title:Title, description:Description)"
                      className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                    />
                    <p className="mt-1 text-xs text-neutral-400">
                      Each item in this list will be an object with these text sub-fields — e.g. a "Core Values"
                      repeater with title:Title, description:Description sends [{"{"}"title": "...", "description": "..."{"}"}].
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

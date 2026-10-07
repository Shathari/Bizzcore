import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { Button } from "./Button";
import { lookupSaleCustomer, getPurchaseSummary, recordSale, getSaleCampaigns, type CampaignCandidate, type SaleCustomer, type PurchaseSummary } from "../api/purchases";
import { useToast } from "./Toast";

const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);
const errorMessage = (error: unknown) => axios.isAxiosError(error) ? error.response?.data?.error ?? "Could not save. Retry with the same sale details." : "Something went wrong. Please retry.";

export function SaleEntry({ customerId, onRecorded }: { customerId?: string; onRecorded?: () => void }) {
  const { showToast } = useToast();
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<SaleCustomer[]>([]);
  const [selectedId, setSelectedId] = useState(customerId ?? "");
  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignCandidate[]>([]);
  const [broadcastId, setBroadcastId] = useState("");
  const [redeemOffer, setRedeemOffer] = useState(false);
  const [offerCode, setOfferCode] = useState("");
  const [confirmedCode, setConfirmedCode] = useState("");
  const [campaignError, setCampaignError] = useState("");
  const [campaignLoading, setCampaignLoading] = useState(false);
  const campaignContext = useRef({ selectedId, date });
  campaignContext.current = { selectedId, date };
  const inFlight = useRef(false);
  const pending = useRef<{ payload: string; requestId: string } | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setSummary(null); setLoading(true); setError("");
    setAmount(""); setDate(""); pending.current = null;
    setBroadcastId(""); setRedeemOffer(false); setOfferCode(""); setConfirmedCode("");
    getPurchaseSummary(selectedId).then((data) => { if (active) setSummary(data); })
      .catch((err) => { if (active) setError(errorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setCampaigns([]); return; }
    let active = true; setCampaignLoading(true); setCampaignError("");
    setBroadcastId(""); setRedeemOffer(false); setConfirmedCode("");
    getSaleCampaigns(selectedId, date ? { purchasedAt: new Date(date).toISOString() } : {}).then((data) => { if (active) setCampaigns(data); })
      .catch(() => { if (active) { setCampaigns([]); setCampaignError("Campaigns unavailable. You can still record a walk-in sale."); } })
      .finally(() => { if (active) setCampaignLoading(false); });
    return () => { active = false; };
  }, [selectedId, date]);

  async function findOffer() {
    if (!selectedId || campaignLoading || saving) return;
    const lookupCustomer = selectedId;
    setCampaignLoading(true); setCampaignError("");
    setBroadcastId(""); setRedeemOffer(false); setConfirmedCode("");
    try {
      const result = await getSaleCampaigns(lookupCustomer, { offerCode: offerCode.trim().toUpperCase(), ...(date ? { purchasedAt: new Date(date).toISOString() } : {}) });
      if (campaignContext.current.selectedId !== lookupCustomer || campaignContext.current.date !== date) return;
      if (!result.length) throw new Error("No eligible offer");
      setCampaigns((previous) => [...previous.filter((c) => c.id !== result[0].id), result[0]]);
      setBroadcastId(result[0].id); setRedeemOffer(true); setConfirmedCode(result[0].offerCode ?? "");
    } catch { if (campaignContext.current.selectedId === lookupCustomer && campaignContext.current.date === date) setCampaignError("No eligible campaign offer found for this customer and date."); }
    finally { if (campaignContext.current.selectedId === lookupCustomer && campaignContext.current.date === date) setCampaignLoading(false); }
  }

  async function lookup(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setSummary(null); setMatches([]); setSelectedId("");
    try {
      const data = await lookupSaleCustomer(phone);
      setMatches(data.customers); setLookupMessage(data.message ?? "Select the customer for this sale.");
      if (data.customers.length === 1) setSelectedId(data.customers[0].id);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !summary) return;
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 1_000_000_000) {
      setError("Enter a positive amount with at most two decimal places."); return;
    }
    const input = { customerId: selectedId, amount: Number(amount), ...(date ? { purchasedAt: new Date(date).toISOString() } : {}), ...(broadcastId ? { broadcastId, redeemOffer, ...(confirmedCode && redeemOffer ? { offerCode: confirmedCode } : {}) } : {}) };
    const payload = JSON.stringify(input);
    if (pending.current?.payload !== payload) pending.current = { payload, requestId: crypto.randomUUID() };
    inFlight.current = true; setSaving(true); setError("");
    try {
      await recordSale({ ...input, requestId: pending.current.requestId });
      pending.current = null; setAmount(""); setDate(""); setBroadcastId(""); setRedeemOffer(false); setConfirmedCode(""); setOfferCode(""); showToast("Sale recorded."); onRecorded?.();
      try { setSummary(await getPurchaseSummary(selectedId)); }
      catch { setError("Sale saved. Could not refresh purchase history; reopen the customer."); }
    } catch (err) { setError(errorMessage(err)); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return <section className="space-y-4" aria-label="Purchase entry">
    <h2 className="font-serif text-lg text-neutral-900">Record Sale</h2>
    {!customerId && <form onSubmit={lookup} className="space-y-2">
      <label htmlFor="sale-phone" className="block text-sm font-medium">Customer phone number</label>
      <input id="sale-phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving || loading} placeholder="+91 98000 00000" className="w-full rounded-xl border p-3" />
      <Button type="submit" disabled={saving || loading}>{loading ? "Searching…" : "Find customer"}</Button>
      <p role="status" className="text-sm text-neutral-500">{lookupMessage}</p>
      {matches.length > 1 && <div className="flex flex-wrap gap-2">{matches.map((match) => <Button key={match.id} type="button" variant="secondary" disabled={saving} onClick={() => setSelectedId(match.id)}>{match.name || "Unnamed customer"} · {match.phoneMasked}</Button>)}</div>}
    </form>}
    {loading && customerId && <p role="status">Loading purchases…</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {summary && <>
      <p className="font-medium">{summary.customer.name || "Unnamed customer"} · {summary.customer.phoneMasked}</p>
      <p className="text-sm text-neutral-600">Total spending: {money(summary.customer.totalSpent)} · Recorded purchases: {summary.purchaseCount}</p>
      <p className="text-sm text-neutral-600">Last purchase: {summary.customer.lastPurchase ? new Date(summary.customer.lastPurchase).toLocaleString() : "Never"}</p>
      <form onSubmit={submit} className="space-y-3">
        <div><label htmlFor="sale-amount" className="block text-sm font-medium">Sale amount (₹)</label>
          <input id="sale-amount" type="number" min="0.01" max="1000000000" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} className="mt-1 w-full rounded-xl border p-3" /></div>
        <div><label htmlFor="sale-date" className="block text-sm font-medium">Purchase date (optional)</label>
          <input id="sale-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} disabled={saving} className="mt-1 w-full rounded-xl border p-3" />
          <p className="text-xs text-neutral-500">Leave blank to use the current time.</p></div>
        <div className="space-y-2">
          <label htmlFor="sale-campaign" className="block text-sm font-medium">WhatsApp campaign / offer (optional)</label>
          <select id="sale-campaign" value={broadcastId} disabled={saving || campaignLoading} onChange={(e) => { setBroadcastId(e.target.value); setRedeemOffer(false); setConfirmedCode(""); }} className="w-full rounded-xl border p-3">
            <option value="">No campaign / walk-in sale</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title} · Sent: {new Date(c.sentAt).toLocaleDateString()} · {c.offerEnabled ? c.offerCode ?? "Offer" : "No offer"}</option>)}
          </select>
          {campaignLoading && <p role="status" className="text-sm">Loading campaign offers…</p>}
          {campaignError && <p role="status" className="text-sm">{campaignError}</p>}
          {campaigns.find((c) => c.id === broadcastId)?.offerEnabled && <>
            <p className="text-sm">{campaigns.find((c) => c.id === broadcastId)?.offerDescription}</p>
            <label className="flex gap-2"><input type="checkbox" checked={redeemOffer} disabled={saving || !campaigns.find((c) => c.id === broadcastId)?.offerEligible} onChange={(e) => { setRedeemOffer(e.target.checked); setConfirmedCode(""); }} />Offer redeemed in store</label>
            {!campaigns.find((c) => c.id === broadcastId)?.offerEligible && <p className="text-sm">Offer is not valid for this purchase date. Campaign attribution is still available.</p>}
          </>}
          <label htmlFor="sale-offer-code" className="block text-sm">Offer code (optional)</label>
          <input id="sale-offer-code" value={offerCode} maxLength={40} disabled={saving || campaignLoading} onChange={(e) => setOfferCode(e.target.value)} className="w-full rounded-xl border p-3" />
          <Button type="button" variant="secondary" disabled={saving || campaignLoading || !offerCode.trim()} onClick={findOffer}>Find offer</Button>
          <p className="text-xs text-neutral-500">Choose a campaign only when the customer confirms it. Enter the final sale amount; discounts are handled at store billing.</p>
        </div>
        <Button type="submit" disabled={saving || campaignLoading}>{saving ? "Saving…" : "Save sale"}</Button>
      </form>
      <h3 className="font-medium">Purchase history</h3>
      {!summary.purchases.length && <p className="text-sm text-neutral-500">No recorded purchases yet.</p>}
      <ul className="max-h-52 space-y-2 overflow-y-auto">{summary.purchases.map((purchase) => <li key={purchase.id} className="flex justify-between gap-3 border-b pb-2 text-sm"><span>{new Date(purchase.purchasedAt).toLocaleString()}{purchase.broadcast && <span className="block">Campaign: {purchase.broadcast.title ?? "WhatsApp campaign"}{purchase.offerRedemption ? ` · Offer redeemed${purchase.offerRedemption.offerCode ? `: ${purchase.offerRedemption.offerCode}` : ""}` : ""}</span>}</span><span>{money(purchase.amount)}</span></li>)}</ul>
      {summary.historyLimited && <p className="text-xs text-neutral-500">Showing the latest 50 purchases.</p>}
    </>}
  </section>;
}

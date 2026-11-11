import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { can } from "@shared/rbac";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { usd } from "@/lib/format";
import { getOrder, isUuid } from "@/lib/orders";
import { getServiceClient } from "@/lib/supabase";

async function addNote(formData: FormData) {
  "use server";
  const actor = await requirePermission("customers.notes");
  const id = String(formData.get("order_id") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (!isUuid(id) || !body) return;
  const { error } = await getServiceClient().from("order_notes").insert({ order_id: id, author_id: actor.userId, author_email: actor.email, body });
  if (error) throw new Error(error.message);
  await audit(actor.userId, "order.note", "order", id, null, { length: body.length });
  revalidatePath(`/orders/${id}`);
}

// Re-runs the storefront's own CJ submission (which owns the supplier logic and
// refuses orders that already have a CJ order), so the OMS never duplicates it.
async function retryFulfillment(formData: FormData) {
  "use server";
  const actor = await requirePermission("fulfillment.manage");
  const id = String(formData.get("order_id") ?? "");
  if (!isUuid(id)) return;
  const base = process.env.STOREFRONT_URL?.replace(/\/$/, "");
  const secret = process.env.CJ_FULFILLMENT_SECRET;
  if (!base || !secret) redirect(`/orders/${id}?msg=${encodeURIComponent("STOREFRONT_URL / CJ_FULFILLMENT_SECRET are not set on the OMS.")}`);
  const { data: current } = await getServiceClient().from("orders").select("fulfillment_status, payment_status").eq("id", id).maybeSingle();
  if (!current || current.payment_status !== "paid" || !["failed", "pending"].includes(current.fulfillment_status)) {
    redirect(`/orders/${id}?msg=${encodeURIComponent("Only paid orders that are failed or pending can be retried.")}`);
  }
  let msg: string;
  try {
    const res = await fetch(`${base}/api/fulfillment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: id }),
      signal: AbortSignal.timeout(50_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    msg = res.ok ? "Resubmitted to the supplier." : `Supplier submission failed (${res.status}): ${json.error ?? "unknown error"}`;
    await audit(actor.userId, "order.retry_fulfillment", "order", id, { fulfillment_status: current.fulfillment_status }, { ok: res.ok, status: res.status });
  } catch {
    msg = "Could not reach the storefront fulfillment endpoint.";
    await audit(actor.userId, "order.retry_fulfillment", "order", id, null, { ok: false, reason: "unreachable" });
  }
  revalidatePath(`/orders/${id}`);
  redirect(`/orders/${id}?msg=${encodeURIComponent(msg)}`);
}

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const admin = await requirePermission("orders.view");
  const { id } = await params;
  const { msg } = await searchParams;
  const data = await getOrder(id);
  if (!data) notFound();
  const { order: o, lines, notes, timeline } = data;
  const money = can(admin.role, "finance.view");
  const ship = (o.shipping_details && typeof o.shipping_details === "object" ? o.shipping_details : null) as Record<string, unknown> | null;
  const canRetry = can(admin.role, "fulfillment.manage") && o.payment_status === "paid" && ["failed", "pending"].includes(o.fulfillment_status);
  return (
    <>
      <p><Link href="/orders">← Orders</Link></p>
      <h1>Order {o.id.slice(0, 8)}</h1>
      {msg && <p role="status"><strong>{msg}</strong></p>}
      <p>{o.customer_email ?? "—"} · {new Date(o.created_at).toLocaleString()} · {o.payment_status} · <strong>{usd(o.total_amount)}</strong></p>

      <h2>Fulfillment: {o.fulfillment_status}</h2>
      {o.fulfillment_error && <p style={{ color: "#b00020" }}>Error: {o.fulfillment_error}</p>}
      <p>
        Supplier order: {o.cj_order_id ?? "—"}<br />
        Tracking: {o.tracking_number ? (o.tracking_url ? <a href={o.tracking_url}>{o.tracking_carrier} {o.tracking_number}</a> : `${o.tracking_carrier ?? ""} ${o.tracking_number}`) : "—"}
      </p>
      {canRetry && (
        <form action={retryFulfillment}>
          <input type="hidden" name="order_id" value={o.id} />
          <button type="submit">Retry supplier submission</button>
        </form>
      )}

      <h2>Items</h2>
      <table cellPadding={6} style={{ background: "#fff" }}>
        <thead><tr><th align="left">Product</th><th>Qty</th><th align="right">Price</th>{money && <th align="right">Cost</th>}</tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.product_id}>
              <td>{l.name}</td><td align="center">{l.quantity}</td>
              <td align="right">${l.unit_price.toFixed(2)}</td>
              {money && <td align="right">{l.cost_price == null ? "—" : `$${l.cost_price.toFixed(2)}`}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {ship && (
        <>
          <h2>Ship to</h2>
          <pre style={{ background: "#fff", padding: 12, overflow: "auto" }}>{JSON.stringify(ship, null, 2)}</pre>
        </>
      )}

      <h2>Timeline</h2>
      <ul>
        {timeline.map((t, i) => (
          <li key={i}>{new Date(t.at).toLocaleString()} — {t.label}{t.detail ? <><br /><small>{t.detail}</small></> : null}</li>
        ))}
      </ul>

      {can(admin.role, "customers.notes") && (
        <>
          <h2>Add internal note</h2>
          <form action={addNote} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
            <input type="hidden" name="order_id" value={o.id} />
            <textarea name="body" rows={3} maxLength={2000} required />
            <button type="submit">Add note</button>
          </form>
        </>
      )}
      <small>{notes.length} note(s)</small>
    </>
  );
}

import "server-only";
import { getServiceClient } from "./supabase";

export const PAGE_SIZE = 25;
export const FULFILLMENT_STATUSES = ["pending", "submitting", "processing", "shipped", "failed"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

export interface OrderRow {
  id: string;
  customer_email: string | null;
  total_amount: number;
  payment_status: string;
  fulfillment_status: string;
  fulfillment_error: string | null;
  fulfillment_submitted_at: string | null;
  cj_order_id: string | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  tracking_url: string | null;
  shipped_at: string | null;
  shipping_details: unknown;
  currency: string;
  created_at: string;
}

const LIST_COLS =
  "id, customer_email, total_amount, payment_status, fulfillment_status, fulfillment_error, created_at, currency, tracking_number";

export async function listOrders(opts: { fulfillment?: string; payment?: string; q?: string; page: number }) {
  let query = getServiceClient()
    .from("orders")
    .select(LIST_COLS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((opts.page - 1) * PAGE_SIZE, opts.page * PAGE_SIZE - 1);
  if (opts.fulfillment && (FULFILLMENT_STATUSES as readonly string[]).includes(opts.fulfillment)) {
    query = query.eq("fulfillment_status", opts.fulfillment);
  }
  if (opts.payment === "paid" || opts.payment === "unpaid") query = query.eq("payment_status", opts.payment);
  const q = opts.q?.trim();
  if (q) {
    if (isUuid(q)) query = query.eq("id", q);
    else query = query.ilike("customer_email", `%${q.replace(/[%_\\,()]/g, "")}%`);
  }
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as Partial<OrderRow>[], total: count ?? 0 };
}

export interface TimelineEntry { at: string; label: string; detail?: string }

export async function getOrder(id: string) {
  if (!isUuid(id)) return null;
  const db = getServiceClient();
  const { data: order, error } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;
  const o = order as unknown as OrderRow;

  const { data: items } = await db.from("order_items").select("product_id, quantity, unit_price").eq("order_id", id);
  const productIds = [...new Set((items ?? []).map((i) => String(i.product_id)))];
  const { data: products } = productIds.length
    ? await db.from("products").select("id, name, cost_price").in("id", productIds)
    : { data: [] as { id: string; name: string | null; cost_price: number | null }[] };
  const byId = new Map((products ?? []).map((p) => [String(p.id), p]));
  const lines = (items ?? []).map((i) => {
    const p = byId.get(String(i.product_id));
    return {
      product_id: String(i.product_id),
      name: p?.name ?? "(deleted product)",
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      cost_price: p?.cost_price == null ? null : Number(p.cost_price),
    };
  });

  const { data: notes } = await db.from("order_notes").select("id, author_email, body, kind, created_at").eq("order_id", id).order("created_at", { ascending: false });
  const { data: audits } = await db.from("audit_log").select("at, actor_email, action, after").eq("entity_type", "order").eq("entity_id", id).order("at", { ascending: false }).limit(50);

  const timeline: TimelineEntry[] = [{ at: o.created_at, label: `Order placed (${o.payment_status})` }];
  if (o.fulfillment_submitted_at) timeline.push({ at: o.fulfillment_submitted_at, label: "Submitted to supplier", detail: o.cj_order_id ?? undefined });
  if (o.shipped_at) timeline.push({ at: o.shipped_at, label: "Shipped", detail: [o.tracking_carrier, o.tracking_number].filter(Boolean).join(" ") || undefined });
  for (const a of audits ?? []) timeline.push({ at: a.at, label: `${a.action} by ${a.actor_email ?? "unknown"}`, detail: a.after ? JSON.stringify(a.after) : undefined });
  for (const n of notes ?? []) timeline.push({ at: n.created_at, label: `${n.kind === "customer_contact" ? "Customer contact" : "Note"} by ${n.author_email ?? "unknown"}`, detail: n.body });
  timeline.sort((a, b) => +new Date(b.at) - +new Date(a.at));

  const { data: returns } = await db.from("order_returns").select("id, status, reason, requested_amount_cents, created_at").eq("order_id", id).order("created_at", { ascending: false });
  const { data: refunds } = await db.from("order_refunds").select("id, amount_cents, status, error, created_by_email, created_at").eq("order_id", id).order("created_at", { ascending: false });
  for (const r of refunds ?? []) timeline.push({ at: r.created_at, label: `Refund ${r.status} by ${r.created_by_email ?? "unknown"}`, detail: `$${(Number(r.amount_cents) / 100).toFixed(2)}${r.error ? ` — ${r.error}` : ""}` });
  for (const r of returns ?? []) timeline.push({ at: r.created_at, label: `Return ${r.status}`, detail: r.reason });
  timeline.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  const refundedCents = (refunds ?? []).filter((r) => r.status === "succeeded").reduce((n, r) => n + Number(r.amount_cents), 0);
  const heldCents = (refunds ?? []).filter((r) => r.status === "pending").reduce((n, r) => n + Number(r.amount_cents), 0);

  return { order: o, lines, notes: notes ?? [], timeline, returns: returns ?? [], refunds: refunds ?? [], refundedCents, heldCents };
}

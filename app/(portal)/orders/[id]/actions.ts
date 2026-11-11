"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { isUuid } from "@/lib/orders";
import { createStripeRefund } from "@/lib/stripe";
import { getServiceClient } from "@/lib/supabase";

const back = (id: string, msg: string) => redirect(`/orders/${id}?msg=${encodeURIComponent(msg)}`);
const dollarsToCents = (v: string): number | null =>
  /^\d{1,7}(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : null;

export async function logContact(formData: FormData) {
  const actor = await requirePermission("customers.notes");
  const id = String(formData.get("order_id") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (!isUuid(id) || !body) return;
  const { error } = await getServiceClient().from("order_notes").insert({ order_id: id, author_id: actor.userId, author_email: actor.email, body, kind: "customer_contact" });
  if (error) throw new Error(error.message);
  await audit(actor.userId, "order.customer_contact", "order", id, null, { length: body.length });
  revalidatePath(`/orders/${id}`);
}

export async function createReturn(formData: FormData) {
  const actor = await requirePermission("returns.manage");
  const id = String(formData.get("order_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const amountRaw = String(formData.get("amount") ?? "").trim();
  if (!isUuid(id) || !reason) return;
  const cents = amountRaw ? dollarsToCents(amountRaw) : null;
  if (amountRaw && cents === null) back(id, "Enter the amount as dollars, e.g. 12.50.");
  const { error } = await getServiceClient().from("order_returns").insert({
    order_id: id, reason, requested_amount_cents: cents, created_by: actor.userId, created_by_email: actor.email,
  });
  if (error) throw new Error(error.message);
  await audit(actor.userId, "return.create", "order", id, null, { reason: reason.slice(0, 200), cents });
  revalidatePath(`/orders/${id}`);
}

const NEXT: Record<string, string[]> = { requested: ["approved", "rejected"], approved: ["received", "closed"], received: ["closed"] };

export async function setReturnStatus(formData: FormData) {
  const actor = await requirePermission("returns.manage");
  const id = String(formData.get("order_id") ?? "");
  const returnId = Number(formData.get("return_id"));
  const status = String(formData.get("status") ?? "");
  if (!isUuid(id) || !Number.isInteger(returnId)) return;
  const db = getServiceClient();
  const { data: ret } = await db.from("order_returns").select("status").eq("id", returnId).eq("order_id", id).maybeSingle();
  if (!ret || !(NEXT[ret.status] ?? []).includes(status)) back(id, "That status change isn't allowed.");
  const { error } = await db.from("order_returns").update({ status, updated_at: new Date().toISOString() }).eq("id", returnId).eq("status", ret!.status);
  if (error) throw new Error(error.message);
  await audit(actor.userId, "return.status", "order", id, { status: ret!.status }, { status, returnId });
  revalidatePath(`/orders/${id}`);
}

async function settle(actor: { userId: string }, orderId: string, refundId: string, amountCents: number) {
  const db = getServiceClient();
  const { data: order } = await db.from("orders").select("stripe_session_id").eq("id", orderId).maybeSingle();
  if (!order?.stripe_session_id) {
    await db.rpc("finish_refund", { p_id: refundId, p_status: "failed", p_stripe_refund_id: null, p_error: "Order has no Stripe session." });
    return "This order has no Stripe payment to refund.";
  }
  const r = await createStripeRefund({ sessionId: order.stripe_session_id, amountCents, refundRowId: refundId, orderId });
  if (r.ok) {
    await db.rpc("finish_refund", { p_id: refundId, p_status: "succeeded", p_stripe_refund_id: r.refundId, p_error: null });
    await audit(actor.userId, "refund.succeeded", "order", orderId, null, { refundId, amountCents, stripeRefundId: r.refundId });
    return `Refunded $${(amountCents / 100).toFixed(2)}.`;
  }
  if (r.definitive) {
    await db.rpc("finish_refund", { p_id: refundId, p_status: "failed", p_stripe_refund_id: null, p_error: r.error });
    await audit(actor.userId, "refund.failed", "order", orderId, null, { refundId, amountCents, error: r.error });
    return `Refund failed: ${r.error}`;
  }
  await audit(actor.userId, "refund.unknown", "order", orderId, null, { refundId, amountCents, error: r.error });
  return `Refund outcome unknown (${r.error}). It is held as pending; use "Retry pending refund" to safely re-check.`;
}

export async function issueRefund(formData: FormData) {
  const actor = await requirePermission("orders.refund");
  const id = String(formData.get("order_id") ?? "");
  const cents = dollarsToCents(String(formData.get("amount") ?? ""));
  const returnRaw = String(formData.get("return_id") ?? "");
  const returnId = returnRaw ? Number(returnRaw) : null;
  if (!isUuid(id)) return;
  if (!cents || cents <= 0) back(id, "Enter a refund amount in dollars, e.g. 12.50.");
  const { data: refundId, error } = await getServiceClient().rpc("reserve_refund", {
    p_order_id: id, p_amount_cents: cents, p_return_id: returnId, p_actor: actor.userId, p_email: actor.email,
  });
  if (error || !refundId) {
    const m = error?.message ?? "";
    back(id, m.includes("exceeds_refundable") ? "That is more than the remaining refundable amount." : m.includes("order_not_paid") ? "Only paid orders can be refunded." : "Could not start the refund.");
  }
  await audit(actor.userId, "refund.requested", "order", id, null, { refundId, cents, returnId });
  const msg = await settle(actor, id, String(refundId), cents!);
  revalidatePath(`/orders/${id}`);
  back(id, msg);
}

export async function retryPendingRefund(formData: FormData) {
  const actor = await requirePermission("orders.refund");
  const id = String(formData.get("order_id") ?? "");
  const refundId = String(formData.get("refund_id") ?? "");
  if (!isUuid(id) || !isUuid(refundId)) return;
  const { data: row } = await getServiceClient().from("order_refunds").select("amount_cents, status").eq("id", refundId).eq("order_id", id).maybeSingle();
  if (!row || row.status !== "pending") back(id, "That refund is no longer pending.");
  const msg = await settle(actor, id, refundId, Number(row!.amount_cents));
  revalidatePath(`/orders/${id}`);
  back(id, msg);
}

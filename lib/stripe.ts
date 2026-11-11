import "server-only";

export type RefundResult =
  | { ok: true; refundId: string }
  | { ok: false; definitive: boolean; error: string };

const API = "https://api.stripe.com/v1";

function auth(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? `Basic ${Buffer.from(`${key}:`).toString("base64")}` : null;
}

/**
 * Refunds part of a Checkout payment. `refundRowId` is sent as Stripe's
 * Idempotency-Key, so repeating the call for the same row can never refund twice.
 * `definitive: false` means we don't know the outcome (network/5xx): leave the
 * refund pending and retry with the same row.
 */
export async function createStripeRefund(p: {
  sessionId: string;
  amountCents: number;
  refundRowId: string;
  orderId: string;
}): Promise<RefundResult> {
  const header = auth();
  if (!header) return { ok: false, definitive: true, error: "STRIPE_SECRET_KEY is not set on the OMS." };
  try {
    const sres = await fetch(`${API}/checkout/sessions/${encodeURIComponent(p.sessionId)}`, {
      headers: { Authorization: header },
      signal: AbortSignal.timeout(20_000),
    });
    if (!sres.ok) {
      return { ok: false, definitive: sres.status < 500 && sres.status !== 429, error: `Could not load the Stripe session (${sres.status}).` };
    }
    const session = (await sres.json()) as { payment_intent?: string | null };
    if (!session.payment_intent) return { ok: false, definitive: true, error: "This Stripe session has no payment to refund." };

    const body = new URLSearchParams({
      payment_intent: session.payment_intent,
      amount: String(p.amountCents),
      reason: "requested_by_customer",
      "metadata[order_id]": p.orderId,
      "metadata[refund_row_id]": p.refundRowId,
    });
    const res = await fetch(`${API}/refunds`, {
      method: "POST",
      headers: {
        Authorization: header,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `oms-refund-${p.refundRowId}`,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message?: string } };
    if (res.ok && json.id && json.status !== "failed" && json.status !== "canceled") return { ok: true, refundId: json.id };
    if (res.ok) return { ok: false, definitive: true, error: `Stripe refund status: ${json.status}` };
    return {
      ok: false,
      definitive: res.status < 500 && res.status !== 429 && res.status !== 409,
      error: json.error?.message ?? `Stripe error ${res.status}`,
    };
  } catch {
    return { ok: false, definitive: false, error: "Could not reach Stripe; outcome unknown." };
  }
}

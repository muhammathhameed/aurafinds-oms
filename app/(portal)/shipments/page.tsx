import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";

export default async function ShipmentsPage() {
  await requirePermission("orders.view");
  const { data } = await getServiceClient()
    .from("orders")
    .select("id, customer_email, fulfillment_status, fulfillment_submitted_at, shipped_at, tracking_number, tracking_carrier, tracking_url")
    .eq("payment_status", "paid")
    .in("fulfillment_status", ["processing", "shipped"])
    .order("fulfillment_submitted_at", { ascending: true, nullsFirst: true })
    .limit(200);
  const now = Date.now();
  const days = (t: string | null) => (t ? Math.floor((now - new Date(t).getTime()) / 86_400_000) : null);
  return (
    <>
      <h1>Shipments in progress</h1>
      <p>Tracking is pulled from CJ by the storefront&apos;s hourly sync. Orders with no tracking after 5 days are also raised as alerts.</p>
      <table cellPadding={6} style={{ background: "#fff" }}>
        <thead><tr><th align="left">Order</th><th align="left">Customer</th><th>Status</th><th>Days since submitted</th><th align="left">Tracking</th></tr></thead>
        <tbody>
          {(data ?? []).map((o) => {
            const d = days(o.fulfillment_submitted_at);
            const late = o.fulfillment_status === "processing" && !o.tracking_number && d !== null && d >= 5;
            return (
              <tr key={o.id} style={{ background: late ? "#fff4e5" : undefined }}>
                <td><Link href={`/orders/${o.id}`}>{String(o.id).slice(0, 8)}</Link></td>
                <td>{o.customer_email ?? "—"}</td>
                <td align="center">{o.fulfillment_status}</td>
                <td align="center">{d ?? "—"}</td>
                <td>{o.tracking_number ? (o.tracking_url ? <a href={o.tracking_url}>{o.tracking_carrier} {o.tracking_number}</a> : `${o.tracking_carrier ?? ""} ${o.tracking_number}`) : "none yet"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

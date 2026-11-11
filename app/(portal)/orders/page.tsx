import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { usd } from "@/lib/format";
import { FULFILLMENT_STATUSES, PAGE_SIZE, listOrders } from "@/lib/orders";

type SP = { status?: string; payment?: string; q?: string; page?: string };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("orders.view");
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { rows, total } = await listOrders({ fulfillment: sp.status, payment: sp.payment, q: sp.q, page });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => {
    const u = new URLSearchParams();
    if (sp.status) u.set("status", sp.status);
    if (sp.payment) u.set("payment", sp.payment);
    if (sp.q) u.set("q", sp.q);
    u.set("page", String(p));
    return `/orders?${u}`;
  };
  return (
    <>
      <h1>Orders</h1>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input name="q" defaultValue={sp.q} placeholder="Email or order ID" />
        <select name="status" defaultValue={sp.status ?? ""}>
          <option value="">Any fulfillment</option>
          {FULFILLMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="payment" defaultValue={sp.payment ?? ""}>
          <option value="">Any payment</option><option value="paid">paid</option><option value="unpaid">unpaid</option>
        </select>
        <button type="submit">Filter</button>
      </form>
      <p>{total} order(s)</p>
      <table cellPadding={6} style={{ background: "#fff", borderRadius: 8 }}>
        <thead><tr><th align="left">Order</th><th align="left">Placed</th><th align="left">Customer</th><th align="right">Total</th><th>Payment</th><th>Fulfillment</th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/orders/${o.id}`}>{String(o.id).slice(0, 8)}</Link></td>
              <td>{o.created_at ? new Date(o.created_at).toLocaleString() : ""}</td>
              <td>{o.customer_email ?? "—"}</td>
              <td align="right">{usd(o.total_amount)}</td>
              <td align="center">{o.payment_status}</td>
              <td align="center" style={{ color: o.fulfillment_status === "failed" ? "#b00020" : undefined }}>{o.fulfillment_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {page > 1 && <Link href={link(page - 1)}>← Newer</Link>} Page {page} of {pages} {page < pages && <Link href={link(page + 1)}>Older →</Link>}
      </p>
    </>
  );
}

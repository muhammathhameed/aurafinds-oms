import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { usd } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase";

interface Row { email: string; orders: number; spend: number; last: string }

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("customers.view");
  const sp = await searchParams;
  const q = sp.q?.trim().replace(/[%_*,()\\]/g, "");
  let query = getServiceClient().from("orders").select("customer_email, total_amount, created_at").eq("payment_status", "paid").not("customer_email", "is", null).order("created_at", { ascending: false }).limit(2000);
  if (q) query = query.ilike("customer_email", `%${q}%`);
  const { data } = await query;
  const byEmail = new Map<string, Row>();
  for (const o of data ?? []) {
    const email = String(o.customer_email).toLowerCase();
    const r = byEmail.get(email) ?? { email, orders: 0, spend: 0, last: o.created_at };
    r.orders += 1;
    r.spend += Number(o.total_amount);
    byEmail.set(email, r);
  }
  const rows = [...byEmail.values()].sort((a, b) => b.spend - a.spend).slice(0, 100);
  return (
    <>
      <h1>Customers</h1>
      <p>Built from paid orders (the latest 2,000). Click a customer to see their orders.</p>
      <form style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input name="q" defaultValue={sp.q} placeholder="Search email" />
        <button type="submit">Search</button>
      </form>
      <table cellPadding={6} style={{ background: "#fff" }}>
        <thead><tr><th align="left">Email</th><th>Orders</th><th align="right">Spend</th><th align="left">Last order</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email}>
              <td><Link href={`/orders?q=${encodeURIComponent(r.email)}`}>{r.email}</Link></td>
              <td align="center">{r.orders}</td><td align="right">{usd(r.spend)}</td><td>{new Date(r.last).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

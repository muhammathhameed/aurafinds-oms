import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@shared/rbac";
import { usd } from "@/lib/format";
import { getKpis, type Kpis } from "@/lib/ops";
import { getServiceClient } from "@/lib/supabase";

const RANGES = [7, 30, 90];
const card = { background: "#fff", borderRadius: 10, padding: 16 } as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string; denied?: string }> }) {
  const admin = await requirePermission("dashboard.view");
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  let kpis: Kpis;
  try {
    kpis = await getKpis(days);
  } catch (e) {
    console.error("dashboard kpis failed", e);
    return (
      <>
        <h1>Operations dashboard</h1>
        <p role="alert">
          The dashboard database functions are missing. Apply
          supabase/migrations/20261110000200_oms_dashboard.sql in the Supabase SQL editor, then reload.
        </p>
      </>
    );
  }
  const money = can(admin.role, "finance.view");

  const { data: alerts } = await getServiceClient()
    .from("ops_alerts")
    .select("id, severity, title, entity_type, entity_id, last_seen, status")
    .in("status", ["open", "acknowledged"])
    .order("severity", { ascending: true }) // 'critical','high','low','medium' is alphabetical; re-sorted below
    .order("last_seen", { ascending: false })
    .limit(50);
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const top = (alerts ?? []).sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 8);

  const f = kpis.fulfillment;
  const profit = kpis.items_revenue_cents - kpis.items_cost_cents;
  return (
    <>
      <h1>Operations dashboard</h1>
      {sp.denied && <p role="alert">You don&apos;t have access to that page.</p>}
      <p>
        Last{" "}
        {RANGES.map((r) => (
          <Link key={r} href={`/?days=${r}`} style={{ marginRight: 8, fontWeight: r === days ? 700 : 400 }}>{r}d</Link>
        ))}
      </p>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <div style={card}><small>Paid orders</small><h2>{kpis.paid_orders}</h2></div>
        {money && <div style={card}><small>Revenue (incl. shipping/tax)</small><h2>{usd(kpis.revenue_cents)}</h2></div>}
        {money && <div style={card}><small>Avg order</small><h2>{usd(kpis.avg_order_cents)}</h2></div>}
        {money && (
          <div style={card}>
            <small>Gross profit on items</small><h2>{usd(profit)}</h2>
            <small>Uses current product cost.{kpis.lines_without_cost > 0 && ` ${kpis.lines_without_cost} line(s) have no cost and are excluded.`}</small>
          </div>
        )}
        <div style={card}><small>Awaiting supplier</small><h2>{(f.pending ?? 0) + (f.submitting ?? 0)}</h2></div>
        <div style={card}><small>With supplier</small><h2>{f.processing ?? 0}</h2></div>
        <div style={card}><small>Shipped</small><h2>{f.shipped ?? 0}</h2></div>
        <div style={{ ...card, color: (f.failed ?? 0) > 0 ? "#b00020" : undefined }}><small>Failed fulfillment</small><h2>{f.failed ?? 0}</h2></div>
      </section>
      <h2>Open alerts</h2>
      {top.length === 0 ? <p>Nothing needs attention.</p> : (
        <ul>
          {top.map((a) => (
            <li key={a.id}><strong>{a.severity}</strong> · {a.title} · {a.entity_type} {String(a.entity_id).slice(0, 8)}{a.status === "acknowledged" ? " (acknowledged)" : ""}</li>
          ))}
        </ul>
      )}
      <p><Link href="/alerts">All alerts →</Link></p>
    </>
  );
}

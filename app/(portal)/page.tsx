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
      <div className="card badge-critical" style={{ padding: 24, border: "1px solid var(--critical)" }}>
        <h1 style={{ margin: "0 0 12px 0", fontSize: 20 }}>System Initialization Required</h1>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          The dashboard database functions are missing. Apply 
          <code style={{ background: "rgba(0,0,0,0.1)", padding: "2px 4px", borderRadius: 4 }}>supabase/migrations/20261110000200_oms_dashboard.sql</code> 
          in the Supabase SQL editor, then reload this page.
        </p>
      </div>
    );
  }
  const money = can(admin.role, "finance.view");

  const { data: alerts } = await getServiceClient()
    .from("ops_alerts")
    .select("id, severity, title, entity_type, entity_id, last_seen, status")
    .in("status", ["open", "acknowledged"])
    .order("severity", { ascending: true })
    .order("last_seen", { ascending: false })
    .limit(50);
  
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const severityColor: Record<string, string> = { critical: "#ef4444", high: "#f59e0b", medium: "#6366f1", low: "#64748b" };
  const top = (alerts ?? []).sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 8);

  const f = kpis.fulfillment;
  const profit = kpis.items_revenue_cents - kpis.items_cost_cents;

  return (
    <div style={{ display: "grid", gap: 32 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, color: "#0f172a" }}>Operations Overview</h1>
          <p style={{ margin: "8px 0 0 0", color: "#64748b", fontWeight: 500 }}>Welcome back, {admin.email.split('@')[0]}</p>
        </div>
        
        <div style={{ display: "flex", background: "#fff", padding: 4, borderRadius: 10, border: "1px solid #e2e8f0" }}>
          {RANGES.map((r) => (
            <Link 
              key={r} 
              href={`/?days=${r}`} 
              style={{ 
                padding: "6px 16px", 
                borderRadius: 8, 
                fontSize: 13, 
                fontWeight: 600, 
                textDecoration: "none",
                background: r === days ? "#0f172a" : "transparent",
                color: r === days ? "#fff" : "#64748b",
                transition: "all 0.2s"
              }}
            >
              {r} days
            </Link>
          ))}
        </div>
      </header>
      {sp.denied && (
        <div className="badge-critical" style={{ padding: "12px 20px", borderRadius: 8, fontSize: 14, fontWeight: 500 }}>
          Access Denied: You do not have permission to view the requested resource.
        </div>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20 }}>
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <small style={{ color: "#64748b", fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>Paid orders</small>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{kpis.paid_orders}</h2>
        </div>
        {money && (
          <>
            <div className="card" style={{ display: "grid", gap: 8 }}>
              <small style={{ color: "#64748b", fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>Total Revenue</small>
              <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#059669" }}>{usd(kpis.revenue_cents)}</h2>
            </div>
            <div className="card" style={{ display: "grid", gap: 8 }}>
              <small style={{ color: "#64748b", fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>Gross Profit</small>
              <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{usd(profit)}</h2>
            </div>
          </>
        )}
        <div className="card" style={{ display: "grid", gap: 8, borderLeft: "4px solid #f59e0b" }}>
          <small style={{ color: "#64748b", fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>Awaiting Supplier</small>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{(f.pending ?? 0) + (f.submitting ?? 0)}</h2>
        </div>
        <div className="card" style={{ display: "grid", gap: 8, borderLeft: "4px solid #6366f1" }}>
          <small style={{ color: "#64748b", fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>Fulfillment</small>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{f.shipped ?? 0} <span style={{ fontSize: 14, color: "#64748b", fontWeight: 500 }}>shipped</span></h2>
        </div>
        <div className="card" style={{ display: "grid", gap: 8, borderLeft: `4px solid ${ (f.failed ?? 0) > 0 ? "#ef4444" : "#e2e8f0" }` }}>
          <small style={{ color: "#64748b", fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>Issues</small>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: (f.failed ?? 0) > 0 ? "#ef4444" : "inherit" }}>{f.failed ?? 0}</h2>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 32, alignItems: "start" }}>
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Priority Alerts</h2>
            <Link href="/alerts" style={{ fontSize: 13, fontWeight: 600, color: "#6366f1", textDecoration: "none" }}>View all</Link>
          </div>
          
          {top.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8" }}>
              <p style={{ margin: 0, fontSize: 14 }}>All systems operational. No open alerts.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {top.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", borderRadius: 10, background: "#f8fafc", border: "1px solid #f1f5f9" }}>
                  <span className="badge" style={{ minWidth: 70, textAlign: "center", background: `${severityColor[a.severity]}20`, color: severityColor[a.severity] }}>{a.severity}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1e293b" }}>{a.title}</p>
                    <small style={{ color: "#64748b", fontSize: 12 }}>{a.entity_type} • {String(a.entity_id).slice(0, 8)}</small>
                  </div>
                  {a.status === "acknowledged" && <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase" }}>ACK</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card" style={{ background: "#0f172a", color: "#fff" }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700 }}>Quick Stats</h3>
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 12 }}>
              <span style={{ color: "#94a3b8", fontSize: 13 }}>Processing</span>
              <span style={{ fontWeight: 700 }}>{f.processing ?? 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 12 }}>
              <span style={{ color: "#94a3b8", fontSize: 13 }}>Avg Order Value</span>
              <span style={{ fontWeight: 700 }}>{usd(kpis.avg_order_cents)}</span>
            </div>
            <div style={{ background: "rgba(99,102,241,0.1)", padding: 16, borderRadius: 8, border: "1px solid rgba(99,102,241,0.2)" }}>
              <p style={{ margin: 0, fontSize: 12, color: "#818cf8", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>System Status</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="animate-pulse-glow" style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>All Services Online</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

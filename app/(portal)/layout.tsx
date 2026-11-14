import type { ReactNode } from "react";
import Link from "next/link";
import { can, type Permission } from "@shared/rbac";
import { requirePermission } from "@/lib/auth";
import { getSessionClient } from "@/lib/supabase";
import { redirect } from "next/navigation";

const NAV: { href: string; label: string; perm: Permission }[] = [
  { href: "/", label: "Dashboard", perm: "dashboard.view" },
  { href: "/orders", label: "Orders", perm: "orders.view" },
  { href: "/shipments", label: "Shipments", perm: "orders.view" },
  { href: "/suppliers", label: "Suppliers", perm: "suppliers.view" },
  { href: "/alerts", label: "Alerts", perm: "alerts.view" },
  { href: "/customers", label: "Customers", perm: "customers.view" },
  { href: "/assistant", label: "Assistant", perm: "assistant.use" },
  { href: "/audit", label: "Audit log", perm: "audit.view" },
  { href: "/admins", label: "Admins", perm: "admins.manage" },
];

async function signOut() {
  "use server";
  await (await getSessionClient()).auth.signOut();
  redirect("/login");
}

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const admin = await requirePermission("dashboard.view");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", minHeight: "100vh", background: "#f8fafc" }}>
      {/* Sidebar */}
      <nav style={{ background: "#0f172a", color: "#fff", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 32, borderRight: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ padding: "0 12px" }}>
          <strong style={{ fontSize: 20, fontWeight: 800, background: "linear-gradient(to right, #6366f1, #22d3ee)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AuraFinds</strong>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {NAV.filter((n) => can(admin.role, n.perm)).map((n) => (
            <Link 
              key={n.href} 
              href={n.href} 
              style={{ 
                padding: "10px 12px", 
                borderRadius: 8, 
                color: "#94a3b8", 
                textDecoration: "none", 
                fontSize: 14, 
                fontWeight: 500, 
                transition: "all 0.2s" 
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94a3b8"; }}
            >
              {n.label}
            </Link>
          ))}
        </div>

        <form action={signOut} style={{ marginTop: "auto", padding: "20px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#fff" }}>{admin.email.split('@')[0]}</p>
            <span className="badge" style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8", fontSize: 10, marginTop: 4, display: "inline-block" }}>{admin.role.replace('_', ' ')}</span>
          </div>
          <button 
            type="submit" 
            style={{ width: "100%", padding: "8px", borderRadius: 6, background: "transparent", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)", fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" }}
          >
            Sign out
          </button>
        </form>
      </nav>

      {/* Main Content */}
      <main style={{ padding: "40px 60px", overflowY: "auto" }}>
        <div className="animate-slide">
          {children}
        </div>
      </main>
    </div>
  );
}

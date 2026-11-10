import type { ReactNode } from "react";
import Link from "next/link";
import { can, type Permission } from "@shared/rbac";
import { requirePermission } from "@/lib/auth";
import { getSessionClient } from "@/lib/supabase";
import { redirect } from "next/navigation";

const NAV: { href: string; label: string; perm: Permission }[] = [
  { href: "/", label: "Dashboard", perm: "dashboard.view" },
  { href: "/orders", label: "Orders", perm: "orders.view" },
  { href: "/suppliers", label: "Suppliers", perm: "suppliers.view" },
  { href: "/alerts", label: "Alerts", perm: "alerts.view" },
  { href: "/customers", label: "Customers", perm: "customers.view" },
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
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh" }}>
      <nav style={{ background: "#14181f", color: "#fff", padding: 16, display: "grid", alignContent: "start", gap: 8 }}>
        <strong>AuraFinds OMS</strong>
        {NAV.filter((n) => can(admin.role, n.perm)).map((n) => (
          <Link key={n.href} href={n.href} style={{ color: "#cfd6e4", textDecoration: "none" }}>{n.label}</Link>
        ))}
        <form action={signOut} style={{ marginTop: 24 }}>
          <small>{admin.email} · {admin.role}</small>
          <br />
          <button type="submit">Sign out</button>
        </form>
      </nav>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}

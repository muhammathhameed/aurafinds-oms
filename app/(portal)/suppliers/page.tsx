import Link from "next/link";
import { revalidatePath } from "next/cache";
import { can } from "@shared/rbac";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";

interface Perf {
  days: number; paid_orders: number; submitted: number; failed: number; shipped: number;
  overdue_tracking: number; avg_submit_hours: number | null; avg_ship_days: number | null;
}

async function addSupplier(formData: FormData) {
  "use server";
  const actor = await requirePermission("suppliers.manage");
  const code = String(formData.get("code") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!/^[a-z0-9_-]{2,32}$/.test(code) || !name) return;
  const { error } = await getServiceClient().from("oms_suppliers").insert({
    code, name: name.slice(0, 120), contact_email: String(formData.get("email") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  await audit(actor.userId, "supplier.create", "supplier", code, null, { name });
  revalidatePath("/suppliers");
}

async function setStatus(formData: FormData) {
  "use server";
  const actor = await requirePermission("suppliers.manage");
  const code = String(formData.get("code") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["approved", "suspended", "pending"].includes(status)) return;
  const db = getServiceClient();
  const { data: before } = await db.from("oms_suppliers").select("status").eq("code", code).maybeSingle();
  const { error } = await db.from("oms_suppliers").update({ status, updated_at: new Date().toISOString() }).eq("code", code);
  if (error) throw new Error(error.message);
  await audit(actor.userId, "supplier.status", "supplier", code, before, { status });
  revalidatePath("/suppliers");
}

export default async function SuppliersPage() {
  const admin = await requirePermission("suppliers.view");
  const manage = can(admin.role, "suppliers.manage");
  const db = getServiceClient();
  const { data: suppliers } = await db.from("oms_suppliers").select("code, name, status, contact_email, handling_days").order("created_at");
  const { data: perfData } = await db.rpc("oms_supplier_performance", { p_days: 90 });
  const perf = perfData as Perf | null;
  return (
    <>
      <h1>Suppliers</h1>
      <p><Link href="/suppliers/mapping">Product → CJ variant mapping →</Link></p>
      <table cellPadding={6} style={{ background: "#fff" }}>
        <thead><tr><th align="left">Code</th><th align="left">Name</th><th>Status</th><th align="left">Contact</th><th /></tr></thead>
        <tbody>
          {(suppliers ?? []).map((s) => (
            <tr key={s.code}>
              <td>{s.code}</td><td>{s.name}</td><td align="center">{s.status}</td><td>{s.contact_email ?? "—"}</td>
              <td>
                {manage && (
                  <form action={setStatus} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="code" value={s.code} />
                    {s.status !== "approved" && <button name="status" value="approved">Approve</button>}
                    {s.status !== "suspended" && <button name="status" value="suspended">Suspend</button>}
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>CJ performance (last 90 days)</h2>
      {perf ? (
        <ul>
          <li>Paid orders: {perf.paid_orders} · submitted to CJ: {perf.submitted} · shipped: {perf.shipped}</li>
          <li>Failed submissions: {perf.failed}{perf.paid_orders ? ` (${Math.round((perf.failed / perf.paid_orders) * 100)}%)` : ""}</li>
          <li>Average time to submit: {perf.avg_submit_hours ?? "—"} h · average submit-to-ship: {perf.avg_ship_days ?? "—"} days</li>
          <li>No tracking after 5 days: {perf.overdue_tracking}</li>
        </ul>
      ) : <p>Apply 20261110000400_oms_suppliers.sql to see metrics.</p>}
      <small>All orders are attributed to CJ, the only supplier the storefront submits to today. Defect and return rates arrive with the returns workflow (Phase 5).</small>
      {manage && (
        <>
          <h2>Add supplier</h2>
          <form action={addSupplier} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input name="code" placeholder="code (e.g. spocket)" required />
            <input name="name" placeholder="Name" required />
            <input name="email" type="email" placeholder="Contact email" />
            <button type="submit">Add (starts as pending)</button>
          </form>
          <small>Adding a supplier records it only; the storefront still fulfils through CJ.</small>
        </>
      )}
    </>
  );
}

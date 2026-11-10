import { revalidatePath } from "next/cache";
import { can } from "@shared/rbac";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { runDetection } from "@/lib/ops";
import { getServiceClient } from "@/lib/supabase";

async function setStatus(formData: FormData) {
  "use server";
  const actor = await requirePermission("alerts.manage");
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  if (!Number.isInteger(id) || !["acknowledged", "resolved"].includes(status)) return;
  const patch =
    status === "acknowledged"
      ? { status, acknowledged_by: actor.userId, acknowledged_at: new Date().toISOString() }
      : { status, resolved_by: actor.userId, resolved_at: new Date().toISOString() };
  const { error } = await getServiceClient().from("ops_alerts").update(patch).eq("id", id).in("status", ["open", "acknowledged"]);
  if (error) throw new Error(error.message);
  await audit(actor.userId, `alert.${status}`, "alert", String(id), null, { status });
  revalidatePath("/alerts");
  revalidatePath("/");
}

async function recheck() {
  "use server";
  const actor = await requirePermission("alerts.manage");
  const result = await runDetection();
  await audit(actor.userId, "alert.recheck", "alerts", "all", null, result);
  revalidatePath("/alerts");
  revalidatePath("/");
}

export default async function AlertsPage() {
  const admin = await requirePermission("alerts.view");
  const manage = can(admin.role, "alerts.manage");
  const { data } = await getServiceClient()
    .from("ops_alerts")
    .select("id, kind, severity, status, title, entity_type, entity_id, detail, first_seen, last_seen")
    .in("status", ["open", "acknowledged"])
    .order("last_seen", { ascending: false })
    .limit(200);
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const alerts = (data ?? []).sort((a, b) => rank[a.severity] - rank[b.severity]);
  return (
    <>
      <h1>Alerts</h1>
      {manage && <form action={recheck}><button type="submit">Run checks now</button></form>}
      {alerts.length === 0 && <p>No open alerts.</p>}
      <table cellPadding={6}>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td><strong>{a.severity}</strong></td>
              <td>{a.title}<br /><small>{a.entity_type} {a.entity_id} · {JSON.stringify(a.detail)}</small></td>
              <td>{a.status}</td>
              <td>
                {manage && (
                  <form action={setStatus} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="id" value={a.id} />
                    {a.status === "open" && <button name="status" value="acknowledged">Acknowledge</button>}
                    <button name="status" value="resolved">Resolve</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

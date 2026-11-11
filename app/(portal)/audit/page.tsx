import { requirePermission } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; actor?: string }> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  let q = getServiceClient().from("audit_log").select("id, at, actor_email, actor_role, action, entity_type, entity_id, after").order("id", { ascending: false }).limit(100);
  const action = sp.action?.trim().replace(/[%_*,()\\]/g, "");
  const actor = sp.actor?.trim().replace(/[%_*,()\\]/g, "");
  if (action) q = q.ilike("action", `${action}%`);
  if (actor) q = q.ilike("actor_email", `%${actor}%`);
  const { data } = await q;
  return (
    <>
      <h1>Audit log</h1>
      <p>Append-only. Showing the latest 100 matching entries.</p>
      <form style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input name="action" defaultValue={sp.action} placeholder="Action prefix, e.g. refund" />
        <input name="actor" defaultValue={sp.actor} placeholder="Actor email" />
        <button type="submit">Filter</button>
      </form>
      <table cellPadding={6} style={{ background: "#fff" }}>
        <thead><tr><th align="left">When</th><th align="left">Who</th><th align="left">Action</th><th align="left">Entity</th><th align="left">Details</th></tr></thead>
        <tbody>
          {(data ?? []).map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.at).toLocaleString()}</td>
              <td>{a.actor_email ?? "system"}<br /><small>{a.actor_role}</small></td>
              <td>{a.action}</td>
              <td>{a.entity_type} {a.entity_id ? String(a.entity_id).slice(0, 12) : ""}</td>
              <td><small>{a.after ? JSON.stringify(a.after).slice(0, 200) : ""}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

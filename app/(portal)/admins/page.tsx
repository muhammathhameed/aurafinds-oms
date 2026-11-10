import { revalidatePath } from "next/cache";
import { canAssignRole, ROLES } from "@shared/rbac";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";

async function addAdmin(formData: FormData) {
  "use server";
  const actor = await requirePermission("admins.manage");
  const role = formData.get("role");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!canAssignRole(actor.role, role) || !email) return;
  const db = getServiceClient();
  const { data: userId } = await db.rpc("find_auth_user_id", { p_email: email });
  if (!userId) return; // The person must sign up (or be invited) in Supabase Auth first.
  const { error } = await db.from("admin_users").upsert(
    { user_id: userId, email, role, active: true, created_by: actor.userId },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
  await audit(actor.userId, "admin.grant", "admin_user", String(userId), null, { email, role });
  revalidatePath("/admins");
}

async function setActive(formData: FormData) {
  "use server";
  const actor = await requirePermission("admins.manage");
  const userId = String(formData.get("user_id") ?? "");
  const active = formData.get("active") === "true";
  const { error } = await getServiceClient().from("admin_users").update({ active }).eq("user_id", userId);
  if (error) throw new Error(error.message); // last_super_admin guard surfaces here
  await audit(actor.userId, active ? "admin.activate" : "admin.deactivate", "admin_user", userId, { active: !active }, { active });
  revalidatePath("/admins");
}

export default async function AdminsPage() {
  await requirePermission("admins.manage");
  const { data: admins } = await getServiceClient()
    .from("admin_users").select("user_id, email, role, active").order("created_at");
  return (
    <>
      <h1>Admin users</h1>
      <table cellPadding={6}>
        <thead><tr><th>Email</th><th>Role</th><th>Active</th><th /></tr></thead>
        <tbody>
          {(admins ?? []).map((a) => (
            <tr key={a.user_id}>
              <td>{a.email}</td><td>{a.role}</td><td>{a.active ? "yes" : "no"}</td>
              <td>
                <form action={setActive}>
                  <input type="hidden" name="user_id" value={a.user_id} />
                  <input type="hidden" name="active" value={String(!a.active)} />
                  <button type="submit">{a.active ? "Deactivate" : "Reactivate"}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Grant access</h2>
      <p>The person must already have a Supabase Auth account.</p>
      <form action={addAdmin} style={{ display: "flex", gap: 8 }}>
        <input name="email" type="email" placeholder="email" required />
        <select name="role">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <button type="submit">Grant</button>
      </form>
    </>
  );
}

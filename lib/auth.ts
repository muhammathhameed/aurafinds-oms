import "server-only";
import { redirect } from "next/navigation";
import { can, isRole, type Permission, type Role } from "@shared/rbac";
import { getServiceClient, getSessionClient } from "./supabase";

export interface Admin {
  userId: string;
  email: string;
  role: Role;
}

/**
 * The signed-in admin, or null. getUser() re-validates the JWT with Supabase
 * (unlike getSession), and the role always comes from admin_users: a customer
 * account in the same project has no row there and gets nothing.
 */
export async function getAdmin(): Promise<Admin | null> {
  const session = await getSessionClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return null;
  const { data } = await getServiceClient()
    .from("admin_users")
    .select("email, role, active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data || !data.active || !isRole(data.role)) return null;
  return { userId: user.id, email: data.email, role: data.role };
}

export async function requirePermission(permission: Permission): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect("/login");
  if (!can(admin.role, permission)) redirect("/?denied=1");
  return admin;
}

import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth";
import { getSessionClient } from "@/lib/supabase";

async function signIn(formData: FormData) {
  "use server";
  const session = await getSessionClient();
  const { error } = await session.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  // Same message for every failure so the form doesn't reveal which emails exist.
  if (error) redirect("/login?error=1");
  if (!(await getAdmin())) {
    await session.auth.signOut();
    redirect("/login?error=1");
  }
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 360, margin: "12vh auto", padding: 24, background: "#fff", borderRadius: 12 }}>
      <h1 style={{ fontSize: 20 }}>AuraFinds Operations</h1>
      <form action={signIn} style={{ display: "grid", gap: 12 }}>
        <input name="email" type="email" placeholder="Email" autoComplete="username" required />
        <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        {error && <p role="alert" style={{ color: "#b00020", margin: 0 }}>Sign-in failed.</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}

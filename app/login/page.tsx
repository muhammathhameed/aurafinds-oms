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
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", position: "relative", overflow: "hidden" }}>
      {/* Background Motion Graphics */}
      <div style={{ position: "absolute", top: "-10%", left: "-10%", width: "40%", height: "40%", background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)", filter: "blur(60px)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", bottom: "-10%", right: "-10%", width: "40%", height: "40%", background: "radial-gradient(circle, rgba(34,211,238,0.15) 0%, transparent 70%)", filter: "blur(60px)", borderRadius: "50%" }} />

      <div className="card animate-slide" style={{ width: "100%", maxWidth: 400, padding: 40, background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.1)", backdropFilter: "blur(12px)", color: "#fff", zIndex: 1 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, textAlign: "center", marginBottom: 8, background: "linear-gradient(to right, #6366f1, #22d3ee)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AuraFinds</h1>
        <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 14, marginBottom: 32 }}>Operations Management System</p>
        
        <form action={signIn} style={{ display: "grid", gap: 20 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>Email address</label>
            <input 
              name="email" 
              type="email" 
              placeholder="admin@aurafinds.com" 
              style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", outline: "none", transition: "border-color 0.2s" }}
              required 
            />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>Password</label>
            <input 
              name="password" 
              type="password" 
              placeholder="••••••••" 
              style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", outline: "none", transition: "border-color 0.2s" }}
              required 
            />
          </div>
          
          {error && <p role="alert" style={{ color: "#ef4444", fontSize: 13, textAlign: "center", margin: 0 }}>Authentication failed. Please try again.</p>}
          
          <button 
            type="submit" 
            style={{ marginTop: 8, padding: "12px", borderRadius: 8, background: "#6366f1", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer", transition: "transform 0.1s, background 0.2s" }}
          >
            Sign in to Portal
          </button>
        </form>
      </div>
    </main>
  );
}

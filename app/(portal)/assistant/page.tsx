import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { EXAMPLES, INTENTS, answer, isIntent, routeByKeyword, routeByModel, type Answer } from "@/lib/assistant";

async function ask(formData: FormData) {
  "use server";
  const admin = await requirePermission("assistant.use");
  const q = String(formData.get("q") ?? "").trim().slice(0, 300);
  if (!q) redirect("/assistant");
  const intent = routeByKeyword(q) ?? (await routeByModel(q));
  // Log the intent and length, not the text (questions can contain customer details).
  await audit(admin.userId, "assistant.query", "assistant", intent ?? "unmatched", null, { length: q.length });
  redirect(intent ? `/assistant?intent=${intent}` : `/assistant?unmatched=1`);
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ intent?: string; unmatched?: string }> }) {
  const admin = await requirePermission("assistant.use");
  const sp = await searchParams;
  let result: Answer | null = null;
  let error: string | null = null;
  if (isIntent(sp.intent)) {
    try {
      result = await answer(sp.intent, admin.role);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not answer that.";
    }
  }
  return (
    <>
      <h1>Operations assistant</h1>
      <p>Read-only. It looks things up; it cannot refund, cancel, or change anything.</p>
      <form action={ask} style={{ display: "flex", gap: 8, maxWidth: 560 }}>
        <input name="q" placeholder="e.g. Show delayed orders" maxLength={300} required style={{ flex: 1 }} />
        <button type="submit">Ask</button>
      </form>
      <p><small>Try: {INTENTS.map((i) => EXAMPLES[i]).join(" · ")}</small></p>
      {sp.unmatched && <p role="status">I can&apos;t answer that yet. Try one of the examples above.</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <h2>{result.title}</h2>
          {result.rows.length === 0 ? <p>Nothing found.</p> : (
            <table cellPadding={6} style={{ background: "#fff" }}>
              <thead><tr>{result.columns.map((c) => <th key={c} align="left">{c}</th>)}</tr></thead>
              <tbody>{result.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
            </table>
          )}
          {result.note && <p><small>{result.note}</small></p>}
        </>
      )}
    </>
  );
}

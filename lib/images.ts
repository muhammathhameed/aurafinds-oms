import "server-only";
import { getServiceClient } from "./supabase";

const MAX_PER_RUN = 25;

// Only public https hosts: this server fetches URLs that came from supplier data.
function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.includes(":")) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

async function probe(url: string): Promise<{ ok: boolean; status: number | null }> {
  const attempt = async (method: "HEAD" | "GET") => {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const type = res.headers.get("content-type") ?? "";
    return { ok: (res.ok || res.status === 206) && type.startsWith("image/"), status: res.status };
  };
  try {
    const head = await attempt("HEAD");
    if (head.ok || ![403, 405, 501].includes(head.status ?? 0)) return head;
    return await attempt("GET");
  } catch {
    return { ok: false, status: null };
  }
}

/** Checks the stalest active product images (never-checked first). */
export async function checkImages(): Promise<{ checked: number; broken: number }> {
  const db = getServiceClient();
  const { data: products } = await db.from("products").select("id, image_url").eq("status", "active").not("image_url", "is", null).neq("image_url", "").limit(1000);
  const { data: checks } = await db.from("product_image_checks").select("product_id, image_url, checked_at");
  const seen = new Map((checks ?? []).map((c) => [String(c.product_id), c]));
  const due = (products ?? [])
    .filter((p) => isSafeUrl(String(p.image_url)))
    .map((p) => ({ id: String(p.id), url: String(p.image_url), c: seen.get(String(p.id)) }))
    .filter((p) => !p.c || p.c.image_url !== p.url || Date.now() - new Date(p.c.checked_at).getTime() > 86_400_000)
    .sort((a, b) => (a.c ? new Date(a.c.checked_at).getTime() : 0) - (b.c ? new Date(b.c.checked_at).getTime() : 0))
    .slice(0, MAX_PER_RUN);

  let broken = 0;
  for (let i = 0; i < due.length; i += 5) {
    const results = await Promise.all(due.slice(i, i + 5).map(async (p) => ({ p, r: await probe(p.url) })));
    const rows = results.map(({ p, r }) => ({ product_id: p.id, image_url: p.url, ok: r.ok, http_status: r.status, checked_at: new Date().toISOString() }));
    broken += rows.filter((r) => !r.ok).length;
    const { error } = await db.from("product_image_checks").upsert(rows, { onConflict: "product_id" });
    if (error) throw new Error(error.message);
  }
  return { checked: due.length, broken };
}

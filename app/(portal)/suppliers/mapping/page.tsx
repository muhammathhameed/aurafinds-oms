import Link from "next/link";
import { revalidatePath } from "next/cache";
import { can } from "@shared/rbac";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";

const PAGE = 50;
const VID = /^[A-Za-z0-9-]{1,50}$/;

async function saveMapping(formData: FormData) {
  "use server";
  const actor = await requirePermission("suppliers.manage");
  const productId = String(formData.get("product_id") ?? "");
  const vid = String(formData.get("cj_variant_id") ?? "").trim();
  if (!productId) return;
  const db = getServiceClient();
  const { data: before } = await db.from("product_cj_variants").select("cj_variant_id").eq("product_id", productId).maybeSingle();
  if (!vid) {
    const { error } = await db.from("product_cj_variants").delete().eq("product_id", productId);
    if (error) throw new Error(error.message);
    await audit(actor.userId, "mapping.clear", "product", productId, before, null);
  } else {
    if (!VID.test(vid)) return;
    const { error } = await db.from("product_cj_variants").upsert({ product_id: productId, cj_variant_id: vid }, { onConflict: "product_id" });
    if (error) throw new Error(error.message);
    await audit(actor.userId, "mapping.set", "product", productId, before, { cj_variant_id: vid });
  }
  revalidatePath("/suppliers/mapping");
}

export default async function MappingPage({ searchParams }: { searchParams: Promise<{ q?: string; unmapped?: string; page?: string }> }) {
  const admin = await requirePermission("suppliers.view");
  const manage = can(admin.role, "suppliers.manage");
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const db = getServiceClient();

  const { data: maps } = await db.from("product_cj_variants").select("product_id, cj_variant_id");
  const mapped = new Map((maps ?? []).map((m) => [String(m.product_id), String(m.cj_variant_id)]));

  let query = db.from("products").select("id, name, sku, supplier_id, status", { count: "exact" }).eq("status", "active").order("name");
  const q = sp.q?.trim().replace(/[%_\\,()]/g, "");
  if (q) query = query.ilike("name", `%${q}%`);
  if (sp.unmapped === "1" && mapped.size > 0) {
    query = query.not("id", "in", `(${[...mapped.keys()].join(",")})`);
  }
  const { data: products, count } = await query.range((page - 1) * PAGE, page * PAGE - 1);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const href = (p: number) => `/suppliers/mapping?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.unmapped ? { unmapped: "1" } : {}), page: String(p) })}`;

  return (
    <>
      <p><Link href="/suppliers">← Suppliers</Link></p>
      <h1>Product → CJ variant</h1>
      <p>Orders for a product without a CJ variant ID stay pending. Use the exact variant ID (VID) from CJ.</p>
      <form style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input name="q" defaultValue={sp.q} placeholder="Search name" />
        <label><input type="checkbox" name="unmapped" value="1" defaultChecked={sp.unmapped === "1"} /> unmapped only</label>
        <button type="submit">Filter</button>
      </form>
      <p>{count ?? 0} active product(s); {mapped.size} mapped overall</p>
      <table cellPadding={6} style={{ background: "#fff" }}>
        <thead><tr><th align="left">Product</th><th align="left">SKU</th><th align="left">CJ variant ID</th></tr></thead>
        <tbody>
          {(products ?? []).map((p) => {
            const id = String(p.id);
            const vid = mapped.get(id);
            return (
              <tr key={id} style={{ background: vid ? undefined : "#fff4e5" }}>
                <td>{p.name}</td><td>{p.sku ?? "—"}</td>
                <td>
                  {manage ? (
                    <form action={saveMapping} style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="product_id" value={id} />
                      <input name="cj_variant_id" defaultValue={vid ?? ""} placeholder="not mapped" maxLength={50} />
                      <button type="submit">Save</button>
                    </form>
                  ) : (vid ?? "not mapped")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>{page > 1 && <Link href={href(page - 1)}>← Prev</Link>} Page {page} of {pages} {page < pages && <Link href={href(page + 1)}>Next →</Link>}</p>
    </>
  );
}

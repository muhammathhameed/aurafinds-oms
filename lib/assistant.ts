import "server-only";
import { can, type Role } from "@shared/rbac";
import { getServiceClient } from "./supabase";

// READ-ONLY by construction: every intent maps to one fixed, parameter-free
// query below. The language model (optional) only picks an intent name; it never
// writes SQL, sees data, or triggers an action.
export const INTENTS = [
  "open_alerts", "delayed_orders", "failed_fulfillments", "supplier_issues",
  "best_supplier", "low_inventory", "high_margin_products", "risky_customers",
] as const;
export type Intent = (typeof INTENTS)[number];
export const isIntent = (v: unknown): v is Intent => typeof v === "string" && (INTENTS as readonly string[]).includes(v);

export const EXAMPLES: Record<Intent, string> = {
  open_alerts: "What needs attention?",
  delayed_orders: "Show delayed orders",
  failed_fulfillments: "Show failed fulfillments",
  supplier_issues: "Find supplier issues",
  best_supplier: "Which supplier is performing best?",
  low_inventory: "Find low inventory products",
  high_margin_products: "What products have the highest margins?",
  risky_customers: "Show high-risk customers",
};

const KEYWORDS: [Intent, RegExp][] = [
  ["failed_fulfillments", /fail/i],
  ["delayed_orders", /delay|late|stuck|overdue|miss(ing)? deliver/i],
  ["best_supplier", /best supplier|supplier.*(best|perform|recommend)|recommend.*supplier/i],
  ["supplier_issues", /supplier/i],
  ["low_inventory", /inventor|stock|shortage/i],
  ["high_margin_products", /margin|profit/i],
  ["risky_customers", /customer|refund|vip|complain/i],
  ["open_alerts", /alert|attention|issue|problem|risk/i],
];

export function routeByKeyword(question: string): Intent | null {
  return KEYWORDS.find(([, re]) => re.test(question))?.[0] ?? null;
}

/** Optional fallback when no keyword matches. Sends only the question text. */
export async function routeByModel(question: string): Promise<Intent | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `Classify the operator's question into exactly one intent from: ${INTENTS.join(", ")}. If none fit, answer "none". Reply as JSON {"intent": "..."}.` }] },
        contents: [{ role: "user", parts: [{ text: question.slice(0, 300) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const parsed = JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}") as { intent?: unknown };
    return isIntent(parsed.intent) ? parsed.intent : null;
  } catch {
    return null;
  }
}

export interface Answer { title: string; columns: string[]; rows: (string | number)[][]; note?: string }

const money = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;
const when = (t: unknown) => (t ? new Date(String(t)).toLocaleString() : "");

async function alertsLike(patterns: string[], title: string): Promise<Answer> {
  const db = getServiceClient();
  const filter = patterns.map((p) => `kind.like.${p.replace(/%/g, "*")}`).join(","); // PostgREST wildcards are *
  const { data, error } = await db.from("ops_alerts").select("severity, title, entity_type, entity_id, last_seen")
    .in("status", ["open", "acknowledged"]).or(filter).order("last_seen", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return { title, columns: ["Severity", "Issue", "Entity", "Last seen"], rows: (data ?? []).map((a) => [a.severity, a.title, `${a.entity_type} ${String(a.entity_id).slice(0, 24)}`, when(a.last_seen)]) };
}

export async function answer(intent: Intent, role: Role): Promise<Answer> {
  const db = getServiceClient();
  switch (intent) {
    case "open_alerts": {
      const a = await alertsLike(["%"], "Open alerts");
      const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      a.rows.sort((x, y) => (rank[String(x[0])] ?? 9) - (rank[String(y[0])] ?? 9));
      return a;
    }
    case "delayed_orders":
      return alertsLike(["order.fulfillment_stuck", "order.tracking_missing"], "Delayed orders");
    case "failed_fulfillments": {
      const { data, error } = await db.from("orders").select("id, customer_email, fulfillment_error, created_at").eq("payment_status", "paid").eq("fulfillment_status", "failed").order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      const showEmail = can(role, "customers.view");
      return { title: "Failed fulfillments", columns: ["Order", ...(showEmail ? ["Customer"] : []), "Error", "Placed"], rows: (data ?? []).map((o) => [String(o.id).slice(0, 8), ...(showEmail ? [o.customer_email ?? "—"] : []), o.fulfillment_error ?? "", when(o.created_at)]) };
    }
    case "supplier_issues":
      return alertsLike(["supplier.%", "order.fulfillment_failed"], "Supplier issues");
    case "best_supplier": {
      const { data } = await db.rpc("oms_supplier_performance", { p_days: 90 });
      const p = (data ?? {}) as Record<string, number | null>;
      return {
        title: "Supplier performance (90 days)", columns: ["Supplier", "Paid orders", "Failed", "Avg hours to submit", "Avg days to ship"],
        rows: [["CJ Dropshipping", p.paid_orders ?? 0, p.failed ?? 0, p.avg_submit_hours ?? "—", p.avg_ship_days ?? "—"]],
        note: "CJ is the only supplier the storefront fulfils through, so there is nothing to rank or recommend between yet.",
      };
    }
    case "low_inventory": {
      const { data, error } = await db.from("products").select("id, name, stock_quantity").eq("status", "active").lte("stock_quantity", 10).order("stock_quantity").limit(50);
      if (error) throw new Error(error.message);
      return { title: "Low-stock products (10 or fewer)", columns: ["Product", "Stock"], rows: (data ?? []).map((p) => [p.name ?? String(p.id), p.stock_quantity]) };
    }
    case "high_margin_products": {
      if (!can(role, "finance.view")) throw new Error("Margins are limited to roles with finance access.");
      const { data, error } = await db.from("products").select("name, price, cost_price").eq("status", "active").gt("cost_price", 0).limit(1000);
      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((p) => ({ n: p.name, price: Number(p.price), cost: Number(p.cost_price) }))
        .filter((p) => p.price > 0).map((p) => ({ ...p, m: (p.price - p.cost) / p.price })).sort((a, b) => b.m - a.m).slice(0, 15);
      return { title: "Highest-margin active products", columns: ["Product", "Price", "Cost", "Margin"], rows: rows.map((r) => [r.n, money(r.price), money(r.cost), `${Math.round(r.m * 100)}%`]), note: "Uses current product cost; shipping and fees are not included." };
    }
    case "risky_customers": {
      if (!can(role, "customers.view")) throw new Error("Customer data is limited to roles with customer access.");
      const a = await alertsLike(["customer.%"], "Customers needing attention");
      a.note = "Rule-based: repeated returns, repeated contacts, or a high-value customer with an order in trouble. Not a prediction model.";
      return a;
    }
  }
}

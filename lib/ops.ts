import "server-only";
import { getServiceClient } from "./supabase";

export interface Kpis {
  days: number;
  paid_orders: number;
  revenue_cents: number;
  avg_order_cents: number;
  items_revenue_cents: number;
  items_cost_cents: number;
  lines_without_cost: number;
  fulfillment: Record<string, number>;
  open_alerts: Record<string, number>;
}

export async function getKpis(days: number): Promise<Kpis> {
  const { data, error } = await getServiceClient().rpc("oms_dashboard_kpis", { p_days: days });
  if (error) throw new Error(error.message);
  return data as Kpis;
}

export async function runDetection(): Promise<{ opened: number; resolved: number }> {
  const { data, error } = await getServiceClient().rpc("oms_detect_alerts");
  if (error) throw new Error(error.message);
  return data as { opened: number; resolved: number };
}

import "server-only";
import { getServiceClient } from "./supabase";

/** Writes an audit row. Throws on failure so a privileged action is never unrecorded. */
export async function audit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown = null,
  after: unknown = null,
  meta: Record<string, unknown> = {},
) {
  const { error } = await getServiceClient().rpc("write_audit", {
    p_actor_id: actorId,
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_before: before,
    p_after: after,
    p_meta: meta,
  });
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

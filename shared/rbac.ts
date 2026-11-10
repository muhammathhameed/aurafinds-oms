export const ROLES = [
  "super_admin",
  "ops_admin",
  "customer_service",
  "fulfillment",
  "finance",
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "dashboard.view",
  "alerts.view",
  "alerts.manage",
  "orders.view",
  "orders.edit",
  "orders.refund",
  "suppliers.view",
  "suppliers.manage",
  "pos.create",
  "fulfillment.manage",
  "returns.manage",
  "customers.view",
  "customers.notes",
  "finance.view",
  "audit.view",
  "admins.manage",
  "assistant.use",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OPS: Permission[] = [
  "dashboard.view", "alerts.view", "alerts.manage", "orders.view", "orders.edit",
  "suppliers.view", "suppliers.manage", "pos.create", "fulfillment.manage",
  "returns.manage", "customers.view", "customers.notes", "audit.view",
  "assistant.use",
];

/** Least privilege: refunds and money views are limited to finance and above. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  ops_admin: [...OPS, "orders.refund", "finance.view"],
  customer_service: [
    "dashboard.view", "alerts.view", "orders.view", "customers.view",
    "customers.notes", "returns.manage", "assistant.use",
  ],
  fulfillment: [
    "dashboard.view", "alerts.view", "orders.view", "suppliers.view",
    "pos.create", "fulfillment.manage", "assistant.use",
  ],
  finance: [
    "dashboard.view", "alerts.view", "orders.view", "orders.refund",
    "finance.view", "audit.view", "returns.manage", "assistant.use",
  ],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: string | null | undefined, permission: Permission): boolean {
  return isRole(role) && ROLE_PERMISSIONS[role].includes(permission);
}

/** Only a super admin may grant or change roles, and only to known roles. */
export function canAssignRole(actor: string | null | undefined, target: unknown): target is Role {
  return can(actor, "admins.manage") && isRole(target);
}

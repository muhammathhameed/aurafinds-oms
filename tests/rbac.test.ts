import test from "node:test";
import assert from "node:assert/strict";
import { can, canAssignRole, isRole, ROLES, PERMISSIONS, ROLE_PERMISSIONS } from "../shared/rbac";

test("unknown or missing roles have no permissions", () => {
  for (const p of PERMISSIONS) {
    assert.equal(can(null, p), false);
    assert.equal(can(undefined, p), false);
    assert.equal(can("customer", p), false);
    assert.equal(can("__proto__", p), false);
  }
});

test("super admin has every permission", () => {
  for (const p of PERMISSIONS) assert.equal(can("super_admin", p), true);
});

test("only super admin manages admins", () => {
  for (const r of ROLES) assert.equal(can(r, "admins.manage"), r === "super_admin");
  assert.equal(canAssignRole("ops_admin", "super_admin"), false);
  assert.equal(canAssignRole("super_admin", "boss"), false);
  assert.equal(canAssignRole("super_admin", "finance"), true);
});

test("refund access is limited to finance, ops admin and super admin", () => {
  const allowed = ROLES.filter((r) => can(r, "orders.refund")).sort();
  assert.deepEqual(allowed, ["finance", "ops_admin", "super_admin"]);
});

test("customer service cannot touch suppliers, POs or money", () => {
  for (const p of ["suppliers.manage", "pos.create", "finance.view", "orders.refund", "orders.edit"] as const)
    assert.equal(can("customer_service", p), false);
});

test("fulfillment can create POs but not refund", () => {
  assert.equal(can("fulfillment", "pos.create"), true);
  assert.equal(can("fulfillment", "orders.refund"), false);
});

test("every role lists only known permissions and isRole is strict", () => {
  for (const r of ROLES) for (const p of ROLE_PERMISSIONS[r]) assert.ok((PERMISSIONS as readonly string[]).includes(p));
  assert.equal(isRole("ops_admin"), true);
  assert.equal(isRole("toString"), false);
});

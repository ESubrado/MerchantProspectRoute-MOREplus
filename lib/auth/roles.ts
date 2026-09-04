/** Defines the database-owned membership roles that the application may expose. */
export type WorkspaceRole = "owner" | "admin" | "member";

/** Narrows untyped PostgREST role values before they become authorization input. */
export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === "owner" || value === "admin" || value === "member";
}

/** Identifies the two manager-level roles that may change shared workspace data. */
export function isWorkspaceManagerRole(role: WorkspaceRole) {
  return role === "owner" || role === "admin";
}

import type { PoolClient } from "pg";

import type { Role } from "./auth";

export type ToolName =
  | "whoami"
  | "search_tickets"
  | "get_ticket"
  | "get_customer"
  | "list_orders"
  | "get_order"
  | "propose_refund"
  | "propose_status_change"
  | "list_pending_actions"
  | "approve_action"
  | "reject_action"
  | "get_audit_log";

const toolPermissions: Record<ToolName, readonly Role[]> = {
  whoami: ["support_agent", "manager", "auditor"],
  search_tickets: ["support_agent", "manager", "auditor"],
  get_ticket: ["support_agent", "manager", "auditor"],
  get_customer: ["support_agent", "manager", "auditor"],
  list_orders: ["support_agent", "manager", "auditor"],
  get_order: ["support_agent", "manager", "auditor"],
  propose_refund: ["support_agent", "manager"],
  propose_status_change: ["support_agent", "manager"],
  list_pending_actions: ["support_agent", "manager", "auditor"],
  approve_action: ["manager"],
  reject_action: ["manager"],
  get_audit_log: ["manager", "auditor"],
};

export function canUseTool(role: Role, toolName: ToolName): boolean {
  return toolPermissions[toolName].includes(role);
}

export function checkRefundPolicy(amount: number): {
  allowed: boolean;
  risk: "normal" | "high";
  reason: string;
} {
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      allowed: false,
      risk: "normal",
      reason: "Refund amount must be a positive finite number.",
    };
  }
  if (amount > 500) {
    return {
      allowed: false,
      risk: "high",
      reason: "Refunds over $500 are blocked.",
    };
  }
  if (amount > 100) {
    return {
      allowed: true,
      risk: "high",
      reason: "Refund is above $100 and is flagged as high risk.",
    };
  }
  return {
    allowed: true,
    risk: "normal",
    reason: "Refund is within the standard approval policy.",
  };
}

export function checkSeparationOfDuties(
  proposedBy: string,
  decidedBy: string,
): { allowed: boolean; reason: string } {
  if (proposedBy === decidedBy) {
    return {
      allowed: false,
      reason: "The identity that proposed an action cannot approve or reject it.",
    };
  }
  return {
    allowed: true,
    reason: "The proposer and approver are different identities.",
  };
}

export function isExpired(
  expiresAt: string | Date,
  now: string | Date = new Date(),
): boolean {
  const expiresAtMs = new Date(expiresAt).getTime();
  const nowMs = new Date(now).getTime();
  return Number.isFinite(expiresAtMs) && nowMs >= expiresAtMs;
}

export function getRateLimitWindow(
  now: Date,
  windowMilliseconds = 60_000,
): Date {
  return new Date(
    Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds,
  );
}

export async function consumeRateLimit(
  client: PoolClient,
  tokenLabel: string,
  limit: number,
  now = new Date(),
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const windowStart = getRateLimitWindow(now);

  const result = await client.query<{ count: number }>(
    `INSERT INTO rate_counters (token_label, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (token_label, window_start)
     DO UPDATE SET count = rate_counters.count + 1
     RETURNING count`,
    [tokenLabel, windowStart],
  );

  const count = Number(result.rows[0]?.count ?? 0);
  return {
    allowed: count <= limit,
    count,
    limit,
  };
}

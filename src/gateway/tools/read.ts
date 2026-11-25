import type { Pool } from "pg";

import type { Identity } from "../auth";
import { logCall } from "../audit";
import { canUseTool, consumeRateLimit, type ToolName } from "../policy";
import {
  detectInstructionLikeText,
  maskEmail,
  wrapUntrusted,
} from "../sanitize";

export type ReadArgs = Record<string, unknown>;

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

function textResult(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

export async function withReadGuard(
  client: Pool,
  identity: Identity | null,
  tool: ToolName,
  args: ReadArgs,
  handler: () => Promise<unknown>,
): Promise<ToolResult> {
  if (!identity) {
    await logCall(client, {
      role: "unknown",
      tokenLabel: "unknown",
      tool,
      args,
      outcome: "denied",
      reason: "Unknown or missing bearer credential",
      resultSummary: "Call denied",
    });
    return textResult({
      error: "Authentication required",
      detail: "Provide a valid bearer token.",
    });
  }

  if (!canUseTool(identity.role, tool)) {
    await logCall(client, {
      role: identity.role,
      tokenLabel: identity.tokenLabel,
      tool,
      args,
      outcome: "denied",
      reason: "Role is not permitted to use this tool",
      resultSummary: "Call denied",
    });
    return textResult({
      error: "Forbidden",
      detail: `The ${identity.role} role cannot call ${tool}.`,
    });
  }

  const rateLimit = Number.parseInt(
    process.env.RATE_LIMIT_PER_MIN ?? "20",
    10,
  );
  const safeLimit =
    Number.isFinite(rateLimit) && rateLimit > 0 ? rateLimit : 20;

  try {
    const limitResult = await consumeRateLimit(
      client,
      identity.tokenLabel,
      safeLimit,
    );
    if (!limitResult.allowed) {
      await logCall(client, {
        role: identity.role,
        tokenLabel: identity.tokenLabel,
        tool,
        args,
        outcome: "denied",
        reason: "Rate limit exceeded",
        resultSummary: `${limitResult.count} calls exceed limit ${limitResult.limit}`,
      });
      return textResult({
        error: "Rate limit exceeded",
        detail: `Limit is ${limitResult.limit} tool calls per minute.`,
      });
    }

    const result = await handler();
    await logCall(client, {
      role: identity.role,
      tokenLabel: identity.tokenLabel,
      tool,
      args,
      outcome: "allowed",
      reason: "Tool call permitted",
      resultSummary: "Tool call completed",
    });
    return textResult(result);
  } catch (error) {
    await logCall(client, {
      role: identity.role,
      tokenLabel: identity.tokenLabel,
      tool,
      args,
      outcome: "error",
      reason: "Tool handler or database call failed",
      resultSummary:
        error instanceof Error ? error.message : "Unknown backend error",
    }).catch(() => undefined);
    return textResult({
      error: "Service unavailable",
      detail: "The database could not complete this request.",
    });
  }
}

export async function whoami(identity: Identity | null): Promise<unknown> {
  return {
    role: identity?.role ?? "unconfigured",
    allowedActions: identity
      ? [
          "whoami",
          "search_tickets",
          "get_ticket",
          "get_customer",
          "list_orders",
          "get_order",
          "list_pending_actions",
          ...(identity.role === "manager" || identity.role === "auditor"
            ? ["get_audit_log"]
            : []),
        ].filter((tool) =>
          canUseTool(identity.role, tool as ToolName),
        )
      : ["whoami"],
  };
}

export async function searchTickets(
  client: Pool,
  identity: Identity,
  query: string,
  status?: string,
  limit = 20,
): Promise<unknown> {
  const parameters: unknown[] = [`%${query}%`, limit];
  const statusClause = status
    ? " AND status = $3"
    : "";
  if (status) {
    parameters.push(status);
  }

  const result = await client.query(
    `SELECT id, subject, status, priority, created_at
     FROM tickets
     WHERE (subject ILIKE $1 OR body ILIKE $1)
       ${statusClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    parameters,
  );
  return { tickets: result.rows };
}

export async function getTicket(
  client: Pool,
  identity: Identity,
  id: string,
): Promise<unknown> {
  const result = await client.query(
    `SELECT id, customer_id, subject, body, status, priority, created_at
     FROM tickets WHERE id = $1`,
    [id],
  );
  const ticket = result.rows[0];
  if (!ticket) {
    return {
      error: "Ticket not found",
      detail: `Ticket ${id} not found. Use search_tickets to find valid IDs.`,
    };
  }

  const record = ticket as {
    id: string;
    customer_id: string;
    subject: string;
    body: string;
    status: string;
    priority: string;
    created_at: Date;
  };
  const detection = detectInstructionLikeText(record.body);
  void identity;
  return {
    ...record,
    body: wrapUntrusted("body", record.body),
    instructionLikeText: detection,
  };
}

export async function getCustomer(
  client: Pool,
  identity: Identity,
  id: string,
): Promise<unknown> {
  const result = await client.query(
    "SELECT id, name, email, tier, notes FROM customers WHERE id = $1",
    [id],
  );
  const customer = result.rows[0] as
    | {
        id: string;
        name: string;
        email: string;
        tier: string;
        notes: string;
      }
    | undefined;
  if (!customer) {
    return {
      error: "Customer not found",
      detail: `Customer ${id} not found.`,
    };
  }

  return {
    id: customer.id,
    name: customer.name,
    email:
      identity.role === "manager"
        ? customer.email
        : maskEmail(customer.email),
    tier: customer.tier,
    notes: wrapUntrusted("notes", customer.notes),
    instructionLikeText: detectInstructionLikeText(customer.notes),
  };
}

export async function listOrders(
  client: Pool,
  _identity: Identity,
  customerId: string,
  limit = 20,
): Promise<unknown> {
  const result = await client.query(
    `SELECT id, customer_id, total, status, created_at
     FROM orders
     WHERE customer_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [customerId, limit],
  );
  return { orders: result.rows };
}

export async function getOrder(
  client: Pool,
  _identity: Identity,
  id: string,
): Promise<unknown> {
  const result = await client.query(
    `SELECT id, customer_id, total, status, created_at
     FROM orders WHERE id = $1`,
    [id],
  );
  const order = result.rows[0];
  if (!order) {
    return {
      error: "Order not found",
      detail: `Order ${id} not found.`,
    };
  }
  return order;
}

export async function listPendingActions(
  client: Pool,
  identity: Identity,
): Promise<unknown> {
  const result =
    identity.role === "support_agent"
      ? await client.query(
          `SELECT id, type, payload, requested_by, status, created_at, expires_at
           FROM pending_actions
           WHERE requested_by = $1
           ORDER BY created_at DESC
           LIMIT 50`,
          [identity.tokenLabel],
        )
      : await client.query(
          `SELECT id, type, payload, requested_by, status, created_at, expires_at
           FROM pending_actions
           ORDER BY created_at DESC
           LIMIT 50`,
        );
  return { pendingActions: result.rows };
}

export async function getAuditLog(
  client: Pool,
  _identity: Identity,
  limit = 50,
): Promise<unknown> {
  const result = await client.query(
    `SELECT id, ts, role, token_label, tool, args, outcome, reason, result_summary
     FROM audit_log
     ORDER BY ts DESC
     LIMIT $1`,
    [limit],
  );
  return { auditLog: result.rows };
}

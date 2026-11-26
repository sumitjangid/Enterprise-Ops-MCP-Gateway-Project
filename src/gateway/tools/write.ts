import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import type { Identity } from "../auth";
import {
  checkRefundPolicy,
  checkSeparationOfDuties,
  isExpired,
} from "../policy";
import {
  detectInstructionLikeText,
  maskPiiText,
  wrapUntrusted,
} from "../sanitize";
import { ToolRequestError } from "./errors";

const currencyAmountSchema = z
  .number()
  .finite()
  .positive()
  .max(100_000_000)
  .refine(
    (amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-8,
  );

const refundPayloadSchema = z.object({
  orderId: z.string().regex(/^O-\d{1,6}$/),
  amount: currencyAmountSchema,
  reason: z.string().min(1).max(500),
  risk: z.enum(["normal", "high"]),
});

const statusChangePayloadSchema = z.object({
  ticketId: z.string().regex(/^T-\d{1,6}$/),
  newStatus: z.enum(["open", "closed"]),
  previousStatus: z.enum(["open", "closed"]),
  reason: z.string().min(1).max(500),
});

type PendingAction = {
  id: string;
  type: "refund" | "status_change";
  payload: unknown;
  requested_by: string;
  status: "pending" | "approved" | "rejected" | "expired";
  expires_at: Date | string;
};

type TransactionResult<T> =
  | { kind: "completed"; value: T }
  | { kind: "denied"; error: ToolRequestError };

function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

function untrustedReason(reason: string, identity: Identity) {
  return {
    ...wrapUntrusted(
      "reason",
      identity.role === "manager" ? reason : maskPiiText(reason),
    ),
    instructionLikeText: detectInstructionLikeText(reason),
  };
}

async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertPendingAction(
  client: Pool,
  identity: Identity,
  type: PendingAction["type"],
  payload: Record<string, unknown>,
): Promise<{ id: string; created_at: Date | string; expires_at: Date | string }> {
  const id = `A-${randomUUID()}`;
  const result = await client.query<{
    id: string;
    created_at: Date | string;
    expires_at: Date | string;
  }>(
    `INSERT INTO pending_actions
       (id, type, payload, requested_by, status, expires_at)
     VALUES ($1, $2, $3, $4, 'pending', now() + interval '24 hours')
     RETURNING id, created_at, expires_at`,
    [id, type, payload, identity.tokenLabel],
  );
  const action = result.rows[0];
  if (!action) {
    throw new Error("Pending action insert returned no row.");
  }
  return action;
}

export async function proposeRefund(
  client: Pool,
  identity: Identity,
  orderId: string,
  amount: number,
  reason: string,
): Promise<unknown> {
  if (!currencyAmountSchema.safeParse(amount).success) {
    throw new ToolRequestError(
      "Invalid refund amount",
      "Refund amount must be positive and expressed in increments of one cent.",
    );
  }
  const policy = checkRefundPolicy(amount);
  if (!policy.allowed) {
    throw new ToolRequestError("Refund blocked", policy.reason);
  }

  const orderResult = await client.query<{
    total: string;
    refunded_total: string;
  }>(
    "SELECT total, refunded_total FROM orders WHERE id = $1",
    [orderId],
  );
  const order = orderResult.rows[0];
  if (!order) {
    throw new ToolRequestError(
      "Order not found",
      `Order ${orderId} not found.`,
    );
  }

  const availableCents = toCents(order.total) - toCents(order.refunded_total);
  if (toCents(amount) > availableCents) {
    throw new ToolRequestError(
      "Refund exceeds refundable balance",
      `The requested amount exceeds the remaining refundable balance of $${formatAmount(availableCents / 100)}.`,
    );
  }

  const normalizedAmount = Number(formatAmount(amount));
  const payload = {
    orderId,
    amount: normalizedAmount,
    reason,
    risk: policy.risk,
  };
  const action = await insertPendingAction(
    client,
    identity,
    "refund",
    payload,
  );

  return {
    message: `Refund proposal submitted. A manager must call approve_action with action_id ${action.id}.`,
    pendingAction: {
      id: action.id,
      type: "refund",
      amount: normalizedAmount,
      risk: policy.risk,
      orderId,
      reason: untrustedReason(reason, identity),
      status: "pending",
      created_at: action.created_at,
      expires_at: action.expires_at,
    },
  };
}

export async function proposeStatusChange(
  client: Pool,
  identity: Identity,
  ticketId: string,
  newStatus: "open" | "closed",
  reason: string,
): Promise<unknown> {
  const ticketResult = await client.query<{ status: string }>(
    "SELECT status FROM tickets WHERE id = $1",
    [ticketId],
  );
  const ticket = ticketResult.rows[0];
  if (!ticket) {
    throw new ToolRequestError(
      "Ticket not found",
      `Ticket ${ticketId} not found.`,
    );
  }
  if (ticket.status !== "open" && ticket.status !== "closed") {
    throw new ToolRequestError(
      "Unsupported ticket status",
      `Ticket ${ticketId} has an unsupported current status.`,
    );
  }
  if (ticket.status === newStatus) {
    throw new ToolRequestError(
      "No status change needed",
      `Ticket ${ticketId} is already ${newStatus}.`,
    );
  }

  const payload = {
    ticketId,
    newStatus,
    previousStatus: ticket.status,
    reason,
  };
  const action = await insertPendingAction(
    client,
    identity,
    "status_change",
    payload,
  );
  return {
    message: `Status-change proposal submitted. A manager must call approve_action with action_id ${action.id}.`,
    pendingAction: {
      id: action.id,
      type: "status_change",
      ticketId,
      previousStatus: ticket.status,
      newStatus,
      reason: untrustedReason(reason, identity),
      status: "pending",
      created_at: action.created_at,
      expires_at: action.expires_at,
    },
  };
}

async function loadPendingAction(
  client: PoolClient,
  actionId: string,
): Promise<PendingAction> {
  const result = await client.query<PendingAction>(
    `SELECT id, type, payload, requested_by, status, expires_at
     FROM pending_actions
     WHERE id = $1
     FOR UPDATE`,
    [actionId],
  );
  const action = result.rows[0];
  if (!action) {
    throw new ToolRequestError(
      "Action not found",
      `Pending action ${actionId} not found.`,
    );
  }
  if (action.status !== "pending") {
    throw new ToolRequestError(
      "Action already decided",
      `Action ${actionId} is already ${action.status}.`,
    );
  }
  return action;
}

async function markExpired(
  client: PoolClient,
  action: PendingAction,
  identity: Identity,
): Promise<TransactionResult<never>> {
  await client.query(
    `UPDATE pending_actions
     SET status = 'expired', decided_by = $2, decided_at = now()
     WHERE id = $1`,
    [action.id, identity.tokenLabel],
  );
  return {
    kind: "denied",
    error: new ToolRequestError(
      "Action expired",
      `Action ${action.id} expired and cannot be decided.`,
    ),
  };
}

export async function approveAction(
  pool: Pool,
  identity: Identity,
  actionId: string,
): Promise<unknown> {
  const result = await inTransaction(pool, async (client) => {
    const action = await loadPendingAction(client, actionId);
    const separation = checkSeparationOfDuties(
      action.requested_by,
      identity.tokenLabel,
    );
    if (!separation.allowed) {
      throw new ToolRequestError("Separation of duties violation", separation.reason);
    }
    if (isExpired(action.expires_at)) {
      return markExpired(client, action, identity);
    }

    if (action.type === "refund") {
      const payload = refundPayloadSchema.parse(action.payload);
      const policy = checkRefundPolicy(payload.amount);
      if (!policy.allowed) {
        throw new ToolRequestError("Refund blocked", policy.reason);
      }
      const orderResult = await client.query<{
        total: string;
        refunded_total: string;
      }>(
        `SELECT total, refunded_total
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [payload.orderId],
      );
      const order = orderResult.rows[0];
      if (!order) {
        throw new ToolRequestError(
          "Order not found",
          `Order ${payload.orderId} no longer exists.`,
        );
      }
      const availableCents =
        toCents(order.total) - toCents(order.refunded_total);
      if (toCents(payload.amount) > availableCents) {
        throw new ToolRequestError(
          "Refund exceeds refundable balance",
          `The remaining refundable balance is $${formatAmount(availableCents / 100)}; reject this proposal or submit a new one.`,
        );
      }
      await client.query(
        `UPDATE orders
         SET refunded_total = refunded_total + $2,
             status = CASE
               WHEN refunded_total + $2 >= total THEN 'refunded'
               ELSE status
             END
         WHERE id = $1`,
        [payload.orderId, formatAmount(payload.amount)],
      );
    } else {
      const payload = statusChangePayloadSchema.parse(action.payload);
      const ticketResult = await client.query<{ status: string }>(
        "SELECT status FROM tickets WHERE id = $1 FOR UPDATE",
        [payload.ticketId],
      );
      const ticket = ticketResult.rows[0];
      if (!ticket) {
        throw new ToolRequestError(
          "Ticket not found",
          `Ticket ${payload.ticketId} no longer exists.`,
        );
      }
      if (ticket.status !== payload.previousStatus) {
        throw new ToolRequestError(
          "Ticket status changed",
          `Ticket ${payload.ticketId} changed since this proposal; reject it and submit a new proposal.`,
        );
      }
      await client.query(
        "UPDATE tickets SET status = $2 WHERE id = $1",
        [payload.ticketId, payload.newStatus],
      );
    }

    await client.query(
      `UPDATE pending_actions
       SET status = 'approved', decided_by = $2, decided_at = now()
       WHERE id = $1`,
      [action.id, identity.tokenLabel],
    );
    return {
      kind: "completed" as const,
      value: {
        message: `Action ${action.id} approved and the simulated change was applied.`,
        actionId: action.id,
        status: "approved",
        type: action.type,
      },
    };
  });

  if (result.kind === "denied") {
    throw result.error;
  }
  return result.value;
}

export async function rejectAction(
  pool: Pool,
  identity: Identity,
  actionId: string,
  reason: string,
): Promise<unknown> {
  const result = await inTransaction(pool, async (client) => {
    const action = await loadPendingAction(client, actionId);
    const separation = checkSeparationOfDuties(
      action.requested_by,
      identity.tokenLabel,
    );
    if (!separation.allowed) {
      throw new ToolRequestError("Separation of duties violation", separation.reason);
    }
    if (isExpired(action.expires_at)) {
      return markExpired(client, action, identity);
    }

    await client.query(
      `UPDATE pending_actions
       SET status = 'rejected', decided_by = $2, decided_at = now(),
           decision_reason = $3
       WHERE id = $1`,
      [action.id, identity.tokenLabel, reason],
    );
    return {
      kind: "completed" as const,
      value: {
        message: `Action ${action.id} rejected.`,
        actionId: action.id,
        status: "rejected",
        decisionReason: untrustedReason(reason, identity),
      },
    };
  });

  if (result.kind === "denied") {
    throw result.error;
  }
  return result.value;
}

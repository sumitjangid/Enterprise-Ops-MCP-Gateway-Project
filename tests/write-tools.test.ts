import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { Identity } from "../src/gateway/auth";
import { ToolRequestError } from "../src/gateway/tools/errors";
import {
  listPendingActions,
  withReadGuard,
} from "../src/gateway/tools/read";
import {
  approveAction,
  proposeRefund,
  proposeStatusChange,
  rejectAction,
} from "../src/gateway/tools/write";

const agent: Identity = {
  role: "support_agent",
  tokenLabel: "support_agent",
};
const manager: Identity = {
  role: "manager",
  tokenLabel: "manager",
};

function createPool(
  respond: (text: string, values?: unknown[]) => unknown[] = () => [],
) {
  const query = vi.fn(async (text: string, values?: unknown[]) => ({
    rows: respond(text, values),
  }));
  const release = vi.fn();
  const pool = {
    query,
    connect: vi.fn(async () => ({ query, release })),
  } as unknown as Pool;
  return { pool, query, release };
}

function pendingAction(overrides: Record<string, unknown> = {}) {
  return {
    id: "A-123",
    type: "refund",
    payload: {
      orderId: "O-5001",
      amount: 25,
      reason: "Customer reported a duplicate charge.",
      risk: "normal",
    },
    requested_by: "support_agent",
    status: "pending",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("write proposals", () => {
  it("creates a pending refund proposal without changing the order", async () => {
    const { pool, query } = createPool((text) => {
      if (text.startsWith("SELECT total, refunded_total")) {
        return [{ total: "300.00", refunded_total: "0.00" }];
      }
      if (text.startsWith("INSERT INTO pending_actions")) {
        return [{
          id: "A-123",
          created_at: "2026-11-25T10:00:00.000Z",
          expires_at: "2026-11-26T10:00:00.000Z",
        }];
      }
      return [];
    });

    const result = await proposeRefund(
      pool,
      agent,
      "O-5001",
      120,
      "Contact morgan.lee@example.com at +1 (555) 123-4567.",
    );

    expect(result).toMatchObject({
      message: expect.stringContaining("approve_action"),
      pendingAction: {
        id: "A-123",
        type: "refund",
        amount: 120,
        risk: "high",
        status: "pending",
        reason: {
          trust: "untrusted_user_data",
          content: "Contact m***@example.com at ***-***-4567.",
        },
      },
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain("now() + interval '24 hours'");
    expect(query.mock.calls.some(([text]) => text.startsWith("UPDATE orders"))).toBe(
      false,
    );
  });

  it("blocks refunds over the policy cap before querying the order", async () => {
    const { pool, query } = createPool();
    await expect(
      proposeRefund(pool, agent, "O-5001", 500.01, "Over the cap"),
    ).rejects.toMatchObject({
      publicError: "Refund blocked",
    } satisfies Partial<ToolRequestError>);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects refund amounts that do not use whole cents", async () => {
    const { pool, query } = createPool();
    await expect(
      proposeRefund(pool, agent, "O-5001", 10.001, "Invalid precision"),
    ).rejects.toMatchObject({
      publicError: "Invalid refund amount",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("blocks a refund above the remaining order balance", async () => {
    const { pool, query } = createPool(() => [
      { total: "100.00", refunded_total: "50.00" },
    ]);

    await expect(
      proposeRefund(pool, agent, "O-5001", 50.01, "Too much"),
    ).rejects.toMatchObject({
      publicError: "Refund exceeds refundable balance",
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it("creates a status-change proposal and keeps its reason untrusted", async () => {
    const { pool } = createPool((text) => {
      if (text.startsWith("SELECT status FROM tickets")) {
        return [{ status: "open" }];
      }
      return [{
        id: "A-124",
        created_at: "2026-11-25T10:00:00.000Z",
        expires_at: "2026-11-26T10:00:00.000Z",
      }];
    });

    const result = await proposeStatusChange(
      pool,
      agent,
      "T-1001",
      "closed",
      "Customer confirmed the issue is resolved.",
    );
    expect(result).toMatchObject({
      pendingAction: {
        status: "pending",
        previousStatus: "open",
        newStatus: "closed",
        reason: { trust: "untrusted_user_data" },
      },
    });
  });
});

describe("pending action decisions", () => {
  it("applies an approved refund in a transaction and marks the action approved", async () => {
    const { pool, query, release } = createPool((text) => {
      if (text.startsWith("SELECT id, type, payload")) {
        return [pendingAction()];
      }
      if (text.startsWith("SELECT total, refunded_total")) {
        return [{ total: "100.00", refunded_total: "0.00" }];
      }
      return [];
    });

    const result = await approveAction(pool, manager, "A-123");

    expect(result).toMatchObject({
      status: "approved",
      type: "refund",
      actionId: "A-123",
    });
    expect(query.mock.calls.some(([text]) => text === "BEGIN")).toBe(true);
    expect(
      query.mock.calls.some(([text]) => text.startsWith("UPDATE orders")),
    ).toBe(true);
    expect(
      query.mock.calls.some(([text]) =>
        text.includes("SET status = 'approved'"),
      ),
    ).toBe(true);
    expect(query.mock.calls.some(([text]) => text === "COMMIT")).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("applies an approved ticket status change", async () => {
    const action = pendingAction({
      type: "status_change",
      payload: {
        ticketId: "T-1001",
        newStatus: "closed",
        previousStatus: "open",
        reason: "Resolved by customer.",
      },
    });
    const { pool, query } = createPool((text) => {
      if (text.startsWith("SELECT id, type, payload")) return [action];
      if (text.startsWith("SELECT status FROM tickets")) {
        return [{ status: "open" }];
      }
      return [];
    });

    await approveAction(pool, manager, "A-123");
    expect(
      query.mock.calls.some(([text, values]) =>
        text.startsWith("UPDATE tickets SET status") &&
        values?.[1] === "closed",
      ),
    ).toBe(true);
  });

  it("rejects approval by the proposer and rolls back", async () => {
    const { pool, query } = createPool((text) =>
      text.startsWith("SELECT id, type, payload")
        ? [pendingAction({ requested_by: "manager" })]
        : [],
    );

    await expect(
      approveAction(pool, manager, "A-123"),
    ).rejects.toMatchObject({
      publicError: "Separation of duties violation",
    });
    expect(query.mock.calls.some(([text]) => text === "ROLLBACK")).toBe(true);
    expect(query.mock.calls.some(([text]) => text === "COMMIT")).toBe(false);
  });

  it("rechecks the refund cap when approving a pending action", async () => {
    const action = pendingAction({
      payload: {
        orderId: "O-5001",
        amount: 501,
        reason: "Over the cap",
        risk: "high",
      },
    });
    const { pool, query } = createPool((text) =>
      text.startsWith("SELECT id, type, payload") ? [action] : [],
    );

    await expect(approveAction(pool, manager, "A-123")).rejects.toMatchObject({
      publicError: "Refund blocked",
    });
    expect(
      query.mock.calls.some(([text]) => text.startsWith("UPDATE orders")),
    ).toBe(false);
    expect(query.mock.calls.some(([text]) => text === "ROLLBACK")).toBe(true);
  });

  it("marks expired actions expired and refuses the decision", async () => {
    const { pool, query } = createPool((text) =>
      text.startsWith("SELECT id, type, payload")
        ? [pendingAction({ expires_at: "2000-01-01T00:00:00.000Z" })]
        : [],
    );

    await expect(approveAction(pool, manager, "A-123")).rejects.toMatchObject({
      publicError: "Action expired",
    });
    expect(
      query.mock.calls.some(([text]) =>
        text.includes("SET status = 'expired'"),
      ),
    ).toBe(true);
    expect(query.mock.calls.some(([text]) => text === "COMMIT")).toBe(true);
  });

  it("rejects a repeated decision without applying another change", async () => {
    const { pool, query } = createPool((text) =>
      text.startsWith("SELECT id, type, payload")
        ? [pendingAction({ status: "approved" })]
        : [],
    );

    await expect(approveAction(pool, manager, "A-123")).rejects.toMatchObject({
      publicError: "Action already decided",
    });
    expect(query.mock.calls.some(([text]) => text.startsWith("UPDATE orders"))).toBe(
      false,
    );
    expect(query.mock.calls.some(([text]) => text === "ROLLBACK")).toBe(true);
  });

  it("records the manager's rejection reason", async () => {
    const { pool, query } = createPool((text) =>
      text.startsWith("SELECT id, type, payload") ? [pendingAction()] : [],
    );

    const result = await rejectAction(
      pool,
      manager,
      "A-123",
      "The request does not meet the refund policy.",
    );
    expect(result).toMatchObject({
      status: "rejected",
      decisionReason: { trust: "untrusted_user_data" },
    });
    expect(
      query.mock.calls.some(
        ([text, values]) =>
          text.includes("decision_reason = $3") &&
          values?.[2] === "The request does not meet the refund policy.",
      ),
    ).toBe(true);
  });

  it("masks free-text PII in pending actions for non-manager roles", async () => {
    const { pool } = createPool(() => [
      {
        id: "A-123",
        payload: {
          reason: "Contact morgan.lee@example.com at +1 (555) 123-4567.",
        },
        decision_reason: "Call +1 (555) 555-0199.",
      },
    ]);

    const result = (await listPendingActions(pool, agent)) as {
      pendingActions: Array<{
        payload: { reason: { content: string } };
        decision_reason: { content: string };
      }>;
    };
    expect(result.pendingActions[0]).toMatchObject({
      payload: {
        reason: { content: "Contact m***@example.com at ***-***-4567." },
      },
      decision_reason: { content: "Call ***-***-0199." },
    });

    const managerResult = (await listPendingActions(pool, manager)) as {
      pendingActions: Array<{
        payload: { reason: { content: string } };
      }>;
    };
    expect(managerResult.pendingActions[0].payload.reason.content).toBe(
      "Contact morgan.lee@example.com at +1 (555) 123-4567.",
    );
  });
});

describe("write policy audit", () => {
  it("audits blocked proposals as denied", async () => {
    const { pool, query } = createPool((text) => {
      if (text.startsWith("INSERT INTO rate_counters")) {
        return [{ count: 1 }];
      }
      return [];
    });

    const result = await withReadGuard(
      pool,
      agent,
      "propose_refund",
      { order_id: "O-5001", amount: 501, reason: "Over the cap" },
      () => proposeRefund(pool, agent, "O-5001", 501, "Over the cap"),
    );

    expect(result.content[0].text).toContain("Refund blocked");
    expect(
      query.mock.calls.some(
        ([text, values]) =>
          text.startsWith("INSERT INTO audit_log") && values?.[5] === "denied",
      ),
    ).toBe(true);
    const auditCall = query.mock.calls.find(([text]) =>
      text.startsWith("INSERT INTO audit_log"),
    );
    expect(auditCall?.[1]?.[4]).toMatchObject({
      reason: "[USER-PROVIDED TEXT REDACTED]",
    });
  });
});

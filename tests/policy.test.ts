import { describe, expect, it } from "vitest";

import type { Role } from "../src/gateway/auth";
import {
  canUseTool,
  checkRefundPolicy,
  checkSeparationOfDuties,
  consumeRateLimit,
  getRateLimitWindow,
  isExpired,
  type ToolName,
} from "../src/gateway/policy";
import type { PoolClient } from "pg";

const tools: ToolName[] = [
  "whoami",
  "search_tickets",
  "get_ticket",
  "get_customer",
  "list_orders",
  "get_order",
  "propose_refund",
  "propose_status_change",
  "list_pending_actions",
  "approve_action",
  "reject_action",
  "get_audit_log",
];

describe("role permissions", () => {
  it("matches the role and tool catalog", () => {
    const rolePermissions: Record<Role, readonly ToolName[]> = {
      support_agent: [
        "whoami",
        "search_tickets",
        "get_ticket",
        "get_customer",
        "list_orders",
        "get_order",
        "propose_refund",
        "propose_status_change",
        "list_pending_actions",
      ],
      manager: tools,
      auditor: [
        "whoami",
        "search_tickets",
        "get_ticket",
        "get_customer",
        "list_orders",
        "get_order",
        "list_pending_actions",
        "get_audit_log",
      ],
    };

    for (const role of Object.keys(rolePermissions) as Role[]) {
      for (const tool of tools) {
        expect(canUseTool(role, tool)).toBe(
          rolePermissions[role].includes(tool),
        );
      }
    }
  });
});

describe("refund policy", () => {
  it.each([
    [100, "normal", true],
    [100.01, "high", true],
    [500, "high", true],
    [500.01, "high", false],
  ])("handles the boundary amount %s", (amount, risk, allowed) => {
    expect(checkRefundPolicy(amount)).toMatchObject({
      allowed,
      risk,
    });
  });

  it("rejects non-positive and non-finite amounts", () => {
    expect(checkRefundPolicy(0).allowed).toBe(false);
    expect(checkRefundPolicy(-1).allowed).toBe(false);
    expect(checkRefundPolicy(Number.NaN).allowed).toBe(false);
  });
});

describe("separation of duties", () => {
  it("rejects the same proposer and approver", () => {
    expect(checkSeparationOfDuties("manager", "manager").allowed).toBe(false);
  });

  it("allows different identities", () => {
    expect(checkSeparationOfDuties("support_agent", "manager").allowed).toBe(
      true,
    );
  });
});

describe("action expiry", () => {
  it("expires at exactly 24 hours", () => {
    const created = new Date("2026-11-25T06:00:00.000Z");
    const expires = new Date(created.getTime() + 24 * 60 * 60 * 1000);

    expect(isExpired(expires, new Date(expires.getTime() - 1))).toBe(false);
    expect(isExpired(expires, expires)).toBe(true);
  });

  it("expires after 24 hours", () => {
    const expires = new Date("2026-11-25T06:00:00.000Z");
    expect(isExpired(expires, "2026-11-26T06:00:00.001Z")).toBe(true);
  });
});

describe("rate limit windows", () => {
  it("uses one-minute aligned windows", () => {
    expect(getRateLimitWindow(new Date("2026-11-25T06:07:59.999Z")).toISOString())
      .toBe("2026-11-25T06:07:00.000Z");
  });

  it("returns a new window for the next minute", () => {
    expect(getRateLimitWindow(new Date("2026-11-25T06:08:00.000Z")).toISOString())
      .toBe("2026-11-25T06:08:00.000Z");
  });
});

describe("database rate limit", () => {
  it("allows the configured 20th call and denies the 21st", async () => {
    let count = 0;
    const client = {
      query: async () => {
        count += 1;
        return { rows: [{ count }] };
      },
    } as unknown as PoolClient;

    for (let call = 1; call <= 20; call += 1) {
      expect(
        (await consumeRateLimit(client, "support_agent", 20)).allowed,
      ).toBe(true);
    }

    expect(
      (await consumeRateLimit(client, "support_agent", 20)).allowed,
    ).toBe(false);
  });
});

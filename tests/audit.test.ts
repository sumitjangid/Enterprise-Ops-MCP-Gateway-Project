import { describe, expect, it, vi } from "vitest";

import {
  logCall,
  redactAndTruncate,
  truncateText,
  type AuditQueryable,
} from "../src/gateway/audit";

describe("audit sanitization", () => {
  it("redacts secret and credential fields", () => {
    expect(
      redactAndTruncate({
        authorization: "Bearer secret",
        password: "password",
        apiKey: "key",
        nested: { token: "nested-secret", safe: "visible" },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      password: "[REDACTED]",
      apiKey: "[REDACTED]",
      nested: { token: "[REDACTED]", safe: "visible" },
    });
  });

  it("truncates very long text", () => {
    expect(truncateText("a".repeat(600)).length).toBe(514);
  });
});

describe("logCall", () => {
  it("writes a safe audit row and returns an ID", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as AuditQueryable;

    const id = await logCall(client, {
      role: "support_agent",
      tokenLabel: "support_agent",
      tool: "get_ticket",
      args: { authorization: "Bearer super-secret", ticketId: "T-1001" },
      outcome: "allowed",
      reason: "Tool call permitted",
      resultSummary: "Ticket returned",
    });

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(query).toHaveBeenCalledOnce();

    const [, values] = query.mock.calls[0];
    expect(values?.[4]).toEqual({
      authorization: "[REDACTED]",
      ticketId: "T-1001",
    });
  });
});

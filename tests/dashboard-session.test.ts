import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDashboardSession,
  verifyDashboardSession,
} from "../src/gateway/dashboard-session";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboard session", () => {
  it("creates and verifies a signed manager session", () => {
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "test-dashboard-secret");
    vi.stubEnv("MANAGER_TOKEN", "manager-secret");
    const now = new Date("2026-11-26T04:00:00Z");

    const session = createDashboardSession(
      { role: "manager", tokenLabel: "manager" },
      now,
    );

    expect(session).not.toBeNull();
    expect(
      verifyDashboardSession(session ?? undefined, now),
    ).toEqual({ role: "manager", tokenLabel: "manager" });
  });

  it("rejects tampered or expired sessions", () => {
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "test-dashboard-secret");
    vi.stubEnv("MANAGER_TOKEN", "manager-secret");
    const now = new Date("2026-11-26T04:00:00Z");
    const session = createDashboardSession(
      { role: "manager", tokenLabel: "manager" },
      now,
    );

    expect(
      verifyDashboardSession(
        `${session?.slice(0, -1)}x`,
        now,
      ),
    ).toBeNull();
    expect(
      verifyDashboardSession(
        session ?? undefined,
        new Date("2026-11-27T04:00:00Z"),
      ),
    ).toBeNull();
  });

  it("does not create a session for non-manager identities", () => {
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "test-dashboard-secret");
    expect(
      createDashboardSession({
        role: "auditor",
        tokenLabel: "auditor",
      }),
    ).toBeNull();
  });
});

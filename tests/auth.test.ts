import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateBearerToken } from "../src/gateway/auth";

const originalEnv = {
  AGENT_TOKEN: process.env.AGENT_TOKEN,
  MANAGER_TOKEN: process.env.MANAGER_TOKEN,
  AUDITOR_TOKEN: process.env.AUDITOR_TOKEN,
};

afterEach(() => {
  vi.unstubAllEnvs();
  process.env.AGENT_TOKEN = originalEnv.AGENT_TOKEN;
  process.env.MANAGER_TOKEN = originalEnv.MANAGER_TOKEN;
  process.env.AUDITOR_TOKEN = originalEnv.AUDITOR_TOKEN;
});

describe("authenticateBearerToken", () => {
  it("maps configured bearer tokens to roles", () => {
    vi.stubEnv("AGENT_TOKEN", "agent-secret");
    vi.stubEnv("MANAGER_TOKEN", "manager-secret");
    vi.stubEnv("AUDITOR_TOKEN", "auditor-secret");

    expect(authenticateBearerToken("Bearer agent-secret")).toEqual({
      role: "support_agent",
      tokenLabel: "support_agent",
    });
    expect(authenticateBearerToken("Bearer manager-secret")).toEqual({
      role: "manager",
      tokenLabel: "manager",
    });
    expect(authenticateBearerToken("Bearer auditor-secret")).toEqual({
      role: "auditor",
      tokenLabel: "auditor",
    });
  });

  it("rejects missing, malformed, and unknown credentials", () => {
    vi.stubEnv("AGENT_TOKEN", "agent-secret");

    expect(authenticateBearerToken(null)).toBeNull();
    expect(authenticateBearerToken("Basic agent-secret")).toBeNull();
    expect(authenticateBearerToken("Bearer unknown")).toBeNull();
  });

  it("does not authenticate an unconfigured token", () => {
    vi.stubEnv("AGENT_TOKEN", "");
    vi.stubEnv("MANAGER_TOKEN", "");
    vi.stubEnv("AUDITOR_TOKEN", "");

    expect(authenticateBearerToken("Bearer ")).toBeNull();
  });
});

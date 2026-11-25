import { timingSafeEqual } from "node:crypto";

export type Role = "support_agent" | "manager" | "auditor";

export type Identity = {
  role: Role;
  tokenLabel: "support_agent" | "manager" | "auditor";
};

function secureTokenMatches(candidate: string, configured: string | undefined) {
  if (!configured) {
    return false;
  }

  const candidateBuffer = Buffer.from(candidate);
  const configuredBuffer = Buffer.from(configured);
  return (
    candidateBuffer.length === configuredBuffer.length &&
    timingSafeEqual(candidateBuffer, configuredBuffer)
  );
}

export function authenticateBearerToken(
  authorization: string | null | undefined,
): Identity | null {
  if (!authorization) {
    return null;
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization.trim());
  if (!match) {
    return null;
  }

  const token = match[1];
  if (secureTokenMatches(token, process.env.AGENT_TOKEN)) {
    return { role: "support_agent", tokenLabel: "support_agent" };
  }
  if (secureTokenMatches(token, process.env.MANAGER_TOKEN)) {
    return { role: "manager", tokenLabel: "manager" };
  }
  if (secureTokenMatches(token, process.env.AUDITOR_TOKEN)) {
    return { role: "auditor", tokenLabel: "auditor" };
  }

  return null;
}

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import type { Identity } from "./auth";

export const DASHBOARD_COOKIE_NAME = "enterprise_ops_dashboard";

const sessionDurationSeconds = 8 * 60 * 60;

function sessionSecret(): string | undefined {
  return (
    process.env.DASHBOARD_SESSION_SECRET ||
    process.env.MANAGER_TOKEN ||
    undefined
  );
}

export function createDashboardSession(
  identity: Identity,
  now = new Date(),
): string | null {
  if (identity.role !== "manager") {
    return null;
  }
  const secret = sessionSecret();
  if (!secret) {
    return null;
  }
  const payload = Buffer.from(
    JSON.stringify({
      role: "manager",
      exp: Math.floor(now.getTime() / 1000) + sessionDurationSeconds,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifyDashboardSession(
  value: string | undefined,
  now = new Date(),
): Identity | null {
  if (!value) {
    return null;
  }
  const secret = sessionSecret();
  if (!secret) {
    return null;
  }
  const separator = value.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { role?: unknown; exp?: unknown };
    if (
      parsed.role !== "manager" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Math.floor(now.getTime() / 1000)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return { role: "manager", tokenLabel: "manager" };
}

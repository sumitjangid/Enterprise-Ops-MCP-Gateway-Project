import { randomUUID } from "node:crypto";

export type AuditOutcome = "allowed" | "denied" | "error";

export type AuditCall = {
  role: string;
  tokenLabel: string;
  tool: string;
  args: unknown;
  outcome: AuditOutcome;
  reason: string;
  resultSummary: string;
};

export type AuditQueryable = {
  query<T = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

const secretFieldPattern =
  /(authorization|password|passphrase|secret|token|api[_-]?key|credential)/i;

export function redactAndTruncate(value: unknown, maxLength = 2_000): unknown {
  const redact = (current: unknown, key = ""): unknown => {
    if (secretFieldPattern.test(key)) {
      return "[REDACTED]";
    }
    if (typeof current === "string") {
      return current.length > maxLength
        ? `${current.slice(0, maxLength)}...[TRUNCATED]`
        : current;
    }
    if (Array.isArray(current)) {
      return current.map((item) => redact(item));
    }
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current).map(([childKey, childValue]) => [
          childKey,
          redact(childValue, childKey),
        ]),
      );
    }
    return current;
  };

  const redacted = redact(value);
  const serialized = JSON.stringify(redacted);
  if (serialized.length <= maxLength) {
    return redacted;
  }
  return { truncated: serialized.slice(0, maxLength) };
}

export function truncateText(value: string, maxLength = 500): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}...[TRUNCATED]`
    : value;
}

export async function logCall(
  client: AuditQueryable,
  call: AuditCall,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO audit_log
      (id, ts, role, token_label, tool, args, outcome, reason, result_summary)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      call.role,
      call.tokenLabel,
      call.tool,
      redactAndTruncate(call.args),
      call.outcome,
      truncateText(call.reason),
      truncateText(call.resultSummary),
    ],
  );
  return id;
}

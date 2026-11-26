import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";

import { db } from "../../db/client";
import {
  DASHBOARD_COOKIE_NAME,
  verifyDashboardSession,
} from "../../gateway/dashboard-session";
import { detectInstructionLikeText, wrapUntrusted } from "../../gateway/sanitize";
import {
  approveDashboardAction,
  logout,
  rejectDashboardAction,
} from "./actions";
import { LoginForm } from "./login-form";

type DashboardRow = Record<string, unknown>;

type DashboardProps = {
  searchParams: Promise<{
    role?: string;
    tool?: string;
    outcome?: string;
    result?: string;
  }>;
};

const filterSchema = z.object({
  role: z.enum(["support_agent", "manager", "auditor"]).optional(),
  tool: z.string().trim().min(1).max(64).optional(),
  outcome: z.enum(["allowed", "denied", "error"]).optional(),
});

function text(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

async function loadDashboard(searchParams: {
  role?: string;
  tool?: string;
  outcome?: string;
}) {
  const filterResult = filterSchema.safeParse({
    role: searchParams.role || undefined,
    tool: searchParams.tool || undefined,
    outcome: searchParams.outcome || undefined,
  });
  const filters = filterResult.success ? filterResult.data : {};

  const conditions: string[] = [];
  const parameters: unknown[] = [];
  if (filters.role) {
    parameters.push(filters.role);
    conditions.push(`role = $${parameters.length}`);
  }
  if (filters.tool) {
    parameters.push(filters.tool);
    conditions.push(`tool = $${parameters.length}`);
  }
  if (filters.outcome) {
    parameters.push(filters.outcome);
    conditions.push(`outcome = $${parameters.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [pendingResult, auditResult, counterResult, injectionResult] =
    await Promise.all([
      db.query(
        `SELECT id, type, payload, requested_by, status, created_at,
                decided_by, decided_at, decision_reason, expires_at
         FROM pending_actions
         ORDER BY created_at DESC
         LIMIT 100`,
      ),
      db.query(
        `SELECT id, ts, role, token_label, tool, args, outcome, reason, result_summary
         FROM audit_log
         ${where}
         ORDER BY ts DESC
         LIMIT 100`,
        parameters,
      ),
      db.query(
        `SELECT
           count(*) FILTER (WHERE ts >= date_trunc('day', now()))::int AS calls_today,
           count(*) FILTER (
             WHERE ts >= date_trunc('day', now()) AND outcome = 'denied'
           )::int AS denials_today
         FROM audit_log`,
      ),
      db.query(
        `SELECT
           (SELECT count(*) FROM tickets
            WHERE lower(body) LIKE '%ignore previous%'
               OR lower(body) LIKE '%refund%')
           +
           (SELECT count(*) FROM customers
            WHERE lower(notes) LIKE '%ignore previous%'
               OR lower(notes) LIKE '%list every%'
               OR lower(notes) LIKE '%exfiltrat%')::int AS flagged_injections`,
      ),
    ]);

  return {
    pending: pendingResult.rows as DashboardRow[],
    audit: auditResult.rows as DashboardRow[],
    counters: {
      callsToday: Number(counterResult.rows[0]?.calls_today ?? 0),
      denialsToday: Number(counterResult.rows[0]?.denials_today ?? 0),
      flaggedInjections: Number(injectionResult.rows[0]?.flagged_injections ?? 0),
    },
    filters,
  };
}

export default function Dashboard(props: DashboardProps) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto min-h-screen max-w-7xl px-6 py-8">
          Loading dashboard...
        </main>
      }
    >
      <DashboardContent {...props} />
    </Suspense>
  );
}

async function DashboardContent({ searchParams }: DashboardProps) {
  await connection();
  const cookieStore = await cookies();
  const identity = verifyDashboardSession(
    cookieStore.get(DASHBOARD_COOKIE_NAME)?.value,
  );
  if (!identity) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <section className="w-full rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">
            Manager access
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Dashboard login</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Enter the configured manager bearer token. This demo session is HTTP-only.
          </p>
          <LoginForm />
        </section>
      </main>
    );
  }

  const params = await searchParams;
  const notice =
    params.result === "approved"
      ? "Action approved. Confirm its status and simulated change below."
      : params.result === "rejected"
        ? "Action rejected. Confirm its status and audit entry below."
        : params.result === "error"
          ? "The action could not be completed. Check its status and the audit log."
          : null;
  let data: Awaited<ReturnType<typeof loadDashboard>>;
  try {
    data = await loadDashboard(params);
  } catch {
    return (
      <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
          Demo data unavailable. Run the database migration and seed scripts.
        </div>
        <form action={logout}>
          <button className="rounded-lg border px-3 py-2 text-sm" type="submit">
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">
            Demo data only
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Operations dashboard</h1>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
          >
            Sign out
          </button>
        </form>
      </div>

      {notice ? (
        <p
          role="status"
          className="mb-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800"
        >
          {notice}
        </p>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Calls today", data.counters.callsToday],
          ["Denials today", data.counters.denialsToday],
          ["Flagged injections", data.counters.flaggedInjections],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-zinc-200 p-5">
            <p className="text-sm text-zinc-600">{label}</p>
            <p className="mt-1 text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Pending actions</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200">
          {data.pending.length === 0 ? (
            <p className="p-5 text-sm text-zinc-600">No pending actions.</p>
          ) : (
            <div className="divide-y divide-zinc-200">
              {data.pending.map((action) => {
                const payload =
                  action.payload && typeof action.payload === "object"
                    ? (action.payload as Record<string, unknown>)
                    : {};
                const reason =
                  typeof payload.reason === "string"
                    ? wrapUntrusted("reason", payload.reason)
                    : null;
                const active = action.status === "pending";
                return (
                  <article key={text(action.id)} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-sm">{text(action.id)}</p>
                        <p className="mt-1 text-sm text-zinc-700">
                          {text(action.type)} · {text(action.status)} · proposed by{" "}
                          {text(action.requested_by)}
                        </p>
                        <p className="mt-2 text-sm">
                          Expires {formatDate(action.expires_at)}
                        </p>
                        {reason ? (
                          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                            {text(reason.content)}
                            {typeof payload.reason === "string" &&
                            detectInstructionLikeText(payload.reason).flagged
                              ? " · instruction-like text"
                              : ""}
                          </p>
                        ) : null}
                        {typeof payload.amount === "number" ? (
                          <p className="mt-1 text-sm">
                            Refund amount: ${Number(payload.amount).toFixed(2)}
                          </p>
                        ) : null}
                        {typeof payload.ticketId === "string" ? (
                          <p className="mt-1 text-sm">
                            Ticket {payload.ticketId}: {text(payload.previousStatus)} →{" "}
                            {text(payload.newStatus)}
                          </p>
                        ) : null}
                      </div>
                      {active ? (
                        <div className="flex flex-col gap-2">
                          <form action={approveDashboardAction.bind(null, text(action.id))}>
                            <button
                              type="submit"
                              className="w-28 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"
                            >
                              Approve
                            </button>
                          </form>
                          <form
                            action={rejectDashboardAction.bind(
                              null,
                              text(action.id),
                            )}
                            className="flex gap-2"
                          >
                            <input
                              name="reason"
                              required
                              maxLength={500}
                              placeholder="Rejection reason"
                              className="w-44 rounded-lg border border-zinc-300 px-2 py-2 text-sm"
                            />
                            <button
                              type="submit"
                              className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700"
                            >
                              Reject
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Audit log</h2>
        <form className="mt-3 flex flex-wrap gap-2" method="get">
          <select
            name="role"
            defaultValue={data.filters.role ?? ""}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="">All roles</option>
            <option value="support_agent">Support agent</option>
            <option value="manager">Manager</option>
            <option value="auditor">Auditor</option>
          </select>
          <input
            name="tool"
            defaultValue={data.filters.tool ?? ""}
            maxLength={64}
            placeholder="Tool name"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <select
            name="outcome"
            defaultValue={data.filters.outcome ?? ""}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="">All outcomes</option>
            <option value="allowed">Allowed</option>
            <option value="denied">Denied</option>
            <option value="error">Error</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
          >
            Filter
          </button>
        </form>
        <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Tool</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {data.audit.map((entry) => (
                <tr key={text(entry.id)}>
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDate(entry.ts)}
                  </td>
                  <td className="px-4 py-3">{text(entry.role)}</td>
                  <td className="px-4 py-3 font-mono">{text(entry.tool)}</td>
                  <td className="px-4 py-3">{text(entry.outcome)}</td>
                  <td className="max-w-lg px-4 py-3">{text(entry.result_summary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

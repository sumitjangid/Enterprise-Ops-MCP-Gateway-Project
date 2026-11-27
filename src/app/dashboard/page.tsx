import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
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

function statusClass(value: unknown): string {
  switch (value) {
    case "pending":
    case "approved":
    case "rejected":
    case "expired":
      return `status-chip status-${value}`;
    case "allowed":
    case "denied":
    case "error":
      return `outcome-chip outcome-${value}`;
    default:
      return "status-chip";
  }
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
        <main className="loading-page">
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
      <main className="login-page">
        <section className="login-card">
          <Link className="brand-lockup" href="/" aria-label="Gateway home">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span className="brand-name">ENTERPRISE OPS / GATEWAY</span>
          </Link>
          <p className="section-label login-eyebrow">Manager access</p>
          <h1 className="login-heading">Sign in to operations</h1>
          <p className="login-description">
            Enter your manager token to review pending proposals and audit
            activity. Your session is protected by an HTTP-only cookie.
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
      <main className="dashboard-page">
        <div className="database-error" role="alert">
          Demo data is unavailable. Check the database connection and ensure
          the schema migration has completed.
        </div>
        <form action={logout} className="signout-form">
          <button className="signout-button" type="submit">
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <Link className="brand-lockup" href="/" aria-label="Gateway home">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span className="brand-name">ENTERPRISE OPS / GATEWAY</span>
          </Link>
          <h1 className="dashboard-title">Operations dashboard</h1>
          <p className="dashboard-subtitle">
            Review proposed changes and monitor gateway activity.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <span className="demo-badge">Synthetic demo data</span>
          <form action={logout} className="signout-form">
            <button type="submit" className="signout-button">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {notice ? (
        <p
          role="status"
          className={`notice ${
            params.result === "error" ? "notice-error" : "notice-success"
          }`}
        >
          {notice}
        </p>
      ) : null}

      <section className="metric-grid" aria-label="Daily gateway metrics">
        {[
          {
            label: "Calls today",
            value: data.counters.callsToday,
            className: "",
          },
          {
            label: "Denied calls",
            value: data.counters.denialsToday,
            className: "metric-warning",
          },
          {
            label: "Flagged text records",
            value: data.counters.flaggedInjections,
            className: "metric-danger",
          },
        ].map(({ label, value, className }) => (
          <article className={`metric-card ${className}`} key={label}>
            <p className="metric-label">{label}</p>
            <p className="metric-value">{value}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-section">
        <div className="section-heading-row">
          <h2 className="section-heading">Action requests</h2>
          <span className="count-badge">{data.pending.length}</span>
        </div>
        <div className="action-list">
          {data.pending.length === 0 ? (
            <p className="empty-state">No pending actions to review.</p>
          ) : (
            data.pending.map((action) => {
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
                <article className="action-card" key={text(action.id)}>
                  <div className="action-content">
                    <div className="action-title-row">
                      <span className="action-id">{text(action.id)}</span>
                      <span className={statusClass(action.status)}>
                        {text(action.status)}
                      </span>
                    </div>
                    <div className="action-meta">
                      <span>{text(action.type)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Proposed by {text(action.requested_by)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Expires {formatDate(action.expires_at)}</span>
                    </div>
                    {reason ? (
                      <p className="action-reason">
                        {text(reason.content)}
                        {typeof payload.reason === "string" &&
                        detectInstructionLikeText(payload.reason).flagged
                          ? " · instruction-like text"
                          : ""}
                      </p>
                    ) : null}
                    {typeof payload.amount === "number" ? (
                      <p className="action-detail">
                        Refund amount: ${Number(payload.amount).toFixed(2)}
                      </p>
                    ) : null}
                    {typeof payload.ticketId === "string" ? (
                      <p className="action-detail">
                        Ticket {payload.ticketId}: {text(payload.previousStatus)} →{" "}
                        {text(payload.newStatus)}
                      </p>
                    ) : null}
                  </div>
                  {active ? (
                    <div className="action-controls">
                      <form action={approveDashboardAction.bind(null, text(action.id))}>
                        <button type="submit" className="approve-button">
                          Approve proposal
                        </button>
                      </form>
                      <form
                        action={rejectDashboardAction.bind(null, text(action.id))}
                        className="reject-form"
                      >
                        <input
                          name="reason"
                          required
                          maxLength={500}
                          placeholder="Reason for rejection"
                          aria-label="Reason for rejection"
                          className="text-field"
                        />
                        <button type="submit" className="reject-button">
                          Reject
                        </button>
                      </form>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-heading-row">
          <div>
            <h2 className="section-heading">Audit log</h2>
            <p className="muted-copy">
              Recent tool activity, including denied requests.
            </p>
          </div>
          <span className="count-badge">{data.audit.length}</span>
        </div>
        <form className="audit-filters" method="get">
          <select
            name="role"
            defaultValue={data.filters.role ?? ""}
            className="filter-select"
            aria-label="Filter by role"
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
            className="filter-input"
            aria-label="Filter by tool name"
          />
          <select
            name="outcome"
            defaultValue={data.filters.outcome ?? ""}
            className="filter-select"
            aria-label="Filter by outcome"
          >
            <option value="">All outcomes</option>
            <option value="allowed">Allowed</option>
            <option value="denied">Denied</option>
            <option value="error">Error</option>
          </select>
          <button type="submit" className="filter-button">
            Filter
          </button>
        </form>
        <div className="audit-panel">
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Role</th>
                  <th scope="col">Tool</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Summary</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((entry) => (
                  <tr key={text(entry.id)}>
                    <td className="audit-time">{formatDate(entry.ts)}</td>
                    <td>{text(entry.role)}</td>
                    <td className="audit-tool">{text(entry.tool)}</td>
                    <td>
                      <span className={statusClass(entry.outcome)}>
                        {text(entry.outcome)}
                      </span>
                    </td>
                    <td className="audit-summary">
                      {text(entry.result_summary)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.audit.length === 0 ? (
              <p className="empty-state">No audit entries match these filters.</p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

# Enterprise Ops MCP Gateway

A TypeScript MCP gateway for safe AI access to mock enterprise operations data.

## Milestone 1 status

The first milestone provided a local Next.js MCP endpoint with a `whoami` tool.
Later milestones added authentication, database access, policy enforcement, audit
logging, proposal tools, and the dashboard.

## Milestone 2 status

The database milestone includes a PostgreSQL schema and deterministic synthetic seed data.
The seed contains fictional customers, orders, tickets, and one expired pending action.

For a local synthetic database, start the container the first time with:

```bash
docker run -d --name enterprise-ops-mcp-postgres \
  -e POSTGRES_DB=enterprise_ops \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 54329:5432 postgres:17-alpine
```

If the container already exists but is stopped, start it instead:

```bash
docker start enterprise-ops-mcp-postgres
```

Check that PostgreSQL is accepting connections, then apply the schema:

```bash
docker exec enterprise-ops-mcp-postgres pg_isready -U postgres -d enterprise_ops
```

After it reports `accepting connections`, run:

```bash
npm run db:migrate
```

To load the fictional demo records, run:

```bash
npm run db:seed
```

**Caution:** `npm run db:seed` resets the gateway's synthetic tables before
inserting demo data. `npm run db:reset` drops those tables. Use these only when
you are okay losing the current mock records.

## Milestone 3 status

The auth and policy module provides:

- Constant-time bearer-token role mapping
- Role-to-tool permission checks
- Refund policy boundaries
- Separation-of-duties checks
- 24-hour expiry checks
- PostgreSQL-backed per-token rate limiting

These modules are implemented, tested, and wired into the read, proposal, and
manager-decision tools through the shared route guard.

## Milestone 4 status

The sanitizer and audit modules provide:

- Untrusted-data wrappers for ticket and customer text
- Injection and exfiltration heuristics
- Email and phone masking
- Recursive secret-field redaction
- Argument and result truncation
- PostgreSQL audit-log writes

## Milestone 5 status

The MCP route now exposes read tools for tickets, customers, orders, pending actions,
and audit entries. Each tool uses bearer-role checks, per-token rate limits, Zod
validation, PII masking, untrusted-data wrapping, and audit logging.

## Milestone 5 runtime validation remaining

The automated checks pass. To finish runtime validation of the read tools:

- Start or connect a PostgreSQL database and run `npm run db:migrate`
- Optionally run `npm run db:seed` if you want to reset and reload the synthetic data
- Start the app with `npm run dev`
- Open MCP Inspector and verify the read tools through HTTP with each bearer role
- Exercise denied-role calls, rate limiting, audit-log writes, PII masking, and injection
  heuristics against the running database
- Fix any issues found during Inspector or database-backed validation

## Milestone 6 status

The proposal and manager-approval tools are implemented:

- `propose_refund` and `propose_status_change` create 24-hour pending actions and do
  not change orders or tickets.
- Managers can approve or reject pending actions. Approval applies only a simulated
  change to the mock database; refunds track the refunded total, and ticket status
  changes update the synthetic ticket.
- Refund limits, remaining order balance, separation of duties, expiry, idempotency,
  decision reasons, and audit logging are enforced.
- Proposal and decision reasons are returned as untrusted text.
- Email addresses and phone numbers in returned free text are masked for non-managers.

Automated tests, lint, and production build pass. **Manual runtime validation in MCP
Inspector is still required before this milestone is considered complete.**
Run `npm run db:migrate` before restarting the app so an existing database receives
the new columns. `npm run db:seed` resets the synthetic tables and is optional if you
want to preserve your current demo records.

Suggested Inspector checks, using the existing bearer header for each role:

1. As `support_agent`, call `propose_refund` with `order_id: "O-5001"`,
   `amount: 10`, and a reason. Confirm it returns a pending action ID. Then check
   `get_order` and confirm `refunded_total` has not changed yet.
2. As `manager`, call `approve_action` with that ID. Confirm it succeeds, then call
   `get_order` again and verify the simulated `refunded_total` changed.
3. As `support_agent`, call `propose_status_change` for `T-1001`, changing it to
   `closed`. Approve it as `manager` and confirm `get_ticket` returns the new status.
4. Propose another action as `support_agent` and reject it as `manager`. Confirm the
   action is rejected and its reason is shown as untrusted text.
5. Confirm `auditor` cannot propose, approve, or reject; confirm an agent cannot
   approve or reject; try a refund over $500 and an approval by the action's proposer.
6. Confirm each allowed and denied attempt appears in `get_audit_log`.

## Milestone 7 status

The manager dashboard is implemented at `/dashboard`:

- Manager bearer-token login sets an HTTP-only, signed dashboard session cookie.
- Pending actions can be approved or rejected using the same policy-checked handlers
  as the MCP tools.
- The audit log supports role, tool, and outcome filters.
- The dashboard shows calls today, denials today, and flagged synthetic injection data.
- The UI clearly labels all records as demo data.

Later project milestones remain to be implemented:

- Milestone 8: Vercel deployment
- Milestone 9: Claude connector testing and scenario scorecard
- Milestone 10: final customer brief, threat model, demo, and deployment documentation

### Validate the dashboard locally

These steps use only the synthetic local database and do not deploy or publish
anything.

1. **Prepare local environment variables.** If `.env.local` does not exist, copy
   `.env.example` to `.env.local`. If it already exists, preserve it and check that
   it has `DATABASE_URL`, `AGENT_TOKEN`, `MANAGER_TOKEN`, `AUDITOR_TOKEN`, and
   `DASHBOARD_SESSION_SECRET`. For the Docker database above, `DATABASE_URL` should
   point to `postgresql://postgres:postgres@localhost:54329/enterprise_ops`.
   Set the role tokens to local-only synthetic values and set a strong,
   local-only `DASHBOARD_SESSION_SECRET`. Never commit `.env.local` or use real
   credentials. Restart the Next.js server after changing these values.

2. **Start PostgreSQL.** If the container is stopped, run
   `docker start enterprise-ops-mcp-postgres`. If it does not exist yet, use the
   first-time `docker run` command in the Milestone 2 section. Wait until this
   reports that PostgreSQL is accepting connections:

   ```bash
   docker exec enterprise-ops-mcp-postgres pg_isready -U postgres -d enterprise_ops
   ```

3. **Apply the schema.** This is safe to run on an existing demo database:

   ```bash
   npm run db:migrate
   ```

   If you need the original synthetic customers, orders, tickets, and injection
   examples, run `npm run db:seed`. It resets the synthetic tables first, so skip
   it if you want to preserve existing mock records. Without seeded records, the
   dashboard can still load but pending actions and injection indicators may be
   empty.

4. **Run automated checks** from the repository root:

   ```bash
   npm test
   npm run lint
   npm run build
   ```

5. **Start the app** and leave this terminal running:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000/dashboard` and use that same browser origin for
   dashboard form submissions. In Codespaces, you can instead use the forwarded
   application URL consistently. Avoid opening the page on one host and submitting
   its forms through another; Next.js checks Server Action origins.

6. **Check manager login.** Sign in with the local `MANAGER_TOKEN`. Verify an
   incorrect token is rejected, the manager sees the dashboard, and **Sign out**
   returns to the login form. The session cookie should be HTTP-only. Agent and
   auditor tokens must not grant dashboard access.

7. **Approve a proposal.** In another terminal, launch MCP Inspector:

   ```bash
   npx @modelcontextprotocol/inspector
   ```

   Connect it to `http://localhost:3000/api/mcp` with the header
   `Authorization: Bearer <AGENT_TOKEN>`. Call `propose_refund` with
   `order_id: "O-5001"`, `amount: 10`, and a reason. Refresh the dashboard and
   confirm the action is pending and displays its proposal details. Approve it as
   the logged-in manager. Confirm the dashboard shows it approved, the audit log
   records the decision, and `get_order` in Inspector shows the simulated
   `refunded_total` increased by `$10`.

8. **Reject a proposal.** As the agent in Inspector, propose another small refund.
   Reject it in the dashboard with a reason. Confirm its status becomes rejected
   and the decision is present in the audit log. No real refund or external action
   is performed.

9. **Check audit and indicators.** Filter the audit log by role, tool, and
   outcome. Make a denied tool call in Inspector (for example, try
   `propose_refund` with the auditor token) and confirm the denial is audited and
   the denial counter updates. With seeded data, check the flagged-injection
   indicator is populated. Verify that dashboard records are clearly labelled as
   demo data.

If the dashboard reports that demo data is unavailable, check that PostgreSQL is
running, `DATABASE_URL` uses the expected host and port, and `npm run db:migrate`
has completed. Do not run `npm run db:reset` as a troubleshooting shortcut.

When finished, stop the Next.js server with `Ctrl+C`. You can stop, but do not
remove, the database container with `docker stop enterprise-ops-mcp-postgres`;
this preserves its synthetic data for the next session.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000/api/mcp` with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

## Tests

```bash
npm test
npm run lint
npm run build
```

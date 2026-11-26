# Enterprise Ops MCP Gateway

A TypeScript MCP gateway for safe AI access to mock enterprise operations data.

## Milestone 1 status

The first milestone provides a local Next.js MCP endpoint with a `whoami` tool.
Authentication, database access, policy enforcement, audit logging, and the dashboard
are intentionally not implemented yet.

## Milestone 2 status

The database milestone includes a PostgreSQL schema and deterministic synthetic seed data.
The seed contains fictional customers, orders, tickets, and one expired pending action.

For a local dummy database:

```bash
docker run -d --name enterprise-ops-mcp-postgres \
  -e POSTGRES_DB=enterprise_ops \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 54329:5432 postgres:17-alpine

npm run db:migrate
npm run db:seed
npm run db:reset  # optional: drop all gateway tables
npm run db:migrate
npm run db:seed
```

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

## Continuation / remaining work

The current code passes `npm test` (53 tests), `npm run lint`, and `npm run build`.
Before this milestone is considered runtime-validated, continue with:

- Start or connect a PostgreSQL database and run `npm run db:migrate`
- Run `npm run db:seed`
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
Inspector is still required before this milestone is complete or any code is pushed.**
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

Later project milestones remain to be implemented:

- Milestone 7: dashboard
- Milestone 8: Vercel deployment
- Milestone 9: Claude connector testing and scenario scorecard
- Milestone 10: final customer brief, threat model, demo, and deployment documentation

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

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

These modules are implemented and tested but are not yet wired into the MCP route.

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

The current code passes `npm test` (38 tests), `npm run lint`, and `npm run build`.
Before this milestone is considered runtime-validated, continue with:

- Start or connect a PostgreSQL database and run `npm run db:migrate`
- Run `npm run db:seed`
- Start the app with `npm run dev`
- Open MCP Inspector and verify the read tools through HTTP with each bearer role
- Exercise denied-role calls, rate limiting, audit-log writes, PII masking, and injection
  heuristics against the running database
- Fix any issues found during Inspector or database-backed validation

Later project milestones remain to be implemented:

- Milestone 6: write/proposal tools and manager approval flow
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

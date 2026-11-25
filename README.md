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

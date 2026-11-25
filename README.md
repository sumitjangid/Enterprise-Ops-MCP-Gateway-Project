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

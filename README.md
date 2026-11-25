# Enterprise Ops MCP Gateway

A TypeScript MCP gateway for safe AI access to mock enterprise operations data.

## Milestone 1 status

The first milestone provides a local Next.js MCP endpoint with a `whoami` tool.
Authentication, database access, policy enforcement, audit logging, and the dashboard
are intentionally not implemented yet.

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

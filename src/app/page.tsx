export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
      <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-emerald-700">
        Enterprise Ops MCP Gateway
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">MCP server ready</h1>
      <p className="mt-4 max-w-xl text-lg text-zinc-600">
        Connect to <code>/api/mcp</code> and call the <code>whoami</code> tool.
      </p>
      <a
        href="/dashboard"
        className="mt-6 w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
      >
        Open manager dashboard
      </a>
    </main>
  );
}

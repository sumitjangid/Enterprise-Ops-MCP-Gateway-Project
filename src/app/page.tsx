import Link from "next/link";

const capabilities = [
  {
    number: "01",
    title: "Role-aware access",
    description:
      "Bearer-token roles shape which operations are available to each client.",
  },
  {
    number: "02",
    title: "Human approval",
    description:
      "Write requests become pending proposals for a manager to review.",
  },
  {
    number: "03",
    title: "Auditable by design",
    description:
      "Allowed and denied tool calls are recorded for operational review.",
  },
];

export default function Home() {
  return (
    <main className="landing-page">
      <header className="site-header">
        <Link className="brand-lockup" href="/" aria-label="Gateway home">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span className="brand-name">ENTERPRISE OPS / MCP GATEWAY</span>
        </Link>
        <span className="server-status">
          <span className="status-dot" aria-hidden="true" />
          Service online
        </span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A safer way to connect operations</p>
          <h1>
            Enterprise work,
            <br />
            <span>with guardrails.</span>
          </h1>
          <p className="hero-description">
            A demo MCP gateway for synthetic customers, orders, and support
            tickets. Requests are checked against role-based policies, and
            changes wait for manager approval.
          </p>
          <div className="hero-actions">
            <Link className="button-primary" href="/dashboard">
              Open manager dashboard <span aria-hidden="true">→</span>
            </Link>
            <a className="button-secondary" target="_blank" href="https://mcp-inspector-demo.vercel.app/">
              Connect an MCP client
            </a>
          </div>
        </div>

        <aside className="endpoint-card" id="connect">
          <p className="section-label">MCP endpoint</p>
          <h2 className="endpoint-heading">Connect with Streamable HTTP</h2>
          <code className="endpoint-url">/api/mcp</code>
          <p className="endpoint-note">
            Use this endpoint in an MCP client and provide a role-specific
            bearer token. Opening this URL in a browser is not an Inspector.
          </p>
        </aside>
      </section>

      <section className="feature-grid" aria-label="Gateway safeguards">
        {capabilities.map((capability) => (
          <article className="feature-card" key={capability.number}>
            <span className="feature-number">{capability.number}</span>
            <h2>{capability.title}</h2>
            <p className="feature-description">{capability.description}</p>
          </article>
        ))}
      </section>

      <footer className="page-footer">
        <span>ENTERPRISE OPS MCP GATEWAY</span>
        <span>Demo environment · Synthetic data only</span>
      </footer>
    </main>
  );
}

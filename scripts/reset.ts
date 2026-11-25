import { createDatabaseClient } from "./db-client";

async function reset() {
  const client = createDatabaseClient();
  await client.connect();

  try {
    await client.query(
      `DROP TABLE IF EXISTS
        rate_counters, audit_log, pending_actions, tickets, orders, customers
       CASCADE`,
    );
    console.log("Database tables dropped.");
  } finally {
    await client.end();
  }
}

reset().catch((error: unknown) => {
  console.error("Database reset failed:", error);
  process.exitCode = 1;
});

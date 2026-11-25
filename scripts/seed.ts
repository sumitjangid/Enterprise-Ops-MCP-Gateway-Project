import { createDatabaseClient } from "./db-client";
import { createSeedData } from "../src/db/seed-data";

async function seed() {
  const client = createDatabaseClient();
  await client.connect();
  const { customers, orders, tickets, expiredAction } = createSeedData();

  try {
    await client.query("BEGIN");
    await client.query(
      "TRUNCATE TABLE rate_counters, audit_log, pending_actions, tickets, orders, customers RESTART IDENTITY CASCADE",
    );

    for (const customer of customers) {
      await client.query(
        "INSERT INTO customers (id, name, email, tier, notes) VALUES ($1, $2, $3, $4, $5)",
        [customer.id, customer.name, customer.email, customer.tier, customer.notes],
      );
    }

    for (const order of orders) {
      await client.query(
        "INSERT INTO orders (id, customer_id, total, status, created_at) VALUES ($1, $2, $3, $4, $5)",
        [order.id, order.customerId, order.total, order.status, order.createdAt],
      );
    }

    for (const ticket of tickets) {
      await client.query(
        "INSERT INTO tickets (id, customer_id, subject, body, status, priority, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          ticket.id,
          ticket.customerId,
          ticket.subject,
          ticket.body,
          ticket.status,
          ticket.priority,
          ticket.createdAt,
        ],
      );
    }

    await client.query(
      `INSERT INTO pending_actions
       (id, type, payload, requested_by, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        expiredAction.id,
        expiredAction.type,
        expiredAction.payload,
        expiredAction.requestedBy,
        expiredAction.status,
        expiredAction.createdAt,
        expiredAction.expiresAt,
      ],
    );

    await client.query("COMMIT");
    console.log(
      `Seed completed: ${customers.length} customers, ${orders.length} orders, ${tickets.length} tickets.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

seed().catch((error: unknown) => {
  console.error("Database seed failed:", error);
  process.exitCode = 1;
});

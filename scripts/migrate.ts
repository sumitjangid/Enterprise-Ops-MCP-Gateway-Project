import { readFile } from "node:fs/promises";
import path from "node:path";

import { createDatabaseClient } from "./db-client";

async function migrate() {
  const client = createDatabaseClient();
  await client.connect();

  try {
    const schemaPath = path.join(process.cwd(), "src/db/schema.sql");
    const schema = await readFile(schemaPath, "utf8");
    await client.query(schema);
    console.log("Database migration completed.");
  } finally {
    await client.end();
  }
}

migrate().catch((error: unknown) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});

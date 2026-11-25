import { config } from "dotenv";
import { Client } from "pg";

config({ path: [".env.local", ".env"] });

const localDatabaseUrl =
  "postgresql://postgres:postgres@localhost:54329/enterprise_ops";

export function createDatabaseClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL ?? localDatabaseUrl,
  });
}

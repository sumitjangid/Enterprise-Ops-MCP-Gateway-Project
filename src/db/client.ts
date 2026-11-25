import { config } from "dotenv";
import { Pool } from "pg";

config({ path: [".env.local", ".env"] });

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:54329/enterprise_ops";

const globalForDb = globalThis as typeof globalThis & {
  enterpriseOpsPool?: Pool;
};

export const db =
  globalForDb.enterpriseOpsPool ??
  new Pool({
    connectionString,
    max: 5,
  });

globalForDb.enterpriseOpsPool = db;

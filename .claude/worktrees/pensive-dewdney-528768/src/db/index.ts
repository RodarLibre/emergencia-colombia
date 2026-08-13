import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Copy .env.example to .env");
}

/**
 * A single connection reused across reloads in development, so Next's hot
 * reload doesn't exhaust the pool.
 */
const globalForDb = globalThis as unknown as {
  __ayudaSql?: ReturnType<typeof postgres>;
};

/**
 * Named `client` and not `sql` on purpose: `sql` is drizzle-orm's template
 * tag, and having both share a name is confusing.
 */
const client = globalForDb.__ayudaSql ?? postgres(connectionString, { max: 8 });
if (process.env.NODE_ENV !== "production") globalForDb.__ayudaSql = client;

export const db = drizzle(client, { schema });
export { client, schema };

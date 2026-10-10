import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import * as schema from "@workspace/shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const applicationPool = new Pool({ connectionString: process.env.DATABASE_URL });
// Only scheduled checks use this pool. Bound connection and SQL waits without
// changing interactive requests, exports, or schema-management commands.
const jobPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10,
  connectionTimeoutMillis: 500, statement_timeout: 500, query_timeout: 650 });
const jobScope = new AsyncLocalStorage<boolean>();
export function withJobDatabase<T>(work: () => Promise<T>): Promise<T> {
  return jobScope.run(true, work);
}
export const pool = new Proxy(applicationPool, {
  get(target, property) {
    if (property === 'end') return async () => { await Promise.all([applicationPool.end(), jobPool.end()]); };
    const selected = jobScope.getStore() ? jobPool : target;
    const value = Reflect.get(selected, property);
    return typeof value === 'function' ? value.bind(selected) : value;
  },
});
const applicationDb = drizzle(applicationPool, { schema });
const jobDb = drizzle(jobPool, { schema });
export const db = new Proxy(applicationDb, {
  get(target, property) {
    const selected = jobScope.getStore() ? jobDb : target;
    const value = Reflect.get(selected, property);
    return typeof value === 'function' ? value.bind(selected) : value;
  },
});

export * from "@workspace/shared/schema";

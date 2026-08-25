import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const databasePath = process.env.DATABASE_PATH || "./data/app.db";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

function ensureDataDirExists(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __dinnerPlannerDb: DrizzleDb | undefined;
  // eslint-disable-next-line no-var
  var __dinnerPlannerMigrated: boolean | undefined;
}

function createDb(): DrizzleDb {
  ensureDataDirExists(databasePath);
  // A generous busy timeout avoids spurious SQLITE_BUSY errors when multiple
  // processes open the same file concurrently — better-sqlite3 will retry
  // internally instead of throwing.
  const sqlite = new Database(databasePath, { timeout: 10000 });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const drizzleDb = drizzle(sqlite, { schema });

  if (!globalThis.__dinnerPlannerMigrated) {
    const migrationsFolder = path.join(process.cwd(), "drizzle");
    if (fs.existsSync(migrationsFolder)) {
      try {
        migrate(drizzleDb, { migrationsFolder });
      } catch (err) {
        console.error("Database migration failed:", err);
      }
    }
    globalThis.__dinnerPlannerMigrated = true;
  }

  return drizzleDb;
}

/**
 * Returns the process-wide singleton connection, opening it on first use.
 *
 * Cached on globalThis in EVERY environment, not just development. During
 * `next build` (which runs with NODE_ENV=production) the module graph is
 * instantiated repeatedly across build workers, and a production-only cache
 * miss meant every instantiation opened its own better-sqlite3 handle.
 */
function getDb(): DrizzleDb {
  if (!globalThis.__dinnerPlannerDb) {
    globalThis.__dinnerPlannerDb = createDb();
  }
  return globalThis.__dinnerPlannerDb;
}

/**
 * Lazy database handle.
 *
 * This is deliberately a Proxy rather than `export const db = createDb()`.
 * Opening the connection eagerly at import time meant that merely *importing*
 * this module — which `next build` does for every route while collecting page
 * data — opened a native SQLite handle in a short-lived worker. Those handles
 * are torn down after the V8 environment goes away, tripping better-sqlite3's
 * `RemoveEnvironmentCleanupHook` assertion and aborting the build. It also
 * meant a production build silently ran migrations against the live database.
 *
 * Deferring to first property access keeps import side-effect free: routes are
 * all dynamic, so nothing touches the database until a request actually runs.
 */
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const real = getDb();
    // Read straight off the real handle, never with the proxy as receiver —
    // that would re-enter this trap from any getter touching `this`.
    const value = (real as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, prop) {
    return Reflect.has(getDb() as object, prop);
  },
});

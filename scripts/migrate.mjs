// Standalone migration runner used by `npm run db:migrate` and by the
// Docker container's startup entrypoint (scripts/start.js).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const databasePath = process.env.DATABASE_PATH || "./data/app.db";
const dir = path.dirname(databasePath);

if (dir && dir !== "." && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(databasePath, { timeout: 10000 });
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite);

const migrationsFolder = path.join(process.cwd(), "drizzle");

if (fs.existsSync(migrationsFolder)) {
  console.log(`Applying migrations from ${migrationsFolder} to ${databasePath}...`);
  migrate(db, { migrationsFolder });
  console.log("Migrations complete.");
} else {
  console.warn(`No migrations folder found at ${migrationsFolder}, skipping.`);
}

sqlite.close();

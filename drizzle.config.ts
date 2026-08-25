import type { Config } from "drizzle-kit";

const databasePath = process.env.DATABASE_PATH || "./data/app.db";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
} satisfies Config;

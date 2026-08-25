import { sqliteTable, text, integer, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const SCOPES = ["shared", "private"] as const;
export type Scope = (typeof SCOPES)[number];

export const MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

// Recipes can additionally be tagged "any" (eligible for every meal slot).
export const RECIPE_MEAL_TYPES = ["breakfast", "lunch", "dinner", "any"] as const;
export type RecipeMealType = (typeof RECIPE_MEAL_TYPES)[number];

export const VISIBILITIES = ["shared", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerified: integer("email_verified", { mode: "timestamp" }),
  verificationToken: text("verification_token"),
  verificationTokenExpires: integer("verification_token_expires", {
    mode: "timestamp",
  }),
  // 'admin' | 'member'. The very first user ever created is bootstrapped as admin.
  role: text("role").notNull().default("member"),
  // Set only on the very first user ever created, alongside role: 'admin'.
  // Fixed permanently at bootstrap — never granted or revoked afterward.
  // The global admin's role/active status can never be changed via the
  // admin API, guaranteeing the system always has at least one admin.
  isGlobalAdmin: integer("is_global_admin", { mode: "boolean" })
    .notNull()
    .default(false),
  // Deactivated users cannot log in.
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  // Set when an admin invites this user by email (pending account, not yet
  // activated). Distinct from verificationToken/-Expires (self-signup email
  // verification) to avoid ambiguity between the two flows — see
  // /api/invite/accept.
  inviteToken: text("invite_token"),
  inviteTokenExpires: integer("invite_token_expires", {
    mode: "timestamp",
  }),
  // Per-user permission: whether this (non-admin) user can view/edit the
  // shared household calendar. Admins always have full access; this only
  // gates members. Toggled by an admin from /admin.
  canAccessSharedCalendar: integer("can_access_shared_calendar", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  // Self-service email change (see /api/preferences/email). Deliberately a
  // THIRD, separate token pair from verificationToken (self-signup) and
  // inviteToken (admin invite): all three can legitimately be outstanding at
  // once, and reusing either would make it ambiguous which flow a token
  // belongs to. `email` stays the live login address until the link sent to
  // `pendingEmail` is consumed, so a typo can never lock a user out.
  pendingEmail: text("pending_email"),
  pendingEmailToken: text("pending_email_token"),
  pendingEmailTokenExpires: integer("pending_email_token_expires", {
    mode: "timestamp",
  }),
  // 'light' | 'dark' | 'system'. Mirrors the browser-local
  // `dinner-planner-theme` localStorage value so the choice follows the user
  // to a new device; localStorage remains the pre-hydration (no-flash)
  // source and the DB is the tie-breaker on login. See ThemeSync.
  themePreference: text("theme_preference").notNull().default("system"),
  // Opt-in: draw this user's OWN external calendar events alongside the
  // meal grid (see src/lib/calendar/read.ts). Defaults to FALSE on
  // purpose — pulling somebody's calendar onto a shared-household screen
  // without them asking is exactly the kind of surprise worth avoiding,
  // so reading only ever happens because the user turned it on. This flag
  // gates the fetch itself, not just the rendering.
  showCalendarOverlay: integer("show_calendar_overlay", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const recipes = sqliteTable("recipes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ingredients: text("ingredients").notNull(),
  instructions: text("instructions").notNull(),
  prepTimeMinutes: integer("prep_time_minutes"),
  cookTimeMinutes: integer("cook_time_minutes"),
  servings: integer("servings"),
  tags: text("tags").notNull().default(""),
  sourceUrl: text("source_url"),
  notes: text("notes"),
  // 'shared' (in the household pool, admin-managed) | 'private' (owned by one user)
  visibility: text("visibility").notNull().default("shared"),
  // Set only when visibility = 'private'; the owning user.
  ownerUserId: text("owner_user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  // Comma-separated subset of breakfast/lunch/dinner/any. "any" makes the
  // recipe eligible for every meal slot.
  mealType: text("meal_type").notNull().default("any"),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const planEntries = sqliteTable(
  "plan_entries",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),
    // 'shared' (household calendar) | 'private' (one user's own calendar)
    scope: text("scope").notNull().default("shared"),
    // Scoping key: for scope='private' this is the owning user's id
    // (required). For scope='shared' this is the empty string — kept
    // non-null (rather than NULL) so the unique index below actually
    // enforces "one entry per date+meal" for the shared calendar (SQLite
    // treats NULLs as distinct in unique indexes, which would otherwise
    // allow duplicate shared rows for the same date/meal).
    userId: text("user_id").notNull().default(""),
    mealType: text("meal_type").notNull().default("dinner"),
    recipeId: text("recipe_id").references(() => recipes.id, {
      onDelete: "set null",
    }),
    // Who last created/edited this entry (always populated, for audit —
    // distinct from `userId` above, which is the *ownership/scoping* key).
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    dateScopeUserMeal: unique().on(
      table.date,
      table.scope,
      table.userId,
      table.mealType
    ),
  })
);

export const shoppingListStatus = sqliteTable(
  "shopping_list_status",
  {
    id: text("id").primaryKey(),
    // 'shared' (household calendar) | 'private' (one user's own calendar)
    scope: text("scope").notNull().default("shared"),
    // Scoping key: same convention as plan_entries.userId — the owning
    // user's id for scope='private', empty string (not NULL) for 'shared'.
    userId: text("user_id").notNull().default(""),
    date: text("date").notNull(),
    mealType: text("meal_type").notNull(),
    ingredientText: text("ingredient_text").notNull(),
    onHand: integer("on_hand", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedByUserId: text("updated_by_user_id").references(() => users.id),
  },
  (table) => ({
    scopeUserDateMealIngredient: unique().on(
      table.scope,
      table.userId,
      table.date,
      table.mealType,
      table.ingredientText
    ),
  })
);

// Fixed id for the (only ever one) SMTP settings row — see appSettings
// below. Upserts always target this id, which keeps the table a singleton
// without needing a separate "is there already a row?" check.
export const SMTP_SETTINGS_ID = "smtp";

// Generic-ish app settings table, currently used only for SMTP config.
// Each logical settings group is a singleton row identified by a fixed,
// well-known id (see SMTP_SETTINGS_ID) rather than one row per app — this
// keeps the "there's only ever one of these" invariant enforceable via a
// plain primary-key upsert instead of extra application-level locking.
export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey(),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  // AES-256-GCM ciphertext (iv:authTag:ciphertext, hex-encoded) — see
  // src/lib/crypto.ts. Never the plaintext password.
  smtpPassEncrypted: text("smtp_pass_encrypted"),
  smtpFrom: text("smtp_from"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
});

export const CALENDAR_PROVIDERS = ["google", "caldav"] as const;
export type CalendarProviderName = (typeof CALENDAR_PROVIDERS)[number];

// Fixed id for the (only ever one) Google OAuth client settings row.
// Deliberately a SEPARATE singleton table from `app_settings` rather than
// extra columns on it: app_settings' only row id is literally 'smtp' and
// every column on it is SMTP-specific, so overloading it would muddle two
// unrelated settings groups. Same singleton pattern, different table.
export const GOOGLE_OAUTH_SETTINGS_ID = "google";

/**
 * Deployment plumbing for per-user Google Calendar OAuth: the OAuth
 * **client** credentials, registered once by an admin in Google Cloud.
 *
 * This is the ONLY calendar configuration an admin owns. There is
 * deliberately no app-owned or admin-owned calendar *connection* — each
 * user connects their own Google account (see calendarAccounts) and picks
 * their own target calendars (see calendarTargets), and no admin has any
 * path to read or operate those.
 */
export const googleOauthSettings = sqliteTable("google_oauth_settings", {
  id: text("id").primaryKey(),
  clientId: text("client_id"),
  // AES-256-GCM ciphertext (iv:authTag:ciphertext, hex) — see
  // src/lib/crypto.ts. Never returned to any client, in any form.
  clientSecretEncrypted: text("client_secret_encrypted"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
});

/**
 * One row per user per provider: the Google account that user authorized.
 *
 * The refresh token is the long-lived credential; access tokens are minted
 * from it on demand and never stored. Rows are owned by exactly one user
 * and are only ever reachable through the session's own user id — there is
 * no admin override anywhere in the codebase, by design.
 */
export const calendarAccounts = sqliteTable(
  "calendar_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'google' | 'caldav'. UNIQUE(userId, provider) below means a user can
    // hold one of each at once.
    provider: text("provider").notNull().default("google"),
    // --- google ---
    // AES-256-GCM ciphertext of the OAuth refresh token.
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    // The Google account's email address, used purely as a human label so
    // the user can tell which account they connected.
    accountEmail: text("account_email"),
    // Space-separated OAuth scopes actually granted.
    scopes: text("scopes").notNull().default(""),
    // --- caldav ---
    // Kept in their own columns rather than overloaded onto the Google
    // ones: a refresh token and a server password are different secrets
    // with different lifecycles, and a column named for one holding the
    // other is exactly the kind of thing that later gets logged by
    // accident.
    //
    // The URL is stored as the user typed it (validated https-only and
    // SSRF-screened first — see src/lib/calendar/caldavUrl.ts) and never
    // contains credentials; embedded userinfo is rejected at save time.
    caldavServerUrl: text("caldav_server_url"),
    caldavUsername: text("caldav_username"),
    // AES-256-GCM ciphertext of the app-specific password. Never returned
    // by any endpoint, in any form — the API exposes only a
    // `hasPassword` boolean.
    caldavPasswordEncrypted: text("caldav_password_encrypted"),
    // Calendar-home collection discovered at connect time, cached so the
    // calendar picker doesn't repeat the full RFC 6764 walk every load.
    caldavHomeUrl: text("caldav_home_url"),
    // Set when Google rejects the refresh token (the user revoked access,
    // or the OAuth consent screen is still in "Testing" so Google expired
    // it after ~7 days). Drives the UI's "Reconnect your Google account"
    // state — a silently dead sync is worse than no sync at all.
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userProvider: unique().on(table.userId, table.provider),
  })
);

/**
 * Where one user mirrors one plan. A user can have at most two: the
 * household ('shared') plan and their own ('private') plan.
 *
 * `userId` is denormalized from the parent account on purpose: every
 * authorization check and the shared-plan fan-out query key off it, which
 * makes both a direct lookup instead of a join through calendar_accounts.
 */
export const calendarTargets = sqliteTable(
  "calendar_targets",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Which plan is mirrored: 'shared' (household) | 'private' (own).
    scope: text("scope").notNull(),
    // The Google calendar id (often an email-like string).
    calendarId: text("calendar_id").notNull(),
    // Its display name at the time it was chosen, for labelling.
    calendarName: text("calendar_name"),
    // When false (the default) pushed events carry only the meal title —
    // no ingredients or instructions leave the app.
    includeDetail: integer("include_detail", { mode: "boolean" })
      .notNull()
      .default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
    lastSyncError: text("last_sync_error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userScope: unique().on(table.userId, table.scope),
  })
);

/**
 * Single-use, short-lived OAuth `state` values.
 *
 * Kept server-side (rather than only in a cookie) so that "already
 * consumed" is a real database fact rather than something we hope the
 * browser honoured. A callback carrying a state that is missing, unknown,
 * expired, already used, or minted for a DIFFERENT user than the current
 * session is rejected outright — that check is the only thing standing
 * between us and an attacker attaching *their* Google account to *your*
 * Pickl user (or vice versa).
 */
export const oauthStates = sqliteTable("oauth_states", {
  // The random state value itself is the primary key.
  state: text("state").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("google"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  // Stamped the moment the state is redeemed; a second redemption of the
  // same value is rejected.
  usedAt: integer("used_at", { mode: "timestamp" }),
});

/**
 * Idempotency map from a plan slot (date + meal) to the event we created
 * on the provider, so later pushes update/delete that event instead of
 * creating duplicates. Keyed per TARGET: the same household meal now
 * produces one event in each participating user's own calendar.
 */
export const calendarEventLinks = sqliteTable(
  "calendar_event_links",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => calendarTargets.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    mealType: text("meal_type").notNull(),
    // The provider's own event id. For CalDAV there is no server-assigned
    // id, so this holds the resource URL we PUT to — which is itself
    // derived from a stable UID (see src/lib/calendar/caldav.ts).
    externalEventId: text("external_event_id").notNull(),
    // The provider's version tag as of our last write, when it issues one
    // (CalDAV ETag). Drives If-Match, so a concurrent edit is detected
    // rather than silently clobbered. Always null for Google.
    etag: text("etag"),
    lastPushedAt: integer("last_pushed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    targetDateMeal: unique().on(table.targetId, table.date, table.mealType),
  })
);

/**
 * One row per user: how that user has arranged the /plan dashboard widgets.
 *
 * Keyed by userId as the PRIMARY KEY rather than a surrogate id, which makes
 * "a user has exactly one layout" an invariant of the table instead of
 * something the application has to keep true. Writes are a plain upsert on
 * that key.
 *
 * `layoutJson` holds the serialized DashboardLayout (see
 * src/lib/dashboard/widgets.ts): a version tag, the placed items, and the
 * ids of widgets the user has deliberately taken off the board. It is
 * deliberately opaque to SQL — nothing queries inside it, and every read
 * goes through reconcileLayout(), which is what lets the widget registry
 * change shape without a data migration.
 *
 * There is no scope/userId-pair convention here as there is on plan_entries:
 * a dashboard arrangement belongs to a person, not to a calendar, and the
 * owning user is always taken from the session — never from a request body.
 */
export const dashboardLayouts = sqliteTable("dashboard_layouts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  layoutJson: text("layout_json").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  // Who performed the action.
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  scope: text("scope"),
  // Whose calendar was affected (for private scope).
  targetUserId: text("target_user_id").references(() => users.id),
  date: text("date"),
  mealType: text("meal_type"),
  oldRecipeId: text("old_recipe_id"),
  newRecipeId: text("new_recipe_id"),
  notes: text("notes"),
});

export const recipesRelations = relations(recipes, ({ one }) => ({
  createdBy: one(users, {
    fields: [recipes.createdByUserId],
    references: [users.id],
  }),
  owner: one(users, {
    fields: [recipes.ownerUserId],
    references: [users.id],
  }),
}));

export const planEntriesRelations = relations(planEntries, ({ one }) => ({
  recipe: one(recipes, {
    fields: [planEntries.recipeId],
    references: [recipes.id],
  }),
  createdBy: one(users, {
    fields: [planEntries.createdByUserId],
    references: [users.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, {
    fields: [auditLog.userId],
    references: [users.id],
  }),
  targetUser: one(users, {
    fields: [auditLog.targetUserId],
    references: [users.id],
  }),
  oldRecipe: one(recipes, {
    fields: [auditLog.oldRecipeId],
    references: [recipes.id],
  }),
  newRecipe: one(recipes, {
    fields: [auditLog.newRecipeId],
    references: [recipes.id],
  }),
}));

export const calendarAccountsRelations = relations(
  calendarAccounts,
  ({ one, many }) => ({
    user: one(users, {
      fields: [calendarAccounts.userId],
      references: [users.id],
    }),
    targets: many(calendarTargets),
  })
);

export const calendarTargetsRelations = relations(
  calendarTargets,
  ({ one, many }) => ({
    account: one(calendarAccounts, {
      fields: [calendarTargets.accountId],
      references: [calendarAccounts.id],
    }),
    user: one(users, {
      fields: [calendarTargets.userId],
      references: [users.id],
    }),
    eventLinks: many(calendarEventLinks),
  })
);

export const calendarEventLinksRelations = relations(
  calendarEventLinks,
  ({ one }) => ({
    target: one(calendarTargets, {
      fields: [calendarEventLinks.targetId],
      references: [calendarTargets.id],
    }),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type PlanEntry = typeof planEntries.$inferSelect;
export type NewPlanEntry = typeof planEntries.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
export type ShoppingListStatus = typeof shoppingListStatus.$inferSelect;
export type NewShoppingListStatus = typeof shoppingListStatus.$inferInsert;
export type AppSettings = typeof appSettings.$inferSelect;
export type NewAppSettings = typeof appSettings.$inferInsert;
export type GoogleOauthSettings = typeof googleOauthSettings.$inferSelect;
export type NewGoogleOauthSettings = typeof googleOauthSettings.$inferInsert;
export type CalendarAccount = typeof calendarAccounts.$inferSelect;
export type NewCalendarAccount = typeof calendarAccounts.$inferInsert;
export type CalendarTarget = typeof calendarTargets.$inferSelect;
export type NewCalendarTarget = typeof calendarTargets.$inferInsert;
export type OauthState = typeof oauthStates.$inferSelect;
export type NewOauthState = typeof oauthStates.$inferInsert;
export type CalendarEventLink = typeof calendarEventLinks.$inferSelect;
export type NewCalendarEventLink = typeof calendarEventLinks.$inferInsert;
export type DashboardLayoutRow = typeof dashboardLayouts.$inferSelect;
export type NewDashboardLayoutRow = typeof dashboardLayouts.$inferInsert;

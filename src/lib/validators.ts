import { z } from "zod";

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    email: z.string().trim().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, "Password is required"),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email(),
});

// Admins can grant Member or Admin — never Global Admin (there's no UI
// path to grant that; it's fixed at bootstrap only).
export const adminAssignableRoleSchema = z.enum(["admin", "member"]);

export const adminManualAddUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Enter a valid email address"),
  role: adminAssignableRoleSchema,
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const adminInviteUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Enter a valid email address"),
  role: adminAssignableRoleSchema,
});

export const acceptInviteSchema = z
  .object({
    token: z.string().min(1, "Missing invite token"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// ---------------------------------------------------------------------------
// Self-service user preferences (/preferences). Every one of these operates
// on the logged-in user's OWN record only — none of them accepts a user id,
// deliberately: the id always comes from the server-side session.
// ---------------------------------------------------------------------------

export const profileNameSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
});

export const emailChangeRequestSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  // Confirming with the current password is what stops a hijacked open
  // session from quietly moving the account to another address.
  currentPassword: z.string().min(1, "Current password is required"),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    // Same rule as signupSchema — kept in lockstep deliberately.
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const themePreferenceSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
});

export const recipeMealTypeSchema = z.enum([
  "breakfast",
  "lunch",
  "dinner",
  "any",
]);

export const recipeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(300),
  // Optional on purpose. A recipe you can shake for is often just a name -
  // "Leftovers", "Fish and chips", something you already know how to cook.
  // Requiring the full write-up turns adding one into a chore and stops the
  // jar getting filled. Stored as "" rather than NULL to keep the existing
  // NOT NULL columns, so no migration and no null-handling downstream.
  ingredients: z.string().trim().optional().default(""),
  instructions: z.string().trim().optional().default(""),
  prepTimeMinutes: z.coerce.number().int().min(0).nullable().optional(),
  cookTimeMinutes: z.coerce.number().int().min(0).nullable().optional(),
  servings: z.coerce.number().int().min(0).nullable().optional(),
  // Still typed as one comma-separated string: the recipe form is
  // deliberately unchanged, and parseTagInput (src/lib/tags.ts) splits it
  // into rows. An array is accepted too, for API clients.
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .default("")
    .transform((v) => (Array.isArray(v) ? v.join(",") : v)),
  sourceUrl: z
    .union([z.string().trim().url(), z.literal("")])
    .nullable()
    .optional(),
  notes: z.string().trim().nullable().optional(),
  visibility: z.enum(["shared", "private"]).default("shared"),
  mealType: z
    .array(recipeMealTypeSchema)
    .min(1, "Pick at least one meal type")
    .default(["any"])
    // "any" already means every slot, so pairing it with specific meals is
    // either redundant or contradictory. Collapse it here as well as in the
    // form, so an API client cannot store ["any","dinner"] and leave the UI
    // showing a state it will not let you create.
    .transform((v) => (v.includes("any") ? ["any"] : v)),
});

// ---------------------------------------------------------------------------
// Tag management (/api/tags). A tag has no owner and no visibility of its
// own — which recipes an edit reaches is decided server-side from the
// session user's existing recipe permissions (see src/lib/tags.ts), so none
// of these schemas carries a user id or a scope.
// ---------------------------------------------------------------------------

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a tag name")
  .max(60, "Tag names are limited to 60 characters");

export const createTagSchema = z.object({ name: tagNameSchema });

export const updateTagSchema = z.object({
  name: tagNameSchema,
  // Renaming onto a name that already exists MERGES the two tags. The
  // client must have shown that and had it confirmed; without this flag the
  // route refuses with 409 rather than merging on a guess.
  confirmMerge: z.boolean().default(false),
});

export const scopeSchema = z.enum(["shared", "private"]);
export const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner"]);

export const planEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  recipeId: z.string().nullable(),
  scope: scopeSchema.default("shared"),
  mealType: mealTypeSchema,
  userId: z.string().nullable().optional(),
});

export const spinTodaySchema = z.object({
  mealTypes: z.array(mealTypeSchema).min(1, "Pick at least one meal"),
  scope: scopeSchema.default("shared"),
  userId: z.string().nullable().optional(),
  force: z.boolean().default(false),
});

export const shoppingListStatusSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  mealType: mealTypeSchema,
  ingredientText: z.string().trim().min(1, "Ingredient text is required"),
  onHand: z.boolean(),
  scope: scopeSchema.default("shared"),
  userId: z.string().nullable().optional(),
});

// Admin SMTP settings form. All fields optional/blank-able: a blank
// smtpHost means "no DB override, fall back to env vars" (see
// src/lib/mail.ts); a blank smtpPassword on PUT means "leave the
// currently-stored password unchanged" (never overwrite with empty).
export const smtpSettingsSchema = z.object({
  smtpHost: z.string().trim().max(255).default(""),
  smtpPort: z.coerce.number().int().min(1).max(65535).nullable().optional(),
  smtpUser: z.string().trim().max(255).default(""),
  smtpPassword: z.string().default(""),
  smtpFrom: z.string().trim().max(255).default(""),
});

export const smtpTestEmailSchema = z.object({
  to: z.string().trim().email("Enter a valid email address"),
});

export const calendarProviderSchema = z.enum(["google", "caldav"]);

// Admin-level Google OAuth CLIENT credentials (deployment plumbing, the
// same category as the SMTP settings above — and the only calendar config
// an admin owns). `clientSecret` follows the same rule as smtpPassword:
// blank on PUT means "keep the currently-stored secret unchanged", never
// overwrite with empty.
export const googleOauthSettingsSchema = z.object({
  clientId: z.string().trim().max(500).default(""),
  clientSecret: z.string().default(""),
  enabled: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Per-user calendar sync targets (/api/calendar/**). Like the preferences
// schemas above, NONE of these accepts a user id — the owner always comes
// from the server-side session. A target is addressed by its own id, and
// the route resolves it with getOwnedTarget(sessionUserId, targetId), so a
// borrowed id from another user simply fails to resolve.
// ---------------------------------------------------------------------------

/**
 * Connecting a CalDAV server (/api/calendar/caldav/connect).
 *
 * Only shape is checked here. The URL's *safety* — https-only, no
 * embedded credentials, not pointed at an internal address — is enforced
 * server-side in src/lib/calendar/caldavUrl.ts, because part of it needs
 * DNS and none of it should be trusted to a client-side check.
 *
 * `password` follows the smtpPassword convention: blank means "keep the
 * stored one", so editing a URL never requires re-typing the secret.
 */
export const caldavConnectSchema = z.object({
  serverUrl: z.string().trim().min(1, "Enter your CalDAV server URL").max(500),
  username: z.string().trim().min(1, "Enter your CalDAV username").max(300),
  password: z.string().max(1000).default(""),
});

export const calendarTargetSchema = z.object({
  scope: scopeSchema,
  // Which connected account the target belongs to. A user may have both a
  // Google and a CalDAV account; UNIQUE(userId, scope) still means one
  // target per plan, so this says which provider that one target uses.
  provider: calendarProviderSchema.default("google"),
  // null / "" means "Don't sync this plan" — removes the target.
  calendarId: z.string().trim().max(500).nullable().default(null),
  calendarName: z.string().trim().max(300).nullable().optional(),
  includeDetail: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

/**
 * The read-back overlay opt-in. A single boolean and nothing else: there
 * is deliberately no user id here, and no per-calendar variant — the
 * choice is "show me my own events on my plan grid, or don't".
 */
export const calendarOverlaySchema = z.object({
  enabled: z.boolean(),
});

export const calendarSyncNowSchema = z.object({
  scope: scopeSchema,
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .optional(),
});

export const spinWeekSchema = z.object({
  mealTypes: z.array(mealTypeSchema).min(1, "Pick at least one meal"),
  scope: scopeSchema.default("shared"),
  userId: z.string().nullable().optional(),
  overwriteExisting: z.boolean().default(false),
});

/**
 * A saved /plan dashboard arrangement.
 *
 * Note what is NOT in this schema: a user id. The owner of a layout is
 * always the session user, so there is no field here a client could use to
 * aim a write at somebody else's board. An unknown extra key (including a
 * hopeful "userId") is dropped by Zod's default object stripping and never
 * reaches the store.
 *
 * The shape is validated loosely on purpose — reconcileLayout in
 * src/lib/dashboard/widgets.ts is the thing that clamps geometry, drops
 * unknown widget ids and fills in missing ones. This only rejects input that
 * is not structurally a layout at all.
 */
export const dashboardLayoutSchema = z.object({
  items: z
    .array(
      z.object({
        i: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      })
    )
    .max(50),
  hidden: z.array(z.string()).max(50).default([]),
});

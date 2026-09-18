import { and, eq, or } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { parseRecipeMealTypes, recipes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { canEditRecipe, householdScope, isAdmin } from "@/lib/permissions";
import { attachTagsToRecipe } from "@/lib/tags";
import { splitIngredients } from "@/lib/ingredients";
import RecipeCopyButton from "@/components/recipes/RecipeCopyButton";
import RecipeCookingView from "@/components/recipes/RecipeCookingView";

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  any: "Any meal",
};

export async function generateMetadata({ params }: { params: { id: string } }) {
  const session = await auth();
  const recipe = session?.user ? findVisible(params.id, session.user) : undefined;
  return { title: recipe ? `${recipe.name} · Pickl` : "Recipe · Pickl" };
}

/**
 * The recipe itself, for cooking from: ingredients, the method, and the
 * details around them — opened from a recipe tile or the plan's quick look.
 *
 * Readable by anyone who can see the recipe on the Recipes page (the House
 * Jar, plus your own Secret Stash); editing stays behind the Edit button and
 * its own permission check. Anything else is a plain 404, so a private
 * recipe's existence isn't revealed by its id.
 */
export default async function RecipePage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) notFound();
  const recipe = findVisible(params.id, session.user);
  if (!recipe) notFound();

  const householdId = householdScope(session.user)!;
  const withTags = attachTagsToRecipe(householdId, recipe);
  const admin = isAdmin(session.user);
  const editable = canEditRecipe(session.user, recipe);
  const copyTarget =
    recipe.visibility === "shared"
      ? ("private" as const)
      : recipe.ownerUserId === session.user.id && admin
        ? ("shared" as const)
        : null;

  const totalMinutes =
    recipe.prepTimeMinutes != null || recipe.cookTimeMinutes != null
      ? (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0)
      : null;
  // Only real web links become links; anything else is shown as text.
  const sourceIsLink = Boolean(recipe.sourceUrl && /^https?:\/\//i.test(recipe.sourceUrl));

  return (
    <div style={{ maxWidth: "56rem" }}>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <Link href={recipe.visibility === "private" ? "/recipes?tab=mine" : "/recipes"} className="small">
          ← {recipe.visibility === "private" ? "Secret Stash" : "The House Jar"}
        </Link>
        <div className="ms-auto d-flex flex-wrap gap-2">
          {copyTarget && <RecipeCopyButton recipeId={recipe.id} target={copyTarget} />}
          {editable && (
            <Link href={`/recipes/${recipe.id}/edit`} className="btn btn-outline-primary">
              Edit
            </Link>
          )}
        </div>
      </div>

      <h2 className="mb-2 text-break">
        {recipe.name}
        {recipe.visibility === "private" && (
          <span className="text-body-secondary fs-6 ms-2">Private</span>
        )}
      </h2>

      {/* One quiet line of facts, then the tags as links. A row of badges and
          a row of labelled figures said the same things twice as loudly. */}
      <p className="text-body-secondary mb-2">
        {[
          parseRecipeMealTypes(recipe.mealType)
            .map((m) => MEAL_LABELS[m] ?? m)
            .join(", "),
          recipe.prepTimeMinutes != null ? `${recipe.prepTimeMinutes} min prep` : null,
          recipe.cookTimeMinutes != null ? `${recipe.cookTimeMinutes} min cook` : null,
          totalMinutes != null && recipe.prepTimeMinutes != null && recipe.cookTimeMinutes != null
            ? `${totalMinutes} min total`
            : null,
          recipe.servings != null ? `serves ${recipe.servings}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {(withTags.tags.length > 0 || recipe.sourceUrl) && (
        <p className="small mb-4">
          {withTags.tags.map((t, i) => (
            <span key={t}>
              {i > 0 && <span className="text-body-secondary"> · </span>}
              <Link
                href={`/recipes?tag=${encodeURIComponent(t)}${recipe.visibility === "private" ? "&tab=mine" : ""}`}
                title={`More recipes tagged ${t}`}
              >
                {t}
              </Link>
            </span>
          ))}
          {recipe.sourceUrl && (
            <span>
              {withTags.tags.length > 0 && <span className="text-body-secondary"> · </span>}
              {sourceIsLink ? (
                <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-break">
                  {hostOf(recipe.sourceUrl)} ↗
                </a>
              ) : (
                <span className="text-body-secondary">{recipe.sourceUrl}</span>
              )}
            </span>
          )}
        </p>
      )}

      <RecipeCookingView
        recipeId={recipe.id}
        ingredients={splitIngredients(recipe.ingredients)}
        instructions={recipe.instructions}
      />

      {recipe.notes?.trim() && (
        <section className="mt-4">
          <h3 className="h5">Notes</h3>
          <p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
            {recipe.notes}
          </p>
        </section>
      )}
    </div>
  );
}

/** "example.com" from a URL, or the URL itself if it won't parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The recipe, if this person may read it: in their household, and either
 * shared or their own. The same rule as the Recipes page, in the WHERE clause.
 */
function findVisible(id: string, user: { id: string; householdId?: string | null }) {
  const householdId = householdScope(user as Parameters<typeof householdScope>[0]);
  if (!householdId) return undefined;
  return db
    .select()
    .from(recipes)
    .where(
      and(
        eq(recipes.id, id),
        eq(recipes.householdId, householdId),
        or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, user.id))
      )
    )
    .get();
}

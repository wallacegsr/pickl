import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { listVisibleTags } from "@/lib/tags";
import RecipeImport from "@/components/RecipeImport";

export const metadata = { title: "Import Recipes · Pickl" };

export default async function ImportRecipesPage() {
  const session = await auth();

  // Same as the new-recipe page: which tags exist is a permission question,
  // answered server-side, and passed down for the autocomplete.
  const existingTags = session?.user
    ? listVisibleTags(session.user).map((t) => t.name)
    : [];

  return (
    <div>
      <h2 className="mb-1">Import Recipes</h2>
      <p className="text-muted mb-4">
        Bring recipes in from somewhere else — one pasted by hand, or a whole
        file at once.
      </p>
      <RecipeImport isAdmin={isAdmin(session?.user)} existingTags={existingTags} />
    </div>
  );
}

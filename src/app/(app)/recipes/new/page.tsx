import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import RecipeForm from "@/components/RecipeForm";
import { listVisibleTags } from "@/lib/tags";

export default async function NewRecipePage() {
  const session = await auth();

  const existingTags = session?.user
    ? listVisibleTags(session.user).map((t) => t.name)
    : [];

  return (
    <div>
      <h2 className="mb-4">Add Recipe</h2>
      <RecipeForm isAdmin={isAdmin(session?.user)} existingTags={existingTags} />
    </div>
  );
}

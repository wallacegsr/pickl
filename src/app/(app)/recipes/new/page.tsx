import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import RecipeForm from "@/components/RecipeForm";

export default async function NewRecipePage() {
  const session = await auth();

  return (
    <div>
      <h2 className="mb-4">Add Recipe</h2>
      <RecipeForm isAdmin={isAdmin(session?.user)} />
    </div>
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { listVisibleTags } from "@/lib/tags";
import TagManager from "@/components/TagManager";

export const metadata = { title: "Tags · Pickl" };

export default async function TagsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Scoped to what this user can see: the shared pool, their own private
  // recipes, and tags nothing uses yet. A tag living only on somebody
  // else's private recipe is not listed here, for the same reason the
  // recipe itself is not.
  const tags = listVisibleTags(session.user);
  const admin = isAdmin(session.user);

  return (
    <div>
      <h2 className="mb-1">Tags</h2>
      <p className="text-muted mb-4">
        The words you file recipes under. Renaming or deleting a tag here
        changes how recipes are labelled —{" "}
        <strong>it never deletes a recipe</strong>.{" "}
        {admin
          ? "Your edits reach the shared household pool and your own private recipes; nobody's private recipes but their owner's can be touched."
          : "Your edits reach your own private recipes only — shared household recipes keep their tags unless an admin changes them."}
      </p>
      <TagManager initialTags={tags} isAdmin={admin} />
    </div>
  );
}

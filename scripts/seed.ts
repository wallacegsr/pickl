/**
 * Optional development seed script. Safe to skip — running it twice will
 * simply skip inserting recipes that already exist by name.
 *
 * Usage: npm run db:seed
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { recipes } from "../src/db/schema";

const sampleRecipes = [
  {
    name: "Spaghetti Aglio e Olio",
    ingredients: "Spaghetti\nGarlic\nOlive oil\nRed pepper flakes\nParsley\nParmesan",
    instructions:
      "Cook spaghetti. Saute sliced garlic in olive oil with red pepper flakes until golden. Toss with pasta, parsley, and parmesan.",
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    servings: 4,
    tags: "pasta, quick, vegetarian",
  },
  {
    name: "Sheet Pan Chicken Fajitas",
    ingredients: "Chicken breast\nBell peppers\nOnion\nFajita seasoning\nTortillas\nLime",
    instructions:
      "Slice chicken and vegetables. Toss with seasoning and oil. Roast on a sheet pan at 425F for 20 minutes. Serve with tortillas and lime.",
    prepTimeMinutes: 15,
    cookTimeMinutes: 20,
    servings: 4,
    tags: "chicken, weeknight, sheet-pan",
  },
  {
    name: "Vegetable Stir Fry",
    ingredients: "Broccoli\nCarrots\nBell pepper\nSoy sauce\nGarlic\nGinger\nRice",
    instructions:
      "Cook rice. Stir fry chopped vegetables with garlic and ginger in a hot pan. Add soy sauce. Serve over rice.",
    prepTimeMinutes: 15,
    cookTimeMinutes: 10,
    servings: 3,
    tags: "vegetarian, quick, healthy",
  },
];

async function main() {
  for (const recipe of sampleRecipes) {
    const existing = db
      .select()
      .from(recipes)
      .where(eq(recipes.name, recipe.name))
      .get();

    if (existing) {
      console.log(`Skipping "${recipe.name}" — already exists.`);
      continue;
    }

    db.insert(recipes)
      .values({
        id: randomUUID(),
        createdByUserId: null,
        sourceUrl: null,
        notes: null,
        ...recipe,
      })
      .run();
    console.log(`Inserted "${recipe.name}".`);
  }
}

main()
  .then(() => {
    console.log("Seeding complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });

"use client";

import { Alert, Button, Form } from "react-bootstrap";
import type { MealType } from "@/db/schema";
import JarShake from "@/components/JarShake";
import PickleCrunch from "@/components/PickleCrunch";
import { usePlanContext } from "../PlanContext";

/**
 * Hover text for the two pick buttons. Their names are playful, so the real
 * behaviour has to be stated somewhere — these describe what the endpoints
 * behind them actually do (see /api/plan/spin-today and /api/plan/spin-week,
 * and getRemainingDaysInWeek in src/lib/dates.ts for the week's end).
 */
const CRUNCH_TIME_HINT =
  "Pick a random recipe for each meal ticked above, for today only. Prefers recipes not already used elsewhere this week, and asks before replacing a meal you've already planned.";
const SHAKE_JAR_HINT =
  "Fill each meal ticked above for every remaining day of this week — today through Saturday — with random recipes, without repeating a recipe within the same meal. Skips days that already have a pick unless you tip them out.";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner"];
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/**
 * The meal checkboxes and the two pick buttons.
 *
 * The handlers, the in-flight flags and the 409 overwrite-confirmation modal
 * all still live in PlanView; this widget only renders the controls. That is
 * on purpose: the confirmation modal must survive this widget being taken
 * off the board mid-request, and a modal owned by a removable widget would
 * not.
 */
export default function ShakeControlsWidget() {
  const {
    isEditable,
    selectedMeals,
    toggleMeal,
    overwriteWeek,
    setOverwriteWeek,
    crunchingToday,
    shakingWeek,
    onCrunchToday,
    onShakeWeek,
    scope,
  } = usePlanContext();

  if (!isEditable) {
    return (
      <Alert variant="secondary" className="py-2 mb-0">
        {scope === "shared"
          ? "You have view-only access to the household calendar, so there's nothing to shake here."
          : "This plan is read-only."}
      </Alert>
    );
  }

  return (
    <div>
      <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
        <strong className="me-2">Meals to shake for:</strong>
        {MEAL_TYPES.map((mt) => (
          <Form.Check
            key={mt}
            type="checkbox"
            id={`spin-meal-${mt}`}
            label={MEAL_LABELS[mt]}
            checked={selectedMeals.includes(mt)}
            onChange={() => toggleMeal(mt)}
            inline
          />
        ))}
      </div>
      <div className="d-flex flex-wrap gap-2 align-items-center">
        {/* Two different actions, two different animations: today's pick
            crunches a pickle, the week's pick shakes the jar. */}
        <Button
          variant="success"
          title={CRUNCH_TIME_HINT}
          onClick={onCrunchToday}
          disabled={crunchingToday || shakingWeek}
        >
          {crunchingToday ? <PickleCrunch label="Crunching..." /> : "🥒 Crunch Time"}
        </Button>
        <Button
          variant="primary"
          title={SHAKE_JAR_HINT}
          onClick={onShakeWeek}
          disabled={crunchingToday || shakingWeek}
        >
          {shakingWeek ? <JarShake label="Shaking..." /> : "🫙 Shake the Jar"}
        </Button>
        <Form.Check
          type="checkbox"
          id="overwrite-week"
          label="Tip out picks I already have"
          // The playful label does not say what the option actually does, and
          // this one is destructive - it replaces meals you already planned.
          title="Overwrites meals you have already planned this week. Leave it off and Shake the Jar only fills the empty slots."
          checked={overwriteWeek}
          onChange={(e) => setOverwriteWeek(e.target.checked)}
        />
      </div>
    </div>
  );
}

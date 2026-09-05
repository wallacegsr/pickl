"use client";

import { useMemo } from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { getSundayOfWeek, toDateString } from "@/lib/dates";
import { useChartTheme, usePrefersReducedMotion } from "./chartTheme";

/**
 * Structural props, naming only the fields each chart reads, rather than
 * importing the row types from @/lib/reports. ReportsView declares its own
 * copies of those shapes and they are not identical (its history row has no
 * recipeId), so depending on either one would couple these charts to a
 * particular caller for no benefit.
 */
export interface MealTypeDatum {
  mealType: string;
}

export interface MealOverTimeDatum {
  date: string;
  mealType: string;
}

/** Beyond this many days the daily line is noise, and it buckets by week. */
const DAILY_SPAN_LIMIT = 31;

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Buckets rows into a continuous run of dates, one entry per meal type.
 *
 * "Continuous" is the important part. Bucketing only the dates that appear in
 * the data would draw a straight line from one planned day to the next, over a
 * gap that actually contained no meals at all — an unplanned week would read
 * as a steady one. Every bucket between the first and last date is emitted,
 * with zeros where nothing was planned.
 */
function bucketByTime(rows: MealOverTimeDatum[]) {
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  if (dates.length === 0) return { buckets: [], weekly: false };

  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const spanDays =
    Math.round(
      (new Date(last).getTime() - new Date(first).getTime()) / 86_400_000
    ) + 1;
  const weekly = spanDays > DAILY_SPAN_LIMIT;

  // Which bucket a given date belongs to. Weeks start Sunday, matching the
  // meal plan itself rather than inventing a second week convention.
  const keyFor = (date: string) =>
    weekly ? toDateString(getSundayOfWeek(date)) : date;

  const tally = new Map<string, Record<string, number>>();
  const emptyRow = () => ({ breakfast: 0, lunch: 0, dinner: 0 }) as Record<string, number>;

  let cursor = weekly ? getSundayOfWeek(first) : new Date(first + "T00:00:00");
  const end = weekly ? getSundayOfWeek(last) : new Date(last + "T00:00:00");
  while (cursor <= end) {
    tally.set(toDateString(cursor), emptyRow());
    cursor = addDays(cursor, weekly ? 7 : 1);
  }

  for (const row of rows) {
    if (!row.date) continue;
    const bucket = tally.get(keyFor(row.date));
    // A row outside the generated range can only mean an unparseable date.
    if (bucket && row.mealType in bucket) bucket[row.mealType]! += 1;
  }

  return {
    buckets: [...tally.entries()].map(([key, counts]) => ({ key, counts })),
    weekly,
  };
}

export interface FrequencyDatum {
  recipeName: string;
  count: number;
}

// Only the pieces these two charts use. Chart.js ships a `chart.js/auto` entry
// that registers everything; naming them keeps the scales, controllers and
// plugins we do not draw out of the bundle.
ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

const MEAL_ORDER = ["breakfast", "lunch", "dinner"] as const;
const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/** How many recipes the bar chart shows before folding the rest into "Other". */
const TOP_N = 10;

/**
 * Composition of planned meals by meal type.
 *
 * A doughnut is the right call for exactly this shape and little else: three
 * slices that are parts of one whole. The moment a chart is ranking things
 * rather than dividing one thing, it becomes the bar chart below.
 */
export function MealTypeChart({ rows }: { rows: MealTypeDatum[] }) {
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();

  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const row of rows) {
      tally.set(row.mealType, (tally.get(row.mealType) ?? 0) + 1);
    }
    // Fixed order, so a meal type keeps its colour when a filter removes
    // another one. Colour follows the entity, never its rank.
    return MEAL_ORDER.map((meal) => ({
      meal,
      label: MEAL_LABELS[meal] ?? meal,
      count: tally.get(meal) ?? 0,
    })).filter((entry) => entry.count > 0);
  }, [rows]);

  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return null;

  const data = {
    labels: counts.map((entry) => entry.label),
    datasets: [
      {
        data: counts.map((entry) => entry.count),
        backgroundColor: counts.map(
          (entry) => theme.categorical[MEAL_ORDER.indexOf(entry.meal)]
        ),
        // A gap in the surface colour between adjacent slices, so two fills
        // never touch and the boundary does not depend on hue alone.
        borderColor: theme.surface,
        borderWidth: 2,
        hoverOffset: 6,
      },
    ],
  };

  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion ? false : { duration: 400 },
    plugins: {
      legend: {
        position: "right",
        labels: {
          // Legend text wears the text token, not the series colour.
          color: theme.ink,
          usePointStyle: true,
          pointStyle: "circle",
          padding: 14,
          boxWidth: 8,
        },
      },
      tooltip: {
        callbacks: {
          label: (item) => {
            const value = item.parsed;
            const share = total > 0 ? Math.round((value / total) * 100) : 0;
            return ` ${item.label}: ${value} (${share}%)`;
          },
        },
      },
    },
    cutout: "58%",
  };

  return (
    <figure className="pickl-chart mb-0">
      <figcaption className="pickl-chart-caption">
        Meals by type
        <span className="pickl-chart-sub">
          {total} planned {total === 1 ? "meal" : "meals"} in this range
        </span>
      </figcaption>
      <div className="pickl-chart-canvas pickl-chart-canvas--compact">
        <Doughnut data={data} options={options} />
      </div>
    </figure>
  );
}

/**
 * Meals planned over time, one line per meal type.
 *
 * The doughnut above says what the mix is; this says whether it is changing.
 * Lines rather than stacked areas: three translucent areas over each other
 * turn into a mud of overlaps, and the question here is each meal's own trend,
 * not the running total.
 */
export function MealsOverTimeChart({ rows }: { rows: MealOverTimeDatum[] }) {
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();

  const { buckets, weekly } = useMemo(() => bucketByTime(rows), [rows]);

  // One bucket is a dot, not a trend; the doughnut already covers that case.
  if (buckets.length < 2) return null;

  const labels = buckets.map(({ key }) =>
    new Date(key + "T00:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })
  );

  const data = {
    labels,
    datasets: MEAL_ORDER.map((meal, index) => ({
      label: MEAL_LABELS[meal] ?? meal,
      data: buckets.map(({ counts }) => counts[meal] ?? 0),
      borderColor: theme.categorical[index],
      backgroundColor: theme.categorical[index],
      borderWidth: 2,
      // Dots are worth drawing only while they are far enough apart to read.
      // Past that they become a dotted rule along the line, and hover does the
      // job instead.
      pointRadius: buckets.length <= 12 ? 4 : 0,
      pointHoverRadius: 5,
      // Keeps the whole column grabbable even where no dot is drawn.
      pointHitRadius: 12,
      // A meal count is a measurement on a day, not a continuous quantity;
      // a spline would invent values between the points.
      tension: 0,
    })),
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion ? false : { duration: 400 },
    // The crosshair behaviour: hovering anywhere in a column reports all three
    // meals for that date, rather than only the line under the pointer.
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "end",
        labels: {
          color: theme.ink,
          usePointStyle: true,
          pointStyle: "circle",
          boxWidth: 8,
          padding: 14,
        },
      },
      tooltip: {
        callbacks: {
          title: (items) =>
            (weekly ? "Week of " : "") + (items[0]?.label ?? ""),
        },
      },
    },
    scales: {
      x: {
        border: { display: false },
        grid: { display: false },
        ticks: {
          color: theme.muted,
          maxRotation: 0,
          autoSkipPadding: 16,
        },
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: theme.grid },
        ticks: { color: theme.muted, precision: 0 },
      },
    },
  };

  return (
    <figure className="pickl-chart mb-0">
      <figcaption className="pickl-chart-caption">
        Meals over time
        <span className="pickl-chart-sub">
          {weekly
            ? `By week, ${buckets.length} weeks`
            : `By day, ${buckets.length} days`}
        </span>
      </figcaption>
      <div className="pickl-chart-canvas">
        <Line data={data} options={options} />
      </div>
    </figure>
  );
}

/**
 * How often each recipe was planned.
 *
 * Horizontal bars, not a pie: this is a ranked magnitude comparison across many
 * items, which a pie is bad at once it is past a handful of slices. Horizontal
 * because recipe names are text and read better along the axis than rotated
 * under it. One series, so one hue and no legend — the caption names it.
 */
export function RecipeFrequencyChart({ rows }: { rows: FrequencyDatum[] }) {
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();

  const top = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.count - a.count);
    const head = sorted.slice(0, TOP_N);
    const tail = sorted.slice(TOP_N);
    // The tail is folded into one bar rather than dropped, so the chart still
    // adds up to what the table below it shows.
    if (tail.length > 0) {
      head.push({
        recipeName: `Other (${tail.length})`,
        count: tail.reduce((sum, row) => sum + row.count, 0),
      });
    }
    return head;
  }, [rows]);

  if (top.length === 0) return null;

  const data = {
    labels: top.map((row) => row.recipeName),
    datasets: [
      {
        label: "Times planned",
        data: top.map((row) => row.count),
        backgroundColor: theme.single,
        borderRadius: 4,
        // Leaves the bar anchored square where it meets the axis and rounded
        // only at the value end.
        borderSkipped: "start" as const,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion ? false : { duration: 400 },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item) =>
            ` Planned ${item.parsed.x} ${item.parsed.x === 1 ? "time" : "times"}`,
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: theme.grid },
        ticks: {
          color: theme.muted,
          // Counts are whole numbers; a 2.5 gridline would be meaningless.
          precision: 0,
        },
      },
      y: {
        border: { display: false },
        grid: { display: false },
        ticks: { color: theme.ink, autoSkip: false },
      },
    },
  };

  return (
    <figure className="pickl-chart mb-0">
      <figcaption className="pickl-chart-caption">
        Most-planned recipes
        <span className="pickl-chart-sub">
          {rows.length > TOP_N
            ? `Top ${TOP_N} of ${rows.length}, remainder grouped`
            : `All ${rows.length}`}
        </span>
      </figcaption>
      <div
        className="pickl-chart-canvas"
        // Grows with the number of bars so labels never collide; the doughnut
        // above is a fixed square.
        style={{ height: Math.max(220, top.length * 34 + 60) }}
      >
        <Bar data={data} options={options} />
      </div>
    </figure>
  );
}

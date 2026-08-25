/**
 * Timing + reduced-motion rules shared by every "pick me a recipe" animation
 * (the jar shake and the pickle crunch). The visuals differ; these rules must
 * not, so they live here rather than being copied into each component.
 *
 * Import-side-effect free and free of any DB/server import, so it can be
 * pulled into client components.
 */

/**
 * How long an animation keeps running, at minimum, before its result is
 * revealed.
 *
 * This is a *floor*, never an addition: the request and the timer run
 * concurrently, so a pick never takes longer than max(request, MIN_ANIMATION_MS).
 * If the request is slower than the timer the animation simply keeps playing
 * until it lands, and if it fails the animation is torn down immediately
 * rather than waiting the timer out.
 */
export const MIN_ANIMATION_MS = 800;

/** True when the user has asked their OS to minimise animation. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Resolves once the animation started at `startedAt` has run long enough to be
 * worth watching. Under reduced motion there is no animation to wait for, so
 * it resolves immediately and the result appears as soon as the request does.
 */
export function minAnimationElapsed(startedAt: number): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  const remaining = MIN_ANIMATION_MS - (Date.now() - startedAt);
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remaining));
}

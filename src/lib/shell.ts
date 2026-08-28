/**
 * Bridge to the native Android shell, when the app is running inside it.
 *
 * The shell injects `window.PicklShell` (see MainActivity's PicklBridge). In
 * any normal browser the object is simply absent, which is the whole detection
 * mechanism — no user-agent sniffing, and no way for the two to disagree about
 * whether the bridge is really there.
 *
 * Keep this interface tiny. Every method here is callable by any script the
 * WebView runs, so it should only ever contain actions that are harmless or
 * that the native side independently confirms with the user.
 */
export interface PicklShellBridge {
  /** Reload the current page from the server. */
  reload(): void;
  /**
   * Forget the stored server and return to the connect screen. The native side
   * shows a confirmation dialog first, so a page cannot silently sign the user
   * out of their own server.
   */
  changeServer(): void;
}

declare global {
  interface Window {
    PicklShell?: Partial<PicklShellBridge>;
  }
}

/**
 * The bridge, or null when not running in the shell.
 *
 * Client-side only, and only safe to call after mount: the server has no idea
 * which client will render the markup, so branching on this during render
 * would be a hydration mismatch.
 */
export function getPicklShell(): PicklShellBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.PicklShell;
  // An older shell may expose only some of these; require the whole contract
  // rather than rendering a menu item that turns out to do nothing.
  if (
    !bridge ||
    typeof bridge.reload !== "function" ||
    typeof bridge.changeServer !== "function"
  ) {
    return null;
  }
  return bridge as PicklShellBridge;
}

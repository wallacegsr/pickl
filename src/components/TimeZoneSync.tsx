"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TIME_ZONE_COOKIE } from "@/lib/timeZoneCookie";
import { PALETTE_HTML_ATTRIBUTE, isPalette, PALETTE_STORAGE_KEY, DEFAULT_PALETTE } from "@/lib/paletteValues";
import { SIDEBAR_HTML_ATTRIBUTE, SIDEBAR_STORAGE_KEY } from "@/components/nav/sidebarState";

/**
 * Two small things that keep a page matching the person looking at it.
 *
 * 1. Tells the server this browser's time zone, in a cookie, so "today" on
 *    the server is today where the person is (see src/lib/viewerToday.ts). If
 *    the cookie was missing or has changed — a first visit, or travel — the
 *    page is refreshed once so what the server drew uses the right day.
 *
 * 2. Puts the colour scheme and sidebar state back on <html> after React has
 *    taken over. The inline scripts in the root layout set them before first
 *    paint, but if React ever has to redraw the page from scratch (a hydration
 *    mismatch), those attributes are lost while the saved choice is not. This
 *    reapplies the saved choice so it can't silently revert.
 */
export default function TimeZoneSync() {
  const router = useRouter();

  useEffect(() => {
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = undefined;
    }
    if (zone) {
      const current = document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${TIME_ZONE_COOKIE}=`))
        ?.slice(TIME_ZONE_COOKIE.length + 1);
      if (current !== encodeURIComponent(zone)) {
        document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }
    }

    try {
      const root = document.documentElement;
      const palette = window.localStorage.getItem(PALETTE_STORAGE_KEY);
      const wantPalette = isPalette(palette) ? palette : DEFAULT_PALETTE;
      if (root.getAttribute(PALETTE_HTML_ATTRIBUTE) !== wantPalette) {
        root.setAttribute(PALETTE_HTML_ATTRIBUTE, wantPalette);
      }
      const collapsed = window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
      const wantSidebar = collapsed ? "collapsed" : "expanded";
      if (root.getAttribute(SIDEBAR_HTML_ATTRIBUTE) !== wantSidebar) {
        root.setAttribute(SIDEBAR_HTML_ATTRIBUTE, wantSidebar);
      }
    } catch {
      // Storage unavailable: the defaults the scripts chose stand.
    }
  }, [router]);

  return null;
}

/**
 * Inline SVG icons for the app shell.
 *
 * Deliberately hand-rolled rather than pulling in an icon package: this app
 * needs about eight glyphs, and every option (bootstrap-icons, react-icons,
 * lucide) costs either a webfont request or a dependency several megabytes
 * wide to deliver them. Emoji were the other candidate and are used for the
 * 🥒 wordmark, but emoji render at the mercy of the platform font — colour,
 * weight and baseline all vary — so they cannot sit in a tight icon rail next
 * to each other and look deliberate.
 *
 * Every icon is a 24×24 stroke drawing painted in `currentColor`, so it picks
 * up the surrounding link colour (and therefore the active/hover/focus states
 * and both themes) with no colour of its own.
 */

export interface IconProps {
  /** Rendered pixel size; icons are square. */
  size?: number;
  className?: string;
}

function Svg({
  size = 18,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative in every current use: each icon is paired with a text
      // label, or with an aria-label on the button that contains it.
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Plan — a week calendar. */
export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  );
}

/** Recipes — an open book. */
export function BookIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 6.5S10 4.5 6 4.5H3v14h3c4 0 6 2 6 2s2-2 6-2h3v-14h-3c-4 0-6 2-6 2Z" />
      <path d="M12 6.5v14" />
    </Svg>
  );
}

/** Past Preserves — a jar on a shelf. */
export function JarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3h8v2.5l1.2 1.6a4 4 0 0 1 .8 2.4V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9.5a4 4 0 0 1 .8-2.4L8 5.5Z" />
      <path d="M6 13h12" />
    </Svg>
  );
}

/** Tags — a luggage-style tag with its punched hole. */
export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11.6 3.5H19a1.5 1.5 0 0 1 1.5 1.5v7.4a2 2 0 0 1-.6 1.4l-6.6 6.6a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1 0-2.8l6.6-6.6a2 2 0 0 1 1.5-.5Z" />
      <path d="M16.5 7.5h.01" />
    </Svg>
  );
}

/** Preferences / User Settings — a gear. */
export function GearIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </Svg>
  );
}

/** Back of House — a keyed shield. */
export function ShieldIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.6 7.5 10 4.4-1.4 7.5-5.4 7.5-10v-6Z" />
      <path d="M12 9.5v3M12 15.2h.01" />
    </Svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </Svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
    </Svg>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h8.5" />
      <path d="M16 8.5 19.5 12 16 15.5M19 12H9.5" />
    </Svg>
  );
}

/** Hamburger — opens the sidebar drawer on small screens. */
export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </Svg>
  );
}

/** Collapse/expand chevron for the sidebar rail. */
export function ChevronsLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 6.5 5.5 12 11 17.5M18.5 6.5 13 12l5.5 5.5" />
    </Svg>
  );
}

export function ChevronsRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 6.5 18.5 12 13 17.5M5.5 6.5 11 12l-5.5 5.5" />
    </Svg>
  );
}

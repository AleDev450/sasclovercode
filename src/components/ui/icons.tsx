import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The icon set.
 *
 * WHY THESE ARE HAND-WRITTEN AND NOT A DEPENDENCY. The product needs roughly
 * twenty glyphs. An icon package is several thousand, and the ones that tree-
 * shake well still put a barrel import in every file that draws a chevron. More
 * to the point, section 34 asks for a consistent visual language: one stroke
 * width, one corner treatment, one 24x24 grid - which is a property of the SET,
 * and is therefore easier to guarantee by owning it than by picking glyphs out
 * of somebody else.
 *
 * Every path below is drawn on a 24x24 viewBox with a 1.75 stroke, round caps
 * and round joins, and no fills. Adding one means matching that, not matching
 * whatever the source artwork happened to use.
 *
 * SIZE comes from the caller through `className` (`size-4`, `size-5`). The
 * components that consume icons already set it - `Button` forces `size-4`,
 * `StatCard` forces `size-4` - so most call sites pass nothing.
 */

export type IconProps = React.SVGProps<SVGSVGElement>;

function Icon({ className, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default. A caller that needs it announced passes
      // `aria-hidden={false}` together with a `<title>` or an `aria-label`.
      aria-hidden
      className={cn("size-5 shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

/* ---------------------------------------------------------------- commerce */

export const IconStore = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 9.5 4.8 4.6A1.5 1.5 0 0 1 6.2 3.6h11.6a1.5 1.5 0 0 1 1.4 1L21 9.5" />
    <path d="M3 9.5a2.5 2.5 0 0 0 4.5 1.6 2.5 2.5 0 0 0 4.5 0 2.5 2.5 0 0 0 4.5 0A2.5 2.5 0 0 0 21 9.5" />
    <path d="M5 12.5V20h14v-7.5" />
    <path d="M9.5 20v-4.5h5V20" />
  </Icon>
);

export const IconCart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 3.5h2l2.2 10.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5l1.4-5.6H6" />
    <circle cx="9.5" cy="19.5" r="1.3" />
    <circle cx="17.5" cy="19.5" r="1.3" />
  </Icon>
);

export const IconReceipt = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 2.8v18.4l2.3-1.4 2.4 1.4 2.3-1.4 2.4 1.4 2.3-1.4 2 1.4V2.8l-2 1.4-2.3-1.4-2.4 1.4-2.3-1.4-2.4 1.4Z" />
    <path d="M9 9h6M9 13h4" />
  </Icon>
);

export const IconBox = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7Z" />
    <path d="M3.5 7 12 11.3 20.5 7M12 11.3v9.9" />
  </Icon>
);

export const IconTruck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.8 6.5h10.4v9.7H2.8z" />
    <path d="M13.2 10h3.6l3.4 3.2v3h-7z" />
    <circle cx="7" cy="18.2" r="1.6" />
    <circle cx="17" cy="18.2" r="1.6" />
  </Icon>
);

export const IconChef = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 13.5A4 4 0 0 1 7 5.6a4.2 4.2 0 0 1 10 0 4 4 0 0 1 .5 7.9" />
    <path d="M6.5 13.5h11V19a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19Z" />
    <path d="M10 13.5v7M14 13.5v7" />
  </Icon>
);

/* ------------------------------------------------------------- management */

export const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9.5" cy="8" r="3.4" />
    <path d="M2.8 20.2a6.7 6.7 0 0 1 13.4 0" />
    <path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6M17.5 14.4a5.6 5.6 0 0 1 3.7 5.8" />
  </Icon>
);

export const IconBuilding = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20.5V4.8A1.3 1.3 0 0 1 5.3 3.5h7.4A1.3 1.3 0 0 1 14 4.8v15.7" />
    <path d="M14 10.5h4.7A1.3 1.3 0 0 1 20 11.8v8.7M2.5 20.5h19" />
    <path d="M7 7.5h4M7 11.5h4M7 15.5h4M17 14.5h0M17 17.5h0" />
  </Icon>
);

export const IconChart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 3.5v15a2 2 0 0 0 2 2h15" />
    <path d="M7.5 16.5v-4M12 16.5v-8M16.5 16.5v-5.5" />
  </Icon>
);

export const IconTrendUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 16.5 9 11l3.5 3.5L20.5 6.5" />
    <path d="M15.5 6.5h5v5" />
  </Icon>
);

export const IconCard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.8" y="5" width="18.4" height="14" rx="2.2" />
    <path d="M2.8 9.8h18.4M6.5 15h3" />
  </Icon>
);

export const IconGift = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 11.5h17V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" />
    <path d="M2.8 8h18.4v3.5H2.8zM12 8v13" />
    <path d="M12 8S10.6 3.5 8.3 3.5a2.2 2.2 0 1 0 0 4.5M12 8s1.4-4.5 3.7-4.5a2.2 2.2 0 1 1 0 4.5" />
  </Icon>
);

export const IconGlobe = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M2.8 12h18.4" />
    <path d="M12 2.8c2.4 2.5 3.7 5.8 3.7 9.2S14.4 18.7 12 21.2c-2.4-2.5-3.7-5.8-3.7-9.2S9.6 5.3 12 2.8Z" />
  </Icon>
);

export const IconPhone = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M10.5 18.5h3" />
  </Icon>
);

/* ------------------------------------------------------------------ state */

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </Icon>
);

export const IconCheckCircle = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M8 12.3 10.8 15 16 9.3" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.7 3.8 2.6 17.8a1.5 1.5 0 0 0 1.3 2.3h16.2a1.5 1.5 0 0 0 1.3-2.3L13.3 3.8a1.5 1.5 0 0 0-2.6 0Z" />
    <path d="M12 9.5v4M12 17h0" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M12 6.8V12l3.4 2" />
  </Icon>
);

export const IconShield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.8 4.5 5.9v5.4c0 4.4 3.1 8.4 7.5 9.9 4.4-1.5 7.5-5.5 7.5-9.9V5.9Z" />
    <path d="M9 12.2 11.3 14.5 15.3 10" />
  </Icon>
);

export const IconSparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.2 13.9 9 19.8 10.9 13.9 12.8 12 18.7 10.1 12.8 4.2 10.9 10.1 9Z" />
    <path d="M18.5 3.5v3M20 5h-3" />
  </Icon>
);

/* -------------------------------------------------------------- direction */

export const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </Icon>
);

export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 7h17M3.5 12h17M3.5 17h17" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const IconMail = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.8" y="4.8" width="18.4" height="14.4" rx="2.2" />
    <path d="m3.5 7 7.4 5.2a2 2 0 0 0 2.2 0L20.5 7" />
  </Icon>
);

export const IconWhatsApp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.2 20.8 4.6 16A8.3 8.3 0 1 1 8 19.4Z" />
    <path d="M9 9c0 3 2.8 5.8 5.8 5.8l1-1.4-2-1-.9 1a5 5 0 0 1-2.4-2.4l1-.9-1-2Z" />
  </Icon>
);

/* ------------------------------------------------------------- navigation */

export const IconHome = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 10.2 12 3.3l8.5 6.9V19a1.8 1.8 0 0 1-1.8 1.8H5.3A1.8 1.8 0 0 1 3.5 19Z" />
    <path d="M9.5 20.8v-6.3h5v6.3" />
  </Icon>
);

export const IconLayout = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="2.2" />
    <path d="M3 9h18M9.5 9v11.5" />
  </Icon>
);

export const IconCompass = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="m15.5 8.5-2 5-5 2 2-5Z" />
  </Icon>
);

export const IconTag = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11.3 2.9H20a1.1 1.1 0 0 1 1.1 1.1v8.7a1.5 1.5 0 0 1-.44 1.06l-7.35 7.35a1.5 1.5 0 0 1-2.12 0l-7.97-7.97a1.5 1.5 0 0 1 0-2.12l7.35-7.35a1.5 1.5 0 0 1 1.06-.44Z" />
    <path d="M16.8 7.2h0" />
  </Icon>
);

export const IconCash = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.8" y="6" width="18.4" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6.2 9.6h0M17.8 14.4h0" />
  </Icon>
);

export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.3 14.7a1.5 1.5 0 0 0 .3 1.65l.06.06a1.8 1.8 0 1 1-2.55 2.55l-.06-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37v.17a1.8 1.8 0 1 1-3.6 0v-.09a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06a1.8 1.8 0 1 1-2.55-2.55l.06-.06a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H4.3a1.8 1.8 0 1 1 0-3.6h.09a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.06-.06A1.8 1.8 0 1 1 7.95 4.9l.06.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37V3.7a1.8 1.8 0 1 1 3.6 0v.09a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.8 1.8 0 1 1 2.55 2.55l-.06.06a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9h.17a1.8 1.8 0 1 1 0 3.6h-.09a1.5 1.5 0 0 0-1.37.9Z" />
  </Icon>
);

export const IconPalette = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.9a9.1 9.1 0 0 0 0 18.2c.9 0 1.6-.7 1.6-1.6 0-.42-.16-.8-.42-1.08a1.6 1.6 0 0 1 1.18-2.68h1.9a4.85 4.85 0 0 0 4.85-4.85C21.1 6.35 17.03 2.9 12 2.9Z" />
    <path d="M7.2 12.4h0M9.4 8.3h0M14.6 8.3h0" />
  </Icon>
);

export const IconWarehouse = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.8 9.2 12 4.4l9.2 4.8v11.4H2.8Z" />
    <path d="M7.4 20.6v-6.4h9.2v6.4M7.4 17.1h9.2" />
  </Icon>
);

export const IconFileText = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.4 2.9H6.8a1.8 1.8 0 0 0-1.8 1.8v14.6a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.3Z" />
    <path d="M13.4 2.9v5.4h5.6M8.6 13h6.8M8.6 16.6h4.6" />
  </Icon>
);

/* ------------------------------------------------------------- editing */

export const IconImage = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.2" width="18" height="15.6" rx="2.2" />
    <circle cx="8.6" cy="9.4" r="1.6" />
    <path d="m3.4 17.2 4.7-4.4a1.8 1.8 0 0 1 2.45 0l4.05 3.8M14.3 14.2l1.7-1.6a1.8 1.8 0 0 1 2.45 0l2.15 2" />
  </Icon>
);

export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 15.5v3.2a1.8 1.8 0 0 0 1.8 1.8h13.4a1.8 1.8 0 0 0 1.8-1.8v-3.2" />
    <path d="M7.8 8.1 12 3.9l4.2 4.2M12 3.9v11.6" />
  </Icon>
);

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.8 6.3h16.4M8.6 6.3V4.6a1.4 1.4 0 0 1 1.4-1.4h4a1.4 1.4 0 0 1 1.4 1.4v1.7" />
    <path d="M6.4 6.3 7.3 19a1.8 1.8 0 0 0 1.8 1.7h5.8a1.8 1.8 0 0 0 1.8-1.7l.9-12.7" />
    <path d="M10.3 10.2v6.4M13.7 10.2v6.4" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.8v14.4M4.8 12h14.4" />
  </Icon>
);

export const IconChevronUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.8 14.8 6.2-6.2 6.2 6.2" />
  </Icon>
);

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.8 9.2 6.2 6.2 6.2-6.2" />
  </Icon>
);

export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.9 12S5.6 5.3 12 5.3 22.1 12 22.1 12 18.4 18.7 12 18.7 1.9 12 1.9 12Z" />
    <circle cx="12" cy="12" r="2.9" />
  </Icon>
);

export const IconEyeOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.7 5.7A8.9 8.9 0 0 1 12 5.3c6.4 0 10.1 6.7 10.1 6.7a17 17 0 0 1-3 3.9M6 7.1A17 17 0 0 0 1.9 12S5.6 18.7 12 18.7a9 9 0 0 0 3.7-.8" />
    <path d="M10 10.1a2.9 2.9 0 0 0 4 4M3.3 3.3l17.4 17.4" />
  </Icon>
);

export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16.1 3.9a2.05 2.05 0 0 1 2.9 2.9L7.5 18.3l-3.8 1 1-3.8Z" />
    <path d="m14.6 5.4 4 4" />
  </Icon>
);

export const IconQuestion = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M9.6 9.3a2.5 2.5 0 1 1 3.35 2.36A1.6 1.6 0 0 0 12 13.2v.6M12 17h0" />
  </Icon>
);

export const IconMegaphone = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 9.7v4.6a1.8 1.8 0 0 0 1.8 1.8h1.6l10.4 4.3V3.6L6.9 7.9H5.3a1.8 1.8 0 0 0-1.8 1.8Z" />
    <path d="M17.3 9.2a3.2 3.2 0 0 1 0 5.6M6.9 16.1v3.5a1.3 1.3 0 0 0 1.3 1.3h1.3" />
  </Icon>
);

export const IconGrid = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.4" y="3.4" width="7" height="7" rx="1.6" />
    <rect x="13.6" y="3.4" width="7" height="7" rx="1.6" />
    <rect x="3.4" y="13.6" width="7" height="7" rx="1.6" />
    <rect x="13.6" y="13.6" width="7" height="7" rx="1.6" />
  </Icon>
);

export const IconType = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 6.6V4.4h15v2.2M12 4.4v15.2M8.8 19.6h6.4" />
  </Icon>
);

export const IconMapPin = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.2 10.4c0 5.6-7.2 10.4-7.2 10.4s-7.2-4.8-7.2-10.4a7.2 7.2 0 0 1 14.4 0Z" />
    <circle cx="12" cy="10.2" r="2.6" />
  </Icon>
);

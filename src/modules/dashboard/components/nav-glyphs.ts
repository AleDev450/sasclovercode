import type { ComponentType } from "react";
import type { IconProps } from "@/components/ui/icons";
import {
  IconBuilding,
  IconCard,
  IconCart,
  IconCash,
  IconChart,
  IconChef,
  IconClock,
  IconCompass,
  IconFileText,
  IconGift,
  IconGlobe,
  IconGrid,
  IconHome,
  IconLayout,
  IconMapPin,
  IconMegaphone,
  IconPalette,
  IconReceipt,
  IconSettings,
  IconShield,
  IconSparkle,
  IconStore,
  IconTrendUp,
  IconTruck,
  IconUsers,
  IconWarehouse,
} from "@/components/ui/icons";

/**
 * The glyph for each navigation entry, by the `icon` key in `navigation.ts`.
 *
 * WHY IT IS NOT IN `navigation.ts`. That module is imported by unit tests that
 * assert the permission rules, and keeping it free of JSX keeps it a data file
 * - a test that has to render SVG to check a permission is a test about the
 * wrong thing.
 *
 * WHY IT IS NOT IN `dashboard-nav.tsx` EITHER. The sidebar is a client
 * component and the tenant home is a server one, and both draw the same
 * entries. Two copies of this map would drift the moment somebody adds a
 * section, and the drift would show as one screen with an icon and another with
 * a hole. Icons are plain SVG components with no hooks, so one module serves
 * both sides.
 *
 * A key with no entry is not an error. Adding a nav item must not be able to
 * break the build; the callers fall back to a neutral mark.
 */
export const NAV_GLYPHS: Record<string, ComponentType<IconProps>> = {
  home: IconHome,
  pos: IconStore,
  orders: IconCart,
  kitchen: IconChef,
  delivery: IconTruck,
  cash: IconCash,
  catalog: IconGrid,
  inventory: IconWarehouse,
  promotions: IconMegaphone,
  customers: IconUsers,
  loyalty: IconGift,
  content: IconLayout,
  navigation: IconCompass,
  theme: IconPalette,
  seo: IconTrendUp,
  domains: IconGlobe,
  reports: IconChart,
  billing: IconReceipt,
  members: IconShield,
  locations: IconBuilding,
  audit: IconClock,
  settings: IconSettings,
  payments: IconCard,
  "billing-config": IconFileText,
  zones: IconMapPin,
  plan: IconSparkle,
};

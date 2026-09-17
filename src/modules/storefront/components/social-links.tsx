import type { ComponentType } from "react";
import type { IconProps } from "@/components/ui/icons";
import {
  IconFacebook,
  IconInstagram,
  IconLinkedin,
  IconTiktok,
  IconX,
  IconYoutube,
} from "@/components/ui/icons";
import type { SocialPlatform } from "@/types/database";
import type { PublicSocialLink } from "../server/queries";

const ICONS: Record<SocialPlatform, ComponentType<IconProps>> = {
  facebook: IconFacebook,
  instagram: IconInstagram,
  tiktok: IconTiktok,
  x: IconX,
  youtube: IconYoutube,
  linkedin: IconLinkedin,
};

const LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

/**
 * The footer's social icons.
 *
 * A network with no saved link is not drawn: an icon leading to a profile that
 * does not exist is worse than no icon (Sugu Rolls' rule, kept).
 */
export function SocialLinks({ links }: { links: readonly PublicSocialLink[] }) {
  if (links.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2.5">
      {links.map((link) => {
        const Icon = ICONS[link.platform];
        return (
          <li key={link.platform}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={LABELS[link.platform]}
              className="flex size-10 items-center justify-center transition-[transform,opacity] hover:-translate-y-0.5 hover:opacity-80"
              style={{
                border: "1px solid var(--site-border-strong)",
                borderRadius: "9999px",
                color: "var(--site-foreground)",
              }}
            >
              <Icon className="size-4" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

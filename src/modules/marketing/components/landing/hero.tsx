import Link from "next/link";
import { buttonVariants } from "@/components/ui";
import { IconArrowRight, IconPlay } from "@/components/ui/icons";
import { HERO_BENEFITS } from "../../landing-data";
import { PeruFlag } from "./peru-flag";
import { BrowserMockup } from "./browser-mockup";
import { DashboardMockup } from "./dashboard-mockup";
import { PhoneMockup } from "./phone-mockup";

/**
 * The first screen.
 *
 * THE COMPOSITION IS THE PRODUCT DEMO. Three mockups overlap: the restaurant's
 * website in a browser, the same carta on a diner's phone, and the owner's
 * dashboard. A visitor who reads nothing has still been told that this is one
 * system with three faces, which is the entire pitch and takes a paragraph to
 * say in words.
 *
 * HOW THE OVERLAP STAYS RESPONSIVE, which is where this kind of hero usually
 * falls apart. The two floating pieces are positioned ONLY from `lg` up
 * (`lg:absolute`). Below that the phone is dropped entirely and the dashboard
 * becomes an ordinary block under the browser - so a 390px screen gets two
 * stacked cards instead of three cards fighting over the same 200 pixels. The
 * brief asks for overlap and warns against a collage; the difference between
 * the two is a breakpoint.
 *
 * Nothing here is a client component. The entrance animation is `.reveal`, a
 * CSS keyframe driven by `animation-timeline: view()`, which means no
 * JavaScript reaches the phone that is meant to be impressed by it.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Two decorative washes: a teal aura behind the art, a faint grid behind
          everything. Both are utilities in `globals.css`. */}
      <div aria-hidden className="bg-brand-aura absolute inset-x-0 top-0 h-[560px]" />
      <div aria-hidden className="bg-grid absolute inset-x-0 top-0 h-[560px] opacity-60" />

      <div className="relative mx-auto grid max-w-[1280px] items-center gap-12 px-6 py-16 sm:px-8 lg:grid-cols-[46fr_54fr] lg:gap-10 lg:py-24 xl:px-12">
        {/* ------------------------------------------------------------- copy */}
        <div className="reveal flex flex-col items-start">
          <span className="border-border bg-card text-muted-foreground shadow-e1 mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
            <span className="bg-brand-500 size-1.5 rounded-full" />
            Software para restaurantes
          </span>

          <h1 className="type-display text-ink text-[2.625rem] text-balance sm:text-5xl lg:text-[4rem]">
            Haz que tu restaurante venda como una{" "}
            <span className="text-gradient-brand">gran marca.</span>
          </h1>

          <p className="text-muted-foreground mt-6 max-w-[46ch] text-base leading-relaxed sm:text-lg">
            Crea la web de tu restaurante, recibe pedidos en mesa, online y por delivery, y
            administra tu operacion desde un solo lugar.
          </p>

          <p className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
            Hecho para restaurantes peruanos
            <PeruFlag />
          </p>

          {/*
            `items-start` on the column, not just the row.

            A flex column stretches its children, so without it the ghost button
            inherited the primary's width and its centred label sat forty pixels
            in from a left-aligned page - the one thing on the mobile hero that
            looked like a mistake.
          */}
          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Link
              href="#contacto"
              className={buttonVariants({ variant: "brand", size: "xl", className: "group" })}
            >
              Crear mi restaurante
              <IconArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="#como-funciona"
              className={buttonVariants({ variant: "ghost", size: "xl" })}
            >
              <IconPlay />
              Ver como funciona
            </Link>
          </div>

          {/*
            The five capabilities, as a row rather than a list of bullets.

            It is the answer to "what is this, exactly" for somebody who will
            not read the paragraph above it, and it is a `<ul>` because that is
            what it is - the icons are decorative and the labels carry the
            meaning.
          */}
          <ul className="mt-10 grid w-full grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-2">
            {HERO_BENEFITS.map(({ label, Icon }) => (
              <li key={label} className="flex flex-col items-start gap-2 lg:items-center">
                <span className="bg-brand-50 text-brand-700 flex size-9 items-center justify-center rounded-full">
                  <Icon className="size-4.5" />
                </span>
                <span className="text-muted-foreground text-xs leading-tight lg:text-center">
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* ------------------------------------------------------------- art */}
        {/*
          The padding on this column is what the two floating pieces hang into.
          Without it they would have to overlap the browser by their full width,
          which is how a layered hero turns into a card covering a card.
        */}
        <div className="reveal relative lg:pr-8 lg:pb-16 lg:pl-12 xl:pr-4">
          <BrowserMockup />

          {/*
            The phone, overlapping the browser's lower-left corner.

            `lg:block` and nothing else: below that width it is not scaled down,
            it is absent. A 168px phone frame rendered at 90px is unreadable
            detail that costs layout.
          */}
          <div className="absolute bottom-0 -left-4 z-20 hidden lg:block xl:-left-6">
            <PhoneMockup />
          </div>

          {/*
            The dashboard. Static under the browser on small screens, floating
            over its right edge from `lg` - one component, two layouts, no
            duplicated markup.
          */}
          <div className="mt-6 lg:absolute lg:top-[52%] lg:-right-4 lg:z-30 lg:mt-0 lg:w-[232px] lg:-translate-y-1/2 xl:-right-8 xl:w-[252px]">
            <DashboardMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

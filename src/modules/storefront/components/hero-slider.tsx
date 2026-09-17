"use client";

/**
 * The home carousel, full width, the way Sugu Rolls opens.
 *
 * Decisions carried over from that site, each learned there:
 *
 *   * Two photographs per slide, chosen by CSS. `display: none` keeps the
 *     browser from downloading the hidden one.
 *   * Height by the PHOTO's proportion, not by the viewport. A `100svh` hero is
 *     wider than 16:9 on every monitor, which crops the top and bottom - exactly
 *     where a designer puts the headline.
 *   * The whole slide is the link, not only the small button.
 *   * The veil is drawn only under words, at the strength the owner chose.
 *   * Swipe on a phone, where the arrows are hidden.
 *
 * It stops advancing while the pointer is over it or a control has focus, and
 * not at all for somebody who asked their system for reduced motion.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/ui/icons";
import { buttonClass, fullBleedClass, primaryButtonStyle } from "./site-styles";

export interface SlideView {
  readonly desktopUrl: string;
  readonly mobileUrl: string | null;
  readonly heading: string;
  readonly subheading: string;
  readonly ctaLabel: string;
  /** Already localised to the render's base path. */
  readonly href: string | null;
  readonly overlay: number;
}

const SWIPE_THRESHOLD = 40;

export function HeroSlider({
  slides,
  intervalSeconds,
  label,
}: {
  slides: readonly SlideView[];
  intervalSeconds: number;
  label: string;
}) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStart = useRef<number | null>(null);
  const total = slides.length;

  const go = useCallback((index: number) => setCurrent(((index % total) + total) % total), [total]);

  useEffect(() => {
    if (total < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(
      () => setCurrent((index) => (index + 1) % total),
      intervalSeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [total, paused, intervalSeconds]);

  if (total === 0) return null;

  const hasMobile = slides.some((slide) => slide.mobileUrl !== null);

  return (
    <section
      aria-roledescription="carrusel"
      aria-label={label}
      className={`${fullBleedClass} overflow-hidden ${
        hasMobile ? "aspect-[9/14] md:aspect-[16/9]" : "aspect-[4/3] md:aspect-[16/9]"
      } max-h-[88svh] min-h-[22rem] w-screen`}
      style={{ background: "var(--site-surface-strong)" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        const end = event.changedTouches[0]?.clientX;
        if (start === null || end === undefined || total < 2) return;
        const delta = end - start;
        if (delta > SWIPE_THRESHOLD) go(current - 1);
        else if (delta < -SWIPE_THRESHOLD) go(current + 1);
      }}
    >
      {slides.map((slide, index) => {
        const visible = index === current;
        const hasWords = slide.heading.length > 0 || slide.subheading.length > 0;
        const veil = Math.min(90, Math.max(0, slide.overlay)) / 100;

        const body = (
          <>
            {slide.mobileUrl !== null ? (
              /* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */
              <img
                src={slide.mobileUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover md:hidden"
                loading={index === 0 ? "eager" : "lazy"}
              />
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
            <img
              src={slide.desktopUrl}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover ${
                slide.mobileUrl !== null ? "hidden md:block" : ""
              }`}
              loading={index === 0 ? "eager" : "lazy"}
            />

            {hasWords ? (
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-3/4"
                style={{
                  backgroundImage: `linear-gradient(to top, rgb(0 0 0 / ${veil}), rgb(0 0 0 / ${
                    veil * 0.45
                  }) 45%, transparent)`,
                }}
              />
            ) : null}

            {hasWords || slide.ctaLabel.length > 0 ? (
              <div className="relative mx-auto flex h-full max-w-6xl flex-col items-start justify-end px-6 pb-16 text-white sm:px-10 sm:pb-24">
                {slide.heading.length > 0 ? (
                  <h2
                    className="max-w-3xl text-[clamp(2.25rem,5.5vw,4.5rem)] text-balance"
                    style={{
                      fontFamily: "var(--site-display-font)",
                      fontWeight: "var(--site-display-weight)",
                      letterSpacing: "var(--site-display-tracking)",
                      lineHeight: "var(--site-display-leading)",
                    }}
                  >
                    {slide.heading}
                  </h2>
                ) : null}
                {slide.subheading.length > 0 ? (
                  <p className="mt-4 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
                    {slide.subheading}
                  </p>
                ) : null}
                {slide.ctaLabel.length > 0 && slide.href !== null ? (
                  <span className={`${buttonClass} mt-8`} style={primaryButtonStyle}>
                    {slide.ctaLabel}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        );

        return (
          <div
            key={index}
            role="group"
            aria-roledescription="diapositiva"
            aria-label={`${index + 1} de ${total}`}
            // `inert` takes a hidden slide out of the tab order AND the
            // accessibility tree in one attribute, so its link is never a
            // keyboard stop on a photo nobody can see.
            inert={!visible}
            className="absolute inset-0 transition-opacity duration-700 ease-out"
            style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
          >
            {slide.href !== null ? (
              <Link
                href={slide.href}
                className="absolute inset-0 block"
                aria-label={slide.heading || slide.ctaLabel || label}
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </div>
        );
      })}

      {total > 1 ? (
        <>
          <button
            type="button"
            onClick={() => go(current - 1)}
            className="absolute top-1/2 left-4 z-10 hidden -translate-y-1/2 rounded-full border border-white/30 bg-black/30 p-3 text-white backdrop-blur transition-colors hover:border-white/70 sm:block"
            aria-label="Foto anterior"
          >
            <IconChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => go(current + 1)}
            className="absolute top-1/2 right-4 z-10 hidden -translate-y-1/2 rounded-full border border-white/30 bg-black/30 p-3 text-white backdrop-blur transition-colors hover:border-white/70 sm:block"
            aria-label="Foto siguiente"
          >
            <IconChevronRight className="size-5" />
          </button>
          <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center gap-2.5">
            {slides.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => go(index)}
                aria-label={`Ir a la foto ${index + 1}`}
                aria-current={index === current}
                className="h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: index === current ? "2rem" : "1rem",
                  background: index === current ? "var(--site-primary)" : "rgb(255 255 255 / 0.45)",
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

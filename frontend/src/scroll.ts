import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Can an inner scroll container under the pointer still scroll in this direction? */
function innerCanScroll(start: Element | null, deltaY: number): boolean {
  let el: Element | null = start;
  while (el && el !== document.body && el !== document.documentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (deltaY < 0 ? !atTop : !atBottom) return true;
    }
    el = el.parentElement;
  }
  return false;
}

// Feel of the glide. Each frame covers GLIDE_EASE of the remaining distance (higher = snappier),
// and every wheel tick is multiplied by WHEEL_GAIN (higher = travels further per tick).
export const GLIDE_EASE = 0.22;
export const WHEEL_GAIN = 1.3;
const MIN_STEP = 2; // px per frame, so the last few pixels never crawl

/**
 * Inertia ("glide") scrolling for mouse wheels and trackpads.
 * - Touch devices and reduced-motion users keep native scrolling.
 * - Wheel events over inner scroll areas (lists, trade tape) are left alone.
 * - Keyboard, scrollbar drag and anchor jumps keep working: we re-sync on every scroll event we did not cause.
 */
export function useSmoothScroll() {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    if (prefersReducedMotion() || window.matchMedia("(pointer: coarse)").matches) return;

    let target = window.scrollY;
    let raf = 0;
    const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    const tick = () => {
      const distance = target - window.scrollY;
      if (Math.abs(distance) < 1) {
        window.scrollTo(0, target);
        raf = 0;
        return;
      }
      const step = Math.sign(distance) * Math.min(Math.abs(distance), Math.max(MIN_STEP, Math.abs(distance) * GLIDE_EASE));
      window.scrollTo(0, window.scrollY + step);
      raf = requestAnimationFrame(tick);
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.defaultPrevented) return; // pinch-zoom or already handled
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; // horizontal gesture
      if (innerCanScroll(event.target as Element | null, event.deltaY)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : 1;
      const base = raf ? target : window.scrollY;
      target = Math.min(maxScroll(), Math.max(0, base + event.deltaY * unit * WHEEL_GAIN));
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onScroll = () => {
      if (!raf) target = window.scrollY;
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
}

/** True once the element has entered the viewport (one-shot, for reveal animations). */
export function useInView<T extends Element>(threshold = 0.12) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, shown] as const;
}

/** Which section is under the middle of the viewport (drives the nav highlight). */
export function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join("|");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const elements = key
      .split("|")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  return active;
}

export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

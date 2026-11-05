"use client";

import { type ComponentProps, type CSSProperties, type PointerEvent, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface DotPatternProps extends ComponentProps<"div"> {
  dotColor?: string;
  dotSize?: number;
  fade?: "none" | "radial" | "top" | "bottom";
  gap?: number;
  glowColor?: string;
  intensity?: "subtle" | "medium" | "strong";
  interactive?: boolean;
  proximity?: number;
  speed?: number;
  paused?: boolean;
  pointerTarget?: HTMLElement | null;
}

const FADE = {
  bottom: "[mask-image:linear-gradient(to_bottom,#000_40%,transparent)]",
  none: "",
  radial: "[mask-image:radial-gradient(ellipse_at_center,#000_40%,transparent)]",
  top: "[mask-image:linear-gradient(to_top,#000_40%,transparent)]",
};
const STRENGTH = { medium: .8, strong: 1, subtle: .5 };
const px = (value: number | undefined) => value === undefined ? undefined : `${value}px`;

export function DotPattern({ dotColor, dotSize, fade = "radial", gap, glowColor, intensity,
  interactive = true, proximity, speed, paused = false, pointerTarget, onPointerLeave, onPointerMove,
  className, children, ...rest }: DotPatternProps) {
  const root = useRef<HTMLDivElement>(null), glow = useRef<HTMLDivElement>(null);
  const move = (event: { clientX: number; clientY: number; pointerType: string; target: EventTarget | null }) => {
    const node = glow.current;
    if (!node || event.pointerType === "touch" || paused) return;
    if ((event.target as Element)?.closest(".study-tool")) { node.removeAttribute("data-pointer"); return; }
    const box = root.current!.getBoundingClientRect();
    node.style.setProperty("--dot-pattern-x",`${event.clientX-box.left}px`);
    node.style.setProperty("--dot-pattern-y",`${event.clientY-box.top}px`);
    node.setAttribute("data-pointer",node.hasAttribute("data-pointer") ? "move" : "enter");
  };
  const leave = () => glow.current?.removeAttribute("data-pointer");
  useEffect(() => {
    if (!pointerTarget || !interactive || paused) { leave(); return; }
    pointerTarget.addEventListener("pointermove",move);
    pointerTarget.addEventListener("pointerleave",leave);
    return () => { pointerTarget.removeEventListener("pointermove",move); pointerTarget.removeEventListener("pointerleave",leave); leave(); };
  }, [pointerTarget, interactive, paused]);
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => { onPointerMove?.(event); if (!pointerTarget) move(event); };
  const pointerLeave = (event: PointerEvent<HTMLDivElement>) => { onPointerLeave?.(event); if (!pointerTarget) leave(); };
  return <div ref={root} className={cn("relative isolate overflow-hidden",className)} data-slot="dot-pattern"
    data-paused={paused || undefined} onPointerMove={pointerMove} onPointerLeave={pointerLeave} {...rest}>
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 -z-10 [container-type:size] [content-visibility:auto]",FADE[fade])}
      data-slot="dot-pattern-field" style={{
        "--dot-pattern-color":dotColor,
        "--dot-pattern-duration":speed === undefined || speed <= 0 ? undefined : `${12/speed}s`,
        "--dot-pattern-gap":px(gap), "--dot-pattern-glow":glowColor,
        "--dot-pattern-proximity":px(proximity), "--dot-pattern-size":px(dotSize),
        "--dot-pattern-strength":intensity === undefined ? undefined : STRENGTH[intensity],
      } as CSSProperties}>
      <div className="dot-pattern-dots absolute inset-0" data-slot="dot-pattern-dots">
        {(speed === undefined || speed > 0) && <div className="dot-pattern-wave animate-dot-pattern-wave motion-reduce:[animation-play-state:paused]" data-slot="dot-pattern-wave" />}
      </div>
      {interactive && <div className="dot-pattern-lit absolute inset-0" data-slot="dot-pattern-lit">
        <div className="dot-pattern-glow" data-slot="dot-pattern-glow" ref={glow} />
      </div>}
    </div>
    {children}
  </div>;
}

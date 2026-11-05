import { useState, type ComponentProps, type MouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RippleButton({ children, onClick, reduced = false, size = "sm", className, ...props }:
  ComponentProps<typeof Button> & { reduced?: boolean }) {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; size: number }[]>([]);
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (!reduced) {
      const rect = event.currentTarget.getBoundingClientRect();
      const id = performance.now();
      setRipples(items => [...items, {
        id, x: event.detail ? event.clientX - rect.left : rect.width / 2,
        y: event.detail ? event.clientY - rect.top : rect.height / 2,
        size: Math.hypot(rect.width, rect.height) * 2,
      }]);
    }
    onClick?.(event);
  };
  return <Button {...props} size={size} className={cn("sd-ripple-button",className)} onClick={click}>
    <span className="sd-button-label">{children}</span>
    <AnimatePresence>
      {ripples.map(ripple => <motion.span className="sd-button-ripple" aria-hidden="true" key={ripple.id}
        style={{ left: ripple.x, top: ripple.y, width: ripple.size, height: ripple.size }}
        initial={{ scale: 0, opacity: .25 }} animate={{ scale: 1, opacity: 0 }}
        transition={{ duration: .55, ease: "easeOut" }}
        onAnimationComplete={() => setRipples(items => items.filter(item => item.id !== ripple.id))} />)}
    </AnimatePresence>
  </Button>;
}

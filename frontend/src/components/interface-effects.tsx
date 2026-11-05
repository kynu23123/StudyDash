import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { RippleButton } from "@/components/ui/ripple-button";

export function SidebarHighlight({ reduced }: { reduced: boolean }) {
  const nav = document.querySelector<HTMLElement>(".workspace-nav")!;
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: 0, height: 0 });
  useEffect(() => {
    const measure = () => {
      const button = nav.querySelector<HTMLElement>("button.on");
      if (!button) return;
      const target = button.getBoundingClientRect(), parent = nav.getBoundingClientRect();
      const next = { x: target.left-parent.left+nav.scrollLeft, y: target.top-parent.top+nav.scrollTop, width: target.width, height: target.height };
      setBounds(previous => Object.keys(next).every(key => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next);
    };
    const observer = new MutationObserver(measure);
    nav.querySelectorAll("button").forEach(button => observer.observe(button, { attributes: true, attributeFilter: ["class", "hidden"] }));
    const resize = new ResizeObserver(measure);
    resize.observe(nav); nav.querySelectorAll("button").forEach(button => resize.observe(button));
    measure();
    return () => { observer.disconnect(); resize.disconnect(); };
  }, [nav]);
  return createPortal(<motion.div className="sd-nav-highlight" aria-hidden="true" initial={false}
    style={{ width: bounds.width, height: bounds.height }} animate={{ x: bounds.x, y: bounds.y }}
    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 42 }} />, nav);
}

export function BootFlipWords({ reduced }: { reduced: boolean }) {
  const words = ["Plan your day.", "Find your focus.", "Make progress."];
  const [index, setIndex] = useState(0), [active, setActive] = useState(false), [hovered, setHovered] = useState(false);
  useEffect(() => {
    const title = document.getElementById("title")!;
    const update = () => setActive(!title.hidden && !title.classList.contains("leave") && !title.hasAttribute("data-paused") && !document.hidden);
    const observer = new MutationObserver(update);
    observer.observe(title, { attributes: true, attributeFilter: ["hidden", "class", "data-paused"] });
    document.addEventListener("visibilitychange", update); update();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => {
    if (!active || hovered || reduced) return;
    const interval = setInterval(() => setIndex(value => (value+1)%words.length), 1500);
    return () => clearInterval(interval);
  }, [active, hovered, reduced]);
  return <span className="sd-flip-words" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <span className="sr-only">Plan your day. Find your focus. Make progress.</span>
    <AnimatePresence mode="wait" initial={false}>
      <motion.span key={index} aria-hidden="true" initial={reduced ? false : { opacity: 0, rotateX: -65, y: 7 }}
        animate={{ opacity: 1, rotateX: 0, y: 0 }} exit={reduced ? {} : { opacity: 0, rotateX: 55, y: -7 }}
        transition={{ duration: .23, ease: "easeOut" }}>{words[index]}</motion.span>
    </AnimatePresence>
  </span>;
}

export function TimerBreathing({ reduced }: { reduced: boolean }) {
  useEffect(() => {
    const clock = document.getElementById("studyClock")!, stage = document.getElementById("studyStage")!, section = document.getElementById("v-study")!;
    const update = () => {
      clock.toggleAttribute("data-breathing-active", !reduced && !section.hidden && !document.hidden && stage.hasAttribute("data-breathing"));
    };
    const observer = new MutationObserver(update);
    observer.observe(stage, { attributes: true, attributeFilter: ["data-breathing"] });
    observer.observe(section, { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("visibilitychange", update); update();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); clock.removeAttribute("data-breathing-active"); };
  }, [reduced]);
  return null;
}

function ExistingDialog({ id }: { id: string }) {
  const source = document.getElementById(id)!;
  const [form] = useState(() => source.querySelector<HTMLElement>(".modal")!);
  const [open, setOpen] = useState(source.classList.contains("show"));
  const opener = useRef<HTMLElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    node.append(form);
    return () => { source.append(form); };
  }, [form, source]);
  useEffect(() => {
    source.classList.add("sd-dialog-source");
    form.removeAttribute("role"); form.removeAttribute("aria-labelledby");
    const observer = new MutationObserver(() => {
      const next = source.classList.contains("show");
      if (next && !open) opener.current = document.activeElement as HTMLElement;
      setOpen(next);
    });
    observer.observe(source, { attributes: true, attributeFilter: ["class"] });
    return () => { observer.disconnect(); source.classList.remove("sd-dialog-source"); };
  }, [form, source, open]);
  const close = () => document.getElementById(id === "scrim" ? "fCancel" : "impCancel")!.click();
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    <DialogContent className="sd-dialog-content" onOpenAutoFocus={event => {
      event.preventDefault(); form.querySelector<HTMLElement>("input:not([type=hidden]),select,button")?.focus();
    }} onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}>
      <DialogTitle className="sr-only">{form.querySelector("h3")?.textContent || "StudyDash"}</DialogTitle>
      <DialogDescription className="sr-only">Complete the form, or cancel to return.</DialogDescription>
      <div ref={attach} />
    </DialogContent>
  </Dialog>;
}

type Confirmation = { message: string; resolve: (value: boolean) => void; opener: HTMLElement | null };
function ConfirmationDialogs({ reduced }: { reduced: boolean }) {
  const [queue, setQueue] = useState<Confirmation[]>([]);
  const pending = useRef<Confirmation[]>([]);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<Omit<Confirmation, "opener">>).detail;
      pending.current = [...pending.current, { ...detail, opener: document.activeElement as HTMLElement }];
      setQueue(pending.current);
    };
    window.addEventListener("studydash:confirm", receive);
    document.documentElement.dataset.reactDialogs = "true";
    return () => {
      window.removeEventListener("studydash:confirm", receive);
      delete document.documentElement.dataset.reactDialogs;
      pending.current.forEach(item => item.resolve(false));
    };
  }, []);
  const current = queue[0];
  const finish = (value: boolean) => {
    opener.current = current?.opener || null;
    current?.resolve(value);
    pending.current = pending.current.slice(1); setQueue(pending.current);
  };
  return <Dialog open={Boolean(current)} onOpenChange={value => { if (!value) finish(false); }}>
    <DialogContent className="sd-dialog-content sd-confirm-content" onCloseAutoFocus={event => {
      event.preventDefault(); opener.current?.focus();
    }}>
      <DialogTitle>Confirm action</DialogTitle>
      <DialogDescription>{current?.message}</DialogDescription>
      <DialogFooter>
        <RippleButton variant="outline" reduced={reduced} onClick={() => finish(false)}>Cancel</RippleButton>
        <RippleButton reduced={reduced} onClick={() => finish(true)}>Continue</RippleButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function DialogLayer({ reduced }: { reduced: boolean }) {
  return <><ExistingDialog id="scrim" /><ExistingDialog id="impScrim" /><ConfirmationDialogs reduced={reduced} /></>;
}

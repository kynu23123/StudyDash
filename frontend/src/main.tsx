import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig, animate, motion, useReducedMotion } from "motion/react";
import { ChartRadialText } from "@/components/chart-radial-text";
import { RippleButton } from "@/components/ui/ripple-button";
import { DotPattern } from "@/components/ui/dot-pattern";
import { SidebarHighlight, BootFlipWords, TimerBreathing, DialogLayer } from "@/components/interface-effects";
import { NotebookIcon } from "@/components/notebook-icon";
import { FilterButtons } from "@/components/filter-buttons";
import { Starfield } from "@/components/ui/starfield";
import "./skin.css";

function useMotionPreference() {
  const system = useReducedMotion();
  const [reduced, setReduced] = useState(document.documentElement.hasAttribute("data-reduce-motion"));
  useEffect(() => {
    const observer = new MutationObserver(() => setReduced(document.documentElement.hasAttribute("data-reduce-motion")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    return () => observer.disconnect();
  }, []);
  return reduced || Boolean(system);
}

function Completion() {
  const read = () => {
    const root = document.getElementById("ring")!;
    return { done: Number(root.dataset.done) || 0, total: Number(root.dataset.total) || 0 };
  };
  const [counts, setCounts] = useState(read);
  const reduced = useMotionPreference();
  useEffect(() => {
    const listener = () => {
      const next = read();
      setCounts(previous => previous.done === next.done && previous.total === next.total ? previous : next);
    };
    window.addEventListener("studydash:tasks", listener);
    return () => window.removeEventListener("studydash:tasks", listener);
  }, []);
  return <ChartRadialText {...counts} reduced={reduced} />;
}

function HeaderActions() {
  const [syncState, setSyncState] = useState({ disabled: true, busy: false });
  const reduced = useMotionPreference();
  useEffect(() => {
    const source = document.getElementById("syncBtn") as HTMLButtonElement;
    const update = () => {
      const next = { disabled: source.disabled, busy: source.dataset.busy === "true" };
      setSyncState(previous => previous.disabled === next.disabled && previous.busy === next.busy ? previous : next);
    };
    const observer = new MutationObserver(update);
    observer.observe(source, { attributes: true, attributeFilter: ["disabled", "data-busy"] });
    update();
    return () => observer.disconnect();
  }, []);
  return <MotionConfig reducedMotion={reduced ? "always" : "never"}>
    <motion.div className="sd-header-actions">
      <motion.span whileTap={reduced ? undefined : { scale: .97 }}>
        <RippleButton reduced={reduced} variant="outline" disabled={syncState.disabled} onClick={() => document.getElementById("syncBtn")!.click()}>
          {syncState.busy ? "Syncing…" : "Sync"}
        </RippleButton>
      </motion.span>
      <motion.span whileTap={reduced ? undefined : { scale: .97 }}>
        <RippleButton reduced={reduced} onClick={() => document.getElementById("addBtn")!.click()}>Add task</RippleButton>
      </motion.span>
    </motion.div>
  </MotionConfig>;
}

function StudyScene() {
  const reduced = useMotionPreference();
  const [paused, setPaused] = useState(true);
  useEffect(() => {
    const section = document.getElementById("v-study")!;
    const stage = document.getElementById("studyStage")!;
    const update = () => setPaused(section.hidden || stage.hasAttribute("data-still") || document.hidden);
    const observer = new MutationObserver(update);
    observer.observe(section, { attributes: true, attributeFilter: ["hidden"] });
    observer.observe(stage, { attributes: true, attributeFilter: ["data-still"] });
    document.addEventListener("visibilitychange", update);
    update();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  return <><DotPattern className="sd-study-dots" gap={18} proximity={180} intensity="subtle" speed={.65}
    dotColor="color-mix(in srgb,var(--study-accent,var(--accent)) 24%,transparent)"
    glowColor="var(--study-accent,var(--accent))" paused={paused || reduced} interactive={!paused && !reduced}
    pointerTarget={document.getElementById("studyStage")} /><TimerBreathing reduced={reduced} /></>;
}

function InteractionMotion() {
  const reduced = useMotionPreference();
  useEffect(() => {
    if (reduced) return;
    const press = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const button = (event.target as Element).closest<HTMLButtonElement>(".workspace-main button:not([data-slot=button]),.workspace-nav button");
      if (button && !button.disabled) {
        animate(button, { scale: [1, .98, 1] }, { duration: .22, ease: "easeOut" });
      }
    };
    document.addEventListener("pointerdown", press);
    const ripple = (event: MouseEvent) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button.btn:not([data-slot=button]),.study-launchers button,.days button");
      if (!button || button.disabled || button.hidden) return;
      const rect = button.getBoundingClientRect(), size = Math.hypot(rect.width, rect.height)*2;
      const ink = document.createElement("span");
      ink.className = "sd-button-ripple"; ink.setAttribute("aria-hidden", "true");
      Object.assign(ink.style, { width: `${size}px`, height: `${size}px`, left: `${event.detail ? event.clientX-rect.left : rect.width/2}px`, top: `${event.detail ? event.clientY-rect.top : rect.height/2}px` });
      button.classList.add("sd-ripple-target"); button.append(ink);
      animate(ink, { scale: [0, 1], opacity: [.25, 0] }, { duration: .55, ease: "easeOut" }).then(() => ink.remove());
    };
    document.addEventListener("click", ripple);
    const transitions = new Map<Element, ReturnType<typeof animate>>();
    const observer = new MutationObserver(records => {
      for (const record of records) {
        const section = record.target as HTMLElement;
        transitions.get(section)?.stop();
        if (!section.hidden) {
          transitions.set(section, animate(section, { opacity: [.6, 1], y: [5, 0] }, { duration: .2, ease: "easeOut" }));
        }
      }
    });
    document.querySelectorAll(".workspace-main > section").forEach(section =>
      observer.observe(section, { attributes: true, attributeFilter: ["hidden"] }));
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("click", ripple);
      observer.disconnect();
      for (const [section, animation] of transitions) {
        animation.cancel();
        (section as HTMLElement).style.removeProperty("opacity");
        (section as HTMLElement).style.removeProperty("transform");
      }
    };
  }, [reduced]);
  return null;
}

function NavigationEffects() { return <SidebarHighlight reduced={useMotionPreference()} />; }
function TitleEffects() { return <BootFlipWords reduced={useMotionPreference()} />; }
function TitleBackdrop() {
  const reduced=useMotionPreference(), [paused,setPaused]=useState(true);
  useEffect(() => {
    const title=document.getElementById("title")!;
    const update=() => setPaused(title.hidden || title.classList.contains("leave") || title.hasAttribute("data-paused") || document.hidden);
    const observer=new MutationObserver(update);
    observer.observe(title,{attributes:true,attributeFilter:["hidden","class","data-paused"]});
    document.addEventListener("visibilitychange",update); update();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange",update); };
  },[]);
  return <Starfield className="sd-title-starfield" paused={paused || reduced} starColor="var(--accent)" speed={.8} />;
}
function DialogEffects() { return <DialogLayer reduced={useMotionPreference()} />; }
function FilterEffects({ id }: { id: string }) { return <FilterButtons id={id} reduced={useMotionPreference()} />; }

for (const [id, component] of [
  ["ring", <Completion />],
  ["sd-actions", <HeaderActions />],
  ["sd-study-scene", <StudyScene />],
  ["sd-motion", <InteractionMotion />],
  ["sd-nav-effects", <NavigationEffects />],
  ["sd-title-flip", <TitleEffects />],
  ["sd-title-background", <TitleBackdrop />],
  ["sd-dialogs", <DialogEffects />],
  ["sd-icon-effects", <NotebookIcon />],
  ["srcChips", <FilterEffects id="srcChips" />],
  ["streamChips", <FilterEffects id="streamChips" />],
  ["oppStatus", <FilterEffects id="oppStatus" />],
  ["oppKinds", <FilterEffects id="oppKinds" />],
] as const) {
  const host = document.getElementById(id);
  if (host) createRoot(host).render(component);
}

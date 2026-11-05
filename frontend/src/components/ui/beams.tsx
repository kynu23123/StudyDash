import { type ComponentProps, type CSSProperties, useId } from "react";
import { cn } from "@/lib/utils";

export interface BeamsProps extends ComponentProps<"div"> {
  colors?: string[];
  speed?: number;
  paused?: boolean;
}

const percent = (share: number) => `${Math.round(share*1e5)/1e3}%`;
const BEAMS = Array.from({ length:20 }, (_,i) => {
  const x=22*i, y=-24*i, start=(x-380)/696;
  return {
    d:`M${x-380} ${y-189}C${x-380} ${y-189} ${x-312} ${y+216} ${x+152} ${y+343}C${x+616} ${y+470} ${x+684} ${y+875} ${x+684} ${y+875}`,
    i, left:percent((2-start)/2), right:percent(1-start), phase:(i%8)/8+i/160, time:`${4+(i%5)*.8}s`,
  };
});

export function Beams({ colors=[],speed,paused=false,className,children,...rest }: BeamsProps) {
  const id=`beams-${useId().replace(/[^\w-]/g,"")}`;
  const style={ "--beams-speed":speed, ...Object.fromEntries(colors.length ? [1,2,3].map(n => [`--beams-color-${n}`,colors[Math.min(n,colors.length)-1]]) : []) } as CSSProperties;
  return <div className={cn("relative isolate overflow-hidden",className)} data-slot="beams" data-paused={paused || undefined} {...rest}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 [container-type:size] [content-visibility:auto]" data-slot="beams-layer" style={style}>
      <svg aria-hidden="true" className="absolute inset-0 size-full" data-slot="beams-guides" fill="none" preserveAspectRatio="xMidYMid slice" viewBox="0 0 696 316">
        <defs><linearGradient id={id} x1="0" x2="1" y1="0" y2="1">
          <stop className="[stop-color:var(--beams-color-1)]" offset="0" stopOpacity="0" />
          <stop className="[stop-color:var(--beams-color-1)]" offset="0.2" />
          <stop className="[stop-color:var(--beams-color-2)]" offset="0.5" />
          <stop className="[stop-color:var(--beams-color-3)]" offset="0.8" />
          <stop className="[stop-color:var(--beams-color-3)]" offset="1" stopOpacity="0" />
        </linearGradient></defs>
        <g className="stroke-foreground" opacity={.05} strokeWidth={.5}>{BEAMS.map(beam => <path d={beam.d} key={beam.i} />)}</g>
      </svg>
      <div className="absolute top-1/2 left-1/2 h-[max(100cqh,45.4023cqw)] w-[max(100cqw,220.2532cqh)] -translate-x-1/2 -translate-y-1/2" data-slot="beams-beams">
        {BEAMS.map(beam => <div className="absolute inset-y-0 w-[200%] animate-beams-window overflow-hidden opacity-0 motion-reduce:[animation-play-state:paused]"
          data-slot="beams-beam" key={beam.i} style={{ "--beams-phase":beam.phase,"--beams-time":beam.time,right:beam.right } as CSSProperties}>
          <div className="absolute inset-y-0 w-1/2 animate-beams-counter motion-reduce:[animation-play-state:paused]" style={{left:beam.left}}>
            <svg aria-hidden="true" className="absolute top-[calc(50%-50cqh)] left-[calc(50%-50cqw)] h-[100cqh] w-[100cqw]" fill="none" preserveAspectRatio="xMidYMid slice" viewBox="0 0 696 316">
              <path d={beam.d} stroke={`url(#${id})`} strokeLinecap="round" strokeWidth={1} />
            </svg>
          </div>
        </div>)}
      </div>
    </div>
    {children}
  </div>;
}

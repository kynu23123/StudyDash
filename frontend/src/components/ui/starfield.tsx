import { type ComponentProps, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export interface StarfieldProps extends ComponentProps<"div"> {
  count?: number;
  speed?: number;
  starColor?: string;
  paused?: boolean;
}

const fraction = (index: number, salt: number) => {
  const value=Math.sin((index+1)*salt)*43758.5453;
  return value-Math.floor(value);
};
const STARS=Array.from({length:160},(_,index) => {
  const angle=fraction(index,12.9898)*Math.PI*2;
  return {
    angle:`${angle*180/Math.PI}deg`,x:`${Math.cos(angle)*82}cqw`,y:`${Math.sin(angle)*82}cqh`,
    duration:14+fraction(index,29.173)*12,phase:fraction(index,78.233),size:.9+fraction(index,39.421)*1.3,
    distantX:`${fraction(index,17.123)*100}%`,distantY:`${fraction(index,93.733)*100}%`,
  };
});

export function Starfield({count=160,speed=1,starColor="var(--text)",paused=false,className,children,...rest}:StarfieldProps) {
  const stars=STARS.slice(0,Math.max(0,Math.min(160,Math.round(count))));
  const safeSpeed=Number.isFinite(speed)&&speed>0?speed:1;
  return <div className={cn("sd-starfield",className)} data-slot="starfield" data-paused={paused || undefined}
    style={{"--starfield-color":starColor} as CSSProperties} {...rest}>
    <div className="sd-starfield-layer" data-slot="starfield-layer" aria-hidden="true">
      {stars.slice(0,60).map((star,index)=><span key={`far-${index}`} className="sd-starfield-distant"
        style={{left:star.distantX,top:star.distantY}} />)}
      {stars.map((star,index)=><span key={index} className="sd-starfield-flight" data-slot="starfield-star"
        style={{"--star-x":star.x,"--star-y":star.y,"--star-angle":star.angle,
          "--star-duration":`${star.duration/safeSpeed}s`,"--star-delay":`${-star.duration*star.phase/safeSpeed}s`,
          width:star.size,height:star.size} as CSSProperties} />)}
    </div>
    {children}
  </div>;
}

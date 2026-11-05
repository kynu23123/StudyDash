import { Label, PolarAngleAxis, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

const config = { completed: { label: "Completed tasks", color: "var(--accent)" } } satisfies ChartConfig;

export function ChartRadialText({ done, total, reduced }: { done: number; total: number; reduced: boolean }) {
  const data = [{ completed: done, fill: "var(--color-completed)" }];
  return (
    <div className="task-completion" role="img" aria-label={`${done} of ${total} tasks completed today`}>
      <ChartContainer config={config} className="task-completion-chart">
        <RadialBarChart data={data} startAngle={90} endAngle={-270} innerRadius={38} outerRadius={46}>
          <PolarAngleAxis type="number" domain={[0, Math.max(total, 1)]} tick={false} />
          <RadialBar dataKey="completed" background={{ fill: "var(--line)" }} cornerRadius={8}
            isAnimationActive={!reduced} animationDuration={550} />
          <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
            <Label content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
              return <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle" fill="var(--text)">
                <tspan x={viewBox.cx} dy="-3" fontSize="21" fontWeight="650">{done}/{total}</tspan>
                <tspan x={viewBox.cx} dy="18" fontSize="10" fill="var(--muted)">done today</tspan>
              </text>;
            }} />
          </PolarRadiusAxis>
        </RadialBarChart>
      </ChartContainer>
    </div>
  );
}

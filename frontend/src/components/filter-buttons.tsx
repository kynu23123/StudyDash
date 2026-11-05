import { useEffect, useState, type CSSProperties } from "react";
import { RippleButton } from "@/components/ui/ripple-button";

type FilterModel = {
  attribute: string;
  options: { value: string; label: string; count: number; selected: boolean; color?: string }[];
};

export function FilterButtons({ id, reduced }: { id: string; reduced: boolean }) {
  const host = document.getElementById(id)!;
  const read = (): FilterModel => {
    try { return JSON.parse(host.dataset.filters || '{"attribute":"filter","options":[]}'); }
    catch { return { attribute: "filter", options: [] }; }
  };
  const [model, setModel] = useState(read);
  useEffect(() => {
    const update = () => setModel(read());
    host.addEventListener("studydash:filters",update);
    return () => host.removeEventListener("studydash:filters",update);
  }, [host]);
  return model.options.map(option => <RippleButton key={option.value} type="button" reduced={reduced}
    variant={option.selected ? "default" : "outline"} aria-pressed={option.selected}
    {...{ [`data-${model.attribute}`]: option.value }}>
    {option.color && <i aria-hidden="true" style={{ "--sc":option.color } as CSSProperties} />}
    {option.label}<span className="n">{option.count}</span>
  </RippleButton>);
}

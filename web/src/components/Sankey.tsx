import { sankey, sankeyJustify, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowModel, FlowNode } from "../cashflow";
import { rupees } from "../format";

type N = FlowNode;
type L = { source: string; target: string; value: number };

const LABEL_WIDTH = 150;
const MIN_WIDTH = 640;
const ROW_HEIGHT = 44;
const LABEL_GAP = 32;

/** Spreads label positions so two-line labels never overlap; they stay as close to their node as possible. */
export function spreadLabels(items: { id: string; y: number }[], gap: number, top: number, bottom: number): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const ys = sorted.map((i) => i.y);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i] as number, (ys[i - 1] as number) + gap);
  const last = ys.length - 1;
  if (last >= 0 && (ys[last] as number) > bottom) {
    ys[last] = bottom;
    for (let i = last - 1; i >= 0; i--) ys[i] = Math.min(ys[i] as number, (ys[i + 1] as number) - gap);
  }
  if (ys.length > 0 && (ys[0] as number) < top) ys[0] = top;
  return new Map(sorted.map((item, i) => [item.id, ys[i] as number]));
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Income sources on the left, the middle node, then expense categories and savings on the right.
 * On narrow screens the diagram scrolls sideways instead of squeezing its labels.
 */
export function Sankey({ model }: { model: FlowModel }) {
  const { ref, width: available } = useWidth();
  const width = Math.max(available, MIN_WIDTH);

  const sinks = model.nodes.filter((n) => n.side === "sink").length;
  const sources = model.nodes.filter((n) => n.side === "source").length;
  const height = Math.min(560, Math.max(280, Math.max(sinks, sources) * ROW_HEIGHT + 40));

  const graph = useMemo(() => {
    const layout = sankey<N, L>()
      .nodeId((n) => n.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(12)
      .nodePadding(14)
      .extent([
        [LABEL_WIDTH, 28],
        [width - LABEL_WIDTH, height - 8],
      ]);
    return layout({ nodes: model.nodes.map((n) => ({ ...n })), links: model.links.map((l) => ({ ...l })) });
  }, [model, width, height]);

  const labelY = useMemo(() => {
    const mid = (n: { y0?: number; y1?: number }) => ((n.y0 ?? 0) + (n.y1 ?? 0)) / 2;
    const bySide = (side: N["side"]) => graph.nodes.filter((n) => n.side === side).map((n) => ({ id: n.id, y: mid(n) }));
    return new Map([
      ...spreadLabels(bySide("source"), LABEL_GAP, 36, height - 20),
      ...spreadLabels(bySide("sink"), LABEL_GAP, 36, height - 20),
    ]);
  }, [graph, height]);

  const path = sankeyLinkHorizontal<N, L>();
  const halo = { paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3, strokeLinejoin: "round" } as const;
  const nodeOf = (link: SankeyLink<N, L>) => link.source as SankeyNode<N, L>;
  const targetOf = (link: SankeyLink<N, L>) => link.target as SankeyNode<N, L>;

  return (
    <div ref={ref} className="overflow-x-auto" role="img" aria-label="Cash flow diagram: where your income came from and where it went">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
        <g fill="none">
          {graph.links.map((link, i) => (
            <path
              key={i}
              d={path(link) ?? ""}
              stroke={targetOf(link).side === "sink" ? targetOf(link).color : nodeOf(link).color}
              strokeOpacity={0.3}
              strokeWidth={Math.max(1, link.width ?? 1)}
            />
          ))}
        </g>
        {graph.nodes.map((node) => {
          const x0 = node.x0 ?? 0;
          const x1 = node.x1 ?? 0;
          const y0 = node.y0 ?? 0;
          const y1 = node.y1 ?? 0;
          const mid = (y0 + y1) / 2;
          const left = node.side === "source";
          const centre = node.side === "center";
          return (
            <g key={node.id}>
              <rect x={x0} y={y0} width={x1 - x0} height={Math.max(2, y1 - y0)} fill={node.color} rx={2} />
              {centre ? (
                <text x={(x0 + x1) / 2} y={Math.max(14, y0 - 14)} textAnchor="middle" className="fill-ink text-[12px] font-medium" {...halo}>
                  <tspan x={(x0 + x1) / 2}>{node.label}</tspan>
                  <tspan x={(x0 + x1) / 2} dy="14" className="fill-soft">
                    {rupees(node.amountPaise)}
                  </tspan>
                </text>
              ) : (
                <>
                  {Math.abs((labelY.get(node.id) ?? mid) - mid) > 6 && (
                    <line x1={left ? x0 : x1} y1={mid} x2={left ? x0 - 6 : x1 + 6} y2={labelY.get(node.id) ?? mid} stroke={node.color} strokeOpacity={0.6} />
                  )}
                  <text x={left ? x0 - 8 : x1 + 8} y={labelY.get(node.id) ?? mid} dy="-0.1em" textAnchor={left ? "end" : "start"} className="fill-ink text-[12px] font-medium" {...halo}>
                  <tspan x={left ? x0 - 8 : x1 + 8}>{node.label}</tspan>
                  <tspan x={left ? x0 - 8 : x1 + 8} dy="1.25em" className="fill-soft font-normal">
                    {rupees(node.amountPaise)} ({node.pct}%)
                  </tspan>
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

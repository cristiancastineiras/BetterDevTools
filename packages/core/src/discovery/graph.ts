// A layered layout for the dependency graph: callers on the left, what they unlock to the right.
// Pure: it returns positions, the view (or the HTML report) draws them.

export interface GraphNode {
  id: string;
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  count: number;
}

export interface Placed {
  id: string;
  label: string;
  x: number;
  y: number;
  layer: number;
}

export interface GraphLayout {
  nodes: Placed[];
  edges: (GraphEdge & { path: string })[];
  width: number;
  height: number;
}

export const GRAPH_BOX = { width: 230, height: 28, gapX: 90, gapY: 14, margin: 12 };

/**
 * Layers by longest path from the sources (cycles are broken by ignoring the edge that closes
 * them), then orders each layer by where its neighbours sit so edges cross less.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphLayout {
  const ids = new Set(nodes.map((node) => node.id));
  const usable = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  const out = new Map<string, string[]>();
  for (const edge of usable) out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);

  // drop back edges found by a depth-first walk, leaving a DAG
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const next of out.get(id) ?? []) {
      if (state.get(next) === 1) back.add(`${id}>${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, 2);
  };
  for (const node of nodes) if (!state.has(node.id)) visit(node.id);
  const dag = usable.filter((edge) => !back.has(`${edge.from}>${edge.to}`));

  const incoming = new Map<string, string[]>();
  for (const edge of dag) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  const layerOf = new Map<string, number>();
  const layer = (id: string): number => {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    layerOf.set(id, 0); // guards against any cycle left
    const value = Math.max(-1, ...(incoming.get(id) ?? []).map(layer)) + 1;
    layerOf.set(id, value);
    return value;
  };
  for (const node of nodes) layer(node.id);

  const layers: GraphNode[][] = [];
  for (const node of nodes) (layers[layerOf.get(node.id)!] ??= []).push(node);
  const row = new Map<string, number>();
  const settle = () => layers.forEach((column) => column?.forEach((node, index) => row.set(node.id, index)));
  settle();
  for (let sweep = 0; sweep < 4; sweep++) {
    layers.forEach((column, index) => {
      if (!column || index === 0) return;
      const mean = (id: string) => {
        const neighbours = incoming.get(id) ?? [];
        return neighbours.length ? neighbours.reduce((sum, from) => sum + (row.get(from) ?? 0), 0) / neighbours.length : row.get(id)!;
      };
      column.sort((a, b) => mean(a.id) - mean(b.id));
    });
    settle();
  }

  const { width, height, gapX, gapY, margin } = GRAPH_BOX;
  const placed = new Map<string, Placed>();
  layers.forEach((column, index) =>
    column?.forEach((node, position) =>
      placed.set(node.id, { id: node.id, label: node.label, layer: index, x: margin + index * (width + gapX), y: margin + position * (height + gapY) }),
    ),
  );
  const tallest = Math.max(0, ...layers.map((column) => column?.length ?? 0));
  return {
    nodes: [...placed.values()],
    edges: usable.map((edge) => {
      const from = placed.get(edge.from)!;
      const to = placed.get(edge.to)!;
      const [x1, y1, x2, y2] = [from.x + width, from.y + height / 2, to.x, to.y + height / 2];
      const curve = Math.max(20, Math.abs(x2 - x1) / 2);
      return { ...edge, path: `M${x1},${y1} C${x1 + curve},${y1} ${x2 - curve},${y2} ${x2},${y2}` };
    }),
    width: margin * 2 + layers.length * width + Math.max(0, layers.length - 1) * gapX,
    height: margin * 2 + tallest * height + Math.max(0, tallest - 1) * gapY,
  };
}

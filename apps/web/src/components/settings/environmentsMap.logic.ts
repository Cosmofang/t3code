import type {
  ConnectionRouteKind,
  EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";
import { peerLinkHealth, type PeerLinkHealth } from "@t3tools/client-runtime/state/peerLinks";
import {
  AuthMcpClientAccess,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type PeerLinkSummary,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";

export const FLEET_CLIENT_NODE_ID = "client";

/** What this client knows of the links an environment holds to others. */
export type FleetOutgoingLinks =
  | { readonly state: "loaded"; readonly links: ReadonlyArray<PeerLinkSummary> }
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly message: string }
  /** Connected, but linked environments is off or unsupported there. */
  | { readonly state: "off" }
  /** Not connected, or not allowed to read: it may hold links this client cannot see. */
  | { readonly state: "unknown" };

export interface FleetRouteInput {
  readonly id: string;
  readonly kind: ConnectionRouteKind;
}

export interface FleetEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: EnvironmentMachineKind | null;
  readonly phase: EnvironmentConnectionPhase;
  /** Switched on in this client. A switched-off environment is saved but never dialled. */
  readonly enabled: boolean;
  /** Saved routes, preferred first. */
  readonly routes: ReadonlyArray<FleetRouteInput>;
  /** The route carrying the connection, when the client is connected and knows it. */
  readonly activeRouteId: string | null;
  readonly refusedRouteIds: ReadonlyArray<string>;
  readonly outgoing: FleetOutgoingLinks;
  /** Linked environments is supported and switched on there. */
  readonly offersLinks: boolean;
  /** This client's session there may create links from it and pairing codes on it. */
  readonly canWriteAccess: boolean;
  /** An address another machine can reach it at, so a link to it needs no typed address. */
  readonly hasLinkAddress: boolean;
}

/** A machine on the user's T3 Connect account that this client has not saved. */
export interface FleetConnectMachineInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: EnvironmentMachineKind | null;
  readonly availability: "checking" | "online" | "offline" | "error";
}

/**
 * How a route is doing, from what the client knows: which one carries the connection, which the
 * host refused, and the environment's phase. It never probes a route to find out.
 */
export type FleetRouteState =
  | "in-use"
  | "standby"
  | "trying"
  /** The environment cannot be reached right now, over any route. */
  | "down"
  /** Not dialled: the environment is switched off, or needs an update first. */
  | "idle"
  | "refused"
  /** A T3 Connect machine this client could add; no route is saved yet. */
  | "offered";

/** Why an environment can or cannot be the source of a new link. */
export type FleetLinking = "ready" | "disconnected" | "off" | "forbidden";

export type FleetNode =
  | { readonly id: string; readonly kind: "client"; readonly label: string }
  | {
      readonly id: string;
      readonly kind: "environment";
      readonly environmentId: EnvironmentId;
      readonly label: string;
      readonly machine: EnvironmentMachineKind | null;
      readonly phase: EnvironmentConnectionPhase;
      readonly enabled: boolean;
      readonly routeCount: number;
      readonly outgoing: FleetOutgoingLinks["state"];
      readonly outgoingError: string | null;
      readonly linking: FleetLinking;
      /** The client can mint a pairing code there itself, so linking to it asks for none. */
      readonly mintable: boolean;
    }
  | {
      readonly id: string;
      readonly kind: "connect";
      readonly environmentId: EnvironmentId;
      readonly label: string;
      readonly machine: EnvironmentMachineKind | null;
      readonly availability: FleetConnectMachineInput["availability"];
    }
  /** Seen only as another environment's link target; the client is not connected to it. */
  | {
      readonly id: string;
      readonly kind: "target";
      readonly environmentId: EnvironmentId;
      readonly label: string;
      /** Where the first environment linking to it reaches it. */
      readonly address: string | null;
    };

export type FleetEnvironmentNode = Extract<FleetNode, { kind: "environment" }>;

export type FleetEdge =
  | {
      readonly id: string;
      readonly kind: "route";
      readonly from: string;
      readonly to: string;
      readonly routeId: string;
      readonly routeKind: ConnectionRouteKind;
      readonly state: FleetRouteState;
    }
  | {
      readonly id: string;
      readonly kind: "link";
      readonly from: string;
      readonly to: string;
      readonly sourceEnvironmentId: EnvironmentId;
      readonly link: PeerLinkSummary;
      readonly health: PeerLinkHealth;
    };

export type FleetRouteEdge = Extract<FleetEdge, { kind: "route" }>;
export type FleetLinkEdge = Extract<FleetEdge, { kind: "link" }>;

export interface FleetGraph {
  readonly nodes: ReadonlyArray<FleetNode>;
  readonly edges: ReadonlyArray<FleetEdge>;
}

export const fleetEnvironmentNodeId = (environmentId: EnvironmentId) => `env:${environmentId}`;

function routeState(environment: FleetEnvironmentInput, routeId: string): FleetRouteState {
  if (environment.refusedRouteIds.includes(routeId)) return "refused";
  if (!environment.enabled) return "idle";
  switch (environment.phase) {
    case "connected":
      return routeId === environment.activeRouteId ? "in-use" : "standby";
    case "connecting":
      return "trying";
    case "unsupported":
    case "available":
      return "idle";
    case "reconnecting":
    case "error":
    case "offline":
      return "down";
  }
}

function linking(environment: FleetEnvironmentInput): FleetLinking {
  if (environment.phase !== "connected") return "disconnected";
  if (!environment.offersLinks) return "off";
  return environment.canWriteAccess ? "ready" : "forbidden";
}

/**
 * One node per machine however often it is named: an environment listed twice, a link repeated
 * in a list, a T3 Connect machine the client also saved, and a link to a machine the client
 * knows all land on the same node. Each saved route is its own edge from the client.
 */
export function buildFleetGraph(input: {
  readonly clientLabel: string;
  readonly environments: ReadonlyArray<FleetEnvironmentInput>;
  readonly connectMachines?: ReadonlyArray<FleetConnectMachineInput>;
  readonly now: DateTime.Utc;
}): FleetGraph {
  const nodes = new Map<string, FleetNode>([
    [FLEET_CLIENT_NODE_ID, { id: FLEET_CLIENT_NODE_ID, kind: "client", label: input.clientLabel }],
  ]);
  const edges = new Map<string, FleetEdge>();
  const environments = input.environments.filter(
    (environment, index, all) =>
      all.findIndex((other) => other.environmentId === environment.environmentId) === index,
  );
  for (const environment of environments) {
    const id = fleetEnvironmentNodeId(environment.environmentId);
    nodes.set(id, {
      id,
      kind: "environment",
      environmentId: environment.environmentId,
      label: environment.label,
      machine: environment.machine,
      phase: environment.phase,
      enabled: environment.enabled,
      routeCount: environment.routes.length,
      outgoing: environment.outgoing.state,
      outgoingError: environment.outgoing.state === "error" ? environment.outgoing.message : null,
      linking: linking(environment),
      mintable:
        environment.phase === "connected" &&
        environment.canWriteAccess &&
        environment.hasLinkAddress,
    });
    for (const route of environment.routes) {
      const edgeId = `route:${id}:${route.id}`;
      if (edges.has(edgeId)) continue;
      edges.set(edgeId, {
        id: edgeId,
        kind: "route",
        from: FLEET_CLIENT_NODE_ID,
        to: id,
        routeId: route.id,
        routeKind: route.kind,
        state: routeState(environment, route.id),
      });
    }
  }
  for (const machine of input.connectMachines ?? []) {
    const id = fleetEnvironmentNodeId(machine.environmentId);
    if (nodes.has(id)) continue;
    nodes.set(id, {
      id,
      kind: "connect",
      environmentId: machine.environmentId,
      label: machine.label,
      machine: machine.machine,
      availability: machine.availability,
    });
    edges.set(`route:${id}:offer`, {
      id: `route:${id}:offer`,
      kind: "route",
      from: FLEET_CLIENT_NODE_ID,
      to: id,
      routeId: "offer",
      routeKind: "relay",
      state: "offered",
    });
  }
  for (const environment of environments) {
    if (environment.outgoing.state !== "loaded") continue;
    const from = fleetEnvironmentNodeId(environment.environmentId);
    for (const link of environment.outgoing.links) {
      const to = fleetEnvironmentNodeId(link.environmentId);
      const id = `link:${from}>${to}`;
      if (to === from || edges.has(id)) continue;
      if (!nodes.has(to)) {
        nodes.set(to, {
          id: to,
          kind: "target",
          environmentId: link.environmentId,
          label: link.label,
          address: link.urls[0] ?? null,
        });
      }
      edges.set(id, {
        id,
        kind: "link",
        from,
        to,
        sourceEnvironmentId: environment.environmentId,
        link,
        health: peerLinkHealth(link, input.now),
      });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export const isLinkEdge = (edge: FleetEdge): edge is FleetLinkEdge => edge.kind === "link";
export const isRouteEdge = (edge: FleetEdge): edge is FleetRouteEdge => edge.kind === "route";

/** Whether a link wants the user's attention: anything but reachable with time left. */
export const linkNeedsAttention = (health: PeerLinkHealth) =>
  health.kind !== "reachable" || health.expiresInDays !== null;

const ACCESS_ORDER = AuthMcpClientAccess.literals;
const labelOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * Machines only one environment links to, at one access level, drawn as a single node. Forty
 * VMs under one host cost one node and one line, and each link stays listed in the details.
 */
export interface FleetStack {
  readonly id: string;
  readonly sourceId: string;
  readonly access: AuthMcpClientAccess;
  /** In name order, so the first and last name the range. */
  readonly memberIds: ReadonlyArray<string>;
  readonly edgeIds: ReadonlyArray<string>;
  readonly reachable: number;
  readonly firstLabel: string;
  readonly lastLabel: string;
  readonly expanded: boolean;
}

/** Below this many machines a group is clearer drawn one by one. */
const FLEET_STACK_MIN = 5;

export function fleetStacks(graph: FleetGraph, expanded: ReadonlySet<string>): FleetStack[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const links = graph.edges.filter(isLinkEdge);
  const incoming = new Map<string, number>();
  for (const link of links) incoming.set(link.to, (incoming.get(link.to) ?? 0) + 1);
  const groups = new Map<string, FleetLinkEdge[]>();
  for (const link of links) {
    if (byId.get(link.to)?.kind !== "target" || incoming.get(link.to) !== 1) continue;
    const id = `stack:${link.from}:${link.link.access}`;
    groups.set(id, [...(groups.get(id) ?? []), link]);
  }
  const label = (link: FleetLinkEdge) => byId.get(link.to)?.label ?? "";
  return [...groups]
    .filter(([, members]) => members.length >= FLEET_STACK_MIN)
    .map(([id, unsorted]) => {
      const members = unsorted.toSorted(
        (left, right) =>
          labelOrder.compare(label(left), label(right)) || (left.to < right.to ? -1 : 1),
      );
      return {
        id,
        sourceId: members[0]!.from,
        access: members[0]!.link.access,
        memberIds: members.map((link) => link.to),
        edgeIds: members.map((link) => link.id),
        reachable: members.filter((link) => link.health.kind === "reachable").length,
        firstLabel: label(members[0]!),
        lastLabel: label(members.at(-1)!),
        expanded: expanded.has(id),
      };
    });
}

export type FleetFocus =
  | { readonly kind: "node"; readonly id: string }
  | { readonly kind: "edge"; readonly id: string }
  | { readonly kind: "stack"; readonly id: string };

export interface FleetNeighborhood {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
}

/**
 * What a node reaches and what reaches it, one hop only, plus how this client gets there. A link
 * does not chain: A linked to B and B linked to C gives A's agents nothing on C, so following
 * links further would lie.
 */
export function fleetNeighborhood(
  graph: FleetGraph,
  stacks: ReadonlyArray<FleetStack>,
  focus: FleetFocus,
): FleetNeighborhood {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const sources = new Set<string>();
  const stack = focus.kind === "stack" ? stacks.find((entry) => entry.id === focus.id) : undefined;
  const stackEdges = new Set(stack?.edgeIds);
  for (const edge of graph.edges) {
    const touches =
      focus.kind === "stack"
        ? stackEdges.has(edge.id)
        : focus.kind === "edge"
          ? edge.id === focus.id
          : edge.from === focus.id || edge.to === focus.id;
    if (!touches) continue;
    edges.add(edge.id);
    nodes.add(edge.from).add(edge.to);
    if (edge.kind === "link" && (focus.kind !== "node" || edge.to === focus.id)) {
      sources.add(edge.from);
    }
  }
  // The client reaches the focus through whichever environment holds the link to it.
  for (const edge of graph.edges) {
    if (edge.kind !== "route" || !sources.has(edge.to)) continue;
    edges.add(edge.id);
    nodes.add(edge.from);
  }
  if (focus.kind === "node" && graph.nodes.some((node) => node.id === focus.id)) {
    nodes.add(focus.id);
  }
  return { nodes, edges };
}

/** What linking `sourceId` to `targetId` would take, or why the map does not offer it. */
export type FleetLinkOffer =
  | {
      readonly kind: "unavailable";
      readonly reason:
        | "not-an-environment"
        | "same-machine"
        | "source-disconnected"
        | "source-off"
        | "source-forbidden";
    }
  | {
      readonly kind: "link";
      readonly sourceEnvironmentId: EnvironmentId;
      /**
       * `code-less`: the client mints the pairing code on the target with its own session there.
       * `pairing-code`: the user brings one from the target.
       */
      readonly path: "code-less" | "pairing-code";
      /** The pair is already linked, so linking again renews it. */
      readonly renews: boolean;
      readonly target:
        | { readonly kind: "machine"; readonly environmentId: EnvironmentId }
        /** A machine the client has no entry for: only an address another host uses. */
        | { readonly kind: "address"; readonly address: string | null };
    };

export function fleetLinkOffer(
  graph: FleetGraph,
  sourceId: string,
  targetId: string,
): FleetLinkOffer {
  const source = graph.nodes.find((node) => node.id === sourceId);
  const target = graph.nodes.find((node) => node.id === targetId);
  if (source?.kind !== "environment" || target === undefined || target.kind === "client") {
    return { kind: "unavailable", reason: "not-an-environment" };
  }
  if (source.id === target.id) return { kind: "unavailable", reason: "same-machine" };
  if (source.linking !== "ready") {
    return { kind: "unavailable", reason: `source-${source.linking}` as const };
  }
  const renews = graph.edges.some(
    (edge) =>
      edge.kind === "link" &&
      edge.from === source.id &&
      edge.to === target.id &&
      edge.health.kind !== "expired",
  );
  const base = { kind: "link", sourceEnvironmentId: source.environmentId, renews } as const;
  if (target.kind === "target") {
    return {
      ...base,
      path: "pairing-code",
      target: { kind: "address", address: target.address },
    };
  }
  return {
    ...base,
    path: target.kind === "environment" && target.mintable ? "code-less" : "pairing-code",
    target: { kind: "machine", environmentId: target.environmentId },
  };
}

/** Changes exactly when the layout would: membership, labels, routes, wiring and open stacks. */
export function fleetShapeKey(graph: FleetGraph, stacks: ReadonlyArray<FleetStack>): string {
  return [
    ...graph.nodes.map((node) => `${node.kind}\u0000${node.id}\u0000${node.label}`),
    ...graph.edges.map((edge) =>
      edge.kind === "link" ? `${edge.id}\u0000${edge.link.access}` : edge.id,
    ),
    ...stacks.map((stack) => `${stack.id}\u0000${stack.expanded}`),
  ].join("\n");
}

export interface FleetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FleetPoint {
  readonly x: number;
  readonly y: number;
}

export interface FleetRouteGeometry {
  readonly d: string;
  /** Where the route's kind is named, on the wire just before the environment. */
  readonly pill: FleetRect;
}

export interface FleetLinkGeometry {
  readonly d: string;
  /** Arrowhead tip and the horizontal direction it points. */
  readonly arrow: { readonly x: number; readonly y: number; readonly dir: 1 | -1 };
  /** Where a link whose target does not name its access shows it. */
  readonly badge: FleetPoint | null;
}

export interface FleetStackGeometry {
  /** The whole footprint: the sheets of a closed stack, or the frame of an open one. */
  readonly rect: FleetRect;
  /** The part that is the stack's control: the front sheet, or an open stack's header. */
  readonly face: FleetRect;
  readonly d: string;
  readonly arrow: FleetPoint;
}

export type FleetColumn = "client" | "environments" | "targets";

export interface FleetLayout {
  /** Every machine drawn on its own. Members of a closed stack are not here. */
  readonly nodes: ReadonlyMap<string, FleetRect>;
  readonly stacks: ReadonlyMap<string, FleetStackGeometry>;
  readonly routes: ReadonlyMap<string, FleetRouteGeometry>;
  /** Links drawn one by one. A stack's links are drawn by the stack. */
  readonly links: ReadonlyMap<string, FleetLinkGeometry>;
  /** Where an environment's link handle sits, on its right edge. */
  readonly handles: ReadonlyMap<string, FleetPoint>;
  readonly columns: ReadonlyArray<{ readonly id: FleetColumn; readonly x: number }>;
  readonly width: number;
  readonly height: number;
}

const HEADER = 28;
const CLIENT = { width: 136, height: 44 };
const WIRE = 72;
const PILL = { width: 82, height: 18 };
const PILL_GAP = 10;
const PORT_PITCH = 22;
const CARD = { width: 204, height: 60 };
const OFFER = { height: 44 };
const TARGET = { width: 188, height: 44 };
const STACK = { height: 50, lift: 8 };
const CHIP = { width: 124, height: 26 };
const CHIP_GAP = 6;
const FRAME_PAD = 8;
const FRAME_HEADER = 30;
const GROUP_GAP = 28;
const BAY_GAP = 12;
const BRACKET_FIRST = 22;
const BRACKET_STEP = 12;
const LINK_RUN = 92;
const ARROW_LENGTH = 6;
const PORT_OFFSET = 8;
const HANDLE_INSET = 12;
const CORNER = 8;
const BADGE = { width: 34, height: 24 };

/** Horizontal, a vertical run at `viaX`, then horizontal again, with rounded turns. */
function elbowPath(x0: number, y0: number, viaX: number, x1: number, y1: number): string {
  const dy = y1 - y0;
  if (Math.abs(dy) < 1) return `M${x0} ${y0}H${x1}`;
  const r = Math.min(CORNER, Math.abs(dy) / 2, Math.abs(viaX - x0), Math.abs(x1 - viaX));
  const sy = Math.sign(dy);
  const inX = Math.sign(viaX - x0);
  const outX = Math.sign(x1 - viaX);
  return [
    `M${x0} ${y0}`,
    `H${viaX - inX * r}`,
    `Q${viaX} ${y0} ${viaX} ${y0 + sy * r}`,
    `V${y1 - sy * r}`,
    `Q${viaX} ${y1} ${viaX + outX * r} ${y1}`,
    `H${x1}`,
  ].join("");
}

const sCurve = (x0: number, y0: number, x1: number, y1: number) => {
  const reach = Math.max(24, (x1 - x0) / 2);
  return `M${x0} ${y0}C${x0 + reach} ${y0} ${x1 - reach} ${y1} ${x1} ${y1}`;
};

const frameColumns = (count: number) => Math.max(2, Math.min(4, Math.ceil(Math.sqrt(count / 2.2))));

type BayItem =
  | { readonly kind: "target"; readonly link: FleetLinkEdge }
  | { readonly kind: "stack"; readonly stack: FleetStack };

/**
 * Three columns, left to right: this client, the machines it knows, and the machines seen only
 * through a link, each beside the first environment that links to it. Every route is its own
 * wire into its environment. Positions come from the graph alone, so the same setup always
 * draws the same map.
 */
export function layoutFleetGraph(
  graph: FleetGraph,
  stacks: ReadonlyArray<FleetStack> = [],
): FleetLayout {
  const nodes = new Map<string, FleetRect>();
  const stackGeometry = new Map<string, FleetStackGeometry>();
  const routes = new Map<string, FleetRouteGeometry>();
  const linkGeometry = new Map<string, FleetLinkGeometry>();
  const handles = new Map<string, FleetPoint>();
  const links = graph.edges.filter(isLinkEdge);
  const routeEdges = graph.edges.filter(isRouteEdge);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const hosts = graph.nodes.filter(
    (node) => node.kind === "environment" || node.kind === "connect",
  );
  const hostIds = new Set(hosts.map((node) => node.id));
  const accessRank = (access: AuthMcpClientAccess) => -ACCESS_ORDER.indexOf(access);

  const stacked = new Set(stacks.flatMap((stack) => stack.edgeIds));
  const bayOf = new Map<string, BayItem[]>();
  const push = (hostId: string, item: BayItem) =>
    bayOf.set(hostId, [...(bayOf.get(hostId) ?? []), item]);
  for (const stack of stacks.toSorted((a, b) => accessRank(a.access) - accessRank(b.access))) {
    push(stack.sourceId, { kind: "stack", stack });
  }
  const homed = new Set<string>();
  const singles = links
    .filter((link) => byId.get(link.to)?.kind === "target" && !stacked.has(link.id))
    .filter((link) => (homed.has(link.to) ? false : (homed.add(link.to), true)))
    .toSorted(
      (left, right) =>
        accessRank(left.link.access) - accessRank(right.link.access) ||
        labelOrder.compare(byId.get(left.to)?.label ?? "", byId.get(right.to)?.label ?? "") ||
        (left.to < right.to ? -1 : 1),
    );
  for (const link of singles) push(link.from, { kind: "target", link });

  const sameColumn = links.filter((link) => hostIds.has(link.to));
  const pillX = CLIENT.width + WIRE;
  const cardX = pillX + PILL.width + PILL_GAP;
  const cardRight = cardX + CARD.width;
  const channelWidth =
    sameColumn.length === 0 ? 0 : BRACKET_FIRST + BRACKET_STEP * (sameColumn.length - 1);
  const bayX = cardRight + channelWidth + LINK_RUN;

  const itemSize = (item: BayItem) => {
    if (item.kind === "target") return TARGET;
    if (!item.stack.expanded) {
      return { width: TARGET.width + STACK.lift, height: STACK.height + STACK.lift };
    }
    const columns = frameColumns(item.stack.memberIds.length);
    const rows = Math.ceil(item.stack.memberIds.length / columns);
    return {
      width: FRAME_PAD * 2 + columns * (CHIP.width + CHIP_GAP) - CHIP_GAP,
      height: FRAME_HEADER + rows * (CHIP.height + CHIP_GAP) - CHIP_GAP + FRAME_PAD,
    };
  };

  let y = HEADER;
  let width = cardRight + channelWidth;
  const inBay = new Set<string>();
  for (const host of hosts) {
    const bay = bayOf.get(host.id) ?? [];
    const routeCount = routeEdges.filter((edge) => edge.to === host.id).length;
    const cardHeight =
      host.kind === "connect"
        ? OFFER.height
        : Math.max(CARD.height, (routeCount - 1) * PORT_PITCH + PILL.height + 20);
    const sizes = bay.map(itemSize);
    const bayHeight = sizes.reduce((sum, size) => sum + size.height + BAY_GAP, -BAY_GAP);
    const groupHeight = Math.max(cardHeight, bayHeight);
    const centerY = y + groupHeight / 2;
    const card = { x: cardX, y: centerY - cardHeight / 2, width: CARD.width, height: cardHeight };
    nodes.set(host.id, card);
    if (host.kind === "environment") {
      handles.set(host.id, { x: cardRight, y: card.y + cardHeight - HANDLE_INSET });
    }

    let itemY = centerY - bayHeight / 2;
    bay.forEach((item, index) => {
      const size = sizes[index]!;
      const endX = bayX - ARROW_LENGTH;
      if (item.kind === "target") {
        const rect = { x: bayX, y: itemY, ...TARGET };
        const targetY = itemY + TARGET.height / 2;
        nodes.set(item.link.to, rect);
        inBay.add(item.link.id);
        linkGeometry.set(item.link.id, {
          d: sCurve(cardRight, centerY, endX, targetY),
          arrow: { x: bayX, y: targetY, dir: 1 },
          badge: null,
        });
      } else if (!item.stack.expanded) {
        const face = {
          x: bayX,
          y: itemY + STACK.lift,
          width: TARGET.width,
          height: STACK.height,
        };
        const faceY = face.y + face.height / 2;
        stackGeometry.set(item.stack.id, {
          rect: { x: bayX, y: itemY, ...size },
          face,
          d: sCurve(cardRight, centerY, endX, faceY),
          arrow: { x: bayX, y: faceY },
        });
      } else {
        const columns = frameColumns(item.stack.memberIds.length);
        item.stack.memberIds.forEach((memberId, member) => {
          nodes.set(memberId, {
            x: bayX + FRAME_PAD + (member % columns) * (CHIP.width + CHIP_GAP),
            y: itemY + FRAME_HEADER + Math.floor(member / columns) * (CHIP.height + CHIP_GAP),
            ...CHIP,
          });
        });
        const headerY = itemY + FRAME_HEADER / 2;
        stackGeometry.set(item.stack.id, {
          rect: { x: bayX, y: itemY, ...size },
          face: { x: bayX, y: itemY, width: size.width, height: FRAME_HEADER },
          d: sCurve(cardRight, centerY, endX, headerY),
          arrow: { x: bayX, y: headerY },
        });
      }
      width = Math.max(width, bayX + size.width);
      itemY += size.height + BAY_GAP;
    });
    y += groupHeight + GROUP_GAP;
  }
  const height = Math.max(HEADER + CLIENT.height, y - GROUP_GAP);

  const centerOf = (id: string) => {
    const rect = nodes.get(id)!;
    return rect.y + rect.height / 2;
  };
  const hostCenters = hosts.map((host) => centerOf(host.id));
  const clientCenterY =
    hostCenters.length === 0
      ? HEADER + CLIENT.height / 2
      : (hostCenters[0]! + hostCenters.at(-1)!) / 2;
  nodes.set(FLEET_CLIENT_NODE_ID, {
    x: 0,
    y: clientCenterY - CLIENT.height / 2,
    ...CLIENT,
  });

  // Wires leave the client a little apart, in the order they arrive, so they never cross.
  const fan = Math.min(CLIENT.height - 20, (routeEdges.length - 1) * 4);
  let wire = 0;
  for (const host of hosts) {
    const hostRoutes = routeEdges.filter((edge) => edge.to === host.id);
    hostRoutes.forEach((edge, index) => {
      const portY = centerOf(host.id) + (index - (hostRoutes.length - 1) / 2) * PORT_PITCH;
      const startY =
        clientCenterY + (routeEdges.length < 2 ? 0 : (wire / (routeEdges.length - 1) - 0.5) * fan);
      wire += 1;
      routes.set(edge.id, {
        d: `${sCurve(CLIENT.width, startY, pillX, portY)}H${cardX}`,
        pill: { x: pillX, y: portY - PILL.height / 2, ...PILL },
      });
    });
  }

  // Two links between the same pair run side by side, so the second badge steps below the first.
  const badges: FleetPoint[] = [];
  const placeBadge = (x: number, startY: number) => {
    let badgeY = startY;
    while (
      badges.some(
        (other) => Math.abs(other.x - x) < BADGE.width && Math.abs(other.y - badgeY) < BADGE.height,
      )
    ) {
      badgeY += BADGE.height;
    }
    const badge = { x, y: badgeY };
    badges.push(badge);
    return badge;
  };

  // Shorter spans take the inner brackets, so they nest instead of crossing.
  const span = (link: FleetLinkEdge) => Math.abs(centerOf(link.to) - centerOf(link.from));
  sameColumn
    .toSorted((left, right) => span(left) - span(right) || (left.id < right.id ? -1 : 1))
    .forEach((link, index) => {
      const bracketX = cardRight + BRACKET_FIRST + index * BRACKET_STEP;
      const fromY = centerOf(link.from) - PORT_OFFSET;
      const toY = centerOf(link.to) + PORT_OFFSET;
      linkGeometry.set(link.id, {
        d: elbowPath(cardRight, fromY, bracketX, cardRight + ARROW_LENGTH, toY),
        arrow: { x: cardRight, y: toY, dir: -1 },
        badge: placeBadge(bracketX, (fromY + toY) / 2),
      });
    });

  // A machine in one environment's bay that a second environment also links to.
  for (const link of links) {
    if (hostIds.has(link.to) || inBay.has(link.id) || stacked.has(link.id)) continue;
    const target = nodes.get(link.to)!;
    const fromY = centerOf(link.from) - PORT_OFFSET;
    const toY = target.y + target.height / 2;
    linkGeometry.set(link.id, {
      d: sCurve(cardRight, fromY, target.x - ARROW_LENGTH, toY),
      arrow: { x: target.x, y: toY, dir: 1 },
      // Beside the target, clear of the brackets between environments.
      badge: placeBadge(target.x - ARROW_LENGTH - BADGE.width, toY),
    });
  }

  // A badge stepped below its neighbours can end up past the last machine.
  const badgeBottom = Math.max(0, ...badges.map((badge) => badge.y + BADGE.height / 2));
  return {
    nodes,
    stacks: stackGeometry,
    routes,
    links: linkGeometry,
    handles,
    columns: [
      { id: "client", x: 0 },
      ...(hosts.length > 0 ? [{ id: "environments" as const, x: cardX }] : []),
      ...(bayOf.size > 0 ? [{ id: "targets" as const, x: bayX }] : []),
    ],
    width,
    height: Math.max(height, badgeBottom),
  };
}

/** What the arrow keys move between: every machine drawn, and each stack's control. */
export function fleetFocusRects(layout: FleetLayout): ReadonlyMap<string, FleetRect> {
  return new Map([
    ...layout.nodes,
    ...[...layout.stacks].map(([id, geometry]) => [id, geometry.face] as const),
  ]);
}

export type FleetDirection = "up" | "down" | "left" | "right";

/** The nearest item in that direction, for arrow keys. Sideways distance counts double. */
export function nextFleetNode(
  rects: ReadonlyMap<string, FleetRect>,
  fromId: string,
  direction: FleetDirection,
): string | null {
  const from = rects.get(fromId);
  if (!from) return null;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const center = (rect: FleetRect) => ({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  });
  const origin = center(from);
  let best: { readonly id: string; readonly score: number } | null = null;
  for (const [id, rect] of rects) {
    if (id === fromId) continue;
    const point = center(rect);
    const along = sign * (horizontal ? point.x - origin.x : point.y - origin.y);
    const across = Math.abs(horizontal ? point.y - origin.y : point.x - origin.x);
    if (along < 1) continue;
    const score = along + across * 2;
    if (best === null || score < best.score) best = { id, score };
  }
  return best?.id ?? null;
}

export interface FleetViewTransform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

const FLEET_MIN_SCALE = 0.3;
const FLEET_MAX_SCALE = 2;
/** A small setup is enlarged to fill the canvas, but not until two machines look like a poster. */
const FLEET_FIT_MAX_SCALE = 1.15;
const FLEET_FIT_PADDING = 28;

const fitScale = (available: number, extent: number) =>
  Math.max(0.01, (available - FLEET_FIT_PADDING * 2) / Math.max(1, extent));

/** Centers the whole map in the viewport at the largest scale that shows all of it. */
export function fitFleetLayout(
  layout: Pick<FleetLayout, "width" | "height">,
  viewport: { readonly width: number; readonly height: number },
): FleetViewTransform {
  const scale = Math.min(
    FLEET_FIT_MAX_SCALE,
    fitScale(viewport.width, layout.width),
    fitScale(viewport.height, layout.height),
  );
  return {
    scale,
    x: (viewport.width - layout.width * scale) / 2,
    y: (viewport.height - layout.height * scale) / 2,
  };
}

/** How tall the canvas wants to be at this width: the fitted map plus padding, within bounds. */
export function fleetCanvasHeight(
  layout: Pick<FleetLayout, "width" | "height">,
  width: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  const scale = Math.min(FLEET_FIT_MAX_SCALE, fitScale(width, layout.width));
  const wanted = Math.ceil(layout.height * scale + FLEET_FIT_PADDING * 2);
  return Math.max(bounds.min, Math.min(bounds.max, wanted));
}

/** Zooms by `factor`, keeping the map point under `anchor` where it is. */
export function zoomFleetView(
  view: FleetViewTransform,
  factor: number,
  anchor: FleetPoint,
): FleetViewTransform {
  // A fit of a very large setup can sit below the manual minimum; zooming out must not jump up.
  const floor = Math.min(FLEET_MIN_SCALE, view.scale);
  const scale = Math.max(floor, Math.min(FLEET_MAX_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}

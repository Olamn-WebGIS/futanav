import type { CampusBuilding, CampusRoad, CampusRoute, XY } from './types'

const MAX_SNAP_DISTANCE_METRES = 100
const AUTO_JOIN_MAX_GAP_METRES = 35
const NODE_PRECISION = 10

type RoadEdge = {
  id: number
  roadId: string
  segmentIndex: number
  startKey: string
  endKey: string
  start: XY
  end: XY
  length: number
  inferredJoin: boolean
  layer: string
  bridge: boolean
  tunnel: boolean
}

type SourceSegment = {
  road: CampusRoad
  segmentIndex: number
  start: XY
  end: XY
  cuts: Array<{ fraction: number; point: XY }>
}

type Graph = {
  adjacency: Map<string, Array<{ node: string; weight: number; inferredJoin: boolean }>>
  coordinates: Map<string, XY>
  edges: RoadEdge[]
  inferredJoins: XY[][]
  componentByNode: Map<string, number>
}

type RoadSnap = {
  edge: RoadEdge
  point: XY
  fraction: number
  distanceMetres: number
}

type QueueEntry = { node: string; distance: number }

class MinHeap {
  private values: QueueEntry[] = []

  get size() { return this.values.length }

  push(value: QueueEntry) {
    this.values.push(value)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.values[parent].distance <= value.distance) break
      this.values[index] = this.values[parent]
      index = parent
    }
    this.values[index] = value
  }

  pop(): QueueEntry | undefined {
    if (!this.values.length) return undefined
    const first = this.values[0]
    const last = this.values.pop()!
    if (this.values.length) {
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        if (left >= this.values.length) break
        const child = right < this.values.length && this.values[right].distance < this.values[left].distance ? right : left
        if (this.values[child].distance >= last.distance) break
        this.values[index] = this.values[child]
        index = child
      }
      this.values[index] = last
    }
    return first
  }
}

function distance(a: XY, b: XY): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function nodeKey(point: XY): string {
  return `${Math.round(point[0] * NODE_PRECISION)},${Math.round(point[1] * NODE_PRECISION)}`
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

function canConnectAtIntersection(first: CampusRoad, second: CampusRoad): boolean {
  if (first.id === second.id) return true
  if ((first.layer ?? '0') !== (second.layer ?? '0')) return false
  if (Boolean(first.bridge) !== Boolean(second.bridge)) return false
  if (Boolean(first.tunnel) !== Boolean(second.tunnel)) return false
  return true
}

function findIntersection(first: SourceSegment, second: SourceSegment): { first: XY; second: XY } | null {
  if (!canConnectAtIntersection(first.road, second.road)) return null
  const ax = first.start[0]
  const ay = first.start[1]
  const rx = first.end[0] - ax
  const ry = first.end[1] - ay
  const cx = second.start[0]
  const cy = second.start[1]
  const sx = second.end[0] - cx
  const sy = second.end[1] - cy
  const denominator = cross(rx, ry, sx, sy)
  if (Math.abs(denominator) < 1e-9) return null

  const qx = cx - ax
  const qy = cy - ay
  const firstFraction = cross(qx, qy, sx, sy) / denominator
  const secondFraction = cross(qx, qy, rx, ry) / denominator
  const epsilon = 1e-9
  if (firstFraction < -epsilon || firstFraction > 1 + epsilon || secondFraction < -epsilon || secondFraction > 1 + epsilon) return null

  const fraction = Math.max(0, Math.min(1, firstFraction))
  const point: XY = [ax + fraction * rx, ay + fraction * ry]
  return { first: point, second: point }
}

const graphCache = new WeakMap<CampusRoad[], Graph>()

function buildGraph(roads: CampusRoad[]): Graph {
  const cached = graphCache.get(roads)
  if (cached) return cached

  const adjacency = new Map<string, Array<{ node: string; weight: number; inferredJoin: boolean }>>()
  const coordinates = new Map<string, XY>()
  const edges: RoadEdge[] = []
  const segments: SourceSegment[] = []

  function ensureNode(point: XY): string {
    const key = nodeKey(point)
    if (!adjacency.has(key)) adjacency.set(key, [])
    if (!coordinates.has(key)) coordinates.set(key, point)
    return key
  }

  for (const road of roads) {
    if (!road.walkable) continue
    for (let index = 0; index < road.coordinates.length - 1; index += 1) {
      const start = road.coordinates[index]
      const end = road.coordinates[index + 1]
      if (distance(start, end) === 0) continue
      segments.push({ road, segmentIndex: index, start, end, cuts: [{ fraction: 0, point: start }, { fraction: 1, point: end }] })
    }
  }

  // Node at-grade line intersections which GeoJSON exported without shared vertices.
  // Do not join a bridge or tunnel to a surface road just because 2D lines cross.
  const cellSize = 30
  const grid = new Map<string, number[]>()
  const cellKey = (x: number, y: number) => `${x},${y}`
  segments.forEach((segment, index) => {
    const minCellX = Math.floor(Math.min(segment.start[0], segment.end[0]) / cellSize)
    const maxCellX = Math.floor(Math.max(segment.start[0], segment.end[0]) / cellSize)
    const minCellY = Math.floor(Math.min(segment.start[1], segment.end[1]) / cellSize)
    const maxCellY = Math.floor(Math.max(segment.start[1], segment.end[1]) / cellSize)
    for (let x = minCellX; x <= maxCellX; x += 1) {
      for (let y = minCellY; y <= maxCellY; y += 1) {
        const key = cellKey(x, y)
        const bucket = grid.get(key) ?? []
        bucket.push(index)
        grid.set(key, bucket)
      }
    }
  })
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex]
    const firstMinX = Math.min(first.start[0], first.end[0])
    const firstMaxX = Math.max(first.start[0], first.end[0])
    const firstMinY = Math.min(first.start[1], first.end[1])
    const firstMaxY = Math.max(first.start[1], first.end[1])
    const firstDx = first.end[0] - first.start[0]
    const firstDy = first.end[1] - first.start[1]
    const firstLengthSquared = firstDx * firstDx + firstDy * firstDy

    const minCellX = Math.floor(firstMinX / cellSize)
    const maxCellX = Math.floor(firstMaxX / cellSize)
    const minCellY = Math.floor(firstMinY / cellSize)
    const maxCellY = Math.floor(firstMaxY / cellSize)
    const nearby = new Set<number>()
    for (let x = minCellX; x <= maxCellX; x += 1) {
      for (let y = minCellY; y <= maxCellY; y += 1) {
        for (const index of grid.get(cellKey(x, y)) ?? []) {
          if (index > firstIndex) nearby.add(index)
        }
      }
    }

    for (const secondIndex of nearby) {
      const second = segments[secondIndex]
      const intersection = findIntersection(first, second)
      if (!intersection) continue
      const secondDx = second.end[0] - second.start[0]
      const secondDy = second.end[1] - second.start[1]
      const firstFraction = ((intersection.first[0] - first.start[0]) * firstDx + (intersection.first[1] - first.start[1]) * firstDy) / firstLengthSquared
      const secondLengthSquared = secondDx * secondDx + secondDy * secondDy
      const secondFraction = ((intersection.second[0] - second.start[0]) * secondDx + (intersection.second[1] - second.start[1]) * secondDy) / secondLengthSquared
      first.cuts.push({ fraction: firstFraction, point: intersection.first })
      second.cuts.push({ fraction: secondFraction, point: intersection.second })
    }
  }

  for (const segment of segments) {
    segment.cuts.sort((a, b) => a.fraction - b.fraction)
    const cuts = segment.cuts.filter((cut, index, all) => index === 0 || Math.abs(cut.fraction - all[index - 1].fraction) > 1e-9)
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const start = cuts[index].point
      const end = cuts[index + 1].point
      const length = distance(start, end)
      if (length < 0.001) continue
      const startKey = ensureNode(start)
      const endKey = ensureNode(end)
      const edge = {
        id: edges.length,
        roadId: segment.road.id,
        segmentIndex: segment.segmentIndex,
        startKey,
        endKey,
        start,
        end,
        length,
        inferredJoin: false,
        layer: segment.road.layer ?? '0',
        bridge: Boolean(segment.road.bridge),
        tunnel: Boolean(segment.road.tunnel),
      }
      edges.push(edge)
      adjacency.get(startKey)!.push({ node: endKey, weight: length, inferredJoin: false })
      adjacency.get(endKey)!.push({ node: startKey, weight: length, inferredJoin: false })
    }
  }

  const originalComponentByNode = new Map<string, number>()
  let componentCount = 0
  for (const node of adjacency.keys()) {
    if (originalComponentByNode.has(node)) continue
    const pending = [node]
    originalComponentByNode.set(node, componentCount)
    while (pending.length) {
      const current = pending.pop()!
      for (const edge of adjacency.get(current) ?? []) {
        if (originalComponentByNode.has(edge.node)) continue
        originalComponentByNode.set(edge.node, componentCount)
        pending.push(edge.node)
      }
    }
    componentCount += 1
  }

  const endpoints = [...adjacency.entries()]
    .filter(([, connected]) => connected.length === 1)
    .map(([node]) => ({
      node,
      point: coordinates.get(node)!,
      edge: edges.find((edge) => edge.startKey === node || edge.endKey === node)!,
    }))
  const candidates: Array<{ first: typeof endpoints[number]; second: typeof endpoints[number]; gap: number }> = []
  for (let firstIndex = 0; firstIndex < endpoints.length; firstIndex += 1) {
    const first = endpoints[firstIndex]
    for (let secondIndex = firstIndex + 1; secondIndex < endpoints.length; secondIndex += 1) {
      const second = endpoints[secondIndex]
      if (originalComponentByNode.get(first.node) === originalComponentByNode.get(second.node)) continue
      if (first.edge.layer !== second.edge.layer || first.edge.bridge !== second.edge.bridge || first.edge.tunnel !== second.edge.tunnel) continue
      const gap = distance(first.point, second.point)
      if (gap > 0.5 && gap <= AUTO_JOIN_MAX_GAP_METRES) candidates.push({ first, second, gap })
    }
  }
  candidates.sort((first, second) => first.gap - second.gap)

  const componentParent = Array.from({ length: componentCount }, (_, index) => index)
  function findComponent(component: number): number {
    while (componentParent[component] !== component) {
      componentParent[component] = componentParent[componentParent[component]]
      component = componentParent[component]
    }
    return component
  }
  const claimedEndpoints = new Set<string>()
  const inferredJoins: XY[][] = []
  for (const { first, second, gap } of candidates) {
    if (claimedEndpoints.has(first.node) || claimedEndpoints.has(second.node)) continue
    const firstComponent = findComponent(originalComponentByNode.get(first.node)!)
    const secondComponent = findComponent(originalComponentByNode.get(second.node)!)
    if (firstComponent === secondComponent) continue

    componentParent[firstComponent] = secondComponent
    const edge: RoadEdge = {
      id: edges.length,
      roadId: 'inferred-gap',
      segmentIndex: -1,
      startKey: first.node,
      endKey: second.node,
      start: first.point,
      end: second.point,
      length: gap,
      inferredJoin: true,
      layer: first.edge.layer,
      bridge: first.edge.bridge,
      tunnel: first.edge.tunnel,
    }
    edges.push(edge)
    adjacency.get(first.node)!.push({ node: second.node, weight: gap, inferredJoin: true })
    adjacency.get(second.node)!.push({ node: first.node, weight: gap, inferredJoin: true })
    inferredJoins.push([first.point, second.point])
    claimedEndpoints.add(first.node)
    claimedEndpoints.add(second.node)
  }

  const componentByNode = new Map<string, number>()
  let finalComponent = 0
  for (const node of adjacency.keys()) {
    if (componentByNode.has(node)) continue
    const pending = [node]
    componentByNode.set(node, finalComponent)
    while (pending.length) {
      const current = pending.pop()!
      for (const edge of adjacency.get(current) ?? []) {
        if (componentByNode.has(edge.node)) continue
        componentByNode.set(edge.node, finalComponent)
        pending.push(edge.node)
      }
    }
    finalComponent += 1
  }

  const graph = { adjacency, coordinates, edges, inferredJoins, componentByNode }
  graphCache.set(roads, graph)
  return graph
}

export function countRoadComponents(roads: CampusRoad[]): number {
  const graph = buildGraph(roads)
  const visited = new Set<string>()
  let components = 0
  for (const node of graph.adjacency.keys()) {
    if (visited.has(node)) continue
    components += 1
    const pending = [node]
    visited.add(node)
    while (pending.length) {
      const current = pending.pop()!
      for (const edge of graph.adjacency.get(current) ?? []) {
        if (visited.has(edge.node)) continue
        visited.add(edge.node)
        pending.push(edge.node)
      }
    }
  }
  return components
}

export function countInferredRoadJoins(roads: CampusRoad[]): number {
  return buildGraph(roads).inferredJoins.length
}

function closestRoadSnap(point: XY, graph: Graph, reachableComponent?: number): RoadSnap | null {
  let best: RoadSnap | null = null
  for (const edge of graph.edges) {
    if (reachableComponent !== undefined && graph.componentByNode.get(edge.startKey) !== reachableComponent) continue
    const dx = edge.end[0] - edge.start[0]
    const dy = edge.end[1] - edge.start[1]
    const fraction = Math.max(0, Math.min(1, ((point[0] - edge.start[0]) * dx + (point[1] - edge.start[1]) * dy) / (edge.length * edge.length)))
    const snapped: XY = [edge.start[0] + fraction * dx, edge.start[1] + fraction * dy]
    const distanceMetres = distance(point, snapped)
    if (!best || distanceMetres < best.distanceMetres) best = { edge, point: snapped, fraction, distanceMetres }
  }
  return best
}

function findNetworkPath(graph: Graph, start: RoadSnap, end: RoadSnap): { coordinates: XY[]; distanceMetres: number; inferredJoins: XY[][] } | null {
  const sourceEdge = start.edge
  const targetEdge = end.edge
  const sourceSeeds = [
    { node: sourceEdge.startKey, cost: start.fraction * sourceEdge.length },
    { node: sourceEdge.endKey, cost: (1 - start.fraction) * sourceEdge.length },
  ]
  const targetCosts = new Map<string, number>([
    [targetEdge.startKey, end.fraction * targetEdge.length],
    [targetEdge.endKey, (1 - end.fraction) * targetEdge.length],
  ])
  let bestDistance = Number.POSITIVE_INFINITY
  let bestGoal: string | null = null
  let direct = false

  if (sourceEdge.id === targetEdge.id) {
    bestDistance = Math.abs(start.fraction - end.fraction) * sourceEdge.length
    direct = true
  }

  const distances = new Map<string, number>()
  const previous = new Map<string, string | null>()
  const previousUsedJoin = new Map<string, boolean>()
  const queue = new MinHeap()
  for (const seed of sourceSeeds) {
    if (seed.cost < (distances.get(seed.node) ?? Number.POSITIVE_INFINITY)) {
      distances.set(seed.node, seed.cost)
      previous.set(seed.node, null)
      queue.push({ node: seed.node, distance: seed.cost })
    }
  }

  while (queue.size) {
    const current = queue.pop()!
    if (current.distance !== distances.get(current.node)) continue
    if (current.distance >= bestDistance) break

    const targetCost = targetCosts.get(current.node)
    if (targetCost !== undefined && current.distance + targetCost < bestDistance) {
      bestDistance = current.distance + targetCost
      bestGoal = current.node
      direct = false
    }

    for (const edge of graph.adjacency.get(current.node) ?? []) {
      const candidate = current.distance + edge.weight
      if (candidate >= (distances.get(edge.node) ?? Number.POSITIVE_INFINITY)) continue
      distances.set(edge.node, candidate)
      previous.set(edge.node, current.node)
      previousUsedJoin.set(edge.node, edge.inferredJoin)
      queue.push({ node: edge.node, distance: candidate })
    }
  }

  if (!Number.isFinite(bestDistance)) return null
  if (direct) {
    return {
      coordinates: [start.point, end.point],
      distanceMetres: bestDistance,
      inferredJoins: sourceEdge.inferredJoin ? [[start.point, end.point]] : [],
    }
  }

  const nodePath: string[] = []
  const inferredJoins: XY[][] = []
  let cursor: string | null = bestGoal
  while (cursor !== null) {
    nodePath.push(cursor)
    const previousNode = previous.get(cursor)
    if (previousNode && previousUsedJoin.get(cursor)) {
      inferredJoins.push([graph.coordinates.get(previousNode)!, graph.coordinates.get(cursor)!])
    }
    cursor = previous.get(cursor) ?? null
  }
  nodePath.reverse()
  if (sourceEdge.inferredJoin && nodePath.length) inferredJoins.push([start.point, graph.coordinates.get(nodePath[0])!])
  if (targetEdge.inferredJoin && bestGoal) inferredJoins.push([graph.coordinates.get(bestGoal)!, end.point])
  return {
    coordinates: [start.point, ...nodePath.map((node) => graph.coordinates.get(node)!), end.point],
    distanceMetres: bestDistance,
    inferredJoins,
  }
}

export function calculateRoute(start: XY, destination: CampusBuilding, roads: CampusRoad[]): CampusRoute {
  const graph = buildGraph(roads)
  if (!graph.edges.length) throw new Error('We could not find a walking path here yet. Try a nearby starting place.')

  const startSnap = closestRoadSnap(start, graph)
  if (!startSnap) throw new Error('We could not find a nearby path from your starting point. Choose a nearby location and try again.')
  const startComponent = graph.componentByNode.get(startSnap.edge.startKey)
  const endSnap = closestRoadSnap(destination.coordinate, graph, startComponent)
  if (!endSnap) throw new Error(`We could not find a path to ${destination.name} from this starting point. Try another start or ask someone nearby.`)
  if (startSnap.distanceMetres > MAX_SNAP_DISTANCE_METRES) {
    throw new Error(`Your starting point is about ${Math.round(startSnap.distanceMetres)} m from the nearest campus path. Choose a closer starting place and try again.`)
  }
  if (endSnap.distanceMetres > MAX_SNAP_DISTANCE_METRES) {
    throw new Error(`${destination.name} is about ${Math.round(endSnap.distanceMetres)} m from the nearest campus path. Try a different starting place.`)
  }

  const networkPath = findNetworkPath(graph, startSnap, endSnap)
  if (!networkPath) {
    throw new Error(`We could not find a connected walking route to ${destination.name}. Try a different starting place.`)
  }

  const distanceMetres = networkPath.distanceMetres + startSnap.distanceMetres + endSnap.distanceMetres
  const durationMinutes = Math.max(1, Math.ceil(distanceMetres / 80))
  const longConnector = Math.max(startSnap.distanceMetres, endSnap.distanceMetres) > 20

  return {
    coordinates: [start, ...networkPath.coordinates, destination.coordinate],
    roadCoordinates: networkPath.coordinates,
    inferredJoins: networkPath.inferredJoins,
    startConnector: [start, startSnap.point],
    endConnector: [endSnap.point, destination.coordinate],
    distanceMetres,
    durationMinutes,
    networkDistanceMetres: networkPath.distanceMetres,
    warning: `This route is a guide for your walk. ${networkPath.inferredJoins.length ? 'A dashed section is estimated; check that the way is open. ' : ''}${longConnector ? 'A short approach to a path or building is estimated. ' : ''}Follow campus signs as you walk.`,
  }
}
import type { CampusRoad, CampusRoute, XY } from './types'

export type RouteInstruction = {
  id: string
  kind: 'start' | 'mapped' | 'turn' | 'inferred' | 'connector' | 'arrive'
  title: string
  detail: string
  target?: XY
}

type RouteEvent = {
  distance: number
  kind: 'turn' | 'inferred'
  point: XY
  target?: XY
  direction?: 'left' | 'right'
  gapMetres?: number
}

function distance(a: XY, b: XY): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function roadNameAt(point: XY, roads: CampusRoad[]): string {
  let nearestDistance = Number.POSITIVE_INFINITY
  let nearestRoad: CampusRoad | null = null

  for (const road of roads) {
    if (!road.walkable) continue
    for (let index = 1; index < road.coordinates.length; index += 1) {
      const start = road.coordinates[index - 1]
      const end = road.coordinates[index]
      const dx = end[0] - start[0]
      const dy = end[1] - start[1]
      const lengthSquared = dx * dx + dy * dy
      if (lengthSquared === 0) continue
      const fraction = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
      const nearestPoint: XY = [start[0] + fraction * dx, start[1] + fraction * dy]
      const separation = distance(point, nearestPoint)
      if (separation < nearestDistance) {
        nearestDistance = separation
        nearestRoad = road
      }
    }
  }

  if (!nearestRoad || nearestDistance > 12 || !nearestRoad.hasName) return ''
  return nearestRoad.name
}

function roadDetailAt(point: XY, roads: CampusRoad[], prefix: string): string {
  const name = roadNameAt(point, roads)
  return name ? `${prefix}${name}` : ''
}

function pointAtDistance(path: XY[], cumulative: number[], progress: number): XY {
  const safeProgress = Math.max(0, Math.min(progress, cumulative.at(-1) ?? 0))
  const index = cumulative.findIndex((value, currentIndex) => currentIndex > 0 && value >= safeProgress)
  if (index < 0) return path.at(-1) ?? [0, 0]
  const segmentLength = cumulative[index] - cumulative[index - 1]
  const fraction = segmentLength > 0 ? (safeProgress - cumulative[index - 1]) / segmentLength : 0
  return [
    path[index - 1][0] + (path[index][0] - path[index - 1][0]) * fraction,
    path[index - 1][1] + (path[index][1] - path[index - 1][1]) * fraction,
  ]
}

function routeProgress(point: XY, coordinates: XY[], cumulative: number[]): number {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < coordinates.length; index += 1) {
    const separation = distance(point, coordinates[index])
    if (separation < nearestDistance) {
      nearestDistance = separation
      nearestIndex = index
    }
  }
  return cumulative[nearestIndex] ?? 0
}

export function buildRouteInstructions(
  route: CampusRoute,
  startName: string,
  destinationName: string,
  roads: CampusRoad[],
): RouteInstruction[] {
  const instructions: RouteInstruction[] = [
    { id: 'start', kind: 'start', title: 'Start', detail: startName, target: route.coordinates[0] },
  ]
  const startConnectorDistance = distance(...route.startConnector)
  const endConnectorDistance = distance(...route.endConnector)

  if (startConnectorDistance > 3) {
    instructions.push({
      id: 'start-connector',
      kind: 'connector',
      title: `Walk to the nearby path · about ${Math.round(startConnectorDistance)} m`,
      detail: roadDetailAt(route.startConnector[1], roads, 'Nearby road: '),
      target: route.startConnector[1],
    })
  }

  const path = route.roadCoordinates
  const cumulative = [0]
  for (let index = 1; index < path.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distance(path[index - 1], path[index]))
  }
  const networkLength = cumulative[cumulative.length - 1] ?? route.networkDistanceMetres
  const events: RouteEvent[] = []

  // Suggest clear bends from the mapped polyline; these are not verified junction instructions.
  let lastTurnDistance = -70
  for (let index = 1; index < path.length - 1; index += 1) {
    const previous = path[index - 1]
    const current = path[index]
    const next = path[index + 1]
    const incoming: XY = [current[0] - previous[0], current[1] - previous[1]]
    const outgoing: XY = [next[0] - current[0], next[1] - current[1]]
    if (distance(previous, current) < 4 || distance(current, next) < 4) continue
    const angle = Math.atan2(
      incoming[0] * outgoing[1] - incoming[1] * outgoing[0],
      incoming[0] * outgoing[0] + incoming[1] * outgoing[1],
    ) * 180 / Math.PI
    const progress = cumulative[index]
    if (Math.abs(angle) < 42 || Math.abs(angle) > 150 || progress - lastTurnDistance < 70) continue
    events.push({ distance: progress, kind: 'turn', direction: angle > 0 ? 'left' : 'right', point: current })
    lastTurnDistance = progress
  }

  route.inferredJoins.forEach((join) => {
    events.push({
      distance: routeProgress(join[0], path, cumulative),
      kind: 'inferred',
      point: join[0],
      target: join[1],
      gapMetres: distance(join[0], join[1]),
    })
  })

  events.sort((a, b) => a.distance - b.distance)
  let previousDistance = 0
  let eventIndex = 0
  for (const event of events) {
    const interval = Math.max(0, event.distance - previousDistance)
    if (interval >= 25) {
      instructions.push({
        id: `mapped-${eventIndex}`,
        kind: 'mapped',
        title: `Follow the campus path · about ${Math.round(interval)} m`,
        detail: roadDetailAt(pointAtDistance(path, cumulative, previousDistance + interval / 2), roads, 'Road: '),
        target: event.point,
      })
    }
    if (event.kind === 'turn') {
      instructions.push({
        id: `turn-${eventIndex}`,
        kind: 'turn',
        title: `At the next bend, turn ${event.direction}`,
        detail: roadDetailAt(event.point, roads, 'Road: '),
        target: event.target,
      })
    } else {
      instructions.push({
        id: `inferred-${eventIndex}`,
        kind: 'inferred',
        title: `Continue across a short gap · about ${Math.round(event.gapMetres ?? 0)} m`,
        detail: roadDetailAt(event.point, roads, 'Road: '),
        target: event.point,
      })
    }
    previousDistance = event.distance
    eventIndex += 1
  }

  const remainingMappedDistance = Math.max(0, networkLength - previousDistance)
  if (remainingMappedDistance >= 25 || events.length === 0) {
    instructions.push({
      id: 'mapped-final',
      kind: 'mapped',
      title: `Continue along the campus path · about ${Math.round(remainingMappedDistance)} m`,
      detail: roadDetailAt(pointAtDistance(path, cumulative, previousDistance + remainingMappedDistance / 2), roads, 'Road: '),
      target: path.at(-1),
    })
  }

  if (endConnectorDistance > 3) {
    instructions.push({
      id: 'destination-connector',
      kind: 'connector',
      title: `Continue to ${destinationName} · about ${Math.round(endConnectorDistance)} m`,
      detail: roadDetailAt(route.endConnector[0], roads, 'Nearby road: '),
      target: route.endConnector[1],
    })
  }

  instructions.push({ id: 'arrive', kind: 'arrive', title: 'Destination', detail: destinationName, target: route.endConnector[1] })
  return instructions
}

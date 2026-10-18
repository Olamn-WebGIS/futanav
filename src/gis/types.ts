export type XY = [number, number]
export type LatLng = [number, number]

export type CampusBuilding = {
  id: string
  name: string
  photo?: string
  coordinate: XY
}

export type CampusRoad = {
  id: string
  name: string
  hasName: boolean
  highway?: string
  layer?: string
  bridge?: boolean
  tunnel?: boolean
  walkable: boolean
  coordinates: XY[]
  sourceCost?: number
}

export type CampusData = {
  buildings: CampusBuilding[]
  roads: CampusRoad[]
  boundary: XY[][][]
  inferredRoadJoins: number
  warnings: string[]
}

export type CampusRoute = {
  coordinates: XY[]
  roadCoordinates: XY[]
  inferredJoins: XY[][]
  startConnector: [XY, XY]
  endConnector: [XY, XY]
  distanceMetres: number
  durationMinutes: number
  networkDistanceMetres: number
  warning: string
}

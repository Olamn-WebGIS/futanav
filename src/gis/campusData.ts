import proj4 from 'proj4'
import type { CampusBuilding, CampusData, CampusRoad, XY } from './types'
import { countInferredRoadJoins, countRoadComponents } from './routing'

const BUILDING_CRS = '+proj=utm +zone=31 +a=6378249.145 +rf=293.465 +towgs84=-92,-93,122,0,0,0,0 +units=m +no_defs'

proj4.defs('FUTA:MINNA_UTM31', BUILDING_CRS)

function toXY(value: unknown): XY | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const x = Number(value[0])
  const y = Number(value[1])
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

async function fetchGeoJson(path: string): Promise<any> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`)
  return response.json()
}

export async function loadCampusData(): Promise<CampusData> {
  const [buildingData, roadData, boundaryData] = await Promise.all([
    fetchGeoJson(`${import.meta.env.BASE_URL}data/Futa%20Buildings.geojson`),
    fetchGeoJson(`${import.meta.env.BASE_URL}data/Futa%20Road.geojson`),
    fetchGeoJson(`${import.meta.env.BASE_URL}data/Futa%20boundary.geojson`),
  ])

  const buildingCrs = buildingData.crs?.properties?.name ?? ''
  const roadCrs = roadData.crs?.properties?.name ?? ''
  const boundaryCrs = boundaryData.crs?.properties?.name ?? ''
  const warnings: string[] = []

  if (!buildingCrs.includes('26331')) throw new Error(`Unexpected building CRS: ${buildingCrs || 'not specified'}. Expected EPSG:26331.`)
  if (!roadCrs.includes('3857') || !boundaryCrs.includes('3857')) {
    throw new Error('Road and boundary data must use EPSG:3857 for the current GIS loader.')
  }

  const buildings: CampusBuilding[] = []
  for (const feature of buildingData.features ?? []) {
    const coordinate = toXY(feature.geometry?.coordinates)
    if (!coordinate || feature.geometry?.type !== 'Point') continue
    const projected = proj4('FUTA:MINNA_UTM31', 'EPSG:3857', coordinate) as XY
    if (!projected.every(Number.isFinite)) continue
    const properties = feature.properties ?? {}
    const id = String(properties.fid ?? properties.id ?? buildings.length + 1)
    const name = String(properties.Name ?? '').trim() || `Unnamed campus location ${id}`
    buildings.push({
      id,
      name,
      coordinate: projected,
      ...(typeof properties.Photo === 'string' && properties.Photo.trim() ? { photo: properties.Photo.trim() } : {}),
    })
  }

  const roads: CampusRoad[] = []
  for (const [index, feature] of (roadData.features ?? []).entries()) {
    const geometry = feature.geometry
    const lineParts = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : []
    const properties = feature.properties ?? {}
    const highway = String(properties.highway ?? '').toLowerCase()
    const footAccess = String(properties.foot ?? '').toLowerCase()
    const generalAccess = String(properties.access ?? '').toLowerCase()
    const walkable = footAccess !== 'no' && footAccess !== 'private'
      && generalAccess !== 'no' && generalAccess !== 'private'
      && !['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(highway)

    for (const [partIndex, part] of lineParts.entries()) {
      if (!Array.isArray(part)) continue
      const coordinates = part.map(toXY).filter((point: XY | null): point is XY => point !== null)
      if (coordinates.length < 2) continue
      roads.push({
        id: `${String(properties.full_id ?? properties.fid ?? index + 1)}-${partIndex + 1}`,
        name: String(properties.name ?? properties.Name ?? `Campus road ${index + 1}`),
        hasName: typeof properties.name === 'string' && Boolean(properties.name.trim())
          || typeof properties.Name === 'string' && Boolean(properties.Name.trim()),
        highway,
        layer: String(properties.layer ?? '0'),
        bridge: Boolean(properties.bridge && properties.bridge !== 'no'),
        tunnel: Boolean(properties.tunnel && properties.tunnel !== 'no'),
        walkable,
        coordinates,
        ...(Number.isFinite(Number(properties.cost)) ? { sourceCost: Number(properties.cost) } : {}),
      })
    }
  }

  const boundary: XY[][][] = []
  for (const feature of boundaryData.features ?? []) {
    const geometry = feature.geometry
    const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []
    for (const polygon of polygons) {
      const rings = polygon.map((ring: unknown[]) => ring.map(toXY).filter((point: XY | null): point is XY => point !== null))
      if (rings.length && rings[0].length >= 4) boundary.push(rings)
    }
  }

  if (!buildings.length) throw new Error('No usable building points were found in the GeoJSON.')
  if (!roads.length) throw new Error('No usable LineString road features were found in the GeoJSON.')
  const walkableRoads = roads.filter((road) => road.walkable)
  if (walkableRoads.length !== roads.length) warnings.push(`${roads.length - walkableRoads.length} road segments were excluded from routing because access is restricted or the road is a motorway/trunk.`)
  const components = countRoadComponents(walkableRoads)
  const inferredRoadJoins = countInferredRoadJoins(walkableRoads)
  if (inferredRoadJoins) warnings.push(`${inferredRoadJoins} short endpoint gaps (up to 35 m) are connected virtually for route previews. These inferred links are dashed on routes and must be checked against the real paths.`)
  if (components > 1) warnings.push(`The mapped walking network has ${components} disconnected components. Some start/destination pairs may not have a connected route.`)
  if (roads.length < (roadData.features?.length ?? 0)) warnings.push('Some road geometries were skipped because they were invalid or had fewer than two usable coordinates.')

  return { buildings, roads, boundary, inferredRoadJoins, warnings }
}

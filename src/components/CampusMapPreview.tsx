import { useEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Pane, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { Compass, LocateFixed, MapPinned } from 'lucide-react'
import { divIcon, latLngBounds, point, type LatLngExpression, type Polyline as LeafletPolyline } from 'leaflet'
import 'leaflet-textpath'
import proj4 from 'proj4'
import type { CampusData, CampusRoad, CampusRoute, XY } from '../gis/types'

type CampusMapProps = {
  data: CampusData
  selectedBuildingId: string | null
  route: CampusRoute | null
  currentLocation: XY | null
  currentHeading: number
  resetKey: number
  onSelectBuilding: (id: string) => void
  onMapControl: () => void
}

function toLatLng([x, y]: XY): [number, number] {
  const [longitude, latitude] = proj4('EPSG:3857', 'EPSG:4326', [x, y])
  return [latitude, longitude]
}

function createBuildingPin(color: string, size: number) {
  const iconWidth = Math.round(28 * size)
  const iconHeight = Math.round(36 * size)
  return divIcon({
    className: 'building-pin-wrapper',
    html: `<svg class="building-pin" xmlns="http://www.w3.org/2000/svg" width="${iconWidth}" height="${iconHeight}" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 1.5C7.2 1.5 2 6.7 2 13.2c0 8.2 12 21.1 12 21.1s12-12.9 12-21.1C26 6.7 20.8 1.5 14 1.5Z" fill="${color}" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><circle cx="14" cy="13" r="4.2" fill="white"/><circle cx="14" cy="13" r="1.8" fill="${color}"/></svg>`,
    iconSize: [iconWidth, iconHeight],
    iconAnchor: [iconWidth / 2, iconHeight - 1],
    popupAnchor: [0, -iconHeight + 2],
  })
}

function createGateIcon(color: string, size: number) {
  const iconSize = Math.round(38 * size)
  return divIcon({
    className: 'gate-marker-wrapper',
    html: `<svg class="gate-marker" xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="17" fill="white" stroke="${color}" stroke-width="2.5"/><path d="M9 27V17a10 10 0 0 1 20 0v10M7 27h24M12 17v10m5-10v10m5-10v10m5-10v10" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 14h24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    iconSize: [iconSize, iconSize],
    iconAnchor: [iconSize / 2, iconSize / 2],
    popupAnchor: [0, -iconSize / 2],
  })
}

function createUserLocationIcon(heading: number) {
  return divIcon({
    className: 'user-location-marker-wrapper',
    html: `<span class="user-location-marker" style="--user-heading:${heading}deg"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="26" viewBox="0 0 20 26" aria-hidden="true"><path d="M10 1.5 18.2 23.5 10 19 1.8 23.5 10 1.5Z" fill="white" stroke="#145da8" stroke-width="1.5" stroke-linejoin="round"/></svg></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

const regularBuildingPin = createBuildingPin('#2f874d', 0.5)
const selectedBuildingPin = createBuildingPin('#2f874d', 0.5)
const regularGateIcon = createGateIcon('#2f874d', 0.5)
const selectedGateIcon = createGateIcon('#2f874d', 0.5)

function getBuildingPhotoUrl(photo: string): string {
  return `${import.meta.env.BASE_URL}building-photos/${encodeURIComponent(photo)}.webp`
}

function FitCampusView({ data, route, resetKey }: { data: CampusData; route: CampusRoute | null; resetKey: number }) {
  const map = useMap()

  useEffect(() => {
    const coordinates = route?.coordinates ?? [...data.buildings.map((building) => building.coordinate), ...data.boundary.flat(2)]
    if (coordinates.length) {
      const points = coordinates.map(toLatLng)
      map.fitBounds(points, { padding: [32, 32], maxZoom: route ? 17 : 16 })
    }
  }, [data, map, resetKey, route])

  return null
}

function TrackMapZoom({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap()

  useEffect(() => {
    const updateZoom = () => onZoomChange(map.getZoom())
    updateZoom()
    map.on('zoomend', updateZoom)
    return () => { map.off('zoomend', updateZoom) }
  }, [map, onZoomChange])

  return null
}

function CampusBoundaryView({ data }: { data: CampusData }) {
  const map = useMap()
  const [maskRings, setMaskRings] = useState<LatLngExpression[][] | null>(null)

  useEffect(() => {
    const boundaryRings = data.boundary
      .map((polygon) => polygon[0]?.map(toLatLng))
      .filter((ring): ring is [number, number][] => Boolean(ring && ring.length >= 4))
    if (!boundaryRings.length) return

    const boundaryBounds = latLngBounds(boundaryRings.flat())
    const minZoom = map.getBoundsZoom(boundaryBounds, false, point(32, 32))
    map.setMinZoom(minZoom)
    map.setMaxBounds(boundaryBounds)
    map.fitBounds(boundaryBounds, { padding: [32, 32] })

    const updateMask = () => {
      const outsideBounds = map.getBounds().pad(4)
      const southWest = outsideBounds.getSouthWest()
      const northEast = outsideBounds.getNorthEast()
      const northWest = outsideBounds.getNorthWest()
      const southEast = outsideBounds.getSouthEast()
      const outerRing: LatLngExpression[] = [northWest, northEast, southEast, southWest, northWest]
      setMaskRings([outerRing, ...boundaryRings])
    }

    updateMask()
    map.on('moveend zoomend resize', updateMask)
    return () => { map.off('moveend zoomend resize', updateMask) }
  }, [data.boundary, map])

  return (
    <Pane name="campus-boundary-mask" style={{ zIndex: 450, pointerEvents: 'none' }}>
      {maskRings && <Polygon
          positions={maskRings}
          interactive={false}
          pathOptions={{ color: 'transparent', weight: 0, fillColor: '#f5f7f1', fillOpacity: 1, fillRule: 'evenodd', stroke: false }}
        />}
    </Pane>
  )
}

type TextPathPolyline = LeafletPolyline & {
  setText: (text: string | null, options?: {
    center?: boolean
    repeat?: boolean | number
    orientation?: string
    attributes?: Record<string, string | number>
  }) => TextPathPolyline
}

function RoadNameLine({ road, showName, zoom }: { road: CampusRoad; showName: boolean; zoom: number }) {
  const lineRef = useRef<LeafletPolyline | null>(null)

  useEffect(() => {
    const line = lineRef.current as TextPathPolyline | null
    if (!line) return
    line.setText(showName ? road.name : null, {
      center: true,
      repeat: false,
      orientation: 'flip',
      attributes: {
        fill: '#111111',
        'font-size': '10px',
        'font-family': 'Arial, sans-serif',
        'font-weight': '700',
      },
    })
    return () => { line.setText(null) }
  }, [road.coordinates, road.name, showName, zoom])

  return <Polyline ref={lineRef} positions={road.coordinates.map(toLatLng)} pathOptions={{ color: 'transparent', opacity: 0, weight: 3 }} />
}

function CampusMapPreview({ data, selectedBuildingId, route, currentLocation, currentHeading, resetKey, onSelectBuilding, onMapControl }: CampusMapProps) {
  const [mapZoom, setMapZoom] = useState(0)
  const campusPoints = [
    ...data.buildings.map((building) => building.coordinate),
    ...data.boundary.flat(2),
  ]
  const campusBounds = campusPoints.map(toLatLng)
  return (
    <section className="map-panel" aria-label="FUTA campus map">
      <div className="map-toolbar">
        <div className="map-title"><MapPinned size={18} /><span>FUTA campus map</span><span className="map-tag">CAMPUS PLACES</span></div>
        <button className="map-control" type="button" onClick={onMapControl} aria-label="Show all campus buildings"><LocateFixed size={17} /></button>
      </div>

      <div className="map-art map-live">
        <MapContainer bounds={campusBounds} boundsOptions={{ padding: [28, 28] }} maxBounds={campusBounds} maxBoundsViscosity={1} scrollWheelZoom className="leaflet-map">
          <TileLayer
            attribution='Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxNativeZoom={19}
          />
          <FitCampusView data={data} route={route} resetKey={resetKey} />
          <TrackMapZoom onZoomChange={setMapZoom} />
          <CampusBoundaryView data={data} />

          {data.boundary.map((polygon, index) => (
            <Polygon
              key={`boundary-${index}`}
              positions={polygon.map((ring) => ring.map(toLatLng))}
              pathOptions={{ color: '#628b67', weight: 2, fillColor: '#a5c89d', fillOpacity: 0.1, dashArray: '6 5' }}
            />
          ))}

          {data.roads.map((road) => (
            <Polyline
              key={road.id}
              positions={road.coordinates.map(toLatLng)}
              pathOptions={road.walkable
                ? { color: '#c98b4c', weight: 3, opacity: 0.68 }
                : { color: '#a0a0a0', weight: 2, opacity: 0.45, dashArray: '4 6' }}
            >
            </Polyline>
          ))}

          {data.roads.filter((road) => road.hasName && !/walk\s*way|walkway/i.test(road.name)).map((road) => (
            <RoadNameLine key={`road-label-${road.id}`} road={road} showName={mapZoom >= 18} zoom={mapZoom} />
          ))}

          {route && <>
            <Polyline positions={route.roadCoordinates.map(toLatLng)} pathOptions={{ color: '#2077dd', weight: 6, opacity: 0.9 }} />
            {route.inferredJoins.map((join, index) => (
              <Polyline key={`inferred-join-${index}`} positions={join.map(toLatLng)} pathOptions={{ color: '#e45143', weight: 6, opacity: 1, dashArray: '4 7' }}>
                <Tooltip>Estimated path link · check that this way is open</Tooltip>
              </Polyline>
            ))}
            <Polyline positions={route.startConnector.map(toLatLng)} pathOptions={{ color: '#e18a3e', weight: 4, dashArray: '7 7' }} />
            <Polyline positions={route.endConnector.map(toLatLng)} pathOptions={{ color: '#e18a3e', weight: 4, dashArray: '7 7' }} />
            <CircleMarker center={toLatLng(route.coordinates[0])} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#2f874d', fillOpacity: 1 }}>
              <Tooltip direction="top" offset={[0, -8]} permanent>Start</Tooltip>
            </CircleMarker>
          </>}

          {currentLocation && (
            <>
              <CircleMarker center={toLatLng(currentLocation)} radius={13} pathOptions={{ color: '#2f874d', weight: 2, fillColor: '#4b9de8', fillOpacity: 0.28, interactive: false }} />
              <Marker position={toLatLng(currentLocation)} icon={createUserLocationIcon(currentHeading)} zIndexOffset={1200} interactive={false} keyboard={false} />
            </>
          )}

          {data.buildings.map((building) => {
            const selected = building.id === selectedBuildingId
            const isDestination = Boolean(route && route.coordinates.at(-1) === building.coordinate)
            const isGate = /\bgate\b/i.test(building.name)
            return (
              <Marker
                key={building.id}
                position={toLatLng(building.coordinate)}
                icon={isGate
                  ? selected || isDestination ? selectedGateIcon : regularGateIcon
                  : selected || isDestination ? selectedBuildingPin : regularBuildingPin}
                title={building.name}
                alt={building.name}
                riseOnHover
              >
                <Tooltip permanent={mapZoom >= 16} direction="right" offset={[isGate ? 11 : 5, 0]} className="building-name-label">{building.name}</Tooltip>
                <Popup>
                  <div className="building-popup">
                    {building.photo && <img className="building-popup-photo" src={getBuildingPhotoUrl(building.photo)} alt={building.name} loading="lazy" />}
                    <strong>{building.name}</strong>
                    <button type="button" onClick={() => onSelectBuilding(building.id)}>Set as destination</button>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
        <div className="map-stamp"><Compass size={14} /> YOUR WALK · FOLLOW CAMPUS SIGNS</div>
      </div>

      <div className="map-bottom-bar">
        <span className="map-legend">
          <svg className="legend-building" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" aria-hidden="true">
            <path d="M14 1.5C7.2 1.5 2 6.7 2 13.2c0 8.2 12 21.1 12 21.1s12-12.9 12-21.1C26 6.7 20.8 1.5 14 1.5Z" fill="#2f874d" stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
            <circle cx="14" cy="13" r="4.2" fill="white" />
            <circle cx="14" cy="13" r="1.8" fill="#2f874d" />
          </svg>
          Buildings
          <svg className="legend-gate" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 38 38" aria-hidden="true">
            <circle cx="19" cy="19" r="17" fill="white" stroke="#2f874d" strokeWidth="2.5" />
            <path d="M9 27V17a10 10 0 0 1 20 0v10M7 27h24M12 17v10m5-10v10m5-10v10m5-10v10" fill="none" stroke="#2f874d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 14h24" fill="none" stroke="#2f874d" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          Gates <i className="legend-road" /> Campus paths <i className="legend-route" /> Your route
        </span>
        {route ? <div className="route-metrics"><strong>About {route.durationMinutes} min</strong><span>About {(route.distanceMetres / 1000).toFixed(2)} km</span></div> : <div className="map-helper">Zoom in to see campus labels · select a pin or search</div>}
      </div>
    </section>
  )
}

export default CampusMapPreview
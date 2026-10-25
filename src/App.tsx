import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Building2,
  Check,
  Compass,
  Download,
  Flag,
  Footprints,
  LocateFixed,
  MapPin,
  Menu,
  Navigation,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import proj4 from 'proj4'
import { loadCampusData } from './gis/campusData'
import { calculateRoute } from './gis/routing'
import { buildRouteInstructions, type RouteInstruction } from './gis/directions'
import type { CampusBuilding, CampusData, CampusRoute, XY } from './gis/types'
import './App.css'

const CampusMapPreview = lazy(() => import('./components/CampusMapPreview'))

const quickPlaceTerms = ['FUTA South Gate', 'FUTA, Health Centre', 'Shuttle park']

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function countReachedRouteSteps(location: XY, accuracy: number, instructions: RouteInstruction[], completed = 0): number {
  const arrivalRadiusMetres = Math.max(20, Math.min(50, accuracy + 8))
  let next = completed
  while (next < instructions.length) {
    const target = instructions[next].target
    if (!target || Math.hypot(target[0] - location[0], target[1] - location[1]) <= arrivalRadiusMetres) {
      next += 1
      continue
    }
    break
  }
  return next
}

function formatRouteDistance(distanceMetres: number): string {
  return distanceMetres < 1000
    ? `About ${Math.round(distanceMetres)} m`
    : `About ${(distanceMetres / 1000).toFixed(2)} km`
}

function App() {
  const [campusData, setCampusData] = useState<CampusData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [destination, setDestination] = useState('')
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null)
  const [origin, setOrigin] = useState('My location')
  const [currentLocation, setCurrentLocation] = useState<XY | null>(null)
  const [currentAccuracy, setCurrentAccuracy] = useState(25)
  const [currentHeading, setCurrentHeading] = useState(0)
  const [route, setRoute] = useState<CampusRoute | null>(null)
  const [routeEndpoints, setRouteEndpoints] = useState<{ start: string; destination: string } | null>(null)
  const [completedRouteSteps, setCompletedRouteSteps] = useState(0)
  const [message, setMessage] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [mapFullscreen, setMapFullscreen] = useState(false)
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [mapResetKey, setMapResetKey] = useState(0)
  const locationWatchRef = useRef<number | null>(null)
  const previousLocationRef = useRef<XY | null>(null)
  const routeInstructionsRef = useRef<RouteInstruction[]>([])
  const completedRouteStepsRef = useRef(0)

  useEffect(() => () => {
    if (locationWatchRef.current !== null) navigator.geolocation?.clearWatch(locationWatchRef.current)
  }, [])

  useEffect(() => {
    if (!mapFullscreen) return
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMapFullscreen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mapFullscreen])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPromptEvent(event as BeforeInstallPromptEvent)
    }
    const handleAppInstalled = () => setInstallPromptEvent(null)

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    let active = true
    loadCampusData()
      .then((data) => { if (active) setCampusData(data) })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Campus GeoJSON could not be loaded.')
      })
    return () => { active = false }
  }, [])

  const matchingBuildings = useMemo(() => {
    const query = destination.trim().toLocaleLowerCase()
    if (!query || !campusData) return []
    return campusData.buildings
      .filter((building) => building.name.toLocaleLowerCase().includes(query))
      .slice(0, 6)
  }, [campusData, destination])

  const quickPlaces = useMemo(() => quickPlaceTerms
    .map((term) => campusData?.buildings.find((building) => building.name.toLocaleLowerCase() === term.toLocaleLowerCase()))
    .filter((building): building is CampusBuilding => Boolean(building)), [campusData])

  const routeInstructions: RouteInstruction[] = useMemo(() => {
    if (!route || !routeEndpoints) return []
    return buildRouteInstructions(route, routeEndpoints.start, routeEndpoints.destination, campusData?.roads ?? [])
  }, [campusData, route, routeEndpoints])

  function resetRouteProgress() {
    routeInstructionsRef.current = []
    completedRouteStepsRef.current = 0
    setCompletedRouteSteps(0)
  }

  function updateRouteProgress(location: XY, accuracy: number) {
    const next = countReachedRouteSteps(location, accuracy, routeInstructionsRef.current, completedRouteStepsRef.current)
    if (next > completedRouteStepsRef.current) {
      completedRouteStepsRef.current = next
      setCompletedRouteSteps(next)
    }
  }

  function getOriginPoint(): XY | null {
    if (currentLocation && origin === 'My location') return currentLocation
    const originBuilding = campusData?.buildings.find((building) => building.name.toLocaleLowerCase() === origin.trim().toLocaleLowerCase())
    return originBuilding?.coordinate ?? null
  }

  function isInsideCampusBoundary(point: XY): boolean {
    if (!campusData?.boundary.length) return false
    const insideRing = (ring: XY[]) => {
      let inside = false
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
        const [x, y] = ring[index]
        const [previousX, previousY] = ring[previous]
        const crosses = (y > point[1]) !== (previousY > point[1])
          && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x
        if (crosses) inside = !inside
      }
      return inside
    }

    return campusData.boundary.some((polygon) =>
      Boolean(polygon[0] && insideRing(polygon[0]) && !polygon.slice(1).some(insideRing)),
    )
  }

  function applyRoute(start: XY, building: CampusBuilding, startName = origin) {
    if (!campusData) return
    if (!campusData.roads.some((road) => road.walkable)) {
      setMessage('We could not find a walking route here yet. Try again later or ask someone nearby.')
      return
    }
    setDestination(building.name)
    setSelectedBuildingId(building.id)
    try {
      const nextRoute = calculateRoute(start, building, campusData.roads)
      const nextEndpoints = { start: startName, destination: building.name }
      const nextInstructions = buildRouteInstructions(nextRoute, nextEndpoints.start, nextEndpoints.destination, campusData.roads)
      routeInstructionsRef.current = nextInstructions
      const initialProgressLocation = startName === 'Your current location' ? start : currentLocation
      const completed = initialProgressLocation
        ? countReachedRouteSteps(initialProgressLocation, currentAccuracy, nextInstructions)
        : 0
      completedRouteStepsRef.current = completed
      setRoute(nextRoute)
      setRouteEndpoints(nextEndpoints)
      setCompletedRouteSteps(completed)
      setMessage('')
    } catch (error) {
      setRoute(null)
      setRouteEndpoints(null)
      resetRouteProgress()
      setMessage(error instanceof Error ? error.message : 'We could not find a route. Please try another starting place.')
    }
  }

  function requestCurrentLocation(setAsOrigin = true): Promise<XY> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This browser cannot share your location. Choose a starting place on campus instead.'))
        return
      }
      if (!campusData?.boundary.length) {
        reject(new Error('The campus map is still loading. Please try again in a moment.'))
        return
      }
      if (locationWatchRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchRef.current)
      }
      let firstPositionReceived = false
      const watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
          const projected = proj4('EPSG:4326', 'EPSG:3857', [coords.longitude, coords.latitude]) as XY
          if (!isInsideCampusBoundary(projected)) {
            setCurrentLocation(null)
            setCurrentAccuracy(25)
            setRoute(null)
            setRouteEndpoints(null)
            resetRouteProgress()
            setMessage('Your location looks like it is outside FUTA. Move onto campus or choose a starting place.')
            if (locationWatchRef.current !== null) navigator.geolocation?.clearWatch(locationWatchRef.current)
            locationWatchRef.current = null
            previousLocationRef.current = null
            if (!firstPositionReceived) reject(new Error('Your location looks like it is outside FUTA. Move onto campus or choose a starting place.'))
            return
          }
          const previous = previousLocationRef.current
          const computedHeading = typeof coords.heading === 'number' && Number.isFinite(coords.heading)
            ? coords.heading
            : previous
              ? (Math.atan2(projected[0] - previous[0], projected[1] - previous[1]) * 180 / Math.PI + 360) % 360
              : 0
          setCurrentLocation(projected)
          setCurrentAccuracy(Number.isFinite(coords.accuracy) ? coords.accuracy : 25)
          setCurrentHeading(computedHeading)
          updateRouteProgress(projected, Number.isFinite(coords.accuracy) ? coords.accuracy : 25)
          if (setAsOrigin) setOrigin('My location')
          previousLocationRef.current = projected
          if (!firstPositionReceived) {
            firstPositionReceived = true
            resolve(projected)
          }
        },
        () => {
          if (!firstPositionReceived) reject(new Error('We could not find your location. Allow location access or choose a starting place.'))
          else setMessage('We lost your location signal. Check your location settings and try again.')
        },
        { enableHighAccuracy: true, maximumAge: 2000 },
      )
      locationWatchRef.current = watchId
    })
  }

  function startRoute(building: CampusBuilding) {
    if (!campusData) return
    const start = getOriginPoint()
    if (start) {
      applyRoute(start, building, origin === 'My location' ? 'Your current location' : origin)
      return
    }
    if (origin === 'My location') {
      setMessage('Finding your location…')
      setRoute(null)
      setRouteEndpoints(null)
      resetRouteProgress()
      void requestCurrentLocation()
        .then((position) => applyRoute(position, building, 'Your current location'))
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'We could not find your location. Please try again.'))
      return
    }
    setMessage('Choose a starting place from the list, or use your current location while you are on campus.')
    setRoute(null)
    setRouteEndpoints(null)
    resetRouteProgress()
  }

  function selectOriginBuilding(building: CampusBuilding) {
    if (locationWatchRef.current !== null) navigator.geolocation?.clearWatch(locationWatchRef.current)
    locationWatchRef.current = null
    previousLocationRef.current = null
    setOrigin(building.name)
    setCurrentLocation(null)
    setCurrentAccuracy(25)
    setRoute(null)
    setRouteEndpoints(null)
    resetRouteProgress()
    setMessage(destination.trim() ? 'Starting place selected. Tap “Find my route” to continue.' : '')
  }

  function handleRouteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!campusData) {
      setMessage('Loading campus places… Please try again in a moment.')
      return
    }
    const requestedName = destination.trim().toLocaleLowerCase()
    const building = campusData.buildings.find((item) => item.name.toLocaleLowerCase() === requestedName)
    if (!building) {
      setMessage('Choose a building from the suggestions so we can find it for you.')
      return
    }
    startRoute(building)
  }

  function setCurrentPosition() {
    const trackingAnExistingRoute = Boolean(route)
    setMessage(trackingAnExistingRoute ? 'Finding your location to track your walk…' : 'Finding your location on campus…')
    void requestCurrentLocation(!trackingAnExistingRoute)
      .then(() => {
        if (trackingAnExistingRoute) {
          setMessage('Location tracking is on. Steps will check off as you reach them.')
          return
        }
        setMessage(destination.trim() ? 'Location found. Tap “Find my route” to continue.' : 'You are on campus. Search for your destination.')
        setRoute(null)
        setRouteEndpoints(null)
        resetRouteProgress()
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'We could not find your location. Please try again.'))
  }

  function changeOrigin(value: string) {
    if (locationWatchRef.current !== null) navigator.geolocation?.clearWatch(locationWatchRef.current)
    locationWatchRef.current = null
    previousLocationRef.current = null
    setOrigin(value)
    setCurrentLocation(null)
    setCurrentAccuracy(25)
    setRoute(null)
    setRouteEndpoints(null)
    resetRouteProgress()
    setMessage('')
  }

  async function installApp() {
    if (!installPromptEvent) return
    await installPromptEvent.prompt()
    await installPromptEvent.userChoice
    setInstallPromptEvent(null)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="FUTA NAV home">
          <span className="brand-mark"><Navigation size={21} strokeWidth={2.5} /></span>
          <span className="brand-copy"><strong>FUTA<span>NAV</span></strong><small>FIND YOUR WAY</small></span>
        </a>
        <nav className={`top-links ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          <a className="active" href="#explore" onClick={() => setMenuOpen(false)}>Explore</a>
          <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
          <a href="#about" onClick={() => setMenuOpen(false)}>About</a>
        </nav>
        {installPromptEvent && <button className="install-app-button" type="button" onClick={() => void installApp()}><Download size={15} /> Install app</button>}
        <button className="mobile-menu" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </header>

      <section className="workspace" id="explore">
        <aside className="sidebar">
          <div className="welcome-block">
            <span className="eyebrow"><Sparkles size={14} /> YOUR CAMPUS, MADE SIMPLE</span>
            <h1>Where to<br />next?</h1>
            <p>Find places on campus and get a walking route.</p>
          </div>

          <form className="route-card" onSubmit={handleRouteSubmit} onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.getAttribute('list') === 'futa-building-names') {
              event.preventDefault()
              const found = campusData?.buildings.find((building) => building.name.toLocaleLowerCase() === origin.trim().toLocaleLowerCase())
              if (found) selectOriginBuilding(found)
            }
          }}>
            <div className="field-stack">
              <label className="route-field">
                <span className="field-icon origin-icon"><span /></span>
                <span className="field-content">
                  <span className="field-label">STARTING FROM</span>
                  <input aria-label="Starting building" list="futa-building-names" value={origin} onChange={(event) => changeOrigin(event.target.value)} onBlur={() => {
                    const found = campusData?.buildings.find((building) => building.name.toLocaleLowerCase() === origin.trim().toLocaleLowerCase())
                    if (found) selectOriginBuilding(found)
                  }} />
                </span>
                <button className="locate-button" type="button" title="Use my location" aria-label="Use my location" onClick={setCurrentPosition}><LocateFixed size={17} /></button>
              </label>
              <div className="connector"><span /></div>
              <div className="destination-wrap">
                <label className="route-field destination-field">
                  <span className="field-icon destination-icon"><MapPin size={17} fill="currentColor" /></span>
                  <span className="field-content">
                    <span className="field-label">YOUR DESTINATION</span>
                    <input
                      aria-label="Search destination building"
                      aria-autocomplete="list"
                      aria-expanded={matchingBuildings.length > 0}
                      placeholder={campusData ? 'Search a building on campus' : 'Loading campus buildings…'}
                      value={destination}
                      onChange={(event) => {
                        setDestination(event.target.value)
                        setSelectedBuildingId(null)
                        setRoute(null)
                        setRouteEndpoints(null)
                        resetRouteProgress()
                        setMessage('')
                      }}
                    />
                  </span>
                  <Search className="destination-search" size={18} />
                </label>
                {matchingBuildings.length > 0 && !matchingBuildings.some((item) => item.name.toLocaleLowerCase() === destination.trim().toLocaleLowerCase()) && (
                  <div className="search-suggestions" role="listbox" aria-label="Matching campus buildings">
                    {matchingBuildings.map((building) => (
                      <button type="button" role="option" aria-selected="false" key={building.id} onClick={() => startRoute(building)}>
                        <Building2 size={15} /><span>{building.name}</span><ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <datalist id="futa-building-names">
              {campusData?.buildings.map((building) => <option key={building.id} value={building.name} />)}
            </datalist>

            <div className="route-preferences">
              <span className="walk-chip"><Footprints size={16} /> Walking</span>
            </div>
            <button className="route-button" type="submit" disabled={!campusData}>Find my route <ArrowRight size={18} /></button>
            {message && <p className="form-message" role="status">{message}</p>}
            {loadError && <p className="form-message error-message" role="alert">We could not load campus places. Check your connection and refresh the page.</p>}
            <div className="privacy-note"><ShieldCheck size={15} /> Your location stays on this device</div>
          </form>

          {route && routeEndpoints && (
            <section className="route-guide" aria-label="Route preview steps">
              <div className="route-guide-heading">
                <span className="route-guide-icon"><Footprints size={16} /></span>
                <div><strong>Your route</strong><small>{currentLocation ? `${Math.min(completedRouteSteps, routeInstructions.length)} of ${routeInstructions.length} steps complete` : 'A simple guide for your walk'}</small></div>
              </div>
              <div className="route-guide-endpoints">
                <div><span>START</span><strong>{routeEndpoints.start}</strong></div>
                <ArrowRight size={15} aria-hidden="true" />
                <div><span>DESTINATION</span><strong>{routeEndpoints.destination}</strong></div>
              </div>
              <div className="route-guide-stats"><strong>{formatRouteDistance(route.distanceMetres)}</strong><span>About {route.durationMinutes} min walking</span></div>
              <ol className="route-steps">
                {routeInstructions.map((step, index) => (
                  <li className={`route-step route-step-${step.kind}${index < completedRouteSteps ? ' is-complete' : ''}${index === completedRouteSteps ? ' is-current' : ''}`} key={step.id}>
                    <span className="route-step-marker">{index < completedRouteSteps ? <Check size={12} /> : step.kind === 'start' ? 'S' : step.kind === 'arrive' ? <Flag size={12} /> : index + 1}</span>
                    <div><strong>{step.title}</strong><p>{step.detail}</p></div>
                  </li>
                ))}
              </ol>
              {currentLocation
                ? <p className="route-tracking-status">Your steps update as you walk with location on.</p>
                : <button className="track-route-button" type="button" onClick={setCurrentPosition}><LocateFixed size={14} /> Turn on location to track your walk</button>}
              <div className="route-certainty-legend" aria-label="Route line legend">
                <span><i className="certainty-mapped" /> Campus path</span>
                <span><i className="certainty-connector" /> Estimated section</span>
                <span><i className="certainty-inferred" /> Estimated link</span>
              </div>
              <p className="route-guide-note">This route is a guide for your walk. Follow campus signs and check that paths are open.</p>
            </section>
          )}

          <div className="quick-section">
            <div className="section-heading"><span>QUICK DISCOVER</span><span className="soon-label">CAMPUS LOCATIONS</span></div>
            <div className="quick-list">
              {quickPlaces.map((building) => (
                <button className="quick-place" key={building.id} type="button" onClick={() => startRoute(building)}>
                  <span className="quick-icon"><Building2 size={17} /></span><span>{building.name}</span><ArrowRight size={15} className="quick-arrow" />
                </button>
              ))}
              {!campusData && !loadError && <span className="quick-loading">Loading campus locations…</span>}
            </div>
          </div>

          <div className="sidebar-footer"><span className="footer-compass"><Compass size={16} /></span><span>Made for the FUTA community</span><span className="footer-dot">✳</span></div>
        </aside>

        <div className="map-column">
          {campusData ? (
            <Suspense fallback={<section className="map-panel map-loading" aria-label="Loading map component"><div className="map-title"><Compass size={18} />Getting your campus map ready…</div></section>}>
                <CampusMapPreview
                data={campusData}
                selectedBuildingId={selectedBuildingId}
                route={route}
                  isFullscreen={mapFullscreen}
                  onToggleFullscreen={() => setMapFullscreen((fullscreen) => !fullscreen)}
                  currentLocation={currentLocation}
                  currentHeading={currentHeading}
                onSelectBuilding={(id) => {
                  const building = campusData.buildings.find((item) => item.id === id)
                  if (building) startRoute(building)
                }}
                onMapControl={() => {
                  setRoute(null)
                  setRouteEndpoints(null)
                  resetRouteProgress()
                  setMapResetKey((key) => key + 1)
                }}
                resetKey={mapResetKey}
              />
            </Suspense>
          ) : (
            <section className="map-panel map-loading" aria-label="Loading campus map">
              <div className="map-title"><Compass size={18} />{loadError ? 'Campus map unavailable' : 'Loading campus map…'}</div>
              <p>{loadError ? 'We could not load the campus map. Check your connection and refresh the page.' : 'Loading campus places and paths…'}</p>
            </section>
          )}
          {route && <p className="route-disclaimer" role="status">{route.warning}</p>}
        </div>
      </section>

      <section className="info-section how-section" id="how-it-works" aria-labelledby="how-heading">
        <div className="info-intro">
          <span className="eyebrow">A SIMPLE CAMPUS FLOW</span>
          <h2 id="how-heading">From “where?” to a route preview.</h2>
          <p>Look up a mapped place, check the suggested walk, and follow the map route to make your way around campus.</p>
        </div>
        <div className="how-steps">
          <article className="how-step">
            <span className="step-number">01</span>
            <span className="info-icon"><LocateFixed size={19} /></span>
            <h3>Set your starting point</h3>
            <p>Choose a mapped campus building, or use your device location when you are on campus. Location access is optional.</p>
          </article>
          <article className="how-step">
            <span className="step-number">02</span>
            <span className="info-icon"><Search size={19} /></span>
            <h3>Find a destination</h3>
            <p>Search for a building by name and select a match from the campus places in the map.</p>
          </article>
          <article className="how-step">
            <span className="step-number">03</span>
            <span className="info-icon"><Footprints size={19} /></span>
            <h3>Review before you walk</h3>
            <p>See the route preview and its walking steps. Check campus signs and local conditions along the way.</p>
          </article>
        </div>
        <p className="info-caution"><ShieldCheck size={16} /> Routes are previews based on currently available map data, not turn-by-turn directions. Paths may be incomplete or unavailable.</p>
        <a className="info-cta" href="#explore">Explore the campus map <ArrowRight size={16} /></a>
      </section>

      <section className="info-section about-section" id="about" aria-labelledby="about-heading">
        <div className="about-copy">
          <span className="eyebrow">ABOUT FUTA NAV</span>
          <h2 id="about-heading">A clearer way to explore campus.</h2>
          <p>FUTA NAV is a student-first campus guide for finding mapped places at the Federal University of Technology, Akure. It brings campus building information and route previews together in one place.</p>
          <p>We want getting oriented to feel simpler—whether you are looking for a familiar building or exploring somewhere new.</p>
        </div>
        <div className="about-points" aria-label="FUTA NAV principles">
          <article className="about-point">
            <span className="info-icon"><Compass size={19} /></span>
            <div><h3>Made for campus discovery</h3><p>Browse mapped campus buildings and choose a destination from the places available in the app.</p></div>
          </article>
          <article className="about-point">
            <span className="info-icon"><ShieldCheck size={19} /></span>
            <div><h3>Your location, your choice</h3><p>Location is only requested when you choose to use it; the app also lets you select a starting building.</p></div>
          </article>
          <article className="about-point">
            <span className="info-icon"><Footprints size={19} /></span>
            <div><h3>Honest about route limits</h3><p>Campus path data is not yet a complete connected pedestrian network, so route suggestions should be treated as previews.</p></div>
          </article>
        </div>
      </section>

      <footer className="page-footer"><span>FUTA NAV <span className="footer-separator">/</span> A student-first campus guide</span><span><span className="footer-spark">✳</span> Federal University of Technology, Akure</span></footer>
    </main>
  )
}

export default App
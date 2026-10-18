# FUTA NAV

A student-first campus wayfinding app for the Federal University of Technology, Akure. It loads the campus GeoJSON, displays locations on an OpenStreetMap/Leaflet base map, supports building search and selection, and draws clearly labelled route previews.

## Run locally

Install the project dependencies, then start the Vite development server:

```sh
npm install
npm run dev
```

Create a production build with `npm run build`, and check the project with `npm run lint`.

## Deploy to GitHub Pages

The GitHub Actions workflow in `.github/workflows/deploy.yml` builds the site and publishes its compiled files to the `gh-pages` branch whenever changes are pushed to `main`. In repository settings, open **Pages** and select **Deploy from a branch**, then set the branch to `gh-pages` and the folder to `/(root)`. The production build uses the `/futanav/` base path for this repository.

Commit and push project changes to `main` to trigger deployment. GitHub shows the published address and deployment status under **Actions** and **Settings → Pages**. The map uses online Esri imagery, so the basemap still requires an internet connection even though the PWA caches app files and campus data.

## Current prototype

- Responsive campus navigation layout with origin and destination fields.
- Search/autocomplete for the supplied named building points; map pins and quick-discover entries can be selected as destinations.
- Clicking a building or gate pin opens its associated GeoJSON photo when one is provided. Photos are served as resized WebP thumbnails; buildings without a `Photo` value show the name and destination action only.
- The starting point defaults to the user's current location. Location is requested only when routing is started or the locate control is pressed, then checked against the supplied FUTA boundary; users can choose a campus building instead.
- The updated road file is parsed into walkable line segments; route previews use a shortest-distance graph search with straight-line snaps between a building/location and nearby network segments.
- The route panel summarizes start, destination, estimated distance/time, mapped-line sections, geometry-derived bend prompts, and any approximate connectors or inferred gaps. These are explanatory previews, not reliable turn-by-turn directions.
- The map shows source road and campus boundary data, with OpenStreetMap attribution.

## Important routing limitation

The updated `Futa Road.geojson` contains **599 MultiLineString features**, expanded to 592 line parts and 3,297 segments. It includes pedestrian ways and roads with pedestrian access; explicit `foot=no`, private/no access, and motorway/trunk classes are excluded from route calculations. The graph builder nodes at-grade crossing lines and virtually joins a maximum of six nearby road endpoints (gap up to 35 m), while avoiding joins across different bridge/tunnel/layer levels. These inferred joins are not written back to the source GeoJSON; they are shown as dashed red route links and flagged for field checking. The graph currently retains 11 disconnected components. Some pairs, including the default South Gate to 3-in-1 Lecture Theatre Block 2, still have no continuous route. The solver computes shortest mapped distance, not fastest-route cost, and the data/access conditions are not ground-verified. Treat distance and walking time as estimates, not guaranteed navigation. Review inferred joins and add/repair path links and building entrances before real-world use.

The building file currently contains 27 points with `Name` and `Photo` properties; one point has no name. Buildings are in **Minna / UTM zone 31N (EPSG:26331)**, while road and boundary files are **WGS 84 / Pseudo-Mercator (EPSG:3857)**. The loader transforms building coordinates to EPSG:3857 before displaying them with Leaflet. Confirm the datum transformation and all new data extents/connectivity against ground truth before production use.

## Adding the campus GIS data

When additional building and pathway GeoJSON files are ready, place them in `public/data/` and update the typed GIS loader in `src/gis/campusData.ts`. Before integrating, check CRS, geometry types, feature properties, coordinate coverage, pedestrian access tags, and network connectivity. The current solver uses Dijkstra-style shortest distance across connected segments and attaches origins/destinations to their nearest segment. To claim fastest routes, add verified per-edge travel-time/surface/slope/steps costs and validate routes on the ground. Do not treat off-network snap connectors as walking paths.

Map rendering and routing are separated into `src/components/CampusMapPreview.tsx` and `src/gis/routing.ts`. Check data licensing and attribution requirements before publishing the map. OpenStreetMap standard tiles are used for this prototype; follow the tile provider's usage policy or select a suitable hosted tile provider for production.

## Tech

- React and TypeScript
- Vite
- Leaflet and React Leaflet
- proj4 for coordinate transformation
- Lucide icons

Campus GeoJSON is bundled under `public/data/`. The map uses online OpenStreetMap tiles; there is no external routing service.
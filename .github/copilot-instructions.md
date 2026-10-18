# FUTA NAV workspace guidance

- This is a React + TypeScript + Vite application for campus wayfinding at the Federal University of Technology, Akure.
- Keep the experience student-friendly, accessible, mobile-responsive, and visually consistent with the warm green-and-cream theme.
- Do not invent campus coordinates, map features, search results, route lengths, or travel times. Current building GeoJSON is displayed, but the road data is one MultiString, label routes as previews and do not present them as reliable directions or fastest routes.
- When adding GIS data, inspect its CRS, geometries, feature properties, extents, and network connectivity first. Preserve attribution and licensing requirements.
- Keep map rendering and routing in separable components/modules so campus data and a pedestrian network can be connected without coupling them to the navigation UI.
- Prefer TypeScript types for GeoJSON properties and route state, and retain accessible labels, keyboard focus, and responsive behavior.
- Verify changes with `npm run build` and `npm run lint` when dependencies are installed.
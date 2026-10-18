import 'leaflet'

declare module 'leaflet' {
  interface Polyline {
    setText(text: string | null, options?: {
      center?: boolean
      repeat?: boolean | number
      orientation?: string
      attributes?: Record<string, string | number>
    }): this
  }
}

declare module 'leaflet-textpath'

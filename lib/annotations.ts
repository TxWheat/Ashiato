/** Shapes and text an investigator draws on the graph; saved with the case */
export interface Annotation {
  id: string
  kind: 'rect' | 'circle' | 'arrow' | 'text'
  /** Flow coordinates of the top-left corner, and size */
  x: number
  y: number
  w: number
  h: number
  text?: string
  /** Degrees (arrows point right at 0) */
  rotate?: number
}

export const ANNOTATION_SIZE: Record<Annotation['kind'], { w: number; h: number }> = {
  rect: { w: 320, h: 200 },
  circle: { w: 220, h: 220 },
  arrow: { w: 200, h: 40 },
  text: { w: 260, h: 70 },
}

/** Graph node ids for annotations are prefixed so they never collide with addresses */
export const NOTE_PREFIX = 'note:'

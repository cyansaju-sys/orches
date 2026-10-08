/** Dónde abrir la ventana: centrada en la pantalla donde está el cursor, sin pasarse del área útil. */
export interface Area { x: number; y: number; width: number; height: number }

export function placeOnDisplay(work: Area, width: number, height: number): Area {
  const w = Math.min(width, work.width)
  const h = Math.min(height, work.height)
  return { x: Math.round(work.x + (work.width - w) / 2), y: Math.round(work.y + (work.height - h) / 2), width: w, height: h }
}

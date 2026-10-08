import { describe, expect, it } from 'vitest'
import { placeOnDisplay } from './placement'

describe('colocar la ventana', () => {
  it('se centra en la pantalla indicada, aunque no empiece en 0,0', () => {
    expect(placeOnDisplay({ x: 1920, y: 0, width: 1920, height: 1040 }, 1360, 860)).toEqual({ x: 2200, y: 90, width: 1360, height: 860 })
  })
  it('si la pantalla es más pequeña, la ventana se ajusta', () => {
    expect(placeOnDisplay({ x: 0, y: 0, width: 1280, height: 720 }, 1360, 860)).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
  })
})

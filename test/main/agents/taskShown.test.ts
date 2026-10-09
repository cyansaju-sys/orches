import { describe, expect, it } from 'vitest'
import { taskShown } from '../../../src/main/agents/launch'

describe('taskShown', () => {
  const task = 'Renombra la función getUser a fetchUser en src/api y actualiza los tests'
  it('reconoce la tarea aunque la pantalla la parta en líneas y bordes', () => {
    expect(taskShown('│ > Renombra la función getUser a\n│   fetchUser en src/api y actualiza', task)).toBe(true)
  })
  it('no la encuentra si el agente arrancó sin ella', () => {
    expect(taskShown('Welcome to agy\n> ', task)).toBe(false)
  })
})

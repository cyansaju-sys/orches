import { useState } from 'react'
import { readFile } from 'node:fs/promises'

interface Props {
  inicial?: number
}

/** Botón que cuenta clics. */
export function Contador({ inicial = 0 }: Props) {
  const [total, setTotal] = useState<number>(inicial)

  const sumar = () => setTotal(total + 1)

  return (
    <button className="contador" onClick={sumar}>
      Clics: {total}
    </button>
  )
}

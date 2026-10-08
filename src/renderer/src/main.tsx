import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { useStore } from './store'

;(window as unknown as { __orches: typeof useStore }).__orches = useStore      // para el modo captura y la depuración

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

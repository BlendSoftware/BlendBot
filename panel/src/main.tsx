import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { aplicarTema, temaGuardado } from './dominio/tema'
import './estilos/base.css'
import './estilos/componentes.css'
import './estilos/vistas.css'

// Antes del primer render: si no, la primera pintada sale clara y el tema
// oscuro entra como un parpadeo.
aplicarTema(temaGuardado())

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('Falta el nodo raiz en index.html')

createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

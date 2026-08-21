import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './estilos/base.css'
import './estilos/componentes.css'
import './estilos/vistas.css'

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('Falta el nodo raiz en index.html')

createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

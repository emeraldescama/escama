# Escama Esmeralda · Emerald City

App para gestionar los miembros, pagos y gastos de la suscripción **Escama Esmeralda**.

- `index.html`: la aplicación completa.
- `api/data.js`: guarda los datos en la nube para que se vean iguales en todos los dispositivos.

## Configuración en Vercel (una sola vez)

1. **Base de datos**: en tu proyecto de Vercel → pestaña **Storage** → **Create Database** →
   **Upstash for Redis** (plan gratis) → conéctala a este proyecto.
   Vercel crea solo las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN`.
2. **PIN de administrador**: **Settings → Environment Variables** → agrega
   `ADMIN_PIN` con el PIN que quieras (por ejemplo `4821`).
3. **Redeploy**: **Deployments** → menú `⋯` del último → **Redeploy**.

## Uso

- Cualquiera con el enlace **ve** los datos (modo solo lectura 🔒).
- Para **editar**, toca el indicador ☁️ de arriba e ingresa el PIN. Los cambios se guardan
  en la nube y aparecen en los demás equipos en unos 20 segundos.
- Si dos personas editan a la vez, la app combina los cambios de ambas.
- La nube guarda las últimas 30 versiones como respaldo (`escama:history` en Redis).

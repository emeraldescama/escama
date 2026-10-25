// Tasa oficial BCV (USD) consultada desde el servidor, sin intermediarios.
// GET /api/tasa -> { tasa, fecha, fechaTxt, fuente, consultada }
// Se guarda 1 hora en Redis (si está configurado) para no consultar al BCV en cada visita.
const CACHE_KEY = 'escama:tasa';
const CACHE_SECONDS = 3600;

function storage() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
async function redis(s, command) {
  const r = await fetch(s.url, { method: 'POST', headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `redis ${r.status}`);
  return j.result;
}

// Lectura directa de bcv.org.ve con verificación TLS normal. Si el BCV publica su certificado
// incompleto (le pasa con frecuencia), esta consulta falla y se usa DolarApi como respaldo.
async function getBcvHtml(timeoutMs = 12000) {
  const r = await fetch('https://www.bcv.org.ve/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (EscamaEsmeralda)', 'Accept-Language': 'es-VE,es;q=0.9' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error('BCV HTTP ' + r.status);
  return r.text();
}

const num = t => { t = String(t || '').replace(/\s/g, ''); if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); return parseFloat(t); };

export function parseBcv(html) {
  const m = html.match(/id=["']dolar["'][\s\S]*?<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/i);
  const tasa = num(m && m[1]);
  if (!(tasa > 0)) throw new Error('no se encontró la tasa USD en bcv.org.ve');
  const f = html.match(/class=["'][^"']*date-display-single[^"']*["'][^>]*content=["'](\d{4}-\d{2}-\d{2})[^"']*["'][^>]*>([^<]*)</i);
  const f2 = html.match(/Fecha\s+Valor:\s*(?:<[^>]+>\s*)*([^<]+)/i);
  return { tasa, fecha: f ? f[1] : '', fechaTxt: ((f && f[2]) || (f2 && f2[1]) || '').replace(/\s+/g, ' ').trim(), fuente: 'bcv.org.ve' };
}

async function fromDolarApi() {
  const r = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('DolarApi HTTP ' + r.status);
  const j = await r.json(); const t = Number(j.promedio || j.venta);
  if (!(t > 0)) throw new Error('DolarApi sin tasa');
  return { tasa: t, fecha: String(j.fechaActualizacion || '').slice(0, 10), fechaTxt: '', fuente: 'DolarApi (oficial BCV)' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const s = storage(); const force = req.query.force !== undefined;
  try {
    if (s && !force) {
      const cached = await redis(s, ['GET', CACHE_KEY]).catch(() => null);
      if (cached) return res.status(200).json({ ...JSON.parse(cached), cache: true });
    }
  } catch {}
  const errores = [];
  for (const fuente of [async () => parseBcv(await getBcvHtml()), fromDolarApi]) {
    try {
      const out = { ...(await fuente()), consultada: new Date().toISOString() };
      if (s) await redis(s, ['SET', CACHE_KEY, JSON.stringify(out), 'EX', String(CACHE_SECONDS)]).catch(() => {});
      return res.status(200).json(out);
    } catch (e) { errores.push(String(e.message || e)); }
  }
  return res.status(502).json({ error: 'tasa_no_disponible', detalle: errores });
}

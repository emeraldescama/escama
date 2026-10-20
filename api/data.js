// API de datos compartidos de Escama Esmeralda (Vercel Serverless Function)
// GET  /api/data            -> con PIN: { data, version, updatedAt }
//                               sin PIN: versión pública (miembros y estado; sin pagos,
//                               montos, gastos ni teléfonos) con restricted: true
// GET  /api/data?meta=1     -> { version, updatedAt }          (público, liviano)
// GET  /api/data?auth=1     -> 200 si el PIN (header x-admin-pin) es correcto
// PUT  /api/data            -> guarda { data, baseVersion } (requiere x-admin-pin)
// Almacenamiento: Upstash Redis (integración de Vercel Marketplace).

const KEY = 'escama:data';
const HISTORY = 'escama:history'; // últimas 30 versiones, por si hay que restaurar

function storage() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redis(s, command) {
  const r = await fetch(s.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `redis ${r.status}`);
  return j.result;
}

// Respaldo por si la versión guardada aún no trae la vista pública
function stripPublic(data) {
  if (!data) return null;
  return {
    version: data.version || 1,
    settings: {},
    members: (data.members || []).map(m => ({ id: m.id, nombre: m.nombre, alias: m.alias || '', inicio: m.inicio, activo: m.activo !== false })),
    payments: [], expenses: [],
  };
}

function pinOk(req) {
  const pin = process.env.ADMIN_PIN;
  return !!pin && String(req.headers['x-admin-pin'] || '') === String(pin);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const s = storage();
  if (!s) return res.status(503).json({ error: 'storage_not_configured' });

  try {
    if (req.method === 'GET') {
      if (req.query.auth !== undefined) {
        if (!process.env.ADMIN_PIN) return res.status(503).json({ error: 'pin_not_configured' });
        return pinOk(req) ? res.status(200).json({ ok: true }) : res.status(401).json({ error: 'pin' });
      }
      const raw = await redis(s, ['GET', KEY]);
      const doc = raw ? JSON.parse(raw) : { data: null, version: 0, updatedAt: null };
      if (req.query.meta !== undefined) return res.status(200).json({ version: doc.version, updatedAt: doc.updatedAt });
      if (pinOk(req)) return res.status(200).json({ data: doc.data, version: doc.version, updatedAt: doc.updatedAt });
      return res.status(200).json({
        data: doc.data ? (doc.public || stripPublic(doc.data)) : null,
        version: doc.version, updatedAt: doc.updatedAt, restricted: true,
        pinInvalid: !!req.headers['x-admin-pin'],
      });
    }

    if (req.method === 'PUT') {
      if (!process.env.ADMIN_PIN) return res.status(503).json({ error: 'pin_not_configured' });
      if (!pinOk(req)) return res.status(401).json({ error: 'pin' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body.data !== 'object' || !Array.isArray(body.data?.members)) {
        return res.status(400).json({ error: 'invalid_data' });
      }
      const raw = await redis(s, ['GET', KEY]);
      const cur = raw ? JSON.parse(raw) : { data: null, version: 0, updatedAt: null };
      if (Number(body.baseVersion) !== Number(cur.version || 0)) {
        return res.status(409).json({ error: 'conflict', data: cur.data, version: cur.version, updatedAt: cur.updatedAt });
      }
      const doc = {
        data: body.data,
        public: body.public && Array.isArray(body.public.members) ? body.public : stripPublic(body.data),
        version: (cur.version || 0) + 1,
        updatedAt: new Date().toISOString(),
        device: String(body.device || '').slice(0, 60),
      };
      await redis(s, ['SET', KEY, JSON.stringify(doc)]);
      if (raw) {
        await redis(s, ['LPUSH', HISTORY, raw]);
        await redis(s, ['LTRIM', HISTORY, '0', '29']);
      }
      return res.status(200).json({ version: doc.version, updatedAt: doc.updatedAt });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

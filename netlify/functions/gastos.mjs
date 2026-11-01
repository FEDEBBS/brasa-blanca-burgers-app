import { getStore } from '@netlify/blobs';

// Gastos del día. Reconstruido 2026-07-28 a partir del contrato del frontend en vivo:
//  GET    /api/gastos?date=YYYY-MM-DD           -> { gastos:[{id,concepto,proveedor,ticket,monto,foto:boolean,ts}] }
//  GET    /api/gastos?date=...&id=...&foto=1    -> { foto: dataURL|null }
//  POST   {date,concepto,proveedor,ticket,monto,foto:dataURL|null} -> { gasto }
//  DELETE /api/gastos?date=...&id=...           -> { ok:true }
// La foto se guarda aparte (clave gastofoto:fecha:id) para no inflar la lista.

const store = () => getStore('carrito');
const PUNTOS = ['av', 'cf'];
const gkey = (p, d) => `gastos:${p}:${d}`;
const fkey = (p, d, id) => `gastofoto:${p}:${d}:${id}`;
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

export default async (req) => {
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const date = url.searchParams.get('date');
      const punto = url.searchParams.get('punto');
      if (!date) return json({ error: 'Falta la fecha' }, 400);
      if (!PUNTOS.includes(punto)) return json({ error: 'Falta el punto de control' }, 400);
      const id = url.searchParams.get('id');
      if (id && url.searchParams.get('foto')) {
        const foto = await store().get(fkey(punto, date, id));
        return json({ foto: foto || null });
      }
      const gastos = (await store().get(gkey(punto, date), { type: 'json' })) || [];
      return json({ gastos });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { date, concepto, monto, punto } = body;
      if (!PUNTOS.includes(punto)) return json({ error: 'Falta el punto de control' }, 400);
      if (!date || !concepto) return json({ error: 'Falta qué compraste' }, 400);
      const m = parseFloat(monto);
      if (!m || m <= 0) return json({ error: 'Falta el monto' }, 400);

      const gasto = {
        id: crypto.randomUUID(),
        concepto: String(concepto).trim().slice(0, 80),
        proveedor: String(body.proveedor || '').trim().slice(0, 60),
        ticket: String(body.ticket || '').trim().slice(0, 40),
        monto: m,
        foto: !!body.foto,
        ts: Date.now(),
      };
      if (body.foto) {
        if (typeof body.foto !== 'string' || !body.foto.startsWith('data:image/'))
          return json({ error: 'Foto inválida' }, 400);
        await store().set(fkey(punto, date, gasto.id), body.foto);
      }
      const gastos = (await store().get(gkey(punto, date), { type: 'json' })) || [];
      gastos.push(gasto);
      await store().setJSON(gkey(punto, date), gastos);
      return json({ gasto });
    }

    if (req.method === 'DELETE') {
      const date = url.searchParams.get('date');
      const id = url.searchParams.get('id');
      const punto = url.searchParams.get('punto');
      if (!date || !id) return json({ error: 'Falta fecha o id' }, 400);
      if (!PUNTOS.includes(punto)) return json({ error: 'Falta el punto de control' }, 400);
      let gastos = (await store().get(gkey(punto, date), { type: 'json' })) || [];
      gastos = gastos.filter((g) => g.id !== id);
      await store().setJSON(gkey(punto, date), gastos);
      try { await store().delete(fkey(punto, date, id)); } catch (_) {}
      return json({ ok: true });
    }

    return json({ error: 'Método no permitido' }, 405);
  } catch (e) {
    return json({ error: 'Error del servidor: ' + e.message }, 500);
  }
};

export const config = { path: '/api/gastos' };

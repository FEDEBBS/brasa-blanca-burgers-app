import { getStore } from '@netlify/blobs';

// Traspasos entre almacenes de los puntos de control (av = Anima Village, cf = El Cuarto Frío).
// Los autoriza Fede: crear un traspaso exige la contraseña de gerente (header x-gerente).
// Dos movimientos ligados: sale del origen al enviarse; entra al destino solo al confirmar recepción.
//  GET    /api/traspasos?date=YYYY-MM-DD                        -> { traspasos:[...] }
//  POST   {action:'crear', date, origen, destino, items:{id:cant}}  (x-gerente)  -> { traspaso }
//  POST   {action:'recibir', date, id, destino}                  -> { traspaso }

const PUNTOS = ['av', 'cf'];
// Insumos que pueden trasladarse (ids de protein.mjs). Carnes en kg, el resto en unidad base.
const TRASLADABLES = {
  carne_master: 'kg', carne_jr: 'kg',
  pan_brioche: 'pz', queso_americano: 'pz', lechuga_romana: 'g', papas_porcion: 'pz',
  tapioca_pz: 'pz', brownie_pz: 'pz', helado_bola: 'pz', refresco_bot: 'pz', refresco_sabor: 'pz',
};

const store = () => getStore('carrito');
const tkey = (d) => `traspasos:${d}`;
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

function validItems(items) {
  const out = {};
  for (const [id, v] of Object.entries(items || {})) {
    if (!(id in TRASLADABLES)) return { error: `Insumo no trasladable: ${id}` };
    const n = parseFloat(v);
    if (!(n > 0)) return { error: `Cantidad inválida para ${id}` };
    out[id] = Math.round(n * 1000) / 1000;
  }
  if (!Object.keys(out).length) return { error: 'El traspaso no tiene insumos' };
  return { items: out };
}

export default async (req) => {
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const date = url.searchParams.get('date');
      if (!date) return json({ error: 'Falta la fecha' }, 400);
      const traspasos = (await store().get(tkey(date), { type: 'json' })) || [];
      return json({ traspasos });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { date, action } = body;
      if (!date || !action) return json({ error: 'Datos incompletos' }, 400);
      const lista = (await store().get(tkey(date), { type: 'json' })) || [];

      if (action === 'crear') {
        const expected = process.env.MANAGER_PASSWORD || '';
        if (!expected) return json({ error: 'Falta configurar MANAGER_PASSWORD en Netlify' }, 500);
        if ((req.headers.get('x-gerente') || '') !== expected)
          return json({ error: 'Solo Fede autoriza traspasos: contraseña incorrecta' }, 401);
        if (!PUNTOS.includes(body.origen) || !PUNTOS.includes(body.destino))
          return json({ error: 'Falta origen o destino' }, 400);
        if (body.origen === body.destino) return json({ error: 'Origen y destino deben ser distintos' }, 400);
        const v = validItems(body.items);
        if (v.error) return json({ error: v.error }, 400);
        const traspaso = {
          id: crypto.randomUUID(),
          origen: body.origen,
          destino: body.destino,
          items: v.items,
          estado: 'enviado',
          autorizo: 'Fede',
          ts: Date.now(),
          recibidoTs: null,
        };
        lista.push(traspaso);
        await store().setJSON(tkey(date), lista);
        return json({ traspaso });
      }

      if (action === 'recibir') {
        const t = lista.find((x) => x.id === body.id);
        if (!t) return json({ error: 'No encontré ese traspaso' }, 404);
        if (t.destino !== body.destino) return json({ error: 'Solo el punto destino puede confirmar la recepción' }, 403);
        if (t.estado !== 'enviado') return json({ error: 'El traspaso ya fue recibido' }, 400);
        t.estado = 'recibido';
        t.recibidoTs = Date.now();
        await store().setJSON(tkey(date), lista);
        return json({ traspaso: t });
      }

      return json({ error: 'Acción desconocida' }, 400);
    }

    return json({ error: 'Método no permitido' }, 405);
  } catch (e) {
    return json({ error: 'Error del servidor: ' + e.message }, 500);
  }
};

export const config = { path: '/api/traspasos' };

import { getStore } from '@netlify/blobs';

// Inventario por almacén (punto de control: av = Anima Village, cf = El Cuarto Frío).
// Existencia teórica = apertura + recibido + traspasos netos − consumo teórico − mermas.
// Diferencia = conteo final − teórico. Pedir = mínimo − conteo final (si hay mínimo).
// Consumo teórico: mismas fichas que protein.mjs (solo ventas cerradas).
// Acceso de gerente con x-gerente. Insumos sin ficha confirmada no tienen consumo teórico.

const PUNTOS = ['av', 'cf'];
// unidad: kg | g | pz. tipo 'carne': gramos crudos × unidades / 1000. per: piezas o gramos por platillo.
const ITEMS = [
  { id: 'carne_master',    label: 'Carne Master / Ice',  unidad: 'kg', tipo: 'carne', g: 200, dishes: ['master', 'ice'] },
  { id: 'carne_jr',        label: 'Carne Junior',        unidad: 'kg', tipo: 'carne', g: 150, dishes: ['jr'] },
  { id: 'pan_brioche',     label: 'Pan brioche',         unidad: 'pz', per: { master: 1, jr: 1 } },
  { id: 'queso_americano', label: 'Queso americano',     unidad: 'pz', per: { master: 2, jr: 2, ice: 2 } },
  { id: 'lechuga_romana',  label: 'Lechuga romana',      unidad: 'g',  per: { ice: 150 } },
  { id: 'papas_porcion',   label: 'Papas (porción)',     unidad: 'pz', per: { papas: 1 } },
  { id: 'tapioca_pz',      label: 'Tapioca 300 g',       unidad: 'pz', per: { tapioca: 1 } },
  { id: 'brownie_pz',      label: 'Brownie 300 g',       unidad: 'pz', per: { brownie: 1 } },
  { id: 'helado_bola',     label: 'Helado (bola)',       unidad: 'pz', per: { brownie: 1 } },
  { id: 'refresco_bot',    label: 'Refresco (pieza)',    unidad: 'pz', per: { refresco: 1 } },
  { id: 'refresco_sabor',  label: 'Refresco de sabor',   unidad: 'pz', per: { mocktail: 1 } },
  { id: 'espumoso_manzana',label: 'Espumoso de manzana', unidad: 'pz', per: null },            // [POR CONFIRMAR] consumo
  { id: 'mermelada_tocino',label: 'Mermelada de tocino', unidad: 'kg', per: null },            // [POR CONFIRMAR] receta
  { id: 'aderezo_secreto', label: 'Aderezo secreto',     unidad: 'kg', per: null },            // [POR CONFIRMAR] receta
];

const store = () => getStore('carrito');
const ikey = (p, d) => `inventario:${p}:${d}`;
const mkey = (p) => `minimos:${p}`;
const vkey = (p, d) => `ventas:${p}:${d}`;
const tkey = (d) => `traspasos:${d}`;
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const num = (v) => { const n = parseFloat(v); return isNaN(n) || n < 0 ? 0 : n; };
const r3 = (n) => Math.round(n * 1000) / 1000;

function consumoTeorico(item, q) {
  if (!item.per && !item.tipo) return null;
  if (item.tipo === 'carne') {
    const units = item.dishes.reduce((a, d) => a + (q[d] || 0), 0);
    return r3((item.g * units) / 1000);
  }
  return Object.entries(item.per).reduce((a, [d, n]) => a + n * (q[d] || 0), 0);
}

function vendidos(sales) {
  const q = {};
  for (const s of sales) {
    if (s.estado && s.estado !== 'cerrada') continue;
    for (const [id, n] of Object.entries(s.items || {})) q[id] = (q[id] || 0) + (n || 0);
  }
  return q;
}

function trasladoNeto(traspasos, punto, id) {
  let neto = 0;
  for (const t of traspasos) {
    const c = num(t.items?.[id]);
    if (!c) continue;
    if (t.origen === punto && (t.estado === 'enviado' || t.estado === 'recibido')) neto -= c;
    if (t.destino === punto && t.estado === 'recibido') neto += c;
  }
  return neto;
}

async function calcular(punto, date) {
  const cap = (await store().get(ikey(punto, date), { type: 'json' })) || { apertura: {}, recibido: {}, mermas: {}, conteoFinal: {} };
  const minimos = (await store().get(mkey(punto), { type: 'json' })) || {};
  const sales = (await store().get(vkey(punto, date), { type: 'json' })) || [];
  const traspasos = (await store().get(tkey(date), { type: 'json' })) || [];
  const q = vendidos(sales);

  const stock = ITEMS.map((it) => {
    const apertura = num(cap.apertura?.[it.id]);
    const recibido = num(cap.recibido?.[it.id]);
    const mermas = num(cap.mermas?.[it.id]);
    const conteo = cap.conteoFinal?.[it.id] === undefined || cap.conteoFinal?.[it.id] === '' ? null : num(cap.conteoFinal[it.id]);
    const traslado = trasladoNeto(traspasos, punto, it.id);
    const consumo = consumoTeorico(it, q);
    const teorico = consumo === null ? null : r3(apertura + recibido + traslado - consumo - mermas);
    const diferencia = (teorico === null || conteo === null) ? null : r3(conteo - teorico);
    const minimo = minimos[it.id] === undefined || minimos[it.id] === '' ? null : num(minimos[it.id]);
    const pedir = (minimo === null || conteo === null) ? null : Math.max(0, r3(minimo - conteo));
    return {
      id: it.id, label: it.label, unidad: it.unidad,
      apertura, recibido, traslado: r3(traslado), consumo: consumo === null ? null : r3(consumo), mermas,
      teorico, conteoFinal: conteo, diferencia, minimo, pedir,
    };
  });
  return { stock, capturado: !!(await store().get(ikey(punto, date), { type: 'json' })) };
}

export default async (req) => {
  const expected = process.env.MANAGER_PASSWORD || '';
  if (!expected) return json({ error: 'Falta configurar MANAGER_PASSWORD en Netlify' }, 500);
  if ((req.headers.get('x-gerente') || '') !== expected) return json({ error: 'Contraseña de gerente incorrecta' }, 401);

  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const date = url.searchParams.get('date');
      const punto = url.searchParams.get('punto');
      if (!date) return json({ error: 'Falta la fecha' }, 400);
      if (!PUNTOS.includes(punto)) return json({ error: 'Falta el punto de control' }, 400);
      return json(await calcular(punto, date));
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { punto, action } = body;
      if (!PUNTOS.includes(punto)) return json({ error: 'Falta el punto de control' }, 400);

      if (action === 'capturar') {
        const { date } = body;
        if (!date) return json({ error: 'Falta la fecha' }, 400);
        const limpio = (obj) => Object.fromEntries(ITEMS.filter((it) => obj && obj[it.id] !== undefined && obj[it.id] !== '')
          .map((it) => [it.id, num(obj[it.id])]));
        const cap = {
          apertura: limpio(body.apertura),
          recibido: limpio(body.recibido),
          mermas: limpio(body.mermas),
          conteoFinal: limpio(body.conteoFinal),
          ts: Date.now(),
        };
        await store().setJSON(ikey(punto, date), cap);
        return json(await calcular(punto, date));
      }

      if (action === 'minimos') {
        const limpio = Object.fromEntries(ITEMS.filter((it) => body.minimos && body.minimos[it.id] !== undefined && body.minimos[it.id] !== '')
          .map((it) => [it.id, num(body.minimos[it.id])]));
        await store().setJSON(mkey(punto), limpio);
        return json({ minimos: limpio });
      }

      return json({ error: 'Acción desconocida' }, 400);
    }

    return json({ error: 'Método no permitido' }, 405);
  } catch (e) {
    return json({ error: 'Error del servidor: ' + e.message }, 500);
  }
};

export const config = { path: '/api/inventario' };

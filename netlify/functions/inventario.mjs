import { getStore } from '@netlify/blobs';

// Inventario por punto (av = Anima Village, cf = El Cuarto Frío).
// Todo en piezas (carne = hamburguesas crudas). Lechuga en gramos (150 g por Ice).
// Existencia teórica = apertura + recibido + traspasos netos − consumo teórico − mermas.
// Pedido = mínimo − conteo final (nunca menos de 0).
// Encargado: GET ?view=pedido y POST action 'conteo' sin contraseña (solo cantidades).
// Gerente: GET completo, 'capturar' y 'minimos' con x-gerente.

const PUNTOS = ['av', 'cf'];
const ITEMS = [
  { id: 'carne_master',    label: 'Hamburguesa Master/Ice (pz crudas)', unidad: 'pz', per: { master: 2, ice: 2 } },
  { id: 'carne_jr',        label: 'Hamburguesa Junior (pz crudas)',     unidad: 'pz', per: { jr: 2 } },
  { id: 'pan_grande',      label: 'Pan grande (Master)',                unidad: 'pz', per: { master: 1 } },
  { id: 'pan_chico',       label: 'Pan chico (Junior)',                 unidad: 'pz', per: { jr: 1 } },
  { id: 'queso_americano', label: 'Queso americano (rebanadas)',        unidad: 'pz', per: { master: 2, jr: 2, ice: 2 } },
  { id: 'lechuga_romana',  label: 'Lechuga romana (g)',                 unidad: 'g',  per: { ice: 150 } },
  { id: 'papas_porcion',   label: 'Papas (porción)',                    unidad: 'pz', per: { papas: 1 } },
  { id: 'tapioca_pz',      label: 'Tapioca 300 g',                      unidad: 'pz', per: { tapioca: 1 } },
  { id: 'brownie_pz',      label: 'Brownie 300 g',                      unidad: 'pz', per: { brownie: 1 } },
  { id: 'helado_bola',     label: 'Helado (bola)',                      unidad: 'pz', per: { brownie: 1 } },
  { id: 'refresco_bot',    label: 'Refresco',                           unidad: 'pz', per: { refresco: 1 } },
  { id: 'refresco_sabor',  label: 'Refresco de sabor (lata)',           unidad: 'pz', per: { mocktail: 1 } },
  { id: 'espumoso_manzana',label: 'Espumoso de manzana',                unidad: 'pz', per: null },   // [POR CONFIRMAR] consumo
  { id: 'mermelada_tocino',label: 'Mermelada de tocino',                unidad: 'pz', per: null },   // [POR CONFIRMAR] receta
  { id: 'aderezo_secreto', label: 'Aderezo secreto',                    unidad: 'pz', per: null },   // [POR CONFIRMAR] receta
  // Desechables y salsas sin receta: se cuentan y piden, sin consumo teórico
  { id: 'papel_logo',      label: 'Papel con logo',                     unidad: 'pz', per: null },
  { id: 'servilletas',     label: 'Servilletas',                        unidad: 'pz', per: null },
  { id: 'catsup',          label: 'Catsup',                             unidad: 'pz', per: null },
  { id: 'mayonesa',        label: 'Mayonesa',                           unidad: 'pz', per: null },
  { id: 'mostaza',         label: 'Mostaza',                            unidad: 'pz', per: null },
  { id: 'chiles',          label: 'Chiles',                             unidad: 'pz', per: null },
  { id: 'contenedores',    label: 'Contenedores',                       unidad: 'pz', per: null },
  { id: 'bolsas_llevar',   label: 'Bolsas para llevar',                 unidad: 'pz', per: null },
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
  if (!item.per) return null;
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
function conteoDe(cap, id) {
  const v = cap.conteoFinal?.[id];
  return v === undefined || v === '' ? null : num(v);
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
    const conteo = conteoDe(cap, it.id);
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

function pedidoDe(stock) {
  return stock.map((s) => ({ id: s.id, label: s.label, unidad: s.unidad, conteoFinal: s.conteoFinal, minimo: s.minimo, pedir: s.pedir }));
}

export default async (req) => {
  const url = new URL(req.url);
  const expected = process.env.MANAGER_PASSWORD || '';
  const esGerente = expected && (req.headers.get('x-gerente') || '') === expected;
  try {
    if (req.method === 'GET') {
      const date = url.searchParams.get('date');
      const punto = url.searchParams.get('punto');
      if (!date) return json({ error: 'Falta la fecha' }, 400);
      if (!PUNTOS.includes(punto)) return json({ error: 'Falta el punto de control' }, 400);
      // Vista del encargado: solo cantidades, sin contraseña
      if (url.searchParams.get('view') === 'pedido') {
        const { stock } = await calcular(punto, date);
        return json({ pedido: pedidoDe(stock) });
      }
      if (!expected) return json({ error: 'Falta configurar MANAGER_PASSWORD en Netlify' }, 500);
      if (!esGerente) return json({ error: 'Contraseña de gerente incorrecta' }, 401);
      return json(await calcular(punto, date));
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { punto, action, date } = body;
      if (!PUNTOS.includes(punto)) return json({ error: 'Falta el punto de control' }, 400);
      const limpio = (obj) => Object.fromEntries(ITEMS.filter((it) => obj && obj[it.id] !== undefined && obj[it.id] !== '')
        .map((it) => [it.id, num(obj[it.id])]));

      // Encargado: conteo final, sin contraseña
      if (action === 'conteo') {
        if (!date) return json({ error: 'Falta la fecha' }, 400);
        const cap = (await store().get(ikey(punto, date), { type: 'json' })) || { apertura: {}, recibido: {}, mermas: {}, conteoFinal: {} };
        cap.conteoFinal = { ...(cap.conteoFinal || {}), ...limpio(body.conteoFinal) };
        cap.ts = Date.now();
        await store().setJSON(ikey(punto, date), cap);
        const { stock } = await calcular(punto, date);
        return json({ pedido: pedidoDe(stock) });
      }

      if (!expected) return json({ error: 'Falta configurar MANAGER_PASSWORD en Netlify' }, 500);
      if (!esGerente) return json({ error: 'Contraseña de gerente incorrecta' }, 401);

      if (action === 'capturar') {
        if (!date) return json({ error: 'Falta la fecha' }, 400);
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
        const minimos = limpio(body.minimos);
        await store().setJSON(mkey(punto), minimos);
        return json({ minimos });
      }

      return json({ error: 'Acción desconocida' }, 400);
    }

    return json({ error: 'Método no permitido' }, 405);
  } catch (e) {
    return json({ error: 'Error del servidor: ' + e.message }, 500);
  }
};

export const config = { path: '/api/inventario' };

import { getStore } from '@netlify/blobs';

// Cuadre de insumos por punto de control (av = Anima Village, cf = El Cuarto Frío).
// Menú vigente: Brasa Blanca Burgers (2026-11-01). Solo cuentan las notas CERRADAS.
// Las carnes se pesan CRUDAS antes de la parrilla: el esperado se calcula en crudo.
// Traspasos entre almacenes: salen del origen al enviarse (enviado o recibido),
// entran al destino solo cuando el destino los confirma (recibido).

// Carnes: esperado en kg = gramos crudos × unidades vendidas de los platillos listados.
const CARNES = [
  { id: 'carne_master', label: 'Carne Master / Ice (2 × 100 g crudos)', g: 200, dishes: ['master', 'ice'] },
  { id: 'carne_jr',     label: 'Carne Junior (2 × 75 g crudos)',       g: 150, dishes: ['jr'] },
];
// Salsas: solo control entregado/devuelto (sin esperado automático).
const SALSAS = ['mermelada_tocino', 'aderezo_secreto'];
// Insumos por pieza: cantidad consumida por platillo vendido.
// unidad 'g': el campo pz de la captura guarda gramos.
// pendiente: true = cantidad aún no confirmada; se registra pero NO genera esperado.
const INSUMOS = [
  { id: 'pan_brioche',      per: { master: 1, jr: 1 } },              // Ice va sin pan
  { id: 'queso_americano',  per: { master: 2, jr: 2, ice: 2 } },      // todas llevan 2 quesos
  { id: 'lechuga_romana',   per: { ice: 150 }, unidad: 'g' },           // 150 g por Ice
  { id: 'papas_porcion',    per: { papas: 1 } },
  { id: 'tapioca_pz',       per: { tapioca: 1 } },                    // 300 g por porción
  { id: 'brownie_pz',       per: { brownie: 1 } },                    // 300 g por porción
  { id: 'helado_bola',      per: { brownie: 1 } },                    // 1 bola por brownie
  { id: 'refresco_bot',     per: { refresco: 1 } },
  { id: 'refresco_sabor',   per: { mocktail: 1 } },                   // lata de refresco de sabor
  { id: 'espumoso_manzana', per: {}, pendiente: true },               // cantidad por mocktail por confirmar
];

const store = () => getStore('carrito');
const PUNTOS = ['av', 'cf'];
const pkey = (p, d) => `proteina:${p}:${d}`;
const vkey = (p, d) => `ventas:${p}:${d}`;
const tkey = (d) => `traspasos:${d}`;
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const num = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

function vendidos(sales) {
  const q = {};
  for (const s of sales) {
    if (s.estado && s.estado !== 'cerrada') continue; // solo cobradas
    for (const [id, n] of Object.entries(s.items || {})) q[id] = (q[id] || 0) + (n || 0);
  }
  return q;
}

// Movimiento neto de traspasos para un punto y un insumo (en la unidad del insumo).
// Origen: resta al enviarse. Destino: suma solo al recibirse.
function netoTraspaso(traspasos, punto, itemId) {
  let neto = 0;
  for (const t of traspasos) {
    const cant = num(t.items?.[itemId]);
    if (!cant) continue;
    if (t.origen === punto && (t.estado === 'enviado' || t.estado === 'recibido')) neto -= cant;
    if (t.destino === punto && t.estado === 'recibido') neto += cant;
  }
  return neto;
}

function cuadre(punto, prot, sales, traspasos) {
  const q = vendidos(sales);
  const ent = prot?.entregada || {};
  const dev = prot?.devuelta || {};

  const carnes = CARNES.map((c) => {
    const unidades = c.dishes.reduce((a, d) => a + (q[d] || 0), 0);
    const esperadoKg = +((c.g * unidades) / 1000).toFixed(3);
    const eKg = num(ent[c.id]?.kg), dKg = num(dev[c.id]?.kg);
    const ePz = num(ent[c.id]?.pz), dPz = num(dev[c.id]?.pz);
    const trKg = netoTraspaso(traspasos, punto, c.id);
    const consumidoKg = +(eKg - dKg + trKg).toFixed(3);
    const difKg = +(consumidoKg - esperadoKg).toFixed(3);
    const pct = eKg > 0 ? +((difKg / eKg) * 100).toFixed(1) : null;
    const tienePz = (ent[c.id] && ent[c.id].pz) || (dev[c.id] && dev[c.id].pz);
    const difPz = tienePz ? (ePz - dPz) - unidades : null;
    return {
      id: c.id, label: c.label,
      entregadaKg: eKg, devueltaKg: dKg, trasladoKg: +trKg.toFixed(3), consumidoKg, esperadoKg, difKg, pct,
      porcionesVendidas: unidades, difPz,
    };
  });

  const salsas = SALSAS.map((id) => {
    const eKg = num(ent[id]?.kg), dKg = num(dev[id]?.kg);
    return {
      id,
      entregadaKg: eKg, devueltaKg: dKg,
      consumidoKg: +(eKg - dKg).toFixed(3),
      esperadoKg: null, difKg: null, pct: null, porcionesVendidas: null, difPz: null,
    };
  });

  const insumos = INSUMOS.map((c) => {
    const ePz = num(ent[c.id]?.pz), dPz = num(dev[c.id]?.pz);
    const trPz = netoTraspaso(traspasos, punto, c.id);
    const consumidoPz = ePz - dPz + trPz;
    if (c.pendiente) return { id: c.id, pendiente: true, esperadoPz: null, consumidoPz, difPz: null, pct: null, unidad: c.unidad || 'pz' };
    const esperadoPz = Object.entries(c.per).reduce((a, [d, n]) => a + n * (q[d] || 0), 0);
    const difPz = consumidoPz - esperadoPz;
    const pct = ePz > 0 ? +((difPz / ePz) * 100).toFixed(1) : null;
    return { id: c.id, esperadoPz, consumidoPz, difPz, pct, unidad: c.unidad || 'pz' };
  });

  return { carnes, quesos: [], salsas, insumos };
}

export default async (req) => {
  const expected = process.env.MANAGER_PASSWORD || '';
  if (!expected) return json({ error: 'Falta configurar MANAGER_PASSWORD en Netlify' }, 500);

  const pass = req.headers.get('x-gerente') || '';
  if (pass !== expected) return json({ error: 'Contraseña de gerente incorrecta' }, 401);

  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const date = url.searchParams.get('date');
      const punto = url.searchParams.get('punto');
      if (!date) return json({ error: 'Falta la fecha' }, 400);
      if (!PUNTOS.includes(punto)) return json({ error: 'Falta el punto de control' }, 400);
      const prot = await store().get(pkey(punto, date), { type: 'json' });
      const sales = (await store().get(vkey(punto, date), { type: 'json' })) || [];
      const traspasos = (await store().get(tkey(date), { type: 'json' })) || [];
      return json({ protein: prot || { entregada: {}, devuelta: {} }, cuadre: cuadre(punto, prot, sales, traspasos) });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { date, punto, entregada, devuelta } = body;
      if (!date) return json({ error: 'Falta la fecha' }, 400);
      if (!PUNTOS.includes(punto)) return json({ error: 'Falta el punto de control' }, 400);
      const prot = { entregada: entregada || {}, devuelta: devuelta || {} };
      await store().setJSON(pkey(punto, date), prot);
      const sales = (await store().get(vkey(punto, date), { type: 'json' })) || [];
      const traspasos = (await store().get(tkey(date), { type: 'json' })) || [];
      return json({ protein: prot, cuadre: cuadre(punto, prot, sales, traspasos) });
    }

    return json({ error: 'Método no permitido' }, 405);
  } catch (e) {
    return json({ error: 'Error del servidor: ' + e.message }, 500);
  }
};

export const config = { path: '/api/protein' };

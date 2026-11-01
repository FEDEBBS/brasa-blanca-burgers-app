import { getStore } from '@netlify/blobs';

// Ventas por punto de control (Anima Village = 'av', El Cuarto Frío = 'cf').
// Catálogo fijo (fuente única de verdad del servidor). Si cambias precios o puntos,
// cámbialos aquí Y en index.html. Menú vigente: Brasa Blanca Burgers (2026-11-01).
const PUNTOS = ['av', 'cf'];
const DISHES = [
  { id: 'master',   name: 'Hamburguesa Master Doble', price: 290, puntos: ['av', 'cf'] },
  { id: 'jr',       name: 'Hamburguesa Junior Doble', price: 220, puntos: ['av', 'cf'] },
  { id: 'ice',      name: 'Hamburguesa Ice Doble',    price: 290, puntos: ['av', 'cf'] },
  { id: 'papas',    name: 'Papas a la Francesa',      price: 130, puntos: ['av', 'cf'] },
  { id: 'refresco', name: 'Refresco',                 price: 60,  cat: 'bebida', puntos: ['av', 'cf'] },
  { id: 'mocktail', name: 'Mocktail del día',         price: 120, cat: 'bebida', puntos: ['av'] },
  { id: 'tapioca',  name: 'Tapioca con mango y coco', price: 220, puntos: ['av', 'cf'] },
  { id: 'brownie',  name: 'Brownie con helado',       price: 240, puntos: ['av', 'cf'] },
  { id: 'vino',     name: 'Copa de vino (blanco o tinto)', price: 250, cat: 'bebida', puntos: ['cf'] },
  { id: 'cocktail', name: 'Cocktail del día',         price: 230, cat: 'bebida', puntos: ['cf'] },
  { id: 'cerveza',  name: 'Cerveza',                  price: 100, cat: 'bebida', puntos: ['cf'] },
];

const store = () => getStore('carrito');
const key = (punto, date) => `ventas:${punto}:${date}`;
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

const puntoOk = (p) => PUNTOS.includes(p);

// Productos manuales: nombre y precio capturados en el momento, sin ficha ni inventario.
function sanitizeManuales(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => ({
      nombre: String(m?.nombre || '').trim().slice(0, 60),
      precio: Math.round(parseFloat(m?.precio) * 100) / 100,
      cantidad: parseInt(m?.cantidad, 10),
    }))
    .filter((m) => m.nombre && m.precio > 0 && m.cantidad > 0);
}

// Devuelve { total, piezas, error }. Valida que cada platillo exista y se venda en el punto.
function totals(items, manuales, punto) {
  let total = 0, piezas = 0;
  for (const [id, qty] of Object.entries(items || {})) {
    if (!qty) continue;
    const d = DISHES.find((x) => x.id === id);
    if (!d) return { error: `Producto desconocido: ${id}` };
    if (!d.puntos.includes(punto)) return { error: `${d.name} no se vende en este punto` };
    total += d.price * qty;
    piezas += qty;
  }
  for (const m of manuales) {
    total += m.precio * m.cantidad;
    piezas += m.cantidad;
  }
  return { total, piezas };
}

export default async (req) => {
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const date = url.searchParams.get('date');
      const punto = url.searchParams.get('punto');
      if (!date) return json({ error: 'Falta la fecha' }, 400);
      if (!puntoOk(punto)) return json({ error: 'Falta el punto de control' }, 400);
      const sales = (await store().get(key(punto, date), { type: 'json' })) || [];
      return json({ sales });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { date, action, punto } = body;
      if (!date || !action) return json({ error: 'Datos incompletos' }, 400);
      if (!puntoOk(punto)) return json({ error: 'Falta el punto de control' }, 400);
      const sales = (await store().get(key(punto, date), { type: 'json' })) || [];

      if (action === 'open') {
        const manuales = sanitizeManuales(body.manuales);
        const t = totals(body.items, manuales, punto);
        if (t.error) return json({ error: t.error }, 400);
        const sale = {
          id: crypto.randomUUID(),
          punto,
          folio: String(body.folio || '').trim(),
          cliente: String(body.cliente || '').trim(),
          items: body.items || {},
          manuales,
          metodo: null,
          estado: 'abierta',
          total: t.total, piezas: t.piezas,
          ts: Date.now(),
        };
        sales.push(sale);
        await store().setJSON(key(punto, date), sales);
        return json({ sale });
      }

      if (action === 'save' || action === 'close') {
        const sale = sales.find((s) => s.id === body.id);
        if (!sale) return json({ error: 'No encontré esa nota' }, 404);
        if (sale.estado !== 'abierta') return json({ error: 'La nota ya está cerrada' }, 400);
        const manuales = sanitizeManuales(body.manuales);
        const t = totals(body.items, manuales, punto);
        if (t.error) return json({ error: t.error }, 400);
        sale.items = body.items || {};
        sale.manuales = manuales;
        sale.folio = String(body.folio ?? sale.folio ?? '').trim();
        sale.cliente = String(body.cliente ?? sale.cliente ?? '').trim();
        sale.total = t.total; sale.piezas = t.piezas;

        if (action === 'close') {
          if (t.piezas === 0) return json({ error: 'La nota no tiene productos' }, 400);
          if (!body.metodo) return json({ error: 'Falta la forma de pago' }, 400);
          sale.metodo = body.metodo;
          sale.estado = 'cerrada';
          sale.closedTs = Date.now();
        }
        await store().setJSON(key(punto, date), sales);
        return json({ sale });
      }

      return json({ error: 'Acción desconocida' }, 400);
    }

    if (req.method === 'DELETE') {
      const date = url.searchParams.get('date');
      const id = url.searchParams.get('id');
      const punto = url.searchParams.get('punto');
      if (!date || !id) return json({ error: 'Falta fecha o id' }, 400);
      if (!puntoOk(punto)) return json({ error: 'Falta el punto de control' }, 400);
      let sales = (await store().get(key(punto, date), { type: 'json' })) || [];
      sales = sales.filter((s) => s.id !== id);
      await store().setJSON(key(punto, date), sales);
      return json({ ok: true });
    }

    return json({ error: 'Método no permitido' }, 405);
  } catch (e) {
    return json({ error: 'Error del servidor: ' + e.message }, 500);
  }
};

export const config = { path: '/api/sales' };

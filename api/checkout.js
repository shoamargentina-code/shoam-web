// /api/checkout.js — Vercel Serverless Function (Node 18+)
// Crea el cobro en Mercado Pago (Checkout Pro) a partir del carrito de shoam.com.ar.
// El Access Token NO va en el código: se carga en Vercel como variable de entorno MP_ACCESS_TOKEN.
//
// IMPORTANTE: los precios se calculan ACÁ, en el servidor, para que nadie pueda
// modificarlos desde el navegador. Si cambiás un precio en index.html, cambialo también acá.

// Precio con tarjeta (3 cuotas sin interés), según la planilla SHOAM_Precios_Tienda.
const PRODUCTOS = {
  "v-2l":    { title: "Vinagre de Sidra de Manzana con la Madre · Bidón 2 L",          tarjeta: 38000 },
  "v-2x2l":  { title: "Vinagre de Sidra de Manzana con la Madre · 2 × Bidón 2 L",      tarjeta: 54000 },
  "v-3x910": { title: "Vinagre de Sidra de Manzana con la Madre · 3 × Botella 910 ml", tarjeta: 52000 },
  "v-6x910": { title: "Vinagre de Sidra de Manzana con la Madre · Caja 6 × 910 ml",    tarjeta: 80000 },
  "v-5l":    { title: "Vinagre de Sidra de Manzana con la Madre · Bidón 5 L",          tarjeta: 57000 },
  "a-3x500": { title: "Aceite de Oliva Virgen Extra · 3 × Botella 500 ml",             tarjeta: 63000 },
  "a-2l":    { title: "Aceite de Oliva Virgen Extra · Botella 2 L",                    tarjeta: 69000 },
  "a-5l":    { title: "Aceite de Oliva Virgen Extra · Bidón 5 L",                      tarjeta: 135000 },
  "m-2l2l":  { title: "Promo Mixta · Aceite de Oliva 2 L + Vinagre de Sidra 2 L",       tarjeta: 88000 },
  "m-2v1a":  { title: "Promo Mixta · 2 Vinagres 500 ml + 1 Aceite 500 ml",             tarjeta: 50000 },
  "m-3v3a":  { title: "Promo Mixta · 3 Vinagres 500 ml + 3 Aceites 500 ml",            tarjeta: 97000 },
  "m-5l5l":  { title: "Promo Mixta · Bidón Aceite 5 L + Bidón Vinagre 5 L",            tarjeta: 190000 },
};
const SITE = "https://www.shoam.com.ar";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: "Falta configurar MP_ACCESS_TOKEN en Vercel" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const items = (body.items || [])
      .filter((i) => PRODUCTOS[i.id] && Number.isInteger(i.q) && i.q > 0 && i.q <= 50)
      .map((i) => ({
        id: i.id,
        title: PRODUCTOS[i.id].title,
        quantity: i.q,
        unit_price: PRODUCTOS[i.id].tarjeta,
        currency_id: "ARS",
      }));
    if (!items.length) return res.status(400).json({ error: "Carrito vacío" });

    const c = body.comprador || {};
    const clip = (s, n = 120) => String(s || "").slice(0, n);
    const orden = "SH-" + Date.now().toString(36).toUpperCase();

    const preference = {
      items,
      external_reference: orden,
      statement_descriptor: "SHOAM",
      payer: { name: clip(c.nombre, 60), ...(c.email ? { email: clip(c.email, 80) } : {}) },
      metadata: {
        orden,
        nombre: clip(c.nombre), dni: clip(c.dni, 20), whatsapp: clip(c.tel, 40), email: clip(c.email, 80),
        direccion: clip(c.dir), localidad: clip(c.loc), provincia: clip(c.prov, 60), cp: clip(c.cp, 12), notas: clip(c.notas, 200),
      },
      // Máximo 3 cuotas: es lo único que ofrecemos sin interés. Con más cuotas, MP nos cobra el costo financiero.
      payment_methods: { installments: 3 },
      back_urls: {
        success: `${SITE}/?pago=ok`,
        pending: `${SITE}/?pago=pendiente`,
        failure: `${SITE}/?pago=error`,
      },
      auto_return: "approved",
    };

    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(preference),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("Mercado Pago:", data);
      return res.status(502).json({ error: "No se pudo crear el pago" });
    }
    return res.status(200).json({ init_point: data.init_point, orden });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error interno" });
  }
};

// /api/orden.js — Recuperar los datos de envío de una venta hecha con Mercado Pago.
// Uso (desde el navegador):
//   https://www.shoam.com.ar/api/orden?pago=NUMERO_DE_OPERACION&email=CORREO_DEL_COMPRADOR
// Los datos que el cliente cargó en el carrito viajan guardados dentro del pago (metadata).
// Para proteger los datos, solo responde si el correo coincide con el del pago.

module.exports = async (req, res) => {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: "Falta MP_ACCESS_TOKEN en Vercel" });

  const pago = String((req.query && req.query.pago) || "").replace(/\D/g, "");
  const email = String((req.query && req.query.email) || "").trim().toLowerCase();
  if (!pago || !email) {
    return res.status(400).json({ error: "Usá ?pago=NUMERO_DE_OPERACION&email=CORREO_DEL_COMPRADOR" });
  }

  try {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${pago}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return res.status(404).json({ error: "No encontré ese número de operación" });
    const p = await r.json();

    const m = p.metadata || {};
    const correos = [p.payer && p.payer.email, m.email].filter(Boolean).map((x) => String(x).toLowerCase());
    if (!correos.includes(email)) return res.status(403).json({ error: "El correo no coincide con el del pago" });

    return res.status(200).json({
      operacion: p.id,
      orden: m.orden || p.external_reference,
      estado: p.status,
      fecha: p.date_approved || p.date_created,
      total_cobrado: p.transaction_amount,
      cuotas: p.installments,
      neto_recibido: p.transaction_details && p.transaction_details.net_received_amount,
      productos: ((p.additional_info && p.additional_info.items) || []).map((i) => `${i.quantity} × ${i.title}`),
      envio: {
        nombre: m.nombre, dni: m.dni, whatsapp: m.whatsapp, email: m.email,
        direccion: m.direccion, localidad: m.localidad, provincia: m.provincia, cp: m.cp, notas: m.notas,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error interno" });
  }
};

// /api/webhook.js — Aviso automático de Mercado Pago.
// Cuando se aprueba un pago de la web, Mercado Pago llama a esta función y
// mandamos un correo a shoamargentina@gmail.com con el pedido y los datos de envío.
// No depende de que el cliente vuelva a la página ni toque nada.
//
// Variables de entorno en Vercel:
//   MP_ACCESS_TOKEN  (ya existe)
//   RESEND_API_KEY   (clave de resend.com — cuenta creada con shoamargentina@gmail.com)

const AVISO_A = "shoamargentina@gmail.com";

const fmt = (n) => "$" + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function waCliente(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (!d) return "";
  d = d.replace(/^0/, "");
  if (!d.startsWith("54")) d = "549" + d;
  return "https://wa.me/" + d;
}

module.exports = async (req, res) => {
  // Mercado Pago manda el id del pago de distintas formas según el tipo de aviso.
  const q = req.query || {};
  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const tipo = q.type || q.topic || body.type || body.topic || "";
  const id = String(q["data.id"] || (body.data && body.data.id) || (tipo === "payment" ? q.id : "") || "").replace(/\D/g, "");

  // Avisos que no son de pagos (merchant_order, etc.): se confirman y listo.
  if (tipo !== "payment" || !id) return res.status(200).send("ok");

  const token = process.env.MP_ACCESS_TOKEN;
  const resend = process.env.RESEND_API_KEY;
  if (!token || !resend) {
    console.error("Falta MP_ACCESS_TOKEN o RESEND_API_KEY");
    return res.status(200).send(!resend ? "falta RESEND_API_KEY" : "falta MP_ACCESS_TOKEN");
  }

  try {
    // Nunca confiamos en lo que llega: consultamos el pago directo a Mercado Pago.
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { console.error("No se pudo leer el pago", id, r.status); return res.status(200).send("ok"); }
    const p = await r.json();
    if (p.status !== "approved") return res.status(200).send("ok");

    const m = p.metadata || {};
    const items = (p.additional_info && p.additional_info.items) || [];
    const neto = p.transaction_details && p.transaction_details.net_received_amount;
    const costo = neto != null ? p.transaction_amount - neto : null;
    const wa = waCliente(m.whatsapp);
    const fila = (k, v) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#777">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>` : "";

    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
<h2 style="color:#7a1f2b;margin:0 0 4px">Nueva venta en la web · ${esc(m.orden || p.external_reference)}</h2>
<p style="margin:0 0 16px;color:#555">Pago aprobado por Mercado Pago · operación ${esc(p.id)}</p>
<h3 style="margin:16px 0 6px">Pedido</h3>
<ul style="margin:0;padding-left:18px">${items.map((i) => `<li>${esc(i.quantity)} × ${esc(i.title)} — ${fmt(i.unit_price * i.quantity)}</li>`).join("")}</ul>
<table style="margin-top:10px;border-collapse:collapse">
${fila("Total cobrado", fmt(p.transaction_amount))}
${fila("Cuotas", p.installments)}
${neto != null ? fila("Neto recibido", fmt(neto)) : ""}
${costo ? fila("Costo Mercado Pago", fmt(costo)) : ""}
</table>
<h3 style="margin:20px 0 6px">Datos de envío (Andreani)</h3>
<table style="border-collapse:collapse">
${fila("Nombre", m.nombre)}${fila("DNI", m.dni)}${fila("WhatsApp", m.whatsapp)}${fila("Email", m.email || (p.payer && p.payer.email))}
${fila("Dirección", m.direccion)}${fila("Localidad", m.localidad)}${fila("Provincia", m.provincia)}${fila("Código postal", m.cp)}${fila("Notas", m.notas)}
</table>
${wa ? `<p style="margin-top:20px"><a href="${wa}" style="background:#25d366;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Escribirle al cliente por WhatsApp</a></p>` : ""}
</div>`;

    const text = [
      `Nueva venta en la web · ${m.orden || p.external_reference} (operación ${p.id})`,
      "", ...items.map((i) => `${i.quantity} × ${i.title}`),
      `Total: ${fmt(p.transaction_amount)} · ${p.installments} cuota(s)` + (neto != null ? ` · Neto: ${fmt(neto)}` : ""),
      "", `${m.nombre || ""} · DNI ${m.dni || ""}`, `WhatsApp: ${m.whatsapp || ""}`, `Email: ${m.email || ""}`,
      `${m.direccion || ""}`, `${m.localidad || ""}, ${m.provincia || ""} (CP ${m.cp || ""})`, m.notas ? `Notas: ${m.notas}` : "",
    ].join("\n");

    const e = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resend}`,
        "Content-Type": "application/json",
        // Mercado Pago puede avisar el mismo pago varias veces: con esto sale un solo correo.
        "Idempotency-Key": `pago-${p.id}`,
      },
      body: JSON.stringify({
        from: "Tienda SHOAM <onboarding@resend.dev>",
        to: [AVISO_A],
        ...(m.email ? { reply_to: m.email } : {}),
        subject: `🛒 Venta web ${fmt(p.transaction_amount)} · ${m.nombre || "cliente"} · ${m.localidad || ""}`,
        html, text,
      }),
    });
    if (!e.ok && e.status !== 409) { const t = await e.text(); console.error("Resend:", e.status, t); return res.status(200).send("resend error " + e.status); }
    return res.status(200).send("correo enviado");
  } catch (err) {
    console.error(err);
  }
  return res.status(200).send("ok");
};

// Logica PURA del oido de Omega (sin red ni disco): la prueba el banco (test.mjs) sin WhatsApp.
// 21-oct-2026. 

export const MAX_TEXTO = 4000;          // lo que se guarda de un mensaje entrante
export const MAX_ENVIO = 2000;          // lo maximo que se envia
export const INTERVALO_MS = 8000;       // entre dos envios (el servicio de mensajería pone 10 s; esto es la red de seguridad)
export const TOPE_DIA = 40;             // envios por dia CDMX (el servicio de mensajería pone 30)

// Igual que normalizar_numero() del servicio de mensajería y del hook del agente.
export function normalizarNumero(n) {
  let s = String(n ?? "").split("@")[0].split(":")[0].replace(/[^\d+]/g, "");
  if (!s) return "";
  if (!s.startsWith("+")) s = "+" + s;
  if (s.startsWith("+521") && s.length === 14) s = "+52" + s.slice(4);
  return /^\+\d{8,15}$/.test(s) ? s : "";
}

// Que chats entran: SOLO directos. Grupos, estados, canales (newsletter) y difusiones, nunca.
export function esDirecto(jid) {
  const j = String(jid || "");
  if (!j || j === "status@broadcast") return false;
  if (j.endsWith("@g.us") || j.endsWith("@broadcast") || j.endsWith("@newsletter")) return false;
  return j.endsWith("@s.whatsapp.net") || j.endsWith("@lid") || j.endsWith("@c.us");
}

// Texto legible de un mensaje de Baileys. Lo que no es texto se describe, nunca se descarga.
export function extraerTexto(message) {
  let m = message || {};
  for (let i = 0; i < 3; i++) {     // envoltorios: efimero, ver-una-vez, editado
    const dentro = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!dentro) break;
    m = dentro;
  }
  if (typeof m.conversation === "string" && m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  const pie = (x) => (x?.caption ? `: ${x.caption}` : "");
  if (m.imageMessage) return `[foto${pie(m.imageMessage)}]`;
  if (m.videoMessage) return `[video${pie(m.videoMessage)}]`;
  if (m.audioMessage) return m.audioMessage.ptt ? "[nota de voz]" : "[audio]";
  if (m.documentMessage) return `[documento${m.documentMessage.fileName ? ": " + m.documentMessage.fileName : ""}]`;
  if (m.stickerMessage) return "[sticker]";
  if (m.locationMessage || m.liveLocationMessage) return "[ubicacion]";
  if (m.contactMessage || m.contactsArrayMessage) return "[contacto compartido]";
  if (m.reactionMessage) return null;           // reacciones: no son mensajes
  if (m.protocolMessage || m.senderKeyDistributionMessage) return null;   // control interno
  if (m.pollCreationMessage || m.pollCreationMessageV3) return "[encuesta]";
  return null;
}

// Numero E.164 del otro lado. `alt` = key.remoteJidAlt (Baileys 7 lo da cuando el jid es @lid).
// `pnDeLid` = numero ya resuelto por el mapa de LID (o null). Sin numero: "lid:<id>" (desconocido).
export function deQuien(jid, alt, pnDeLid) {
  const j = String(jid || "");
  if (!j.endsWith("@lid")) return { de: normalizarNumero(j), lid: null };
  const n = normalizarNumero(alt) || normalizarNumero(pnDeLid);
  return n ? { de: n, lid: j.split("@")[0] } : { de: "lid:" + j.split("@")[0], lid: j.split("@")[0] };
}

// 22-oct: grupos (y los de comunidades, que son grupos normales). id = la parte antes de @g.us.
const RE_GRUPO = /^(\d{5,30}(?:-\d{5,20})?)@g\.us$/;
export function idGrupo(jid) {
  const m = RE_GRUPO.exec(String(jid || ""));
  return m ? m[1] : null;
}

// Silencio de un chat (muteEndTime de Baileys): -1 (o negativo) = para siempre; si no, hasta ese instante.
// Viene en ms; si parece en segundos se pasa a ms.
export function silenciado(fin, ahoraMs) {
  if (fin == null || fin === 0) return false;
  let n = Number(fin);
  if (!Number.isFinite(n)) return false;
  if (n < 0) return true;
  if (n < 1e12) n *= 1000;
  return n > ahoraMs;
}

// Un grupo entra al buzon SOLO si: ya se conocen los silencios (si no, nada: fallo cerrado), no esta silenciado,
// y no es la «comunidad» madre (no tiene conversacion propia).
// ctx = {silenciosListos, silencios: {jid: fin}, grupos: {id: {nombre, comunidad, es_comunidad}}, ahora}
export function grupoEntra(jid, ctx) {
  const id = idGrupo(jid);
  if (!id || !ctx?.silenciosListos) return false;
  if (silenciado(ctx.silencios?.[jid], ctx.ahora ?? Date.now())) return false;
  if (ctx.grupos?.[id]?.es_comunidad) return false;
  return true;
}

// ¿El mensaje menciona al usuario (@) o le responde (cita un mensaje suyo)? yo = {pn, lid} (solo la parte de usuario).
export function meMenciona(message, yo) {
  let m = message || {};
  for (let i = 0; i < 3; i++) {
    const dentro = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!dentro) break;
    m = dentro;
  }
  const mias = new Set([yo?.pn, yo?.lid].filter(Boolean).map(String));
  if (!mias.size) return false;
  for (const v of Object.values(m)) {
    const ci = v && typeof v === "object" ? v.contextInfo : null;
    if (!ci) continue;
    const ids = [...(ci.mentionedJid || []), ci.participant].filter(Boolean).map((j) => String(j).split("@")[0].split(":")[0]);
    if (ids.some((x) => mias.has(x))) return true;
  }
  return false;
}

const limpiar = (t) => String(t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, MAX_TEXTO);

// Registro del buzon (mismo contrato que el hook del agente + perfil, yo, lid). null = no se guarda.
// Directos: igual que el 21-oct. Grupos: ademas `grupo`, `grupo_nombre`, `comunidad`; `de` = quien lo escribio.
// `pnDeLid` = numero del otro (directo) o del autor (grupo) ya resuelto por el mapa de LID.
export function registro(msg, pnDeLid, ctx) {
  const k = msg?.key || {};
  const directo = esDirecto(k.remoteJid);
  if (!directo && !grupoEntra(k.remoteJid, ctx)) return null;
  const texto = extraerTexto(msg.message);
  if (texto == null) return null;
  const quien = directo ? deQuien(k.remoteJid, k.remoteJidAlt, pnDeLid)
    : k.fromMe ? { de: "yo", lid: null }
    : deQuien(k.participant, k.participantAlt, pnDeLid);
  if (!quien.de) return null;
  const ts = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0) * 1000 || Date.now();
  const reg = {
    v: 2, canal: "whatsapp", de: quien.de, lid: quien.lid, yo: Boolean(k.fromMe),
    perfil: k.fromMe ? null : (String(msg.pushName || "").slice(0, 60) || null),
    texto: limpiar(texto),
    ts, id: String(k.id || "").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || `${ts}`,
  };
  if (!directo) {
    const id = idGrupo(k.remoteJid);
    const g = ctx?.grupos?.[id] || {};
    reg.grupo = id;
    reg.grupo_nombre = String(g.nombre || "").slice(0, 100) || null;
    reg.comunidad = String(g.comunidad || "").slice(0, 100) || null;
    reg.menciona = !k.fromMe && meMenciona(msg.message, ctx?.yo);
  }
  return reg;
}

// Candados del ENVIO (defensa en profundidad; los topes de verdad estan en el servicio de mensajería).
// estado = {dia: "AAAA-MM-DD", n: envios ese dia, ultimo: ms}. Devuelve {ok, motivo, jid}.
export function validarEnvio(peticion, estado, ahoraMs, diaHoy) {
  const grupo = peticion?.grupo != null ? idGrupo(String(peticion.grupo) + "@g.us") : null;
  if (peticion?.grupo != null && !grupo) return { ok: false, motivo: "grupo invalido" };
  const to = grupo ? "grupo:" + grupo : normalizarNumero(peticion?.to);
  const texto = String(peticion?.texto ?? "");
  if (!to) return { ok: false, motivo: "destinatario no es E.164" };
  if (!texto.trim() || texto.length > MAX_ENVIO) return { ok: false, motivo: `texto debe tener 1..${MAX_ENVIO}` };
  const n = estado?.dia === diaHoy ? Number(estado.n || 0) : 0;
  if (n >= TOPE_DIA) return { ok: false, motivo: `tope del oido: ${TOPE_DIA} envios hoy` };
  if (estado?.ultimo && ahoraMs - estado.ultimo < INTERVALO_MS) return { ok: false, motivo: "demasiado seguido" };
  if (grupo) return { ok: true, jid: grupo + "@g.us", jids: [grupo + "@g.us"], to, grupo };
  const jids = jidsDeEnvio(to);
  return { ok: true, jid: jids[0], jids, to };
}

// 22-oct: WhatsApp registra los moviles de Mexico como 521 + 10 digitos (medido: 50+ mapas LID, todos 521…).
// Enviar a 52 + 10 «sale» sin error pero no llega a ningun aparato. Primero 521, luego 52 por si acaso;
// el oido manda SOLO al que WhatsApp resuelve.
export function jidsDeEnvio(to) {
  const d = String(to).slice(1);
  const base = d + "@s.whatsapp.net";
  return d.startsWith("52") && d.length === 12 ? ["521" + d.slice(2) + "@s.whatsapp.net", base] : [base];
}

export function diaCdmx(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

// ------------------------------------------------------------------ 23-oct: «leido» (lo que el usuario lee en su telefono)
// Para que la bandeja deje de contar como sin leer lo que el usuario ya leyo en su telefono. Señales de Baileys rc14:
//  (a) chats.update {id, unreadCount: 0}: accion de app-state markChatAsRead (chat-utils.js processSyncAction). -1 (marcado
//      «no leido») y null (sync inicial) NO cuentan.
//  (b) messages.update {key: {fromMe: false}, update: {status: READ|PLAYED}} en un DIRECTO: el recibo de lectura que manda
//      OTRO aparato mio (messages-recv.js handleReceipt: «another device of ours has read some messages»; es el unico
//      emisor de messages.update que pone status 4/5).
//  (c) message-receipt.update en un GRUPO con receipt.userJid = yo y readTimestamp: lo lei yo en otro aparato.
// Devuelve [{jid, hasta}] (hasta en ms, nunca en el futuro). Sin texto ni nombres. yo = {pn, lid} (parte de usuario).
export const ESTADO_LEIDO = 4;          // proto.WebMessageInfo.Status.READ (PLAYED = 5)
const aMs = (t, ahoraMs) => {
  let n = Number(t?.low ?? t);
  if (!Number.isFinite(n) || n <= 0) return ahoraMs;
  if (n < 1e12) n *= 1000;
  return Math.min(n, ahoraMs);
};
export function leidos(evento, payload, ahoraMs, yo) {
  const out = [];
  for (const u of Array.isArray(payload) ? payload : []) {
    if (evento === "chats.update") {
      if (u?.id && u.unreadCount === 0) out.push({ jid: String(u.id), hasta: ahoraMs });
    } else if (evento === "messages.update") {
      const k = u?.key || {};
      const st = Number(u?.update?.status);
      if (k.remoteJid && k.fromMe === false && st >= ESTADO_LEIDO && esDirecto(k.remoteJid)) {
        out.push({ jid: String(k.remoteJid), hasta: aMs(u.update.messageTimestamp, ahoraMs) });
      }
    } else if (evento === "message-receipt.update") {
      const r = u?.receipt || {};
      const quien = String(r.userJid || "").split("@")[0].split(":")[0];
      const mias = new Set([yo?.pn, yo?.lid].filter(Boolean).map(String));
      if (idGrupo(u?.key?.remoteJid) && quien && mias.has(quien) && r.readTimestamp) {
        out.push({ jid: String(u.key.remoteJid), hasta: aMs(r.readTimestamp, ahoraMs) });
      }
    }
  }
  return out;
}

// Clave de la conversacion tal como la guarda la bandeja: '+52…' (directo), 'lid:<id>' (directo sin numero) o
// 'grupo:<id>'. El LID se resuelve igual que en los mensajes entrantes (deQuien). Estados, canales, difusiones: null.
export function claveChat(jid, pnDeLid) {
  const g = idGrupo(jid);
  if (g) return "grupo:" + g;
  if (!esDirecto(jid)) return null;
  return deQuien(jid, null, pnDeLid).de || null;
}

// Registro «leido» del spool (el servicio de mensajería marca leido=1 en ESA conversacion hasta `hasta`; nunca crea filas). null = nada.
export function registroLeido(jid, hasta, pnDeLid) {
  const chat = claveChat(jid, pnDeLid);
  const h = Math.floor(Number(hasta));
  if (!chat || !Number.isFinite(h) || h <= 0) return null;
  return { v: 2, canal: "whatsapp", tipo: "leido", chat, hasta: h };
}

// Oido propio de Omega: un dispositivo vinculado de WhatsApp SOLO para Omega (sin el agente).
//   node oido.mjs vincular   — en una terminal REAL: muestra el QR, guarda la sesion y sale.
//   node oido.mjs            — servicio (systemd): recibe directos y grupos no silenciados al buzon y envia por el socket.
// Sin modelos, sin red salvo WhatsApp.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { diaCdmx, idGrupo, leidos, registro, registroLeido, silenciado, validarEnvio } from "./nucleo.mjs";

const ESTADO = process.env.WA_OMEGA_ESTADO || "/var/lib/wa-omega";
const AUTH = path.join(ESTADO, "auth");
const BUZON = path.join(ESTADO, "entrante");
const ENVIOS = path.join(ESTADO, "envios.json");
const ESTADO_JSON = path.join(ESTADO, "estado.json");
const GRUPOS_JSON = path.join(ESTADO, "grupos.json");   // 22-oct: nombres de grupos y silencios
const SOCKET = process.env.WA_OMEGA_SOCKET || "/run/wa-omega/envio.sock";
const MAX_BUZON = 2000;
const VINCULAR = process.argv[2] === "vincular";

const log = pino({ level: process.env.WA_OMEGA_LOG || "warn" });
// 22-oct: libsignal imprime con console.info/warn las SESIONES enteras (llaves privadas, rootKey) al abrir/cerrar
// sesiones ⇒ acababan en el journal. El servicio no usa console salvo error; al vincular hace falta el QR.
if (!VINCULAR) for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
let sock = null;
let conectado = false;
let espera = 2000;
const enviadosPorOmega = new Set();          // ids que mando Omega: vuelven como fromMe y se marcan omega:true
// 22-oct: grupos. silenciosListos=false ⇒ ningun grupo entra (no se sabe cuales estan silenciados).
let G = { silenciosListos: false, silencios: {}, grupos: {} };
try { G = { ...G, ...JSON.parse(fs.readFileSync(GRUPOS_JSON, "utf8")) }; } catch { /* primera vez */ }
let guardarG = null;
function guardarGrupos() {
  clearTimeout(guardarG);
  guardarG = setTimeout(() => { try { escribirAtomico(GRUPOS_JSON, JSON.stringify({ ...G, ts: Date.now() })); } catch { /* reintenta luego */ } }, 500);
}

for (const d of [AUTH, BUZON]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });

function escribirAtomico(ruta, datos, modo = 0o600) {
  const tmp = `${ruta}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, datos, { mode: modo });
  fs.renameSync(tmp, ruta);
}

function estado(extra) {
  const doc = { conectado, ts: Date.now(), yo: sock?.user?.id ? String(sock.user.id).split(":")[0].split("@")[0] : null,
    ...extra };
  try { escribirAtomico(ESTADO_JSON, JSON.stringify(doc), 0o644); } catch { /* el estado no tumba el servicio */ }
}

async function alBuzon(msg) {
  let pn = null;
  const jid = msg?.key?.remoteJid || "";
  if (jid.endsWith("@lid")) {
    try { pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid); } catch { pn = null; }
  }
  if (idGrupo(jid) && !msg.key.fromMe) {
    const p = msg.key.participant || "";
    if (p.endsWith("@lid")) { try { pn = await sock?.signalRepository?.lidMapping?.getPNForLID(p); } catch { pn = null; } }
  }
  const reg = registro(msg, pn, { ...G, ahora: Date.now(), yo: yoAhora() });
  if (!reg) return;
  if (reg.yo && enviadosPorOmega.has(msg.key.id)) reg.omega = true;
  const final = path.join(BUZON, `${reg.ts}-${reg.id}.json`);
  if (fs.existsSync(final)) return;                          // duplicado (notify + append)
  if (fs.readdirSync(BUZON).length >= MAX_BUZON) { log.error("buzon lleno: el consumidor no ingiere"); return; }
  escribirAtomico(final, JSON.stringify(reg));
}

// 23-oct: «leido». Se juntan 2 s por conversacion (un recibo trae muchos ids; varios aparatos repiten) y se deja UN
// registro por chat con el `hasta` mayor: {tipo:"leido", chat, hasta}. Sin texto ni nombres. el servicio de mensajería solo actualiza.
const LEIDOS_MS = 2000;
const pendientesLeido = new Map();           // jid -> hasta (ms)
let temporizadorLeido = null;
function yoAhora() {
  return { pn: String(sock?.user?.id || "").split(":")[0].split("@")[0] || null,
    lid: String(sock?.user?.lid || "").split(":")[0].split("@")[0] || null };
}
function alLeido(evento, payload) {
  try {
    for (const { jid, hasta } of leidos(evento, payload, Date.now(), yoAhora())) {
      pendientesLeido.set(jid, Math.max(hasta, pendientesLeido.get(jid) || 0));
    }
  } catch (err) { log.error({ err: String(err?.name || "error").slice(0, 40) }, "leido"); return; }
  if (pendientesLeido.size && !temporizadorLeido) {
    temporizadorLeido = setTimeout(() => {
      temporizadorLeido = null;
      volcarLeidos().catch((err) => log.error({ err: String(err?.name || "error").slice(0, 40) }, "leido"));
    }, LEIDOS_MS);
  }
}
async function volcarLeidos() {
  const lote = [...pendientesLeido.entries()];
  pendientesLeido.clear();
  for (const [jid, hasta] of lote) {
    let pn = null;
    if (jid.endsWith("@lid")) { try { pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid); } catch { pn = null; } }
    const reg = registroLeido(jid, hasta, pn);
    if (!reg) continue;
    const huella = crypto.createHash("sha256").update(reg.chat).digest("hex").slice(0, 16);
    const final = path.join(BUZON, `${reg.hasta}-leido-${huella}.json`);
    if (fs.existsSync(final)) continue;
    if (fs.readdirSync(BUZON).length >= MAX_BUZON) { log.error("buzon lleno: el consumidor no ingiere"); return; }
    escribirAtomico(final, JSON.stringify(reg));
  }
}

function leerEnvios() {
  try { return JSON.parse(fs.readFileSync(ENVIOS, "utf8")); } catch { return {}; }
}

async function enviar(peticion) {
  if (!sock || !conectado) return { ok: false, motivo: "WhatsApp desconectado" };
  const ahora = Date.now();
  const hoy = diaCdmx(ahora);
  const e = leerEnvios();
  const v = validarEnvio(peticion, e, ahora, hoy);
  if (!v.ok) return v;
  // 22-oct: solo al jid que WhatsApp conoce (tiene LID). Si ninguno resuelve, NO se envia: antes «salia» y no llegaba.
  // Grupo: solo uno en el que estoy y que no es la comunidad madre.
  let destino = null;
  if (v.grupo) {
    const g = G.grupos[v.grupo];
    if (!g) return { ok: false, motivo: "no estoy en ese grupo; no envie nada" };
    if (g.es_comunidad) return { ok: false, motivo: "es la comunidad, no un grupo; no envie nada" };
    destino = v.jid;
  }
  for (const j of v.grupo ? [] : v.jids) {
    try { if (await sock.signalRepository.lidMapping.getLIDForPN(j)) { destino = j; break; } } catch { /* siguiente */ }
  }
  if (!destino) return { ok: false, motivo: "ese numero no aparece en WhatsApp; no envie nada" };
  const r = await sock.sendMessage(destino, { text: String(peticion.texto) });
  const id = r?.key?.id || null;
  if (id) enviadosPorOmega.add(id);
  escribirAtomico(ENVIOS, JSON.stringify({ dia: hoy, n: (e.dia === hoy ? Number(e.n || 0) : 0) + 1, ultimo: ahora }));
  log.warn({ a: v.to.slice(0, 6) + "…" }, "envio hecho");   // sin texto ni numero completo en el log
  return { ok: true, id };
}

function servidorEnvios() {
  try { fs.unlinkSync(SOCKET); } catch { /* no existia */ }
  const srv = net.createServer((c) => {
    let buf = "";
    c.setEncoding("utf8");
    c.on("data", async (d) => {
      buf += d;
      if (buf.length > 16384) { c.end(JSON.stringify({ ok: false, motivo: "peticion demasiado grande" }) + "\n"); return; }
      const i = buf.indexOf("\n");
      if (i < 0) return;
      let p;
      try { p = JSON.parse(buf.slice(0, i)); } catch { c.end(JSON.stringify({ ok: false, motivo: "JSON invalido" }) + "\n"); return; }
      let r;
      if (p?.op === "estado") r = { ok: true, conectado, yo: sock?.user?.id ? String(sock.user.id).split(":")[0] : null };
      else if (p?.op === "grupos") r = { ok: true, silenciosListos: G.silenciosListos, grupos: Object.entries(G.grupos).map(([id, g]) => ({
        id, nombre: g.nombre || null, comunidad: g.comunidad || null, es_comunidad: Boolean(g.es_comunidad), anuncios: Boolean(g.anuncios),
        silenciado: silenciado(G.silencios[id + "@g.us"], Date.now()) })) };
      else {
        // revision 22-oct: el mensaje de error de Baileys puede llevar el numero: solo el tipo de error
        try { r = await enviar(p); } catch (err) { r = { ok: false, motivo: `fallo al enviar (${String(err?.name || "error").slice(0, 40)})` }; }
      }
      // 22-oct: un envio que NO sale deja rastro (solo el motivo; ni texto ni numero) para que el consumidor del buzón lo cuente
      if (p?.op !== "estado" && p?.op !== "grupos" && !r?.ok) log.warn({ motivo: String(r?.motivo || "").slice(0, 60) }, "envio rechazado");
      c.end(JSON.stringify(r) + "\n");
    });
    c.on("error", () => {});
  });
  srv.listen(SOCKET, () => fs.chmodSync(SOCKET, 0o600));
}

async function arrancar() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  sock = makeWASocket({
    auth: state,
    logger: log,
    browser: ["Omega", "Chrome", "1.0"],
    markOnlineOnConnect: false,          // no marca «en linea» ni silencia las notificaciones del telefono
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    getMessage: async () => undefined,
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (u) => {
    if (u.qr) {
      if (VINCULAR) { console.log("\nEscanea con WhatsApp > Dispositivos vinculados > Vincular un dispositivo:\n"); qrcode.generate(u.qr, { small: true }); }
      else { estado({ motivo: "sin_vincular" }); log.error("sin sesion: corre `wa-omega vincular` en una terminal real"); }
    }
    if (u.connection === "open") {
      conectado = true; espera = 2000; estado({ motivo: "ok" });
      if (!VINCULAR) prepararGrupos().catch((err) => log.error({ err: String(err?.name || "error").slice(0, 40) }, "grupos"));
      if (VINCULAR) { console.log("\nVinculado. Ya puedes cerrar esto (sale solo en 5 s)."); setTimeout(() => process.exit(0), 5000); }
    }
    if (u.connection === "close") {
      conectado = false;
      const codigo = u.lastDisconnect?.error?.output?.statusCode;
      if (codigo === DisconnectReason.loggedOut) {
        estado({ motivo: "sesion_cerrada" });
        log.error("WhatsApp cerro la sesion (desvinculado): hace falta `wa-omega vincular`");
        if (VINCULAR) process.exit(2);
        return;                                   // no reintenta: sin sesion no hay nada que hacer
      }
      estado({ motivo: `reconectando(${codigo ?? "?"})` });
      setTimeout(arrancar, espera);
      espera = Math.min(espera * 2, 60000);
    }
  });
  if (!VINCULAR) {
    const alSilencio = (chats) => {
      let cambio = false;
      for (const c of chats || []) {
        if (!c?.id || !("muteEndTime" in c)) continue;
        if (c.muteEndTime == null) delete G.silencios[c.id]; else G.silencios[c.id] = Number(c.muteEndTime);
        cambio = true;
      }
      if (cambio) guardarGrupos();
    };
    sock.ev.on("chats.update", alSilencio);
    // 23-oct: lo que el usuario lee en su telefono -> registro «leido» al spool (ver leidos() en nucleo.mjs)
    sock.ev.on("chats.update", (chats) => alLeido("chats.update", chats));
    sock.ev.on("messages.update", (us) => alLeido("messages.update", us));
    sock.ev.on("message-receipt.update", (rs) => alLeido("message-receipt.update", rs));
    sock.ev.on("chats.upsert", alSilencio);
    sock.ev.on("groups.update", () => { refrescarGrupos().catch(() => {}); });
    sock.ev.on("groups.upsert", () => { refrescarGrupos().catch(() => {}); });
    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const m of messages || []) {
        try { await alBuzon(m); } catch (err) { log.error({ err: String(err?.name || "error").slice(0, 40) }, "buzon"); }
      }
    });
  }
}

// Nombres de los grupos en los que estoy (y su comunidad).
async function refrescarGrupos() {
  const todos = await sock.groupFetchAllParticipating();
  const nuevos = {};
  for (const [jid, g] of Object.entries(todos || {})) {
    const id = idGrupo(jid);
    if (!id) continue;
    nuevos[id] = { nombre: g.subject || null, padre: idGrupo(g.linkedParent) || null,
      es_comunidad: Boolean(g.isCommunity), anuncios: Boolean(g.isCommunityAnnounce) };
  }
  for (const g of Object.values(nuevos)) g.comunidad = g.padre ? (nuevos[g.padre]?.nombre || null) : null;
  G.grupos = nuevos;
  guardarGrupos();
}

// Al conectar: grupos y, la PRIMERA vez, el estado completo de los silencios (coleccion regular_high desde cero).
// Hasta que eso acabe bien, silenciosListos=false y ningun grupo entra al buzon.
async function prepararGrupos() {
  await refrescarGrupos();
  if (!G.silenciosListos) {
    // Desde cero aunque hubiera version guardada (si se perdio grupos.json, los silencios viejos no volverian).
    try { fs.unlinkSync(path.join(AUTH, "app-state-sync-version-regular_high.json")); } catch { /* no habia */ }
    // REVISION 22-oct [M con Baileys rc14]: con isInitialSync=true los chats.update de silencio NO se emiten (quedan
    // retenidos) => silencios vacio y silenciosListos=true = FALLO ABIERTO. Con false si se emiten.
    await sock.resyncAppState(["regular_high"], false);
    await new Promise((r) => setTimeout(r, 3000));        // que se vacien los chats.update del resync
    G.silenciosListos = true;
    guardarGrupos();
    log.warn({ grupos: Object.keys(G.grupos).length, silenciados: Object.keys(G.silencios).length }, "silencios listos");
  }
}

if (!VINCULAR) servidorEnvios();
arrancar().catch((err) => { console.error(String(err?.stack || err)); process.exit(1); });

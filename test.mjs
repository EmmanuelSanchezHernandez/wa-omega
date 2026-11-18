// Banco del oido de Omega: la logica pura de nucleo.mjs, sin red. `node test.mjs` => rc 0 solo si todo verde.
import * as n from "./nucleo.mjs";

let total = 0;
const fallos = [];
function ok(c, e) { total++; if (c) console.log("  ok    ", e); else { fallos.push(e); console.log("  FALLO ", e); } }
const msg = (jid, message, extra = {}) => ({ key: { remoteJid: jid, id: "ABC123", fromMe: false, ...extra.key },
  message, pushName: extra.pushName ?? "Ana", messageTimestamp: 1760000000 });

console.log("== chats que entran");
ok(n.esDirecto("5217711111111@s.whatsapp.net"), "directo por numero");
ok(n.esDirecto("100000000000001@lid"), "directo por LID");
ok(!n.esDirecto("120363000000000000@g.us"), "grupo no es directo");
ok(!n.esDirecto("status@broadcast"), "estados NO");
ok(!n.esDirecto("1234@broadcast"), "difusion NO");
ok(!n.esDirecto("120363@newsletter"), "canal NO");
ok(!n.esDirecto(""), "vacio NO");

console.log("== texto");
ok(n.extraerTexto({ conversation: "hola" }) === "hola", "conversation");
ok(n.extraerTexto({ extendedTextMessage: { text: "con enlace" } }) === "con enlace", "extendedText");
ok(n.extraerTexto({ ephemeralMessage: { message: { conversation: "efimero" } } }) === "efimero", "efimero desenvuelto");
ok(n.extraerTexto({ imageMessage: { caption: "mira" } }) === "[foto: mira]", "foto con pie, sin descargar");
ok(n.extraerTexto({ audioMessage: { ptt: true } }) === "[nota de voz]", "nota de voz");
ok(n.extraerTexto({ reactionMessage: {} }) === null, "reaccion no es mensaje");
ok(n.extraerTexto({ protocolMessage: {} }) === null, "control interno fuera");

console.log("== de quien");
ok(n.deQuien("5217711111111@s.whatsapp.net").de === "+527711111111", "quita el 1 movil de MX");
ok(n.deQuien("100000000000001@lid", "5215522222222@s.whatsapp.net").de === "+525522222222", "LID con remoteJidAlt");
ok(n.deQuien("100000000000001@lid", undefined, "5215533333333@s.whatsapp.net").de === "+525533333333", "LID por el mapa");
ok(n.deQuien("100000000000001@lid").de === "lid:100000000000001", "LID sin numero => desconocido marcado");

console.log("== registro");
let r = n.registro(msg("5217711111111@s.whatsapp.net", { conversation: "ya llegué" }));
ok(r && r.de === "+527711111111" && r.texto === "ya llegué" && r.perfil === "Ana" && r.yo === false && r.v === 2, "directo completo");
ok(n.registro(msg("120363000000000000@g.us", { conversation: "grupo" })) === null, "grupo sin contexto (silencios no listos) NO se guarda");
r = n.registro(msg("5217711111111@s.whatsapp.net", { conversation: "lo mando yo" }, { key: { fromMe: true } }));
ok(r && r.yo === true && r.perfil === null, "lo que envia el usuario: yo=true y sin perfil");
r = n.registro(msg("5217711111111@s.whatsapp.net", { conversation: "a\u0000b\u001bc" }));
ok(r.texto === "a b c", "caracteres de control limpiados");
ok(n.registro(msg("5217711111111@s.whatsapp.net", { reactionMessage: {} })) === null, "reaccion no se guarda");
r = n.registro(msg("5217711111111@s.whatsapp.net", { conversation: "x".repeat(9000) }));
ok(r.texto.length === n.MAX_TEXTO, "texto acotado");

console.log("== candados de envio");
const hoy = n.diaCdmx(Date.now());
ok(n.validarEnvio({ to: "+52 1 771 111 1111", texto: "hola" }, {}, Date.now(), hoy).jid === "5217711111111@s.whatsapp.net", "movil MX: el jid es 521 + 10 (como lo registra WhatsApp)");
ok(n.validarEnvio({ to: "+525544444444", texto: "hola" }, {}, Date.now(), hoy).jids.join() === "5215544444444@s.whatsapp.net,525544444444@s.whatsapp.net", "MX: primero 521, luego 52");
ok(n.validarEnvio({ to: "+34600111222", texto: "hola" }, {}, Date.now(), hoy).jids.join() === "34600111222@s.whatsapp.net", "fuera de MX: el numero tal cual");
ok(!n.validarEnvio({ to: "lid:123", texto: "hola" }, {}, Date.now(), hoy).ok, "no se envia a un LID sin numero");
ok(!n.validarEnvio({ to: "+527711111111", texto: "" }, {}, Date.now(), hoy).ok, "texto vacio NO");
ok(!n.validarEnvio({ to: "+527711111111", texto: "x".repeat(2001) }, {}, Date.now(), hoy).ok, "texto largo NO");
ok(!n.validarEnvio({ to: "+527711111111", texto: "hola" }, { dia: hoy, n: 40 }, Date.now(), hoy).ok, "tope diario");
ok(n.validarEnvio({ to: "+527711111111", texto: "hola" }, { dia: "2000-01-01", n: 40 }, Date.now(), hoy).ok, "el tope es por dia");
ok(!n.validarEnvio({ to: "+527711111111", texto: "hola" }, { ultimo: Date.now() - 1000 }, Date.now(), hoy).ok, "intervalo minimo");

console.log("== grupos (22-oct)");
const G = "120363111111111111@g.us";
const ahora = Date.now();
const ctx = (extra = {}) => ({ silenciosListos: true, silencios: {}, ahora,
  grupos: { "120363111111111111": { nombre: "Familia", comunidad: "Casa" }, "120363999999999999": { nombre: "Madre", es_comunidad: true } }, ...extra });
const gmsg = (texto, key = {}) => msg(G, { conversation: texto }, { key: { participant: "5217711111111@s.whatsapp.net", ...key }, pushName: "Ana" });
ok(n.idGrupo(G) === "120363111111111111", "id de grupo");
ok(n.idGrupo("123-456@g.us") === null && n.idGrupo("1234567890-1234567@g.us") === "1234567890-1234567", "id de grupo viejo (con guion)");
ok(n.idGrupo("120363@newsletter") === null && n.idGrupo("5217711111111@s.whatsapp.net") === null, "canal y directo no son grupo");
r = n.registro(gmsg("nos vemos"), null, ctx());
ok(r && r.grupo === "120363111111111111" && r.grupo_nombre === "Familia" && r.comunidad === "Casa" && r.de === "+527711111111" && r.perfil === "Ana", "grupo completo: grupo, nombre, comunidad y autor");
ok(n.registro(gmsg("x"), null, ctx({ silenciosListos: false })) === null, "silencios no listos => NADA de grupos (fallo cerrado)");
ok(n.registro(gmsg("x"), null, ctx({ silencios: { [G]: -1 } })) === null, "silenciado para siempre => fuera");
ok(n.registro(gmsg("x"), null, ctx({ silencios: { [G]: ahora + 3600e3 } })) === null, "silenciado 1 h => fuera");
ok(n.registro(gmsg("x"), null, ctx({ silencios: { [G]: Math.floor((ahora + 3600e3) / 1000) } })) === null, "silencio en segundos => fuera");
ok(n.registro(gmsg("x"), null, ctx({ silencios: { [G]: ahora - 1000 } })) !== null, "silencio vencido => entra");
ok(n.registro(msg("120363999999999999@g.us", { conversation: "x" }, { key: { participant: "5217711111111@s.whatsapp.net" } }), null, ctx()) === null, "la comunidad madre no entra");
r = n.registro(gmsg("lo digo yo", { fromMe: true }), null, ctx());
ok(r && r.yo === true && r.de === "yo" && r.grupo === "120363111111111111", "lo mio en el grupo: yo=true");
r = n.registro(gmsg("hola", { participant: "100000000000001@lid" }), "5215533333333@s.whatsapp.net", ctx());
ok(r && r.de === "+525533333333" && r.lid === "100000000000001", "autor por LID resuelto");
r = n.registro(gmsg("hola", { participant: "100000000000001@lid", participantAlt: "5215522222222@s.whatsapp.net" }), null, ctx());
ok(r && r.de === "+525522222222", "autor por participantAlt");
ok(n.registro(msg("status@broadcast", { conversation: "x" }), null, ctx()) === null, "estados siguen fuera aunque haya contexto");
let v = n.validarEnvio({ grupo: "120363111111111111", texto: "hola" }, {}, ahora, hoy);
ok(v.ok && v.jid === G && v.to === "grupo:120363111111111111", "envio a grupo => jid @g.us");
ok(!n.validarEnvio({ grupo: "../../etc", to: "+527711111111", texto: "hola" }, {}, ahora, hoy).ok, "grupo invalido NO (ni cae al numero)");
ok(!n.validarEnvio({ grupo: "120363111111111111", texto: "hola" }, { dia: hoy, n: 40 }, ahora, hoy).ok, "el tope diario tambien cuenta en grupos");

const YO = { pn: "5215522222222", lid: "999888777666" };
const conCI = (ci) => msg(G, { extendedTextMessage: { text: "oye", contextInfo: ci } }, { key: { participant: "5217711111111@s.whatsapp.net" } });
ok(n.registro(conCI({ mentionedJid: ["5215522222222@s.whatsapp.net"] }), null, ctx({ yo: YO })).menciona === true, "@mencion por numero");
ok(n.registro(conCI({ mentionedJid: ["999888777666@lid"] }), null, ctx({ yo: YO })).menciona === true, "@mencion por LID");
ok(n.registro(conCI({ participant: "5215522222222:3@s.whatsapp.net", stanzaId: "X" }), null, ctx({ yo: YO })).menciona === true, "respuesta a un mensaje mio");
ok(n.registro(conCI({ mentionedJid: ["5210000000000@s.whatsapp.net"] }), null, ctx({ yo: YO })).menciona === false, "mencion a otro NO");
ok(n.registro(gmsg("hola"), null, ctx({ yo: YO })).menciona === false, "sin contexto NO es mencion");
ok(n.registro(conCI({ mentionedJid: ["5215522222222@s.whatsapp.net"] }), null, ctx({ yo: {} })).menciona === false, "sin saber quien soy, nunca mencion");

console.log("== leido: lo que el usuario lee en su telefono (23-oct)");
const T = 1760000000000;
let l = n.leidos("chats.update", [{ id: "5217711111111@s.whatsapp.net", unreadCount: 0 }], T, YO);
ok(l.length === 1 && l[0].jid === "5217711111111@s.whatsapp.net" && l[0].hasta === T, "chats.update unreadCount 0 => leido hasta ahora");
ok(n.leidos("chats.update", [{ id: "5217711111111@s.whatsapp.net", unreadCount: -1 }], T, YO).length === 0, "marcado «no leido» (-1) NO");
ok(n.leidos("chats.update", [{ id: "5217711111111@s.whatsapp.net", unreadCount: null }], T, YO).length === 0, "sync inicial (null) NO");
ok(n.leidos("chats.update", [{ id: "5217711111111@s.whatsapp.net", unreadCount: 3 }], T, YO).length === 0, "mensajes nuevos (3) NO");
ok(n.leidos("chats.update", [{ id: "5217711111111@s.whatsapp.net", muteEndTime: -1 }], T, YO).length === 0, "solo silencio (sin unreadCount) NO");
ok(n.leidos("chats.update", undefined, T, YO).length === 0 && n.leidos("otro.evento", [{ id: "x", unreadCount: 0 }], T, YO).length === 0, "payload raro o evento ajeno => nada");
const recibo = (fromMe, status, t, jid = "5217711111111@s.whatsapp.net") => ({ key: { remoteJid: jid, id: "X", fromMe }, update: { status, messageTimestamp: t } });
l = n.leidos("messages.update", [recibo(false, 4, 1759999990)], T, YO);
ok(l.length === 1 && l[0].hasta === 1759999990000, "recibo de lectura de OTRO aparato mio (directo) => hasta = hora del recibo");
ok(n.leidos("messages.update", [recibo(false, 5, 1759999990)], T, YO).length === 1, "nota de voz escuchada (PLAYED) tambien");
ok(n.leidos("messages.update", [recibo(true, 4, 1759999990)], T, YO).length === 0, "el OTRO leyo lo mio (fromMe) NO");
ok(n.leidos("messages.update", [recibo(false, 3, 1759999990)], T, YO).length === 0, "entregado (3) NO");
ok(n.leidos("messages.update", [{ key: { remoteJid: "5217711111111@s.whatsapp.net", fromMe: false }, update: { message: null } }], T, YO).length === 0, "borrado/editado (sin status) NO");
ok(n.leidos("messages.update", [recibo(false, 4, 1759999990, "status@broadcast")], T, YO).length === 0, "estados NO");
ok(n.leidos("messages.update", [recibo(false, 4, 9999999999)], T, YO)[0].hasta === T, "hasta nunca en el futuro");
const rg = (userJid, extra = {}) => ({ key: { remoteJid: G, id: "Y", fromMe: true }, receipt: { userJid, readTimestamp: 1759999995, ...extra } });
l = n.leidos("message-receipt.update", [rg("5215522222222@s.whatsapp.net")], T, YO);
ok(l.length === 1 && l[0].jid === G && l[0].hasta === 1759999995000, "grupo: lo lei yo (por numero) en otro aparato");
ok(n.leidos("message-receipt.update", [rg("999888777666@lid")], T, YO).length === 1, "grupo: lo lei yo (por LID)");
ok(n.leidos("message-receipt.update", [rg("5210000000000@s.whatsapp.net")], T, YO).length === 0, "grupo: lo leyo OTRO NO");
ok(n.leidos("message-receipt.update", [rg("5215522222222@s.whatsapp.net", { readTimestamp: undefined, receiptTimestamp: 1 })], T, YO).length === 0, "grupo: solo entregado NO");
ok(n.leidos("message-receipt.update", [rg("5215522222222@s.whatsapp.net")], T, {}).length === 0, "sin saber quien soy, nunca");
let rl = n.registroLeido("5217711111111@s.whatsapp.net", T);
ok(rl && rl.tipo === "leido" && rl.canal === "whatsapp" && rl.chat === "+527711111111" && rl.hasta === T && !("texto" in rl), "registro leido: 52/521 como la bandeja, sin texto");
ok(Object.keys(rl).sort().join() === "canal,chat,hasta,tipo,v", "registro leido: solo canal, chat, hasta, tipo, v (sin nombres)");
ok(n.registroLeido("100000000000001@lid", T, "5215533333333@s.whatsapp.net").chat === "+525533333333", "LID por el mapa => el mismo numero que sus mensajes");
ok(n.registroLeido("100000000000001@lid", T).chat === "lid:100000000000001", "LID sin numero => lid:<id> (como deQuien)");
ok(n.registroLeido(G, T).chat === "grupo:120363111111111111", "grupo => grupo:<id>");
ok(n.registroLeido(G, T) !== null && n.grupoEntra(G, ctx({ silencios: { [G]: -1 } })) === false, "grupo silenciado: leerlo TAMBIEN marca (el registro sale igual)");
ok(n.registroLeido("status@broadcast", T) === null && n.registroLeido("120363@newsletter", T) === null && n.registroLeido("1234@broadcast", T) === null, "estados, canales y difusiones: nada");
ok(n.registroLeido("120363123456789012@newsletter", T) === null && n.registroLeido("5217711111111@broadcast", T) === null, "canal/difusion con id largo (parece numero): nada");
ok(n.registroLeido("5217711111111@s.whatsapp.net", 0) === null && n.registroLeido("5217711111111@s.whatsapp.net", "x") === null, "hasta invalido => nada");

console.log(`\n${total - fallos.length}/${total} verdes`);
if (fallos.length) { console.log("ROJO:\n  - " + fallos.join("\n  - ")); process.exit(1); }

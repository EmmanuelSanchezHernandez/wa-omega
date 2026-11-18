#!/bin/bash
# Sabotajes del banco del oido: cada uno rompe una regla en una COPIA y test.mjs tiene que ponerse ROJO.
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
rc=0
sabotaje() {   # $1 nombre  $2 buscar  $3 reemplazar
  cp "$AQUI/nucleo.mjs" "$AQUI/test.mjs" "$T/"
  python3 - "$T/nucleo.mjs" "$2" "$3" <<'PY'
import sys
f, a, b = sys.argv[1:4]
s = open(f).read()
assert s.count(a) == 1, f"no casa: {a}"
open(f, "w").write(s.replace(a, b))
PY
  if (cd "$T" && node test.mjs >/dev/null 2>&1); then echo "NO MUERDE  $1"; rc=1; else echo "MUERDE     $1"; fi
}
sabotaje "acepta-cualquier-chat" 'if (!j || j === "status@broadcast") return false;' 'return Boolean(j);'
sabotaje "sin-tope-diario" 'if (n >= TOPE_DIA)' 'if (false)'
sabotaje "sin-intervalo" 'ahoraMs - estado.ultimo < INTERVALO_MS' 'false'
sabotaje "guarda-reacciones" 'if (m.reactionMessage) return null;' 'if (m.reactionMessage) return "[reaccion]";'
sabotaje "lid-se-pierde" 'return n ? { de: n,' 'return false ? { de: n,'
sabotaje "mx-sin-521" 'return d.startsWith("52") && d.length === 12 ?' 'return false ?'
sabotaje "mx-52-primero" '["521" + d.slice(2) + "@s.whatsapp.net", base]' '[base, "521" + d.slice(2) + "@s.whatsapp.net"]'
sabotaje "grupos-sin-esperar-silencios" 'if (!id || !ctx?.silenciosListos) return false;' 'if (!id) return false;'
sabotaje "ignora-silencio" 'if (silenciado(ctx.silencios?.[jid], ctx.ahora ?? Date.now())) return false;' ''
sabotaje "silencio-para-siempre-no" 'if (n < 0) return true;' 'if (n < 0) return false;'
sabotaje "comunidad-madre-entra" 'if (ctx.grupos?.[id]?.es_comunidad) return false;' ''
sabotaje "grupo-cualquier-id" 'if (peticion?.grupo != null && !grupo) return { ok: false, motivo: "grupo invalido" };' ''
sabotaje "mencion-a-cualquiera" 'if (ids.some((x) => mias.has(x))) return true;' 'if (ids.length) return true;'
# 23-oct: «leido»
sabotaje "leido-cuenta-no-leido" 'if (u?.id && u.unreadCount === 0)' 'if (u?.id && u.unreadCount != null)'
sabotaje "leido-recibo-del-otro" 'k.fromMe === false && st >= ESTADO_LEIDO' 'st >= ESTADO_LEIDO'
sabotaje "leido-entregado-cuenta" 'export const ESTADO_LEIDO = 4;' 'export const ESTADO_LEIDO = 3;'
sabotaje "leido-grupo-de-otro" 'if (idGrupo(u?.key?.remoteJid) && quien && mias.has(quien) && r.readTimestamp)' 'if (idGrupo(u?.key?.remoteJid) && quien && r.readTimestamp)'
sabotaje "leido-hasta-futuro" 'return Math.min(n, ahoraMs);' 'return n;'
sabotaje "leido-lid-sin-mapa" 'return deQuien(jid, null, pnDeLid).de || null;' 'return deQuien(jid, null, null).de || null;'
sabotaje "leido-sin-quitar-521" 'return deQuien(jid, null, pnDeLid).de || null;' 'return String(jid).split("@")[0] || null;'
sabotaje "leido-estados-entran" 'if (!esDirecto(jid)) return null;' ''
sabotaje "leido-lleva-texto" 'return { v: 2, canal: "whatsapp", tipo: "leido", chat, hasta: h };' 'return { v: 2, canal: "whatsapp", tipo: "leido", chat, hasta: h, texto: "" };'
exit $rc

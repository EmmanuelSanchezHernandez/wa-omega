#!/bin/bash
# Aplicador del oido de Omega (21-oct-2026). Lo corre el USUARIO:   ! bash /srv/wa-omega/aplicar-oido.sh
# Crea el usuario de sistema `waomega`, sus carpetas, la unidad systemd `wa-omega.service` (endurecida) y el
# ayudante /usr/local/bin/wa-omega. NO arranca el servicio: eso lo hace `wa-omega vincular` tras el QR.
# Marcha atras: systemctl disable --now wa-omega; rm /etc/systemd/system/wa-omega.service /usr/local/bin/wa-omega;
#               systemctl daemon-reload; userdel waomega; (la sesion en /var/lib/wa-omega/auth se borra a mano).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "hay que ser root"; exit 2; }
cd /srv/wa-omega
node test.mjs >/dev/null || { echo "el banco del oido esta ROJO: no instalo"; exit 1; }
bash sabotear.sh >/dev/null || { echo "un sabotaje del oido no muerde: no instalo"; exit 1; }

id waomega >/dev/null 2>&1 || useradd --system --home-dir /var/lib/wa-omega --no-create-home --shell /usr/sbin/nologin waomega
install -d -m 700 -o waomega -g waomega /var/lib/wa-omega /var/lib/wa-omega/auth /var/lib/wa-omega/entrante
chown -R root:root /srv/wa-omega
chmod 755 /srv/wa-omega
install -m 755 /srv/wa-omega/wa-omega /usr/local/bin/wa-omega

cat > /etc/systemd/system/wa-omega.service <<'EOF'
[Unit]
Description=Oido de Omega: WhatsApp (dispositivo vinculado) sin el agente
After=network-online.target
Wants=network-online.target

[Service]
User=waomega
Group=waomega
Environment=WA_OMEGA_ESTADO=/var/lib/wa-omega
Environment=WA_OMEGA_SOCKET=/run/wa-omega/envio.sock
ExecStart=/usr/bin/node /srv/wa-omega/oido.mjs
RuntimeDirectory=wa-omega
RuntimeDirectoryMode=0750
Restart=on-failure
RestartSec=10
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/wa-omega
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/wa-omega.service 2>&1 | grep -v -i -E "dbus|snap" || true
echo "--- listo ---"
id waomega
ls -ld /var/lib/wa-omega /var/lib/wa-omega/auth /var/lib/wa-omega/entrante
echo "Siguiente: en una terminal REAL (SSH o Specter):  wa-omega vincular   (QR con tu telefono)"

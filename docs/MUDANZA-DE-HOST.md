# Mudar el despliegue a otro host

El origen se puede mover sin tocar el dominio. Los `CNAME` de
`emergenciacolombia.org` apuntan al **UUID del túnel**, no a una IP: basta con
correr `cloudflared` en la máquina nueva con las mismas credenciales y apagarlo
en la vieja. No hay propagación de DNS ni ventana de corte que esperar.

## 0. Antes que nada: rescatar la base de datos

Esto es lo único irrecuperable. El catálogo se puede volver a ingerir de las
fuentes, pero el **historial de observaciones no**: es el registro de qué dijo
cada fuente y cuándo, y es la razón de ser del proyecto (invariante 2).

Con SSH al host viejo:

```bash
ssh root@$VIEJO 'docker exec ayuda-terremoto-db pg_dump -U ayuda -Fc ayuda > /root/ayuda.dump'
scp root@$VIEJO:/root/ayuda.dump .
```

Guardalo fuera de esa máquina antes de seguir. Si ya perdiste el acceso por
SSH, esto es lo que no vas a poder recuperar: sacá el volcado **ahora**, no
cuando haga falta mudarse.

## 1. Preparar el host nuevo

Una máquina Debian con Docker. Después:

```bash
tailscale up          # para tener acceso
```

Anotá su IP de Tailscale: es el nuevo `DEPLOY_HOST`.

### Comprobar la red ANTES de instalar nada

El host anterior se perdió porque su ISP descartaba tráfico TCP/443 hacia
destinos concretos —Docker Hub, GitHub, el registry— mientras otros
funcionaban. No es un fallo que se note hasta que se intenta desplegar, así que
conviene descartarlo en dos minutos:

```bash
for h in registry-1.docker.io registry.digitalocean.com github.com deb.debian.org; do
  printf "%-28s %s\n" "$h" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://$h/ || echo FALLA)"
done
```

Los cuatro tienen que responder algo (`200`, `401`, `301`… cualquier cosa menos
timeout). Si alguno falla, el problema es la red de esa casa, no el servidor, y
el despliegue va a fallar igual que en el anterior.

## 2. Apuntar Kamal al host nuevo

Una sola línea en `.env`:

```
DEPLOY_HOST=<nueva IP de Tailscale>
```

Y desplegar. Recordá que Kamal **no lee `.env`**:

```bash
set -a && source .env && set +a && kamal setup
```

`setup` instala Docker si falta, arranca Postgres como accesorio y levanta la
app. Las siguientes veces es `kamal deploy`.

## 3. Restaurar la base

```bash
scp ayuda.dump root@$DEPLOY_HOST:/tmp/
ssh root@$DEPLOY_HOST 'docker cp /tmp/ayuda.dump ayuda-terremoto-db:/tmp/ && \
  docker exec ayuda-terremoto-db pg_restore -U ayuda -d ayuda --clean --if-exists /tmp/ayuda.dump'
```

## 4. Mudar el túnel

Copiar los dos archivos desde la máquina vieja (son secretos: se copian
directamente entre hosts, no se pegan en ningún lado):

```bash
scp root@$VIEJO:/etc/cloudflared/config.yml           /tmp/
scp root@$VIEJO:/etc/cloudflared/9f3be574-*.json      /tmp/
scp /tmp/config.yml /tmp/9f3be574-*.json root@$DEPLOY_HOST:/etc/cloudflared/
```

Si no hay acceso a la vieja, se regeneran en la nueva con `cloudflared tunnel
login` y `cloudflared tunnel token --cred-file …`; la configuración completa
está en `DOMINIO-CLOUDFLARE.md`.

Instalar y arrancar:

```bash
cloudflared service install
systemctl enable --now cloudflared
```

Apagar el de la máquina vieja para que no queden dos orígenes sirviendo:

```bash
ssh root@$VIEJO 'systemctl disable --now cloudflared'
```

Comprobar que el dominio sigue respondiendo y que las rutas de operación siguen
ocultas:

```bash
for p in / /fuentes /salud /api/ingest; do
  printf "%-14s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://emergenciacolombia.org$p)"
done
# esperado: 200  200  404  404
```

## 5. Reponer los cron

Viven en el servidor, no en el repositorio, así que una mudanza se los lleva.

El de **ingesta** es el importante: sin él el catálogo no se actualiza, que es
lo único que hace útil al sitio. Se perdió en la máquina anterior.

El de **reporte de consumo** es `/etc/cron.d/ayuda-reporte`, y llama a
`/usr/local/bin/ayuda-reporte`, que saca el secreto del propio contenedor para
no guardarlo en dos sitios:

```
0 * * * * root /usr/local/bin/ayuda-reporte
```

Cada hora en punto. El reporte trae "hoy", "últimos 7 días" y el acumulado;
"hoy" se agrega por día de Bogotá, así que los reportes de la madrugada
muestran un día que recién empieza —no es un error, es el día real—. Sin
`DISCORD_WEBHOOK_URL` no envía nada y tampoco falla.

## Notas sobre `cloudflared` en redes con problemas

En el host anterior hicieron falta dos ajustes que quizá no necesites, pero que
conviene conocer porque el síntoma —el conector no registra nunca— no dice cuál
es la causa:

- `edge-ip-version: "4"` si el host no tiene ruta IPv6.
- `protocol: http2` si QUIC (UDP/7844) no sale de esa red.

`journalctl -u cloudflared | grep precheck` dice exactamente qué región y qué
protocolo funcionan.

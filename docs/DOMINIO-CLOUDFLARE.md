# Dominio y Cloudflare Tunnel

`emergenciacolombia.org` → Cloudflare → túnel → el servidor.

El servidor **no tiene IP pública** y no hace falta que la tenga: `cloudflared`
abre una conexión *saliente* hacia Cloudflare y el tráfico entra por ahí. No se
abre ningún puerto, no se toca el router, y el origen sigue siendo alcanzable
solo por Tailscale.

## Qué queda público y qué no

Público: **solo el bot**. `/`, `/fuentes`, `/r/[id]` y los estáticos.

No público: `/salud` y `/api/*`. Están bloqueados en **dos capas a propósito**:

1. En las reglas de ingress del túnel (abajo).
2. En el middleware de la app: una petición que llega con la cabecera
   `CF-Connecting-IP` viene de internet, y para esas rutas responde `404` — no
   "prohibido", **no existe**. Ver `src/middleware.ts`.

La duplicación es deliberada. Alguien va a editar una de las dos sin saber de
la otra, y ese día el sitio no debe quedar expuesto.

Los llamadores internos —el healthcheck del contenedor, kamal-proxy, el cron de
la máquina— no pasan por Cloudflare, así que siguen funcionando.

## 1. Instalar cloudflared en el servidor

```bash
ssh root@$DEPLOY_HOST
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  -o /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
  > /etc/apt/sources.list.d/cloudflared.list
apt-get update && apt-get install -y cloudflared
```

## 2. Autenticar y crear el túnel

Este paso pide tu cuenta de Cloudflare y **lo tenés que correr vos**: abre un
navegador para que autorices el dominio.

```bash
cloudflared tunnel login
cloudflared tunnel create emergencia-colombia
```

El segundo comando imprime un **UUID** y deja las credenciales en
`/root/.cloudflared/<UUID>.json`. Ese archivo es un secreto: no se commitea, no
se comparte, no se pega en un chat.

## 3. Configuración

`/etc/cloudflared/config.yml` — reemplazá `<UUID>`:

```yaml
tunnel: <UUID>
credentials-file: /etc/cloudflared/<UUID>.json

# Este host no tiene ruta IPv6: sin esto, cloudflared espera timeouts.
edge-ip-version: "4"

# QUIC (UDP/7844) no sale desde esta red y `region2.v2.argotunnel.com` es
# inalcanzable; `region1` sí responde por TCP/443. Forzar http2 evita que el
# conector se quede reintentando contra una región que nunca contesta.
# Comprobalo con: journalctl -u cloudflared | grep precheck
protocol: http2

# Se evalúan en orden y gana la primera que coincide, así que el bloqueo va
# antes que el pase general.
ingress:
  # Superficies de operación: desde internet no existen.
  - hostname: emergenciacolombia.org
    path: ^/(api|salud)(/|$)
    service: http_status:404
  - hostname: www.emergenciacolombia.org
    path: ^/(api|salud)(/|$)
    service: http_status:404

  # El bot.
  - hostname: emergenciacolombia.org
    service: http://localhost:80
  - hostname: www.emergenciacolombia.org
    service: http://localhost:80

  # Cualquier otro Host que llegue al túnel.
  - service: http_status:404
```

Validar antes de arrancar:

```bash
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://emergenciacolombia.org/salud   # -> 404
cloudflared tunnel ingress rule https://emergenciacolombia.org/        # -> localhost:80
```

### Si el conector no registra

`journalctl -u cloudflared | grep precheck` imprime el veredicto de cloudflared
sobre cada región. En este servidor da:

```
UDP  QUIC              region2  FAIL
TCP  HTTP/2 correcto   region1  PASS
TCP  HTTP/2 bloqueado  region2  FAIL
```

Con `protocol: http2` registra contra region1 (`bog01`) y funciona. Dos de las
cuatro conexiones de alta disponibilidad seguirán fallando contra region2; es
ruido en el log, no una caída.

## 4. DNS

```bash
cloudflared tunnel route dns emergencia-colombia emergenciacolombia.org
cloudflared tunnel route dns emergencia-colombia www.emergenciacolombia.org
```

Crea registros `CNAME` proxied (nube naranja) hacia `<UUID>.cfargotunnel.com`.
No hace falta una `A` a ninguna IP.

## 5. Arrancar como servicio

```bash
cloudflared service install
systemctl enable --now cloudflared
systemctl status cloudflared --no-pager
```

## 6. Comprobar

```bash
curl -sI https://emergenciacolombia.org/            | head -1   # 200
curl -sI https://emergenciacolombia.org/fuentes     | head -1   # 200
curl -sI https://emergenciacolombia.org/salud       | head -1   # 404
curl -sI https://emergenciacolombia.org/api/ingest  | head -1   # 404
```

Y que la IP real del visitante esté llegando —de esto depende que el límite de
uso discrimine entre personas y no meta a todo el mundo en el mismo cubo:

```bash
curl -s https://emergenciacolombia.org/ -o /dev/null -w '%{http_code}\n'
ssh root@$DEPLOY_HOST 'docker logs --tail 20 $(docker ps --format "{{.Names}}" | grep -m1 web)'
```

## 7. Ajustes en el panel de Cloudflare

- **SSL/TLS → Full**. No "Flexible": el túnel ya va cifrado y Flexible haría
  que Cloudflare hable HTTP con el origen sin necesidad.
- **Always Use HTTPS**: activado.
- **Security → WAF → Rate limiting**: una regla de, por ejemplo, 100 req/min
  por IP sobre `/`. El limitador de la app protege el presupuesto de
  inferencia; esta regla protege al servidor de que el tráfico siquiera llegue.
  Son capas distintas y hacen falta las dos.
- **Bot Fight Mode**: dejalo **apagado**. Mete desafíos de JavaScript que
  rompen a quien entra desde un navegador viejo o una conexión mala, que es
  exactamente el público de esto.
- **Caching**: no cachear HTML. Las respuestas dependen del catálogo y del
  momento; servir HTML cacheado es publicar "abierto" de un lugar que ya cerró,
  que es justo lo que este proyecto existe para evitar. Los estáticos de
  `/_next/static/` sí, ya vienen con hash en el nombre.

## Sobre indexación

`src/app/layout.tsx` declara `robots: { index: false, follow: false }`. Tuvo
sentido mientras el sitio vivía en una IP de Tailscale. Con dominio propio es
una decisión de producto: sin indexar, a esto solo llega quien reciba el enlace.

## Deshacer

```bash
systemctl disable --now cloudflared
cloudflared tunnel delete emergencia-colombia
```

Los registros DNS se borran desde el panel. El origen vuelve a ser alcanzable
solo por Tailscale, que es como estaba.

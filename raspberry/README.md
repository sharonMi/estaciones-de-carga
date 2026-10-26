# Integración local: Grafana + InfluxDB (Raspberry Pi)

La página de monitoreo y el dashboard consultan primero la Raspberry Pi y, si no
responde en 3 s, usan ThingSpeak como respaldo. Al fallar, la red local se vuelve a
intentar cada minuto. Firebase (sesión, reservas, vehículos) no cambia.

```
ESP32 (PZEM-004T) ──MQTT──► Python (Raspberry) ──► InfluxDB :8086 ──► Grafana :3000
        │                                                │                │
        └──────────► ThingSpeak (respaldo) ◄─────────────┼────────────────┤
                                                          ▼                ▼
                                          App.fetchReading()     iframes /d-solo/
```

La configuración está en `app.js` → `App.LOCAL` y `App.STATIONS` (`grafanaUid`, `grafanaSlug`).

## 1. Cómo abrir la aplicación

Por ahora solo funciona dentro de la red local (sin dominio):

- Abrir la app por **http**, desde un equipo conectado a la misma red WiFi que la Raspberry.
  Una página https no puede consultar `http://192.168.x.x` (contenido mixto): en Firebase
  Hosting la app funciona, pero siempre con el respaldo de ThingSpeak.
- Servidor de desarrollo: `python3 -m http.server 8080` y abrir `http://localhost:8080`.
- Si se sirve desde otra IP (por ejemplo `http://192.168.1.213:8080`), agregar esa IP en
  Firebase Console → Authentication → Settings → **Authorized domains**; si no, el inicio
  de sesión de Firebase se bloquea.

## 2. Grafana (`/etc/grafana/grafana.ini`)

```ini
[server]
http_port = 3000

[security]
# Permite insertar paneles en la app (iframes)
allow_embedding = true

[auth.anonymous]
# Solo lectura y solo dentro de la red local; no exponer este puerto a internet
enabled = true
org_name = Main Org.
org_role = Viewer

[date_formats]
default_timezone = America/Mexico_City
```

Después: `sudo systemctl restart grafana-server`.

Los paneles deben tener estos IDs en el dashboard de cada estación (o ajustar
`grafanaPanel` en `monitoreo.html`):

| Panel | ID |
|---|---|
| Corriente | 1 |
| Potencia | 2 |
| Energía | 3 |
| Factor de potencia | 4 |

## 3. InfluxDB 1.x

La app consulta:

```sql
SELECT * FROM "lecturas_esp32" WHERE "id" = '<estación>' ORDER BY time DESC LIMIT 1
```

Requisitos del script de Python que escribe los datos:

- measurement `lecturas_esp32`, tag `id` = número de estación;
- campos `corriente`, `potencia`, `energia`, `factor_potencia`;
- **recomendado:** agregar `voltaje` y `frecuencia` (hoy no se envían; la app muestra «—»);
- usar la marca de tiempo **UTC** de la medición (la del ESP32 sincronizado por NTP, ver
  `esp32/ntp_timestamp.ino`), no la hora de llegada, para que la validación de
  sincronización temporal sea confiable.

InfluxDB 1.x responde con cabeceras CORS por defecto, así que el navegador puede
consultarlo directamente. Mantener `auth-enabled = false` solo mientras el puerto 8086
no sea accesible desde fuera de la red local.

## 4. IP fija de la Raspberry

Reservar `192.168.1.213` para la Raspberry en el DHCP del router. Si cambia, actualizar
`App.LOCAL.grafanaUrl` y `App.LOCAL.influxUrl`.

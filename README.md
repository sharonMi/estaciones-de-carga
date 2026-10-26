# SIMCE — Estaciones de carga EvoBike (IT Celaya)

Aplicación web para reservar y monitorear las estaciones de carga de vehículos eléctricos.

| Parte | Tecnología |
|---|---|
| Inicio de sesión, reservas y vehículos | Firebase Authentication + Firestore |
| Monitoreo (fuente principal, solo red local) | Grafana + InfluxDB en la Raspberry Pi |
| Monitoreo (respaldo) | ThingSpeak |
| Medición | ESP32 + PZEM-004T |

```
ESP32 (PZEM-004T) ──MQTT──► Python (Raspberry) ──► InfluxDB :8086 ──► Grafana :3000
        │                                                │                │
        └──────────► ThingSpeak (respaldo)               ▼                ▼
                                                 lectura actual     gráficas (iframes)
                                                        └──── aplicación web ────┘
```

La app consulta primero la Raspberry Pi. Si no responde en 3 s, usa ThingSpeak y vuelve a
intentar con la Raspberry cada minuto. La página de monitoreo indica qué fuente está usando.

---

## Iniciar la app en la Raspberry Pi con Grafana

En esta modalidad la Raspberry Pi tiene todo: InfluxDB, Grafana y la aplicación web. Los
usuarios la abren desde cualquier equipo conectado a la misma red WiFi.

### Datos de la Raspberry Pi

| Dato | Valor |
|---|---|
| IP en la red local | `192.168.1.213` (reservarla en el router) |
| Aplicación web | `http://192.168.1.213:8080` |
| Grafana | `http://192.168.1.213:3000` |
| InfluxDB 1.x | `http://192.168.1.213:8086` |
| Base de datos | `sensores_db` |
| Measurement | `lecturas_esp32` (tag `id` = número de estación) |
| Campos | `corriente`, `potencia`, `energia`, `factor_potencia` (+ `voltaje`, `frecuencia` recomendados) |

Dashboards de Grafana por estación (`App.STATIONS` en `app.js`):

| Estación | UID | Slug |
|---|---|---|
| 1 | `adq7b5k` | `pzem004t-id23-1` |
| 2 | `gigwssj` | `pzem004t-id23-2` |
| 3 | `giqt444` | `pzem004t-id23-3` |

En cada dashboard, los paneles deben tener estos IDs: **1** corriente, **2** potencia,
**3** energía y **4** factor de potencia.

### 1. Verificar que la Raspberry ya recibe datos

Desde la Raspberry (o cualquier equipo de la red):

```bash
# InfluxDB está activo (responde 204)
curl -i http://192.168.1.213:8086/ping

# Última lectura de la estación 1
curl -G http://192.168.1.213:8086/query \
  --data-urlencode "db=sensores_db" \
  --data-urlencode "q=SELECT * FROM \"lecturas_esp32\" WHERE \"id\" = '1' ORDER BY time DESC LIMIT 1"

# Grafana está activo
curl http://192.168.1.213:3000/api/health
```

Si la consulta no devuelve `series`, revisar que el script de Python esté escribiendo en
InfluxDB antes de continuar.

### 2. Configurar Grafana para mostrarse dentro de la app

En `/etc/grafana/grafana.ini`:

```ini
[security]
allow_embedding = true

[auth.anonymous]
enabled = true
org_name = Main Org.
org_role = Viewer

[date_formats]
default_timezone = America/Mexico_City
```

```bash
sudo systemctl restart grafana-server
```

El acceso anónimo es solo de lectura. No hay que exponer los puertos 3000, 8086 ni 8080
fuera de la red local.

### 3. Descargar la aplicación en la Raspberry

El repositorio es privado, así que la Raspberry necesita autenticarse con GitHub una vez:

```bash
sudo apt install -y git gh
gh auth login            # elegir GitHub.com → HTTPS → iniciar sesión en el navegador
cd /home/pi
gh repo clone sharonMi/estaciones-de-carga
```

Si la Raspberry cambió de IP, actualizar `App.LOCAL` en `app.js`:

```js
LOCAL: {
    grafanaUrl:  'http://192.168.1.213:3000',
    influxUrl:   'http://192.168.1.213:8086',
    influxDb:    'sensores_db',
    measurement: 'lecturas_esp32',
    ...
}
```

### 4. Dejar la aplicación corriendo como servicio

```bash
# Ajustar User y WorkingDirectory en el archivo si el usuario no es "pi"
sudo cp /home/pi/estaciones-de-carga/raspberry/simce-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now simce-web
systemctl status simce-web
```

Con esto, la app arranca sola cada vez que se enciende la Raspberry.

### 5. Autorizar la IP en Firebase (una sola vez)

Firebase solo permite iniciar sesión desde direcciones autorizadas. `localhost` ya lo está,
pero `192.168.1.213` no:

**Firebase Console → Authentication → Settings → Authorized domains → Add domain →
`192.168.1.213`**

Sin este paso, la página carga pero el inicio de sesión con Google falla.

### 6. Probar

1. Desde un equipo en la misma red WiFi, abrir `http://192.168.1.213:8080`.
2. Iniciar sesión e ir a **Monitoreo**.
3. El aviso superior debe decir **«Fuente: Grafana + InfluxDB en la Raspberry Pi (red
   local)»** y las gráficas deben tener la etiqueta **Grafana**.
4. Si dice **«Usando respaldo ThingSpeak»**, el mensaje explica el motivo (la Raspberry no
   respondió, no hay lecturas de esa estación, etc.).

### Actualizar la app en la Raspberry

```bash
cd /home/pi/estaciones-de-carga
git pull
```

No hace falta reiniciar el servicio: los cambios se ven al recargar la página.

### Limitaciones de la modalidad local

- Solo funciona dentro de la red WiFi de la Raspberry.
- Hay que abrir la app por **http**. Desde una página https, como Firebase Hosting, el
  navegador bloquea las consultas a la Raspberry y siempre se usa ThingSpeak.
- Para usarla desde fuera de la red se necesita un dominio y un túnel fijo (pendiente).

Más detalles de configuración de Grafana e InfluxDB en [`raspberry/README.md`](raspberry/README.md).

---

## Desarrollo en tu propio equipo

```bash
python3 -m http.server 8080
# abrir http://localhost:8080
```

Si el equipo está en la misma red que la Raspberry, se usan sus datos. Si no, se usa
ThingSpeak.

## Firebase

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules   # reglas de seguridad (firestore.rules)
firebase deploy --only hosting           # publicar en Firebase Hosting (usa ThingSpeak)
```

Edita siempre `firestore.rules` en el repositorio y despliega desde aquí. Si se modifican en
la consola, el repositorio queda desactualizado.

## Estructura

| Ruta | Contenido |
|---|---|
| `index.html`, `reservar.html`, `historial.html`, `monitoreo.html` | Páginas de las estaciones de carga |
| `app.js` | Lógica compartida: Firebase, fuentes de monitoreo, sincronización temporal y estimación de carga |
| `firestore.rules` | Reglas de seguridad de Firestore |
| `raspberry/` | Configuración de Grafana/InfluxDB y servicio de systemd |
| `esp32/` | Fragmento de sincronización NTP para el ESP32 |
| `variables*.html`, `SetPoint*.html`, `Invernadero.html` | Páginas del invernadero |

## Versiones

- `v2-thingspeak`: última versión con ThingSpeak como única fuente (`git checkout v2-thingspeak`).
- `main`: Grafana + InfluxDB en red local con respaldo de ThingSpeak.

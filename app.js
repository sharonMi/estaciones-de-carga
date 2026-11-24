const App = {
    STATIONS: [
        { id: 1, channel: '3360039', apiKey: 'MMUHRVIAOTKL8QHQ' },
        { id: 2, channel: '3372390', apiKey: 'UQYT8WT4I9PS085D' },
        { id: 3, channel: '3407943', apiKey: 'SVABK6Q2I4RN2QX4' }
    ],

    getStationConfig(stationId) {
        return this.STATIONS.find(function(s) { return s.id === stationId; });
    },

    tsFeedUrl(stationId) {
        var cfg = this.getStationConfig(stationId);
        return 'https://api.thingspeak.com/channels/' + cfg.channel + '/feeds/last.json?api_key=' + cfg.apiKey;
    },

    tsChartUrl(stationId, field, color, title, yaxis) {
        var cfg = this.getStationConfig(stationId);
        return 'https://thingspeak.com/channels/' + cfg.channel + '/charts/' + field +
            '?bgcolor=%23ffffff&color=%23' + color + '&dynamic=true&results=60&title=' + encodeURIComponent(title) +
            '&type=line&xaxis=Tiempo&yaxis=' + encodeURIComponent(yaxis) + '&api_key=' + cfg.apiKey;
    },

    // ---------- Grafana (gráficas incrustadas, con respaldo en ThingSpeak) ----------
    // `stations[n].uid` y `slug` salen de la URL del dashboard: /d/<uid>/<slug>.
    // `panels` relaciona el campo de ThingSpeak (field) con el panelId de Grafana.
    // Una gráfica sin panel en Grafana (voltaje y frecuencia, por ahora) se queda en ThingSpeak.
    // Para añadirla después, agrega su panelId aquí (p. ej. 1: 5) y listo.
    GRAFANA: {
        baseUrl: 'https://pi.tail300962.ts.net',
        orgId: 1,
        theme: 'light',
        refresh: '5s',
        from: 'now-2m',
        to: 'now',
        probeTimeoutMs: 4000,
        stations: {
            1: { uid: 'adq7b5k', slug: 'pzem004t-id23-1', panels: { 2: 1, 3: 2, 4: 3, 6: 4 } },
            2: { uid: 'gigwssj', slug: 'pzem004t-id23-2', panels: { 2: 1, 3: 2, 4: 3, 6: 4 } },
            3: { uid: 'giqt444', slug: 'pzem004t-id23-3', panels: { 2: 1, 3: 2, 4: 3, 6: 4 } }
        }
    },
    grafanaAvailable: false,

    grafanaConfigured(stationId, field) {
        var st = this.GRAFANA.stations[stationId];
        return !!(st && st.uid && st.panels && st.panels[field]);
    },

    grafanaChartUrl(stationId, field) {
        var g = this.GRAFANA, st = g.stations[stationId];
        return g.baseUrl + '/d-solo/' + encodeURIComponent(st.uid) + '/' + encodeURIComponent(st.slug || 'estacion') +
            '?orgId=' + g.orgId + '&panelId=' + st.panels[field] +
            '&theme=' + g.theme + '&refresh=' + g.refresh +
            '&from=' + encodeURIComponent(g.from) + '&to=' + encodeURIComponent(g.to);
    },

    // Comprueba si el servidor de Grafana responde desde ESTE navegador (en una red Tailscale
    // solo responde a equipos de la tailnet). Con no-cors la respuesta es opaca, pero basta para
    // saber si hubo conexión; un fallo de red o el tiempo agotado cuentan como "no disponible".
    probeGrafana() {
        var self = this;
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function() { ctrl.abort(); }, this.GRAFANA.probeTimeoutMs) : null;
        return fetch(this.GRAFANA.baseUrl + '/api/health', { mode: 'no-cors', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
            .then(function() { self.grafanaAvailable = true; return true; })
            .catch(function() { self.grafanaAvailable = false; return false; })
            .then(function(ok) { if (timer) clearTimeout(timer); return ok; });
    },

    // Elige la fuente de la gráfica: Grafana si responde y está configurada; si no, ThingSpeak.
    chartSource(stationId, field) {
        return (this.grafanaAvailable && this.grafanaConfigured(stationId, field)) ? 'grafana' : 'thingspeak';
    },

    chartUrl(stationId, field, color, title, yaxis) {
        return this.chartSource(stationId, field) === 'grafana'
            ? this.grafanaChartUrl(stationId, field)
            : this.tsChartUrl(stationId, field, color, title, yaxis);
    },

    logout() {
        fbAuth.signOut().then(function() {
            window.location.href = 'login.html';
        });
    },

    initUI(activePage) {
        var self = this;
        return new Promise(function(resolve) {
            fbAuth.onAuthStateChanged(function(user) {
                if (!user) {
                    window.location.href = 'login.html';
                    resolve(false);
                    return;
                }

                var displayName = user.displayName || user.email;

                var userEl = document.querySelector('.user-info strong');
                if (userEl) userEl.textContent = displayName;

                var avatarEl = document.querySelector('.avatar');
                if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();

                document.querySelectorAll('.sidebar-nav a').forEach(function(a) {
                    if (a.getAttribute('data-page') === activePage) a.classList.add('active');
                });

                var dateEl = document.querySelector('.date-display');
                if (dateEl) {
                    dateEl.textContent = new Date().toLocaleDateString('es-MX', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                    });
                }

                document.querySelector('.logout-btn')?.addEventListener('click', function() {
                    self.logout();
                });

                var toggle  = document.querySelector('.menu-toggle');
                var sidebar = document.querySelector('.sidebar');
                var overlay = document.querySelector('.overlay');
                if (toggle && sidebar) {
                    toggle.addEventListener('click', function() {
                        sidebar.classList.toggle('open');
                        overlay?.classList.toggle('active');
                    });
                    overlay?.addEventListener('click', function() {
                        sidebar.classList.remove('open');
                        overlay.classList.remove('active');
                    });
                }

                self.initMockData();
                resolve(true);
            });
        });
    },

    initMockData() {
        if (!localStorage.getItem('ev_stations')) {
            localStorage.setItem('ev_stations', JSON.stringify([
                { id: 1, name: 'Estación 1', status: 'available', vehicle: null, pzem: { voltage: 0, current: 0, power: 0, energy: 0, frequency: 0, pf: 0 } },
                { id: 2, name: 'Estación 2', status: 'available', vehicle: null, pzem: { voltage: 0, current: 0, power: 0, energy: 0, frequency: 0, pf: 0 } },
                { id: 3, name: 'Estación 3', status: 'available', vehicle: null, pzem: { voltage: 0, current: 0, power: 0, energy: 0, frequency: 0, pf: 0 } }
            ]));
        }
        if (!localStorage.getItem('ev_history')) {
            localStorage.setItem('ev_history', JSON.stringify([
                { id: 'h1', stationId: 1, date: '2026-09-16', startTime: '08:00', endTime: '09:30', vehicleBrand: 'NIU NQi GT',        energyConsumed: 2.1, user: 'juan.p',   peakPower: 1450 },
                { id: 'h2', stationId: 2, date: '2026-09-16', startTime: '10:00', endTime: '11:00', vehicleBrand: 'Xiaomi Pro 2',       energyConsumed: 0.4, user: 'maria.g',  peakPower: 490  },
                { id: 'h3', stationId: 3, date: '2026-09-15', startTime: '14:00', endTime: '15:00', vehicleBrand: 'Segway Ninebot Max', energyConsumed: 0.5, user: 'pedro.s',  peakPower: 500  },
                { id: 'h4', stationId: 1, date: '2026-09-15', startTime: '07:00', endTime: '09:00', vehicleBrand: 'Italika Voltium',    energyConsumed: 2.3, user: 'lucia.m',  peakPower: 1400 },
                { id: 'h5', stationId: 3, date: '2026-09-14', startTime: '16:00', endTime: '18:00', vehicleBrand: 'Super Soco TC',      energyConsumed: 2.8, user: 'carlos.m', peakPower: 1500 },
                { id: 'h6', stationId: 2, date: '2026-09-13', startTime: '09:00', endTime: '10:00', vehicleBrand: 'Dualtron Thunder',   energyConsumed: 0.6, user: 'ana.r',    peakPower: 520  },
                { id: 'h7', stationId: 3, date: '2026-09-13', startTime: '11:00', endTime: '12:30', vehicleBrand: 'Vespa Elettrica',    energyConsumed: 3.2, user: 'juan.p',   peakPower: 1480 }
            ]));
        }
    },

    getStations() { return JSON.parse(localStorage.getItem('ev_stations') || '[]'); },
    getHistory()  { return JSON.parse(localStorage.getItem('ev_history')  || '[]'); },

    // --- Firestore: Reservaciones ---

    addReservationAsync(r) {
        var user = fbAuth.currentUser;
        r.id_usuario     = user.uid;
        r.email_usuario  = user.email;
        r.nombre_usuario = user.displayName || user.email;
        r.estado         = 'pendiente';
        r.fecha_creacion = firebase.firestore.FieldValue.serverTimestamp();
        return fbDb.collection('reservas').add(r);
    },

    getReservationsAsync() {
        var user = fbAuth.currentUser;
        return fbDb.collection('reservas')
            .where('id_usuario', '==', user.uid)
            .get()
            .then(function(snapshot) {
                var docs = snapshot.docs.map(function(doc) {
                    return Object.assign({ id: doc.id }, doc.data());
                });
                return docs
                    .filter(function(r) { return r.estado === 'pendiente'; })
                    .sort(function(a, b) {
                        var ta = a.fecha_creacion ? a.fecha_creacion.seconds : 0;
                        var tb = b.fecha_creacion ? b.fecha_creacion.seconds : 0;
                        return tb - ta;
                    });
            });
    },

    cancelReservationAsync(id) {
        return fbDb.collection('reservas').doc(id).update({ estado: 'cancelada' });
    },

    getAllReservationsAsync() {
        var user = fbAuth.currentUser;
        return fbDb.collection('reservas')
            .where('id_usuario', '==', user.uid)
            .get()
            .then(function(snapshot) {
                return snapshot.docs.map(function(doc) {
                    return Object.assign({ id: doc.id }, doc.data());
                }).sort(function(a, b) {
                    var ta = a.fecha_creacion ? a.fecha_creacion.seconds : 0;
                    var tb = b.fecha_creacion ? b.fecha_creacion.seconds : 0;
                    return tb - ta;
                });
            });
    },

    // --- Firestore: Vehículos ---

    addVehicleAsync(v) {
        var user = fbAuth.currentUser;
        v.id_usuario     = user.uid;
        v.fecha_registro = firebase.firestore.FieldValue.serverTimestamp();
        return fbDb.collection('vehiculos').add(v);
    },

    getVehiclesAsync() {
        var user = fbAuth.currentUser;
        return fbDb.collection('vehiculos')
            .where('id_usuario', '==', user.uid)
            .get()
            .then(function(snapshot) {
                return snapshot.docs.map(function(doc) {
                    return Object.assign({ id: doc.id }, doc.data());
                });
            });
    },

    // Agrega o corrige detalles opcionales de un vehículo ya registrado
    updateVehicleAsync(vehiculoId, cambios) {
        return fbDb.collection('vehiculos').doc(vehiculoId).update(cambios);
    },

    deleteVehicleAsync(vehiculoId) {
        var user = fbAuth.currentUser;
        return fbDb.collection('reservas')
            .where('id_usuario', '==', user.uid)
            .where('id_vehiculo', '==', vehiculoId)
            .get()
            .then(function(snapshot) {
                var batch = fbDb.batch();
                snapshot.docs.forEach(function(doc) { batch.delete(doc.ref); });
                batch.delete(fbDb.collection('vehiculos').doc(vehiculoId));
                return batch.commit();
            });
    },

    // --- Sincronización temporal ---

    // Tolerancias (ms) para validar las marcas de tiempo de ThingSpeak
    TIME_RULES: {
        maxFutureSkew: 2 * 60 * 1000,   // una lectura no puede venir más de 2 min "del futuro"
        maxAge:        5 * 60 * 1000,   // más de 5 min sin datos = lectura desactualizada
        maxClockSkew:  30 * 1000        // desfase aceptable entre el navegador y el servidor
    },

    clockOffset: 0,          // hora_servidor - hora_navegador (ms)
    clockRtt:    null,       // ida y vuelta de la sincronización con Firestore (ms)
    clockSynced: false,
    lastReadings: {},        // stationId -> { entryId, time }

    // Calcula el desfase del reloj local contra la hora del servidor de Firestore
    // (mismo principio que NTP: se compensa la mitad del tiempo de ida y vuelta).
    syncServerClock() {
        var self = this;
        var user = fbAuth.currentUser;
        var ref  = fbDb.collection('sincronizacion').doc(user.uid);
        var t0   = Date.now();
        return ref.set({ hora_servidor: firebase.firestore.FieldValue.serverTimestamp() })
            .then(function() { return ref.get({ source: 'server' }); })
            .then(function(doc) {
                var t1  = Date.now();
                var srv = doc.data().hora_servidor.toMillis();
                self.clockOffset = srv - (t0 + t1) / 2;
                self.clockRtt    = t1 - t0;
                self.clockSynced = true;
                return { offset: self.clockOffset, rtt: t1 - t0 };
            });
    },

    serverNow() {
        return Date.now() + this.clockOffset;
    },

    // Compara la marca de tiempo de una lectura con la hora del servidor y con
    // la lectura anterior de la misma estación. Devuelve { level, message, age }.
    validateReading(stationId, createdAt, entryId) {
        var rules = this.TIME_RULES;
        var time  = Date.parse(createdAt);
        var prev  = this.lastReadings[stationId];

        if (isNaN(time)) {
            return { level: 'error', message: 'Marca de tiempo inválida' };
        }

        var age = this.serverNow() - time;
        var result;

        if (prev && entryId < prev.entryId) {
            result = { level: 'error', message: 'Lectura fuera de orden (entry #' + entryId + ' < #' + prev.entryId + ')' };
        } else if (prev && entryId > prev.entryId && time <= prev.time) {
            result = { level: 'error', message: 'Marca de tiempo no creciente respecto a la lectura anterior' };
        } else if (age < -rules.maxFutureSkew) {
            result = { level: 'error', message: 'Marca de tiempo en el futuro: revisar NTP del dispositivo' };
        } else if (age > rules.maxAge) {
            result = { level: 'warning', message: 'Sin datos recientes (hace ' + this.formatAge(age) + ')' };
        } else if (prev && entryId === prev.entryId) {
            result = { level: 'ok', message: 'Sin lecturas nuevas desde la última consulta' };
        } else {
            result = { level: 'ok', message: 'Sincronizado (hace ' + this.formatAge(age) + ')' };
        }

        // Lectura que la página no había visto antes (sirve para medir la latencia solo una vez)
        result.isNew = !prev || entryId !== prev.entryId;
        if (result.level !== 'error') {
            this.lastReadings[stationId] = { entryId: entryId, time: time };
        }
        result.age = age;
        return result;
    },

    // --- Métricas de funcionamiento (colección "metricas" en Firestore) ---
    //
    // Latencia extremo a extremo de cada lectura nueva:
    //   T0 = hora de la medición (created_at / time de la fuente, UTC)
    //   T3 = momento en que la página terminó de mostrarla, con la hora corregida del servidor
    //   latencia = T3 − T0
    // Se guarda un resumen por estación cada 5 minutos (y al cerrar u ocultar la página).

    METRICS_FLUSH_MS:   5 * 60 * 1000,
    METRICS_MAX_SAMPLES: 300,
    metrics:      {},     // estación -> acumulado del periodo actual
    metricsStart: null,

    metricsBucket(stationId) {
        if (!this.metrics[stationId]) {
            this.metrics[stationId] = {
                latencias: [], consultas: [], fuentes: {},
                nuevas: 0, invalidas: 0, sinDatosRecientes: 0, total: 0, errores: 0
            };
        }
        return this.metrics[stationId];
    },

    // Se llama cada vez que la página consulta una estación y ya mostró el resultado
    recordReading(stationId, reading, check) {
        var b = this.metricsBucket(stationId);
        if (this.metricsStart === null) this.metricsStart = this.serverNow();
        b.total++;
        b.fuentes[reading.source] = (b.fuentes[reading.source] || 0) + 1;
        if (b.consultas.length < this.METRICS_MAX_SAMPLES) b.consultas.push(reading.fetchMs);
        if (check.level === 'error')   b.invalidas++;
        if (check.level === 'warning') b.sinDatosRecientes++;
        if (check.isNew && check.level !== 'error') {
            b.nuevas++;
            var latencia = Math.round(this.serverNow() - Date.parse(reading.time));
            if (b.latencias.length < this.METRICS_MAX_SAMPLES) b.latencias.push(latencia);
        }
    },

    recordFetchError(stationId) {
        if (this.metricsStart === null) this.metricsStart = this.serverNow();
        var b = this.metricsBucket(stationId);
        b.total++;
        b.errores++;
    },

    percentile(values, p) {
        if (!values.length) return null;
        var sorted = values.slice().sort(function(a, b) { return a - b; });
        var idx = Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1);
        return sorted[Math.max(0, idx)];
    },

    flushMetrics(pagina) {
        var self = this;
        var user = fbAuth.currentUser;
        var ids  = Object.keys(this.metrics);
        if (!user || !ids.length) return Promise.resolve(0);

        var inicio = this.metricsStart;
        var fin    = this.serverNow();
        var tz     = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        var batch  = fbDb.batch();

        ids.forEach(function(id) {
            var b = self.metrics[id];
            batch.set(fbDb.collection('metricas').doc(), {
                id_usuario:           user.uid,
                pagina:               pagina,
                estacion:             parseInt(id, 10),
                fuentes:              b.fuentes,
                consultas:            b.total,
                lecturas_nuevas:      b.nuevas,
                lecturas_invalidas:   b.invalidas,
                sin_datos_recientes:  b.sinDatosRecientes,
                errores_consulta:     b.errores,
                latencia_ms:          b.latencias,
                latencia_p50_ms:      self.percentile(b.latencias, 50),
                latencia_p95_ms:      self.percentile(b.latencias, 95),
                consulta_ms:          b.consultas,
                consulta_p95_ms:      self.percentile(b.consultas, 95),
                desfase_reloj_ms:     self.clockSynced ? Math.round(self.clockOffset) : null,
                rtt_reloj_ms:         self.clockRtt,
                zona_horaria:         tz,
                utc_offset_min:       -new Date().getTimezoneOffset(),
                inicio_periodo:       new Date(inicio),
                fin_periodo_cliente:  new Date(fin),     // comparar con fecha_registro valida la corrección del reloj
                fecha_registro:       firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        this.metrics      = {};
        this.metricsStart = null;
        return batch.commit().then(function() { return ids.length; });
    },

    // Guarda las métricas periódicamente y al ocultar o cerrar la página
    startMetrics(pagina) {
        var self  = this;
        var flush = function() {
            self.flushMetrics(pagina).catch(function(err) { console.error('No se pudieron guardar las métricas:', err); });
        };
        setInterval(flush, this.METRICS_FLUSH_MS);
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'hidden') flush();
        });
    },

    formatAge(ms) {
        var s = Math.round(Math.abs(ms) / 1000);
        if (s < 60)    return s + ' s';
        if (s < 3600)  return Math.round(s / 60) + ' min';
        if (s < 86400) return Math.round(s / 3600) + ' h';
        return Math.round(s / 86400) + ' días';
    },

    // --- Estimación de carga ---

    // Comportamiento típico por química de batería:
    //  eficiencia  -> energía que llega a la batería / energía tomada de la red
    //  cvDesde     -> % a partir del cual el cargador reduce la corriente (fase CV)
    //  cvFactor    -> cuánto más lenta es la carga en la fase CV
    //  degradacion -> pérdida de capacidad por año de uso
    BATTERY_TYPES: {
        'Litio-ion':    { eficiencia: 0.90, cvDesde: 80, cvFactor: 2.0, degradacion: 0.03 },
        'LiFePO4':      { eficiencia: 0.92, cvDesde: 90, cvFactor: 2.0, degradacion: 0.015 },
        'Plomo-ácido':  { eficiencia: 0.80, cvDesde: 70, cvFactor: 2.5, degradacion: 0.08 }
    },

    // Valores de referencia cuando el usuario aún no captura los detalles
    VEHICLE_DEFAULTS: {
        'Motocicleta':     { capacidad_kwh: 2.0, cargador_kw: 0.8 },
        'Patín eléctrico': { capacidad_kwh: 0.5, cargador_kw: 0.1 }
    },

    // Capacidades de referencia de modelos comunes (se pueden ajustar a mano)
    MODEL_CATALOG: {
        'NIU NQi GT':             2.1,
        'Super Soco TC':          1.56,
        'Xiaomi Pro 2':           0.474,
        'Segway Ninebot Max G30': 0.551
    },

    // Capacidad nominal declarada por el usuario: kWh directo, o voltaje × Ah
    vehicleCapacity(v) {
        if (v.capacidad_bateria > 0) return v.capacidad_bateria;
        if (v.voltaje > 0 && v.amperaje_hora > 0) return v.voltaje * v.amperaje_hora / 1000;
        return null;
    },

    // Estima tiempo y energía de carga usando todo lo que se sepa del vehículo.
    // Cada dato faltante se sustituye por un valor de referencia y se reporta en `supuestos`.
    estimateCharge(v, currentPct, targetPct, stationKw) {
        var defaults  = this.VEHICLE_DEFAULTS[v.tipo] || this.VEHICLE_DEFAULTS['Motocicleta'];
        var supuestos = [];

        var quimica = this.BATTERY_TYPES[v.tipo_bateria];
        if (!quimica) {
            quimica = this.BATTERY_TYPES['Litio-ion'];
            supuestos.push('batería de litio-ion');
        }

        var capacidad = this.vehicleCapacity(v);
        if (!capacidad) {
            capacidad = defaults.capacidad_kwh;
            supuestos.push('capacidad de ' + capacidad + ' kWh (típica de ' + (v.tipo || 'motocicleta').toLowerCase() + ')');
        }

        var salud = 1;
        if (this.hasValue(v.antiguedad_anios)) {
            salud = Math.max(0.6, 1 - quimica.degradacion * v.antiguedad_anios);
        } else {
            supuestos.push('batería nueva');
        }

        var cargador = v.cargador_kw;
        if (!(cargador > 0)) {
            cargador = defaults.cargador_kw;
            supuestos.push('cargador de ' + cargador + ' kW');
        }
        var potencia = Math.min(stationKw || cargador, cargador);

        var util   = capacidad * salud;                          // kWh realmente almacenables
        var desde  = Math.min(currentPct, targetPct);
        var corte  = Math.max(desde, Math.min(targetPct, quimica.cvDesde));
        var kwhCC  = util * (corte - desde) / 100;
        var kwhCV  = util * (targetPct - corte) / 100;
        var horas  = (kwhCC + kwhCV * quimica.cvFactor) / (potencia * quimica.eficiencia);

        var conocidos = 4 - supuestos.length;
        return {
            horas:         Math.round(horas * 10) / 10,
            kwhBateria:    kwhCC + kwhCV,
            kwhRed:        (kwhCC + kwhCV) / quimica.eficiencia,
            potencia:      potencia,
            capacidadUtil: util,
            supuestos:     supuestos,
            precision:     conocidos >= 4 ? 'alta' : conocidos >= 2 ? 'media' : 'baja'
        };
    },

    // Datos opcionales que todavía faltan en un vehículo guardado
    missingDetails(v) {
        var faltan = [];
        if (!v.marca) faltan.push('marca/modelo');
        if (!this.vehicleCapacity(v)) faltan.push('capacidad');
        if (!(v.cargador_kw > 0)) faltan.push('potencia del cargador');
        if (!this.hasValue(v.antiguedad_anios)) faltan.push('antigüedad');
        return faltan;
    },

    // --- Utilidades ---

    hasValue(x) {
        return x !== undefined && x !== null && x !== '' && !isNaN(x);
    },

    escapeHtml(s) {
        return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    },

    calculateChargeTime(capacity, currentPct, targetPct, power) {
        power = power || 1.5;
        const kwh = capacity * (targetPct - currentPct) / 100;
        return Math.round(kwh / power * 10) / 10;
    },

    formatDate(d) {
        return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    getParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }
};

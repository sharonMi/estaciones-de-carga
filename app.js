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

        if (result.level !== 'error') {
            this.lastReadings[stationId] = { entryId: entryId, time: time };
        }
        result.age = age;
        return result;
    },

    formatAge(ms) {
        var s = Math.round(Math.abs(ms) / 1000);
        if (s < 60)    return s + ' s';
        if (s < 3600)  return Math.round(s / 60) + ' min';
        if (s < 86400) return Math.round(s / 3600) + ' h';
        return Math.round(s / 86400) + ' días';
    },

    // --- Utilidades ---

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

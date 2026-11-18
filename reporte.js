// Cálculo de indicadores a partir de la colección "metricas" (ver App.flushMetrics).
// Funciones puras: reciben documentos ya leídos y devuelven números.
var Reporte = {
    // Metas de los indicadores
    METAS: {
        integridad:     99,     // % de lecturas que pasan la validación temporal
        disponibilidad: 99,     // % de consultas sin error
        recientes:      95,     // % de lecturas con antigüedad dentro del límite
        desfaseReloj:   30000,  // ms, igual que App.TIME_RULES.maxClockSkew
        correccion:     2000    // ms entre la hora corregida del cliente y la del servidor
    },

    ZONA_ESPERADA:   'America/Mexico_City',
    OFFSET_ESPERADO: -360,      // UTC−6, sin horario de verano desde 2022

    toMillis(ts) {
        if (!ts) return null;
        if (typeof ts.toMillis === 'function') return ts.toMillis();
        var n = Date.parse(ts);
        return isNaN(n) ? null : n;
    },

    percentile(values, p) {
        if (!values.length) return null;
        var sorted = values.slice().sort(function(a, b) { return a - b; });
        var idx = Math.ceil(p / 100 * sorted.length) - 1;
        return sorted[Math.min(sorted.length - 1, Math.max(0, idx))];
    },

    ratio(part, total) {
        return total > 0 ? 100 * part / total : null;
    },

    // Suma un conjunto de documentos en un solo resumen
    summarize(docs) {
        var self = this;
        var s = {
            documentos: docs.length, latencias: [], consultasMs: [], consultas: 0, nuevas: 0,
            invalidas: 0, sinRecientes: 0, errores: 0, fuentes: {}, desfases: [], rtts: [],
            correcciones: [], zonaOk: 0, zonaTotal: 0, zonas: {}
        };
        docs.forEach(function(d) {
            s.latencias    = s.latencias.concat(d.latencia_ms || []);
            s.consultasMs  = s.consultasMs.concat(d.consulta_ms || []);
            s.consultas   += d.consultas || 0;
            s.nuevas      += d.lecturas_nuevas || 0;
            s.invalidas   += d.lecturas_invalidas || 0;
            s.sinRecientes += d.sin_datos_recientes || 0;
            s.errores     += d.errores_consulta || 0;
            Object.keys(d.fuentes || {}).forEach(function(f) {
                s.fuentes[f] = (s.fuentes[f] || 0) + d.fuentes[f];
            });
            if (d.desfase_reloj_ms !== null && d.desfase_reloj_ms !== undefined) s.desfases.push(Math.abs(d.desfase_reloj_ms));
            if (d.rtt_reloj_ms !== null && d.rtt_reloj_ms !== undefined) s.rtts.push(d.rtt_reloj_ms);
            var srv = self.toMillis(d.fecha_registro), cli = self.toMillis(d.fin_periodo_cliente);
            if (srv !== null && cli !== null) s.correcciones.push(Math.abs(srv - cli));
            s.zonaTotal++;
            if (d.zona_horaria === self.ZONA_ESPERADA && d.utc_offset_min === self.OFFSET_ESPERADO) s.zonaOk++;
            var z = (d.zona_horaria || '¿?') + ' (UTC' + self.formatOffset(d.utc_offset_min) + ')';
            s.zonas[z] = (s.zonas[z] || 0) + 1;
        });
        var evaluadas = s.consultas - s.errores;
        var totalFuentes = Object.keys(s.fuentes).reduce(function(a, f) { return a + s.fuentes[f]; }, 0);
        return {
            documentos:      s.documentos,
            muestras:        s.latencias.length,
            consultas:       s.consultas,
            latenciaP50:     this.percentile(s.latencias, 50),
            latenciaP95:     this.percentile(s.latencias, 95),
            latenciaMax:     s.latencias.length ? Math.max.apply(null, s.latencias) : null,
            consultaP95:     this.percentile(s.consultasMs, 95),
            integridad:      this.ratio(evaluadas - s.invalidas, evaluadas),
            disponibilidad:  this.ratio(evaluadas, s.consultas),
            recientes:       this.ratio(evaluadas - s.invalidas - s.sinRecientes, evaluadas - s.invalidas),
            usoGrafana:      this.ratio(s.fuentes.grafana || 0, totalFuentes),
            desfaseMax:      s.desfases.length ? Math.max.apply(null, s.desfases) : null,
            rttP95:          this.percentile(s.rtts, 95),
            correccionP95:   this.percentile(s.correcciones, 95),
            zonaOk:          this.ratio(s.zonaOk, s.zonaTotal),
            zonas:           s.zonas
        };
    },

    // Inicio del periodo (hora local) al que pertenece un instante
    bucketStart(ms, unidad) {
        var d = new Date(ms);
        d.setMinutes(0, 0, 0);
        if (unidad === 'dia') d.setHours(0);
        return d.getTime();
    },

    // Usa el calendario local para que un día siempre empiece a las 00:00
    nextBucket(ms, unidad) {
        var d = new Date(ms);
        if (unidad === 'dia') d.setDate(d.getDate() + 1);
        else d.setHours(d.getHours() + 1);
        return d.getTime();
    },

    // Agrupa por periodo y estación: { buckets: [ms...], porEstacion: { id: [resumen|null...] } }
    series(docs, desde, hasta, unidad, estaciones) {
        var self = this;
        var buckets = [];
        for (var t = this.bucketStart(desde, unidad); t <= hasta; t = this.nextBucket(t, unidad)) {
            buckets.push(t);
        }
        var grupos = {};
        docs.forEach(function(d) {
            var ms = self.toMillis(d.fecha_registro);
            if (ms === null) return;
            var k = d.estacion + ':' + self.bucketStart(ms, unidad);
            (grupos[k] = grupos[k] || []).push(d);
        });
        var porEstacion = {};
        estaciones.forEach(function(id) {
            porEstacion[id] = buckets.map(function(b) {
                var g = grupos[id + ':' + b];
                return g ? self.summarize(g) : null;
            });
        });
        return { buckets: buckets, porEstacion: porEstacion };
    },

    formatOffset(min) {
        if (min === null || min === undefined) return '?';
        var sign = min < 0 ? '−' : '+';
        var a = Math.abs(min);
        return sign + Math.floor(a / 60) + (a % 60 ? ':' + String(a % 60).padStart(2, '0') : '');
    },

    // 8 s · 2.5 min · 3.1 h · 41 días
    formatDuration(ms) {
        if (ms === null || ms === undefined) return '—';
        var neg = ms < 0, a = Math.abs(ms), out;
        if (a < 1000)        out = Math.round(a) + ' ms';
        else if (a < 60e3)   out = (a / 1000).toFixed(a < 10e3 ? 1 : 0) + ' s';
        else if (a < 3600e3) out = (a / 60e3).toFixed(1) + ' min';
        else if (a < 86400e3) out = (a / 3600e3).toFixed(1) + ' h';
        else                 out = (a / 86400e3).toFixed(1) + ' días';
        return (neg ? '−' : '') + out;
    },

    formatPct(x) {
        return x === null || x === undefined ? '—' : (x >= 99.95 || x === 0 ? x.toFixed(0) : x.toFixed(1)) + ' %';
    },

    // Filas para exportar a CSV (un documento de métricas por fila)
    csvRows(docs) {
        var self = this;
        var cols = ['fecha_registro', 'estacion', 'pagina', 'consultas', 'lecturas_nuevas', 'lecturas_invalidas',
                    'sin_datos_recientes', 'errores_consulta', 'latencia_p50_ms', 'latencia_p95_ms', 'consulta_p95_ms',
                    'fuente_grafana', 'fuente_thingspeak', 'desfase_reloj_ms', 'rtt_reloj_ms', 'zona_horaria',
                    'utc_offset_min', 'correccion_reloj_ms', 'latencia_ms'];
        var rows = [cols];
        docs.forEach(function(d) {
            var srv = self.toMillis(d.fecha_registro), cli = self.toMillis(d.fin_periodo_cliente);
            rows.push([
                srv !== null ? new Date(srv).toISOString() : '', d.estacion, d.pagina, d.consultas, d.lecturas_nuevas,
                d.lecturas_invalidas, d.sin_datos_recientes, d.errores_consulta, d.latencia_p50_ms, d.latencia_p95_ms,
                d.consulta_p95_ms, (d.fuentes || {}).grafana || 0, (d.fuentes || {}).thingspeak || 0,
                d.desfase_reloj_ms, d.rtt_reloj_ms, d.zona_horaria, d.utc_offset_min,
                srv !== null && cli !== null ? srv - cli : '', (d.latencia_ms || []).join(' ')
            ]);
        });
        return rows.map(function(r) {
            return r.map(function(v) {
                var s = v === null || v === undefined ? '' : String(v);
                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\n');
    }
};

if (typeof module !== 'undefined') module.exports = Reporte;

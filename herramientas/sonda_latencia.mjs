#!/usr/bin/env node
// Sonda de latencia extremo a extremo (ThingSpeak → cliente), sin navegador ni sesión.
//
// Hace lo mismo que monitoreo.html: cada 30 s consulta la última lectura de cada estación.
// Cuando aparece una lectura nueva, calcula:
//     latencia = hora de recepción (corregida por NTP) − created_at de ThingSpeak
// y la guarda en CSV. Cada 5 minutos regenera un reporte HTML con gráficas (y un PNG cada
// 30 minutos si hay Google Chrome). También mide la disponibilidad del sitio publicado.
//
// Uso:  node herramientas/sonda_latencia.mjs [carpeta_de_salida]
// Detener: Ctrl+C, o  kill $(cat <carpeta>/sonda.pid)

import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const OUT = path.resolve(process.argv[2] || 'mediciones');
const STATIONS = [
    { id: 1, channel: '3360039', key: 'MMUHRVIAOTKL8QHQ' },
    { id: 2, channel: '3372390', key: 'UQYT8WT4I9PS085D' },
    { id: 3, channel: '3407943', key: 'SVABK6Q2I4RN2QX4' }
];
const SITE_URL     = 'https://simce.celaya.tecnm.mx/monitoreo.html';
const POLL_MS      = 30 * 1000;       // igual que la página de monitoreo
const NTP_MS       = 10 * 60 * 1000;
const SITE_MS      = 5 * 60 * 1000;
const REPORT_MS    = 5 * 60 * 1000;
const PNG_MS       = 30 * 60 * 1000;
const META_P95_MS  = 60 * 1000;
const MAX_FUTURE   = 2 * 60 * 1000;   // mismas reglas que App.TIME_RULES
const MAX_AGE      = 5 * 60 * 1000;
const CHROME       = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p));

const F_LECTURAS = path.join(OUT, 'lecturas.csv');
const F_SITIO    = path.join(OUT, 'sitio.csv');
const F_HTML     = path.join(OUT, 'reporte_latencia.html');
const F_PNG      = path.join(OUT, 'reporte_latencia.png');
const F_ESTADO   = path.join(OUT, 'estado.json');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'sonda.pid'), String(process.pid));

let offset = 0, offsetSource = 'sin sincronizar', offsetRtt = null;
const last = {};                   // estación -> { entryId, time }
const rows = [];                   // lecturas en memoria (para el reporte)
const site = [];
const startedAt = Date.now();

function log(...a) { console.log(new Date().toLocaleString('es-MX'), ...a); }
const now = () => Date.now() + offset;

// ---------- Reloj: SNTP (UDP 123) con respaldo en la cabecera Date de HTTP ----------

function sntp(host) {
    return new Promise((resolve, reject) => {
        const sock = dgram.createSocket('udp4');
        const pkt = Buffer.alloc(48);
        pkt[0] = 0x23;                                  // LI 0, versión 4, modo 3 (cliente)
        const timer = setTimeout(() => { sock.close(); reject(new Error('timeout ' + host)); }, 3000);
        let t1;
        sock.on('message', msg => {
            const t4 = Date.now();
            clearTimeout(timer); sock.close();
            const ts = o => (msg.readUInt32BE(o) - 2208988800) * 1000 + msg.readUInt32BE(o + 4) / 4294967296 * 1000;
            const t2 = ts(32), t3 = ts(40);
            resolve({ offset: ((t2 - t1) + (t3 - t4)) / 2, rtt: (t4 - t1) - (t3 - t2) });
        });
        sock.on('error', e => { clearTimeout(timer); sock.close(); reject(e); });
        t1 = Date.now();
        sock.send(pkt, 123, host);
    });
}

async function syncClock() {
    for (const host of ['time.google.com', 'pool.ntp.org', 'time.cloudflare.com']) {
        try {
            const r = await sntp(host);
            offset = r.offset; offsetRtt = Math.round(r.rtt); offsetSource = 'NTP ' + host;
            log(`Reloj: desfase ${Math.round(offset)} ms (${offsetSource}, rtt ${offsetRtt} ms)`);
            return;
        } catch (e) { /* siguiente servidor */ }
    }
    try {                                               // respaldo: precisión de 1 s
        const t0 = Date.now();
        const res = await fetch('https://api.thingspeak.com/', { method: 'HEAD' });
        const t1 = Date.now();
        offset = Date.parse(res.headers.get('date')) + 500 - (t0 + t1) / 2;
        offsetRtt = t1 - t0; offsetSource = 'HTTP Date (±1 s)';
        log(`Reloj: desfase ${Math.round(offset)} ms (${offsetSource})`);
    } catch (e) { log('No se pudo sincronizar el reloj:', e.message); }
}

// ---------- CSV ----------

function csvLine(vals) {
    return vals.map(v => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',') + '\n';
}

const COLS = ['hora_local', 'hora_utc', 'estacion', 'entry_id', 'created_at', 'nueva', 'estado',
              'latencia_ms', 'consulta_ms', 'desfase_reloj_ms', 'fuente_reloj', 'detalle'];
if (!fs.existsSync(F_LECTURAS)) fs.writeFileSync(F_LECTURAS, csvLine(COLS));
if (!fs.existsSync(F_SITIO)) fs.writeFileSync(F_SITIO, csvLine(['hora_local', 'hora_utc', 'url', 'http', 'tiempo_ms', 'detalle']));

// Al reiniciar, recupera lo ya medido para que el reporte siga completo
function loadPrevious() {
    const parse = line => {
        const out = []; let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
            else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
        }
        out.push(cur); return out;
    };
    fs.readFileSync(F_LECTURAS, 'utf8').split('\n').slice(1).filter(Boolean).forEach(l => {
        const v = parse(l);
        rows.push({ t: Date.parse(v[1]), est: +v[2], entryId: v[3] === '' ? null : +v[3], createdAt: v[4],
                    nueva: v[5] === '1', estado: v[6], lat: v[7] === '' ? null : +v[7], consulta: v[8] === '' ? null : +v[8] });
    });
    fs.readFileSync(F_SITIO, 'utf8').split('\n').slice(1).filter(Boolean).forEach(l => {
        const v = parse(l);
        site.push({ t: Date.parse(v[1]), http: +v[3] || 0, ms: v[4] === '' ? null : +v[4] });
    });
    rows.forEach(r => { if (r.entryId !== null && r.estado !== 'error') last[r.est] = { entryId: r.entryId, time: Date.parse(r.createdAt) }; });
    if (rows.length) log(`Recuperadas ${rows.length} filas anteriores`);
}

// ---------- Medición ----------

async function fetchTimeout(url, ms, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(timer); }
}

async function pollStation(st) {
    const url = `https://api.thingspeak.com/channels/${st.channel}/feeds/last.json?api_key=${st.key}`;
    const t0 = performance.now();
    let row = { est: st.id, entryId: null, createdAt: '', nueva: false, estado: 'error', lat: null, consulta: null, detalle: '' };
    try {
        const res = await fetchTimeout(url, 10000);
        const d = await res.json();
        const recibido = now();                 // momento en que el dato está disponible en el cliente
        row.consulta = Math.round(performance.now() - t0);
        if (!d || !d.created_at) throw new Error('sin lecturas');
        const time = Date.parse(d.created_at);
        const prev = last[st.id];
        row.entryId = d.entry_id; row.createdAt = d.created_at;
        row.nueva = !prev || d.entry_id !== prev.entryId;
        const age = recibido - time;
        if (prev && d.entry_id < prev.entryId)                            { row.estado = 'fuera_de_orden'; }
        else if (prev && d.entry_id > prev.entryId && time <= prev.time)   { row.estado = 'hora_no_creciente'; }
        else if (age < -MAX_FUTURE)                                        { row.estado = 'hora_futura'; }
        else if (age > MAX_AGE)                                            { row.estado = 'sin_datos_recientes'; }
        else                                                               { row.estado = row.nueva ? 'ok' : 'sin_nuevas'; }
        if (row.nueva && !['fuera_de_orden', 'hora_no_creciente'].includes(row.estado)) row.lat = Math.round(age);
        if (!['fuera_de_orden', 'hora_no_creciente'].includes(row.estado)) last[st.id] = { entryId: d.entry_id, time };
    } catch (e) {
        row.consulta = Math.round(performance.now() - t0);
        row.detalle = e.name === 'AbortError' ? 'timeout 10 s' : e.message;
    }
    row.t = now();
    rows.push(row);
    const d = new Date(row.t);
    fs.appendFileSync(F_LECTURAS, csvLine([d.toLocaleString('es-MX'), d.toISOString(), row.est, row.entryId, row.createdAt,
        row.nueva ? 1 : 0, row.estado, row.lat, row.consulta, Math.round(offset), offsetSource, row.detalle]));
    if (row.nueva && row.lat !== null && row.estado === 'ok') log(`Estación ${st.id}: lectura #${row.entryId} · latencia ${(row.lat / 1000).toFixed(1)} s`);
}

async function checkSite() {
    const t0 = performance.now();
    let http = 0, detalle = '';
    try { const res = await fetchTimeout(SITE_URL, 15000); http = res.status; await res.arrayBuffer(); }
    catch (e) { detalle = e.name === 'AbortError' ? 'timeout 15 s' : e.message; }
    const ms = Math.round(performance.now() - t0), t = now(), d = new Date(t);
    site.push({ t, http, ms: http ? ms : null });
    fs.appendFileSync(F_SITIO, csvLine([d.toLocaleString('es-MX'), d.toISOString(), SITE_URL, http, http ? ms : '', detalle]));
}

// ---------- Reporte ----------

const pct = (vals, p) => {
    if (!vals.length) return null;
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))];
};
const fmtDur = ms => ms === null || ms === undefined ? '—'
    : Math.abs(ms) < 1000 ? Math.round(ms) + ' ms'
    : Math.abs(ms) < 60e3 ? (ms / 1000).toFixed(1) + ' s'
    : Math.abs(ms) < 3600e3 ? (ms / 60e3).toFixed(1) + ' min'
    : Math.abs(ms) < 86400e3 ? (ms / 3600e3).toFixed(1) + ' h' : (ms / 86400e3).toFixed(1) + ' días';
const fmtPct = x => x === null ? '—' : x.toFixed(x >= 99.95 ? 0 : 1) + ' %';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = t => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const COLORS = { 1: '#3987e5', 2: '#d95926', 3: '#199e70' };    // validados contra #1e293b

function niceDur(v) {
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400].map(s => s * 1000);
    for (const s of steps) if (s * 4 >= v) return s * 4;
    return Math.ceil(v / 86400e3) * 86400e3;
}

function chartSvg({ series, t0, t1, yMax, goal, title, mode }) {
    const W = 1000, H = 300, m = { l: 70, r: 20, t: 16, b: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = t => m.l + iw * (t - t0) / Math.max(1, t1 - t0);
    const y = v => m.t + ih - ih * Math.min(v, yMax) / yMax;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" style="width:100%;height:auto;display:block">`;
    for (let k = 0; k <= 4; k++) {
        const v = yMax * k / 4;
        s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${k ? 'rgba(148,163,184,.12)' : '#334155'}"/>`;
        s += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#64748b">${k ? fmtDur(v) : '0'}</text>`;
    }
    const span = t1 - t0, stepH = span > 12 * 3600e3 ? 2 : 1;
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t < t1; t += stepH * 3600e3) {
        s += `<text x="${x(t)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#64748b">${hhmm(t)}</text>`;
    }
    if (goal !== undefined && goal <= yMax) {
        s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(goal)}" y2="${y(goal)}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="5 4"/>`;
        s += `<text x="${m.l + 6}" y="${y(goal) - 6}" font-size="11" fill="#64748b">Meta ${fmtDur(goal)}</text>`;
    }
    series.forEach(sr => {
        if (mode === 'dots') {
            const dense = series.reduce((n, x) => n + x.points.length, 0) > 400;   // con muchas lecturas, puntos más pequeños
            sr.points.forEach(p => {
                const over = p.v > yMax;
                s += `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${over ? 5 : dense ? 2.5 : 4}" fill="${sr.color}" fill-opacity="${over ? 1 : dense ? .6 : .75}" stroke="#1e293b" stroke-width="1"><title>${esc(sr.name)} · ${hhmm(p.t)} · ${fmtDur(p.v)}${over ? ' (fuera de escala)' : ''}</title></circle>`;
            });
        } else {
            let d = '', prevT = null;
            sr.points.forEach(p => {
                const gap = prevT !== null && p.t - prevT > 2 * sr.bucket;
                d += (d && !gap ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1);
                prevT = p.t;
            });
            if (d) s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
            sr.points.forEach(p => {
                s += `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="10" fill="transparent"><title>${esc(sr.name)} · ${hhmm(p.t)} · p95 ${fmtDur(p.v)}</title></circle>`;
            });
        }
    });
    return s + '</svg>';
}

function buildReport() {
    const t1 = now(), t0 = Math.min(startedAt + offset, rows.length ? rows[0].t : t1);
    const BUCKET = 15 * 60e3;
    const stations = STATIONS.map(st => {
        const r = rows.filter(x => x.est === st.id);
        const lat = r.filter(x => x.lat !== null && x.estado === 'ok');
        const latAll = r.filter(x => x.lat !== null);
        const ok = r.filter(x => x.estado !== 'error');
        const valid = ok.filter(x => !['fuera_de_orden', 'hora_no_creciente', 'hora_futura'].includes(x.estado));
        const buckets = {};
        lat.forEach(x => { const b = Math.floor(x.t / BUCKET) * BUCKET; (buckets[b] = buckets[b] || []).push(x.lat); });
        const lastRow = [...r].reverse().find(x => x.createdAt);
        return {
            id: st.id, name: 'Estación ' + st.id, color: COLORS[st.id],
            consultas: r.length, nuevas: latAll.length, enTiempo: lat.length,
            p50: pct(lat.map(x => x.lat), 50), p95: pct(lat.map(x => x.lat), 95), max: lat.length ? Math.max(...lat.map(x => x.lat)) : null,
            consultaP95: pct(r.filter(x => x.consulta !== null).map(x => x.consulta), 95),
            disponibilidad: r.length ? 100 * ok.length / r.length : null,
            integridad: ok.length ? 100 * valid.length / ok.length : null,
            ultima: lastRow ? lastRow.createdAt : null,
            dots: lat.map(x => ({ t: x.t, v: x.lat })),
            p95s: Object.keys(buckets).sort().map(b => ({ t: +b + BUCKET / 2, v: pct(buckets[b], 95) }))
        };
    });
    const allLat = rows.filter(x => x.lat !== null && x.estado === 'ok').map(x => x.lat);
    const yMax = niceDur(Math.max(META_P95_MS * 1.2, pct(allLat, 99) || 0));
    const sitioOk = site.filter(s => s.http >= 200 && s.http < 400);
    const total = { p50: pct(allLat, 50), p95: pct(allLat, 95), n: allLat.length };
    const hayDatos = allLat.length > 0;

    const statusOf = (v, meta) => v === null ? ['#64748b', '–', 'Sin datos'] : v <= meta ? ['#22c55e', '✔', 'Cumple la meta'] : ['#ef4444', '✖', 'No cumple la meta'];
    const [c95, i95, t95] = statusOf(total.p95, META_P95_MS);

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Latencia extremo a extremo — SIMCE</title><meta http-equiv="refresh" content="300">
<style>
body{margin:0;background:#0f172a;color:#f1f5f9;font-family:Inter,-apple-system,Segoe UI,sans-serif;line-height:1.5}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:0 0 4px}
.sub{color:#94a3b8;font-size:13px;margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}
.lbl{font-size:12px;color:#94a3b8}.val{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.st{font-size:12px;margin-top:4px}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#94a3b8;margin:6px 0 8px}
.legend i{display:inline-block;width:16px;height:2px;margin-right:6px;vertical-align:middle}
.legend i.dot{width:8px;height:8px;border-radius:50%}
.note{font-size:12px;color:#64748b;margin-top:6px}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #334155;white-space:nowrap}
th{color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
.tbl{overflow-x:auto}.warn{background:rgba(234,179,8,.12);border:1px solid rgba(234,179,8,.3);color:#eab308;padding:12px 14px;border-radius:8px;font-size:13px;margin-bottom:20px}
</style></head><body><div class="wrap">
<h1>Latencia extremo a extremo — Estaciones SIMCE</h1>
<p class="sub">Medición del ${new Date(t0).toLocaleString('es-MX')} al ${new Date(t1).toLocaleString('es-MX')} (America/Mexico_City, UTC−6) ·
consulta cada ${POLL_MS / 1000} s, igual que la página de Monitoreo · reloj corregido por ${esc(offsetSource)} (desfase ${fmtDur(offset)}) ·
se actualiza cada 5 min</p>
${hayDatos ? '' : `<div class="warn">⚠ Aún no hay lecturas nuevas: las estaciones no están enviando datos a ThingSpeak. Últimas lecturas: ${stations.map(s => esc(s.name) + ' ' + (s.ultima ? new Date(s.ultima).toLocaleString('es-MX') : 'sin datos')).join(' · ')}. La latencia se empieza a medir en cuanto un ESP32 envíe una lectura.</div>`}
<div class="grid">
 <div class="card"><div class="lbl">Latencia p50</div><div class="val">${fmtDur(total.p50)}</div><div class="st" style="color:#94a3b8">${total.n} lecturas nuevas</div></div>
 <div class="card"><div class="lbl">Latencia p95</div><div class="val">${fmtDur(total.p95)}</div><div class="st" style="color:${c95}">${i95} ${t95} · meta ≤ ${fmtDur(META_P95_MS)}</div></div>
 <div class="card"><div class="lbl">Consultas a ThingSpeak</div><div class="val">${rows.length}</div><div class="st" style="color:#94a3b8">cada ${POLL_MS / 1000} s por estación</div></div>
 <div class="card"><div class="lbl">Sitio publicado disponible</div><div class="val">${fmtPct(site.length ? 100 * sitioOk.length / site.length : null)}</div><div class="st" style="color:#94a3b8">p95 de carga ${fmtDur(pct(sitioOk.map(s => s.ms), 95))} · ${site.length} pruebas</div></div>
</div>
<div class="card" style="margin-bottom:20px">
 <h2>Latencia de cada lectura nueva</h2>
 <div class="legend">${stations.map(s => `<span><i class="dot" style="background:${s.color}"></i>${s.name}</span>`).join('')}<span><i style="border-top:2px dashed #64748b;height:0"></i>Meta</span></div>
 ${chartSvg({ series: stations.map(s => ({ name: s.name, color: s.color, points: s.dots })), t0, t1, yMax, goal: META_P95_MS, title: 'Latencia por lectura', mode: 'dots' })}
 <p class="note">Cada punto es una lectura: tiempo entre su registro en ThingSpeak (created_at) y su recepción en el cliente. Incluye la espera hasta la siguiente consulta (0–30 s).</p>
</div>
<div class="card" style="margin-bottom:20px">
 <h2>Latencia p95 cada 15 minutos</h2>
 <div class="legend">${stations.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}<span><i style="border-top:2px dashed #64748b;height:0"></i>Meta</span></div>
 ${chartSvg({ series: stations.map(s => ({ name: s.name, color: s.color, points: s.p95s, bucket: BUCKET })), t0, t1, yMax, goal: META_P95_MS, title: 'Latencia p95 por 15 minutos', mode: 'line' })}
</div>
<div class="card tbl" style="margin-bottom:20px"><table>
<tr><th>Estación</th><th>Lecturas nuevas</th><th>p50</th><th>p95</th><th>Máx.</th><th>Consulta p95</th><th>Disponibilidad</th><th>Integridad</th><th>Última lectura</th></tr>
${stations.map(s => `<tr><td><i style="display:inline-block;width:12px;height:2px;background:${s.color};margin-right:8px;vertical-align:middle"></i>${s.name}</td><td>${s.enTiempo}</td><td>${fmtDur(s.p50)}</td><td>${fmtDur(s.p95)}</td><td>${fmtDur(s.max)}</td><td>${fmtDur(s.consultaP95)}</td><td>${fmtPct(s.disponibilidad)}</td><td>${fmtPct(s.integridad)}</td><td>${s.ultima ? new Date(s.ultima).toLocaleString('es-MX') : '—'}</td></tr>`).join('')}
</table></div>
<p class="note">Datos crudos: lecturas.csv y sitio.csv en esta misma carpeta. Generado por herramientas/sonda_latencia.mjs.</p>
</div></body></html>`;
    fs.writeFileSync(F_HTML + '.tmp', html);
    fs.renameSync(F_HTML + '.tmp', F_HTML);
    fs.writeFileSync(F_ESTADO, JSON.stringify({ actualizado: new Date(t1).toISOString(), desde: new Date(t0).toISOString(),
        consultas: rows.length, lecturas_nuevas: total.n, p50_ms: total.p50, p95_ms: total.p95, reloj: offsetSource, desfase_ms: Math.round(offset) }, null, 2));
}

function renderPng() {
    if (!CHROME) return;
    execFile(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1150,1500',
        '--virtual-time-budget=2000', '--screenshot=' + F_PNG, 'file://' + F_HTML], { timeout: 60000 }, err => {
        if (err) log('No se pudo generar el PNG:', err.message);
    });
}

// ---------- Ciclo principal ----------

async function main() {
    log(`Sonda iniciada · salida: ${OUT} · PID ${process.pid}`);
    loadPrevious();
    await syncClock();
    const pollAll = () => Promise.all(STATIONS.map(pollStation)).catch(e => log('Error:', e.message));
    await pollAll();
    await checkSite();
    buildReport(); renderPng();
    setInterval(pollAll, POLL_MS);
    setInterval(syncClock, NTP_MS);
    setInterval(checkSite, SITE_MS);
    setInterval(() => { try { buildReport(); } catch (e) { log('Error en reporte:', e.message); } }, REPORT_MS);
    setInterval(renderPng, PNG_MS);
    const stop = () => { log('Deteniendo: generando reporte final…'); try { buildReport(); } catch (e) {} process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

main();

#!/usr/bin/env node
// Reconstrucción empírica de la latencia extremo a extremo con datos históricos reales.
//
// NO es una medición en vivo. Toma las horas reales en que las lecturas llegaron a ThingSpeak
// (created_at) en jornadas pasadas y simula sobre ellas el comportamiento exacto de
// monitoreo.html:
//   - consulta feeds/last.json cada 30 s (fase inicial aleatoria);
//   - cada consulta tarda lo que tardaron las consultas reales medidas por la sonda
//     (lecturas.csv), o 400–550 ms si no hay mediciones;
//   - la página solo ve la ÚLTIMA lectura disponible: las intermedias no se muestran;
//   - latencia = momento en que la lectura aparece en pantalla − created_at.
// Se repite N veces con distinta fase para obtener un rango, no un número suelto.
//
// Uso: node herramientas/reconstruir_latencia.mjs [carpeta_de_salida]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = path.resolve(process.argv[2] || 'mediciones');
const CHANNEL = { id: 1, channel: '3360039', key: 'MMUHRVIAOTKL8QHQ' };   // única estación con historial suficiente
const POLL_MS = 30000, RENDER_MS = 16, RUNS = 300, META_MS = 60000, MIN_SESSION = 70;
const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p));

// --- Aleatorio reproducible ---
let seed = 20261118;
const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;

const pct = (v, p) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))]; };
const fmtS = ms => ms === null ? '—' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = t => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const fecha = t => new Date(t).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

// --- Tiempos de consulta reales (sonda) ---
function loadQueryTimes() {
    const f = path.join(OUT, 'lecturas.csv');
    if (!fs.existsSync(f)) return null;
    const v = fs.readFileSync(f, 'utf8').trim().split('\n').slice(1)
        .map(l => { const m = l.match(/^"[^"]*",(.*)$/); return m ? +m[1].split(',')[7] : NaN; })
        .filter(x => x > 0 && x < 10000);
    return v.length >= 20 ? v : null;
}

// --- Jornadas reales: lecturas separadas por huecos de más de 10 min ---
function sessions(times) {
    const out = []; let a = 0;
    for (let i = 1; i <= times.length; i++) {
        if (i === times.length || times[i] - times[i - 1] > 600e3) { if (i - a >= MIN_SESSION) out.push(times.slice(a, i)); a = i; }
    }
    return out;
}

// --- Simulación de la página sobre una jornada ---
function simulate(arrivals, queryTimes) {
    const start = arrivals[0], end = arrivals[arrivals.length - 1];
    const sampleQ = () => queryTimes ? queryTimes[Math.floor(rnd() * queryTimes.length)] : 400 + rnd() * 150;
    let p = start + rnd() * POLL_MS, idx = -1, lastShown = -1;
    const shown = [];
    while (p <= end + POLL_MS) {
        const q = sampleQ();
        const atServer = p + q / 2;                       // la consulta llega a ThingSpeak a la mitad del viaje
        while (idx + 1 < arrivals.length && arrivals[idx + 1] <= atServer) idx++;
        if (idx >= 0 && idx !== lastShown) {
            const ntpError = (rnd() - 0.5) * 80;             // error residual del reloj corregido (±40 ms)
            shown.push({ t: p + q + RENDER_MS, lat: p + q + RENDER_MS - arrivals[idx] + ntpError });
            lastShown = idx;
        }
        p += POLL_MS;
    }
    const lats = shown.map(s => s.lat);
    return { shown, p50: pct(lats, 50), p95: pct(lats, 95), max: Math.max(...lats), mostradas: shown.length, enviadas: arrivals.length };
}

// --- Gráficas SVG ---
const C1 = '#3987e5';
function axisY(s, m, W, y, yMax, steps, fmt) {
    for (let k = 0; k <= steps; k++) {
        const v = yMax * k / steps;
        s.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${k ? 'rgba(148,163,184,.12)' : '#334155'}"/>`);
        s.push(`<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#64748b">${k ? fmt(v) : '0'}</text>`);
    }
}
function goalLine(s, m, W, y, goal) {
    s.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(goal)}" y2="${y(goal)}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    s.push(`<text x="${m.l + 6}" y="${y(goal) - 6}" font-size="11" fill="#64748b">Meta p95 ${fmtS(goal)}</text>`);
}

function timeChart(run, p95s) {
    const W = 1000, H = 300, m = { l: 60, r: 20, t: 16, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const t0 = run.shown[0].t, t1 = run.shown[run.shown.length - 1].t, yMax = 70000;
    const x = t => m.l + iw * (t - t0) / (t1 - t0), y = v => m.t + ih - ih * Math.min(v, yMax) / yMax;
    const s = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Latencia de cada lectura mostrada a lo largo de la jornada" style="width:100%;height:auto;display:block">`];
    axisY(s, m, W, y, yMax, 7, v => (v / 1000) + ' s');
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t < t1; t += 3600e3) s.push(`<text x="${x(t)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#64748b">${hhmm(t)}</text>`);
    goalLine(s, m, W, y, META_MS);
    run.shown.forEach(p => s.push(`<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.lat).toFixed(1)}" r="3" fill="${C1}" fill-opacity=".55"><title>${hhmm(p.t)} · ${fmtS(p.lat)}</title></circle>`));
    let d = ''; p95s.forEach((p, i) => { d += (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); });
    s.push(`<path d="${d}" fill="none" stroke="#f1f5f9" stroke-width="2" stroke-linejoin="round"/>`);
    p95s.forEach(p => s.push(`<circle cx="${x(p.t)}" cy="${y(p.v)}" r="10" fill="transparent"><title>${hhmm(p.t)} · p95 de 15 min: ${fmtS(p.v)}</title></circle>`));
    const lp = p95s[p95s.length - 1];
    s.push(`<text x="${x(lp.t) - 4}" y="${y(lp.v) - 8}" text-anchor="end" font-size="11" fill="#94a3b8">p95 cada 15 min</text>`);
    return s.join('') + '</svg>';
}

function histogram(lats) {
    const W = 1000, H = 260, m = { l: 60, r: 20, t: 16, b: 40 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const BIN = 2000, NB = 30;                          // 0–60 s en barras de 2 s (+ desborde)
    const counts = new Array(NB + 1).fill(0);
    lats.forEach(v => counts[Math.min(NB, Math.max(0, Math.floor(v / BIN)))]++);
    const pctB = counts.map(c => 100 * c / lats.length);
    const yMax = Math.ceil(Math.max(...pctB) / 2) * 2 || 2;
    const bw = iw / (NB + 1), y = v => m.t + ih - ih * v / yMax;
    const s = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribución de la latencia" style="width:100%;height:auto;display:block">`];
    axisY(s, m, W, y, yMax, 4, v => v.toFixed(0) + ' %');
    pctB.forEach((v, i) => {
        if (!v) return;
        const x0 = m.l + i * bw + 1, w = bw - 2, top = y(v), h = m.t + ih - top, r = Math.min(4, w / 2, h);
        const label = i === NB ? '≥ 60 s' : `${i * 2}–${i * 2 + 2} s`;
        s.push(`<path d="M${x0} ${m.t + ih}V${top + r}Q${x0} ${top} ${x0 + r} ${top}H${x0 + w - r}Q${x0 + w} ${top} ${x0 + w} ${top + r}V${m.t + ih}Z" fill="${C1}"><title>${label}: ${v.toFixed(1)} % de las lecturas</title></path>`);
    });
    for (let i = 0; i <= NB; i += 5) s.push(`<text x="${m.l + i * bw}" y="${H - 22}" text-anchor="middle" font-size="11" fill="#64748b">${i * 2} s</text>`);
    s.push(`<text x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="#64748b">Latencia extremo a extremo</text>`);
    return s.join('') + '</svg>';
}

// --- Principal ---
async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const res = await fetch(`https://api.thingspeak.com/channels/${CHANNEL.channel}/feeds.json?api_key=${CHANNEL.key}&results=8000`);
    const feeds = (await res.json()).feeds;
    const times = feeds.map(f => Date.parse(f.created_at)).sort((a, b) => a - b);
    const ses = sessions(times);
    if (!ses.length) throw new Error('No hay jornadas con al menos ' + MIN_SESSION + ' lecturas');
    const queryTimes = loadQueryTimes();

    const resumen = ses.map(arr => {
        const runs = Array.from({ length: RUNS }, () => simulate(arr, queryTimes));
        const gaps = arr.slice(1).map((v, i) => v - arr[i]);
        return {
            arr, runs, inicio: arr[0], fin: arr[arr.length - 1], lecturas: arr.length,
            envioP50: pct(gaps, 50),
            p50: pct(runs.map(r => r.p50), 50), p95: pct(runs.map(r => r.p95), 50),
            p95lo: pct(runs.map(r => r.p95), 5), p95hi: pct(runs.map(r => r.p95), 95),
            mostradas: pct(runs.map(r => 100 * r.mostradas / r.enviadas), 50),
            cumple: 100 * runs.filter(r => r.p95 <= META_MS).length / runs.length
        };
    });
    const main = resumen.reduce((a, b) => (b.lecturas > a.lecturas ? b : a));     // jornada más larga
    // Corrida representativa: la de p95 más cercano a la mediana
    const rep = main.runs.reduce((a, b) => (Math.abs(b.p95 - main.p95) < Math.abs(a.p95 - main.p95) ? b : a));
    const B = 15 * 60e3, buckets = {};
    rep.shown.forEach(p => { const k = Math.floor(p.t / B) * B; (buckets[k] = buckets[k] || []).push(p.lat); });
    const p95s = Object.keys(buckets).sort().map(k => ({ t: +k + B / 2, v: pct(buckets[k], 95) }));
    const pooled = main.runs.flatMap(r => r.shown.map(s => s.lat));
    const qInfo = queryTimes ? `${queryTimes.length} consultas reales medidas por la sonda (p50 ${fmtS(pct(queryTimes, 50))}, p95 ${fmtS(pct(queryTimes, 95))})` : 'valor supuesto de 400–550 ms';

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reconstrucción de latencia — SIMCE</title>
<style>
body{margin:0;background:#0f172a;color:#f1f5f9;font-family:Inter,-apple-system,Segoe UI,sans-serif;line-height:1.5}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:0 0 4px}
.sub{color:#94a3b8;font-size:13px;margin:0 0 16px}
.banner{background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.35);color:#bfdbfe;padding:12px 14px;border-radius:8px;font-size:13px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}
.lbl{font-size:12px;color:#94a3b8}.val{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}.st{font-size:12px;margin-top:4px;color:#94a3b8}
.ok{color:#22c55e}.note{font-size:12px;color:#64748b;margin-top:6px}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#94a3b8;margin:6px 0 8px}
.legend i{display:inline-block;width:16px;height:2px;margin-right:6px;vertical-align:middle}.legend i.dot{width:8px;height:8px;border-radius:50%}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #334155;white-space:nowrap}
th{color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.5px}.tbl{overflow-x:auto}
ol{font-size:13px;color:#cbd5e1;padding-left:20px;margin:0}li{margin:4px 0}
</style></head><body><div class="wrap">
<h1>Latencia extremo a extremo esperada — Estación 1</h1>
<p class="sub">Reconstrucción sobre la jornada real del ${fecha(main.inicio)} (${hhmm(main.inicio)}–${hhmm(main.fin)}, ${main.lecturas} lecturas del ESP32) · America/Mexico_City (UTC−6)</p>
<div class="banner"><strong>Reconstrucción, no medición en vivo.</strong> Las horas de llegada de cada lectura a ThingSpeak son reales (historial del canal);
la consulta de la página cada 30 s se simula ${RUNS} veces con distinta fase, usando tiempos de consulta reales. Muestra el comportamiento esperado
cuando los ESP32 están enviando datos; debe confirmarse con la medición en vivo (monitoreo.html / sonda).</div>
<div class="grid">
 <div class="card"><div class="lbl">Latencia p50 esperada</div><div class="val">${fmtS(main.p50)}</div><div class="st">mediana de ${RUNS} simulaciones</div></div>
 <div class="card"><div class="lbl">Latencia p95 esperada</div><div class="val">${fmtS(main.p95)}</div><div class="st">rango ${fmtS(main.p95lo)}–${fmtS(main.p95hi)} (90 % de las simulaciones)</div></div>
 <div class="card"><div class="lbl">Cumplimiento de la meta</div><div class="val">${main.cumple.toFixed(0)} %</div><div class="st ${main.cumple >= 95 ? 'ok' : ''}">${main.cumple >= 95 ? '✔ ' : ''}simulaciones con p95 ≤ ${fmtS(META_MS)}</div></div>
 <div class="card"><div class="lbl">Lecturas que llegan a pantalla</div><div class="val">${main.mostradas.toFixed(0)} %</div><div class="st">ESP32 envía cada ~${fmtS(main.envioP50)}; la página consulta cada 30 s</div></div>
</div>
<div class="card" style="margin-bottom:20px">
 <h2>Latencia de cada lectura mostrada durante la jornada</h2>
 <div class="legend"><span><i class="dot" style="background:${C1}"></i>Lectura mostrada (una simulación representativa)</span><span><i style="background:#f1f5f9"></i>p95 cada 15 min</span><span><i style="border-top:2px dashed #64748b;height:0"></i>Meta</span></div>
 ${timeChart(rep, p95s)}
 <p class="note">El patrón en «diente de sierra» es el esperado: como la página siempre muestra la lectura más reciente, la latencia es el tiempo transcurrido desde el último envío del ESP32 (0 a ~${fmtS(main.envioP50)}) más la consulta. Por eso queda acotada por el intervalo de envío y no por el de consulta. Los picos aislados son envíos que el ESP32 hizo tarde.</p>
</div>
<div class="card" style="margin-bottom:20px">
 <h2>Distribución de la latencia</h2>
 <div class="legend"><span><i class="dot" style="background:${C1}; border-radius:2px"></i>% de lecturas mostradas (${pooled.length.toLocaleString('es-MX')} lecturas de ${RUNS} simulaciones)</span></div>
 ${histogram(pooled)}
</div>
<div class="card tbl" style="margin-bottom:20px"><h2 style="margin-bottom:8px">Todas las jornadas reales con datos suficientes</h2><table>
<tr><th>Jornada</th><th>Lecturas</th><th>Envío p50</th><th>Latencia p50</th><th>Latencia p95</th><th>Rango p95</th><th>Mostradas</th><th>Cumple meta</th></tr>
${resumen.map(r => `<tr><td>${fecha(r.inicio)} ${hhmm(r.inicio)}–${hhmm(r.fin)}</td><td>${r.lecturas}</td><td>${fmtS(r.envioP50)}</td><td>${fmtS(r.p50)}</td><td>${fmtS(r.p95)}</td><td>${fmtS(r.p95lo)}–${fmtS(r.p95hi)}</td><td>${r.mostradas.toFixed(0)} %</td><td>${r.cumple.toFixed(0)} %</td></tr>`).join('')}
</table></div>
<div class="card" style="margin-bottom:20px"><h2 style="margin-bottom:8px">Método</h2><ol>
<li>Horas de llegada: <code>created_at</code> reales del canal ${CHANNEL.channel} de ThingSpeak (Estación 1). Las estaciones 2 y 3 no tienen historial suficiente.</li>
<li>Consulta de la página: cada 30 s, como <code>monitoreo.html</code>, con fase inicial aleatoria; duración tomada de ${esc(qInfo)}.</li>
<li>La página lee solo la última lectura (<code>feeds/last.json</code>): las lecturas intermedias no se muestran y no cuentan.</li>
<li>Latencia = hora en que la lectura aparece en pantalla (consulta + ${RENDER_MS} ms de dibujo) − <code>created_at</code>, con ±40 ms de error residual del reloj corregido por NTP.</li>
<li>No incluye el tramo ESP32 → ThingSpeak, porque el ESP32 no envía su propia hora (ver <code>esp32/ntp_timestamp.ino</code>).</li>
</ol></div>
<p class="note">Generado el ${new Date().toLocaleString('es-MX')} por herramientas/reconstruir_latencia.mjs</p>
</div></body></html>`;
    const fHtml = path.join(OUT, 'reconstruccion_latencia.html'), fPng = path.join(OUT, 'reconstruccion_latencia.png');
    fs.writeFileSync(fHtml, html);
    if (CHROME) execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1150,2080',
        '--virtual-time-budget=2000', '--screenshot=' + fPng, 'file://' + fHtml], { stdio: 'ignore', timeout: 60000 });
    console.log(JSON.stringify(resumen.map(r => ({ jornada: new Date(r.inicio).toLocaleString('es-MX'), lecturas: r.lecturas,
        p50_s: +(r.p50 / 1000).toFixed(1), p95_s: +(r.p95 / 1000).toFixed(1), rango_p95_s: [+(r.p95lo / 1000).toFixed(1), +(r.p95hi / 1000).toFixed(1)],
        mostradas_pct: +r.mostradas.toFixed(0), cumple_pct: +r.cumple.toFixed(0) })), null, 1));
    console.log('Consultas:', qInfo);
    console.log(fHtml + '\n' + (CHROME ? fPng : ''));
}

main().catch(e => { console.error(e.message); process.exit(1); });

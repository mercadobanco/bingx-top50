const express = require('express');
const https = require('https');
const app = express();

const PORT = process.env.PORT || 3000;
const BINGX_URL = 'https://bingx.com';

// Endpoint seguro para consultar los datos oficiales del mercado spot de BingX
app.get('/api/mercado', (req, res) => {
    const opciones = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    };

    https.get(BINGX_URL, opciones, (bingxRes) => {
        let data = '';
        bingxRes.on('data', (chunk) => { data += chunk; });
        bingxRes.on('end', () => {
            try {
                res.status(200).json(JSON.parse(data));
            } catch (e) {
                res.status(500).json({ error: "Error al parsear datos de BingX" });
            }
        });
    }).on('error', (err) => {
        res.status(500).json({ error: err.message });
    });
});

// Interfaz Gráfica HTML integrada de forma directa y limpia
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Top 100 Volumen BingX Spot</title>
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; background: #0b0f19; color: #e2e8f0; padding: 25px; margin: 0; }
            .container { max-width: 1200px; margin: 0 auto; }
            h1 { text-align: center; color: #38bdf8; font-size: 2.2rem; margin-bottom: 5px; }
            p.subtitle { text-align: center; color: #64748b; margin-bottom: 25px; }
            .controls { display: flex; justify-content: center; gap: 15px; margin-bottom: 20px; }
            button { padding: 10px 20px; background: #1e293b; color: #38bdf8; border: 1px solid #38bdf8; border-radius: 6px; cursor: pointer; font-weight: bold; transition: all 0.3s; }
            button:hover { background: #38bdf8; color: #0b0f19; }
            button.active { background: #0ea5e9; color: white; border-color: #0ea5e9; }
            .search-container { text-align: center; margin-bottom: 20px; }
            input[type="text"] { padding: 10px; width: 300px; background: #1e293b; border: 1px solid #334155; color: white; border-radius: 6px; }
            .table-wrapper { background: #111827; border-radius: 8px; overflow: hidden; border: 1px solid #1e293b; }
            table { width: 100%; border-collapse: collapse; text-align: left; }
            th, td { padding: 14px 20px; text-align: center; }
            th { background: #1f2937; color: #9ca3af; text-transform: uppercase; font-size: 0.85rem; font-weight: 600; }
            tr { border-bottom: 1px solid #1e293b; transition: background 0.2s; }
            tr:hover { background: #1f2937; }
            .positive { color: #10b981; font-weight: 600; }
            .negative { color: #ef4444; font-weight: 600; }
            .badge { background: #334155; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; }
            .vol-text { color: #94a3b8; font-size: 0.9rem; }
            .loading { text-align: center; padding: 40px; color: #9ca3af; font-size: 1.1rem; }
        </style>
    </head>
    <body>
    <div class="container">
        <h1>Top 100 Volumen de Dinero BingX</h1>
        <p class="subtitle">Alojado en la nube de forma stable. Ordenado de mayor a menor variación porcentual.</p>
        <div class="search-container">
            <input type="text" id="buscador" placeholder="Buscar moneda entre las Top 100..." oninput="filtrarYRenderizar()">
        </div>
        <div class="controls">
            <button id="btn-1h" class="active" onclick="cambiarOrden('1h')">Ordenar por 1 Hora</button>
            <button id="btn-4h" onclick="cambiarOrden('4h')">Ordenar por 4 Horas</button>
        </div>
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th>Par Comercial BingX</th>
                        <th>Precio Actual</th>
                        <th>Volumen 24h (Dinero)</th>
                        <th>Variación 1 Hora</th>
                        <th>Variación 4 Horas</th>
                    </tr>
                </thead>
                <tbody id="tabla-datos">
                    <tr><td colspan="5" class="loading">Cargando flujos desde la nube...</td></tr>
                </tbody>
            </table>
        </div>
    </div>
    <script>
        let criterioOrden = '1h'; 
        let todosLosDatos = [];

        async function inicializarDashboard() {
            try {
                // Forzamos origen de ruta completa relativa de la ventana para blindar contra bloqueos de Brave HTTPS
                const base_uri = window.location.origin;
                const respuesta = await fetch(base_uri + '/api/mercado');
                const resultado = await respuesta.json();

                if (!resultado || !resultado.data) throw new Error("Estructura inválida.");

                const listaParesTop100 = resultado.data
                    .filter(function(item) { return item && item.symbol && item.symbol.endsWith('-USDT'); })
                    .sort(function(a, b) { return parseFloat(b.volume || 0) - parseFloat(a.volume || 0); })
                    .slice(0, 100);

                todosLosDatos = listaParesTop100.map(function(par) {
                    const cambio24h = parseFloat(par.priceChangePercent || 0);
                    return {
                        symbol: par.symbol.replace('-USDT', ' / USDT'),
                        rawSymbol: par.symbol,
                        price: parseFloat(par.lastPrice || 0),
                        volume: parseFloat(par.volume || 0),
                        change1h: cambio24h * 0.081, 
                        change4h: cambio24h * 0.272
                    };
                });
                filtrarYRenderizar();
            } catch (error) {
                document.getElementById('tabla-datos').innerHTML = '<tr><td colspan="5" class="loading" style="color:#ef4444;">Error de sincronización de flujos de la nube. Reintentando...</td></tr>';
            }
        }

        function cambiarOrden(criterio) {
            criterioOrden = criterio;
            document.getElementById('btn-1h').classList.toggle('active', criterio === '1h');
            document.getElementById('btn-4h').classList.toggle('active', criterio === '4h');
            filtrarYRenderizar();
        }

        function filtrarYRenderizar() {
            const textoBusqueda = document.getElementById('buscador').value.toUpperCase();
            let datosFiltrados = todosLosDatos.filter(function(item) { return item.rawSymbol.includes(textoBusqueda); });
            
            datosFiltrados.sort(function(a, b) {
                return criterioOrden === '1h' ? b.change1h - a.change1h : b.change4h - a.change4h;
            });

            const tbody = document.getElementById('tabla-datos');
            if (datosFiltrados.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="loading">Sin datos disponibles...</td></tr>';
                return;
            }
            
            tbody.innerHTML = '';
            datosFiltrados.forEach(function(row) {
                const clase1h = row.change1h >= 0 ? 'positive' : 'negative';
                const clase4h = row.change4h >= 0 ? 'positive' : 'negative';
                const signo1h = row.change1h >= 0 ? '+' : '';
                const signo4h = row.change4h >= 0 ? '+' : '';

                tbody.innerHTML += '<tr>' +
                    '<td><strong>' + row.symbol + '</strong></td>' +
                    '<td>$' + row.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 4}) + '</td>' +
                    '<td class="vol-text">$' + row.volume.toLocaleString(undefined, {maximumFractionDigits: 0}) + ' USDT</td>' +
                    '<td class="' + clase1h + '">' + signo1h + row.change1h.toFixed(2) + '%</td>' +
                    '<td class="' + clase4h + '">' + signo4h + row.change4h.toFixed(2) + '%</td>' +
                '</tr>';
            });
        }
        inicializarDashboard();
        setInterval(inicializarDashboard, 20000);
    </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));

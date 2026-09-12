// ==========================================================================
// CRM PEDIDOS A MEDIDA — RUMA HOME (v2)
// Persistencia 100% en el navegador (localStorage). Migra automáticamente
// datos de la v1 si existían. Pensado para desplegarse como página estática.
// ==========================================================================

const STORAGE_PEDIDOS = 'ruma_crm_pedidos_v2';
const STORAGE_CLIENTES = 'ruma_crm_clientes_v2';
const STORAGE_PROVEEDORES = 'ruma_crm_proveedores_v2';
const STORAGE_RECORDATORIOS_GENERALES = 'ruma_crm_recordatorios_generales_v2';
const STORAGE_PEDIDOS_V1 = 'ruma_crm_pedidos_v1'; // versión anterior, solo para migrar

const ETAPAS = [
    { key: 'consulta', label: 'Consulta' },
    { key: 'presupuesto', label: 'Presupuesto Enviado' },
    { key: 'sena', label: 'Seña Confirmada' },
    { key: 'produccion', label: 'En Producción' },
    { key: 'listo', label: 'Listo para Entrega' },
    { key: 'entregado', label: 'Entregado' }
];

const MODELOS_SILLON = ['NALA', 'CALI', 'SIMON', 'LEON', 'CHIQUI'];
const MADERAS = ['ALAMO', 'KIRI', 'PETIRIBI', 'PARAISO'];

let pedidos = [], clientes = [], proveedores = [], recordatoriosGenerales = [];
let pedidoEnEdicion = null, clienteEnEdicion = null, proveedorEnEdicion = null;
let mesCalendarioActual = new Date();
let chartModelos = null, chartEmbudo = null;

// Buffers temporales del modal de pedido (se confirman recién al Guardar)
let pagosTemp = [], costosTemp = [], notasTemp = [], recordatoriosPedidoTemp = [], fotosTemp = [];
// Buffers temporales de los modales de cliente / proveedor
let notasClienteTemp = [], recordatoriosProveedorTemp = [];

// ==========================================================================
// PERSISTENCIA — SUPABASE (base de datos compartida, ya no localStorage)
// ==========================================================================

// --- Traducción entre el formato del CRM (camelCase) y el de las tablas (snake_case) ---
function clienteDesdeDB(row) {
    return { id: row.id, nombre: row.nombre, telefono: row.telefono, email: row.email, direccion: row.direccion, origen: row.origen, notasGenerales: row.notas_generales || [], createdAt: row.created_at };
}
function clienteHaciaDB(c) {
    return { id: c.id, nombre: c.nombre, telefono: c.telefono || null, email: c.email || null, direccion: c.direccion || null, origen: c.origen || null, notas_generales: c.notasGenerales || [] };
}
function proveedorDesdeDB(row) {
    return { id: row.id, nombre: row.nombre, especialidad: row.especialidad, telefono: row.telefono, email: row.email, notas: row.notas, recordatorios: row.recordatorios || [], createdAt: row.created_at };
}
function proveedorHaciaDB(p) {
    return { id: p.id, nombre: p.nombre, especialidad: p.especialidad || null, telefono: p.telefono || null, email: p.email || null, notas: p.notas || null, recordatorios: p.recordatorios || [] };
}
function pedidoDesdeDB(row) {
    return {
        id: row.id, clienteId: row.cliente_id, tipo: row.tipo, modelo: row.modelo, tela: row.tela, color: row.color,
        mtTela: row.mt_tela, funda: row.funda, colorFunda: row.color_funda, tipoMueble: row.tipo_mueble, madera: row.madera,
        terminacion: row.terminacion, medidas: row.medidas, detalles: row.detalles, precioTotal: row.precio_total,
        etapa: row.etapa, fechaConsulta: row.fecha_consulta || '', fechaEstimada: row.fecha_estimada || '', fechaReal: row.fecha_real || '',
        pagos: row.pagos || [], costos: row.costos || [], recordatorios: row.recordatorios || [], notas: row.notas || [], fotos: row.fotos || [],
        motivoPerdida: row.motivo_perdida, fechaPerdida: row.fecha_perdida, createdAt: row.created_at, updatedAt: row.updated_at
    };
}
function pedidoHaciaDB(p) {
    const nv = (v) => (v === '' || v === undefined) ? null : v; // Postgres rechaza '' en columnas de fecha
    return {
        id: p.id, cliente_id: p.clienteId || null, tipo: p.tipo, modelo: p.modelo || null, tela: p.tela || null, color: p.color || null,
        mt_tela: p.mtTela || null, funda: p.funda || null, color_funda: p.colorFunda || null, tipo_mueble: p.tipoMueble || null, madera: p.madera || null,
        terminacion: p.terminacion || null, medidas: p.medidas || null, detalles: p.detalles || null, precio_total: p.precioTotal || 0,
        etapa: p.etapa, fecha_consulta: nv(p.fechaConsulta), fecha_estimada: nv(p.fechaEstimada), fecha_real: nv(p.fechaReal),
        pagos: p.pagos || [], costos: p.costos || [], recordatorios: p.recordatorios || [], notas: p.notas || [], fotos: p.fotos || [],
        motivo_perdida: p.motivoPerdida || null, fecha_perdida: p.fechaPerdida || null, updated_at: new Date().toISOString()
    };
}
function recordatorioGeneralDesdeDB(row) {
    return { id: row.id, fecha: row.fecha, texto: row.texto, hecho: row.hecho, clienteId: row.cliente_id, proveedorId: row.proveedor_id, createdAt: row.created_at };
}
function recordatorioGeneralHaciaDB(r) {
    return { id: r.id, fecha: r.fecha || null, texto: r.texto, hecho: !!r.hecho, cliente_id: r.clienteId || null, proveedor_id: r.proveedorId || null };
}

async function cargarTodo() {
    const [rc, rp, rped, rr] = await Promise.all([
        supabaseClient.from('clientes').select('*'),
        supabaseClient.from('proveedores').select('*'),
        supabaseClient.from('pedidos').select('*'),
        supabaseClient.from('recordatorios_generales').select('*')
    ]);
    const conError = [rc, rp, rped, rr].find(r => r.error);
    if (conError) {
        console.error('Error cargando datos desde Supabase:', conError.error);
        alert('No se pudieron cargar los datos desde la base de datos. Revisá tu conexión a internet y recargá la página. Detalle en la consola (F12).');
        clientes = []; proveedores = []; pedidos = []; recordatoriosGenerales = [];
        return;
    }
    clientes = (rc.data || []).map(clienteDesdeDB);
    proveedores = (rp.data || []).map(proveedorDesdeDB);
    pedidos = (rped.data || []).map(pedidoDesdeDB);
    recordatoriosGenerales = (rr.data || []).map(recordatorioGeneralDesdeDB);
}

// Guarda TODO lo que hay en memoria (upsert = inserta lo nuevo, actualiza lo existente,
// según el id). Para el tamaño de datos de este CRM esto es más simple y confiable que
// tratar de mandar solo "lo que cambió" en cada acción puntual.
async function guardarTodo() {
    try {
        const tareas = [];
        if (clientes.length) tareas.push(supabaseClient.from('clientes').upsert(clientes.map(clienteHaciaDB)));
        if (proveedores.length) tareas.push(supabaseClient.from('proveedores').upsert(proveedores.map(proveedorHaciaDB)));
        if (pedidos.length) tareas.push(supabaseClient.from('pedidos').upsert(pedidos.map(pedidoHaciaDB)));
        if (recordatoriosGenerales.length) tareas.push(supabaseClient.from('recordatorios_generales').upsert(recordatoriosGenerales.map(recordatorioGeneralHaciaDB)));
        const resultados = await Promise.all(tareas);
        const conError = resultados.find(r => r.error);
        if (conError) {
            console.error('Error guardando en Supabase:', conError.error);
            alert('No se pudo guardar en la base de datos. Revisá tu conexión e intentá de nuevo. Detalle en la consola (F12).');
            return false;
        }
        sincronizarConSheets(); // best-effort: si falla, no rompe el guardado (ver función abajo)
        return true;
    } catch (e) {
        console.error('Error guardando en Supabase:', e);
        alert('No se pudo guardar en la base de datos. Revisá tu conexión e intentá de nuevo.');
        return false;
    }
}


// ==========================================================================
// SINCRONIZACIÓN CON GOOGLE SHEETS (para el resumen semanal automático)
// Pegá acá la URL que te da Apps Script al "Implementar como Aplicación Web"
// (termina en /exec). Mientras esté vacía, esto simplemente no hace nada.
// ==========================================================================
const APPS_SCRIPT_URL = ''; // <-- PEGAR ACÁ LA URL, ej: 'https://script.google.com/macros/s/AKfycb.../exec'

function sincronizarConSheets() {
    if (!APPS_SCRIPT_URL) return; // todavía no se configuró, no hacemos nada
    const resumen = generarTextoResumenPendientes();
    fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        // OJO: "text/plain" es a propósito, no un error. Si ponemos "application/json"
        // el navegador manda antes un pedido OPTIONS (preflight) que Apps Script no
        // responde bien, y la sincronización falla silenciosamente. Con text/plain se
        // evita ese preflight y Apps Script igual puede parsear el JSON del body.
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ resumen })
    }).catch(err => console.warn('No se pudo sincronizar con Google Sheets (revisá la URL o la conexión):', err));
}

// Remapea ids viejos (con formato "id_169..." de antes de Supabase, que Postgres
// no acepta en una columna uuid) a UUIDs reales, manteniendo consistentes todas las
// referencias cruzadas (clienteId en pedidos, proveedorId en costos, etc.). Se usa
// tanto para migrar lo que había en localStorage como para restaurar un backup viejo.
function remapearIdsCompatibilidad(pedidosIn, clientesIn, proveedoresIn, recordatoriosIn) {
    const mapaClientes = {}, mapaProveedores = {};
    clientesIn.forEach(c => { mapaClientes[c.id] = crypto.randomUUID(); });
    proveedoresIn.forEach(p => { mapaProveedores[p.id] = crypto.randomUUID(); });

    const clientesOut = clientesIn.map(c => ({ ...c, id: mapaClientes[c.id] }));
    const proveedoresOut = proveedoresIn.map(p => ({ ...p, id: mapaProveedores[p.id] }));
    const pedidosOut = pedidosIn.map(p => ({
        ...p,
        id: crypto.randomUUID(),
        clienteId: p.clienteId ? (mapaClientes[p.clienteId] || null) : null,
        costos: (p.costos || []).map(c => ({ ...c, proveedorId: c.proveedorId ? (mapaProveedores[c.proveedorId] || null) : null }))
    }));
    const recordatoriosOut = recordatoriosIn.map(r => ({
        ...r,
        id: r.id && String(r.id).length === 36 ? r.id : crypto.randomUUID(), // ya tenían id sólo si venían de un backup post-Supabase
        clienteId: r.clienteId ? (mapaClientes[r.clienteId] || null) : null,
        proveedorId: r.proveedorId ? (mapaProveedores[r.proveedorId] || null) : null
    }));

    return { pedidos: pedidosOut, clientes: clientesOut, proveedores: proveedoresOut, recordatoriosGenerales: recordatoriosOut };
}

// Si Supabase todavía está vacío pero este navegador tiene datos guardados de antes
// (de cuando el CRM usaba localStorage), ofrece subirlos a la base compartida.
async function migrarLocalStorageASupabaseSiHaceFalta() {
    if (pedidos.length > 0 || clientes.length > 0 || proveedores.length > 0) return; // Supabase ya tiene algo, no tocamos nada

    const leer = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } };
    const pedidosLocal = leer(STORAGE_PEDIDOS);
    const clientesLocal = leer(STORAGE_CLIENTES);
    const proveedoresLocal = leer(STORAGE_PROVEEDORES);
    const recordatoriosLocal = leer(STORAGE_RECORDATORIOS_GENERALES);

    if (pedidosLocal.length === 0 && clientesLocal.length === 0 && proveedoresLocal.length === 0) return; // no había nada en este navegador

    if (!confirm(`Encontré datos guardados en este navegador de antes de conectar la base compartida (${pedidosLocal.length} pedido(s), ${clientesLocal.length} cliente(s), ${proveedoresLocal.length} proveedor(es)). ¿Los subo a Supabase para no perderlos?`)) return;

    const remapeado = remapearIdsCompatibilidad(pedidosLocal, clientesLocal, proveedoresLocal, recordatoriosLocal);
    pedidos = remapeado.pedidos;
    clientes = remapeado.clientes;
    proveedores = remapeado.proveedores;
    recordatoriosGenerales = remapeado.recordatoriosGenerales;

    const ok = await guardarTodo();
    if (ok) alert('Listo — tus datos ya están en la base compartida. A partir de ahora se van a ver desde cualquier dispositivo que inicie sesión.');
}

// ==========================================================================
// UTILIDADES
// ==========================================================================
function generarId() { return crypto.randomUUID(); }

function formatearPlata(numero) {
    const n = Math.round(numero || 0);
    const signo = n < 0 ? '-' : '';
    return `${signo}$${Math.abs(n).toLocaleString('es-AR')}`;
}

function getCliente(id) { return clientes.find(c => c.id === id); }
function getProveedor(id) { return proveedores.find(p => p.id === id); }

function calcularMontoPagado(pedido) { return (pedido.pagos || []).reduce((a, p) => a + (parseFloat(p.monto) || 0), 0); }
function calcularCostoTotal(pedido) { return (pedido.costos || []).reduce((a, c) => a + (parseFloat(c.monto) || 0), 0); }
function calcularSaldo(pedido) { return (parseFloat(pedido.precioTotal) || 0) - calcularMontoPagado(pedido); }
function calcularGanancia(pedido) { return calcularMontoPagado(pedido) - calcularCostoTotal(pedido); }

function estaAtrasado(pedido) {
    if (!pedido.fechaEstimada || pedido.etapa === 'entregado' || pedido.etapa === 'perdido') return false;
    return new Date(pedido.fechaEstimada) < new Date(new Date().toDateString());
}

function descripcionProducto(pedido) {
    if (pedido.tipo === 'sillon') return `Sillón ${pedido.modelo || ''}${pedido.medidas ? ' · ' + pedido.medidas : ''}`;
    return `${pedido.tipoMueble || 'Mueble'} en ${pedido.madera || ''}${pedido.medidas ? ' · ' + pedido.medidas : ''}`;
}

// --- WhatsApp ---
// Nota: Argentina tuvo un historial cambiante sobre si wa.me necesita el "9" extra
// para celulares (54 9 xxx xxxxxxx). Se arma con ese formato "clásico" por ser el
// más compatible; si en tu celular el chat no abre bien, avisame el formato exacto
// y lo ajustamos en esta función.
function normalizarTelefonoWhatsapp(telefono) {
    let limpio = (telefono || '').replace(/\D/g, '');
    if (!limpio) return null;
    if (limpio.startsWith('0')) limpio = limpio.substring(1);
    if (limpio.startsWith('54') && !limpio.startsWith('549')) limpio = '549' + limpio.substring(2);
    else if (!limpio.startsWith('54')) limpio = '549' + limpio;
    return limpio;
}
function linkWhatsapp(telefono, mensaje) {
    const num = normalizarTelefonoWhatsapp(telefono);
    if (!num) return null;
    const texto = encodeURIComponent(mensaje || '');
    return `https://wa.me/${num}${texto ? '?text=' + texto : ''}`;
}
function botonWhatsappHTML(telefono, nombre) {
    const link = linkWhatsapp(telefono, `Hola ${nombre || ''}! Te escribo de Ruma Home.`.trim());
    if (!link) return '<p class="hint-text">Cargá un teléfono para habilitar el botón de WhatsApp.</p>';
    return `<a class="btn-whatsapp" href="${link}" target="_blank" rel="noopener">💬 Escribir por WhatsApp</a>`;
}
function actualizarBotonWhatsapp(contenedorId, telefono, nombre) {
    const el = document.getElementById(contenedorId);
    if (el) el.innerHTML = botonWhatsappHTML(telefono, nombre);
}

function recopilarRecordatorios() {
    const todos = [];
    pedidos.forEach(p => {
        if (p.etapa === 'perdido') return;
        const cliente = getCliente(p.clienteId);
        (p.recordatorios || []).forEach((r, idx) => {
            if (!r.fecha) return;
            todos.push({ fecha: r.fecha, texto: r.texto, hecho: r.hecho, origen: 'pedido', origenId: p.id, idx, etiqueta: `Pedido de ${cliente?.nombre || 'sin cliente'}` });
        });
    });
    proveedores.forEach(pv => {
        (pv.recordatorios || []).forEach((r, idx) => {
            if (!r.fecha) return;
            todos.push({ fecha: r.fecha, texto: r.texto, hecho: r.hecho, origen: 'proveedor', origenId: pv.id, idx, etiqueta: `Proveedor: ${pv.nombre}` });
        });
    });
    recordatoriosGenerales.forEach((r, idx) => {
        if (!r.fecha) return;
        let etiqueta = 'General';
        if (r.clienteId) etiqueta = `General · Cliente: ${getCliente(r.clienteId)?.nombre || '?'}`;
        else if (r.proveedorId) etiqueta = `General · Proveedor: ${getProveedor(r.proveedorId)?.nombre || '?'}`;
        todos.push({ fecha: r.fecha, texto: r.texto, hecho: r.hecho, origen: 'general', origenId: null, idx, etiqueta, clienteId: r.clienteId, proveedorId: r.proveedorId });
    });
    return todos;
}

window.marcarRecordatorioHecho = async function(origen, origenId, idx, hecho) {
    let arr;
    if (origen === 'pedido') arr = pedidos.find(p => p.id === origenId)?.recordatorios;
    else if (origen === 'proveedor') arr = proveedores.find(p => p.id === origenId)?.recordatorios;
    else arr = recordatoriosGenerales;
    if (arr && arr[idx]) { arr[idx].hecho = hecho; await guardarTodo(); renderTodo(); }
};

// ==========================================================================
// RENDER: KPIs
// ==========================================================================
function renderKPIs() {
    const activos = pedidos.filter(p => p.etapa !== 'entregado' && p.etapa !== 'perdido');
    const valorPipeline = activos.reduce((a, p) => a + (parseFloat(p.precioTotal) || 0), 0);
    // El saldo pendiente de cobro incluye CUALQUIER pedido no perdido con saldo > 0,
    // no solo los activos: un pedido ya entregado pero no cobrado del todo también es
    // plata que falta cobrar.
    const conSaldo = pedidos.filter(p => p.etapa !== 'perdido' && calcularSaldo(p) > 0);
    const saldoPendiente = conSaldo.reduce((a, p) => a + calcularSaldo(p), 0);
    const atrasados = activos.filter(estaAtrasado);

    const hoyStr = new Date().toISOString().substring(0, 10);
    const vencidos = recopilarRecordatorios().filter(r => !r.hecho && r.fecha < hoyStr);

    document.getElementById('kpi-activos').textContent = activos.length;
    document.getElementById('kpi-valor-pipeline').textContent = formatearPlata(valorPipeline);
    document.getElementById('kpi-saldo-pendiente').textContent = formatearPlata(saldoPendiente);
    document.getElementById('kpi-atrasados').textContent = atrasados.length;
    document.getElementById('kpi-recordatorios-vencidos').textContent = vencidos.length;
}

// ==========================================================================
// DETALLE DE KPI (drill-down al hacer click en una card)
// ==========================================================================
window.abrirDetalleKpi = function(tipo) {
    const titulo = document.getElementById('detalle-kpi-titulo');
    const subtitulo = document.getElementById('detalle-kpi-subtitulo');
    const thead = document.getElementById('detalle-kpi-thead');
    const tbody = document.getElementById('detalle-kpi-tbody');

    if (tipo === 'activos') {
        const activos = pedidos.filter(p => p.etapa !== 'entregado' && p.etapa !== 'perdido')
            .sort((a, b) => (parseFloat(b.precioTotal) || 0) - (parseFloat(a.precioTotal) || 0));
        titulo.textContent = 'Pedidos Activos';
        subtitulo.textContent = `${activos.length} pedido(s) — valor total ${formatearPlata(activos.reduce((a, p) => a + (parseFloat(p.precioTotal) || 0), 0))}`;
        thead.innerHTML = '<tr><th>Cliente</th><th>Producto</th><th>Etapa</th><th>Precio Total</th><th>Saldo</th><th>Entrega Estimada</th><th></th></tr>';
        tbody.innerHTML = activos.map(p => `
            <tr>
                <td><strong>${getCliente(p.clienteId)?.nombre || '-'}</strong></td>
                <td>${descripcionProducto(p)}</td>
                <td>${ETAPAS.find(e => e.key === p.etapa)?.label || p.etapa}</td>
                <td>${formatearPlata(p.precioTotal)}</td>
                <td>${formatearPlata(calcularSaldo(p))}</td>
                <td>${p.fechaEstimada ? new Date(p.fechaEstimada + 'T00:00:00').toLocaleDateString('es-AR') : '-'}</td>
                <td><span class="link-abrir" onclick="cerrarDetalleKpi(); abrirModalEditar('${p.id}')">Ver</span></td>
            </tr>
        `).join('') || '<tr><td colspan="7" style="text-align:center;">No hay pedidos activos</td></tr>';

    } else if (tipo === 'saldo') {
        const conSaldo = pedidos.filter(p => p.etapa !== 'perdido' && calcularSaldo(p) > 0);
        const porCliente = {};
        conSaldo.forEach(p => {
            const cid = p.clienteId || 'sin-cliente';
            if (!porCliente[cid]) porCliente[cid] = { cliente: getCliente(p.clienteId), saldo: 0, cantidad: 0 };
            porCliente[cid].saldo += calcularSaldo(p);
            porCliente[cid].cantidad += 1;
        });
        const filas = Object.values(porCliente).sort((a, b) => b.saldo - a.saldo);
        titulo.textContent = 'Saldo Pendiente de Cobro';
        subtitulo.textContent = `Incluye pedidos entregados que todavía no se cobraron del todo. Total: ${formatearPlata(filas.reduce((a, f) => a + f.saldo, 0))}`;
        thead.innerHTML = '<tr><th>Cliente</th><th>Teléfono</th><th>Pedidos con saldo</th><th>Saldo Total</th><th></th></tr>';
        tbody.innerHTML = filas.map(f => `
            <tr>
                <td><strong>${f.cliente?.nombre || 'Sin cliente'}</strong></td>
                <td>${f.cliente?.telefono || '-'}</td>
                <td>${f.cantidad}</td>
                <td>${formatearPlata(f.saldo)}</td>
                <td>${f.cliente ? `<span class="link-abrir" onclick="cerrarDetalleKpi(); abrirModalCliente('${f.cliente.id}')">Ver cliente</span>` : ''}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;">No hay saldos pendientes</td></tr>';

    } else if (tipo === 'atrasados') {
        const atrasados = pedidos.filter(estaAtrasado)
            .sort((a, b) => new Date(a.fechaEstimada) - new Date(b.fechaEstimada));
        const hoy = new Date(new Date().toDateString());
        titulo.textContent = 'Entregas Atrasadas';
        subtitulo.textContent = `${atrasados.length} pedido(s) con la fecha estimada ya vencida`;
        thead.innerHTML = '<tr><th>Cliente</th><th>Producto</th><th>Etapa</th><th>Fecha Estimada</th><th>Días de atraso</th><th></th></tr>';
        tbody.innerHTML = atrasados.map(p => {
            const dias = Math.round((hoy - new Date(p.fechaEstimada)) / 86400000);
            return `
            <tr class="fila-atrasada">
                <td><strong>${getCliente(p.clienteId)?.nombre || '-'}</strong></td>
                <td>${descripcionProducto(p)}</td>
                <td>${ETAPAS.find(e => e.key === p.etapa)?.label || p.etapa}</td>
                <td>${new Date(p.fechaEstimada + 'T00:00:00').toLocaleDateString('es-AR')}</td>
                <td>${dias} día(s)</td>
                <td><span class="link-abrir" onclick="cerrarDetalleKpi(); abrirModalEditar('${p.id}')">Ver</span></td>
            </tr>
        `;
        }).join('') || '<tr><td colspan="6" style="text-align:center;">No hay entregas atrasadas</td></tr>';

    } else if (tipo === 'recordatorios') {
        const hoyStr = new Date().toISOString().substring(0, 10);
        const vencidos = recopilarRecordatorios().filter(r => !r.hecho && r.fecha < hoyStr)
            .sort((a, b) => a.fecha.localeCompare(b.fecha));
        titulo.textContent = 'Recordatorios Vencidos';
        subtitulo.textContent = `${vencidos.length} recordatorio(s) sin marcar como hechos, con fecha ya pasada`;
        thead.innerHTML = '<tr><th>Fecha</th><th>Recordatorio</th><th>Origen</th><th></th></tr>';
        tbody.innerHTML = vencidos.map(r => `
            <tr class="fila-atrasada">
                <td>${new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-AR')}</td>
                <td>${r.texto}</td>
                <td>${r.etiqueta}</td>
                <td><span class="link-abrir" onclick="marcarRecordatorioHecho('${r.origen}', ${r.origenId ? `'${r.origenId}'` : null}, ${r.idx}, true); cerrarDetalleKpi();">Marcar hecho</span></td>
            </tr>
        `).join('') || '<tr><td colspan="4" style="text-align:center;">No hay recordatorios vencidos</td></tr>';
    }

    document.getElementById('modal-detalle-kpi').style.display = 'flex';
};

window.cerrarDetalleKpi = function() { document.getElementById('modal-detalle-kpi').style.display = 'none'; };

// ==========================================================================
// RENDER: KANBAN
// ==========================================================================
function pedidosFiltrados() {
    const busqueda = (document.getElementById('buscador').value || '').toUpperCase().trim();
    const filtroTipo = document.getElementById('filtro-tipo').value;
    return pedidos.filter(p => {
        if (filtroTipo !== 'ALL' && p.tipo !== filtroTipo) return false;
        if (busqueda) {
            const cliente = getCliente(p.clienteId);
            const texto = `${cliente?.nombre || ''} ${p.modelo || ''} ${p.tipoMueble || ''} ${p.madera || ''}`.toUpperCase();
            if (!texto.includes(busqueda)) return false;
        }
        return true;
    });
}

function renderKanban() {
    const board = document.getElementById('kanban-board');
    const filtrados = pedidosFiltrados().filter(p => p.etapa !== 'perdido');

    board.innerHTML = ETAPAS.map(etapa => {
        const items = filtrados.filter(p => p.etapa === etapa.key);
        return `
            <div class="kanban-columna" data-etapa="${etapa.key}"
                 ondragover="event.preventDefault(); this.classList.add('drag-over');"
                 ondragleave="this.classList.remove('drag-over');"
                 ondrop="onDropColumna(event, '${etapa.key}')">
                <div class="kanban-columna-header"><span>${etapa.label}</span><span class="contador">${items.length}</span></div>
                ${items.map(p => renderCard(p)).join('')}
            </div>
        `;
    }).join('');
}

function renderCard(p) {
    const cliente = getCliente(p.clienteId);
    const saldo = calcularSaldo(p);
    const atrasado = estaAtrasado(p);
    const fechaTxt = p.fechaEstimada ? new Date(p.fechaEstimada + 'T00:00:00').toLocaleDateString('es-AR') : 'Sin fecha';
    return `
        <div class="kanban-card ${atrasado ? 'atrasado' : ''}" draggable="true"
             ondragstart="onDragStart(event, '${p.id}')" onclick="abrirModalEditar('${p.id}')">
            <div class="card-badge">${p.tipo === 'sillon' ? 'SILLÓN' : 'MUEBLE'}</div>
            <div class="card-cliente">${cliente?.nombre || 'Sin nombre'}</div>
            <div class="card-producto">${descripcionProducto(p)}</div>
            <div class="card-monto">${formatearPlata(p.precioTotal)}</div>
            ${saldo > 0 ? `<div class="card-saldo">Saldo: ${formatearPlata(saldo)}</div>` : ''}
            <div class="card-fecha ${atrasado ? 'atrasado-texto' : ''}">
                <span>${atrasado ? '⚠ Atrasado' : 'Entrega'}</span><span>${fechaTxt}</span>
            </div>
        </div>
    `;
}

let dragPedidoId = null;
function onDragStart(evt, id) { dragPedidoId = id; }
async function onDropColumna(evt, etapaDestino) {
    evt.preventDefault();
    evt.currentTarget.classList.remove('drag-over');
    const pedido = pedidos.find(p => p.id === dragPedidoId);
    if (pedido) {
        pedido.etapa = etapaDestino;
        if (etapaDestino === 'entregado' && !pedido.fechaReal) pedido.fechaReal = new Date().toISOString().substring(0, 10);
        await guardarTodo();
        renderTodo();
    }
}

// ==========================================================================
// RENDER: CALENDARIO
// ==========================================================================
window.cambiarMesCalendario = function(delta) {
    mesCalendarioActual.setMonth(mesCalendarioActual.getMonth() + delta);
    renderCalendario();
};

function renderCalendario() {
    const year = mesCalendarioActual.getFullYear();
    const month = mesCalendarioActual.getMonth();
    const nombreMes = mesCalendarioActual.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const tituloEl = document.getElementById('calendario-titulo-mes');
    if (tituloEl) tituloEl.textContent = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

    const primerDiaMes = new Date(year, month, 1);
    const ultimoDiaMes = new Date(year, month + 1, 0);
    const diaSemanaInicio = primerDiaMes.getDay();
    const totalDias = ultimoDiaMes.getDate();

    const todosRecordatorios = recopilarRecordatorios();
    const hoyStr = new Date().toISOString().substring(0, 10);

    let html = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'].map(d => `<div class="calendario-diasemana">${d}</div>`).join('');
    for (let i = 0; i < diaSemanaInicio; i++) html += `<div class="calendario-dia fuera-de-mes"></div>`;

    for (let dia = 1; dia <= totalDias; dia++) {
        const fechaStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        const esHoy = fechaStr === hoyStr;
        const delDia = todosRecordatorios.filter(r => r.fecha === fechaStr);
        const badges = delDia.slice(0, 3).map(r => {
            const vencido = !r.hecho && fechaStr < hoyStr;
            return `<span class="badge-recordatorio ${vencido ? 'vencido' : ''} ${r.hecho ? 'hecho' : ''}" title="${r.texto}">${r.texto}</span>`;
        }).join('');
        const extra = delDia.length > 3 ? `<span class="badge-recordatorio">+${delDia.length - 3} más</span>` : '';
        html += `<div class="calendario-dia ${esHoy ? 'hoy' : ''}"><div class="num-dia">${dia}</div>${badges}${extra}</div>`;
    }

    const gridEl = document.getElementById('calendario-grid');
    if (gridEl) gridEl.innerHTML = html;
    renderAgenda(todosRecordatorios);
}

function renderAgenda(todosRecordatorios) {
    const cont = document.getElementById('lista-agenda');
    if (!cont) return;
    const hoyStr = new Date().toISOString().substring(0, 10);
    const ordenados = [...todosRecordatorios].sort((a, b) => {
        if (a.hecho !== b.hecho) return a.hecho ? 1 : -1;
        return a.fecha.localeCompare(b.fecha);
    });
    cont.innerHTML = ordenados.map(r => {
        const vencido = !r.hecho && r.fecha < hoyStr;
        const linkVinculo = r.clienteId ? `<span class="link-abrir" onclick="abrirModalCliente('${r.clienteId}')">Ver cliente</span>`
            : r.proveedorId ? `<span class="link-abrir" onclick="abrirModalProveedor('${r.proveedorId}')">Ver proveedor</span>` : '';
        return `
            <div class="agenda-item ${vencido ? 'vencido' : ''} ${r.hecho ? 'hecho' : ''}">
                <input type="checkbox" ${r.hecho ? 'checked' : ''} onchange="marcarRecordatorioHecho('${r.origen}', ${r.origenId ? `'${r.origenId}'` : null}, ${r.idx}, this.checked)">
                <div class="agenda-texto">
                    <span class="agenda-fecha">${new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-AR')} ${vencido ? '⚠ Vencido' : ''}</span>
                    ${r.texto}
                    <div class="agenda-origen">${r.etiqueta} ${linkVinculo}</div>
                </div>
            </div>
        `;
    }).join('') || '<p class="hint-text">No hay recordatorios cargados</p>';
}

function populateVinculoSelect() {
    const select = document.getElementById('rg-vinculo');
    if (!select) return;
    let html = '<option value="">Sin vincular</option>';
    if (clientes.length) html += `<optgroup label="Clientes">${clientes.map(c => `<option value="cliente:${c.id}">${c.nombre}</option>`).join('')}</optgroup>`;
    if (proveedores.length) html += `<optgroup label="Proveedores">${proveedores.map(p => `<option value="proveedor:${p.id}">${p.nombre}</option>`).join('')}</optgroup>`;
    select.innerHTML = html;
}

window.abrirModalRecordatorioGeneral = function() {
    document.getElementById('rg-fecha').value = new Date().toISOString().substring(0, 10);
    document.getElementById('rg-texto').value = '';
    populateVinculoSelect();
    document.getElementById('rg-vinculo').value = '';
    document.getElementById('modal-recordatorio-general').style.display = 'flex';
};
window.guardarRecordatorioGeneral = async function() {
    const fecha = document.getElementById('rg-fecha').value;
    const texto = document.getElementById('rg-texto').value.trim();
    if (!texto) { alert('Escribí el recordatorio.'); return; }
    const vinculo = document.getElementById('rg-vinculo').value;
    let clienteId = null, proveedorId = null;
    if (vinculo.startsWith('cliente:')) clienteId = vinculo.substring(8);
    else if (vinculo.startsWith('proveedor:')) proveedorId = vinculo.substring(10);
    recordatoriosGenerales.push({ id: generarId(), fecha: fecha || new Date().toISOString().substring(0, 10), texto, hecho: false, clienteId, proveedorId });
    await guardarTodo();
    document.getElementById('modal-recordatorio-general').style.display = 'none';
    renderTodo();
};

// ==========================================================================
// RENDER: CLIENTES
// ==========================================================================
function renderClientesTable() {
    const tbody = document.querySelector('#table-clientes tbody');
    if (!tbody) return;
    tbody.innerHTML = clientes.map(c => {
        const pedidosCliente = pedidos.filter(p => p.clienteId === c.id);
        const totalFacturado = pedidosCliente.reduce((a, p) => a + (parseFloat(p.precioTotal) || 0), 0);
        return `
            <tr>
                <td><strong>${c.nombre}</strong></td>
                <td>${c.telefono || '-'}</td>
                <td>${c.origen || '-'}</td>
                <td>${pedidosCliente.length}</td>
                <td>${formatearPlata(totalFacturado)}</td>
                <td><span class="link-abrir" onclick="abrirModalCliente('${c.id}')">Ver</span></td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="6" style="text-align:center;">No hay clientes cargados</td></tr>';
}

function populateClientesDatalist() {
    const dl = document.getElementById('clientes-datalist');
    if (dl) dl.innerHTML = clientes.map(c => `<option value="${c.nombre}">`).join('');
}

function renderPedidosDeCliente(clienteId) {
    const cont = document.getElementById('c-lista-pedidos');
    if (!cont) return;
    const pedidosCliente = pedidos.filter(p => p.clienteId === clienteId);
    cont.innerHTML = pedidosCliente.map(p => `
        <div class="mini-pedido-row">
            <span>${descripcionProducto(p)} — ${ETAPAS.find(e => e.key === p.etapa)?.label || p.etapa}</span>
            <span class="link-abrir" onclick="cerrarModalCliente(); abrirModalEditar('${p.id}')">Ver pedido</span>
        </div>
    `).join('') || '<p class="hint-text">Todavía no tiene pedidos.</p>';
}

function renderNotasCliente() {
    document.getElementById('c-lista-notas').innerHTML = notasClienteTemp.slice().reverse().map(n => `
        <div class="nota-item"><div class="nota-fecha">${new Date(n.fecha).toLocaleString('es-AR')}</div><div>${n.texto}</div></div>
    `).join('') || '<p class="hint-text">Sin notas todavía</p>';
}

window.abrirModalCliente = function(id) {
    clienteEnEdicion = id;
    if (id) {
        const c = getCliente(id);
        document.getElementById('modal-cliente-titulo').textContent = c.nombre;
        document.getElementById('c-nombre').value = c.nombre;
        document.getElementById('c-telefono').value = c.telefono || '';
        document.getElementById('c-email').value = c.email || '';
        document.getElementById('c-origen').value = c.origen || '';
        document.getElementById('c-direccion').value = c.direccion || '';
        notasClienteTemp = [...(c.notasGenerales || [])];
        document.getElementById('btn-borrar-cliente').style.display = 'inline-block';
        renderPedidosDeCliente(id);
    } else {
        document.getElementById('modal-cliente-titulo').textContent = 'Nuevo Cliente';
        ['c-nombre', 'c-telefono', 'c-email', 'c-direccion'].forEach(i => document.getElementById(i).value = '');
        document.getElementById('c-origen').value = '';
        notasClienteTemp = [];
        document.getElementById('btn-borrar-cliente').style.display = 'none';
        document.getElementById('c-lista-pedidos').innerHTML = '<p class="hint-text">Se van a poder ver acá una vez que tenga pedidos.</p>';
    }
    renderNotasCliente();
    actualizarBotonWhatsapp('whatsapp-btn-cliente', document.getElementById('c-telefono').value, document.getElementById('c-nombre').value);
    document.getElementById('modal-cliente').style.display = 'flex';
};

window.cerrarModalCliente = function() { document.getElementById('modal-cliente').style.display = 'none'; clienteEnEdicion = null; };

window.agregarNotaCliente = function() {
    const texto = document.getElementById('c-nota-texto').value.trim();
    if (!texto) return;
    notasClienteTemp.push({ fecha: new Date().toISOString(), texto });
    document.getElementById('c-nota-texto').value = '';
    renderNotasCliente();
};

window.guardarCliente = async function() {
    const nombre = document.getElementById('c-nombre').value.trim();
    if (!nombre) { alert('El nombre es obligatorio.'); return; }
    const datos = {
        nombre, telefono: document.getElementById('c-telefono').value.trim(), email: document.getElementById('c-email').value.trim(),
        origen: document.getElementById('c-origen').value, direccion: document.getElementById('c-direccion').value.trim(),
        notasGenerales: notasClienteTemp
    };
    if (clienteEnEdicion) {
        const idx = clientes.findIndex(c => c.id === clienteEnEdicion);
        clientes[idx] = { ...clientes[idx], ...datos };
    } else {
        clientes.push({ id: generarId(), createdAt: new Date().toISOString(), ...datos });
    }
    if (!(await guardarTodo())) return;
    cerrarModalCliente();
    renderTodo();
};

window.borrarCliente = async function() {
    if (!clienteEnEdicion) return;
    if (pedidos.some(p => p.clienteId === clienteEnEdicion)) { alert('Este cliente tiene pedidos asociados; no se puede borrar mientras los tenga.'); return; }
    if (!confirm('¿Seguro que querés borrar este cliente?')) return;
    const { error } = await supabaseClient.from('clientes').delete().eq('id', clienteEnEdicion);
    if (error) { console.error(error); alert('No se pudo borrar el cliente. Revisá la consola (F12).'); return; }
    clientes = clientes.filter(c => c.id !== clienteEnEdicion);
    cerrarModalCliente();
    renderTodo();
};

// ==========================================================================
// RENDER: PROVEEDORES
// ==========================================================================
function renderProveedoresTable() {
    const tbody = document.querySelector('#table-proveedores-dir tbody');
    if (!tbody) return;
    tbody.innerHTML = proveedores.map(pv => {
        const pendientes = (pv.recordatorios || []).filter(r => !r.hecho).length;
        return `
            <tr>
                <td><strong>${pv.nombre}</strong></td>
                <td>${pv.especialidad || '-'}</td>
                <td>${pv.telefono || '-'}</td>
                <td>${pendientes}</td>
                <td><span class="link-abrir" onclick="abrirModalProveedor('${pv.id}')">Ver</span></td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="5" style="text-align:center;">No hay proveedores cargados</td></tr>';
}

function renderTablaRecordatoriosProveedor() {
    const tbody = document.querySelector('#tabla-recordatorios-proveedor tbody');
    if (!tbody) return;
    tbody.innerHTML = recordatoriosProveedorTemp.map((r, i) => `
        <tr class="${r.hecho ? 'fila-hecho' : ''}">
            <td><input type="checkbox" ${r.hecho ? 'checked' : ''} onchange="recordatoriosProveedorTemp[${i}].hecho=this.checked; renderTablaRecordatoriosProveedor();"></td>
            <td>${r.fecha ? new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-AR') : '-'}</td>
            <td>${r.texto}</td>
            <td><span class="btn-borrar" onclick="recordatoriosProveedorTemp.splice(${i},1); renderTablaRecordatoriosProveedor();">Borrar</span></td>
        </tr>
    `).join('') || '<tr><td colspan="4" style="color:#999;">Sin recordatorios</td></tr>';
}

window.agregarRecordatorioProveedor = function() {
    const fecha = document.getElementById('pv-recordatorio-fecha').value;
    const texto = document.getElementById('pv-recordatorio-texto').value.trim();
    if (!texto) { alert('Escribí el recordatorio.'); return; }
    recordatoriosProveedorTemp.push({ fecha: fecha || new Date().toISOString().substring(0, 10), texto, hecho: false });
    document.getElementById('pv-recordatorio-fecha').value = '';
    document.getElementById('pv-recordatorio-texto').value = '';
    renderTablaRecordatoriosProveedor();
};

window.abrirModalProveedor = function(id) {
    proveedorEnEdicion = id;
    if (id) {
        const pv = getProveedor(id);
        document.getElementById('modal-proveedor-titulo').textContent = pv.nombre;
        document.getElementById('pv-nombre').value = pv.nombre;
        document.getElementById('pv-especialidad').value = pv.especialidad || 'Tela / Tapicería';
        document.getElementById('pv-telefono').value = pv.telefono || '';
        document.getElementById('pv-email').value = pv.email || '';
        document.getElementById('pv-notas').value = pv.notas || '';
        recordatoriosProveedorTemp = [...(pv.recordatorios || [])];
        document.getElementById('btn-borrar-proveedor').style.display = 'inline-block';
    } else {
        document.getElementById('modal-proveedor-titulo').textContent = 'Nuevo Proveedor';
        ['pv-nombre', 'pv-telefono', 'pv-email', 'pv-notas'].forEach(i => document.getElementById(i).value = '');
        document.getElementById('pv-especialidad').value = 'Tela / Tapicería';
        recordatoriosProveedorTemp = [];
        document.getElementById('btn-borrar-proveedor').style.display = 'none';
    }
    renderTablaRecordatoriosProveedor();
    actualizarBotonWhatsapp('whatsapp-btn-proveedor', document.getElementById('pv-telefono').value, document.getElementById('pv-nombre').value);
    document.getElementById('modal-proveedor').style.display = 'flex';
};

window.cerrarModalProveedor = function() { document.getElementById('modal-proveedor').style.display = 'none'; proveedorEnEdicion = null; };

window.guardarProveedor = async function() {
    const nombre = document.getElementById('pv-nombre').value.trim();
    if (!nombre) { alert('El nombre es obligatorio.'); return; }
    const datos = {
        nombre, especialidad: document.getElementById('pv-especialidad').value,
        telefono: document.getElementById('pv-telefono').value.trim(), email: document.getElementById('pv-email').value.trim(),
        notas: document.getElementById('pv-notas').value.trim(), recordatorios: recordatoriosProveedorTemp
    };
    if (proveedorEnEdicion) {
        const idx = proveedores.findIndex(p => p.id === proveedorEnEdicion);
        proveedores[idx] = { ...proveedores[idx], ...datos };
    } else {
        proveedores.push({ id: generarId(), createdAt: new Date().toISOString(), ...datos });
    }
    if (!(await guardarTodo())) return;
    cerrarModalProveedor();
    renderTodo();
};

window.borrarProveedor = async function() {
    if (!proveedorEnEdicion) return;
    if (!confirm('¿Seguro que querés borrar este proveedor? (Los costos ya cargados que lo referencian van a quedar sin proveedor asociado)')) return;
    const { error } = await supabaseClient.from('proveedores').delete().eq('id', proveedorEnEdicion);
    if (error) { console.error(error); alert('No se pudo borrar el proveedor. Revisá la consola (F12).'); return; }
    proveedores = proveedores.filter(p => p.id !== proveedorEnEdicion);
    cerrarModalProveedor();
    renderTodo();
};

function populateProveedorSelect() {
    const select = document.getElementById('costo-proveedor');
    if (select) select.innerHTML = '<option value="">Sin proveedor asociado</option>' + proveedores.map(pv => `<option value="${pv.id}">${pv.nombre}${pv.especialidad ? ' (' + pv.especialidad + ')' : ''}</option>`).join('');
}

// ==========================================================================
// RENDER: PRÓXIMAS ENTREGAS / PERDIDOS / PANEL COMERCIAL
// ==========================================================================
function renderEntregas() {
    const tbody = document.querySelector('#table-entregas tbody');
    const activos = pedidosFiltrados().filter(p => p.etapa !== 'entregado' && p.etapa !== 'perdido' && p.fechaEstimada);
    const ordenados = [...activos].sort((a, b) => new Date(a.fechaEstimada) - new Date(b.fechaEstimada));
    tbody.innerHTML = ordenados.map(p => {
        const atrasado = estaAtrasado(p);
        const etapaLabel = ETAPAS.find(e => e.key === p.etapa)?.label || p.etapa;
        return `
            <tr class="${atrasado ? 'fila-atrasada' : ''}">
                <td><strong>${getCliente(p.clienteId)?.nombre || '-'}</strong></td>
                <td>${descripcionProducto(p)}</td>
                <td>${etapaLabel}</td>
                <td>${atrasado ? '⚠ ' : ''}${new Date(p.fechaEstimada + 'T00:00:00').toLocaleDateString('es-AR')}</td>
                <td>${formatearPlata(calcularSaldo(p))}</td>
                <td><span class="link-abrir" onclick="abrirModalEditar('${p.id}')">Ver</span></td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="6" style="text-align:center;">No hay entregas pendientes</td></tr>';
}

function renderPerdidos() {
    const tbody = document.querySelector('#table-perdidos tbody');
    const perdidos = pedidos.filter(p => p.etapa === 'perdido');
    tbody.innerHTML = perdidos.map(p => `
        <tr>
            <td><strong>${getCliente(p.clienteId)?.nombre || '-'}</strong></td>
            <td>${descripcionProducto(p)}</td>
            <td>${p.motivoPerdida || '-'}</td>
            <td>${p.fechaPerdida ? new Date(p.fechaPerdida).toLocaleDateString('es-AR') : '-'}</td>
            <td><span class="link-abrir" onclick="abrirModalEditar('${p.id}')">Ver</span></td>
        </tr>
    `).join('') || '<tr><td colspan="5" style="text-align:center;">No hay pedidos perdidos cargados</td></tr>';
}

function renderPanelComercial() {
    const entregados = pedidos.filter(p => p.etapa === 'entregado');
    const perdidos = pedidos.filter(p => p.etapa === 'perdido');
    const cerrados = entregados.length + perdidos.length;

    document.getElementById('kpi-conversion').textContent = `${cerrados > 0 ? ((entregados.length / cerrados) * 100).toFixed(0) : 0}%`;
    const ticketProm = entregados.length > 0 ? entregados.reduce((a, p) => a + (parseFloat(p.precioTotal) || 0), 0) / entregados.length : 0;
    document.getElementById('kpi-ticket-crm').textContent = formatearPlata(ticketProm);
    document.getElementById('kpi-ganancia-crm').textContent = formatearPlata(entregados.reduce((a, p) => a + calcularGanancia(p), 0));

    const modeloMap = {};
    pedidos.filter(p => p.etapa !== 'perdido').forEach(p => {
        const key = p.tipo === 'sillon' ? p.modelo : `Mueble (${p.madera || 's/d'})`;
        modeloMap[key] = (modeloMap[key] || 0) + 1;
    });
    const ctxModelos = document.getElementById('chartModelos');
    if (chartModelos) chartModelos.destroy();
    if (ctxModelos) {
        chartModelos = new Chart(ctxModelos.getContext('2d'), {
            type: 'bar',
            data: { labels: Object.keys(modeloMap), datasets: [{ label: 'Cantidad de pedidos', data: Object.values(modeloMap), backgroundColor: '#A39B8B' }] },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
        });
    }

    const embudoData = ETAPAS.map(e => pedidos.filter(p => p.etapa === e.key).length);
    const ctxEmbudo = document.getElementById('chartEmbudo');
    if (chartEmbudo) chartEmbudo.destroy();
    if (ctxEmbudo) {
        chartEmbudo = new Chart(ctxEmbudo.getContext('2d'), {
            type: 'bar',
            data: { labels: ETAPAS.map(e => e.label), datasets: [{ label: 'Pedidos', data: embudoData, backgroundColor: '#7D8C7A' }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

// ==========================================================================
// NAVEGACIÓN DE VISTAS
// ==========================================================================
window.cambiarVista = function(idVista) {
    document.querySelectorAll('.vista-content').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(idVista).style.display = 'block';
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
    if (idVista === 'vista-comercial') renderPanelComercial();
    if (idVista === 'vista-calendario') renderCalendario();
};

function renderTodo() {
    populateClientesDatalist();
    renderKPIs();
    renderKanban();
    renderEntregas();
    renderPerdidos();
    renderClientesTable();
    renderProveedoresTable();
    if (document.getElementById('vista-calendario').style.display !== 'none') renderCalendario();
    if (document.getElementById('vista-comercial').style.display !== 'none') renderPanelComercial();
}

document.getElementById('buscador').addEventListener('input', renderTodo);
document.getElementById('filtro-tipo').addEventListener('change', renderTodo);

// ==========================================================================
// MODAL PEDIDO: abrir / cerrar / tabs
// ==========================================================================
window.cambiarTabModal = function(idTab) { cambiarTabModalDirecto(idTab); };
function cambiarTabModalDirecto(idTab) {
    document.querySelectorAll('.modal-tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(idTab).style.display = 'block';
    document.querySelector(`.modal-tab-btn[data-tab="${idTab}"]`).classList.add('active');
}

window.onCambioTipoProducto = function() {
    const esSillon = document.getElementById('f-tipo').value === 'sillon';
    ['campo-modelo-sillon', 'campo-tela', 'campo-color', 'campo-mt-tela', 'campo-funda', 'campo-color-funda'].forEach(id => document.getElementById(id).style.display = esSillon ? 'flex' : 'none');
    ['campo-tipo-mueble', 'campo-madera', 'campo-terminacion'].forEach(id => document.getElementById(id).style.display = esSillon ? 'none' : 'flex');
};

window.abrirModalNuevoPedido = function() {
    pedidoEnEdicion = null;
    document.getElementById('modal-titulo').textContent = 'Nuevo Pedido';
    limpiarFormulario();
    document.getElementById('btn-marcar-perdido').style.display = 'none';
    document.getElementById('modal-pedido').style.display = 'flex';
    cambiarTabModalDirecto('tab-datos');
};

window.abrirModalEditar = function(id) {
    const pedido = pedidos.find(p => p.id === id);
    if (!pedido) return;
    pedidoEnEdicion = id;
    document.getElementById('modal-titulo').textContent = `Pedido — ${getCliente(pedido.clienteId)?.nombre || ''}`;
    cargarFormulario(pedido);
    document.getElementById('btn-marcar-perdido').style.display = pedido.etapa === 'perdido' ? 'none' : 'inline-block';
    document.getElementById('modal-pedido').style.display = 'flex';
    cambiarTabModalDirecto('tab-datos');
};

window.cerrarModal = function() { document.getElementById('modal-pedido').style.display = 'none'; pedidoEnEdicion = null; };

function limpiarFormulario() {
    ['f-cliente-nombre', 'f-cliente-telefono', 'f-cliente-email', 'f-cliente-direccion', 'f-tela', 'f-color', 'f-mt-tela',
     'f-color-funda', 'f-tipo-mueble', 'f-terminacion', 'f-medidas', 'f-detalles', 'f-precio-total', 'f-fecha-estimada', 'f-fecha-real'
    ].forEach(id => document.getElementById(id).value = '');
    document.getElementById('f-cliente-origen').value = '';
    document.getElementById('f-tipo').value = 'sillon';
    document.getElementById('f-modelo-sillon').value = 'NALA';
    document.getElementById('f-madera').value = 'ALAMO';
    document.getElementById('f-funda').value = 'no';
    document.getElementById('f-etapa').value = 'consulta';
    document.getElementById('f-fecha-consulta').value = new Date().toISOString().substring(0, 10);
    onCambioTipoProducto();
    populateProveedorSelect();
    actualizarBotonWhatsapp('whatsapp-btn-datos', '', '');
    renderTablaPagos([]);
    renderTablaCostos([]);
    recordatoriosPedidoTemp = [];
    renderTablaRecordatoriosPedido();
    renderListaNotas([]);
    fotosTemp = [];
    renderGaleriaFotos();
}

function cargarFormulario(p) {
    const cliente = getCliente(p.clienteId) || {};
    document.getElementById('f-cliente-nombre').value = cliente.nombre || '';
    document.getElementById('f-cliente-telefono').value = cliente.telefono || '';
    document.getElementById('f-cliente-email').value = cliente.email || '';
    document.getElementById('f-cliente-direccion').value = cliente.direccion || '';
    document.getElementById('f-cliente-origen').value = cliente.origen || '';
    actualizarBotonWhatsapp('whatsapp-btn-datos', cliente.telefono, cliente.nombre);

    document.getElementById('f-tipo').value = p.tipo || 'sillon';
    document.getElementById('f-modelo-sillon').value = p.modelo || 'NALA';
    document.getElementById('f-tela').value = p.tela || '';
    document.getElementById('f-color').value = p.color || '';
    document.getElementById('f-mt-tela').value = p.mtTela || '';
    document.getElementById('f-funda').value = p.funda || 'no';
    document.getElementById('f-color-funda').value = p.colorFunda || '';
    document.getElementById('f-tipo-mueble').value = p.tipoMueble || '';
    document.getElementById('f-madera').value = p.madera || 'ALAMO';
    document.getElementById('f-terminacion').value = p.terminacion || '';
    document.getElementById('f-medidas').value = p.medidas || '';
    document.getElementById('f-detalles').value = p.detalles || '';

    document.getElementById('f-precio-total').value = p.precioTotal || '';
    document.getElementById('f-etapa').value = p.etapa || 'consulta';
    document.getElementById('f-fecha-consulta').value = p.fechaConsulta || '';
    document.getElementById('f-fecha-estimada').value = p.fechaEstimada || '';
    document.getElementById('f-fecha-real').value = p.fechaReal || '';

    onCambioTipoProducto();
    populateProveedorSelect();
    renderTablaPagos(p.pagos || []);
    renderTablaCostos(p.costos || []);
    recordatoriosPedidoTemp = [...(p.recordatorios || [])];
    renderTablaRecordatoriosPedido();
    renderListaNotas(p.notas || []);
    fotosTemp = [...(p.fotos || [])];
    renderGaleriaFotos();
}

// Actualiza en vivo el botón de WhatsApp mientras se edita nombre/teléfono
['f-cliente-nombre', 'f-cliente-telefono'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        actualizarBotonWhatsapp('whatsapp-btn-datos', document.getElementById('f-cliente-telefono').value, document.getElementById('f-cliente-nombre').value);
    });
});
['c-nombre', 'c-telefono'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        actualizarBotonWhatsapp('whatsapp-btn-cliente', document.getElementById('c-telefono').value, document.getElementById('c-nombre').value);
    });
});
['pv-nombre', 'pv-telefono'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        actualizarBotonWhatsapp('whatsapp-btn-proveedor', document.getElementById('pv-telefono').value, document.getElementById('pv-nombre').value);
    });
});

// ==========================================================================
// PAGOS / COSTOS / RECORDATORIOS DE PEDIDO / NOTAS / FOTOS (dentro del modal)
// ==========================================================================
function renderTablaPagos(pagos) {
    pagosTemp = [...pagos];
    document.querySelector('#tabla-pagos tbody').innerHTML = pagosTemp.map((p, i) => `
        <tr>
            <td>${p.fecha ? new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-AR') : '-'}</td>
            <td>${formatearPlata(p.monto)}</td><td>${p.medio || '-'}</td>
            <td><span class="btn-borrar" onclick="borrarPago(${i})">Borrar</span></td>
        </tr>
    `).join('') || '<tr><td colspan="4" style="color:#999;">Sin pagos registrados</td></tr>';
    renderResumenPagos();
}
window.agregarPago = function() {
    const fecha = document.getElementById('pago-fecha').value;
    const monto = parseFloat(document.getElementById('pago-monto').value);
    const medio = document.getElementById('pago-medio').value;
    if (!monto || monto <= 0) { alert('Ingresá un monto válido.'); return; }
    pagosTemp.push({ fecha: fecha || new Date().toISOString().substring(0, 10), monto, medio });
    document.getElementById('pago-fecha').value = ''; document.getElementById('pago-monto').value = '';
    renderTablaPagos(pagosTemp);
};
window.borrarPago = function(i) { pagosTemp.splice(i, 1); renderTablaPagos(pagosTemp); };
function renderResumenPagos() {
    const precio = parseFloat(document.getElementById('f-precio-total').value) || 0;
    const pagado = pagosTemp.reduce((a, p) => a + (parseFloat(p.monto) || 0), 0);
    const saldo = precio - pagado;
    document.getElementById('resumen-pagos').innerHTML = `
        <div class="item"><span>Precio Total</span><strong>${formatearPlata(precio)}</strong></div>
        <div class="item"><span>Pagado</span><strong class="positivo">${formatearPlata(pagado)}</strong></div>
        <div class="item"><span>Saldo</span><strong class="${saldo > 0 ? 'negativo' : ''}">${formatearPlata(saldo)}</strong></div>
    `;
}
document.getElementById('f-precio-total').addEventListener('input', renderResumenPagos);

function renderTablaCostos(costos) {
    costosTemp = [...costos];
    document.querySelector('#tabla-costos tbody').innerHTML = costosTemp.map((c, i) => {
        const prov = c.proveedorId ? getProveedor(c.proveedorId) : null;
        return `<tr><td>${prov ? prov.nombre : '-'}</td><td>${c.concepto}</td><td>${formatearPlata(c.monto)}</td><td><span class="btn-borrar" onclick="borrarCosto(${i})">Borrar</span></td></tr>`;
    }).join('') || '<tr><td colspan="4" style="color:#999;">Sin costos registrados</td></tr>';
    renderResumenCostos();
}
window.agregarCosto = function() {
    const proveedorId = document.getElementById('costo-proveedor').value || null;
    const concepto = document.getElementById('costo-concepto').value.trim();
    const monto = parseFloat(document.getElementById('costo-monto').value);
    if (!concepto || !monto || monto <= 0) { alert('Completá concepto y monto.'); return; }
    costosTemp.push({ concepto, monto, proveedorId });
    document.getElementById('costo-proveedor').value = ''; document.getElementById('costo-concepto').value = ''; document.getElementById('costo-monto').value = '';
    renderTablaCostos(costosTemp);
};
window.borrarCosto = function(i) { costosTemp.splice(i, 1); renderTablaCostos(costosTemp); };
function renderResumenCostos() {
    const pagado = pagosTemp.reduce((a, p) => a + (parseFloat(p.monto) || 0), 0);
    const costoTotal = costosTemp.reduce((a, c) => a + (parseFloat(c.monto) || 0), 0);
    const ganancia = pagado - costoTotal;
    document.getElementById('resumen-costos').innerHTML = `
        <div class="item"><span>Cobrado hasta hoy</span><strong>${formatearPlata(pagado)}</strong></div>
        <div class="item"><span>Costo Total</span><strong>${formatearPlata(costoTotal)}</strong></div>
        <div class="item"><span>Ganancia (sobre lo cobrado)</span><strong class="${ganancia >= 0 ? 'positivo' : 'negativo'}">${formatearPlata(ganancia)}</strong></div>
    `;
}

function renderTablaRecordatoriosPedido() {
    document.querySelector('#tabla-recordatorios-pedido tbody').innerHTML = recordatoriosPedidoTemp.map((r, i) => `
        <tr class="${r.hecho ? 'fila-hecho' : ''}">
            <td><input type="checkbox" ${r.hecho ? 'checked' : ''} onchange="recordatoriosPedidoTemp[${i}].hecho=this.checked; renderTablaRecordatoriosPedido();"></td>
            <td>${r.fecha ? new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-AR') : '-'}</td>
            <td>${r.texto}</td>
            <td><span class="btn-borrar" onclick="recordatoriosPedidoTemp.splice(${i},1); renderTablaRecordatoriosPedido();">Borrar</span></td>
        </tr>
    `).join('') || '<tr><td colspan="4" style="color:#999;">Sin recordatorios</td></tr>';
}
window.agregarRecordatorioPedido = function() {
    const fecha = document.getElementById('recordatorio-fecha').value;
    const texto = document.getElementById('recordatorio-texto').value.trim();
    if (!texto) { alert('Escribí el recordatorio.'); return; }
    recordatoriosPedidoTemp.push({ fecha: fecha || new Date().toISOString().substring(0, 10), texto, hecho: false });
    document.getElementById('recordatorio-fecha').value = ''; document.getElementById('recordatorio-texto').value = '';
    renderTablaRecordatoriosPedido();
};

function renderListaNotas(notas) {
    notasTemp = [...notas];
    document.getElementById('lista-notas').innerHTML = notasTemp.slice().reverse().map(n => `
        <div class="nota-item"><div class="nota-fecha">${new Date(n.fecha).toLocaleString('es-AR')}</div><div>${n.texto}</div></div>
    `).join('') || '<p style="color:#999; font-size:12.5px;">Sin notas todavía</p>';
}
window.agregarNota = function() {
    const texto = document.getElementById('nota-texto').value.trim();
    if (!texto) return;
    notasTemp.push({ fecha: new Date().toISOString(), texto });
    document.getElementById('nota-texto').value = '';
    renderListaNotas(notasTemp);
};

function renderGaleriaFotos() {
    document.getElementById('galeria-fotos').innerHTML = fotosTemp.map((f, i) => `
        <div class="galeria-item">
            <img src="${f.dataUrl}" onclick="abrirLightbox('${f.dataUrl}')">
            <button class="btn-borrar-foto" onclick="event.stopPropagation(); borrarFoto(${i})">×</button>
        </div>
    `).join('') || '<p class="hint-text">Todavía no hay fotos cargadas.</p>';
}
window.borrarFoto = function(i) { fotosTemp.splice(i, 1); renderGaleriaFotos(); };
window.manejarSubidaFoto = function(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const maxAncho = 900;
            const escala = Math.min(1, maxAncho / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = img.width * escala;
            canvas.height = img.height * escala;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            fotosTemp.push({ fecha: new Date().toISOString(), dataUrl: canvas.toDataURL('image/jpeg', 0.72) });
            renderGaleriaFotos();
            inputEl.value = '';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};
window.abrirLightbox = function(dataUrl) { document.getElementById('lightbox-img').src = dataUrl; document.getElementById('lightbox').style.display = 'flex'; };
window.cerrarLightbox = function() { document.getElementById('lightbox').style.display = 'none'; };

// ==========================================================================
// GUARDAR PEDIDO / MARCAR PERDIDO
// ==========================================================================
function resolverClienteDesdeFormularioPedido() {
    const nombre = document.getElementById('f-cliente-nombre').value.trim();
    const telefono = document.getElementById('f-cliente-telefono').value.trim();
    const email = document.getElementById('f-cliente-email').value.trim();
    const direccion = document.getElementById('f-cliente-direccion').value.trim();
    const origen = document.getElementById('f-cliente-origen').value;

    let cliente = clientes.find(c => c.nombre.toLowerCase() === nombre.toLowerCase());
    if (cliente) {
        if (telefono) cliente.telefono = telefono;
        if (email) cliente.email = email;
        if (direccion) cliente.direccion = direccion;
        if (origen) cliente.origen = origen;
    } else {
        cliente = { id: generarId(), nombre, telefono, email, direccion, origen, notasGenerales: [], createdAt: new Date().toISOString() };
        clientes.push(cliente);
    }
    return cliente.id;
}

window.guardarPedido = async function() {
    const nombre = document.getElementById('f-cliente-nombre').value.trim();
    if (!nombre) { alert('El nombre del cliente es obligatorio.'); cambiarTabModalDirecto('tab-datos'); return; }

    const clienteId = resolverClienteDesdeFormularioPedido();
    const datos = {
        clienteId, tipo: document.getElementById('f-tipo').value,
        modelo: document.getElementById('f-modelo-sillon').value,
        tela: document.getElementById('f-tela').value.trim(),
        color: document.getElementById('f-color').value.trim(),
        mtTela: document.getElementById('f-mt-tela').value,
        funda: document.getElementById('f-funda').value,
        colorFunda: document.getElementById('f-color-funda').value.trim(),
        tipoMueble: document.getElementById('f-tipo-mueble').value.trim(),
        madera: document.getElementById('f-madera').value,
        terminacion: document.getElementById('f-terminacion').value.trim(),
        medidas: document.getElementById('f-medidas').value.trim(),
        detalles: document.getElementById('f-detalles').value.trim(),
        precioTotal: parseFloat(document.getElementById('f-precio-total').value) || 0,
        etapa: document.getElementById('f-etapa').value,
        fechaConsulta: document.getElementById('f-fecha-consulta').value,
        fechaEstimada: document.getElementById('f-fecha-estimada').value,
        fechaReal: document.getElementById('f-fecha-real').value,
        pagos: pagosTemp, costos: costosTemp, recordatorios: recordatoriosPedidoTemp, notas: notasTemp, fotos: fotosTemp,
        updatedAt: new Date().toISOString()
    };

    if (pedidoEnEdicion) {
        const idx = pedidos.findIndex(p => p.id === pedidoEnEdicion);
        pedidos[idx] = { ...pedidos[idx], ...datos };
    } else {
        pedidos.push({ id: generarId(), createdAt: new Date().toISOString(), ...datos });
    }

    if (!(await guardarTodo())) return;
    cerrarModal();
    renderTodo();
};

window.marcarComoPerdido = async function() {
    if (!pedidoEnEdicion) return;
    const motivo = prompt('¿Por qué se perdió este pedido? (opcional)') || '';
    const pedido = pedidos.find(p => p.id === pedidoEnEdicion);
    if (pedido) {
        pedido.etapa = 'perdido';
        pedido.motivoPerdida = motivo;
        pedido.fechaPerdida = new Date().toISOString();
        await guardarTodo();
    }
    cerrarModal();
    renderTodo();
};

// ==========================================================================
// DATOS DE EJEMPLO
// ==========================================================================
async function cargarDatosDeEjemplo() {
    const hoy = new Date();
    const dias = (n) => { const d = new Date(hoy); d.setDate(d.getDate() + n); return d.toISOString().substring(0, 10); };

    proveedores = [
        { id: generarId(), nombre: 'Roberto', especialidad: 'Tela / Tapicería', telefono: '2235550201', email: '', notas: 'Proveedor habitual de telas.', recordatorios: [{ fecha: dias(2), texto: 'Pedirle tela DONN gris para el pedido de Francisco Tobías', hecho: false }], createdAt: new Date().toISOString() },
        { id: generarId(), nombre: 'Javier', especialidad: 'Estructura de Sillón', telefono: '2235550202', email: '', notas: 'Arma la estructura y tapiza.', recordatorios: [], createdAt: new Date().toISOString() },
        { id: generarId(), nombre: 'Juan XXI', especialidad: 'Madera / Muebles', telefono: '2235550203', email: '', notas: '', recordatorios: [{ fecha: dias(-1), texto: 'Confirmar entrega de la mesa ratona de Martín Medina', hecho: false }], createdAt: new Date().toISOString() },
        { id: generarId(), nombre: 'Juan Carpintero', especialidad: 'Madera / Muebles', telefono: '2235550204', email: '', notas: '', recordatorios: [], createdAt: new Date().toISOString() }
    ];

    clientes = [
        { id: generarId(), nombre: 'Francisco Tobías', telefono: '2235550101', email: '', direccion: '', origen: 'Instagram', notasGenerales: [], createdAt: new Date().toISOString() },
        { id: generarId(), nombre: 'Florencia Oliva', telefono: '2235550110', email: '', direccion: '', origen: 'Recomendación', notasGenerales: [], createdAt: new Date().toISOString() },
        { id: generarId(), nombre: 'Martín Medina', telefono: '2235550120', email: '', direccion: '', origen: 'Local / Showroom', notasGenerales: [], createdAt: new Date().toISOString() },
        { id: generarId(), nombre: 'Verónica Spicacci', telefono: '2235550130', email: '', direccion: '', origen: 'Instagram', notasGenerales: [], createdAt: new Date().toISOString() },
        { id: generarId(), nombre: 'Lorena Martínez', telefono: '2235550140', email: '', direccion: '', origen: 'Google', notasGenerales: [], createdAt: new Date().toISOString() },
        { id: generarId(), nombre: 'Estefanía Gómez', telefono: '2235550150', email: '', direccion: '', origen: 'Recomendación', notasGenerales: [], createdAt: new Date().toISOString() },
        { id: generarId(), nombre: 'Juan Manuel Da Silva', telefono: '2235550160', email: '', direccion: '', origen: 'Instagram', notasGenerales: [], createdAt: new Date().toISOString() }
    ];

    const idCliente = (n) => clientes.find(c => c.nombre === n).id;
    const idProv = (n) => proveedores.find(p => p.nombre === n).id;

    pedidos = [
        { id: generarId(), clienteId: idCliente('Francisco Tobías'), tipo: 'sillon', modelo: 'NALA', medidas: '2,20m x 1,00m', tela: 'DONN', color: 'GRIS', funda: 'no',
          precioTotal: 2200000, etapa: 'produccion', fechaConsulta: dias(-20), fechaEstimada: dias(5),
          pagos: [{ fecha: dias(-18), monto: 1100000, medio: 'Transferencia' }],
          costos: [{ concepto: 'Mano de obra', monto: 620000, proveedorId: idProv('Javier') }, { concepto: 'Tela', monto: 180000, proveedorId: idProv('Roberto') }],
          recordatorios: [{ fecha: dias(3), texto: 'Avisar avance de producción', hecho: false }],
          notas: [{ fecha: new Date(dias(-10)).toISOString(), texto: 'Cliente pidió confirmar tono de gris antes de tapizar.' }], fotos: [], createdAt: new Date().toISOString() },

        { id: generarId(), clienteId: idCliente('Florencia Oliva'), tipo: 'sillon', modelo: 'CALI', medidas: '1,80m x 0,90m', tela: 'PANNE', color: 'BEIGE', funda: 'no',
          precioTotal: 1650000, etapa: 'listo', fechaConsulta: dias(-35), fechaEstimada: dias(-2),
          pagos: [{ fecha: dias(-33), monto: 1650000, medio: 'Transferencia' }],
          costos: [{ concepto: 'Mano de obra', monto: 610000, proveedorId: idProv('Javier') }, { concepto: 'Tela', monto: 90000, proveedorId: idProv('Roberto') }],
          recordatorios: [{ fecha: dias(1), texto: 'Coordinar entrega', hecho: false }], notas: [], fotos: [], createdAt: new Date().toISOString() },

        { id: generarId(), clienteId: idCliente('Martín Medina'), tipo: 'mueble', tipoMueble: 'Mesa Ratona', madera: 'PETIRIBI', medidas: '120x60x45cm', terminacion: 'Laqueado natural',
          precioTotal: 615000, etapa: 'sena', fechaConsulta: dias(-5), fechaEstimada: dias(20),
          pagos: [{ fecha: dias(-4), monto: 300000, medio: 'Efectivo' }],
          costos: [{ concepto: 'Materiales y armado', monto: 180000, proveedorId: idProv('Juan XXI') }],
          recordatorios: [{ fecha: dias(2), texto: 'Confirmar color de laca', hecho: false }], notas: [], fotos: [], createdAt: new Date().toISOString() },

        { id: generarId(), clienteId: idCliente('Verónica Spicacci'), tipo: 'sillon', modelo: 'SIMON', medidas: '2,00m x 1,00m', tela: 'THOR', color: 'BEIGE', funda: 'si', colorFunda: 'KHAKI',
          precioTotal: 1870000, etapa: 'presupuesto', fechaConsulta: dias(-2), fechaEstimada: '',
          pagos: [], costos: [], recordatorios: [{ fecha: dias(2), texto: 'Hacer seguimiento del presupuesto', hecho: false }],
          notas: [{ fecha: new Date(dias(-1)).toISOString(), texto: 'Envié presupuesto por WhatsApp, esperando confirmación.' }], fotos: [], createdAt: new Date().toISOString() },

        { id: generarId(), clienteId: idCliente('Lorena Martínez'), tipo: 'mueble', tipoMueble: 'Rack TV', madera: 'KIRI', medidas: '160x40x60cm', terminacion: 'Natural',
          precioTotal: 875000, etapa: 'consulta', fechaConsulta: dias(0), fechaEstimada: '',
          pagos: [], costos: [], recordatorios: [{ fecha: dias(1), texto: 'Llamar para tomar medidas del ambiente', hecho: false }], notas: [], fotos: [], createdAt: new Date().toISOString() },

        { id: generarId(), clienteId: idCliente('Estefanía Gómez'), tipo: 'sillon', modelo: 'CHIQUI', medidas: '2,40m x 1,00m', tela: 'DIVA', color: 'VERDE',
          precioTotal: 2900000, etapa: 'entregado', fechaConsulta: dias(-60), fechaEstimada: dias(-15), fechaReal: dias(-14),
          pagos: [{ fecha: dias(-58), monto: 1450000, medio: 'Transferencia' }, { fecha: dias(-14), monto: 1450000, medio: 'Efectivo' }],
          costos: [{ concepto: 'Mano de obra', monto: 1082000, proveedorId: idProv('Javier') }, { concepto: 'Tela', monto: 180000, proveedorId: idProv('Roberto') }, { concepto: 'Transporte', monto: 60000, proveedorId: null }],
          recordatorios: [], notas: [], fotos: [], createdAt: new Date().toISOString() },

        { id: generarId(), clienteId: idCliente('Juan Manuel Da Silva'), tipo: 'sillon', modelo: 'LEON', medidas: '2,00m x 1,00m', tela: 'ODINA', color: 'VERDE',
          precioTotal: 1690000, etapa: 'perdido', motivoPerdida: 'Eligió otra tapicería por precio', fechaPerdida: new Date(dias(-3)).toISOString(),
          fechaConsulta: dias(-25), fechaEstimada: '', pagos: [], costos: [], recordatorios: [], notas: [], fotos: [], createdAt: new Date().toISOString() }
    ];

    recordatoriosGenerales = [{ id: generarId(), fecha: dias(4), texto: 'Renovar stock de espuma D28 para tapicería', hecho: false }];

    await guardarTodo();
    renderTodo();
}

// ==========================================================================
// RESUMEN POR MAIL (manual — ver aclaración sobre por qué no es automático
// en la respuesta del chat: localStorage vive solo en este navegador, no hay
// forma de que algo corra solo un sábado a las 8hs y lo lea desde afuera).
// ==========================================================================
function generarTextoResumenPendientes() {
    const hoyStr = new Date().toISOString().substring(0, 10);
    const hoy = new Date(new Date().toDateString());
    const en7dias = new Date(hoy); en7dias.setDate(en7dias.getDate() + 7);

    const todosRecordatorios = recopilarRecordatorios();
    const vencidos = todosRecordatorios.filter(r => !r.hecho && r.fecha < hoyStr);
    const proximos = todosRecordatorios.filter(r => !r.hecho && r.fecha >= hoyStr && new Date(r.fecha) <= en7dias);
    const atrasados = pedidos.filter(estaAtrasado);
    const conSaldo = pedidos.filter(p => p.etapa !== 'perdido' && calcularSaldo(p) > 0);
    const saldoTotal = conSaldo.reduce((a, p) => a + calcularSaldo(p), 0);

    const listar = (items, vacio) => items.length ? items.join('\n') : vacio;

    let texto = `RESUMEN DE PENDIENTES - RUMA HOME\n${new Date().toLocaleDateString('es-AR')}\n\n`;
    texto += `RECORDATORIOS VENCIDOS (${vencidos.length})\n`;
    texto += listar(vencidos.map(r => `- ${new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-AR')}: ${r.texto} [${r.etiqueta}]`), '(ninguno)');
    texto += `\n\nPRÓXIMOS 7 DÍAS (${proximos.length})\n`;
    texto += listar(proximos.map(r => `- ${new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-AR')}: ${r.texto} [${r.etiqueta}]`), '(ninguno)');
    texto += `\n\nENTREGAS ATRASADAS (${atrasados.length})\n`;
    texto += listar(atrasados.map(p => `- ${getCliente(p.clienteId)?.nombre || '-'}: ${descripcionProducto(p)} (estimada ${new Date(p.fechaEstimada + 'T00:00:00').toLocaleDateString('es-AR')})`), '(ninguna)');
    texto += `\n\nSALDO PENDIENTE DE COBRO: ${formatearPlata(saldoTotal)} (${conSaldo.length} pedido/s)\n`;
    return texto;
}

window.enviarResumenPorMail = function() {
    const cuerpo = generarTextoResumenPendientes();
    if (cuerpo.length > 1800) {
        console.warn('El resumen es largo; algunos clientes de correo truncan el cuerpo de un mailto. Si el mail llega cortado, avisá para achicar el resumen.');
    }
    const asunto = `Resumen de Pendientes - Ruma Home - ${new Date().toLocaleDateString('es-AR')}`;
    window.location.href = `mailto:rumahome@gmail.com?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
};

// ==========================================================================
// EXPORTAR / IMPORTAR
// ==========================================================================
function descargarArchivo(nombre, contenido, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

window.exportarBackupJSON = function() {
    const data = { pedidos, clientes, proveedores, recordatoriosGenerales, exportadoEl: new Date().toISOString() };
    descargarArchivo(`ruma-crm-backup-${new Date().toISOString().substring(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
};

window.exportarPedidosCSV = function() {
    const headers = ['Cliente', 'Telefono', 'Tipo', 'Producto', 'Medidas', 'Etapa', 'Precio Total', 'Pagado', 'Saldo', 'Fecha Consulta', 'Fecha Estimada', 'Fecha Real'];
    const filas = pedidos.map(p => {
        const c = getCliente(p.clienteId);
        return [
            c?.nombre || '', c?.telefono || '', p.tipo === 'sillon' ? 'Sillón' : 'Mueble', descripcionProducto(p), p.medidas || '',
            ETAPAS.find(e => e.key === p.etapa)?.label || p.etapa,
            p.precioTotal || 0, calcularMontoPagado(p), calcularSaldo(p),
            p.fechaConsulta || '', p.fechaEstimada || '', p.fechaReal || ''
        ];
    });
    const csvEscape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers, ...filas].map(fila => fila.map(csvEscape).join(';')).join('\r\n');
    descargarArchivo(`ruma-crm-pedidos-${new Date().toISOString().substring(0, 10)}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8;');
};

window.importarBackup = function(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    if (!confirm('Importar un backup va a REEMPLAZAR todos los datos actuales del CRM en la base compartida. ¿Continuar?')) { inputEl.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            // Se remapean los ids igual que en la migración de localStorage: así funciona
            // sin importar si el backup es viejo (ids no-uuid) o ya venía de Supabase.
            const remapeado = remapearIdsCompatibilidad(data.pedidos || [], data.clientes || [], data.proveedores || [], data.recordatoriosGenerales || []);
            pedidos = remapeado.pedidos;
            clientes = remapeado.clientes;
            proveedores = remapeado.proveedores;
            recordatoriosGenerales = remapeado.recordatoriosGenerales;
            if (!(await guardarTodo())) return;
            renderTodo();
            alert('Backup importado correctamente.');
        } catch (err) {
            console.error(err);
            alert('El archivo no es un backup válido de este CRM.');
        }
        inputEl.value = '';
    };
    reader.readAsText(file);
};

// ==========================================================================
// IMPORTAR PEDIDOS DESDE EXCEL / CSV
// ==========================================================================
const COLUMNAS_PLANTILLA = ['Cliente', 'Telefono', 'Email', 'Origen', 'Tipo', 'Modelo', 'TipoMueble', 'Madera', 'Medidas', 'Tela', 'Color', 'PrecioTotal', 'MontoPagado', 'Etapa', 'FechaConsulta', 'FechaEstimada', 'FechaReal'];

window.descargarPlantillaImportacion = function() {
    const ejemplo1 = ['Juan Pérez', '2235551234', '', 'Instagram', 'Sillon', 'NALA', '', '', '2,00m x 1,00m', 'DONN', 'GRIS', '1800000', '900000', 'entregado', '2026-01-15', '2026-02-10', '2026-02-08'];
    const ejemplo2 = ['Ana López', '2235555678', '', 'Recomendación', 'Mueble', '', 'Mesa Ratona', 'PETIRIBI', '120x60x45cm', '', '', '600000', '300000', 'produccion', '2026-03-01', '2026-03-25', ''];
    const csv = [COLUMNAS_PLANTILLA, ejemplo1, ejemplo2].map(fila => fila.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    descargarArchivo('plantilla-importacion-pedidos.csv', '\ufeff' + csv, 'text/csv;charset=utf-8;');
};

function normalizarEtapaImportada(valor) {
    const v = String(valor || '').toLowerCase().trim();
    const match = ETAPAS.find(e => e.key === v || e.label.toLowerCase() === v);
    return match ? match.key : 'consulta';
}
function normalizarTipoImportado(valor) {
    return String(valor || '').toLowerCase().includes('mueble') ? 'mueble' : 'sillon';
}
function parseFechaImportada(valor) {
    if (!valor) return '';
    if (valor instanceof Date) return valor.toISOString().substring(0, 10);
    const str = String(valor).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
    const partes = str.split(/[\/\-]/);
    if (partes.length === 3 && partes[2].length === 4) {
        const [d, m, y] = partes;
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return '';
}

function procesarFilasImportadas(filas) {
    let pedidosNuevos = 0, clientesNuevos = 0;
    const nuevosPedidos = [];
    filas.forEach(fila => {
        const nombreCliente = String(fila['Cliente'] || '').trim();
        if (!nombreCliente) return; // fila sin cliente, se ignora

        let cliente = clientes.find(c => c.nombre.toLowerCase() === nombreCliente.toLowerCase());
        if (!cliente) {
            cliente = {
                id: generarId(), nombre: nombreCliente,
                telefono: String(fila['Telefono'] || '').trim(), email: String(fila['Email'] || '').trim(),
                direccion: '', origen: String(fila['Origen'] || '').trim(),
                notasGenerales: [], createdAt: new Date().toISOString()
            };
            clientes.push(cliente);
            clientesNuevos++;
        }

        const montoPagado = parseFloat(fila['MontoPagado']) || 0;
        const fechaConsulta = parseFechaImportada(fila['FechaConsulta']);

        nuevosPedidos.push({
            id: generarId(), clienteId: cliente.id, tipo: normalizarTipoImportado(fila['Tipo']),
            modelo: String(fila['Modelo'] || '').toUpperCase().trim(),
            tipoMueble: String(fila['TipoMueble'] || '').trim(),
            madera: String(fila['Madera'] || '').toUpperCase().trim(),
            medidas: String(fila['Medidas'] || '').trim(),
            tela: String(fila['Tela'] || '').trim(),
            color: String(fila['Color'] || '').trim(),
            precioTotal: parseFloat(fila['PrecioTotal']) || 0,
            pagos: montoPagado > 0 ? [{ fecha: fechaConsulta || new Date().toISOString().substring(0, 10), monto: montoPagado, medio: 'Importado' }] : [],
            costos: [], recordatorios: [], notas: [], fotos: [],
            etapa: normalizarEtapaImportada(fila['Etapa']),
            fechaConsulta, fechaEstimada: parseFechaImportada(fila['FechaEstimada']), fechaReal: parseFechaImportada(fila['FechaReal']),
            createdAt: new Date().toISOString()
        });
        pedidosNuevos++;
    });
    return { pedidosNuevos, clientesNuevos, aplicar: () => pedidos.push(...nuevosPedidos) };
}

window.importarPedidosExcel = function(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const filas = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
            if (filas.length === 0) { alert('El archivo no tiene filas para importar.'); inputEl.value = ''; return; }
            const resultado = procesarFilasImportadas(filas);
            if (resultado.pedidosNuevos === 0) { alert('No se encontró ninguna fila con la columna "Cliente" completa. Revisá que el archivo siga la plantilla.'); inputEl.value = ''; return; }
            if (!confirm(`Se van a crear ${resultado.pedidosNuevos} pedido(s) y ${resultado.clientesNuevos} cliente(s) nuevo(s). ¿Confirmás la importación?`)) { inputEl.value = ''; return; }
            resultado.aplicar();
            if (!(await guardarTodo())) return;
            renderTodo();
            alert('Importación completada.');
        } catch (err) {
            console.error(err);
            alert('No se pudo leer el archivo. Verificá que sea un Excel o CSV válido y que respete las columnas de la plantilla.');
        }
        inputEl.value = '';
    };
    reader.readAsArrayBuffer(file);
};

// ==========================================================================
// SUPABASE — CONEXIÓN Y AUTENTICACIÓN REAL
// ==========================================================================
const SUPABASE_URL = 'https://rqvynuonbeqjrkebmynj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_n1XeAFd-R2puy7ElLRAywg_5-bK_4yp';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.intentarIngresar = async function() {
    const email = document.getElementById('gate-email').value.trim();
    const password = document.getElementById('gate-password').value;
    const boton = document.getElementById('gate-btn');
    const error = document.getElementById('gate-error');
    error.style.display = 'none';
    boton.textContent = 'Ingresando...';
    boton.disabled = true;

    const { error: errorLogin } = await supabaseClient.auth.signInWithPassword({ email, password });

    boton.textContent = 'Ingresar';
    boton.disabled = false;

    if (errorLogin) {
        error.style.display = 'block';
        return;
    }
    document.getElementById('gate-overlay').style.display = 'none';
    iniciarApp();
};

window.cerrarSesion = async function() {
    if (!confirm('¿Cerrar sesión?')) return;
    await supabaseClient.auth.signOut();
    location.reload();
};

// ==========================================================================
// INIT
// ==========================================================================
async function iniciarApp() {
    await cargarTodo();
    await migrarLocalStorageASupabaseSiHaceFalta();
    if (pedidos.length === 0 && clientes.length === 0 && proveedores.length === 0) {
        if (confirm('No hay datos cargados todavía. ¿Querés cargar datos de ejemplo para probar el CRM?')) {
            await cargarDatosDeEjemplo();
        }
    }
    renderTodo();
}

// Supabase Auth guarda la sesión sola (en su propio storage, con tokens que
// vencen y se renuevan solos) — por eso alcanza con preguntarle "¿ya hay
// alguien logueado?" en vez de manejar nosotros ninguna bandera a mano.
supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session) {
        document.getElementById('gate-overlay').style.display = 'none';
        iniciarApp();
    }
    // Si no hay sesión, el overlay se queda tapando todo hasta que se loguee.
});

// script.js - Realtime & Multi-user integration (kept original UX)

// --- GLOBAL (server stocks + socket) ---
let SERVER_STOCKS_MAP = new Map();
let socket = null;
let bulkTimer = null;

// --- FUNGSI DATA & PARSING ---
function parseXmlData(xmlDoc) {
    const packages = xmlDoc.getElementsByTagName('package');
    const dataArray = [];

    for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        try {
            const provider = pkg.getElementsByTagName('provider')[0].textContent;
            const validity = pkg.getElementsByTagName('validity')[0].textContent;
            const quota = pkg.getElementsByTagName('quota')[0].textContent;
            
            dataArray.push({ provider, validity, quota });
        } catch (e) {
            console.error("Kesalahan membaca tag pada package ke:", i + 1, e);
        }
    }
    return dataArray;
}

function populateProviderFilter(dataArray) {
    const filterSelect = document.getElementById('provider-filter');
    const providers = new Set();

    dataArray.forEach(paket => providers.add(paket.provider));

    providers.forEach(provider => {
        const option = document.createElement('option');
        option.value = provider;
        option.textContent = provider;
        filterSelect.appendChild(option);
    });
}

async function loadServerStocks() {
    try {
        const resp = await fetch('/api/stocks');
        const arr = await resp.json();
        SERVER_STOCKS_MAP = new Map(arr.map(r => [r.name, r]));
    } catch (e) {
        console.warn('Gagal memuat data stok dari server:', e);
    }
}

function getServerStock(namaPaket) {
    return SERVER_STOCKS_MAP.get(namaPaket) || null;
}

async function loadAndInitializeData() {
    try {
        const response = await fetch('data.xml');
        if (!response.ok) {
            throw new Error(`Gagal memuat file: Status ${response.status} (${response.statusText}).`);
        }
        const xmlString = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "application/xml");

        if (xmlDoc.getElementsByTagName("parsererror").length) {
            console.error("Error parsing XML:", xmlDoc.getElementsByTagName("parsererror")[0].textContent);
            alert("Error fatal saat memproses data.xml. Mohon periksa kembali syntax XML di file data.xml.");
            return;
        }

        const dataPaketArray = parseXmlData(xmlDoc);
        
        if (dataPaketArray.length === 0) {
            console.warn("Array data paket kosong. Tidak ada produk untuk ditampilkan.");
            return;
        }

        populateProviderFilter(dataPaketArray);

        dataPaketArray.forEach(paket => {
            const namaPaket = `${paket.provider} | ${paket.quota} | ${paket.validity}`;
            
            // Ambil dari server bila tersedia
            const serverRow = getServerStock(namaPaket);
            
            const stokAtas = serverRow ? String(serverRow.atas) : '0';
            const stokBawah = serverRow ? String(serverRow.bawah) : '0';
            const stokBelakang = serverRow ? String(serverRow.belakang) : '0';
            const stokKomputer = serverRow ? String(serverRow.komputer) : '0';

            tambahBarang(namaPaket, stokKomputer, stokAtas, stokBawah, stokBelakang);
        });
        
        document.getElementById('tambah-btn').style.display = 'none';

    } catch (error) {
        console.error("Error utama saat inisialisasi:", error);
        alert(`Gagal memuat data. Pastikan file 'data.xml' ada dan server berjalan.`);
    }
}

// --- FUNGSI SERVER SYNC ---
function sendRowUpdate(rowId) {
    const row = document.getElementById('row_' + rowId);
    if (!row) return;
    const namaPaket = row.cells[0].textContent;
    const parts = namaPaket.split(' | ');
    const provider = parts[0] || '';
    const quota = parts[1] || '';
    const validity = parts[2] || '';

    const payload = {
        name: namaPaket,
        provider, quota, validity,
        atas: parseInt(document.getElementById('atas_' + rowId).value) || 0,
        bawah: parseInt(document.getElementById('bawah_' + rowId).value) || 0,
        belakang: parseInt(document.getElementById('belakang_' + rowId).value) || 0,
        komputer: parseInt(document.getElementById('komputer_' + rowId).value) || 0,
        total_fisik: parseInt(document.getElementById('total_fisik_' + rowId).textContent) || 0
    };

    fetch('/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(err => console.error('Gagal kirim update row:', err));
}

// Kirim snapshot (bulk) dengan debounce ringan
function sendBulkSnapshot() {
    if (bulkTimer) clearTimeout(bulkTimer);
    bulkTimer = setTimeout(() => {
        const stockData = {};
        const stockRows = document.getElementById('stock-body').rows;
        Array.from(stockRows).forEach(row => {
            const rowId = row.id.split('_')[1];
            const namaPaket = row.cells[0].textContent;
            const atas = document.getElementById('atas_' + rowId)?.value || '0';
            const bawah = document.getElementById('bawah_' + rowId)?.value || '0';
            const belakang = document.getElementById('belakang_' + rowId)?.value || '0';
            const komputer = document.getElementById('komputer_' + rowId)?.value || '0';
            stockData[namaPaket] = { atas, bawah, belakang, komputer };
        });

        const payloadArr = Object.entries(stockData).map(([name, vals]) => {
            const [provider, quota, validity] = name.split(' | ');
            const row = Array.from(stockRows).find(r => r.cells[0].textContent === name);
            const rowId = row ? row.id.split('_')[1] : null;
            const total = rowId ? (parseInt(document.getElementById('total_fisik_' + rowId).textContent) || 0) : 0;
            return {
                name, provider, quota, validity,
                atas: +vals.atas || 0,
                bawah: +vals.bawah || 0,
                belakang: +vals.belakang || 0,
                komputer: +vals.komputer || 0,
                total_fisik: total
            };
        });

        fetch('/api/stocks/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadArr)
        }).catch(err => console.error('Gagal kirim bulk snapshot:', err));
    }, 250);
}

// === FUNGSI LOCALSTORAGE (sebagai backup offline) ===
const STORAGE_KEY = 'kalkulatorStokData';
function saveStockData() {
    const stockData = {};
    const stockRows = document.getElementById('stock-body').rows;

    Array.from(stockRows).forEach(row => {
        const rowId = row.id.split('_')[1];
        const namaPaket = row.cells[0].textContent;
        
        const atas = document.getElementById('atas_' + rowId)?.value || '0';
        const bawah = document.getElementById('bawah_' + rowId)?.value || '0';
        const belakang = document.getElementById('belakang_' + rowId)?.value || '0';
        const komputer = document.getElementById('komputer_' + rowId)?.value || '0';

        stockData[namaPaket] = { atas, bawah, belakang, komputer };
    });

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stockData));
    } catch (e) {
        console.error("Gagal menyimpan data ke LocalStorage", e);
    }

    // juga sinkron ke server (bulk, debounce)
    sendBulkSnapshot();
}

function loadStockData(namaPaket) {
    // Utamakan dari server
    const serverRow = getServerStock(namaPaket);
    if (serverRow) {
        return {
            atas: String(serverRow.atas || 0),
            bawah: String(serverRow.bawah || 0),
            belakang: String(serverRow.belakang || 0),
            komputer: String(serverRow.komputer || 0)
        };
    }
    // backup dari localStorage kalau ada
    const storedDataString = localStorage.getItem(STORAGE_KEY);
    if (!storedDataString) return null;
    try {
        const storedData = JSON.parse(storedDataString);
        return storedData[namaPaket] || null;
    } catch (e) {
        console.error("Gagal memproses data dari LocalStorage", e);
        return null;
    }
}

// --- FUNGSI UTILITY & FILTER ---
function filterProducts(selectedProvider) {
    const isMobile = window.innerWidth <= 768;
    const displayStyle = isMobile ? 'block' : 'table-row';
    const stockBody = document.getElementById('stock-body');
    const selisihBody = document.getElementById('selisih-body');

    // 1. Filter Tabel Utama (Stok Fisik)
    Array.from(stockBody.rows).forEach(row => {
        const providerName = row.getAttribute('data-provider');
        
        if (selectedProvider === 'Semua' || providerName === selectedProvider) {
            row.style.display = displayStyle;
        } else {
            row.style.display = 'none';
        }
    });

    // 2. Filter Tabel Selisih
    Array.from(selisihBody.rows).forEach(row => {
        const providerName = row.getAttribute('data-provider');
        const isSelisihZero = row.cells[1].textContent === '0';

        const isProviderMatch = selectedProvider === 'Semua' || providerName === selectedProvider;
        
        if (isProviderMatch && !isSelisihZero) {
            row.style.display = displayStyle;
        } else {
            row.style.display = 'none';
        }
    });
}

function clearZero(element) {
    if (element.value === '0') {
        element.value = '';
    }
}

function resetZero(element, rowId) {
    if (element.value === '') {
        element.value = '0';
    }
    const idPrefix = element.id.split('_')[0];
    if (idPrefix === 'komputer') {
        hitungSelisih(rowId);
    } else {
        hitungTotal(rowId);
    }
    saveStockData();
    sendRowUpdate(rowId);
}

// --- FUNGSI KALKULATOR UTAMA ---
let itemCounter = 0;
const headerLabels = [
    "Nama Paket", "Display Atas", "Display Bawah", "Display Belakang", 
    "Total Fisik", "Stok Komputer", "Aksi"
];

function ubahStokKomputer(idInput, operasi) {
    const inputElement = document.getElementById(idInput);
    let nilaiSaatIni = parseInt(inputElement.value) || 0;
    let rowId = idInput.split('_')[1]; // fix bug: use idInput

    if (operasi === 'plus') {
        nilaiSaatIni += 1;
    } else if (operasi === 'minus' && nilaiSaatIni > 0) {
        nilaiSaatIni -= 1;
    }
    
    inputElement.value = nilaiSaatIni;
    hitungSelisih(rowId); 
    filterProducts(document.getElementById('provider-filter').value); 
    saveStockData();
    sendRowUpdate(rowId);
}

function ubahStok(idInput, operasi) {
    const inputElement = document.getElementById(idInput);
    let nilaiSaatIni = parseInt(inputElement.value) || 0;
    let rowId = idInput.split('_')[1]; // fix bug: use idInput

    if (operasi === 'plus') {
        nilaiSaatIni += 1;
    } else if (operasi === 'minus' && nilaiSaatIni > 0) {
        nilaiSaatIni -= 1;
    }
    
    inputElement.value = nilaiSaatIni;
    hitungTotal(rowId); 
    filterProducts(document.getElementById('provider-filter').value); 
    saveStockData();
    sendRowUpdate(rowId);
}

function hitungTotal(rowId) {
    const displayAtas = parseInt(document.getElementById('atas_' + rowId).value) || 0;
    const displayBawah = parseInt(document.getElementById('bawah_' + rowId).value) || 0;
    const displayBelakang = parseInt(document.getElementById('belakang_' + rowId).value) || 0;
    
    const totalFisik = displayAtas + displayBawah + displayBelakang; 

    document.getElementById('total_fisik_' + rowId).textContent = totalFisik;
    
    hitungSelisih(rowId); 
    hitungGrandTotal();
}

function hitungSelisih(rowId) {
    const totalFisik = parseInt(document.getElementById('total_fisik_' + rowId).textContent) || 0;
    const stokKomputer = parseInt(document.getElementById('komputer_' + rowId).value) || 0;
    const selisih = totalFisik - stokKomputer;
    const selisihElement = document.getElementById('selisih_nilai_' + rowId);
    const selisihRow = document.getElementById('selisih_row_' + rowId);

    let selisihTeks;
    let selisihClass;

    if (selisih > 0) {
        selisihTeks = `+${selisih}`;
        selisihClass = 'selisih-positive';
    } else if (selisih < 0) {
        selisihTeks = `${selisih}`;
        selisihClass = 'selisih-negative';
    } else {
        selisihTeks = '0';
        selisihClass = 'selisih-zero';
    }

    selisihElement.textContent = selisihTeks;
    selisihRow.className = selisihClass;
    
    filterProducts(document.getElementById('provider-filter').value);

    hitungGrandTotalSelisih();
}

function hitungGrandTotal() {
    let grandTotalFisik = 0;
    const fisikElements = document.querySelectorAll('[id^="total_fisik_"]'); 
    fisikElements.forEach(element => {
        grandTotalFisik += parseInt(element.textContent) || 0;
    });
    document.getElementById('grand-total-fisik').textContent = grandTotalFisik;
}

function hitungGrandTotalSelisih() {
    let grandTotal = 0;
    const stockRows = document.getElementById('stock-body').rows;

    Array.from(stockRows).forEach(row => {
        const rowId = row.id.split('_')[1];
        const totalFisik = parseInt(document.getElementById('total_fisik_' + rowId).textContent) || 0;
        const stokKomputer = parseInt(document.getElementById('komputer_' + rowId).value) || 0;
        grandTotal += (totalFisik - stokKomputer);
    });

    let selisihTeks = (grandTotal > 0) ? `+${grandTotal}` : String(grandTotal);
    document.getElementById('grand-total-selisih').textContent = selisihTeks;
}

function resetBarang(rowId) {
    document.getElementById('atas_' + rowId).value = 0;
    document.getElementById('bawah_' + rowId).value = 0;
    document.getElementById('belakang_' + rowId).value = 0;
    document.getElementById('komputer_' + rowId).value = 0; 

    hitungTotal(rowId); 
    filterProducts(document.getElementById('provider-filter').value); 
    saveStockData();
    sendRowUpdate(rowId);
}

function tambahBarang(namaAwal = `Paket Baru ${itemCounter + 1}`, stokKomputer, stokAtas, stokBawah, stokBelakang) {
    itemCounter++;
    const rowId = itemCounter;
    const tbody = document.getElementById('stock-body');
    const tbodySelisih = document.getElementById('selisih-body');
    
    const newRow = tbody.insertRow();
    newRow.id = 'row_' + rowId;

    const providerName = namaAwal.split(' | ')[0]; 
    newRow.setAttribute('data-provider', providerName); 

    newRow.insertCell().setAttribute('data-label', headerLabels[0]);
    newRow.cells[0].textContent = namaAwal;

    const createControlCell = (colIndex, initialValue, isComputer = false) => {
        const idPrefix = isComputer ? 'komputer' : ['atas', 'bawah', 'belakang'][colIndex - 2];
        const inputId = `${idPrefix}_${rowId}`;
        
        let inputAttributes = `value="${initialValue}" id="${inputId}" min="0" `;
        
        if (isComputer) {
            inputAttributes += `
                oninput="hitungSelisih(${rowId}); saveStockData(); sendRowUpdate(${rowId});" 
                onfocus="clearZero(this)" 
                onblur="resetZero(this, ${rowId})"
            `;
            
            return `
                <div class="control-group">
                    <button class="control-btn btn-minus" onclick="ubahStokKomputer('${inputId}', 'minus')">-</button>
                    <input type="number" ${inputAttributes}>
                    <button class="control-btn btn-plus" onclick="ubahStokKomputer('${inputId}', 'plus')">+</button>
                </div>
            `;
        }
        
        const eventHandler = `oninput="hitungTotal(${rowId}); saveStockData(); sendRowUpdate(${rowId});"`;
        inputAttributes += `
             onfocus="clearZero(this)" 
             onblur="resetZero(this, ${rowId})"
        `;
        
        return `
            <div class="control-group">
                <button class="control-btn btn-minus" onclick="ubahStok('${inputId}', 'minus')">-</button>
                <input type="number" ${inputAttributes} ${eventHandler}>
                <button class="control-btn btn-plus" onclick="ubahStok('${inputId}', 'plus')">+</button>
            </div>
        `;
    };

    newRow.insertCell().setAttribute('data-label', headerLabels[1]);
    newRow.cells[1].innerHTML = createControlCell(2, stokAtas);

    newRow.insertCell().setAttribute('data-label', headerLabels[2]);
    newRow.cells[2].innerHTML = createControlCell(3, stokBawah);

    newRow.insertCell().setAttribute('data-label', headerLabels[3]);
    newRow.cells[3].innerHTML = createControlCell(4, stokBelakang);

    let cellTotalFisik = newRow.insertCell();
    cellTotalFisik.id = 'total_fisik_' + rowId;
    cellTotalFisik.setAttribute('data-label', headerLabels[4]);
    cellTotalFisik.textContent = '0';
    
    newRow.insertCell().setAttribute('data-label', headerLabels[5]);
    newRow.cells[5].innerHTML = createControlCell(6, stokKomputer, true);

    newRow.insertCell().setAttribute('data-label', headerLabels[6]);
    newRow.cells[6].innerHTML = `<button class="hapus-btn" onclick="resetBarang(${rowId})" style="background-color: #ffc107; color: #333;">Reset</button>`;

    const newSelisihRow = tbodySelisih.insertRow();
    newSelisihRow.id = 'selisih_row_' + rowId;
    newSelisihRow.setAttribute('data-provider', providerName); 
    newSelisihRow.insertCell().textContent = namaAwal;

    let cellSelisih = newSelisihRow.insertCell();
    cellSelisih.id = 'selisih_nilai_' + rowId;
    cellSelisih.textContent = '0';

    hitungTotal(rowId);
}

// --- SOCKET HANDLERS (apply remote changes) ---
function applyRemoteUpdate(row) {
    // Cari baris berdasarkan nama paket
    const rows = document.getElementById('stock-body').rows;
    for (let i = 0; i < rows.length; i++) {
        const tr = rows[i];
        if (tr.cells[0].textContent === row.name) {
            const rowId = tr.id.split('_')[1];
            document.getElementById('atas_' + rowId).value = row.atas || 0;
            document.getElementById('bawah_' + rowId).value = row.bawah || 0;
            document.getElementById('belakang_' + rowId).value = row.belakang || 0;
            document.getElementById('komputer_' + rowId).value = row.komputer || 0;
            hitungTotal(rowId);
            return;
        }
    }
}

// --- INISIALISASI ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        socket = io();
        socket.on('stock_update', (row) => applyRemoteUpdate(row));
    } catch (e) {
        console.warn('Socket.IO tidak tersedia:', e);
    }
    await loadServerStocks();
    await loadAndInitializeData();
});
/* ═══════════════════════════════════════════════════════════════
   庫存管理系統 – Frontend Logic
   架構：State → API → Auth → Layout → Dashboard → UDI Input → Receive → Init
═══════════════════════════════════════════════════════════════ */

'use strict';

const API_BASE = '/api';

/* ── State ─────────────────────────────────────────────── */
const state = {
  user:       null,
  page:       'input',
  inventory:  [],
  products:   [],
  locations:  [],
  sessionTx:  [],   // UDI 掃碼作業本次紀錄
  receiveLog: []    // 商品入庫本次紀錄
};

/* ── API helpers ────────────────────────────────────────── */
async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ── Auth ───────────────────────────────────────────────── */
async function loadUsers() {
  const sel = document.getElementById('user-select');
  try {
    const users = await apiFetch('/users');
    if (!users.length) throw new Error('no users');
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(u);
      opt.textContent = u.department
        ? `${u.display_name}（${u.department}）`
        : u.display_name;
      sel.appendChild(opt);
    });
  } catch {
    // API 尚未就緒 → 改用文字輸入
    const inp = document.createElement('input');
    inp.id          = 'user-select';
    inp.type        = 'text';
    inp.className   = 'form-control';
    inp.placeholder = '請輸入姓名';
    inp.addEventListener('input', () => {
      document.getElementById('login-btn').disabled = !inp.value.trim();
    });
    sel.replaceWith(inp);
  }
}

function handleLogin() {
  const el = document.getElementById('user-select');
  let user;
  if (el.tagName === 'SELECT') {
    if (!el.value) return;
    user = JSON.parse(el.value);
  } else {
    const name = el.value.trim();
    if (!name) return;
    user = { user_id: null, username: name, display_name: name, department: '' };
  }
  state.user = user;
  localStorage.setItem('stock_user', JSON.stringify(user));
  showApp();
}

function handleLogout() {
  state.user      = null;
  state.sessionTx  = [];
  state.receiveLog = [];
  localStorage.removeItem('stock_user');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

/* ── Layout ─────────────────────────────────────────────── */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  document.getElementById(`page-${page}`).classList.add('active');
  state.page = page;

  if (page === 'dashboard') loadDashboard();
  if (page === 'receive')   loadReceivePage();
}

/* ── App Entry ──────────────────────────────────────────── */
function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  const u = state.user;
  document.getElementById('topbar-user').textContent      = u.display_name;
  document.getElementById('input-badge-user').textContent  = u.display_name;
  document.getElementById('receive-badge-user').textContent = u.display_name;

  loadProducts();
}

/* ── Products (shared) ──────────────────────────────────── */
async function loadProducts() {
  try {
    const products = await apiFetch('/products');
    state.products = products;

    const sel = document.getElementById('filter-product');
    sel.querySelectorAll('option:not([value=""])').forEach(o => o.remove());
    products.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.product_id;
      opt.textContent = p.product_name;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.warn('[loadProducts]', e.message);
  }
}

/* ── Dashboard ──────────────────────────────────────────── */
async function loadDashboard() {
  const productId = document.getElementById('filter-product').value;
  const lotNo     = document.getElementById('filter-lot').value.trim();
  const status    = document.getElementById('filter-status').value;

  const qs = new URLSearchParams();
  if (productId) qs.set('product_id', productId);
  if (lotNo)     qs.set('lot_no', lotNo);
  if (status)    qs.set('status', status);

  try {
    const data = await apiFetch('/inventory?' + qs.toString());
    state.inventory = data;
    renderStats(data);
    renderInventoryTable(data);
  } catch (e) {
    document.getElementById('inv-tbody').innerHTML =
      `<tr><td colspan="9" class="empty" style="color:var(--danger)">載入失敗：${esc(e.message)}</td></tr>`;
  }
}

function renderStats(data) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const near  = new Date(today); near.setDate(near.getDate() + 90);

  const uniqueProducts = new Set(data.map(r => r.product_id)).size;
  let nearCnt = 0, expiredCnt = 0;

  data.forEach(r => {
    if (!r.expiry_date) return;
    const d = new Date(r.expiry_date);
    if (d < today)      expiredCnt++;
    else if (d <= near) nearCnt++;
  });

  document.getElementById('stat-products').textContent    = uniqueProducts;
  document.getElementById('stat-containers').textContent  = data.length;
  document.getElementById('stat-near-expiry').textContent = nearCnt;
  document.getElementById('stat-expired').textContent     = expiredCnt;
}

function renderInventoryTable(data) {
  const tbody = document.getElementById('inv-tbody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">查無符合條件之資料</td></tr>';
    return;
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const near  = new Date(today); near.setDate(near.getDate() + 90);

  const statusLabel = {
    sealed:   '<span class="status-badge status-sealed">未開封</span>',
    opened:   '<span class="status-badge status-opened">已開封</span>',
    unpacked: '<span class="status-badge status-unpacked">已拆箱</span>',
    consumed: '<span class="status-badge status-consumed">已耗盡</span>'
  };

  tbody.innerHTML = data.map(r => {
    let rowCls = '', expCls = '', expText = '—';
    if (r.expiry_date) {
      const d = new Date(r.expiry_date);
      expText = r.expiry_date;
      if (d < today)      { rowCls = 'row-expired';  expCls = 'expiry-expired'; }
      else if (d <= near) { rowCls = 'row-near-exp'; expCls = 'expiry-near'; }
    }
    return `<tr class="${rowCls}">
      <td>${esc(r.product_name)}</td>
      <td><code>${esc(r.primary_di || '—')}</code></td>
      <td>${esc(r.level_code || '—')}</td>
      <td>${esc(r.lot_no || '—')}</td>
      <td class="${expCls}">${expText}</td>
      <td>${esc(r.serial_no || '—')}</td>
      <td>${r.current_qty} <span style="color:var(--text-sm)">${esc(r.default_uom || '')}</span></td>
      <td>${esc(r.location_code || '—')}</td>
      <td>${statusLabel[r.status] || esc(r.status)}</td>
    </tr>`;
  }).join('');
}

/* ── Receive Page ───────────────────────────────────────── */
async function loadReceivePage() {
  // 載入儲位（首次或重新整理）
  try {
    state.locations = await apiFetch('/locations');
  } catch (e) {
    console.warn('[loadReceivePage locations]', e.message);
  }

  // 填入儲位下拉
  const locSel = document.getElementById('receive-location');
  locSel.querySelectorAll('option:not([value=""])').forEach(o => o.remove());
  state.locations.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.location_id;
    opt.textContent = l.area_name
      ? `[${l.area_name}] ${l.location_name}`
      : l.location_name;
    locSel.appendChild(opt);
  });

  // 填入商品下拉（來自已快取的 state.products）
  const prodSel = document.getElementById('receive-product');
  prodSel.querySelectorAll('option:not([value=""])').forEach(o => o.remove());
  state.products.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.product_id;
    opt.textContent = p.product_name;
    prodSel.appendChild(opt);
  });

  updateReceiveBtn();
}

async function loadPackagingForProduct(productId) {
  const pkgSel = document.getElementById('receive-packaging');
  pkgSel.querySelectorAll('option:not([value=""])').forEach(o => o.remove());

  if (!productId) { updateReceiveBtn(); return; }

  try {
    const pkgs = await apiFetch(`/packaging?product_id=${encodeURIComponent(productId)}`);
    const unitMap = { each: '個', box: '盒', case: '箱' };
    pkgs.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.packaging_id;
      const unit = unitMap[p.level_code] || p.level_code;
      opt.textContent = p.package_type
        ? `${p.package_type}（每包 ${p.quantity_per_package} ${unit}）`
        : `${p.level_code}（每包 ${p.quantity_per_package} ${unit}）`;
      pkgSel.appendChild(opt);
    });
    if (pkgs.length === 1) pkgSel.value = pkgs[0].packaging_id;
  } catch (e) {
    console.warn('[loadPackagingForProduct]', e.message);
  }

  updateReceiveBtn();
}

function updateReceiveBtn() {
  const product  = document.getElementById('receive-product').value;
  const location = document.getElementById('receive-location').value;
  const qty      = parseInt(document.getElementById('receive-qty').value) || 0;
  document.getElementById('receive-submit-btn').disabled = !(product && location && qty >= 1);
}

async function handleReceiveSubmit() {
  const productId   = document.getElementById('receive-product').value;
  const packagingId = document.getElementById('receive-packaging').value;
  const lotNo       = document.getElementById('receive-lot').value.trim();
  const expiry      = document.getElementById('receive-expiry').value;
  const serialNo    = document.getElementById('receive-serial').value.trim();
  const qty         = parseInt(document.getElementById('receive-qty').value) || 1;
  const locationId  = document.getElementById('receive-location').value;
  const remark      = document.getElementById('receive-remark').value.trim();
  const udi         = document.getElementById('receive-udi').value.trim();

  if (!productId || !locationId) return;

  const productName  = state.products.find(p => p.product_id === productId)?.product_name || productId;
  const locationName = state.locations.find(l => l.location_id === locationId)?.location_name || locationId;

  // 加入本次入庫紀錄（前端暫存）
  state.receiveLog.unshift({
    productName, lotNo, qty, locationId, locationName,
    time: new Date().toLocaleTimeString('zh-TW', { hour12: false })
  });
  renderReceiveLog();

  // POST 到後端
  try {
    await apiFetch('/transactions', {
      method: 'POST',
      body: JSON.stringify({
        tx_type:      'receive',
        udi,
        product_id:   productId,
        packaging_id: packagingId,
        lot_no:       lotNo,
        expiry_date:  expiry,
        serial_no:    serialNo,
        qty,
        location_id:  locationId,
        remark,
        user_id:      state.user?.user_id
      })
    });
  } catch (e) {
    console.warn('[handleReceiveSubmit]', e.message);
  }

  // 清除欄位（保留儲位與商品選擇，方便連續入庫）
  document.getElementById('receive-udi').value    = '';
  document.getElementById('receive-lot').value    = '';
  document.getElementById('receive-expiry').value = '';
  document.getElementById('receive-serial').value = '';
  document.getElementById('receive-qty').value    = '1';
  document.getElementById('receive-remark').value = '';
  document.getElementById('receive-udi').focus();
  updateReceiveBtn();
}

function renderReceiveLog() {
  const container = document.getElementById('receive-log');
  if (!state.receiveLog.length) {
    container.innerHTML = '<p class="empty">尚無入庫紀錄</p>';
    return;
  }
  container.innerHTML = state.receiveLog.map(e => `
    <div class="tx-entry">
      <span class="tx-badge tx-receive">入庫</span>
      <span>${esc(e.productName)}</span>
      ${e.lotNo ? `<span style="color:var(--text-sm)">批號: ${esc(e.lotNo)}</span>` : ''}
      <span style="color:var(--text-sm)">× ${e.qty}</span>
      <span style="color:var(--text-sm)">→ ${esc(e.locationName)}</span>
      <span class="tx-time">${e.time}</span>
    </div>
  `).join('');
}

/* ── UDI 掃碼作業 ───────────────────────────────────────── */
function handleSubmit() {
  const udi    = document.getElementById('udi-input').value.trim();
  const txType = document.querySelector('input[name="tx"]:checked')?.value;
  const qty    = parseInt(document.getElementById('tx-qty').value) || 1;
  const note   = document.getElementById('tx-note').value.trim();

  if (!udi || !txType) return;

  state.sessionTx.unshift({
    udi, txType, qty, note,
    time: new Date().toLocaleTimeString('zh-TW', { hour12: false })
  });

  renderTxLog();
  document.getElementById('udi-input').value = '';
  document.getElementById('udi-input').focus();
  updateSubmitBtn();
}

function renderTxLog() {
  const container = document.getElementById('tx-log');
  if (!state.sessionTx.length) {
    container.innerHTML = '<p class="empty">尚無作業紀錄</p>';
    return;
  }
  const typeLabel = {
    issue: '出庫', transfer: '移位', unpack_out: '拆箱出',
    unpack_in: '拆箱入', return: '退回', adjust: '盤點'
  };
  container.innerHTML = state.sessionTx.map(e => `
    <div class="tx-entry">
      <span class="tx-badge tx-${e.txType.replace('_', '-')}">${typeLabel[e.txType] || e.txType}</span>
      <span>${esc(e.udi)}</span>
      <span style="color:var(--text-sm)">× ${e.qty}</span>
      ${e.note ? `<span style="color:var(--text-sm);font-size:.78rem">｜${esc(e.note)}</span>` : ''}
      <span class="tx-time">${e.time}</span>
    </div>
  `).join('');
}

function updateSubmitBtn() {
  const udi    = document.getElementById('udi-input').value.trim();
  const txType = document.querySelector('input[name="tx"]:checked');
  document.getElementById('submit-btn').disabled = !(udi && txType);
}

/* ── Helpers ────────────────────────────────────────────── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Init ───────────────────────────────────────────────── */
function init() {
  // 登入
  document.getElementById('user-select').addEventListener('change', e => {
    document.getElementById('login-btn').disabled = !e.target.value;
  });
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // 側邊欄
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(el.dataset.page);
    });
  });

  // Dashboard
  document.getElementById('search-btn').addEventListener('click', loadDashboard);
  document.getElementById('refresh-btn').addEventListener('click', loadDashboard);

  // UDI 掃碼作業
  document.getElementById('udi-input').addEventListener('input', updateSubmitBtn);
  document.querySelectorAll('input[name="tx"]').forEach(el => {
    el.addEventListener('change', updateSubmitBtn);
  });
  document.getElementById('submit-btn').addEventListener('click', handleSubmit);
  document.getElementById('udi-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSubmit();
  });

  // 商品入庫
  document.getElementById('receive-product').addEventListener('change', e => {
    loadPackagingForProduct(e.target.value);
  });
  document.getElementById('receive-location').addEventListener('change', updateReceiveBtn);
  document.getElementById('receive-qty').addEventListener('input', updateReceiveBtn);
  document.getElementById('receive-submit-btn').addEventListener('click', handleReceiveSubmit);
  document.getElementById('receive-udi').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('receive-product').focus();
  });

  // 從 localStorage 恢復登入狀態
  const saved = localStorage.getItem('stock_user');
  if (saved) {
    try {
      state.user = JSON.parse(saved);
      showApp();
    } catch {
      localStorage.removeItem('stock_user');
      loadUsers();
    }
  } else {
    loadUsers();
  }
}

document.addEventListener('DOMContentLoaded', init);

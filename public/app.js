// ── Traffic Harvester — Frontend Logic ──
const API = '';
let token = localStorage.getItem('th_token');
let currentUser = null;
let allProducts = [];
let qrPollInterval = null;

// ── API Helper ──
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Auth ──
function toggleAuth(mode) {
  document.getElementById('loginForm').style.display = mode === 'login' ? '' : 'none';
  document.getElementById('registerForm').style.display = mode === 'register' ? '' : 'none';
  document.getElementById('authMsg').className = 'msg';
}

function showAuthMsg(text, type) {
  const el = document.getElementById('authMsg');
  el.textContent = text;
  el.className = 'msg ' + type;
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  btn.textContent = 'Memproses...'; btn.disabled = true;
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPass').value,
      })
    });
    token = data.token;
    localStorage.setItem('th_token', token);
    currentUser = data.user;
    enterDashboard();
  } catch (err) {
    showAuthMsg(err.message, 'error');
  } finally {
    btn.textContent = 'Masuk'; btn.disabled = false;
  }
  return false;
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('regBtn');
  btn.textContent = 'Memproses...'; btn.disabled = true;
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPass').value,
        store_name: document.getElementById('regStore').value || null,
      })
    });
    token = data.token;
    localStorage.setItem('th_token', token);
    currentUser = data.user;
    enterDashboard();
  } catch (err) {
    showAuthMsg(err.message, 'error');
  } finally {
    btn.textContent = 'Daftar'; btn.disabled = false;
  }
  return false;
}

function logout() {
  token = null;
  localStorage.removeItem('th_token');
  if (qrPollInterval) clearInterval(qrPollInterval);
  document.getElementById('authPage').style.display = '';
  document.getElementById('dashboardPage').style.display = 'none';
}

// ── Dashboard ──
async function enterDashboard() {
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('dashboardPage').style.display = '';
  try {
    if (!currentUser) {
      const data = await api('/api/me');
      currentUser = data.user;
    }
    document.getElementById('userName').textContent = currentUser.store_name || currentUser.email.split('@')[0];
  } catch (err) {
    logout(); return;
  }
  loadStatus();
  loadStats();
  loadShowcases();
  loadProducts();
  checkConnectionState();
}

// ── Navigation ──
function goTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
}

// ── Status ──
async function loadStatus() {
  try {
    const data = await api('/api/status');
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    const qDot = document.getElementById('qrStatusDot');
    const qTxt = document.getElementById('qrStatusText');
    if (data.connected) {
      dot.className = 'status-dot green'; txt.textContent = 'Connected';
      if (qDot) { qDot.className = 'status-dot green'; qTxt.textContent = 'Bot terkoneksi'; }
    } else {
      dot.className = 'status-dot red'; txt.textContent = 'Disconnected';
      if (qDot) { qDot.className = 'status-dot red'; qTxt.textContent = 'Belum terkoneksi'; }
    }
  } catch { /* silent */ }
}

// ── Stats ──
async function loadStats() {
  try {
    const data = await api('/products/stats');
    const s = data.stats;
    document.getElementById('statTotal').textContent = s.total || '0';
    document.getElementById('statPending').textContent = s.unposted || '0';
    document.getElementById('statPosted').textContent = s.posted || '0';
  } catch { /* silent */ }
  try {
    const me = await api('/api/me');
    document.getElementById('statShowcase').textContent = me.showcases ? me.showcases.length : '0';
  } catch { /* silent */ }
}

// ── QR & Connection ──
function showConnectCard() {
  document.getElementById('connectCard').style.display = '';
  document.getElementById('connectedCard').style.display = 'none';
}

function showConnectedCard() {
  document.getElementById('connectCard').style.display = 'none';
  document.getElementById('connectedCard').style.display = '';
}

function requestQR() {
  const phone = document.getElementById('botPhoneInput').value.trim();
  if (!phone) return alert('Masukkan nomor bot WA');
  const btn = document.getElementById('connectBtn');
  btn.textContent = 'Connecting...';
  btn.disabled = true;
  const container = document.getElementById('qrContainer');
  container.innerHTML = '<div class="qr-placeholder"><div class="status-dot yellow" style="animation:pulse 1.5s infinite"></div><p style="margin-top:12px">Menghubungkan ke server...</p></div>';
  document.getElementById('qrStatusDot').className = 'status-dot yellow';
  document.getElementById('qrStatusText').textContent = 'Connecting...';
  if (qrPollInterval) clearInterval(qrPollInterval);
  qrPollInterval = setInterval(pollQR, 3000);
  pollQR();
}

async function pollQR() {
  try {
    const data = await api('/api/qr');
    const container = document.getElementById('qrContainer');
    const btn = document.getElementById('connectBtn');
    if (data.connected) {
      // Connected — switch to connected card
      showConnectedCard();
      if (qrPollInterval) { clearInterval(qrPollInterval); qrPollInterval = null; }
      btn.textContent = 'Connect';
      btn.disabled = false;
      loadStatus();
    } else if (data.qr) {
      // QR available — show it
      container.innerHTML = '<canvas id="qrCanvas"></canvas><p style="margin-top:12px;font-size:13px;color:var(--text2)">Scan dengan WhatsApp</p>';
      if (typeof QRCode !== 'undefined') {
        QRCode.toCanvas(document.getElementById('qrCanvas'), data.qr, { width: 220, margin: 2, color: { dark: '#ffffff', light: '#00000000' } });
      }
      document.getElementById('qrStatusDot').className = 'status-dot yellow';
      document.getElementById('qrStatusText').textContent = 'Menunggu scan...';
      btn.textContent = 'Connect';
      btn.disabled = false;
    } else if (data.connecting) {
      // Connecting state — show spinner
      container.innerHTML = '<div class="qr-placeholder"><div class="status-dot yellow" style="animation:pulse 1.5s infinite"></div><p style="margin-top:12px">Menghubungkan ke WhatsApp...</p></div>';
      document.getElementById('qrStatusDot').className = 'status-dot yellow';
      document.getElementById('qrStatusText').textContent = 'Connecting...';
    }
  } catch { /* silent */ }
}

async function disconnectBot() {
  if (!confirm('Yakin mau disconnect bot? Kamu perlu scan QR ulang untuk menghubungkan kembali.')) return;
  const btn = document.getElementById('disconnectBtn');
  btn.textContent = 'Disconnecting...';
  btn.disabled = true;
  try {
    await api('/api/disconnect', { method: 'POST' });
    showConnectCard();
    document.getElementById('qrContainer').innerHTML = '<div class="qr-placeholder"><p style="font-size:14px">Bot berhasil di-disconnect.</p><p style="font-size:12px;margin-top:6px">Masukkan nomor baru dan klik Connect.</p></div>';
    document.getElementById('qrStatusDot').className = 'status-dot red';
    document.getElementById('qrStatusText').textContent = 'Disconnected';
    loadStatus();
  } catch (err) {
    alert('Gagal disconnect: ' + err.message);
  } finally {
    btn.textContent = '🔌 Disconnect Bot';
    btn.disabled = false;
  }
}

// Auto-detect connection state when page loads
async function checkConnectionState() {
  try {
    const data = await api('/api/qr');
    if (data.connected) {
      showConnectedCard();
    } else {
      showConnectCard();
    }
  } catch { showConnectCard(); }
}

// ── Showcase ──
async function loadShowcases() {
  try {
    const data = await api('/api/me');
    const list = document.getElementById('showcaseList');
    const showcases = data.showcases || [];
    if (!showcases.length) {
      list.innerHTML = '<div class="empty-state"><p>Belum ada showcase. Tambah di atas!</p></div>';
      return;
    }
    list.innerHTML = showcases.map(s => `
      <div class="showcase-item fade-in">
        <div class="info">
          <div class="url">${escHtml(s.showcase_url || s.showcaseUrl)}</div>
          <div class="meta">${s.label || 'Tanpa label'} · Dibuat ${new Date(s.created_at || s.createdAt).toLocaleDateString('id-ID')}</div>
        </div>
        <div class="actions">
          <button class="btn-sm danger" onclick="removeShowcase(${s.id})">Hapus</button>
        </div>
      </div>
    `).join('');
  } catch { /* silent */ }
}

async function addShowcase(e) {
  e.preventDefault();
  try {
    await api('/api/showcase', {
      method: 'POST',
      body: JSON.stringify({
        showcase_url: document.getElementById('showcaseUrl').value,
        label: document.getElementById('showcaseLabel').value || null,
      })
    });
    document.getElementById('showcaseUrl').value = '';
    document.getElementById('showcaseLabel').value = '';
    loadShowcases();
    loadStats();
  } catch (err) { alert(err.message); }
  return false;
}

async function removeShowcase(id) {
  if (!confirm('Hapus showcase ini?')) return;
  try {
    await api('/api/showcase/' + id, { method: 'DELETE' });
    loadShowcases();
    loadStats();
  } catch (err) { alert(err.message); }
}

// ── Products ──
async function loadProducts() {
  try {
    const data = await api('/products/stats');
    // Load product list via raw endpoint
    const res = await fetch(API + '/api/products', { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) {
      const d = await res.json();
      allProducts = d.products || [];
      renderProducts(allProducts);
    }
  } catch { /* silent */ }
}

function filterProducts(filter, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  let filtered = allProducts;
  if (filter === 'pending') filtered = allProducts.filter(p => !p.is_posted);
  if (filter === 'posted') filtered = allProducts.filter(p => p.is_posted);
  renderProducts(filtered);
}

function getDisplayImageUrl(url) {
  if (!url) return null;
  // Convert Google Drive download URL to displayable thumbnail
  // drive.google.com/uc?export=download&id=FILE_ID → lh3.googleusercontent.com/d/FILE_ID
  const driveMatch = url.match(/drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/);
  if (driveMatch) return 'https://lh3.googleusercontent.com/d/' + driveMatch[1];
  // drive.google.com/file/d/FILE_ID/... → lh3.googleusercontent.com/d/FILE_ID
  const driveMatch2 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch2) return 'https://lh3.googleusercontent.com/d/' + driveMatch2[1];
  return url;
}

function renderProducts(list) {
  const grid = document.getElementById('productGrid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><p>Belum ada produk.</p></div>';
    return;
  }
  grid.innerHTML = list.map(p => {
    const imgUrl = getDisplayImageUrl(p.image_url);
    return `
    <div class="product-card fade-in">
      ${imgUrl ? `<img class="thumb" src="${escHtml(imgUrl)}" alt="" onerror="this.style.display='none'">` : '<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text2);font-size:12px">No Image</div>'}
      <div class="body">
        <div class="title">${escHtml(p.title)}</div>
        ${p.price ? `<div class="price">${escHtml(p.price)}</div>` : ''}
        <span class="badge ${p.is_posted ? 'posted' : 'pending'}">${p.is_posted ? '✅ Sudah Diposting' : '⏳ Belum Diposting'}</span>
      </div>
    </div>`;
  }).join('');
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── Init ──
(async function init() {
  if (token) {
    try {
      await api('/api/me');
      enterDashboard();
    } catch { logout(); }
  }
})();

'use strict';

// ════════════════════════════════
// カテゴリ定義
// ════════════════════════════════
const CATS = [
  { id: 'food',        label: '食費',    icon: '🛒', color: '#4CAF50' },
  { id: 'eat_out',     label: '外食',    icon: '🍜', color: '#FF9800' },
  { id: 'daily',       label: '日用品',   icon: '🧴', color: '#9C27B0' },
  { id: 'carshare',   label: 'カーシェア', icon: '🚗', color: '#00ACC1' },
  { id: 'electricity', label: '電気代',   icon: '⚡', color: '#FFC107' },
  { id: 'gas',         label: 'ガス代',  icon: '🔥', color: '#FF5722' },
  { id: 'water',       label: '水道代',  icon: '💧', color: '#03A9F4' },
  { id: 'internet',    label: 'ネット代', icon: '📶', color: '#673AB7' },
  { id: 'rent',        label: '家賃',    icon: '🏠', color: '#009688' },
  { id: 'amazon',      label: 'Amazon',  icon: '📦', color: '#FF9900' },
  { id: 'rakuten',     label: '楽天',    icon: '🛍️', color: '#BF0000' },
  { id: 'other',       label: 'その他',  icon: '📂', color: '#607D8B' },
];
const CAT_MAP = Object.fromEntries(CATS.map(c => [c.id, c]));


// ════════════════════════════════
// 状態
// ════════════════════════════════
const state = {
  householdCode: localStorage.getItem('householdCode') || '',
  transactions: [],
  currentMonth: (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })(),
  selectedCat: 'food',
  selectedPayer: '卓哉',
  pollTimer: null,
  charts: { pie: null, savings: null },
  scriptUrl: '',
};

// ════════════════════════════════
// ユーティリティ
// ════════════════════════════════
const fmt = n => '¥' + Number(n).toLocaleString('ja-JP');

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${y}年${parseInt(m)}月`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateToYM(dateStr) { return dateStr.slice(0, 7); }

function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['日','月','火','水','木','金','土'];
  return `${d.getMonth()+1}/${d.getDate()}（${days[d.getDay()]}）`;
}

function monthTxs() {
  return state.transactions.filter(t => dateToYM(t.date) === state.currentMonth);
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ════════════════════════════════
// Google Apps Script API
// ════════════════════════════════
async function apiCall(params) {
  if (!state.scriptUrl) {
    // URLが未設定の場合はローカルモード
    return null;
  }
  const url = new URL(state.scriptUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  try {
    const res = await fetch(url.toString());
    return await res.json();
  } catch (err) {
    console.error('API error:', err);
    return null;
  }
}

async function fetchTransactions() {
  const data = await apiCall({ action: 'get', code: state.householdCode });
  if (Array.isArray(data)) {
    state.transactions = data;
    renderAll();
  }
}

async function addTransactionApi(tx) {
  await apiCall({
    action:    'add',
    code:      state.householdCode,
    id:        tx.id,
    date:      tx.date,
    amount:    tx.amount,
    category:  tx.category,
    payer:     tx.payer || '',
    memo:      tx.memo,
    createdAt: tx.createdAt,
  });
  await fetchTransactions(); // 追加後すぐ再取得
}

async function deleteTransactionApi(id) {
  await apiCall({ action: 'delete', code: state.householdCode, id });
  await fetchTransactions(); // 削除後すぐ再取得
}

// ローカルモード（URLなし）
function addTransactionLocal(tx) {
  state.transactions.unshift(tx);
  saveLocal();
  renderAll();
}
function deleteTransactionLocal(id) {
  state.transactions = state.transactions.filter(t => t.id !== id);
  saveLocal();
  renderAll();
}
function saveLocal() {
  localStorage.setItem('txs_' + state.householdCode, JSON.stringify(state.transactions));
}
function loadLocal() {
  const raw = localStorage.getItem('txs_' + state.householdCode);
  state.transactions = raw ? JSON.parse(raw) : [];
}

// ════════════════════════════════
// 同期（ポーリング）
// ════════════════════════════════
function startPolling(code) {
  stopPolling();
  if (!state.scriptUrl) {
    loadLocal();
    renderAll();
    return;
  }
  fetchTransactions().then(() => checkAndAddFixedCosts()); // 即時取得＋固定費チェック
  fetchSharedComments();
  state.pollTimer = setInterval(() => { fetchTransactions(); fetchSharedComments(); }, 10000);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

// ════════════════════════════════
// 共有コメント
// ════════════════════════════════
let sharedCommentTimer = null;

async function fetchSharedComments() {
  if (!state.scriptUrl || !state.householdCode) return;
  try {
    const url = new URL(state.scriptUrl);
    url.searchParams.set('action', 'getComments');
    url.searchParams.set('code', state.householdCode);
    const res  = await fetch(url.toString());
    const json = await res.json();
    if (!Array.isArray(json)) return;
    renderSharedTicker(json);
  } catch { /* 無視 */ }
}

function renderSharedTicker(comments) {
  const wrap    = document.getElementById('shared-ticker-wrap');
  const addWrap = document.getElementById('shared-add-btn-wrap');
  const el      = document.getElementById('shared-ticker-text');
  if (!wrap || !el) return;

  if (!comments.length) {
    wrap.classList.add('hidden');
    addWrap.classList.remove('hidden');
    return;
  }
  addWrap.classList.add('hidden');
  wrap.classList.remove('hidden');

  if (sharedCommentTimer) clearInterval(sharedCommentTimer);
  let idx = 0;
  function show() {
    el.style.animation = 'none';
    el.textContent = comments[idx % comments.length].text;
    void el.offsetWidth;
    el.style.animation = '';
    idx++;
  }
  show();
  sharedCommentTimer = setInterval(show, 12000);
}

function toggleExpiry(cb) {
  document.getElementById('sc-inp-date').disabled = cb.checked;
  if (cb.checked) document.getElementById('sc-inp-date').value = '';
}

function openSharedComments() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  document.getElementById('sc-inp-date').value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('sc-inp-date').disabled = false;
  document.getElementById('sc-inp-text').value = '';
  document.getElementById('sc-no-expiry').checked = false;
  renderScList();
  document.getElementById('shared-comments-modal').classList.remove('hidden');
}

function closeSharedComments() {
  document.getElementById('shared-comments-modal').classList.add('hidden');
  fetchSharedComments();
}

async function addSharedComment() {
  const text   = document.getElementById('sc-inp-text').value.trim();
  const expiry = document.getElementById('sc-inp-date').value;
  if (!text) { alert('コメントを入力してください'); return; }
  if (!state.scriptUrl) return;

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const url = new URL(state.scriptUrl);
  url.searchParams.set('action',    'addComment');
  url.searchParams.set('code',      state.householdCode);
  url.searchParams.set('id',        id);
  url.searchParams.set('text',      text);
  url.searchParams.set('expiry',    expiry);
  url.searchParams.set('createdAt', new Date().toISOString());
  await fetch(url.toString());
  document.getElementById('sc-inp-text').value = '';
  showToast('コメントを追加しました ✓');
  await new Promise(r => setTimeout(r, 800));
  await renderScList();
}

async function deleteSharedComment(id) {
  if (!confirm('このコメントを削除しますか？')) return;
  const url = new URL(state.scriptUrl);
  url.searchParams.set('action', 'deleteComment');
  url.searchParams.set('code',   state.householdCode);
  url.searchParams.set('id',     id);
  await fetch(url.toString());
  await new Promise(r => setTimeout(r, 800));
  await renderScList();
}

async function renderScList() {
  const el = document.getElementById('sc-list');
  el.innerHTML = '<div style="text-align:center;padding:8px;color:#999;font-size:13px">読み込み中...</div>';
  if (!state.scriptUrl) return;
  try {
    const url = new URL(state.scriptUrl);
    url.searchParams.set('action', 'getComments');
    url.searchParams.set('code',   state.householdCode);
    const res  = await fetch(url.toString());
    const json = await res.json();
    if (!Array.isArray(json) || !json.length) {
      el.innerHTML = '<div style="text-align:center;padding:16px;color:#999;font-size:13px">登録されているコメントはありません</div>';
      return;
    }
    el.innerHTML = json.map(c => `
      <div class="sc-item">
        <div class="sc-item-body">
          <div class="sc-item-text">${escHtml(c.text)}</div>
          <div class="sc-item-expiry">${c.expiry ? `期限：${c.expiry}` : '期限なし'}</div>
        </div>
        <button class="sc-item-del" onclick="deleteSharedComment('${c.id}')">×</button>
      </div>`).join('');
  } catch {
    el.innerHTML = '<div style="text-align:center;padding:8px;color:#999;font-size:13px">取得できませんでした</div>';
  }
}

// ════════════════════════════════
// セットアップ
// ════════════════════════════════
function enterHousehold(code) {
  state.householdCode = code;
  localStorage.setItem('householdCode', code);
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  startPolling(code);
  renderAll();
}

// ════════════════════════════════
// タブ・月ナビ
// ════════════════════════════════
function switchTab(name) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${name}"]`).classList.add('active');
  if (name === 'chart') renderCharts();
}

function changeMonth(delta) {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderAll();
}

// ════════════════════════════════
// 全体再描画
// ════════════════════════════════
function renderAll() {
  document.getElementById('header-month').textContent = monthLabel(state.currentMonth);
  renderHome();
  renderHistory();
  if (document.getElementById('tab-chart').classList.contains('active')) renderCharts();
}

// ════════════════════════════════
// 予算アラート
// ════════════════════════════════
const BUDGET = { categories: ['food', 'daily'], limit: 75000 };

function renderBudget(txs) {
  const used = txs
    .filter(t => BUDGET.categories.includes(t.category))
    .reduce((s, t) => s + t.amount, 0);
  const remaining = BUDGET.limit - used;
  const ratio     = Math.min(used / BUDGET.limit, 1);
  const pct       = Math.round(ratio * 100);
  const over      = used > BUDGET.limit;
  const barColor  = over ? '#F44336' : ratio >= 0.8 ? '#FF9800' : '#4CAF50';

  const savingsHtml = !over
    ? `<div class="budget-savings">
         <div class="budget-savings-label">👩 由美子 今月の貯金額</div>
         <div class="budget-savings-calc">差額 ${fmt(remaining)} ＋ ¥10,000</div>
         <div class="budget-savings-amount">${fmt(remaining + 10000)}</div>
         <div class="budget-savings-note">この金額を貯金してください 💰</div>
       </div>`
    : `<div class="budget-savings over">
         <div class="budget-savings-label">👩 由美子 今月の貯金額</div>
         <div class="budget-savings-amount">¥10,000</div>
         <div class="budget-savings-note">予算オーバーのため固定分のみ 💰</div>
       </div>`;

  document.getElementById('budget-card').innerHTML = `
    <div class="budget-header">
      <span class="budget-title">🛒 食費＋日用品 予算</span>
      <span class="budget-limit">${fmt(BUDGET.limit)}</span>
    </div>
    <div class="budget-bar-bg">
      <div class="budget-bar" style="width:${pct}%; background:${barColor}"></div>
    </div>
    <div class="budget-footer">
      <span class="budget-used">使用 ${fmt(used)}（${pct}%）</span>
      <span class="budget-remaining ${over ? 'over' : ''}">${over ? `⚠️ ${fmt(Math.abs(remaining))} オーバー` : `残り ${fmt(remaining)}`}</span>
    </div>
    ${savingsHtml}`;
}

// ════════════════════════════════
// 固定費自動入力
// ════════════════════════════════
const FIXED_COSTS = [
  { category: 'rent',     amount: 138700, payer: '卓哉', memo: '家賃（自動）',   day: 13 },
  { category: 'internet', amount: 4402,   payer: '卓哉', memo: 'ネット代（自動）', day: 1  },
];

async function checkAndAddFixedCosts() {
  const ym  = state.currentMonth;
  const key = `fixedAdded_${state.householdCode}_${ym}`;
  if (localStorage.getItem(key)) return; // 今月はすでに追加済み

  // 今月に固定費が1件でも存在するか確認
  const existing = state.transactions.filter(t =>
    t.date.startsWith(ym) && FIXED_COSTS.some(f => f.category === t.category && f.memo === t.memo)
  );
  if (existing.length > 0) {
    localStorage.setItem(key, '1');
    return;
  }

  const confirmed = confirm(`今月（${monthLabel(ym)}）の固定費を自動追加しますか？\n・家賃 ¥138,700\n・ネット代 ¥4,402`);
  if (!confirmed) return;

  for (const f of FIXED_COSTS) {
    const tx = {
      id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date:      `${ym}-${String(f.day).padStart(2, '0')}`,
      amount:    f.amount,
      category:  f.category,
      payer:     f.payer,
      memo:      f.memo,
      createdAt: new Date().toISOString(),
    };
    if (state.scriptUrl) await addTransactionApi(tx);
    else addTransactionLocal(tx);
    await new Promise(r => setTimeout(r, 200)); // 連続送信を少し待つ
  }
  localStorage.setItem(key, '1');
  showToast('固定費を追加しました ✓');
}

// ════════════════════════════════
// ホーム
// ════════════════════════════════
function renderHome() {
  const txs = monthTxs();
  const todayStr = today();
  document.getElementById('home-month-total').textContent =
    fmt(txs.reduce((s, t) => s + t.amount, 0));
  document.getElementById('home-today-total').textContent =
    fmt(txs.filter(t => t.date === todayStr).reduce((s, t) => s + t.amount, 0));
  document.getElementById('home-takuya-total').textContent =
    fmt(txs.filter(t => t.payer === '卓哉').reduce((s, t) => s + t.amount, 0));
  document.getElementById('home-yumiko-total').textContent =
    fmt(txs.filter(t => t.payer === '由美子').reduce((s, t) => s + t.amount, 0));

  renderBudget(txs);

  const list   = document.getElementById('home-tx-list');
  const recent = txs.slice(0, 5);
  list.innerHTML = recent.length === 0
    ? `<div class="empty"><div class="ei">📝</div><p>まだ記録がありません</p></div>`
    : recent.map(txHtml).join('');
}

// ════════════════════════════════
// 追加フォーム
// ════════════════════════════════
function renderCatGrid() {
  document.getElementById('cat-grid').innerHTML = CATS.map(c => `
    <button class="cat-btn ${c.id === state.selectedCat ? 'sel' : ''}"
            onclick="selectCat('${c.id}')">
      <span class="ci">${c.icon}</span>
      <span class="cl">${c.label}</span>
    </button>
  `).join('');
}

function selectCat(id) {
  state.selectedCat = id;
  renderCatGrid();
}


function selectPayer(name) {
  state.selectedPayer = name;
  document.getElementById('payer-takuya').classList.toggle('sel', name === '卓哉');
  document.getElementById('payer-yumiko').classList.toggle('sel', name === '由美子');
}

async function submitAdd() {
  const amount = parseInt(document.getElementById('inp-amount').value);
  const date   = document.getElementById('inp-date').value;
  const memo   = document.getElementById('inp-memo').value.trim();

  if (!amount || amount <= 0) { alert('金額を入力してください'); return; }
  if (!date)                  { alert('日付を選択してください'); return; }

  const tx = {
    id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date,
    amount,
    category:  state.selectedCat,

    payer:     state.selectedPayer,
    memo,
    createdAt: new Date().toISOString(),
  };

  document.getElementById('btn-add-submit').disabled = true;
  document.getElementById('loading-overlay').classList.remove('hidden');

  if (state.scriptUrl) {
    await addTransactionApi(tx);
  } else {
    addTransactionLocal(tx);
  }

  document.getElementById('loading-overlay').classList.add('hidden');
  document.getElementById('btn-add-submit').disabled = false;

  // リセット
  document.getElementById('inp-amount').value = '';
  document.getElementById('inp-memo').value   = '';
  document.getElementById('inp-date').value   = today();
  state.selectedCat   = 'food';

  state.selectedPayer = '卓哉';
  renderCatGrid();
  selectPayer('卓哉');

  showToast('追加しました ✓');
  switchTab('home');
}

// ════════════════════════════════
// 履歴
// ════════════════════════════════
function renderHistory() {
  const txs = monthTxs().sort((a, b) =>
    b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')
  );

  if (txs.length === 0) {
    document.getElementById('history-list').innerHTML =
      `<div class="empty"><div class="ei">📋</div><p>この月の記録はありません</p></div>`;
    return;
  }

  const groups = new Map();
  txs.forEach(t => {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  });

  let html = '';
  for (const [date, items] of groups) {
    const dayTotal = items.reduce((s, t) => s + t.amount, 0);
    html += `
      <div class="history-date-header">
        <span>${formatDisplayDate(date)}</span>
        <span class="history-date-total">${fmt(dayTotal)}</span>
      </div>
      <div class="history-group">
        ${items.map(txHtml).join('')}
      </div>`;
  }
  document.getElementById('history-list').innerHTML = html;
}

function txHtml(t) {
  const cat        = CAT_MAP[t.category] || CAT_MAP['other'];
  const payerClass = t.payer === '由美子' ? 'payer-tag yumiko' : 'payer-tag takuya';
  const payerLabel = t.payer || '';
  const shopLabel  = t.shop  || '';
  return `
    <div class="tx-item">
      <div class="tx-icon">${cat.icon}</div>
      <div class="tx-info">
        <div class="tx-cat-row">
          <span class="tx-cat">${cat.label}</span>
          ${shopLabel  ? `<span class="shop-tag">${escHtml(shopLabel)}</span>` : ''}
          ${payerLabel ? `<span class="${payerClass}">${payerLabel}</span>` : ''}
        </div>
        ${t.memo && !/^\d{4}-\d{2}-\d{2}T/.test(t.memo) ? `<div class="tx-memo">${escHtml(t.memo)}</div>` : ''}
        <div class="tx-date">${formatDisplayDate(t.date)}</div>
      </div>
      <div class="tx-right">
        <div class="tx-amount">${fmt(t.amount)}</div>
        <button class="tx-del" onclick="confirmDelete('${t.id}')">×</button>
      </div>
    </div>`;
}

async function confirmDelete(id) {
  if (!confirm('この記録を削除しますか？')) return;
  if (state.scriptUrl) {
    await deleteTransactionApi(id);
  } else {
    deleteTransactionLocal(id);
  }
}

// ════════════════════════════════
// グラフ
// ════════════════════════════════
function renderCalendar(txs) {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const daysInMonth  = new Date(y, m, 0).getDate();
  const firstDayOfWeek = new Date(y, m - 1, 1).getDay(); // 0=日

  // 日別合計マップ
  const dailyMap = {};
  txs.forEach(t => {
    const day = parseInt(t.date.slice(8));
    dailyMap[day] = (dailyMap[day] || 0) + t.amount;
  });

  // 最大金額（色の濃さ用）
  const maxAmount = Math.max(...Object.values(dailyMap), 1);
  const todayStr  = today();
  const todayDay  = todayStr.startsWith(state.currentMonth) ? parseInt(todayStr.slice(8)) : -1;

  const DAY_LABELS = ['日','月','火','水','木','金','土'];
  let html = '<div class="cal-week-header">' + DAY_LABELS.map(d => `<div>${d}</div>`).join('') + '</div>';
  html += '<div class="cal-body">';

  // 先頭の空白セル
  for (let i = 0; i < firstDayOfWeek; i++) {
    html += '<div class="cal-cell cal-empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const amount   = dailyMap[day] || 0;
    const ratio    = amount > 0 ? amount / maxAmount : 0;
    const alpha    = amount > 0 ? (0.15 + ratio * 0.75).toFixed(2) : 0;
    const isToday  = day === todayDay;
    const amtLabel = amount > 0 ? `¥${amount.toLocaleString()}` : '';
    html += `
      <div class="cal-cell ${isToday ? 'cal-today' : ''} ${amount > 0 ? 'cal-has-data' : ''}"
           style="background:rgba(76,175,80,${alpha})"
           ${amount > 0 ? `onclick="openDayDetail(${day})"` : ''}>
        <div class="cal-day">${day}</div>
        <div class="cal-amt">${amtLabel}</div>
      </div>`;
  }

  html += '</div>';
  document.getElementById('cal-grid').innerHTML = html;
}

function calcMonthlySavings() {
  // 当月は月途中のため除外し、過去月のみ集計
  const thisMonth = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
  const ymSet = new Set(
    state.transactions.map(t => dateToYM(t.date)).filter(ym => ym < thisMonth)
  );
  return [...ymSet].sort().map(ym => {
    const used = state.transactions
      .filter(t => dateToYM(t.date) === ym && BUDGET.categories.includes(t.category))
      .reduce((s, t) => s + t.amount, 0);
    const diff = BUDGET.limit - used;
    const savings = (diff > 0 ? diff : 0) + 10000;
    return { ym, used, savings };
  });
}

function renderSavingsHistory() {
  const months = calcMonthlySavings();
  const cumulative = months.reduce((s, m) => s + m.savings, 0);

  document.getElementById('savings-cumulative').textContent = fmt(cumulative);
  document.getElementById('savings-months-count').textContent = `${months.length}ヶ月分`;

  const labels  = months.map(m => monthLabel(m.ym).replace('年', '/').replace('月', ''));
  const amounts = months.map(m => m.savings);

  const ctx = document.getElementById('savings-chart').getContext('2d');
  if (state.charts.savings) state.charts.savings.destroy();
  if (months.length === 0) {
    document.getElementById('savings-chart-wrap').innerHTML = '<div class="empty"><div class="ei">💰</div><p>まだデータがありません</p></div>';
    return;
  }
  state.charts.savings = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: amounts,
        backgroundColor: '#A5D6A7',
        borderColor: '#4CAF50',
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => '¥' + (v / 10000) + '万',
            font: { size: 10 },
          },
          grid: { color: '#F0F0F0' },
        },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    }
  });

  document.getElementById('savings-list').innerHTML = [...months].reverse().map(m => `
    <div class="savings-row">
      <span class="savings-row-month">${monthLabel(m.ym)}</span>
      <span class="savings-row-detail">差額${fmt(Math.max(BUDGET.limit - m.used, 0))}＋¥10,000</span>
      <span class="savings-row-amount">${fmt(m.savings)}</span>
    </div>`).join('');
}

function renderCharts() {
  const txs = monthTxs();

  renderCalendar(txs);
  renderSavingsHistory();

  const catMap = {};
  txs.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
  const catEntries = CATS.map(c => ({ ...c, total: catMap[c.id] || 0 }))
    .filter(c => c.total > 0).sort((a, b) => b.total - a.total);
  const grand = catEntries.reduce((s, c) => s + c.total, 0);

  const pieCtx = document.getElementById('pie-chart').getContext('2d');
  if (state.charts.pie) state.charts.pie.destroy();
  if (catEntries.length > 0) {
    state.charts.pie = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: catEntries.map(c => c.label),
        datasets: [{ data: catEntries.map(c => c.total), backgroundColor: catEntries.map(c => c.color), borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '55%',
        plugins: { legend: { position: 'right', labels: { font: { size: 11 }, padding: 8, boxWidth: 12 } } }
      }
    });
  }

  document.getElementById('cat-breakdown').innerHTML = catEntries.map(c => `
    <div class="br-row br-row-tap" onclick="openCatDetail('${c.id}')">
      <div class="br-icon">${c.icon}</div>
      <div class="br-name">${c.label}</div>
      <div class="br-bar-bg"><div class="br-bar" style="width:${grand ? Math.round(c.total/grand*100) : 0}%; background:${c.color}"></div></div>
      <div class="br-amount">${fmt(c.total)}</div>
      <div class="br-chevron">›</div>
    </div>
  `).join('');

}

// ════════════════════════════════
// トースト・モーダル
// ════════════════════════════════
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2000);
}

// ════════════════════════════════
// 汎用内訳モーダル
// ════════════════════════════════
function openDetailModal(title, total, txs) {
  document.getElementById('payer-detail-title').textContent = title;
  document.getElementById('payer-detail-total').textContent = fmt(total);

  const catMap = {};
  txs.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
  const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  document.getElementById('payer-detail-cats').innerHTML = sortedCats.length <= 1 ? '' :
    `<div class="payer-detail-section-label">カテゴリ別</div>` +
    sortedCats.map(([catId, amt]) => {
      const cat = CAT_MAP[catId] || CAT_MAP['other'];
      const pct = total > 0 ? Math.round(amt / total * 100) : 0;
      return `
        <div class="br-row">
          <div class="br-icon">${cat.icon}</div>
          <div class="br-name">${cat.label}</div>
          <div class="br-bar-bg"><div class="br-bar" style="width:${pct}%;background:${cat.color}"></div></div>
          <div class="br-amount">${fmt(amt)}</div>
        </div>`;
    }).join('');

  document.getElementById('payer-detail-list').innerHTML = txs.length === 0
    ? `<div class="empty"><div class="ei">📝</div><p>記録がありません</p></div>`
    : `<div class="payer-detail-section-label">取引一覧</div>
       <div class="payer-detail-tx-group">${txs.map(txHtml).join('')}</div>`;

  document.getElementById('payer-detail-modal').classList.remove('hidden');
}

function openPayerDetail(payer) {
  const txs = monthTxs().filter(t => t.payer === payer);
  const total = txs.reduce((s, t) => s + t.amount, 0);
  const emoji = payer === '卓哉' ? '👨' : '👩';
  openDetailModal(`${emoji} ${payer}の内訳`, total, txs);
}

function openDayDetail(day) {
  const dateStr = `${state.currentMonth}-${String(day).padStart(2, '0')}`;
  const txs = monthTxs().filter(t => t.date === dateStr);
  const total = txs.reduce((s, t) => s + t.amount, 0);
  openDetailModal(formatDisplayDate(dateStr) + ' の内訳', total, txs);
}

function openCatDetail(catId) {
  const cat = CAT_MAP[catId] || CAT_MAP['other'];
  const txs = monthTxs().filter(t => t.category === catId);
  const total = txs.reduce((s, t) => s + t.amount, 0);
  openDetailModal(`${cat.icon} ${cat.label}の内訳`, total, txs);
}

function closePayerDetail() {
  document.getElementById('payer-detail-modal').classList.add('hidden');
}

function openShareModal() {
  document.getElementById('modal-code').textContent = state.householdCode;
  document.getElementById('share-modal').classList.remove('hidden');
}
function closeShareModal() {
  document.getElementById('share-modal').classList.add('hidden');
}

// ════════════════════════════════
// イベント登録
// ════════════════════════════════
function bindEvents() {
  document.getElementById('btn-create').addEventListener('click', () => enterHousehold(generateCode()));
  document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('inp-join-code').value.toUpperCase().trim();
    const err  = document.getElementById('join-err');
    if (code.length !== 6) { err.textContent = '6文字のコードを入力してください'; return; }
    err.textContent = '';
    enterHousehold(code);
  });
  document.getElementById('inp-join-code').addEventListener('input', () => {
    document.getElementById('join-err').textContent = '';
  });
  document.getElementById('btn-month-prev').addEventListener('click', () => changeMonth(-1));
  document.getElementById('btn-month-next').addEventListener('click', () => changeMonth(1));
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('btn-add-submit').addEventListener('click', submitAdd);
  document.getElementById('btn-share').addEventListener('click', openShareModal);
  document.getElementById('btn-close-modal').addEventListener('click', closeShareModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeShareModal);
  document.getElementById('btn-close-payer-detail').addEventListener('click', closePayerDetail);
  document.getElementById('payer-detail-backdrop').addEventListener('click', closePayerDetail);
  document.getElementById('btn-sc-add').addEventListener('click', addSharedComment);
  document.getElementById('btn-close-shared-comments').addEventListener('click', closeSharedComments);
  document.getElementById('shared-comments-backdrop').addEventListener('click', closeSharedComments);
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText(state.householdCode)
      .then(() => showToast('コードをコピーしました ✓'))
      .catch(() => showToast(state.householdCode));
  });
  document.getElementById('btn-clear-cache').addEventListener('click', async () => {
    if (!confirm('キャッシュをクリアしてアプリを最新版に更新しますか？')) return;
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) await reg.unregister();
    }
    const keys = await caches.keys();
    for (const key of keys) await caches.delete(key);
    window.location.reload(true);
  });
}

// ════════════════════════════════
// 天気
// ════════════════════════════════
const WMO_ICON = {
  0:'☀️', 1:'🌤️', 2:'⛅', 3:'☁️',
  45:'🌫️', 48:'🌫️',
  51:'🌦️', 53:'🌦️', 55:'🌧️',
  61:'🌧️', 63:'🌧️', 65:'🌧️',
  71:'🌨️', 73:'❄️', 75:'❄️',
  80:'🌦️', 81:'🌧️', 82:'⛈️',
  95:'⛈️', 96:'⛈️', 99:'⛈️',
};
const WMO_LABEL = {
  0:'快晴', 1:'晴れ', 2:'曇りがち', 3:'曇り',
  45:'霧', 48:'霧',
  51:'小雨', 53:'雨', 55:'強雨',
  61:'小雨', 63:'雨', 65:'大雨',
  71:'小雪', 73:'雪', 75:'大雪',
  80:'にわか雨', 81:'にわか雨', 82:'激しい雨',
  95:'雷雨', 96:'雷雨', 99:'激しい雷雨',
};

// 朝7時・昼12時・夜18時のインデックスを時刻リストから取得
function findHourIndex(times, targetHour) {
  const todayStr = today();
  const target   = `${todayStr}T${String(targetHour).padStart(2,'0')}:00`;
  const idx      = times.indexOf(target);
  // 見つからなければ近い時刻を探す
  if (idx !== -1) return idx;
  return times.findIndex(t => t.startsWith(todayStr + 'T' + String(targetHour).padStart(2,'0')));
}

function buildWeatherComment(times, codes, temps) {
  const todayStr = today();
  const rainCodes = new Set([51,53,55,61,63,65,80,81,82,95,96,99]);
  const snowCodes = new Set([71,73,75]);
  const todayIdxs = times.reduce((arr, t, i) => { if (t.startsWith(todayStr)) arr.push(i); return arr; }, []);

  for (const i of todayIdxs) {
    if (snowCodes.has(codes[i])) {
      const hour = parseInt(times[i].slice(11, 13));
      return `本日は${hour}時ごろに雪の予報があります ❄️`;
    }
    if (rainCodes.has(codes[i])) {
      const hour = parseInt(times[i].slice(11, 13));
      return `本日は${hour}時ごろに${WMO_LABEL[codes[i]]}の予報があります ☔`;
    }
  }
  if (todayIdxs.length > 0) {
    const maxTemp = Math.round(Math.max(...todayIdxs.map(i => temps[i])));
    const minTemp = Math.round(Math.min(...todayIdxs.map(i => temps[i])));
    const noonIdx = todayIdxs.find(i => times[i].includes('T12:')) ?? todayIdxs[0];
    const noonLabel = WMO_LABEL[codes[noonIdx]] || '晴れ';
    if (maxTemp >= 28) return `今日は最高${maxTemp}°の暑い一日です 🌞`;
    if (minTemp <= 5)  return `今日は最低${minTemp}°の寒い一日です 🥶`;
    return `今日は一日を通して${noonLabel}の見込みです 🌤️`;
  }
  return '今日も一日頑張りましょう！';
}

async function fetchWeather() {
  const card = document.getElementById('weather-card');
  if (!navigator.geolocation) {
    card.innerHTML = '<div class="weather-err">位置情報が使えません</div>';
    return;
  }

  const d = new Date();
  const DAYS = ['日','月','火','水','木','金','土'];
  const dateHeader = `${d.getMonth()+1}月${d.getDate()}日（${DAYS[d.getDay()]}）`;

  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&hourly=temperature_2m,weathercode&timezone=Asia%2FTokyo&forecast_days=1`;
      const res  = await fetch(url);
      const json = await res.json();
      const times = json.hourly.time;
      const temps = json.hourly.temperature_2m;
      const codes = json.hourly.weathercode;

      const slots = [
        { label: '朝', hour: 7  },
        { label: '昼', hour: 12 },
        { label: '夜', hour: 18 },
      ];

      const slotHtml = slots.map(s => {
        const i    = findHourIndex(times, s.hour);
        const temp = i !== -1 ? Math.round(temps[i]) : '--';
        const code = i !== -1 ? codes[i] : 0;
        const icon  = WMO_ICON[code]  || '🌡️';
        const label = WMO_LABEL[code] || '';
        return `
          <div class="weather-slot">
            <div class="ws-label">${s.label}</div>
            <div class="ws-icon">${icon}</div>
            <div class="ws-desc">${label}</div>
            <div class="ws-temp">${temp}°</div>
          </div>`;
      }).join('');

      const comment = buildWeatherComment(times, codes, temps);
      card.innerHTML = `
        <div class="weather-top">
          <span class="weather-date">${dateHeader}</span>
        </div>
        <div class="weather-slots">${slotHtml}</div>
        <div class="weather-comment" id="weather-ticker"><span id="weather-ticker-text">${comment}</span></div>`;
    } catch {
      card.innerHTML = '<div class="weather-err">天気を取得できませんでした</div>';
    }
  }, () => {
    card.innerHTML = '<div class="weather-err">位置情報を許可してください</div>';
  });
}

async function fetchNews() {
  const scriptUrl = (window.SCRIPT_URL && !window.SCRIPT_URL.includes('ここに')) ? window.SCRIPT_URL : '';
  if (!scriptUrl) return;

  try {
    const url = new URL(scriptUrl);
    url.searchParams.set('action', 'news');
    url.searchParams.set('code', 'news');
    const res  = await fetch(url.toString());
    const json = await res.json();
    if (!Array.isArray(json) || !json.length) return;

    const headlines = json.map(item => `📰 ${item.title}`).filter(t => t.length > 2);
    if (!headlines.length) return;

    const tickerText = document.getElementById('weather-ticker-text');
    if (!tickerText) return;

    const weatherComment = tickerText.textContent;
    const messages = [weatherComment, ...headlines];
    let idx = 1;

    setInterval(() => {
      const el = document.getElementById('weather-ticker-text');
      if (!el) return;
      el.style.animation = 'none';
      el.textContent = messages[idx % messages.length];
      void el.offsetWidth;
      el.style.animation = '';
      idx++;
    }, 14000);
  } catch {
    // 取得失敗→天気コメントのみ継続
  }
}

// ════════════════════════════════
// 初期化
// ════════════════════════════════
function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // Apps Script URL を設定から読み込み
  state.scriptUrl = (window.SCRIPT_URL && !window.SCRIPT_URL.includes('ここに')) ? window.SCRIPT_URL : '';

  bindEvents();
  document.getElementById('inp-date').value = today();
  renderCatGrid();
  fetchWeather();
  setTimeout(fetchNews, 3000); // 天気表示後3秒後にニュース取得

  if (state.householdCode) {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
    startPolling(state.householdCode);
  }
}

document.addEventListener('DOMContentLoaded', init);

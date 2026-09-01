// Supabase is loaded via CDN in index.html

// --- Supabase Configuration ---
const { createClient } = window.supabase
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// --- State Management ---
const INITIAL_BUDGET = 3200000;
const MEMBERS_PER_PAGE = 20;
// 실제 통장 잔액 맞춤 보정 (이자 등 명단·지출에 안 잡히는 차액). 2026-09-01 잔여 회비 12,170원 기준.
const BALANCE_ADJUST = { fee: 220, donation: 0 };

let state = {
  totalInitialBudget: INITIAL_BUDGET,
  transactions: [],
  members: [],
  transfers: [],   // 회비 ↔ 찬조금 이체 기록 (두 잔액에만 반영, 지출·명단엔 안 섞임)
  currentMemberPage: 1,
  memberFilter: 'all',
  editingId: null,
  viewMode: 'dashboard',
  selectedMonth: new Date().getMonth() + 1,
  settlementMonth: new Date().getMonth() + 1,
  isLoading: true,
  receipt: { txId: null, zoom: 100 }
};

// --- Supabase Logic ---

async function fetchData() {
  state.isLoading = true;
  render();

  try {
    // 영수증(base64)은 여기서 안 받는다 — 한 번에 받으면 수십 MB라 DB statement timeout(57014)으로 끊긴다.
    // 목록은 가볍게 먼저 띄우고, 영수증은 loadReceiptsInBackground()가 몇 건씩 나눠 받는다.
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('id, reason, amount, source, date')
      .order('date', { ascending: true });

    const { data: members, error: mError } = await supabase
      .from('members')
      .select('*')
      .order('date', { ascending: true });

    const { data: transfers, error: tfError } = await supabase
      .from('transfers')
      .select('*')
      .order('date', { ascending: true });

    if (txError) throw txError;
    if (mError) throw mError;
    if (tfError) throw tfError;

    // receipts === undefined 는 「아직 안 받음」, []/null 은 「영수증 없음」
    state.transactions = (transactions || []).map(t => ({ ...t, receipts: undefined }));
    state.members = members || [];
    state.transfers = transfers || [];
  } catch (err) {
    console.error('Error fetching data:', JSON.stringify({ message: err.message, code: err.code, details: err.details, hint: err.hint }));
    showToast(`데이터를 불러오는데 실패했습니다. (${err.message || err})`, 'danger');
  } finally {
    state.isLoading = false;
    render();
    loadReceiptsInBackground();
  }
}

const RECEIPT_BATCH = 3;

// 최신 달부터 3건씩 영수증을 받아서 목록의 배지만 제자리 갱신한다 (전체 render()는 안 부른다 — 열려 있는 모달이 닫힌다).
async function loadReceiptsInBackground() {
  const pending = state.transactions
    .filter(t => t.receipts === undefined)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(t => String(t.id));

  for (let i = 0; i < pending.length; i += RECEIPT_BATCH) {
    const ids = pending.slice(i, i + RECEIPT_BATCH);
    try {
      const { data, error } = await supabase.from('transactions').select('id, receipts').in('id', ids);
      if (error) throw error;
      (data || []).forEach(row => {
        const tx = state.transactions.find(t => String(t.id) === String(row.id));
        if (tx) tx.receipts = row.receipts || [];
      });
    } catch (err) {
      console.error('Error loading receipts batch:', ids, err.message);
    }
    ids.forEach(id => updateReceiptSlot(id));
  }
}

// 특정 거래의 영수증이 필요한 순간(뷰어·수정)에 아직 안 받았으면 그 건만 받아온다.
async function ensureReceipts(id) {
  const tx = state.transactions.find(t => String(t.id) === String(id));
  if (!tx) return null;
  if (tx.receipts !== undefined) return tx;
  const { data, error } = await supabase.from('transactions').select('id, receipts').eq('id', tx.id).single();
  if (error) {
    showToast(`영수증을 불러오지 못했습니다. (${error.message})`, 'danger');
    return null;
  }
  tx.receipts = data?.receipts || [];
  updateReceiptSlot(tx.id);
  return tx;
}

function receiptSlotHtml(t) {
  if (t.receipts === undefined) {
    return `<span class="receipt-badge receipt-loading">영수증 확인 중…</span>`;
  }
  if (!t.receipts || t.receipts.length === 0) return '';
  return `
    <div class="receipt-badge" onclick="window.showReceipts('${t.id}')">
      <span>영수증 <b>${t.receipts.length}장</b></span>
    </div>
  `;
}

function updateReceiptSlot(id) {
  const tx = state.transactions.find(t => String(t.id) === String(id));
  const slot = document.querySelector(`.receipt-slot[data-tx="${String(id)}"]`);
  if (tx && slot) slot.innerHTML = receiptSlotHtml(tx);
}

async function syncTransaction(tx) {
  try {
    const { error } = await supabase.from('transactions').upsert(tx);
    if (error) throw error;
  } catch (err) {
    console.error('Error syncing transaction:', err);
    showToast('저장에 실패했습니다.', 'danger');
  }
}

async function removeTransaction(id) {
  try {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.error('Error deleting transaction:', err);
    showToast('삭제에 실패했습니다.', 'danger');
  }
}

async function syncMember(member) {
  try {
    const { error } = await supabase.from('members').upsert(member);
    if (error) throw error;
  } catch (err) {
    console.error('Error syncing member:', err);
    showToast('저장에 실패했습니다.', 'danger');
  }
}

async function removeMember(id) {
  try {
    const { error } = await supabase.from('members').delete().eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.error('Error deleting member:', err);
    showToast('삭제에 실패했습니다.', 'danger');
  }
}

async function syncTransfer(tf) {
  try {
    const { error } = await supabase.from('transfers').upsert(tf);
    if (error) throw error;
  } catch (err) {
    console.error('Error syncing transfer:', err);
    showToast('이체 기록 저장에 실패했습니다.', 'danger');
  }
}

async function removeTransfer(id) {
  try {
    const { error } = await supabase.from('transfers').delete().eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.error('Error deleting transfer:', err);
    showToast('이체 기록 삭제에 실패했습니다.', 'danger');
  }
}

// 이체 순증감: 들어온 것 − 나간 것. beforeDate 를 주면 그 날짜 전(월간 결산 누계)만.
function transferNet(pool, beforeDate) {
  return state.transfers
    .filter(t => !beforeDate || t.date < beforeDate)
    .reduce((s, t) => s + (t.to_pool === pool ? t.amount : 0) - (t.from_pool === pool ? t.amount : 0), 0);
}

// 목록·보고서·ZIP이 같은 순서를 쓰도록: 날짜 → 등록 순(id = 등록 시각)
const byDateThenId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id).localeCompare(String(b.id)));

function calculateCurrentStats() {
  const feeTotal = state.members.filter(m => m.type === 'fee').reduce((acc, curr) => acc + curr.amount, 0);
  const donationTotal = state.members.filter(m => m.type === 'donation').reduce((acc, curr) => acc + curr.amount, 0);

  const feeExpenses = state.transactions.filter(t => t.source === 'fee').reduce((acc, curr) => acc + curr.amount, 0);
  const donationExpenses = state.transactions.filter(t => t.source === 'donation').reduce((acc, curr) => acc + curr.amount, 0);
  const generalExpenses = state.transactions.filter(t => t.source === 'budget').reduce((acc, curr) => acc + curr.amount, 0);
  const supportTxs = state.transactions.filter(t => t.source === 'support');

  return {
    currentBudget: INITIAL_BUDGET - generalExpenses,
    currentFee: feeTotal - feeExpenses + BALANCE_ADJUST.fee + transferNet('fee'),
    currentDonation: donationTotal - donationExpenses + BALANCE_ADJUST.donation + transferNet('donation'),
    totalSpent: state.transactions.filter(t => t.source !== 'support').reduce((acc, curr) => acc + curr.amount, 0),
    supportTotal: supportTxs.reduce((acc, curr) => acc + curr.amount, 0),
    supportCount: supportTxs.length
  };
}

// --- Components ---

function Header() {
  return `
    <header class="glass-header">
      <div class="header-inner">
        <div class="brand" onclick="location.reload()"><span class="brand-dot"></span>BalanceFlow 2026</div>
        <div class="header-actions">
          <button class="btn btn-primary" onclick="window.showAddModal()">
            <span>+ 지출 추가</span>
          </button>
        </div>
      </div>
    </header>
  `;
}

function Dashboard() {
  const stats = calculateCurrentStats();
  const budgetProgress = Math.max(0, (stats.currentBudget / INITIAL_BUDGET) * 100);

  return `
    <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));">
      <div class="glass stat-card">
        <span class="stat-label">2026 총 예산 잔액</span>
        <div class="stat-value">₩ ${stats.currentBudget.toLocaleString()}</div>
        <div class="progress-container">
          <div class="progress-bar" style="width: ${budgetProgress}%"></div>
        </div>
        <span class="stat-sub" style="margin-top: 8px; display: block;">기본 예산 3,200,000원 기준</span>
      </div>
      
      <div class="glass stat-card">
        <span class="stat-label">잔여 회비</span>
        <div class="stat-value">₩ ${stats.currentFee.toLocaleString()}</div>
        <div class="stat-sub">회비 풀 (Pool) 합계</div>
      </div>

      <div class="glass stat-card">
        <span class="stat-label">잔여 찬조금</span>
        <div class="stat-value">₩ ${stats.currentDonation.toLocaleString()}</div>
        <div class="stat-sub">찬조금 풀 (Pool) 합계</div>
      </div>

      <div class="glass stat-card">
        <span class="stat-label">예산 지원 (증빙용)</span>
        <div class="stat-value">₩ ${stats.supportTotal.toLocaleString()}</div>
        <div class="stat-sub">총 ${stats.supportCount}건 (잔액 관계없음)</div>
      </div>
    </div>

  `;
}

function TransactionList() {
  const YEAR = 2026;
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const byMonth = months.map(m => state.transactions
    .filter(t => t.date.startsWith(`${YEAR}-${String(m).padStart(2, '0')}`))
    .sort(byDateThenId));

  // 예산지원(support)은 잔액과 무관한 증빙이라 스트립 금액에서 뺀다 (본격 분석과 같은 기준)
  const spentOf = txs => txs.filter(t => t.source !== 'support').reduce((s, t) => s + t.amount, 0);
  const monthSpent = byMonth.map(spentOf);
  const maxSpent = Math.max(...monthSpent, 1);
  const yearTotal = monthSpent.reduce((a, b) => a + b, 0);

  if (state.transactions.length === 0 && !state.isLoading) {
    return `<div class="tx-empty">지출 내역이 없습니다.</div>`;
  }

  const sel = state.selectedMonth;
  const txs = byMonth[sel - 1];
  const selSpent = monthSpent[sel - 1];
  const mix = {
    budget: txs.filter(t => t.source === 'budget').reduce((s, t) => s + t.amount, 0),
    fee: txs.filter(t => t.source === 'fee').reduce((s, t) => s + t.amount, 0),
    donation: txs.filter(t => t.source === 'donation').reduce((s, t) => s + t.amount, 0),
  };
  const pct = v => selSpent ? (v / selSpent * 100).toFixed(1) : 0;
  const sourceLabel = { budget: '기본예산', fee: '회비', donation: '찬조금', support: '예산지원' };
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

  return `
    <div class="section-head">
      <h3>2026년 월별 지출</h3>
      <span class="meta">총 ${state.transactions.length}건 · 연간 ₩ ${yearTotal.toLocaleString()}</span>
    </div>

    <div class="month-strip">
      ${months.map(m => {
        const n = byMonth[m - 1].length;
        const amt = monthSpent[m - 1];
        return `
          <div class="month-cell ${m === sel ? 'active' : ''} ${n === 0 ? 'empty' : ''}" onclick="window.selectMonth(${m})" title="${m}월 · ${n}건 · ₩ ${amt.toLocaleString()}">
            <span class="m-name">${m}월</span>
            <span class="m-amount">${n ? `₩ ${amt.toLocaleString()}` : '–'}</span>
            <span class="m-count">${n ? `${n}건` : '&nbsp;'}</span>
          </div>
        `;
      }).join('')}
    </div>

    <div class="tx-panel fade-in" key="${sel}">
      <div class="tx-panel-head">
        <h3>${sel}월 지출 <span class="meta" style="margin-left: 6px;">${txs.length}건</span></h3>
        <span class="panel-tools">
          <span class="meta amount-with-copy">
            <button class="copy-btn" onclick="window.copyAmount(${selSpent})" title="합계 복사">⧉</button>
            ₩ ${selSpent.toLocaleString()}
          </span>
          <button class="btn btn-ghost btn-sm" onclick="window.copySettlementReport(${sel})">보고서 복사</button>
          <button class="btn btn-ghost btn-sm" onclick="window.downloadMonthZip(${sel})">영수증 ZIP</button>
        </span>
      </div>
      ${selSpent > 0 ? `
        <div class="source-mix">
          <i style="width: ${pct(mix.budget)}%; background: var(--mix-1)"></i>
          <i style="width: ${pct(mix.fee)}%; background: var(--mix-2)"></i>
          <i style="width: ${pct(mix.donation)}%; background: var(--mix-3)"></i>
        </div>
        <div class="source-legend">
          <span><i style="background: var(--mix-1)"></i>예산 ${mix.budget.toLocaleString()}</span>
          <span><i style="background: var(--mix-2)"></i>회비 ${mix.fee.toLocaleString()}</span>
          <span><i style="background: var(--mix-3)"></i>찬조 ${mix.donation.toLocaleString()}</span>
        </div>
      ` : ''}

      ${txs.length === 0 ? `<div class="tx-empty">${sel}월 지출 내역이 없습니다.</div>` : `
        <div class="tx-head">
          <span>날짜</span><span>내역</span><span>출처</span><span>영수증</span><span style="text-align: right;">금액</span><span></span>
        </div>
        ${txs.map(t => {
          const [y, mo, d] = t.date.split('-').map(Number);
          const wd = weekdays[new Date(y, mo - 1, d).getDay()];
          return `
            <div class="tx-row">
              <span class="tx-date"><b>${mo}/${d}</b> ${wd}</span>
              <span class="tx-reason" title="${t.reason}">${t.reason}</span>
              <span class="tx-meta"><span class="badge badge-${t.source}">${sourceLabel[t.source] || t.source}</span></span>
              <span class="receipt-slot" data-tx="${t.id}">${receiptSlotHtml(t)}</span>
              <span class="tx-amount ${t.source === 'support' ? 'support' : ''}">
                <button class="copy-btn" onclick="window.copyAmount(${t.amount})" title="금액 복사">⧉</button>
                ${t.source === 'support' ? '' : '−'} ₩ ${t.amount.toLocaleString()}
              </span>
              <span class="tx-actions">
                <button class="icon-btn edit" onclick="window.editTransaction('${t.id}')" title="수정">✎</button>
                <button class="icon-btn delete" onclick="window.deleteTransaction('${t.id}', event)" title="삭제">✕</button>
              </span>
            </div>
          `;
        }).join('')}
      `}
    </div>
  `;
}

function AnalysisView() {
  const now = new Date();
  const currentYear = now.getFullYear();

  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const monthStr = `${currentYear}-${String(month).padStart(2, '0')}`;
    const spent = state.transactions
      .filter(t => t.date.startsWith(monthStr) && t.source !== 'support')
      .reduce((sum, t) => sum + t.amount, 0);
    return { month: `${month}월`, amount: spent };
  });

  const maxSpent = Math.max(...monthlyData.map(d => d.amount), 1);
  const totalYearly = monthlyData.reduce((sum, d) => sum + d.amount, 0);

  const currentMonthStr = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthTxs = state.transactions.filter(t => t.date.startsWith(currentMonthStr) && t.source !== 'support');

  const categorySummary = {
    budget: currentMonthTxs.filter(t => t.source === 'budget').reduce((s, t) => s + t.amount, 0),
    fee: currentMonthTxs.filter(t => t.source === 'fee').reduce((s, t) => s + t.amount, 0),
    donation: currentMonthTxs.filter(t => t.source === 'donation').reduce((s, t) => s + t.amount, 0),
  };

  return `
    <div class="analysis-view fade-in">
      <div class="analysis-grid">
        <div class="glass stat-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
            <h3>${currentYear}년 월별 지출 현황</h3>
            <span style="font-size: 0.85rem; color: var(--text-muted);">연간 총액: ₩ ${totalYearly.toLocaleString()}</span>
          </div>
          <div style="height: 300px; position: relative;">
            <canvas id="monthlyChart"></canvas>
          </div>
        </div>

        <div class="glass stat-card">
          <h3 style="margin-bottom: 1.5rem;">${now.getMonth() + 1}월 카테고리 분석</h3>
          
          <div style="height: 250px; position: relative; margin-bottom: 1rem;">
            <canvas id="categoryChart"></canvas>
          </div>

          <div class="sub-card" style="margin-top: 24px; font-size: 0.8125rem; line-height: 1.5;">
            <p style="color: var(--text-muted);">이번 달 지출 데이터를 기반으로 예산 효율성을 분석했습니다.<br>※ '예산 지원(증빙 전용)' 항목은 분석 결과에 포함되지 않습니다.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function SettlementView() {
  const currentYear = 2026;
  const now = new Date();
  const currentMonth = now.getFullYear() === currentYear ? now.getMonth() + 1 : 12;

  // Calculate stats for all 12 months
  const monthlyReports = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    if (m > currentMonth) return null; // Don't show future months yet

    const monthStr = `${currentYear}-${String(m).padStart(2, '0')}`;
    const monthlyTxs = state.transactions.filter(t => t.date.startsWith(monthStr));
    const monthlyMembers = state.members.filter(mem => mem.date.startsWith(monthStr));

    const incomeFee = monthlyMembers.filter(mem => mem.type === 'fee').reduce((s, mem) => s + mem.amount, 0);
    const incomeDonation = monthlyMembers.filter(mem => mem.type === 'donation').reduce((s, mem) => s + mem.amount, 0);

    const expenseBudget = monthlyTxs.filter(t => t.source === 'budget').reduce((s, t) => s + t.amount, 0);
    const expenseFee = monthlyTxs.filter(t => t.source === 'fee').reduce((s, t) => s + t.amount, 0);
    const expenseDonation = monthlyTxs.filter(t => t.source === 'donation').reduce((s, t) => s + t.amount, 0);

    const totalIncome = incomeFee + incomeDonation;
    const totalExpense = expenseBudget + expenseFee + expenseDonation;
    const netBalance = totalIncome - totalExpense;

    if (totalIncome === 0 && totalExpense === 0) return null; // Skip months with no data

    return {
      month: m,
      incomeFee, incomeDonation, totalIncome,
      expenseBudget, expenseFee, expenseDonation, totalExpense,
      netBalance
    };
  }).filter(r => r !== null).reverse(); // Newest first

  return `
    <div class="settlement-view fade-in">
      <div class="glass stat-card" style="margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0;">2026년 월간 결산</h2>
        <span style="font-size: 0.9rem; color: var(--text-muted);">총 ${monthlyReports.length}개월 분석됨</span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        ${monthlyReports.map(report => `
          <div class="glass settlement-card ${report.netBalance >= 0 ? 'positive' : 'negative'}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem;">${report.month}월 결산 내역</h3>
              <span style="display: flex; gap: 6px;">
                <button class="btn btn-ghost btn-sm" onclick="window.copySettlementReport(${report.month})">보고서 복사</button>
                <button class="btn btn-ghost btn-sm" onclick="window.downloadMonthZip(${report.month})">영수증 ZIP</button>
              </span>
            </div>

            <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
              <div class="sub-card">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 0.5rem;">이달의 지출</span>
                <span style="font-size: 1.1rem; font-weight: 600;">₩ ${report.totalExpense.toLocaleString()}</span>
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem; display: flex; flex-direction: column;">
                  <span>- 예산: ${report.expenseBudget.toLocaleString()}</span>
                  <span>- 회비: ${report.expenseFee.toLocaleString()}</span>
                  <span>- 찬조: ${report.expenseDonation.toLocaleString()}</span>
                </div>
              </div>

              <div class="sub-card">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 0.5rem;">이달의 수입</span>
                <span style="font-size: 1.1rem; font-weight: 600;">₩ ${report.totalIncome.toLocaleString()}</span>
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem; display: flex; flex-direction: column;">
                  <span>- 회비: ${report.incomeFee.toLocaleString()}</span>
                  <span>- 찬조: ${report.incomeDonation.toLocaleString()}</span>
                </div>
              </div>

              <div class="sub-card">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 0.5rem;">월간 순수지</span>
                <span style="font-size: 1.1rem; font-weight: 600; color: ${report.netBalance >= 0 ? 'var(--ink)' : 'var(--error)'};">
                  ${report.netBalance >= 0 ? '+' : ''} ₩ ${report.netBalance.toLocaleString()}
                </span>
                <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">실질적인 자금 변동</p>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// --- Modals ---

function AddTransactionModal() {
  const isEdit = state.editingId !== null;
  const tx = isEdit ? state.transactions.find(t => String(t.id) === String(state.editingId)) : null;

  return `
    <div id="addModal" class="modal-overlay">
      <div class="glass modal-content">
        <h2 style="margin-bottom: 2rem;">${isEdit ? '지출 내역 수정' : '새로운 지출 기록'}</h2>
        <form id="addForm">
          <div class="form-group">
            <label class="form-label">지출 사유</label>
            <input type="text" id="reason" class="form-input" value="${tx ? tx.reason : ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label">금액</label>
            <div class="amount-field"><input type="text" id="amount" class="form-input" value="${tx ? tx.amount.toLocaleString() : ''}" placeholder="0" required inputmode="numeric" oninput="window.formatAmount(this)"></div>
          </div>
          <div class="form-group">
            <label class="form-label">자금 출처</label>
            <select id="source" class="form-input">
              <option value="budget" ${tx?.source === 'budget' ? 'selected' : ''}>기본 예산</option>
              <option value="fee" ${tx?.source === 'fee' ? 'selected' : ''}>회비</option>
              <option value="donation" ${tx?.source === 'donation' ? 'selected' : ''}>찬조금</option>
              <option value="support" ${tx?.source === 'support' ? 'selected' : ''}>예산 지원 (잔액 무관)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">날짜</label>
            <input type="date" id="date" class="form-input" value="${tx ? tx.date : new Date().toISOString().split('T')[0]}" required>
          </div>
          <div class="form-group">
            <label class="form-label">영수증 업로드 (최대 5장)</label>
            <input type="file" id="receipts" class="form-input" multiple accept="image/*">
            <div id="fileNames" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">
              ${tx?.receipts === undefined && tx ? '기존 영수증 확인 중…' : tx?.receipts?.length ? `${tx.receipts.length}개의 기존 영수증 유지됨 (새로 올리면 교체)` : '파일을 선택하세요'}
            </div>
          </div>
          <div style="display: flex; gap: 1rem; margin-top: 2rem;">
            <button type="button" class="btn btn-ghost" style="flex: 1;" onclick="window.hideModal('addModal')">취소</button>
            <button type="submit" class="btn btn-primary" style="flex: 2;">${isEdit ? '수정 완료' : '저장하기'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function MembersView() {
  const filter = state.memberFilter;
  const all = [...state.members].sort((a, b) => new Date(b.date) - new Date(a.date));
  const filtered = filter === 'all' ? all : all.filter(m => m.type === filter);

  const totalPages = Math.ceil(filtered.length / MEMBERS_PER_PAGE) || 1;
  const page = Math.min(state.currentMemberPage, totalPages);
  const start = (page - 1) * MEMBERS_PER_PAGE;
  const paginated = filtered.slice(start, start + MEMBERS_PER_PAGE);

  // 입금 / 지출 / 잔액 (대시보드 잔여 회비·찬조금과 같은 계산식)
  const pool = (type) => {
    const income = state.members.filter(m => m.type === type).reduce((s, m) => s + m.amount, 0);
    const spent = state.transactions.filter(t => t.source === type).reduce((s, t) => s + t.amount, 0);
    const moved = transferNet(type);
    return { income, spent, moved, left: income - spent + BALANCE_ADJUST[type] + moved };
  };
  const fee = pool('fee');
  const donation = pool('donation');

  const poolCard = (title, p, color) => `
    <div class="glass stat-card">
      <span class="stat-label">${title}</span>
      <div class="stat-value" style="margin-bottom: 0.75rem;">₩ ${p.left.toLocaleString()}</div>
      <div class="pool-breakdown">
        <span>입금 <b>${p.income.toLocaleString()}원</b></span>
        <span>지출 <b style="color: var(--danger)">${p.spent.toLocaleString()}원</b></span>
        ${p.moved ? `<span>이체 <b>${p.moved > 0 ? '+' : '−'}${Math.abs(p.moved).toLocaleString()}원</b></span>` : ''}
      </div>
    </div>
  `;

  const today = new Date().toISOString().split('T')[0];

  return `
    <div class="members-view fade-in">
      <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));">
        ${poolCard('잔여 회비', fee, 'var(--success)')}
        ${poolCard('잔여 찬조금', donation, 'var(--warning)')}
        <div class="glass stat-card">
          <span class="stat-label">등록된 명단</span>
          <div class="stat-value" style="margin-bottom: 0.75rem;">${state.members.length}건</div>
          <div class="pool-breakdown">
            <span>회비 <b>${state.members.filter(m => m.type === 'fee').length}건</b></span>
            <span>찬조 <b>${state.members.filter(m => m.type === 'donation').length}건</b></span>
          </div>
        </div>
      </div>

      <div class="glass stat-card" style="margin-bottom: 2rem;">
        <h3 style="margin-bottom: 1.25rem;">회비 · 찬조금 등록</h3>
        <form id="memberForm" class="member-form">
          <div>
            <label class="form-label">이름 / 내역</label>
            <input type="text" id="mName" class="form-input" placeholder="예: 김동우 (8월 회비)" required>
          </div>
          <div>
            <label class="form-label">금액</label>
            <div class="amount-field"><input type="text" id="mAmount" class="form-input" placeholder="0" required inputmode="numeric" oninput="window.formatAmount(this)"></div>
          </div>
          <div>
            <label class="form-label">구분</label>
            <select id="mType" class="form-input">
              <option value="fee">회비</option>
              <option value="donation">찬조금</option>
            </select>
          </div>
          <div>
            <label class="form-label">입금일</label>
            <input type="date" id="mDate" class="form-input" value="${today}" required>
          </div>
          <button type="submit" class="btn btn-primary">추가하기</button>
        </form>
        <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.75rem;">
          ※ 입금일이 속한 달의 결산에 수입으로 잡힙니다. 지난달 건을 넣을 땐 날짜를 꼭 바꿔주세요.
        </p>
      </div>

      <div class="glass stat-card" style="margin-bottom: 2rem;">
        <h3 style="margin-bottom: 0.35rem;">회비 ↔ 찬조금 이체</h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.25rem;">
          한쪽 잔액을 다른 쪽으로 옮깁니다. 지출·명단에는 안 잡히고 두 잔액에만 반영됩니다.
        </p>
        <form id="transferForm" class="member-form transfer-form">
          <div>
            <label class="form-label">방향</label>
            <select id="tfDirection" class="form-input">
              <option value="fee>donation">회비 → 찬조금</option>
              <option value="donation>fee">찬조금 → 회비</option>
            </select>
          </div>
          <div>
            <label class="form-label">금액</label>
            <div class="amount-field"><input type="text" id="tfAmount" class="form-input" placeholder="0" required inputmode="numeric" oninput="window.formatAmount(this)"></div>
          </div>
          <div>
            <label class="form-label">날짜</label>
            <input type="date" id="tfDate" class="form-input" value="${today}" required>
          </div>
          <div>
            <label class="form-label">메모 (선택)</label>
            <input type="text" id="tfMemo" class="form-input" placeholder="예: 찬조금 부족분 보충">
          </div>
          <button type="submit" class="btn btn-primary">이체하기</button>
        </form>

        ${state.transfers.length ? `
          <table class="data-table" style="margin-top: 1.25rem;">
            <thead>
              <tr>
                <th style="width: 120px;">날짜</th>
                <th style="width: 160px;">방향</th>
                <th>메모</th>
                <th style="text-align: right; width: 140px;">금액</th>
                <th style="width: 60px;"></th>
              </tr>
            </thead>
            <tbody>
              ${[...state.transfers].sort(byDateThenId).reverse().map(t => `
                <tr>
                  <td style="color: var(--text-muted); font-size: 0.85rem;">${t.date}</td>
                  <td><span class="badge badge-${t.from_pool}">${t.from_pool === 'fee' ? '회비' : '찬조금'}</span> → <span class="badge badge-${t.to_pool}">${t.to_pool === 'fee' ? '회비' : '찬조금'}</span></td>
                  <td style="color: var(--text-muted);">${t.memo || ''}</td>
                  <td style="text-align: right; font-weight: 600;">₩ ${t.amount.toLocaleString()}</td>
                  <td style="text-align: right;">
                    <button class="icon-btn delete" onclick="window.deleteTransfer('${t.id}', event)" title="삭제">✕</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}
      </div>

      <div class="glass stat-card">
        <div class="members-toolbar">
          <h3 style="margin: 0;">전체 명단</h3>
          <div class="filter-group">
            ${[['all', '전체'], ['fee', '회비'], ['donation', '찬조금']].map(([k, label]) => `
              <button class="filter-chip ${filter === k ? 'active' : ''}" onclick="window.setMemberFilter('${k}')">${label}</button>
            `).join('')}
          </div>
        </div>

        ${filtered.length === 0 ? `
          <div class="empty-month-msg">등록된 명단이 없습니다.</div>
        ` : `
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 120px;">입금일</th>
                <th>이름 / 내역</th>
                <th style="width: 100px;">구분</th>
                <th style="text-align: right; width: 140px;">금액</th>
                <th style="width: 60px;"></th>
              </tr>
            </thead>
            <tbody>
              ${paginated.map(m => `
                <tr>
                  <td style="color: var(--text-muted); font-size: 0.85rem;">${m.date}</td>
                  <td style="font-weight: 500;">${m.name}</td>
                  <td><span class="badge badge-${m.type}">${m.type === 'fee' ? '회비' : '찬조금'}</span></td>
                  <td style="text-align: right; font-weight: 600;">₩ ${m.amount.toLocaleString()}</td>
                  <td style="text-align: right;">
                    <button class="icon-btn delete" onclick="window.deleteMember('${m.id}', event)" title="삭제">✕</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="color: var(--text-muted); font-size: 0.85rem;">
                  ${filter === 'all' ? '전체' : filter === 'fee' ? '회비' : '찬조금'} 합계 (${filtered.length}건)
                </td>
                <td style="text-align: right; font-weight: 700; color: var(--success);">
                  ₩ ${filtered.reduce((s, m) => s + m.amount, 0).toLocaleString()}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          ${totalPages > 1 ? `
            <div class="pagination">
              <button class="page-btn" ${page === 1 ? 'disabled' : ''} onclick="window.changeMemberPage(${page - 1})">이전</button>
              <span class="page-info">${page} / ${totalPages}</span>
              <button class="page-btn" ${page === totalPages ? 'disabled' : ''} onclick="window.changeMemberPage(${page + 1})">다음</button>
            </div>
          ` : ''}
        `}
      </div>
    </div>
  `;
}

// --- App Render ---

function render() {
  const app = document.querySelector('#app');
  if (state.isLoading) {
    app.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; gap: 1rem;">
        <div class="loader"></div>
        <p style="color: var(--text-muted);">Supabase에서 데이터를 불러오는 중...</p>
      </div>
    `;
    return;
  }

  app.innerHTML = `
    ${Header()}
    <main class="fade-in">
      <div class="nav-tabs">
        <div class="nav-tab ${state.viewMode === 'dashboard' ? 'active' : ''}" onclick="window.setViewMode('dashboard')">대시보드</div>
        <div class="nav-tab ${state.viewMode === 'members' ? 'active' : ''}" onclick="window.setViewMode('members')">회비 · 찬조 명단</div>
        <div class="nav-tab ${state.viewMode === 'analysis' ? 'active' : ''}" onclick="window.setViewMode('analysis')">본격 분석</div>
        <div class="nav-tab ${state.viewMode === 'settlement' ? 'active' : ''}" onclick="window.setViewMode('settlement')">월간 결산</div>
      </div>

      ${state.viewMode === 'dashboard' ? `
        ${Dashboard()}
        ${TransactionList()}
      ` : state.viewMode === 'members' ? MembersView()
      : state.viewMode === 'analysis' ? AnalysisView() : SettlementView()}
    </main>
    ${AddTransactionModal()}
    <div id="receiptModal" class="modal-overlay" onclick="if (event.target === this) window.hideModal('receiptModal')">
      <div class="glass modal-content receipt-modal">
        <div class="receipt-modal-head">
          <h3 id="receiptModalTitle">영수증 보기</h3>
          <div class="receipt-head-actions">
            <button class="btn btn-ghost receipt-btn" id="receiptDownloadAll" onclick="window.downloadAllReceipts()">전체 저장</button>
            <button class="icon-btn" onclick="window.hideModal('receiptModal')" title="닫기">✕</button>
          </div>
        </div>
        <div class="receipt-zoombar">
          <span class="receipt-zoom-label">크기</span>
          <button class="zoom-step" onclick="window.stepReceiptZoom(-25)" title="축소">−</button>
          <input type="range" id="receiptZoom" class="zoom-range" min="20" max="300" step="5"
                 value="${state.receipt.zoom}" oninput="window.setReceiptZoom(this.value)">
          <button class="zoom-step" onclick="window.stepReceiptZoom(25)" title="확대">＋</button>
          <span class="zoom-value" id="receiptZoomValue">${state.receipt.zoom}%</span>
          <div class="zoom-presets">
            <button class="filter-chip" onclick="window.fitReceipt('height')">세로 맞춤</button>
            <button class="filter-chip" onclick="window.setReceiptZoom(100)">가로 맞춤</button>
            <button class="filter-chip" onclick="window.setReceiptZoom(200)">200%</button>
          </div>
        </div>
        <div id="modalGallery" class="modal-gallery">
          <!-- Images injected here -->
        </div>
      </div>
    </div>

    <!-- Custom Confirm Modal -->
    <div id="confirmModal" class="modal-overlay">
      <div class="glass modal-content" style="max-width: 400px; text-align: center;">
        <h3 id="confirmTitle" style="margin-bottom: 1rem;">삭제 확인</h3>
        <p id="confirmMessage" style="color: var(--text-muted); margin-bottom: 2rem; line-height: 1.6;"></p>
        <div style="display: flex; gap: 1rem; justify-content: center;">
          <button class="btn btn-ghost" onclick="window.hideModal('confirmModal')" style="flex: 1;">취소</button>
          <button id="confirmActionBtn" class="btn btn-danger" style="flex: 1;">삭제하기</button>
        </div>
      </div>
    </div>
  `;

  if (state.viewMode === 'analysis') setTimeout(initCharts, 50);

  document.getElementById('addForm')?.addEventListener('submit', handleTransactionSubmit);
  document.getElementById('memberForm')?.addEventListener('submit', handleAddMember);
  document.getElementById('transferForm')?.addEventListener('submit', handleAddTransfer);
  document.getElementById('receipts')?.addEventListener('change', (e) => {
    const files = e.target.files;
    document.getElementById('fileNames').textContent = `${files.length}개의 파일 선택됨`;
  });
}

// --- Event Handlers ---

async function handleTransactionSubmit(e) {
  e.preventDefault();
  const files = document.getElementById('receipts').files;

  let receipts = [];
  if (files.length > 0) {
    for (let file of Array.from(files).slice(0, 5)) {
      const reader = new FileReader();
      const promise = new Promise(resolve => {
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
      });
      receipts.push(await promise);
    }
  }

  const txData = {
    reason: document.getElementById('reason').value,
    amount: parseInt(document.getElementById('amount').value.replace(/,/g, '')) || 0,
    source: document.getElementById('source').value,
    date: document.getElementById('date').value,
  };

  let finalTx;
  if (state.editingId) {
    const index = state.transactions.findIndex(t => String(t.id) === String(state.editingId));
    const oldTx = state.transactions[index];
    if (oldTx.receipts === undefined) {
      // 안전장치: 영수증을 아직 못 받았으면 빈 값으로 덮어쓰지 않는다
      const loaded = await ensureReceipts(oldTx.id);
      if (!loaded) return;
    }
    const finalReceipts = receipts.length > 0 ? receipts : (oldTx.receipts || []);
    finalTx = { ...oldTx, ...txData, receipts: finalReceipts };
    state.transactions[index] = finalTx;
    state.editingId = null;
  } else {
    finalTx = { id: String(Date.now()), ...txData, receipts };
    state.transactions.push(finalTx);
  }

  state.selectedMonth = parseInt(txData.date.split('-')[1]);

  syncTransaction(finalTx);
  window.hideModal('addModal');
  render();
}

async function handleAddMember(e) {
  e.preventDefault();
  const newMember = {
    id: String(Date.now()),
    name: document.getElementById('mName').value,
    amount: parseInt(document.getElementById('mAmount').value.replace(/,/g, '')) || 0,
    type: document.getElementById('mType').value,
    date: document.getElementById('mDate').value || new Date().toISOString().split('T')[0]
  };
  state.members.push(newMember);
  syncMember(newMember);
  state.currentMemberPage = 1;
  render();
  showToast(`${newMember.type === 'fee' ? '회비' : '찬조금'} ₩ ${newMember.amount.toLocaleString()}원이 등록되었습니다.`, 'success');
}

const POOL_LABEL = { fee: '회비', donation: '찬조금' };
const poolTo = (pool) => pool === 'fee' ? '회비로' : '찬조금으로';

async function handleAddTransfer(e) {
  e.preventDefault();
  const [from_pool, to_pool] = document.getElementById('tfDirection').value.split('>');
  const amount = parseInt(document.getElementById('tfAmount').value.replace(/,/g, '')) || 0;
  if (amount <= 0) { showToast('이체 금액을 입력해주세요.', 'danger'); return; }

  const stats = calculateCurrentStats();
  const available = from_pool === 'fee' ? stats.currentFee : stats.currentDonation;
  if (amount > available) {
    showToast(`잔여 ${POOL_LABEL[from_pool]}(₩ ${available.toLocaleString()})보다 큰 금액은 옮길 수 없습니다.`, 'danger');
    return;
  }

  const tf = {
    id: String(Date.now()),
    from_pool,
    to_pool,
    amount,
    date: document.getElementById('tfDate').value || new Date().toISOString().split('T')[0],
    memo: document.getElementById('tfMemo').value.trim() || null
  };
  state.transfers.push(tf);
  syncTransfer(tf);
  render();
  showToast(`${POOL_LABEL[from_pool]}에서 ${poolTo(to_pool)} ₩ ${amount.toLocaleString()}원을 옮겼습니다.`, 'success');
}

// --- Window Globals ---

function showToast(message, type = 'primary') {
  const toast = document.createElement('div');
  toast.className = `glass action-toast toast-${type} fade-in`;
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <span>${message}</span>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.showAddModal = () => {
  state.editingId = null;
  render();
  document.getElementById('addModal').classList.add('active');
};

window.editTransaction = async (id) => {
  // 수정 저장 때 기존 영수증을 그대로 유지하려면 먼저 받아둬야 한다
  const tx = await ensureReceipts(id);
  if (!tx) return;
  state.editingId = id;
  render();
  document.getElementById('addModal').classList.add('active');
};

window.deleteTransaction = (id, event) => {
  if (event) event.stopPropagation();

  const targetId = String(id);
  const txToDelete = state.transactions.find(t => String(t.id) === targetId);

  if (!txToDelete) return;

  const isSupport = txToDelete.source === 'support';
  const sourceLabel = txToDelete.source === 'budget' ? '기본 예산' :
    txToDelete.source === 'fee' ? '회비' :
      txToDelete.source === 'donation' ? '찬조금' : '예산 지원';

  const modal = document.getElementById('confirmModal');
  const message = document.getElementById('confirmMessage');
  const actionBtn = document.getElementById('confirmActionBtn');

  if (isSupport) {
    message.innerHTML = `'${txToDelete.reason}' 내역을 삭제하시겠습니까?<br>이 항목은 증빙용이며 예산 잔액에 영향을 주지 않습니다.`;
  } else {
    message.innerHTML = `'${txToDelete.reason}' 내역을 삭제하시겠습니까?<br><b style="color: var(--primary)">₩ ${txToDelete.amount.toLocaleString()}원</b>이 ${sourceLabel} 항목으로 자동 복구됩니다.`;
  }

  modal.classList.add('active');

  actionBtn.onclick = () => {
    state.transactions = state.transactions.filter(t => String(t.id) !== targetId);
    removeTransaction(targetId);
    render();
    window.hideModal('confirmModal');
    showToast(isSupport ? '증빙 내역이 삭제되었습니다.' : `${sourceLabel} 항목에서 ₩ ${txToDelete.amount.toLocaleString()}원이 정상 복구되었습니다.`, 'success');
  };
};

window.deleteMember = (id, event) => {
  if (event) event.stopPropagation();

  const targetId = String(id);
  const memberToDelete = state.members.find(m => String(m.id) === targetId);
  if (!memberToDelete) return;

  const modal = document.getElementById('confirmModal');
  const message = document.getElementById('confirmMessage');
  const actionBtn = document.getElementById('confirmActionBtn');

  message.innerHTML = `'${memberToDelete.name}' 명단을 삭제하시겠습니까?<br><b style="color: var(--primary)">₩ ${memberToDelete.amount.toLocaleString()}원</b>이 ${memberToDelete.type === 'fee' ? '회비' : '찬조금'} 풀(Pool)에서 제거됩니다.`;

  modal.classList.add('active');

  actionBtn.onclick = () => {
    state.members = state.members.filter(m => String(m.id) !== targetId);
    removeMember(targetId);
    render();
    window.hideModal('confirmModal');
    showToast(`명단이 삭제되었습니다.`, 'danger');
  };
};

window.deleteTransfer = (id, event) => {
  if (event) event.stopPropagation();
  const targetId = String(id);
  const tf = state.transfers.find(t => String(t.id) === targetId);
  if (!tf) return;

  const modal = document.getElementById('confirmModal');
  const message = document.getElementById('confirmMessage');
  const actionBtn = document.getElementById('confirmActionBtn');

  message.innerHTML = `이 이체 기록을 삭제하시겠습니까?<br><b style="color: var(--primary)">₩ ${tf.amount.toLocaleString()}원</b>이 ${POOL_LABEL[tf.to_pool]}에서 ${poolTo(tf.from_pool)} 되돌아갑니다.`;
  modal.classList.add('active');

  actionBtn.onclick = () => {
    state.transfers = state.transfers.filter(t => String(t.id) !== targetId);
    removeTransfer(targetId);
    render();
    window.hideModal('confirmModal');
    showToast('이체 기록이 삭제되었습니다.', 'danger');
  };
};

window.hideModal = (id) => document.getElementById(id)?.classList.remove('active');

window.selectMonth = (m) => { state.selectedMonth = m; render(); };

window.changeMemberPage = (page) => { state.currentMemberPage = page; render(); };
window.setMemberFilter = (f) => { state.memberFilter = f; state.currentMemberPage = 1; render(); };
window.setViewMode = (mode) => { state.viewMode = mode; render(); window.scrollTo({ top: 0 }); };
window.setSettlementMonth = (m) => { state.settlementMonth = parseInt(m); render(); };

// 보고서·ZIP 파일명용 사유 정리: 괄호 안 메모와 명단에 있는 이름을 뗀다
// 이름 목록 = 명단 탭 이름 + 사유 괄호 안에 적힌 결제자 이름("(동우)", "(김예인, 입금완료)"). 명단에 없는 사람도 잡힌다.
const NAME_NOISE = new Set(['입금', '완료', '입근', '계산', '결혼식', '동규한테', '청구받기', '지원인듯', '전']);
function knownNames() {
  const set = new Set(state.members.map(m => String(m.name || '').normalize('NFC').trim()));
  state.transactions.forEach(t => {
    const src = String(t.reason || '').normalize('NFC');
    for (const m of src.matchAll(/\(([^)]*)\)/g)) {
      m[1].split(/[\s,.]+/).forEach(tok => {
        const w = tok.replace(/\d+/g, '');
        if (/^[가-힣]{2,3}$/.test(w) && !NAME_NOISE.has(w)) set.add(w);
      });
    }
  });
  return [...set].filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
}

function cleanReason(reason) {
  // NFC 정규화: 맥 파일명에서 복붙한 사유는 자모가 분해된(NFD) 채 저장돼 정규식이 "월/일"을 못 알아본다
  let out = String(reason || '').normalize('NFC').replace(/\s*\(.*?\)/g, '').trim();
  // 사유 앞머리에 손으로 적은 날짜("8/1 토,", "8월 15일", "8/22(토)", "8월8일 토요일")는 뗀다 — 보고서·파일명이 날짜를 따로 붙이므로
  out = out.replace(/^\s*\d{1,2}\s*[\/월]\s*\d{1,2}\s*일?\s*(?:\(?[일월화수목금토]요일\)?|\(?[일월화수목금토]\)?)?\s*[,·:\-]?\s*/, '');
  const names = knownNames();
  names.forEach(name => {
    if (name && name.length >= 2) out = out.replace(new RegExp(`\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'g'), ' ').trim();
  });
  return out.replace(/\s{2,}/g, ' ');
}

// 보고서용 항목명: 사유 원문을 「(맥락) 항목」 한두 단어로 바꾼다.
// 원문(화면·ZIP 파일명)은 그대로 두고, 청구서에 이름·입금상태·"찬양팀" 같은 메모가 새지 않게 복사할 때만 적용.
const REPORT_CONTEXT = [[/\bmt\b|엠티/i, 'MT'], [/수련회/, '수련회']];
const REPORT_ITEMS = [
  [/아침/, '아침식사'], [/점심/, '점심'], [/저녁/, '저녁'], [/카페|커피/, '카페'],
  [/식수|물\s*구매|생수/, '식수비'], [/장소\s*예약|숙소|예약/, '장소 예약'], [/준비/, '준비'],
  [/간식/, '간식'], [/피자|치킨|햄버거/, '간식'], [/회식/, '회식'], [/교통|주유|택시|버스/, '교통비'],
];
const REPORT_NOISE = /찬양팀|계산|입금\s*(전|완료)|입근\s*전|토욜|[일월화수목금토]요일|모임|없음|모름|인듯\??|\s*[,.]\s*/g;

function reportLabel(reason) {
  const src = String(reason || '').normalize('NFC');
  const ctx = REPORT_CONTEXT.find(([re]) => re.test(src))?.[1];
  const item = REPORT_ITEMS.find(([re]) => re.test(src))?.[1];
  if (item) return ctx ? `${ctx} ${item}` : item;
  // 표에 없는 사유: 날짜·괄호·이름·메모를 떼고 남는 말만
  let rest = cleanReason(src).replace(REPORT_NOISE, ' ').replace(/\s{2,}/g, ' ').trim();
  if (ctx) rest = rest.replace(/\bmt\b|엠티|수련회/gi, '').trim();
  if (ctx && rest) return `${ctx} ${rest}`;
  return ctx || rest || '기타';
}

window.copySettlementReport = (month) => {
  const m = month || state.settlementMonth;
  const currentYear = 2026;
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

  // Current month date boundaries
  const monthStr = `${currentYear}-${String(m).padStart(2, '0')}`;
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? currentYear + 1 : currentYear;
  const nextMonthStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  // 1. All Transactions for the month (as seen in dashboard)
  const monthlyTxs = state.transactions.filter(t => {
    const [year, monthVal] = t.date.split('-').map(Number);
    return year === currentYear && monthVal === m;
  }).sort(byDateThenId);

  // Budget-only spending for the "Remaining Budget" calculation section
  const budgetTxs = monthlyTxs.filter(t => t.source === 'budget');
  const thisMonthBudgetSpent = budgetTxs.reduce((sum, t) => sum + t.amount, 0);
  const thisMonthTotalSpent = monthlyTxs.reduce((sum, t) => sum + t.amount, 0);

  // 2. Previous Budget Balance Calculation
  const prevBudgetSpent = state.transactions
    .filter(t => t.source === 'budget' && t.date < `${monthStr}-01`)
    .reduce((sum, t) => sum + t.amount, 0);
  const prevBudgetBalance = INITIAL_BUDGET - prevBudgetSpent;
  const remainingBudget = prevBudgetBalance - thisMonthBudgetSpent;

  // 3. Fee Summary (Cumulative up to this month)
  const totalFeeIncome = state.members
    .filter(mem => mem.type === 'fee' && mem.date < nextMonthStr)
    .reduce((sum, mem) => sum + mem.amount, 0);
  const totalFeeSpent = state.transactions
    .filter(t => t.source === 'fee' && t.date < nextMonthStr)
    .reduce((sum, t) => sum + t.amount, 0);
  const remainingFee = totalFeeIncome - totalFeeSpent + BALANCE_ADJUST.fee + transferNet('fee', nextMonthStr);

  // 4. Donation Summary (Cumulative up to this month)
  const totalDonationIncome = state.members
    .filter(mem => mem.type === 'donation' && mem.date < nextMonthStr)
    .reduce((sum, mem) => sum + mem.amount, 0);
  const totalDonationSpent = state.transactions
    .filter(t => t.source === 'donation' && t.date < nextMonthStr)
    .reduce((sum, t) => sum + t.amount, 0);
  const remainingDonation = totalDonationIncome - totalDonationSpent + BALANCE_ADJUST.donation + transferNet('donation', nextMonthStr);

  // Formatting the Report (출처 구분 없이, 이모지 없이)
  let report = `${m}월 결산\n\n`;

  report += `[지출 내역]\n`;
  // 0원 건(모임 없음 메모 등)은 청구서에 안 싣는다
  const reportTxs = monthlyTxs.filter(t => t.amount > 0);
  if (reportTxs.length > 0) {
    // 같은 날 같은 항목이 여러 건이면 「점심 1 / 점심 2」로 번호
    const labeled = reportTxs.map(t => ({ t, label: reportLabel(t.reason) }));
    const counts = {};
    labeled.forEach(({ t, label }) => { const k = `${t.date}|${label}`; counts[k] = (counts[k] || 0) + 1; });
    const seen = {};
    labeled.forEach(({ t, label }) => {
      const [year, month, day_num] = t.date.split('-').map(Number);
      const day = weekdays[new Date(year, month - 1, day_num).getDay()];
      const k = `${t.date}|${label}`;
      const name = counts[k] > 1 ? `${label} ${(seen[k] = (seen[k] || 0) + 1)}` : label;
      report += `• ${month}/${day_num}(${day}) ${name}: ${t.amount.toLocaleString()}원\n`;
    });
  } else {
    report += `• 지출 내역이 없습니다.\n`;
  }
  report += `\n총 지출: ${thisMonthTotalSpent.toLocaleString()}원\n\n`;
  report += `------------------------------------\n\n`;

  report += `[남은 예산]\n`;
  report += `• 이전 잔액: ${prevBudgetBalance.toLocaleString()}원\n`;
  report += `• ${m}월 지출: ${thisMonthBudgetSpent.toLocaleString()}원\n`;
  report += `• 남은 예산: ${remainingBudget.toLocaleString()}원\n\n`;
  report += `------------------------------------\n\n`;

  report += `남은 회비: ${remainingFee.toLocaleString()}원\n`;
  report += `남은 찬조금: ${remainingDonation.toLocaleString()}원`;

  navigator.clipboard.writeText(report.trim()).then(() => {
    showToast(`${m}월 결산 보고서가 클립보드에 복사되었습니다!`, 'success');
  });
};

window.copyAmount = (amount) => {
  navigator.clipboard.writeText(String(amount)).then(() => showToast(`${Number(amount).toLocaleString()} 복사됨`, 'success'));
};

// 해당 달 영수증을 날짜순 번호 파일명으로 묶어 ZIP 다운로드
// 파일명: "N. M월D일 X요일 사유.jpeg" (같은 건에 여러 장이면 -1, -2), ZIP: "찬양팀 M월 청구 금액.zip"
window.downloadMonthZip = async (month) => {
  const m = parseInt(month);
  const monthStr = `2026-${String(m).padStart(2, '0')}`;
  const txs = state.transactions
    .filter(t => t.date.startsWith(monthStr))
    .sort(byDateThenId);
  if (txs.length === 0) return showToast(`${m}월 지출 내역이 없습니다.`, 'danger');
  if (!window.JSZip) return showToast('ZIP 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.', 'danger');

  showToast(`${m}월 영수증을 모으는 중…`);
  // 아직 안 받은 영수증은 여기서 받는다 (건별)
  for (const t of txs) {
    if (t.receipts === undefined) await ensureReceipts(t.id);
  }

  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const zip = new JSZip();
  let n = 0;
  txs.forEach(t => {
    const rs = t.receipts || [];
    if (rs.length === 0) return;
    n += 1;
    const [y, mo, d] = t.date.split('-').map(Number);
    const wd = weekdays[new Date(y, mo - 1, d).getDay()];
    const base = `${n}. ${mo}월${d}일 ${wd}요일 ${cleanReason(t.reason).replace(/[\\/:*?"<>|]/g, '')}`.trim();
    rs.forEach((r, i) => {
      const ext = ((r.match(/^data:image\/(\w+)/) || [, 'jpeg'])[1]).replace('jpg', 'jpeg');
      const name = rs.length > 1 ? `${base}-${i + 1}.${ext}` : `${base}.${ext}`;
      zip.file(name, r.split(',')[1], { base64: true });
    });
  });
  if (n === 0) return showToast(`${m}월에는 첨부된 영수증이 없습니다.`, 'danger');

  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  saveBlob(blob, `찬양팀 ${m}월 청구 금액.zip`);
  showToast(`${m}월 영수증 ${n}건을 ZIP으로 저장했습니다.`, 'success');
};

window.formatAmount = (input) => {
  let value = input.value.replace(/[^0-9]/g, '');
  if (value) {
    input.value = parseInt(value).toLocaleString();
  } else {
    input.value = '';
  }
};

// --- Receipt Viewer ---

// dataURL(base64)을 Blob URL로 바꾼다.
// 크롬은 큰 data: URL의 새 탭 열기·다운로드를 막기 때문에 Blob을 거쳐야 한다.
function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [, 'image/jpeg'])[1];
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function receiptFileName(tx, index) {
  const ext = ((tx.receipts[index].match(/^data:image\/(\w+)/) || [, 'jpg'])[1]).replace('jpeg', 'jpg');
  // 파일명에 못 쓰는 문자만 걷어낸다 (한글은 그대로 둔다)
  const safeReason = tx.reason.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40);
  const suffix = tx.receipts.length > 1 ? `_${index + 1}` : '';
  return `${tx.date}_${safeReason}${suffix}.${ext}`;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function currentReceiptTx() {
  return state.transactions.find(t => String(t.id) === String(state.receipt.txId));
}

window.showReceipts = async (id) => {
  const tx = await ensureReceipts(id);
  if (!tx || !tx.receipts || tx.receipts.length === 0) return;

  state.receipt.txId = String(id);

  const modal = document.getElementById('receiptModal');
  const gallery = document.getElementById('modalGallery');
  const title = document.getElementById('receiptModalTitle');

  title.textContent = `[${tx.reason}] 영수증 ${tx.receipts.length}장`;
  document.getElementById('receiptDownloadAll').style.display = tx.receipts.length > 1 ? '' : 'none';

  gallery.innerHTML = tx.receipts.map((r, i) => {
    const sizeKB = Math.round((r.length * 3 / 4) / 1024);
    return `
      <figure class="receipt-item">
        <figcaption class="receipt-item-bar">
          <span class="receipt-item-no">${i + 1} / ${tx.receipts.length} · 약 ${sizeKB.toLocaleString()}KB</span>
          <span class="receipt-item-actions">
            <button class="btn btn-ghost receipt-btn" onclick="window.downloadReceipt(${i})">저장</button>
            <button class="btn btn-ghost receipt-btn" onclick="window.openReceipt(${i})">새 탭</button>
          </span>
        </figcaption>
        <img src="${r}" style="width: ${state.receipt.zoom}%"
             title="클릭하면 새 탭에서 원본 크기로 열립니다" onclick="window.openReceipt(${i})">
      </figure>
    `;
  }).join('');

  modal.classList.add('active');

  // 열자마자 첫 장이 통째로 보이게 (세로 맞춤). 이미지 크기를 알아야 하니 로드 후 적용.
  const first = gallery.querySelector('img');
  if (first) {
    if (first.complete && first.naturalHeight) window.fitReceipt('height');
    else first.onload = () => window.fitReceipt('height');
  }
};

window.setReceiptZoom = (value) => {
  const zoom = Math.max(20, Math.min(300, parseInt(value) || 100));
  state.receipt.zoom = zoom;
  document.getElementById('receiptZoom').value = zoom;
  document.getElementById('receiptZoomValue').textContent = `${zoom}%`;
  document.querySelectorAll('#modalGallery img').forEach(img => { img.style.width = `${zoom}%`; });
};

// 'height' = 첫 장의 세로가 갤러리 높이에 딱 들어오는 배율 (배율 100% = 갤러리 폭 기준)
window.fitReceipt = (mode) => {
  const gallery = document.getElementById('modalGallery');
  const img = gallery?.querySelector('img');
  if (!img || !img.naturalWidth) return window.setReceiptZoom(100);
  if (mode === 'height') {
    const barH = img.parentElement.querySelector('.receipt-item-bar')?.offsetHeight || 0;
    const availH = gallery.clientHeight - barH - 12;
    const availW = gallery.clientWidth;
    const widthPx = availH * (img.naturalWidth / img.naturalHeight);
    return window.setReceiptZoom(Math.round(Math.min(100, widthPx / availW * 100)));
  }
  return window.setReceiptZoom(100);
};

window.stepReceiptZoom = (delta) => window.setReceiptZoom(state.receipt.zoom + delta);

window.downloadReceipt = (index) => {
  const tx = currentReceiptTx();
  if (!tx) return;
  saveBlob(dataUrlToBlob(tx.receipts[index]), receiptFileName(tx, index));
  showToast('영수증을 저장했습니다.', 'success');
};

window.openReceipt = (index) => {
  const tx = currentReceiptTx();
  if (!tx) return;
  const url = URL.createObjectURL(dataUrlToBlob(tx.receipts[index]));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

window.downloadAllReceipts = () => {
  const tx = currentReceiptTx();
  if (!tx) return;
  // 브라우저가 연속 다운로드를 묶어서 막지 않도록 간격을 준다
  tx.receipts.forEach((_, i) => setTimeout(() => window.downloadReceipt(i), i * 400));
};

function initCharts() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const monthStr = `${currentYear}-${String(month).padStart(2, '0')}`;
    return state.transactions
      .filter(t => t.date.startsWith(monthStr) && t.source !== 'support')
      .reduce((sum, t) => sum + t.amount, 0);
  });

  const ctxMonthly = document.getElementById('monthlyChart')?.getContext('2d');
  if (ctxMonthly) {
    new Chart(ctxMonthly, {
      type: 'bar',
      data: {
        labels: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
        datasets: [{
          label: '월별 지출액',
          data: monthlyData,
          backgroundColor: '#0066cc',
          borderColor: '#0066cc',
          borderWidth: 0,
          borderRadius: 4,
          hoverBackgroundColor: '#0071e3'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `₩ ${context.raw.toLocaleString()}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.06)' },
            ticks: { color: '#86868b' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#86868b' }
          }
        }
      }
    });
  }

  const currentMonthStr = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthTxs = state.transactions.filter(t => t.date.startsWith(currentMonthStr) && t.source !== 'support');
  const catData = [
    currentMonthTxs.filter(t => t.source === 'budget').reduce((s, t) => s + t.amount, 0),
    currentMonthTxs.filter(t => t.source === 'fee').reduce((s, t) => s + t.amount, 0),
    currentMonthTxs.filter(t => t.source === 'donation').reduce((s, t) => s + t.amount, 0)
  ];

  const ctxCategory = document.getElementById('categoryChart')?.getContext('2d');
  if (ctxCategory) {
    new Chart(ctxCategory, {
      type: 'doughnut',
      data: {
        labels: ['기본예산', '회비', '찬조금'],
        datasets: [{
          data: catData,
          backgroundColor: ['#0066cc', '#6fb1f2', '#cfe3fa'],
          borderWidth: 0,
          hoverOffset: 15
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#6e6e73', font: { size: 12 }, padding: 20 }
          },
          tooltip: {
            callbacks: {
              label: (item) => `${item.label}: ₩ ${item.raw.toLocaleString()}`
            }
          }
        },
        cutout: '70%'
      }
    });
  }
}

fetchData();

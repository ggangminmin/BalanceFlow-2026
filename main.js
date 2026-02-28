// Supabase is loaded via CDN in index.html

// --- Supabase Configuration ---
const { createClient } = window.supabase
const SUPABASE_URL = 'https://bxzjuozfuagrncknbrge.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4emp1b3pmdWFncm5ja25icmdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNzg4NjIsImV4cCI6MjA4NDk1NDg2Mn0.suJMxDEhCk8k4DJ7SCRKWfiB9gjwvN743buOxXXvCag'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// --- State Management ---
const INITIAL_BUDGET = 3200000;
const ITEMS_PER_PAGE = 5;

let state = {
  totalInitialBudget: INITIAL_BUDGET,
  transactions: [],
  members: [],
  currentMemberPage: 1,
  editingId: null,
  viewMode: 'dashboard',
  expandedMonths: [new Date().getMonth() + 1],
  settlementMonth: new Date().getMonth() + 1,
  isLoading: true
};

// --- Supabase Logic ---

async function fetchData() {
  state.isLoading = true;
  render();

  try {
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .order('date', { ascending: true });

    const { data: members, error: mError } = await supabase
      .from('members')
      .select('*')
      .order('date', { ascending: true });

    if (txError) throw txError;
    if (mError) throw mError;

    state.transactions = transactions || [];
    state.members = members || [];
  } catch (err) {
    console.error('Error fetching data:', err);
    showToast('데이터를 불러오는데 실패했습니다.', 'danger');
  } finally {
    state.isLoading = false;
    render();
  }
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

function calculateCurrentStats() {
  const feeTotal = state.members.filter(m => m.type === 'fee').reduce((acc, curr) => acc + curr.amount, 0);
  const donationTotal = state.members.filter(m => m.type === 'donation').reduce((acc, curr) => acc + curr.amount, 0);

  const feeExpenses = state.transactions.filter(t => t.source === 'fee').reduce((acc, curr) => acc + curr.amount, 0);
  const donationExpenses = state.transactions.filter(t => t.source === 'donation').reduce((acc, curr) => acc + curr.amount, 0);
  const generalExpenses = state.transactions.filter(t => t.source === 'budget').reduce((acc, curr) => acc + curr.amount, 0);
  const supportTxs = state.transactions.filter(t => t.source === 'support');

  return {
    currentBudget: INITIAL_BUDGET - generalExpenses,
    currentFee: feeTotal - feeExpenses,
    currentDonation: donationTotal - donationExpenses,
    totalSpent: state.transactions.filter(t => t.source !== 'support').reduce((acc, curr) => acc + curr.amount, 0),
    supportTotal: supportTxs.reduce((acc, curr) => acc + curr.amount, 0),
    supportCount: supportTxs.length
  };
}

// --- Components ---

function Header() {
  return `
    <header class="glass-header">
      <div style="display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: 0 auto; padding: 0 2rem;">
        <h1 style="background: linear-gradient(90deg, #fff, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; cursor: pointer;" onclick="location.reload()">BalanceFlow 2026</h1>
        <div class="header-actions">
          <button class="btn btn-ghost" onclick="window.showMemberModal()">
            <span>명단 관리</span>
          </button>
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
        <span class="stat-label">💰 2026 총 예산 잔액</span>
        <div class="stat-value">₩ ${stats.currentBudget.toLocaleString()}</div>
        <div class="progress-container">
          <div class="progress-bar" style="width: ${budgetProgress}%"></div>
        </div>
        <span style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; display: block;">기본 예산 3,200,000원 기준</span>
      </div>
      
      <div class="glass stat-card">
        <span class="stat-label">👥 잔여 회비</span>
        <div class="stat-value" style="color: var(--success)">₩ ${stats.currentFee.toLocaleString()}</div>
        <div style="font-size: 0.875rem; color: var(--text-muted)">회비 풀 (Pool) 합계</div>
      </div>

      <div class="glass stat-card">
        <span class="stat-label">🎁 잔여 찬조금</span>
        <div class="stat-value" style="color: var(--primary)">₩ ${stats.currentDonation.toLocaleString()}</div>
        <div style="font-size: 0.875rem; color: var(--text-muted)">찬조금 풀 (Pool) 합계</div>
      </div>

      <div class="glass stat-card" style="border-top: 2px solid var(--text-muted);">
        <span class="stat-label">🛡️ 예산 지원 (증빙용)</span>
        <div class="stat-value" style="color: #cbd5e1">₩ ${stats.supportTotal.toLocaleString()}</div>
        <div style="font-size: 0.875rem; color: var(--text-muted)">총 ${stats.supportCount}건 (잔액 관계없음)</div>
      </div>
    </div>

    <div class="glass stat-card" style="margin-bottom: 2rem; border-left: 4px solid var(--primary);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-size: 1.25rem;">🤖</span>
          <span class="stat-label" style="margin-bottom: 0;">GPT 오케스트레이션 리포트</span>
        </div>
        <button class="btn btn-ghost" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="window.generateAIReport()">
          실시간 분석 요청
        </button>
      </div>
      <p id="aiInsightText" style="font-size: 0.95rem; color: #cbd5e1; line-height: 1.6;">
        ${getAIInsight(stats)}
      </p>
    </div>
  `;
}

function getAIInsight(stats) {
  if (state.transactions.length === 0) return "데이터를 불러오는 중이거나 지출 내역이 없습니다.";
  const ratio = (stats.currentBudget / INITIAL_BUDGET) * 100;
  if (ratio > 80) return "현재 예산 잔액이 80% 이상입니다! 아주 건강한 지출 흐름을 보여주고 계시네요.";
  if (ratio > 50) return "절반 정도의 예산을 사용하셨습니다. 계획적인 지출이 돋보입니다.";
  if (ratio > 20) return "예산이 20% 남았습니다. 앞으로의 지출 계획을 다시 점검해 보시는 것이 좋겠어요.";
  return "예산 경보! 잔액이 얼마 남지 않았습니다. 긴급하지 않은 지출은 다음 달로 미뤄보세요.";
}

function TransactionList() {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const transactionsByMonth = months.reduce((acc, m) => {
    acc[m] = state.transactions.filter(t => {
      const parts = t.date.split('-');
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      return year === 2026 && month === m;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
    return acc;
  }, {});

  if (state.transactions.length === 0 && !state.isLoading) {
    return `<div style="text-align: center; padding: 4rem; color: var(--text-muted);">지출 내역이 없습니다.</div>`;
  }

  return `
    <div class="transaction-list">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h3>2026년 월별 지출 관리</h3>
        <span style="font-size: 0.8rem; color: var(--text-muted);">총 ${state.transactions.length}건</span>
      </div>

      ${months.map(m => {
    const txs = transactionsByMonth[m];
    const totalSpent = txs.reduce((sum, t) => sum + t.amount, 0);
    const isExpanded = state.expandedMonths.includes(m);

    return `
          <div class="month-group ${isExpanded ? 'expanded' : ''}">
            <div class="month-header ${isExpanded ? 'active' : ''}" onclick="window.toggleMonth(${m})">
              <div class="month-info">
                <span class="month-title">${m}월 지출</span>
                <span class="month-summary">${txs.length}건 | ₩ ${totalSpent.toLocaleString()}</span>
              </div>
              <span class="month-arrow">▼</span>
            </div>
            <div class="month-content">
              ${txs.length > 0 ? txs.map(t => `
                <div class="glass transaction-item" style="padding: 1rem 1.25rem; border-radius: 16px;">
                  <div class="item-info">
                    <span class="item-title" style="font-size: 1rem;">${t.reason}</span>
                    <div class="item-meta">
                      <span>${t.date}</span>
                      <span class="badge badge-${t.source}">${t.source === 'budget' ? '기본예산' : t.source === 'fee' ? '회비' : t.source === 'donation' ? '찬조금' : '예산지원'}</span>
                    </div>
                    ${t.receipts && t.receipts.length > 0 ? `
                      <div class="receipt-badge" onclick="window.showReceipts('${t.id}')" style="margin-top: 0.5rem;">
                        <span>🧾 영수증 <b>${t.receipts.length}장</b></span>
                      </div>
                    ` : ''}
                  </div>
                  <div style="display: flex; align-items: center; gap: 1rem;">
                    <div class="item-amount amount-expense" style="font-size: 1rem; font-weight: 600;">
                      - ₩ ${t.amount.toLocaleString()}
                    </div>
                    <div class="action-buttons">
                      <button class="icon-btn edit" onclick="window.editTransaction('${t.id}')" title="수정" style="width: 30px; height: 30px;">✎</button>
                      <button class="icon-btn delete" onclick="window.deleteTransaction('${t.id}', event)" title="삭제" style="width: 30px; height: 30px;">✕</button>
                    </div>
                  </div>
                </div>
              `).join('') : `<div class="empty-month-msg">이 달의 지출 내역이 없습니다.</div>`}
            </div>
          </div>
        `;
  }).join('')}
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

          <div style="margin-top: 2rem; padding: 1rem; border-radius: 12px; background: rgba(255, 255, 255, 0.03); font-size: 0.85rem; line-height: 1.5;">
            <p style="color: var(--text-muted);">💡 이번 달 지출 데이터를 기반으로 예산 효율성을 분석했습니다.<br>※ '예산 지원(증빙 전용)' 항목은 분석 결과에 포함되지 않습니다.</p>
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
        <h2 style="margin: 0;">📅 2026년 월간 재무 결산 상세 현황</h2>
        <span style="font-size: 0.9rem; color: var(--text-muted);">총 ${monthlyReports.length}개월 분석됨</span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        ${monthlyReports.map(report => `
          <div class="glass card" style="padding: 1.5rem; border-left: 5px solid ${report.netBalance >= 0 ? 'var(--success)' : 'var(--danger)'};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem;">${report.month}월 결산 내역</h3>
              <button class="btn btn-ghost" style="font-size: 0.8rem; padding: 0.25rem 0.75rem;" onclick="window.copySettlementReport(${report.month})">보고서 복사</button>
            </div>

            <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
              <div style="padding: 1rem; border-radius: 12px; background: rgba(255, 255, 255, 0.03);">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 0.5rem;">📤 이달의 지출</span>
                <span style="font-size: 1.1rem; font-weight: 700; color: var(--danger);">₩ ${report.totalExpense.toLocaleString()}</span>
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem; display: flex; flex-direction: column;">
                  <span>- 예산: ${report.expenseBudget.toLocaleString()}</span>
                  <span>- 회비: ${report.expenseFee.toLocaleString()}</span>
                  <span>- 찬조: ${report.expenseDonation.toLocaleString()}</span>
                </div>
              </div>

              <div style="padding: 1rem; border-radius: 12px; background: rgba(255, 255, 255, 0.03);">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 0.5rem;">📥 이달의 수입</span>
                <span style="font-size: 1.1rem; font-weight: 700; color: var(--success);">₩ ${report.totalIncome.toLocaleString()}</span>
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem; display: flex; flex-direction: column;">
                  <span>- 회비: ${report.incomeFee.toLocaleString()}</span>
                  <span>- 찬조: ${report.incomeDonation.toLocaleString()}</span>
                </div>
              </div>

              <div style="padding: 1rem; border-radius: 12px; background: rgba(255, 255, 255, 0.03);">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 0.5rem;">⚖️ 월간 순수지</span>
                <span style="font-size: 1.1rem; font-weight: 700; color: ${report.netBalance >= 0 ? 'var(--primary)' : 'var(--danger)'};">
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
            <input type="text" id="amount" class="form-input" value="${tx ? tx.amount.toLocaleString() : ''}" placeholder="0" required oninput="window.formatAmount(this)">
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
              ${tx?.receipts ? `${tx.receipts.length}개의 기존 영수증 유지됨` : '파일을 선택하세요'}
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

function MemberModal() {
  const sortedMembers = [...state.members].sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalPages = Math.ceil(sortedMembers.length / ITEMS_PER_PAGE) || 1;
  const start = (state.currentMemberPage - 1) * ITEMS_PER_PAGE;
  const paginated = sortedMembers.slice(start, start + ITEMS_PER_PAGE);

  return `
    <div id="memberModal" class="modal-overlay">
      <div class="glass modal-content" style="max-width: 600px;">
        <h2 style="margin-bottom: 2rem;">회비 및 찬조금 명단</h2>
        
        <form id="memberForm" style="display: flex; gap: 0.5rem; margin-bottom: 2rem;">
          <input type="text" id="mName" class="form-input" placeholder="이름" required style="flex: 2">
          <input type="text" id="mAmount" class="form-input" placeholder="금액" required style="flex: 2" oninput="window.formatAmount(this)">
          <select id="mType" class="form-input" style="flex: 1">
            <option value="fee">회비</option>
            <option value="donation">찬조금</option>
          </select>
          <button type="submit" class="btn btn-primary">추가</button>
        </form>

        <table class="data-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>구분</th>
              <th style="text-align: right;">금액</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${paginated.map(m => `
              <tr>
                <td>${m.name}</td>
                <td><span class="badge badge-${m.type}">${m.type === 'fee' ? '회비' : '찬조금'}</span></td>
                <td style="text-align: right; font-weight: 600;">₩ ${m.amount.toLocaleString()}</td>
                <td style="text-align: right;">
                  <button class="icon-btn delete" onclick="window.deleteMember('${m.id}', event)">✕</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        ${totalPages > 1 ? `
          <div class="pagination">
            <button class="page-btn" ${state.currentMemberPage === 1 ? 'disabled' : ''} onclick="window.changeMemberPage(${state.currentMemberPage - 1})">이전</button>
            <span class="page-info">${state.currentMemberPage} / ${totalPages}</span>
            <button class="page-btn" ${state.currentMemberPage === totalPages ? 'disabled' : ''} onclick="window.changeMemberPage(${state.currentMemberPage + 1})">다음</button>
          </div>
        ` : ''}

        <button class="btn btn-ghost" style="width: 100%; margin-top: 1.5rem;" onclick="window.hideModal('memberModal')">닫기</button>
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
        <div class="nav-tab ${state.viewMode === 'analysis' ? 'active' : ''}" onclick="window.setViewMode('analysis')">본격 분석</div>
        <div class="nav-tab ${state.viewMode === 'settlement' ? 'active' : ''}" onclick="window.setViewMode('settlement')">월간 결산</div>
      </div>
      
      ${state.viewMode === 'dashboard' ? `
        ${Dashboard()}
        ${TransactionList()}
      ` : (state.viewMode === 'analysis' ? AnalysisView() : SettlementView())}
    </main>
    ${setTimeout(() => state.viewMode === 'analysis' && initCharts(), 50)}
    ${AddTransactionModal()}
    ${MemberModal()}
    <div id="receiptModal" class="modal-overlay" onclick="window.hideModal('receiptModal')">
      <div class="glass modal-content" style="max-width: 800px; width: 95%; background: rgba(15, 23, 42, 0.95);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h3 id="receiptModalTitle">영수증 보기</h3>
          <button class="icon-btn" onclick="window.hideModal('receiptModal')">✕</button>
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
          <button id="confirmActionBtn" class="btn btn-primary" style="flex: 1; background: var(--danger);">삭제하기</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('addForm')?.addEventListener('submit', handleTransactionSubmit);
  document.getElementById('memberForm')?.addEventListener('submit', handleAddMember);
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
    const finalReceipts = receipts.length > 0 ? receipts : oldTx.receipts;
    finalTx = { ...oldTx, ...txData, receipts: finalReceipts };
    state.transactions[index] = finalTx;
    state.editingId = null;
  } else {
    finalTx = { id: String(Date.now()), ...txData, receipts };
    state.transactions.push(finalTx);
  }

  const txMonth = parseInt(txData.date.split('-')[1]);
  if (!state.expandedMonths.includes(txMonth)) {
    state.expandedMonths.push(txMonth);
  }

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
    date: new Date().toISOString().split('T')[0]
  };
  state.members.push(newMember);
  syncMember(newMember);
  render();
  window.showMemberModal();
}

// --- Window Globals ---

function showToast(message, type = 'primary') {
  const toast = document.createElement('div');
  toast.className = `glass action-toast toast-${type} fade-in`;
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <span>${type === 'success' ? '✅' : type === 'danger' ? '⚠️' : 'ℹ️'}</span>
      <span>${message}</span>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.showAddModal = () => {
  state.editingId = null;
  render();
  document.getElementById('addModal').classList.add('active');
};

window.editTransaction = (id) => {
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

  message.innerHTML = `'${memberToDelete.name}' 명단을 삭제하시겠습니까?<br>해당 자금이 풀(Pool)에서 제거됩니다.`;

  modal.classList.add('active');

  actionBtn.onclick = () => {
    state.members = state.members.filter(m => String(m.id) !== targetId);
    removeMember(targetId);
    render();
    window.showMemberModal();
    window.hideModal('confirmModal');
    showToast(`명단이 삭제되었습니다.`, 'danger');
  };
};

window.showMemberModal = () => document.getElementById('memberModal').classList.add('active');
window.hideModal = (id) => document.getElementById(id).classList.remove('active');

window.toggleMonth = (m) => {
  if (state.expandedMonths.includes(m)) {
    state.expandedMonths = state.expandedMonths.filter(month => month !== m);
  } else {
    state.expandedMonths.push(m);
  }
  render();
};

window.changeMemberPage = (page) => { state.currentMemberPage = page; render(); window.showMemberModal(); };
window.setViewMode = (mode) => { state.viewMode = mode; render(); };
window.setSettlementMonth = (m) => { state.settlementMonth = parseInt(m); render(); };

window.copySettlementReport = (month) => {
  const m = month || state.settlementMonth;
  const currentYear = 2026;
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

  const report = `
[BalanceFlow 2026] ${m}월 재무 결산 보고
------------------------------------
■ 총 수입: ₩ ${totalIncome.toLocaleString()}
  - 회비: ₩ ${incomeFee.toLocaleString()}
  - 찬조금: ₩ ${incomeDonation.toLocaleString()}

■ 총 지출: ₩ ${totalExpense.toLocaleString()}
  - 기본예산: ₩ ${expenseBudget.toLocaleString()}
  - 회비지출: ₩ ${expenseFee.toLocaleString()}
  - 찬조지출: ₩ ${expenseDonation.toLocaleString()}

■ 순수지 결과: ₩ ${(totalIncome - totalExpense).toLocaleString()}
------------------------------------
※ 상세 내역은 대시보드에서 확인 가능합니다.
  `.trim();

  navigator.clipboard.writeText(report).then(() => {
    showToast('결산 보고서가 클립보드에 복사되었습니다!', 'success');
  });
};

window.formatAmount = (input) => {
  let value = input.value.replace(/[^0-9]/g, '');
  if (value) {
    input.value = parseInt(value).toLocaleString();
  } else {
    input.value = '';
  }
};

window.showReceipts = (id) => {
  const targetId = String(id);
  const tx = state.transactions.find(t => String(t.id) === targetId);
  if (!tx || !tx.receipts) return;

  const modal = document.getElementById('receiptModal');
  const gallery = document.getElementById('modalGallery');
  const title = document.getElementById('receiptModalTitle');

  title.textContent = `[${tx.reason}] 영수증 내역`;
  gallery.innerHTML = tx.receipts.map(r => `<img src="${r}" loading="lazy">`).join('');

  modal.classList.add('active');
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
          backgroundColor: 'rgba(99, 102, 241, 0.5)',
          borderColor: '#6366f1',
          borderWidth: 2,
          borderRadius: 8,
          hoverBackgroundColor: 'rgba(99, 102, 241, 0.8)'
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
            grid: { color: 'rgba(255,255,255,0.1)' },
            ticks: { color: '#94a3b8' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8' }
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
          backgroundColor: ['#6366f1', '#22c55e', '#f59e0b'],
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
            labels: { color: '#94a3b8', font: { size: 12 }, padding: 20 }
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

window.generateAIReport = async () => {
  const stats = calculateCurrentStats();
  const insightEl = document.getElementById('aiInsightText');
  const apiKey = import.meta.env.VITE_GPT_API_KEY;

  if (!insightEl) return;
  insightEl.innerHTML = '<span class="loader" style="width: 15px; height: 15px; border-width: 2px; display: inline-block;"></span> GPT가 예산을 분석 중입니다...';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: '당신은 전문 금융 분석가입니다. 사용자의 가계부 데이터를 보고 아주 짧고 명확한 조언(2-3문장)을 한국어로 제공하세요. 말투는 정중하면서도 통찰력 있게 유지하세요.'
        }, {
          role: 'user',
          content: `현재 가계부 현황:
- 총 잔여 예산: ₩ ${stats.currentBudget.toLocaleString()} (초기 320만원 대비 ${((stats.currentBudget / 3200000) * 100).toFixed(1)}% 남음)
- 잔여 회비: ₩ ${stats.currentFee.toLocaleString()}
- 잔여 찬조금: ₩ ${stats.currentDonation.toLocaleString()}
- 최근 지출 내역: ${JSON.stringify(state.transactions.slice(-3).map(t => t.reason + '(' + t.amount + ')'))}
이 데이터를 바탕으로 한 줄의 응원과 짧은 지출 가이드를 그려주세요.`
        }]
      })
    });

    const data = await response.json();
    insightEl.textContent = data.choices[0].message.content;
  } catch (err) {
    console.error('GPT API Error:', err);
    insightEl.textContent = 'GPT 연결에 실패했습니다. API 키 또는 네트워크를 확인해 주세요.';
  }
};

fetchData();

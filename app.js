(function () {
  const state = {
    summary: {},
    cases: [],
    selectedCaseId: null,
    activeView: 'dashboard',
    activeWbTab: 'extract',
    activeKbTab: 'catalog',
    triageFilter: 'ALL',
    areaChartMode: 'pipeline',
    knowledge: null,
    settings: null,
    copilotMessages: [
      {
        role: 'bot',
        text: 'Xin chào! Mình là Thiên Minh AI Agent. Mình đã phân tích sẵn các hồ sơ RFP: phát hiện hồ sơ nào chào giá được ngay, hồ sơ nào thiếu thông tin cần hỏi khách hàng và chặn các gói giá thấp sai chức năng.',
        caseId: null,
        tab: null
      }
    ],
    quickPrompts: [
      'Hồ sơ nào chào giá được ngay?',
      'Tại sao SunMart cần Ban Giám đốc duyệt?',
      'Fintech An Phát vướng lịch thế nào?',
      'Tuần nào đội Kỹ thuật rảnh nhất?'
    ]
  };

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function vnd(num) {
    if (num === null || num === undefined || isNaN(Number(num))) return '—';
    return new Intl.NumberFormat('vi-VN').format(Math.round(Number(num))) + ' đ';
  }

  function shortVnd(num) {
    if (!num) return '0 đ';
    if (num >= 1e9) return (num / 1e9).toFixed(2).replace(/\.00$/, '') + ' tỷ';
    if (num >= 1e6) return Math.round(num / 1e6) + ' tr';
    return vnd(num);
  }

  function toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  async function api(url, options = {}) {
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  function statusBadge(status) {
    switch (status) {
      case 'PUBLISHED':
        return '<span class="badge badge-green">✅ Đã xuất bản</span>';
      case 'READY_FOR_HITL_REVIEW':
        return '<span class="badge badge-green">🟢 Sẵn sàng chào giá</span>';
      case 'NEEDS_CLARIFICATION':
        return '<span class="badge badge-amber">🟡 Cần KH bổ sung</span>';
      case 'PENDING_ESCALATION':
        return '<span class="badge badge-red">🟠 Chờ duyệt vượt cấp</span>';
      case 'REVISION_REQUESTED':
        return '<span class="badge badge-purple">🟣 Cần chỉnh sửa</span>';
      default:
        return '<span class="badge badge-gray">Mới tiếp nhận</span>';
    }
  }

  function switchView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll('#main-nav .ln-item[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === viewName);
    });
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('active', v.id === `view-${viewName}`);
    });
    if (viewName === 'workbench') renderWorkbench();
    if (viewName === 'knowledge') loadKnowledge();
    if (viewName === 'settings') loadSettings();
  }

  function openCaseInWorkbench(caseId, tab) {
    state.selectedCaseId = caseId;
    const c = state.cases.find((x) => x.id === caseId);
    if (tab) {
      state.activeWbTab = tab;
    } else if (c) {
      if (c.status === 'NEEDS_CLARIFICATION') state.activeWbTab = 'extract';
      else if (c.status === 'PENDING_ESCALATION') state.activeWbTab = 'pricing';
      else if (c.status === 'READY_FOR_HITL_REVIEW' || c.status === 'PUBLISHED') state.activeWbTab = 'proposal';
      else state.activeWbTab = 'extract';
    }
    switchView('workbench');
    renderRightSidebar();
  }

  async function init() {
    bindGlobalEvents();
    await Promise.all([loadDashboard(), loadSettings(), loadKnowledge()]);
    renderDashboard();
    renderRightSidebar();
    renderCopilotDrawer();
  }

  async function loadDashboard() {
    const data = await api('/api/dashboard');
    state.summary = data.summary || {};
    state.cases = data.cases || [];
    if (!state.selectedCaseId && state.cases.length > 0) {
      state.selectedCaseId = state.cases[0].id;
    }
    renderDashboard();
    renderRightSidebar();
    if (state.activeView === 'workbench') renderWorkbench();
  }

  async function loadKnowledge() {
    if (!state.knowledge) state.knowledge = await api('/api/knowledge');
    renderKnowledge();
  }

  async function loadSettings() {
    const data = await api('/api/settings');
    state.settings = data.settings;
    renderSettings();
  }

  // ==================== DASHBOARD (LUNAR BLOOM BENTO) ====================
  function renderDashboard() {
    const s = state.summary;
    const pendingCount = (s.needs_clarification || 0) + (s.pending_escalation || 0);
    document.getElementById('side-badge-pending').textContent = pendingCount;
    document.getElementById('notif-count').textContent = pendingCount;

    // 1. Spotlight Card (Left Bento Card like "Continue" card)
    const priorityCase = state.cases.find((c) => c.status === 'PENDING_ESCALATION')
      || state.cases.find((c) => c.status === 'NEEDS_CLARIFICATION')
      || state.cases[0];

    const spotEl = document.getElementById('spotlight-card');
    if (priorityCase) {
      const cust = (priorityCase.extracted && priorityCase.extracted.customer_name) || priorityCase.title;
      const net = priorityCase.pricing ? shortVnd(priorityCase.pricing.net_before_vat_vnd) : 'Chờ bổ sung';
      const actionDesc = priorityCase.status === 'NEEDS_CLARIFICATION'
        ? 'Hồ sơ còn thiếu thông tin bắt buộc. Nhấn để gửi email hỏi khách hàng và bổ sung dữ liệu.'
        : (priorityCase.status === 'PENDING_ESCALATION'
          ? `Hồ sơ cần ${priorityCase.pricing?.authority_gate?.highest_authority_level || 'Lãnh đạo'} xem xét phê duyệt.`
          : 'Hồ sơ đã đủ thông tin, sẵn sàng thẩm định cuối 3 phòng ban và xuất bản chào giá.');
      spotEl.innerHTML = `
        <div class="spotlight-art">
          <div>
            <span class="badge badge-pink">Hồ sơ ưu tiên</span>
            <div class="mono" style="margin-top:8px;font-weight:800;color:#7a3e50;">${esc(priorityCase.id)}</div>
            <div style="font-size:12px;color:#5a4d52;font-weight:700;">Giá trị: ${esc(net)}</div>
          </div>
          <div style="font-size:38px;">🌸</div>
        </div>
        <div class="spotlight-body">
          <div>
            <div class="spotlight-title-row">
              <div class="spotlight-title">${esc(cust)}</div>
              <span class="green-dot" title="AI Agent đã phân tích"></span>
            </div>
            <div class="spotlight-desc">${esc(actionDesc)}</div>
          </div>
          <button class="btn-continue" id="btn-spotlight-continue">Tiếp tục xử lý →</button>
        </div>
      `;
      document.getElementById('btn-spotlight-continue').onclick = () => openCaseInWorkbench(priorityCase.id);
    }

    // 2. 4 Cute Mini Tiles (Exact "ROOTS / HERBS / BEE / PETALS" style)
    document.getElementById('kpi-four-tiles').innerHTML = `
      <div class="mini-tile mt-mint" data-tile-filter="READY" title="Hồ sơ sẵn sàng chào giá">
        <div class="mt-icon">🌿</div>
        <div class="mt-val">${s.ready_for_quote || 0}</div>
        <div class="mt-label">Sẵn sàng</div>
      </div>
      <div class="mini-tile mt-amber" data-tile-filter="CLARIFY" title="Hồ sơ thiếu thông tin cần hỏi KH">
        <div class="mt-icon">🌼</div>
        <div class="mt-val">${s.needs_clarification || 0}</div>
        <div class="mt-label">Hỏi thêm</div>
      </div>
      <div class="mini-tile mt-rose" data-tile-filter="ESCALATE" title="Hồ sơ cần chuyển duyệt vượt cấp">
        <div class="mt-icon">🌷</div>
        <div class="mt-val">${s.pending_escalation || 0}</div>
        <div class="mt-label">Chuyển duyệt</div>
      </div>
      <div class="mini-tile mt-lav" data-tile-filter="ALL" title="Số cấu hình giá rẻ sai chức năng đã bị AI chặn">
        <div class="mt-icon">🛡️</div>
        <div class="mt-val">${s.traps_prevented || 0}</div>
        <div class="mt-label">Chặn bẫy</div>
      </div>
    `;
    document.querySelectorAll('.mini-tile').forEach((tile) => {
      tile.addEventListener('click', () => setTriageFilter(tile.dataset.tileFilter));
    });

    // Update folder counts
    if (state.knowledge) {
      const sols = state.knowledge.catalog?.solutions?.length || 15;
      const wks = state.knowledge.capacity_schedule?.weekly_schedule?.length || 6;
      document.getElementById('folder-catalog-count').textContent = `+ ${sols} SKU chuẩn`;
      document.getElementById('folder-schedule-count').textContent = `+ ${wks} tuần theo dõi`;
    }

    // 3. Tall Right Metric Card (Phễu Sàng lọc AI)
    const total = Math.max(s.total || 0, 1);
    const completeCnt = state.cases.filter((c) => c.completeness_gate && c.completeness_gate.is_complete).length;
    const feasCnt = state.cases.filter((c) => c.feasibility && c.feasibility.overall_feasible).length;
    const readyCnt = s.ready_for_quote || 0;

    document.getElementById('tall-metric-card').innerHTML = `
      <div>
        <div class="card-head compact">
          <div>
            <h3>Phễu Lọc AI</h3>
            <span class="muted">Tổng Pipeline: <strong>${shortVnd(s.total_pipeline_vnd)}</strong></span>
          </div>
          <span style="font-size:20px;">✨</span>
        </div>
        <div class="funnel-pill" style="background:#fde6ed;color:#9e3152;" data-fjump="ALL">
          <span>1. Tiếp nhận RFP</span><span>${s.total || 0} hồ sơ</span>
        </div>
        <div class="funnel-pill" style="background:#fff6e2;color:#9c6513;" data-fjump="READY">
          <span>2. Đủ thông tin</span><span>${completeCnt}/${total}</span>
        </div>
        <div class="funnel-pill" style="background:#eaf6ed;color:#387d4f;" data-fjump="READY">
          <span>3. Đạt KT & Lịch</span><span>${feasCnt}/${total}</span>
        </div>
        <div class="funnel-pill" style="background:#f3eafd;color:#6d3ea3;" data-fjump="READY">
          <span>4. Sẵn sàng báo giá</span><span>${readyCnt}/${total}</span>
        </div>
      </div>
      <div style="margin-top:8px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--text-soft);">
        Đã xuất bản: <strong>${s.published || 0}</strong> bản chào giá chính thức
      </div>
    `;
    document.querySelectorAll('.funnel-pill').forEach((fp) => {
      fp.addEventListener('click', () => setTriageFilter(fp.dataset.fjump));
    });

    // 4. Area Chart & Capacity
    renderAreaChart();
    renderCapacityMini();

    // 5. Table
    renderCasesTable();
  }

  function renderAreaChart() {
    const container = document.getElementById('area-chart-container');
    const weeks = (state.knowledge && state.knowledge.capacity_schedule && state.knowledge.capacity_schedule.weekly_schedule) || [];
    const mode = state.areaChartMode;

    let points = [];
    if (mode === 'capacity' && weeks.length) {
      points = weeks.map((w) => ({
        label: w.week_id.replace('2026-', ''),
        val: w.utilization_pct,
        display: `${w.utilization_pct}% tải (${w.available_man_days} man-days trống)`
      }));
    } else {
      const sorted = state.cases.slice().reverse();
      points = sorted.map((c) => {
        const net = (c.pricing && c.pricing.net_before_vat_vnd) || 0;
        return {
          label: c.id.replace('RFP-2026-', '#'),
          val: Math.round(net / 1e6),
          display: `${c.extracted?.customer_name || c.id}: ${net ? vnd(net) : 'Chờ bổ sung'}`
        };
      });
    }

    if (points.length === 0) {
      container.innerHTML = '<div class="muted">Chưa có dữ liệu biểu đồ</div>';
      return;
    }

    const w = 540;
    const h = 190;
    const padX = 36;
    const padY = 24;
    const maxVal = Math.max(...points.map((p) => p.val), 10);
    const stepX = points.length > 1 ? (w - padX * 2) / (points.length - 1) : 0;

    const coords = points.map((p, i) => {
      const x = padX + i * stepX;
      const y = h - padY - ((p.val / maxVal) * (h - padY * 2));
      return { ...p, x, y };
    });

    const linePath = coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${h - padY} L ${coords[0].x.toFixed(1)} ${h - padY} Z`;
    const strokeCol = mode === 'capacity' ? '#8ec59c' : '#f285a3';
    const gradId = mode === 'capacity' ? 'mintGrad' : 'roseGrad';

    container.innerHTML = `
      <div class="chart-tooltip" id="area-tooltip"></div>
      <svg class="svg-chart" viewBox="0 0 ${w} ${h}">
        <defs>
          <linearGradient id="roseGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f7a7bc" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#f7a7bc" stop-opacity="0.02"/>
          </linearGradient>
          <linearGradient id="mintGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8ec59c" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#8ec59c" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        <line x1="${padX}" y1="${h - padY}" x2="${w - padX}" y2="${h - padY}" stroke="#ecdce1" stroke-width="1.5"/>
        <path d="${areaPath}" fill="url(#${gradId})" />
        <path d="${linePath}" fill="none" stroke="${strokeCol}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
        ${coords.map((pt, idx) => `
          <circle class="chart-point" data-pt-idx="${idx}" cx="${pt.x}" cy="${pt.y}" r="6" fill="#ffffff" stroke="${strokeCol}" stroke-width="3"/>
          <text x="${pt.x}" y="${h - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="#8d7e85">${esc(pt.label)}</text>
        `).join('')}
      </svg>
    `;

    const tooltip = document.getElementById('area-tooltip');
    container.querySelectorAll('.chart-point').forEach((dot) => {
      dot.addEventListener('mouseenter', () => {
        const pt = coords[Number(dot.dataset.ptIdx)];
        dot.setAttribute('r', '8.5');
        tooltip.textContent = pt.display;
        tooltip.style.left = `${(pt.x / w) * 100}%`;
        tooltip.style.top = `${(pt.y / h) * 100}%`;
        tooltip.classList.add('visible');
      });
      dot.addEventListener('mouseleave', () => {
        dot.setAttribute('r', '6');
        tooltip.classList.remove('visible');
      });
    });
  }

  function renderCapacityMini() {
    const weeks = (state.knowledge && state.knowledge.capacity_schedule && state.knowledge.capacity_schedule.weekly_schedule) || [];
    const el = document.getElementById('capacity-mini-container');
    el.innerHTML = weeks.slice(0, 5).map((w) => {
      const barCol = w.utilization_pct >= 90 ? '#eb6a8b' : (w.utilization_pct >= 80 ? '#f4b958' : '#8ec59c');
      return `
        <div class="cap-week-row">
          <div class="cap-week-head">
            <strong>${esc(w.week_id)}</strong>
            <span class="muted">${w.utilization_pct}% tải • Còn ${w.available_man_days} công</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${w.utilization_pct}%;background:${barCol};"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function setTriageFilter(filterKey) {
    state.triageFilter = filterKey;
    document.querySelectorAll('#triage-filters .pnum').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === filterKey);
    });
    const labels = {
      ALL: 'Đang hiện: Tất cả hồ sơ',
      READY: 'Đang lọc: Sẵn sàng chào giá / Đã xuất bản',
      CLARIFY: 'Đang lọc: Cần KH bổ sung thông tin',
      ESCALATE: 'Đang lọc: Chờ chuyển duyệt vượt cấp'
    };
    const lbl = document.getElementById('table-filter-label');
    if (lbl) lbl.textContent = labels[filterKey] || labels.ALL;
    renderCasesTable();
  }

  function renderCasesTable() {
    const filtered = state.cases.filter((c) => {
      if (state.triageFilter === 'ALL') return true;
      if (state.triageFilter === 'READY') return c.status === 'READY_FOR_HITL_REVIEW' || c.status === 'PUBLISHED';
      if (state.triageFilter === 'CLARIFY') return c.status === 'NEEDS_CLARIFICATION';
      if (state.triageFilter === 'ESCALATE') return c.status === 'PENDING_ESCALATION' || c.status === 'REVISION_REQUESTED';
      return true;
    });

    const tbody = document.getElementById('cases-tbody');
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px;">Không có hồ sơ nào trong nhóm lọc này.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((c) => {
      const comp = c.completeness_gate || {};
      const pricing = c.pricing || {};
      const feas = c.feasibility || {};
      const traps = (feas.rejected_low_price_traps || []).length;
      const budget = c.extracted && c.extracted.budget ? c.extracted.budget.amount_vnd : null;

      let riskSummary = '';
      if (c.status === 'NEEDS_CLARIFICATION') {
        riskSummary = `<span class="badge badge-amber">Thiếu ${comp.blocking_count || 0} thông tin</span>`;
      } else {
        const parts = [];
        if (traps > 0) parts.push(`<span class="badge badge-purple">🛡 Chặn ${traps} gói giá thấp</span>`);
        if (feas.has_out_of_catalog) parts.push('<span class="badge badge-red">Ngoài danh mục</span>');
        if (feas.schedule_check && !feas.schedule_check.feasible) parts.push('<span class="badge badge-red">Xung đột lịch</span>');
        riskSummary = parts.length ? parts.join(' ') : '<span class="badge badge-green">Đạt KT & Lịch</span>';
      }

      return `
        <tr data-row-case="${esc(c.id)}">
          <td>
            <div class="mono" style="font-weight:800;">${esc(c.id)}</div>
            <div class="muted">${esc(c.received_date)}</div>
          </td>
          <td>
            <div style="font-weight:800;">${esc(c.extracted ? c.extracted.customer_name : '')}</div>
            <div style="font-size:12px;color:var(--text-soft);">${esc(c.title)}</div>
          </td>
          <td>
            <div style="font-weight:800;">${comp.completeness_score || 0}/100</div>
            <div class="progress-track" style="width:76px;height:6px;margin-top:4px;">
              <div class="progress-fill" style="width:${comp.completeness_score || 0}%;background:${comp.is_complete ? '#8ec59c' : '#f285a3'};"></div>
            </div>
          </td>
          <td>
            <div style="font-weight:800;">${pricing.net_before_vat_vnd ? vnd(pricing.net_before_vat_vnd) : 'Chờ bổ sung'}</div>
            <div class="muted">NS: ${budget ? shortVnd(budget) : 'Chưa nêu'}</div>
          </td>
          <td>${riskSummary}</td>
          <td>${statusBadge(c.status)}</td>
          <td class="text-right">
            <button class="btn btn-soft-pink btn-sm" data-open-case="${esc(c.id)}">Mở AI →</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-row-case]').forEach((row) => {
      row.addEventListener('click', () => openCaseInWorkbench(row.dataset.rowCase));
    });
  }

  // ==================== RIGHT SIDEBAR (FLOWER SHOP QUEUE + AI CHAT) ====================
  function renderRightSidebar() {
    const queueEl = document.getElementById('right-rfp-queue');
    if (!queueEl) return;

    const icons = {
      READY_FOR_HITL_REVIEW: '🌸',
      PUBLISHED: '✅',
      NEEDS_CLARIFICATION: '🌼',
      PENDING_ESCALATION: '👑',
      REVISION_REQUESTED: '✏️'
    };

    queueEl.innerHTML = state.cases.slice(0, 5).map((c) => {
      const isSelected = c.id === state.selectedCaseId;
      const cust = (c.extracted && c.extracted.customer_name) || c.id;
      const icon = icons[c.status] || '📄';
      return `
        <button class="shop-pill ${isSelected ? 'active-item' : ''}" data-queue-case="${esc(c.id)}">
          <div class="sp-icon">${icon}</div>
          <div style="min-width:0;">
            <div class="sp-title">${esc(c.id.replace('RFP-2026-', 'RFP #'))}</div>
            <div class="sp-sub">${esc(cust)}</div>
          </div>
        </button>
      `;
    }).join('');

    queueEl.querySelectorAll('[data-queue-case]').forEach((btn) => {
      btn.addEventListener('click', () => openCaseInWorkbench(btn.dataset.queueCase));
    });

    // Mini Copilot quick chips
    const chipsEl = document.getElementById('mini-copilot-chips');
    if (chipsEl) {
      chipsEl.innerHTML = state.quickPrompts.slice(0, 2).map((q) => `<button class="amc-chip" data-mini-q="${esc(q)}">${esc(q)}</button>`).join('');
      chipsEl.querySelectorAll('[data-mini-q]').forEach((btn) => {
        btn.addEventListener('click', () => askCopilot(btn.dataset.miniQ, false));
      });
    }
  }

  // ==================== AI COPILOT (MINI + EXPANDED DRAWER) ====================
  function openCopilotDrawer() {
    const drawer = document.getElementById('copilot-drawer');
    drawer.classList.add('open');
    renderCopilotDrawer();
  }

  function closeCopilotDrawer() {
    document.getElementById('copilot-drawer').classList.remove('open');
  }

  function renderCopilotDrawer() {
    const ctxEl = document.getElementById('copilot-context-label');
    if (ctxEl) {
      ctxEl.textContent = state.selectedCaseId ? `Đang tập trung: ${state.selectedCaseId}` : 'Kết nối dữ liệu thời gian thực';
    }
    const msgsEl = document.getElementById('copilot-messages');
    if (msgsEl) {
      msgsEl.innerHTML = state.copilotMessages.map((m) => `
        <div class="cp-msg ${m.role}">
          <div>${esc(m.text)}</div>
          ${m.caseId ? `<button class="cp-jump-btn" data-jump-case="${esc(m.caseId)}" data-jump-tab="${esc(m.tab || '')}">Mở ${esc(m.caseId)} trong Workbench →</button>` : ''}
        </div>
      `).join('');
      msgsEl.scrollTop = msgsEl.scrollHeight;
      msgsEl.querySelectorAll('[data-jump-case]').forEach((btn) => {
        btn.addEventListener('click', () => {
          openCaseInWorkbench(btn.dataset.jumpCase, btn.dataset.jumpTab || null);
          closeCopilotDrawer();
        });
      });
    }

    const promptsEl = document.getElementById('copilot-prompts');
    if (promptsEl) {
      promptsEl.innerHTML = state.quickPrompts.map((q) => `<button class="cp-prompt-chip" data-cp-q="${esc(q)}">${esc(q)}</button>`).join('');
      promptsEl.querySelectorAll('[data-cp-q]').forEach((btn) => {
        btn.addEventListener('click', () => askCopilot(btn.dataset.cpQ, true));
      });
    }
  }

  async function askCopilot(message, openDrawerAfter = true) {
    if (!message.trim()) return;
    state.copilotMessages.push({ role: 'user', text: message });
    if (openDrawerAfter) openCopilotDrawer();
    else renderCopilotDrawer();

    const previewEl = document.getElementById('mini-copilot-preview');
    if (previewEl) previewEl.textContent = 'AI Agent đang phân tích dữ liệu... ✨';

    try {
      const res = await api('/api/agent/chat', {
        method: 'POST',
        body: JSON.stringify({ message, case_id: state.selectedCaseId })
      });
      state.copilotMessages.push({
        role: 'bot',
        text: res.answer,
        caseId: res.suggested_case_id,
        tab: res.suggested_tab
      });
      if (res.quick_prompts) state.quickPrompts = res.quick_prompts;
      if (previewEl) previewEl.textContent = res.answer;
      renderCopilotDrawer();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ==================== WORKBENCH ====================
  function renderWorkbench() {
    const sel = document.getElementById('wb-case-select');
    sel.innerHTML = state.cases.map((c) => `<option value="${esc(c.id)}" ${c.id === state.selectedCaseId ? 'selected' : ''}>${esc(c.id)} — ${esc(c.title)}</option>`).join('');

    const c = state.cases.find((x) => x.id === state.selectedCaseId) || state.cases[0];
    if (!c) {
      document.getElementById('wb-tab-content').innerHTML = '<div class="bento-card">Chưa có hồ sơ nào.</div>';
      return;
    }
    state.selectedCaseId = c.id;
    document.getElementById('wb-status-badge').outerHTML = `<span id="wb-status-badge">${statusBadge(c.status)}</span>`;

    document.querySelectorAll('#wb-subtabs .sub-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === state.activeWbTab);
    });

    renderDecisionStrip(c);
    renderLiveFlowchart(c);
    renderWbTabContent(c);
  }

  function renderDecisionStrip(c) {
    const strip = document.getElementById('wb-decision-strip');
    const comp = c.completeness_gate || {};
    const auth = (c.pricing && c.pricing.authority_gate) || {};

    let cls = 'ds-green';
    let title = '✅ Đủ điều kiện chuẩn bị chào giá';
    let desc = 'Hồ sơ đã qua kiểm tra kỹ thuật, lịch triển khai và thẩm quyền. Mời 3 phòng ban thẩm định cuối để xuất bản.';
    let ctaLabel = 'Đến bước Duyệt cuối →';
    let ctaTab = 'proposal';

    if (c.status === 'NEEDS_CLARIFICATION') {
      cls = 'ds-amber';
      title = `🟡 Dừng lại: Thiếu ${comp.blocking_count || 0} thông tin bắt buộc`;
      desc = 'Không lập giá khi còn thông số mơ hồ. Hãy gửi phiếu hỏi khách hàng rồi nhập phản hồi để AI Agent chạy lại.';
      ctaLabel = 'Mở phiếu hỏi Khách hàng →';
      ctaTab = 'extract';
    } else if (c.status === 'PENDING_ESCALATION') {
      cls = 'ds-red';
      title = `🟠 Cần chuyển duyệt: ${auth.highest_authority_level || 'Trưởng phòng / Ban Giám đốc'}`;
      desc = (auth.triggers || []).map((t) => t.reason).join(' | ');
      ctaLabel = 'Mở cổng Phê duyệt vượt cấp →';
      ctaTab = 'pricing';
    } else if (c.status === 'PUBLISHED') {
      cls = 'ds-green';
      title = '🎉 Đã xuất bản Chào giá chính thức';
      desc = 'Hồ sơ đã được 3 bộ phận xác nhận ranh giới dữ liệu và sẵn sàng gửi khách hàng.';
      ctaLabel = 'Xem lại Bản Chào giá →';
      ctaTab = 'proposal';
    }

    strip.innerHTML = `
      <div class="decision-strip ${cls}">
        <div>
          <strong style="font-size:15px;">${esc(title)}</strong>
          <div style="font-size:13px;margin-top:2px;">${esc(desc)}</div>
        </div>
        <button class="btn btn-white-pill btn-sm" id="btn-ds-jump">${esc(ctaLabel)}</button>
      </div>
    `;
    document.getElementById('btn-ds-jump').onclick = () => {
      state.activeWbTab = ctaTab;
      renderWorkbench();
    };
  }

  function renderLiveFlowchart(c) {
    const comp = c.completeness_gate || {};
    const auth = (c.pricing && c.pricing.authority_gate) || {};
    const hitl = c.hitl || {};
    const signoffs = hitl.dept_signoffs || {};
    const allSigned = signoffs.sales && signoffs.sales.approved && signoffs.technical && signoffs.technical.approved && signoffs.operations && signoffs.operations.approved;

    const n3 = comp.is_complete ? 'done' : 'blocked';
    const n4 = !comp.is_complete ? '' : (c.feasibility && c.feasibility.overall_feasible ? 'done' : 'escalated');
    const n5 = !comp.is_complete ? '' : 'done';
    const n6 = !comp.is_complete ? '' : (auth.needs_escalation ? (hitl.escalation_approved ? 'done' : 'escalated') : 'done');
    const n7 = !comp.is_complete ? '' : 'done';
    const n8 = !comp.is_complete ? '' : (c.status === 'PUBLISHED' ? 'done' : (c.status === 'REVISION_REQUESTED' ? 'blocked' : (allSigned ? 'done' : 'active')));
    const n9 = c.status === 'PUBLISHED' ? 'done' : '';

    document.getElementById('live-flowchart').innerHTML = `
      <div class="flow-row">
        <div class="flow-node done" data-flow-tab="extract"><div class="fn-tag">Bắt đầu</div><div class="fn-title">Tiếp nhận RFP</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-node done" data-flow-tab="extract"><div class="fn-tag">AI Agent</div><div class="fn-title">Trích xuất</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-node ${n3}" data-flow-tab="extract"><div class="fn-tag">Cổng 1</div><div class="fn-title">Đủ TT? (${comp.is_complete ? 'Có' : 'Không'})</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-node ${n4}" data-flow-tab="feasibility"><div class="fn-tag">AI + KT/VH</div><div class="fn-title">Giải pháp & Lịch</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-node ${n5}" data-flow-tab="pricing"><div class="fn-tag">AI Agent</div><div class="fn-title">Giá & Chiết khấu</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-node ${n6}" data-flow-tab="pricing"><div class="fn-tag">Cổng 2</div><div class="fn-title">Vượt quyền? (${auth.needs_escalation ? 'Có' : 'Không'})</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-node ${n7}" data-flow-tab="proposal"><div class="fn-tag">Hợp nhất</div><div class="fn-title">Hồ sơ & Ma trận</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-node ${n8}" data-flow-tab="proposal"><div class="fn-tag">HITL Cuối</div><div class="fn-title">KD + KT + VH</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-node ${n9}" data-flow-tab="proposal"><div class="fn-tag">Kết thúc</div><div class="fn-title">Xuất bản</div></div>
      </div>
      <div class="flow-branches">
        <div class="flow-branch-box ${!comp.is_complete ? 'blocked' : 'ok'}">
          <span>Nhánh thiếu thông tin: <strong>KD liên hệ KH bổ sung</strong></span>
          <span>${!comp.is_complete ? '🔴 Đang chờ KH' : '✅ Đã đủ'}</span>
        </div>
        <div class="flow-branch-box ${auth.needs_escalation ? (hitl.escalation_approved ? 'ok' : 'triggered') : 'ok'}">
          <span>Nhánh vượt cấp: <strong>Trưởng phòng / BGĐ duyệt</strong></span>
          <span>${!comp.is_complete ? '⏳ Chờ' : (auth.needs_escalation ? (hitl.escalation_approved ? '✅ Đã duyệt' : '🟠 Chờ duyệt') : '⚪ Không cần')}</span>
        </div>
        <div class="flow-branch-box ${c.status === 'REVISION_REQUESTED' ? 'blocked' : (c.status === 'PUBLISHED' ? 'ok' : '')}">
          <span>Vòng HITL: <strong>Cần chỉnh sửa ↺ / Đạt ✓</strong></span>
          <span>${c.status === 'REVISION_REQUESTED' ? '🟣 Cần sửa' : (c.status === 'PUBLISHED' ? '✅ Đạt' : '🌸 Đang thẩm định')}</span>
        </div>
      </div>
    `;

    document.querySelectorAll('[data-flow-tab]').forEach((node) => {
      node.addEventListener('click', () => {
        state.activeWbTab = node.dataset.flowTab;
        renderWorkbench();
      });
    });
  }

  function renderWbTabContent(c) {
    const container = document.getElementById('wb-tab-content');
    if (state.activeWbTab === 'extract') container.innerHTML = renderTabExtract(c);
    else if (state.activeWbTab === 'feasibility') container.innerHTML = renderTabFeasibility(c);
    else if (state.activeWbTab === 'pricing') container.innerHTML = renderTabPricing(c);
    else if (state.activeWbTab === 'proposal') container.innerHTML = renderTabProposal(c);
    else if (state.activeWbTab === 'trace') container.innerHTML = renderTabTrace(c);
    bindTabActions(c);
  }

  function renderTabExtract(c) {
    const ext = c.extracted || {};
    const comp = c.completeness_gate || {};
    const items = ext.items || [];
    const conds = ext.mandatory_conditions || [];
    const missing = comp.missing_fields || [];

    const gateCallout = comp.is_complete
      ? `<div class="callout callout-success"><h4>✅ Cổng kiểm tra thông tin: ĐỦ DỮ LIỆU (${comp.completeness_score}/100 điểm)</h4><div>Đủ hạng mục, số lượng, thông số và deadline để đối chiếu kỹ thuật & tính giá.</div></div>`
      : `<div class="callout callout-danger"><h4>⛔ Cổng kiểm tra thông tin: KHÔNG ĐỦ THÔNG TIN (${comp.completeness_score}/100 điểm)</h4><div>AI Agent đã tạm dừng để tránh chào sai cấu hình. Kinh doanh cần gửi câu hỏi xác minh dưới đây cho Khách hàng.</div></div>`;

    const missingHtml = missing.length === 0 ? '' : `
      <div class="bento-card">
        <h3>Danh sách thông tin thiếu cần xác minh (${missing.length})</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Mức độ</th><th>Thông tin thiếu</th><th>Lý do rủi ro</th><th>Câu hỏi gửi Khách hàng</th></tr></thead>
            <tbody>
              ${missing.map((m) => `
                <tr>
                  <td><span class="badge ${m.severity === 'BLOCKING' ? 'badge-red' : 'badge-amber'}">${esc(m.severity)}</span></td>
                  <td><strong>${esc(m.field)}</strong></td>
                  <td>${esc(m.reason)}</td>
                  <td>${esc(m.question_for_customer)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${comp.clarification_email_draft ? `
          <div style="margin-top:14px;">
            <label style="font-weight:700;display:block;margin-bottom:6px;">📧 Email yêu cầu KH bổ sung do AI soạn sẵn:</label>
            <div class="raw-text-box">${esc(comp.clarification_email_draft)}</div>
          </div>
        ` : ''}
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
          <h4>🔄 Nhập phản hồi bổ sung từ Khách hàng (Chạy lại AI Agent)</h4>
          <div class="form-group">
            <textarea id="clarify-reply-input" rows="4" placeholder="Dán thông tin KH vừa xác nhận bổ sung..."></textarea>
          </div>
          <div class="form-actions">
            <button class="btn btn-pink-pill" id="btn-submit-clarify">📩 Cập nhật bổ sung & Chạy lại</button>
            <button class="btn btn-soft-pink btn-sm" id="btn-fill-sample-clarify">✨ Điền thử phản hồi mẫu</button>
          </div>
        </div>
      </div>
    `;

    return `
      ${gateCallout}
      ${missingHtml}
      <div class="grid-2">
        <div class="bento-card">
          <h3>📄 Tài liệu RFP/RFQ gốc</h3>
          <div class="raw-text-box">${esc(c.raw_text)}</div>
          ${(c.clarifications || []).length ? `
            <h4 style="margin-top:12px;">Bổ sung từ Khách hàng:</h4>
            ${c.clarifications.map((cl, i) => `<div class="callout callout-info"><strong>Lần ${i + 1}:</strong><br/>${esc(cl.customer_reply)}</div>`).join('')}
          ` : ''}
        </div>
        <div class="bento-card">
          <h3>🧠 Dữ liệu AI Agent đã trích xuất</h3>
          <div class="grid-2" style="gap:10px;margin-bottom:12px;">
            <div class="callout callout-info" style="margin:0;"><strong>Khách hàng:</strong><br/>${esc(ext.customer_name || '—')}<br/><span class="muted">${esc(ext.location || '')}</span></div>
            <div class="callout callout-info" style="margin:0;"><strong>Deadline & Ngân sách:</strong><br/>⏱ ${esc(ext.deadline?.raw_text || 'Chưa nêu')}<br/>💰 ${ext.budget?.amount_vnd ? vnd(ext.budget.amount_vnd) : 'Chưa nêu'}</div>
          </div>
          <h4>Hạng mục bóc tách (${items.length})</h4>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Mã</th><th>Hạng mục</th><th>SL</th><th>Trích đoạn</th></tr></thead>
              <tbody>
                ${items.map((it) => `
                  <tr>
                    <td class="mono">${esc(it.item_id)}</td>
                    <td><strong>${esc(it.name)}</strong><br/><span class="badge badge-gray">${esc(it.category)}</span></td>
                    <td>${it.quantity !== null && it.quantity !== undefined ? `<strong>${it.quantity}</strong>` : '<span class="badge badge-red">Thiếu SL</span>'}</td>
                    <td class="muted">${esc(it.source_excerpt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <h4 style="margin-top:14px;">Điều kiện bắt buộc (${conds.length})</h4>
          <ul>${conds.length ? conds.map((cd) => `<li><strong>[${esc(cd.code)}]</strong> ${esc(cd.label)}</li>`).join('') : '<li class="muted">Không có điều kiện đặc biệt</li>'}</ul>
        </div>
      </div>
    `;
  }

  function renderTabFeasibility(c) {
    if (!c.feasibility) {
      return '<div class="callout callout-warning"><h4>⏳ Chưa thể đối chiếu giải pháp</h4>Hồ sơ đang chờ Khách hàng bổ sung thông tin ở Tab 1.</div>';
    }
    const f = c.feasibility;
    const traps = f.rejected_low_price_traps || [];
    const sched = f.schedule_check || {};
    const weeks = (state.knowledge && state.knowledge.capacity_schedule && state.knowledge.capacity_schedule.weekly_schedule) || [];

    return `
      ${traps.length ? `
        <div class="callout callout-danger">
          <h4>🛡️ AI đã tự động CHẶN ${traps.length} gói giá thấp KHÔNG ĐỦ CHỨC NĂNG</h4>
          <ul style="margin:6px 0 0 18px;">
            ${traps.map((t) => `<li>Hạng mục <strong>${esc(t.requested_item)}</strong>: Loại <span class="mono">${esc(t.rejected_sku)}</span> (${vnd(t.rejected_unit_price_vnd)}) vì: <strong>${esc((t.failed_reasons || []).join('; '))}</strong>.</li>`).join('')}
          </ul>
        </div>
      ` : '<div class="callout callout-success"><h4>✅ Không có xung đột bẫy giá thấp</h4></div>'}

      <div class="bento-card">
        <h3>🔧 Đối chiếu Danh mục Giải pháp & Đặc tính</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Yêu cầu RFP</th><th>Giải pháp Thiên Minh đề xuất</th><th>SL</th><th class="text-right">Đơn giá</th><th>Lead-time</th><th>Kiểm tra bắt buộc</th></tr></thead>
            <tbody>
              ${(f.matched_items || []).map((m) => `
                <tr>
                  <td><strong>${esc(m.requested_name)}</strong></td>
                  <td><span class="mono" style="font-weight:800;">${esc(m.selected_sku)}</span> — ${esc(m.selected_name)}<div class="muted">${esc(m.vendor)}</div></td>
                  <td><strong>${m.quantity}</strong> ${esc(m.unit)}</td>
                  <td class="text-right">${vnd(m.unit_price_vnd)}</td>
                  <td>${m.lead_time_days} ngày</td>
                  <td>${m.status === 'OUT_OF_CATALOG' ? `<span class="badge badge-red">Ngoài danh mục</span>` : `<span class="badge badge-green">Đạt 100%</span>`} <div class="muted">${esc(m.compliance_notes)}</div></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="bento-card">
          <h3>📅 Kiểm tra Năng lực & Lịch triển khai</h3>
          <div class="callout ${sched.feasible ? 'callout-success' : 'callout-danger'}">
            <strong>${sched.feasible ? '✅ LỊCH TRIỂN KHAI KHẢ THI' : '🚨 XUNG ĐỘT LỊCH TRIỂN KHAI'}</strong>
            <p style="margin:6px 0 0;">${esc(sched.recommendation)}</p>
          </div>
          <ul>
            <li>Thời hạn KH yêu cầu: <strong>${sched.requested_days} ngày</strong> (Tối thiểu cần: <strong>${sched.required_min_days} ngày</strong>)</li>
            <li>Lead-time thiết bị: <strong>${sched.max_hardware_lead_days} ngày</strong> • Công: <strong>${sched.estimated_man_days} man-days</strong></li>
            <li>Chứng chỉ: <strong>${esc(f.certification_check?.note)}</strong></li>
          </ul>
        </div>
        <div class="bento-card">
          <h3>🗓 Bảng tải công việc các tuần</h3>
          ${weeks.map((w) => {
            const col = w.utilization_pct >= 90 ? '#eb6a8b' : (w.utilization_pct >= 80 ? '#f4b958' : '#8ec59c');
            return `
              <div class="cap-week-row">
                <div class="cap-week-head"><strong>${esc(w.label)}</strong><span>${w.utilization_pct}% (${esc(w.status)})</span></div>
                <div class="progress-track"><div class="progress-fill" style="width:${w.utilization_pct}%;background:${col};"></div></div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderTabPricing(c) {
    if (!c.pricing) {
      return '<div class="callout callout-warning"><h4>⏳ Chưa có bảng tính giá</h4>Cần hoàn thành bổ sung thông tin ở Tab 1 trước.</div>';
    }
    const p = c.pricing;
    const auth = p.authority_gate || {};
    const hitl = c.hitl || {};

    return `
      <div class="grid-2">
        <div class="bento-card">
          <h3>💰 Bảng tính Giá đề xuất & Chiết khấu</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>SKU & Hạng mục</th><th>SL</th><th class="text-right">Đơn giá</th><th class="text-right">Thành tiền</th></tr></thead>
              <tbody>
                ${(p.line_items || []).map((l) => `
                  <tr>
                    <td><span class="mono">${esc(l.sku)}</span><br/>${esc(l.name)}</td>
                    <td>${l.quantity}</td>
                    <td class="text-right">${vnd(l.unit_price_vnd)}</td>
                    <td class="text-right"><strong>${vnd(l.line_list_total_vnd)}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr><td colspan="3" class="text-right">Tổng niêm yết:</td><td class="text-right"><strong>${vnd(p.list_subtotal_vnd)}</strong></td></tr>
                <tr><td colspan="3" class="text-right">Chiết khấu (${p.proposed_discount_pct}%):</td><td class="text-right" style="color:var(--rose-500);">-${vnd(p.discount_amount_vnd)}</td></tr>
                <tr><td colspan="3" class="text-right"><strong>Tổng trước VAT:</strong></td><td class="text-right"><strong style="font-size:15px;color:var(--rose-500);">${vnd(p.net_before_vat_vnd)}</strong></td></tr>
                <tr><td colspan="3" class="text-right">VAT (${p.vat_rate_pct}%):</td><td class="text-right">${vnd(p.vat_amount_vnd)}</td></tr>
                <tr><td colspan="3" class="text-right"><strong>Tổng thanh toán:</strong></td><td class="text-right"><strong>${vnd(p.grand_total_vnd)}</strong></td></tr>
              </tfoot>
            </table>
          </div>
          <div class="callout callout-info" style="margin-top:12px;">
            <div><strong>Diễn giải:</strong> ${esc(p.discount_reason)}</div>
            <div style="margin-top:4px;"><strong>Biên LN gộp:</strong> ${p.gross_margin_pct}% • <strong>Ngân sách KH:</strong> ${p.customer_budget_vnd ? vnd(p.customer_budget_vnd) : 'Chưa nêu'}</div>
          </div>
        </div>

        <div class="bento-card">
          <h3>⚖️ Cổng Thẩm quyền & Chuyển duyệt (HITL)</h3>
          ${!auth.needs_escalation ? `
            <div class="callout callout-success"><h4>✅ TRONG THẨM QUYỀN CHUẨN</h4>Không cần xin duyệt vượt cấp.</div>
          ` : `
            <div class="callout ${hitl.escalation_approved ? 'callout-success' : 'callout-warning'}">
              <h4>${hitl.escalation_approved ? '✅ ĐÃ DUYỆT VƯỢT CẤP' : `⚠️ CẦN CHUYỂN DUYỆT: ${esc(auth.highest_authority_level)}`}</h4>
              <ul style="margin:6px 0 0 18px;">
                ${(auth.triggers || []).map((t) => `<li><strong>[${esc(t.code)}]</strong> ${esc(t.reason)}</li>`).join('')}
              </ul>
            </div>
          `}
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
            <h4>👤 Xử lý của Trưởng phòng / Ban Giám đốc</h4>
            <div class="form-row">
              <div class="form-group"><label>Người phê duyệt</label><input type="text" id="esc-approver-name" value="Trần Minh Quân" /></div>
              <div class="form-group">
                <label>Thẩm quyền</label>
                <select id="esc-approver-role">
                  <option value="Trưởng phòng Kinh doanh">Trưởng phòng Kinh doanh</option>
                  <option value="Trưởng phòng Kỹ thuật">Trưởng phòng Kỹ thuật</option>
                  <option value="Trưởng phòng Vận hành">Trưởng phòng Vận hành</option>
                  <option value="Ban Giám đốc" ${auth.highest_authority_level === 'Ban Giám đốc' ? 'selected' : ''}>Ban Giám đốc</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Điều chỉnh % CK</label><input type="number" step="0.5" id="esc-adjust-discount" value="${p.proposed_discount_pct}" /></div>
              <div class="form-group"><label>Ghi chú</label><input type="text" id="esc-comment" value="Đồng ý phương án đề xuất." /></div>
            </div>
            <div class="form-actions">
              <button class="btn btn-success" id="btn-esc-approve">✅ Phê duyệt vượt cấp</button>
              <button class="btn btn-danger-outline" id="btn-esc-reject">↩ Trả lại chỉnh sửa</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderTabProposal(c) {
    if (!c.deliverables) {
      return '<div class="callout callout-warning"><h4>⏳ Chưa tạo hồ sơ đề xuất</h4>Cần bổ sung thông tin ở Tab 1 trước.</div>';
    }
    const del = c.deliverables;
    const matrix = del.compliance_matrix || [];
    const bounds = del.data_boundary_checks || [];
    const prop = del.proposal_summary || {};
    const hitl = c.hitl || {};
    const signoffs = hitl.dept_signoffs || {};
    const allSigned = signoffs.sales?.approved && signoffs.technical?.approved && signoffs.operations?.approved;

    return `
      <div class="bento-card">
        <div class="card-head">
          <div>
            <h3>🛡️ Thẩm định & Ranh giới dữ liệu (HITL: KD + Kỹ thuật + Vận hành duyệt cuối)</h3>
            <span class="muted">Đủ 3 phòng ban xác nhận & hoàn tất duyệt vượt cấp để Xuất bản chào giá</span>
          </div>
          <div class="wb-actions">
            <button class="btn btn-soft-pink" id="btn-preview-quote">📄 Xem & Xuất bản</button>
            <button class="btn btn-success" id="btn-publish-quote" ${c.status === 'PUBLISHED' || !allSigned || !hitl.escalation_approved ? 'disabled' : ''}>🚀 Xuất bản & Gửi KH</button>
          </div>
        </div>
        ${!hitl.escalation_approved ? '<div class="callout callout-warning">⚠️ Cần được <strong>Trưởng phòng / Ban Giám đốc duyệt vượt cấp</strong> ở Tab 3 trước khi xuất bản.</div>' : ''}
        <div class="grid-3" style="margin-bottom:14px;">
          ${bounds.map((b) => `
            <div class="callout ${b.status === 'PASS' ? 'callout-success' : 'callout-warning'}" style="margin:0;">
              <h4>${b.status === 'PASS' ? '✅' : '⚠️'} ${esc(b.department)}</h4>
              <ul style="margin:6px 0 0 16px;padding:0;">${(b.checks || []).map((chk) => `<li>${esc(chk)}</li>`).join('')}</ul>
            </div>
          `).join('')}
        </div>
        <div class="grid-3">
          ${renderSignoffCard('sales', 'Phòng Kinh doanh', signoffs.sales, 'Nguyễn Minh Tuấn')}
          ${renderSignoffCard('technical', 'Bộ phận Kỹ thuật', signoffs.technical, 'Lê Anh Dũng (CCIE)')}
          ${renderSignoffCard('operations', 'Bộ phận Vận hành', signoffs.operations, 'Phạm Thanh Hải')}
        </div>
        <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="hitl-revision-note" style="flex:1;min-width:240px;padding:9px 14px;border:1px solid var(--border);border-radius:999px;" placeholder="Ghi chú nếu cần chỉnh sửa..." />
          <button class="btn btn-danger-outline" id="btn-hitl-revision">↺ Cần chỉnh sửa</button>
        </div>
      </div>

      <div class="grid-2">
        <div class="bento-card">
          <h3>📋 Ma trận Đáp ứng (Compliance Matrix)</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Yêu cầu</th><th>Đáp ứng của Thiên Minh</th><th>Trạng thái</th></tr></thead>
              <tbody>
                ${matrix.map((r) => `
                  <tr>
                    <td><strong>${esc(r.requirement)}</strong></td>
                    <td>${esc(r.proposed_solution)}<div class="muted">${esc(r.evidence)}</div></td>
                    <td><span class="badge ${r.status === 'COMPLIANT' ? 'badge-green' : (r.status === 'CONFLICT' || r.status === 'OUT_OF_CATALOG' ? 'badge-red' : 'badge-amber')}">${esc(r.status_label)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="bento-card">
          <h3>📑 Tóm tắt Hồ sơ Đề xuất (${esc(prop.proposal_code)})</h3>
          <p>${esc(prop.executive_overview)}</p>
          <ul>${(prop.implementation_plan || []).map((st) => `<li><strong>${esc(st.phase)}:</strong> ${esc(st.activity)}</li>`).join('')}</ul>
        </div>
      </div>
    `;
  }

  function renderSignoffCard(deptKey, title, data, defaultName) {
    const approved = data && data.approved;
    return `
      <div class="signoff-card ${approved ? 'approved' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong>${esc(title)}</strong>
          <span class="badge ${approved ? 'badge-green' : 'badge-gray'}">${approved ? '✅ Đã duyệt' : '⏳ Chờ'}</span>
        </div>
        ${approved
          ? `<div class="muted">Người duyệt: <strong>${esc(data.by)}</strong></div>`
          : `<div class="form-group" style="margin-bottom:8px;"><input type="text" id="signoff-name-${deptKey}" value="${esc(defaultName)}" /></div>
             <button class="btn btn-pink-pill btn-sm" data-signoff-dept="${deptKey}" style="width:100%;">✔ Xác nhận ${esc(title)}</button>`
        }
      </div>
    `;
  }

  function renderTabTrace(c) {
    const trace = c.workflow_trace || [];
    const logs = c.audit_log || [];
    return `
      <div class="grid-2">
        <div class="bento-card">
          <h3>⚡ Vết thực thi AI Agent</h3>
          <table class="data-table">
            <thead><tr><th>Bước</th><th>Trạng thái</th><th>Tóm tắt</th></tr></thead>
            <tbody>
              ${trace.map((t) => `<tr><td><strong>${esc(t.label)}</strong></td><td><span class="badge badge-pink">${esc(t.status)}</span></td><td>${esc(t.summary)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="bento-card">
          <h3>📜 Nhật ký Kiểm toán</h3>
          <table class="data-table">
            <thead><tr><th>Sự kiện</th><th>Chi tiết</th></tr></thead>
            <tbody>
              ${logs.slice().reverse().map((l) => `<tr><td><span class="badge badge-green">${esc(l.type)}</span></td><td>${esc(l.message)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function bindTabActions(c) {
    const btnClarify = document.getElementById('btn-submit-clarify');
    if (btnClarify) {
      btnClarify.addEventListener('click', async () => {
        const reply = document.getElementById('clarify-reply-input').value.trim();
        if (!reply) return toast('Vui lòng nhập phản hồi bổ sung của khách hàng', 'error');
        try {
          const res = await api(`/api/cases/${encodeURIComponent(c.id)}/clarify`, {
            method: 'POST',
            body: JSON.stringify({ customer_reply: reply, actor: c.sales_owner })
          });
          toast('Đã cập nhật phản hồi & chạy lại AI Agent!', 'success');
          await syncUpdatedCase(res);
        } catch (e) { toast(e.message, 'error'); }
      });
    }

    const btnFillClarify = document.getElementById('btn-fill-sample-clarify');
    if (btnFillClarify) {
      btnFillClarify.addEventListener('click', () => {
        document.getElementById('clarify-reply-input').value =
          'Xác nhận bổ sung từ Phòng IT Bệnh viện Tâm An:\n' +
          '- 04 Switch Access 24 port PoE+ 370W (có uplink 10G SFP+).\n' +
          '- 08 Access Point Wi-Fi 6 doanh nghiệp (chịu tải >= 200 user/AP) và 01 Wireless Controller.\n' +
          '- 01 Firewall NGFW IPS >= 5 Gbps.\n' +
          '- Dịch vụ khảo sát, lắp đặt & gói bảo trì 24x7 SLA 4 giờ (12 tháng).\n' +
          '- Thời hạn triển khai: trong vòng 5 tuần (trước ngày 18/12/2026). Có CO/CQ.';
      });
    }

    const btnEscApp = document.getElementById('btn-esc-approve');
    if (btnEscApp) btnEscApp.addEventListener('click', () => handleEscalation(c.id, 'APPROVE'));
    const btnEscRej = document.getElementById('btn-esc-reject');
    if (btnEscRej) btnEscRej.addEventListener('click', () => handleEscalation(c.id, 'REJECT'));

    document.querySelectorAll('[data-signoff-dept]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const dept = btn.dataset.signoffDept;
        const name = document.getElementById(`signoff-name-${dept}`).value.trim() || 'Thành viên';
        try {
          const res = await api(`/api/cases/${encodeURIComponent(c.id)}/signoff`, {
            method: 'POST',
            body: JSON.stringify({ department: dept, reviewer_name: name, action: 'APPROVE' })
          });
          toast(`Đã xác nhận ${dept}!`, 'success');
          await syncUpdatedCase(res);
        } catch (e) { toast(e.message, 'error'); }
      });
    });

    const btnRev = document.getElementById('btn-hitl-revision');
    if (btnRev) {
      btnRev.addEventListener('click', async () => {
        const note = document.getElementById('hitl-revision-note').value.trim() || 'Cần rà soát lại thông số.';
        try {
          const res = await api(`/api/cases/${encodeURIComponent(c.id)}/signoff`, {
            method: 'POST',
            body: JSON.stringify({ department: 'sales', reviewer_name: 'Hội đồng Thẩm định', action: 'REQUEST_REVISION', note })
          });
          toast('Đã chuyển sang Cần chỉnh sửa!', 'info');
          await syncUpdatedCase(res);
        } catch (e) { toast(e.message, 'error'); }
      });
    }

    const btnPub = document.getElementById('btn-publish-quote');
    if (btnPub) {
      btnPub.addEventListener('click', async () => {
        try {
          const res = await api(`/api/cases/${encodeURIComponent(c.id)}/publish`, {
            method: 'POST',
            body: JSON.stringify({ publisher_name: 'Trưởng phòng Kinh doanh' })
          });
          toast('🎉 Đã xuất bản bản chào giá!', 'success');
          await syncUpdatedCase(res);
          openQuotePreview(res.case);
        } catch (e) { toast(e.message, 'error'); }
      });
    }

    const btnPrev = document.getElementById('btn-preview-quote');
    if (btnPrev) btnPrev.addEventListener('click', () => openQuotePreview(c));
  }

  async function handleEscalation(caseId, decision) {
    const approver_name = document.getElementById('esc-approver-name').value.trim() || 'Lãnh đạo';
    const role = document.getElementById('esc-approver-role').value;
    const adjusted_discount_pct = document.getElementById('esc-adjust-discount').value;
    const comment = document.getElementById('esc-comment').value.trim();
    try {
      const res = await api(`/api/cases/${encodeURIComponent(caseId)}/escalate`, {
        method: 'POST',
        body: JSON.stringify({ approver_name, role, decision, comment, adjusted_discount_pct })
      });
      toast(decision === 'APPROVE' ? 'Đã phê duyệt vượt cấp!' : 'Đã trả lại chỉnh sửa.', 'success');
      await syncUpdatedCase(res);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function syncUpdatedCase(res) {
    if (res.summary) state.summary = res.summary;
    if (res.case) {
      const idx = state.cases.findIndex((x) => x.id === res.case.id);
      if (idx >= 0) state.cases[idx] = res.case;
      else state.cases.unshift(res.case);
      state.selectedCaseId = res.case.id;
    }
    renderDashboard();
    renderRightSidebar();
    if (state.activeView === 'workbench') renderWorkbench();
  }

  // Quote Preview
  function openQuotePreview(c) {
    const q = c.deliverables && c.deliverables.draft_quotation;
    if (!q) return toast('Chưa có dự thảo báo giá', 'error');

    document.getElementById('quote-preview-body').innerHTML = `
      <div class="quote-doc">
        <div class="quote-doc-header">
          <div>
            <h2 style="margin:0;color:var(--rose-500);">${esc(q.seller.name)}</h2>
            <div class="muted">${esc(q.seller.address)} • MST: ${esc(q.seller.tax_code)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:17px;font-weight:800;">BẢN CHÀO GIÁ DỰ ÁN</div>
            <div class="mono">Số: ${esc(q.quote_number)}</div>
            <div>Ngày: ${esc(q.issue_date)}</div>
          </div>
        </div>
        <p><strong>Kính gửi:</strong> ${esc(q.buyer.name)} (${esc(q.buyer.location)})</p>
        <table class="data-table">
          <thead><tr><th>#</th><th>SKU</th><th>Hạng mục</th><th>ĐVT</th><th>SL</th><th class="text-right">Đơn giá</th><th class="text-right">Thành tiền</th></tr></thead>
          <tbody>
            ${(q.items || []).map((it, i) => `
              <tr><td>${i + 1}</td><td class="mono">${esc(it.sku)}</td><td>${esc(it.name)}</td><td>${esc(it.unit)}</td><td>${it.quantity}</td><td class="text-right">${vnd(it.unit_price_vnd)}</td><td class="text-right">${vnd(it.line_list_total_vnd)}</td></tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr><td colspan="6" class="text-right">Tổng niêm yết:</td><td class="text-right">${vnd(q.summary.list_subtotal_vnd)}</td></tr>
            <tr><td colspan="6" class="text-right">Chiết khấu (${q.summary.discount_pct}%):</td><td class="text-right">-${vnd(q.summary.discount_amount_vnd)}</td></tr>
            <tr><td colspan="6" class="text-right"><strong>Tổng trước VAT:</strong></td><td class="text-right"><strong>${vnd(q.summary.net_before_vat_vnd)}</strong></td></tr>
            <tr><td colspan="6" class="text-right">VAT (${q.summary.vat_rate_pct}%):</td><td class="text-right">${vnd(q.summary.vat_amount_vnd)}</td></tr>
            <tr><td colspan="6" class="text-right"><strong>TỔNG THANH TOÁN:</strong></td><td class="text-right"><strong style="color:var(--rose-500);font-size:15px;">${vnd(q.summary.grand_total_vnd)}</strong></td></tr>
          </tfoot>
        </table>
        <h4 style="margin-top:14px;">Điều khoản thương mại</h4>
        <ul>${(q.commercial_terms || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>
    `;
    document.getElementById('modal-quote-preview').classList.add('open');
    document.getElementById('btn-download-quote-md').onclick = () => {
      const md = [
        `# BẢN CHÀO GIÁ - ${q.quote_number}`,
        `**Khách hàng:** ${q.buyer.name}`,
        '',
        '| # | SKU | Hạng mục | SL | Thành tiền |',
        '|---|---|---|---:|---:|',
        ...(q.items || []).map((it, i) => `| ${i + 1} | ${it.sku} | ${it.name} | ${it.quantity} | ${vnd(it.line_list_total_vnd)} |`),
        '',
        `**TỔNG THANH TOÁN:** ${vnd(q.summary.grand_total_vnd)}`
      ].join('\n');
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${q.quote_number}.md`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  // Knowledge & Settings
  function renderKnowledge() {
    if (!state.knowledge) return;
    document.querySelectorAll('#kb-tabs .sub-tab').forEach((b) => b.classList.toggle('active', b.dataset.kb === state.activeKbTab));
    const el = document.getElementById('kb-content');
    const kb = state.knowledge;

    if (state.activeKbTab === 'catalog') {
      const sols = kb.catalog?.solutions || [];
      el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>SKU</th><th>Thiết bị / Dịch vụ</th><th>Nhóm</th><th class="text-right">Đơn giá</th><th>Lead-time</th><th>Đặc tính</th></tr></thead><tbody>${sols.map((s) => `<tr><td class="mono">${esc(s.sku)}</td><td><strong>${esc(s.name)}</strong><div class="muted">${esc(s.vendor)}</div></td><td><span class="badge badge-pink">${esc(s.category)}</span></td><td class="text-right"><strong>${vnd(s.unit_price_vnd)}</strong></td><td>${s.lead_time_days}d</td><td>${(s.features || []).join(' • ')}</td></tr>`).join('')}</tbody></table></div>`;
    } else if (state.activeKbTab === 'schedule') {
      const weeks = kb.capacity_schedule?.weekly_schedule || [];
      el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Tuần</th><th>Dự án đang chạy</th><th>Mức tải</th><th>Ngày công trống</th></tr></thead><tbody>${weeks.map((w) => `<tr><td><strong>${esc(w.label)}</strong></td><td>${(w.active_commitments || []).join(' • ')}</td><td><span class="badge ${w.utilization_pct >= 90 ? 'badge-red' : (w.utilization_pct >= 80 ? 'badge-amber' : 'badge-green')}">${w.utilization_pct}%</span></td><td>${w.available_man_days} man-days</td></tr>`).join('')}</tbody></table></div>`;
    } else {
      const pol = kb.policies || {};
      el.innerHTML = `<div class="grid-2"><div><h3>Chính sách Chiết khấu</h3><table class="data-table"><thead><tr><th>Bậc</th><th>CK Thiết bị</th><th>CK Dịch vụ</th></tr></thead><tbody>${(pol.discount_tiers || []).map((t) => `<tr><td><strong>${esc(t.name)}</strong></td><td>${t.standard_hardware_discount_pct}%</td><td>${t.standard_service_discount_pct}%</td></tr>`).join('')}</tbody></table></div><div><h3>Quy tắc Chuyển duyệt</h3><table class="data-table"><thead><tr><th>Điều kiện</th><th>Người duyệt</th></tr></thead><tbody>${(pol.escalation_rules || []).map((e) => `<tr><td>${esc(e.condition)}</td><td><span class="badge badge-amber">${esc(e.approver)}</span></td></tr>`).join('')}</tbody></table></div></div>`;
    }
  }

  function renderSettings() {
    if (!state.settings) return;
    const s = state.settings;
    document.getElementById('set-engine-mode').value = s.engine_mode || 'hybrid';
    document.getElementById('set-provider').value = s.provider || 'gemini';
    document.getElementById('set-model').value = s.model || 'gemini-2.5-flash';
    document.getElementById('set-key-status').textContent = s.has_api_key ? `(Đã lưu: ${s.api_key_masked})` : '(Đang chạy Offline Engine)';
    const pill = document.getElementById('engine-status-pill');
    if (pill) {
      pill.textContent = s.has_api_key && s.engine_mode !== 'offline' ? `⚡ ${s.provider.toUpperCase()} Live` : '⚡ Hybrid AI Ready';
    }
  }

  // Events
  function bindGlobalEvents() {
    document.querySelectorAll('#main-nav .ln-item[data-view], #btn-aura-pill').forEach((b) => {
      b.addEventListener('click', () => switchView(b.dataset.view));
    });

    document.getElementById('nav-shortcut-pending').addEventListener('click', () => {
      const target = state.cases.find((c) => c.status === 'PENDING_ESCALATION' || c.status === 'NEEDS_CLARIFICATION') || state.cases[0];
      if (target) openCaseInWorkbench(target.id);
    });

    document.getElementById('btn-hero-start').addEventListener('click', () => {
      const target = state.cases[0];
      if (target) openCaseInWorkbench(target.id);
    });

    document.getElementById('folder-catalog').addEventListener('click', () => {
      state.activeKbTab = 'catalog';
      switchView('knowledge');
    });
    document.getElementById('folder-schedule').addEventListener('click', () => {
      state.activeKbTab = 'schedule';
      switchView('knowledge');
    });

    document.getElementById('btn-filter-all-pill').addEventListener('click', () => setTriageFilter('ALL'));
    document.querySelectorAll('#triage-filters .pnum').forEach((b) => {
      b.addEventListener('click', () => setTriageFilter(b.dataset.filter));
    });

    document.querySelectorAll('#area-chart-mode .pt-btn').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#area-chart-mode .pt-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        state.areaChartMode = b.dataset.mode;
        renderAreaChart();
      });
    });

    document.getElementById('wb-case-select').addEventListener('change', (e) => {
      state.selectedCaseId = e.target.value;
      renderWorkbench();
      renderRightSidebar();
    });

    document.querySelectorAll('#wb-subtabs .sub-tab').forEach((t) => {
      t.addEventListener('click', () => {
        state.activeWbTab = t.dataset.tab;
        renderWorkbench();
      });
    });

    document.querySelectorAll('#kb-tabs .sub-tab').forEach((t) => {
      t.addEventListener('click', () => {
        state.activeKbTab = t.dataset.kb;
        renderKnowledge();
      });
    });

    document.getElementById('btn-rerun-agent').addEventListener('click', async () => {
      if (!state.selectedCaseId) return;
      try {
        const res = await api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/run`, { method: 'POST', body: JSON.stringify({}) });
        toast('AI Agent đã phân tích lại hồ sơ!', 'success');
        await syncUpdatedCase(res);
      } catch (e) { toast(e.message, 'error'); }
    });

    document.getElementById('btn-reset-demo-side').addEventListener('click', async () => {
      try {
        const res = await api('/api/demo/reset', { method: 'POST', body: JSON.stringify({}) });
        state.summary = res.summary;
        state.cases = res.cases;
        state.selectedCaseId = state.cases[0]?.id || null;
        renderDashboard();
        renderRightSidebar();
        toast('Đã khôi phục 5 hồ sơ mẫu Thiên Minh!', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });

    // Global Search
    const searchInput = document.getElementById('global-search');
    const searchDrop = document.getElementById('search-dropdown');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) { searchDrop.classList.remove('open'); return; }
      const matches = state.cases.filter((c) =>
        c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || (c.extracted?.customer_name || '').toLowerCase().includes(q)
      );
      searchDrop.innerHTML = matches.length
        ? matches.map((m) => `<div class="search-item" data-s-case="${esc(m.id)}"><strong>${esc(m.id)}</strong> — ${esc(m.extracted?.customer_name || m.title)}</div>`).join('')
        : '<div class="search-item muted">Không tìm thấy hồ sơ phù hợp</div>';
      searchDrop.classList.add('open');
      searchDrop.querySelectorAll('[data-s-case]').forEach((it) => {
        it.addEventListener('click', () => {
          searchDrop.classList.remove('open');
          searchInput.value = '';
          openCaseInWorkbench(it.dataset.sCase);
        });
      });
    });
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchDrop.contains(e.target)) searchDrop.classList.remove('open');
    });

    // Copilot actions
    document.getElementById('btn-toggle-copilot-focus').addEventListener('click', openCopilotDrawer);
    document.getElementById('btn-expand-copilot').addEventListener('click', openCopilotDrawer);
    document.getElementById('btn-open-copilot-help').addEventListener('click', openCopilotDrawer);
    document.getElementById('btn-copilot-this-case').addEventListener('click', () => {
      askCopilot(`Tóm tắt rủi ro và hướng xử lý cho hồ sơ ${state.selectedCaseId}`, true);
    });
    document.getElementById('btn-close-copilot').addEventListener('click', closeCopilotDrawer);
    document.getElementById('btn-notif-bell').addEventListener('click', () => {
      const target = state.cases.find((c) => c.status === 'NEEDS_CLARIFICATION' || c.status === 'PENDING_ESCALATION');
      if (target) openCaseInWorkbench(target.id);
    });

    document.getElementById('mini-copilot-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = document.getElementById('mini-copilot-input');
      const val = inp.value.trim();
      if (!val) return;
      inp.value = '';
      askCopilot(val, false);
    });

    document.getElementById('copilot-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = document.getElementById('copilot-input');
      const val = inp.value.trim();
      if (!val) return;
      inp.value = '';
      askCopilot(val, true);
    });

    // New RFP Modal
    const modal = document.getElementById('modal-new-rfp');
    const openNewModal = () => modal.classList.add('open');
    const closeNewModal = () => modal.classList.remove('open');
    document.getElementById('btn-open-new-rfp').addEventListener('click', openNewModal);
    document.getElementById('btn-open-new-rfp-side').addEventListener('click', openNewModal);
    document.getElementById('close-new-rfp').addEventListener('click', closeNewModal);
    document.getElementById('cancel-new-rfp').addEventListener('click', closeNewModal);
    document.getElementById('close-quote-preview').addEventListener('click', () => document.getElementById('modal-quote-preview').classList.remove('open'));

    document.getElementById('btn-fill-template').addEventListener('click', () => {
      document.getElementById('new-rfp-title').value = 'Nâng cấp hạ tầng mạng Chi nhánh Thủ Đức - Công ty Logistics Đại Việt';
      document.getElementById('new-rfp-text').value =
        'Công ty Logistics Đại Việt cần báo giá nâng cấp mạng cho kho vận Thủ Đức:\n' +
        '- 03 Switch Access 24 port PoE+ 370W có uplink 10G SFP+.\n' +
        '- 06 Access Point Wi-Fi 6 doanh nghiệp (chịu tải >= 200 user/AP).\n' +
        '- 01 Firewall NGFW IPS >= 5 Gbps chạy HA.\n' +
        '- Dịch vụ khảo sát, lắp đặt cấu hình VLAN và bảo trì 24x7 SLA 4 giờ (12 tháng).\n' +
        'Thời hạn hoàn thành trong vòng 5 tuần. Ngân sách dự kiến 450 triệu VND (chưa VAT). Bắt buộc CO/CQ.';
    });

    document.getElementById('form-new-rfp').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('new-rfp-title').value.trim();
      const sales_owner = document.getElementById('new-rfp-owner').value.trim();
      const raw_text = document.getElementById('new-rfp-text').value.trim();
      try {
        const res = await api('/api/cases', { method: 'POST', body: JSON.stringify({ title, sales_owner, raw_text }) });
        closeNewModal();
        document.getElementById('form-new-rfp').reset();
        toast(`Đã tiếp nhận & chạy AI Agent cho ${res.case.id}!`, 'success');
        await syncUpdatedCase(res);
        openCaseInWorkbench(res.case.id);
      } catch (err) { toast(err.message, 'error'); }
    });

    // Settings
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        engine_mode: document.getElementById('set-engine-mode').value,
        provider: document.getElementById('set-provider').value,
        model: document.getElementById('set-model').value.trim()
      };
      const keyVal = document.getElementById('set-api-key').value.trim();
      if (keyVal) payload.api_key = keyVal;
      try {
        const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
        state.settings = res.settings;
        document.getElementById('set-api-key').value = '';
        renderSettings();
        toast('Đã lưu cấu hình AI Engine!', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('btn-clear-key').addEventListener('click', async () => {
      try {
        const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ clear_api_key: true }) });
        state.settings = res.settings;
        renderSettings();
        toast('Đã xóa API Key.', 'info');
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('btn-test-llm').addEventListener('click', async () => {
      const box = document.getElementById('settings-test-result');
      box.innerHTML = '<div class="callout callout-info">Đang kiểm tra kết nối LLM...</div>';
      try {
        const res = await api('/api/settings/test', { method: 'POST', body: JSON.stringify({}) });
        box.innerHTML = `<div class="callout ${res.ok ? 'callout-success' : 'callout-warning'}">${esc(res.message)}</div>`;
      } catch (err) {
        box.innerHTML = `<div class="callout callout-danger">${esc(err.message)}</div>`;
      }
    });
  }

  init().catch((e) => toast(`Lỗi khởi tạo: ${e.message}`, 'error'));
})();

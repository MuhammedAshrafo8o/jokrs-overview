/* =====================================================================
   ui-core.js — rendering helpers, router, dialogs, toasts, shell,
   demo toolbar. All state changes go through JK.Store.dispatch().
   ===================================================================== */
(function (G) {
  'use strict';
  const JK = G.JK, S = JK.Store, L = JK.L;
  const UI = (JK.UI = {
    route: { path: [], query: {} }, pages: {}, act: {},
    filters: { requests: {}, refunds: {}, activity: {}, policies: {} },
    kpiRange: { from: '2026-11-01', to: '' },
    editor: null, sim: null, co: null, cp: null, scenario: null, modal: null, demoOpen: false, navOpen: false, noticeDismissed: false,
    view: initialView()
  });
  function initialView() {
    const ok = ['office', 'customer', 'jokrs'];
    try { const q = new URLSearchParams(location.search).get('view'); if (ok.includes(q)) return q; } catch (e) { /* old browsers */ }
    try { const v = window.localStorage.getItem('jokrs.crr.view'); if (ok.includes(v)) return v; } catch (e) { /* storage blocked */ }
    return 'office';
  }

  /* ---------------- basic helpers ---------------- */
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, cls) => `<svg class="ic ${cls || ''}" aria-hidden="true" focusable="false"><use href="#i-${n}"></use></svg>`;
  const money = (v, cls) => `<span class="money ${cls || ''}">${h(JK.sar(v))}</span>`;
  const dt = (v) => `<time datetime="${h(v || '')}">${h(JK.fmtDT(v))}</time>`;
  const dts = (v) => `<time datetime="${h(v || '')}">${h(JK.fmtDTs(v))}</time>`;
  const TONES = {
    req: { awaiting_review: 'warning', info_requested: 'warning', proposal_sent: 'info', override_sent: 'info', approved: 'success', auto_approved: 'success', rejected: 'danger' },
    refund: { awaiting_review: 'warning', approved: 'info', processing: 'info', completed: 'success', failed: 'danger', not_required: 'muted' },
    version: { draft: 'muted', pending_review: 'warning', published: 'success', rejected: 'danger', scheduled: 'info', superseded: 'muted', archived: 'muted' },
    visit: { scheduled: 'info', completed: 'success', canceled: 'muted', customer_no_show: 'warning', partially_delivered: 'warning', office_canceled: 'danger', replaced: 'muted', canceled_late: 'warning' }
  };
  const badge = (text, tone, title) => `<span class="badge badge-${tone || 'neutral'}"${title ? ` title="${h(title)}"` : ''}>${h(text)}</span>`;
  const reqBadge = (s) => badge(L.requestStatus[s] || s, TONES.req[s]);
  const refundBadge = (s) => badge(L.refundState[s] || s, TONES.refund[s]);
  const visitBadge = (s) => badge(L.visitStatus[s] || s, TONES.visit[s]);
  const office = () => S.office();
  const now = () => S.state.demo.now;
  const can = (perm) => S.can(perm);
  const byId = (arr, id) => JK.store.byId(arr, id);
  const roleLabel = () => L.role[S.state.demo.role];

  /** Button that explains itself when not permitted (aria-disabled, click shows the reason). */
  function btn(o) {
    const cls = `btn btn-${o.kind || 'secondary'}${o.small ? ' btn-sm' : ''}${o.cls ? ' ' + o.cls : ''}`;
    let why = o.why || '';
    if (o.perm && !can(o.perm)) why = JK.Store.PERM_LABEL[o.perm];
    const data = Object.entries(o.data || {}).map(([k, v]) => ` data-${k}="${h(v)}"`).join('');
    const label = (o.icon ? ic(o.icon) : '') + `<span>${h(o.label)}</span>`;
    if (why) return `<button type="button" class="${cls} is-disabled" aria-disabled="true" data-why="${h(why)}" title="${h(why)}"${o.id ? ` id="${o.id}"` : ''}>${label}<span class="sr-only"> — غير متاح: ${h(why)}</span></button>`;
    return `<button type="${o.type || 'button'}" class="${cls}"${o.act ? ` data-act="${o.act}"` : ''}${data}${o.id ? ` id="${o.id}"` : ''}${o.aria ? ` aria-label="${h(o.aria)}"` : ''}>${label}</button>`;
  }
  function permNote(perms) {
    const missing = perms.filter((p) => !can(p));
    if (!missing.length) return '';
    return `<div class="note note-info" role="note">${ic('shield')}<div>أنت تعرض هذه الصفحة بدور <b>${h(roleLabel())}</b>. ${h(missing.map((p) => JK.Store.PERM_LABEL[p]).join('؛ '))}. الإجراءات غير المتاحة تظهر معطلة، والنقر عليها يوضح السبب.</div></div>`;
  }
  function empty(title, text, action) {
    return `<div class="empty">${ic('search', 'empty-ic')}<p class="empty-title">${h(title)}</p>${text ? `<p class="muted">${h(text)}</p>` : ''}${action || ''}</div>`;
  }
  function pageHead(title, sub, actions) {
    return `<div class="page-head"><div><h1 id="page-title">${h(title)}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div><div class="page-actions">${actions || ''}</div></div>`;
  }
  function kv(rows) {
    return `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  }
  function inputVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  /* ---------------- toasts ---------------- */
  function toast(msg, tone, isHtml) {
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast toast-${tone || 'info'}`;
    el.innerHTML = `${ic(tone === 'success' ? 'check' : tone === 'danger' ? 'alert' : 'info')}<div class="toast-body">${isHtml ? msg : h(msg)}</div><button type="button" class="toast-x" aria-label="إغلاق التنبيه">${ic('x')}</button>`;
    el.querySelector('.toast-x').addEventListener('click', () => el.remove());
    root.appendChild(el);
    setTimeout(() => el.remove(), tone === 'danger' ? 9000 : 4500);
  }

  /** Run a store action; show success or a specific error. Returns {ok,res,error}. */
  function run(name, args, okMsg) {
    try {
      const res = S.dispatch(name, args);
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(res) : okMsg, 'success');
      return { ok: true, res };
    } catch (e) {
      if (!e.isAction) { console.error(e); toast('خطأ غير متوقع: ' + e.message, 'danger'); return { ok: false, error: e }; }
      let msg = h(e.message);
      if (Array.isArray(e.details) && e.details.length && e.details[0].msg) msg += '<ul>' + e.details.map((d) => `<li>${h(d.msg)}</li>`).join('') + '</ul>';
      toast(msg, 'danger', true);
      return { ok: false, error: e };
    }
  }

  /* ---------------- dialogs & drawers ---------------- */
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function openModal(o) {
    closeModal(true);
    const root = document.getElementById('overlay-root');
    UI.modal = { opts: o, lastFocus: document.activeElement };
    root.innerHTML = `<div class="backdrop" data-backdrop="1"><div class="${o.drawer ? 'drawer' : 'dialog'} ${o.size ? 'size-' + o.size : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <div class="dlg-head"><h2 id="dlg-title">${h(o.title)}</h2><button type="button" class="icon-btn" data-act="modal-close" aria-label="إغلاق">${ic('x')}</button></div>
      <div class="dlg-body" id="dlg-body"></div><div class="dlg-foot" id="dlg-foot"></div></div></div>`;
    renderModal();
    const first = root.querySelector('.dlg-body ' + FOCUSABLE) || root.querySelector(FOCUSABLE);
    if (first) first.focus();
    document.body.classList.add('modal-open');
  }
  function renderModal() {
    if (!UI.modal) return;
    const o = UI.modal.opts;
    const body = document.getElementById('dlg-body'), foot = document.getElementById('dlg-foot');
    if (!body) return;
    const ae = document.activeElement, aeId = ae && ae.id;
    body.innerHTML = typeof o.body === 'function' ? o.body() : o.body;
    foot.innerHTML = typeof o.foot === 'function' ? o.foot() : (o.foot || '');
    foot.hidden = !foot.innerHTML.trim();
    if (aeId && document.getElementById(aeId)) document.getElementById(aeId).focus();
    if (o.onRender) o.onRender(body);
  }
  function closeModal(silent) {
    const root = document.getElementById('overlay-root');
    if (!UI.modal) { root.innerHTML = ''; return; }
    const lf = UI.modal.lastFocus, onClose = UI.modal.opts.onClose;
    UI.modal = null; root.innerHTML = '';
    document.body.classList.remove('modal-open');
    if (!silent) { if (onClose) onClose(); if (lf && document.body.contains(lf)) lf.focus(); }
  }
  function confirmDialog(o) {
    return new Promise((resolve) => {
      let done = false;
      openModal({
        title: o.title, size: 'sm',
        body: `<div class="confirm-body">${o.body}</div>`,
        foot: `<button type="button" class="btn btn-secondary" data-act="confirm-no">${h(o.cancel || 'إلغاء')}</button><button type="button" class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm-yes">${h(o.ok || 'تأكيد')}</button>`,
        onClose: () => { if (!done) resolve(false); }
      });
      UI.act['confirm-yes'] = () => { done = true; closeModal(); resolve(true); };
      UI.act['confirm-no'] = () => { done = true; closeModal(); resolve(false); };
    });
  }

  /* ---------------- router ---------------- */
  function parseHash() {
    const raw = (location.hash || '#/overview').replace(/^#\/?/, '');
    const [p, q] = raw.split('?');
    const query = {};
    (q || '').split('&').filter(Boolean).forEach((kv2) => { const [k, v] = kv2.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
    return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query };
  }
  function go(path) { if (location.hash === '#' + path) { onRoute(); } else location.hash = path; }
  let suppress = false;
  function onRoute() {
    if (suppress) { suppress = false; return; }
    const next = parseHash();
    const ed = UI.editor;
    const leavingEditor = ed && ed.dirty && !(next.path[0] === 'policies' && next.path[2] === 'edit' && next.path[1] === ed.policyId);
    if (leavingEditor) {
      const target = location.hash;
      suppress = true; history.back();
      confirmDialog({ title: 'تغييرات غير محفوظة', body: '<p>لديك تعديلات على المسودة لم تُحفظ. هل تريد المغادرة دون حفظ؟</p>', ok: 'المغادرة دون حفظ', danger: true }).then((yes) => {
        if (yes) { UI.editor = null; location.hash = target; }
      });
      return;
    }
    UI.route = next;
    const sec = next.path[0];
    if (sec === 'requests' && !next.path[1] && Object.keys(next.query).length) UI.filters.requests = Object.assign({}, next.query);
    if (sec === 'refunds' && Object.keys(next.query).length && !next.query.open) UI.filters.refunds = Object.assign({}, next.query);
    if (sec === 'policies' && !next.path[1] && Object.keys(next.query).length) UI.filters.policies = Object.assign({}, next.query);
    if (!(sec === 'policies' && next.path[2] === 'edit')) UI.editor = null;
    UI.navOpen = false;
    closeModal(true);
    render();
    const main = document.getElementById('main');
    if (main) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }

  /* ---------------- shell ---------------- */
  const NAV = [
    ['overview', 'نظرة عامة', 'home'], ['policies', 'السياسات', 'doc'], ['assignments', 'ربط السياسات', 'link'],
    ['requests', 'طلبات الإلغاء والتعديل', 'inbox'], ['refunds', 'المبالغ المستردة', 'coins'], ['activity', 'سجل النشاط', 'history']
  ];
  const TOOLS = [['simulator', 'محاكي السياسات', 'sliders'], ['checkout', 'معاينة العميل', 'phone']];
  function renderSidebar() {
    const o = office(), sec = UI.route.path[0] || 'overview';
    const pendingReq = o.requests.filter((r) => ['awaiting_review', 'info_requested'].includes(r.status)).length;
    const failed = o.refunds.filter((r) => r.state === 'failed').length;
    const counts = { requests: pendingReq ? badge(pendingReq, 'warning', 'بانتظار المراجعة') : '', refunds: failed ? badge(failed, 'danger', 'استردادات فاشلة') : '' };
    const item = ([k, label, icon]) => `<li><a href="#/${k}" class="nav-link${sec === k ? ' active' : ''}"${sec === k ? ' aria-current="page"' : ''}>${ic(icon)}<span class="nav-label">${h(label)}</span>${counts[k] || ''}</a></li>`;
    document.getElementById('sidebar').innerHTML = `
      <div class="side-head">
        <button type="button" class="icon-btn nav-toggle" data-act="nav-toggle" aria-expanded="${UI.navOpen}" aria-controls="side-nav" aria-label="القائمة">${ic('menu')}</button>
        <div class="side-office"><span class="side-kicker">بوابة المكتب</span><strong>${h(o.office.name)}</strong><span class="side-city">${h(o.office.city)}</span></div>
      </div>
      <nav id="side-nav" class="side-nav${UI.navOpen ? ' open' : ''}">
        <ul>${NAV.map(item).join('')}</ul>
        <p class="side-group">أدوات المكتب</p>
        <ul>${TOOLS.map(item).join('')}</ul>
        <div class="side-user">${ic('user')}<div><strong>${h(o.office.staff[S.state.demo.role])}</strong><span>${h(roleLabel())}</span></div></div>
        <p class="side-fine">محاكاة الأدوار في الواجهة ليست حماية أمنية فعلية. الألوان مؤقتة وليست هوية JOKRS الرسمية.</p>
      </nav>`;
  }

  function renderDemobar() {
    const st = S.state, d = st.demo;
    const pending = Object.values(st.offices).reduce((n, o) => n + o.policies.reduce((m, p) => m + p.versions.filter((v) => v.status === 'pending_review').length, 0), 0);
    const opt = (v, l, sel) => `<option value="${h(v)}"${sel ? ' selected' : ''}>${h(l)}</option>`;
    document.getElementById('demobar').innerHTML = `
      <div class="demo-row">
        <div class="demo-title">${ic('flask')}<span class="demo-tag">بيئة محاكاة</span><span class="demo-sub">أدوات العرض — مشتركة بين الواجهات الثلاث وليست جزءاً من أي منها</span></div>
        <button type="button" class="btn btn-ghost btn-sm demo-toggle" data-act="demo-toggle" aria-expanded="${UI.demoOpen}" aria-controls="demo-controls">${UI.demoOpen ? 'إخفاء الأدوات' : 'إظهار الأدوات'}</button>
      </div>
      <div id="demo-controls" class="demo-controls${UI.demoOpen ? ' open' : ''}">
        ${UI.view === 'office' ? `<label class="demo-field"><span>المكتب</span><select id="demo-office" data-on-change="demo-office">${Object.values(st.offices).map((o) => opt(o.office.id, o.office.name, o.office.id === d.officeId)).join('')}</select></label>
        <label class="demo-field"><span>الدور</span><select id="demo-role" data-on-change="demo-role">${['admin', 'operations', 'finance', 'viewer'].map((r) => opt(r, L.role[r], r === d.role)).join('')}</select></label>
        ` : ''}<form class="demo-field demo-inline" data-submit="demo-now"><label for="demo-now"><span>الوقت المحاكى (الرياض)</span></label><input id="demo-now" name="now" type="datetime-local" value="${h(JK.toRiyadhInput(d.now))}" required><button class="btn btn-ghost btn-sm" type="submit">تطبيق</button></form>
        ${UI.view === 'office' ? `<form class="demo-field demo-inline" data-submit="demo-scenario"><label for="demo-sc"><span>سيناريو</span></label><select id="demo-sc" name="sc">${JK.SCENARIOS.map((s) => opt(s.id, s.title, UI.scenario && UI.scenario.id === s.id)).join('')}</select><button class="btn btn-ghost btn-sm" type="submit">تحميل</button></form>
        ` : ''}        <label class="demo-check"><input type="checkbox" id="demo-outage" data-on-change="demo-outage"${d.providerOutage ? ' checked' : ''}> <span>عطل مزوّد الدفع</span></label>
        <button type="button" class="btn btn-ghost btn-sm" data-act="tests-open">${ic('check')}<span>تشغيل الفحوصات</span></button>
        <button type="button" class="btn btn-ghost btn-sm demo-danger" data-act="demo-reset">${ic('refresh')}<span>إعادة ضبط البيانات</span></button>
      </div>`;
  }

  /* ---------------- top-level view tabs ---------------- */
  const VIEWS = [
    ['office', 'بوابة المكتب', 'building'],
    ['customer', 'تطبيق العميل', 'phone'],
    ['jokrs', 'لوحة منصة JOKRS', 'grid']
  ];
  function viewInfo(k) {
    const st = S.state;
    if (k === 'office') {
      const o = office();
      const n = o.requests.filter((r) => ['awaiting_review', 'info_requested'].includes(r.status)).length + o.refunds.filter((r) => r.state === 'failed').length;
      return { sub: o.office.name + ' · ' + roleLabel(), count: n, countTitle: 'طلبات بانتظار المراجعة واستردادات فاشلة' };
    }
    if (k === 'customer') return UI.customerTabInfo ? UI.customerTabInfo() : { sub: '', count: 0 };
    if (k === 'jokrs') return UI.jokrsTabInfo ? UI.jokrsTabInfo() : { sub: '', count: 0 };
    return { sub: '', count: 0 };
  }
  function renderViewTabs() {
    const el = document.getElementById('viewtabs');
    if (!el) return;
    el.innerHTML = `<div class="vt-inner" role="tablist" aria-label="الواجهات">${VIEWS.map(([k, label, icon]) => {
      const inf = viewInfo(k), sel = UI.view === k;
      return `<div class="vt-item${sel ? ' active' : ''} vt-${k}"><button type="button" role="tab" id="vt-${k}" aria-selected="${sel}" aria-controls="view-${k}" tabindex="${sel ? 0 : -1}" class="vt-tab" data-act="view-set" data-v="${k}">
          <span class="vt-ic">${ic(icon)}</span><span class="vt-text"><span class="vt-title">${h(label)}${inf.count ? ` <span class="vt-count" title="${h(inf.countTitle || '')}">${inf.count}</span>` : ''}</span><span class="vt-sub">${h(inf.sub)}</span></span></button>
</div>`;
    }).join('')}</div>
      <p class="vt-note">${ic('refresh')} الواجهات الثلاث تعمل على نفس بيانات المحاكاة: أي إجراء في واجهة يظهر فوراً في الأخريين.</p>`;
  }

  function renderMain() {
    const main = document.getElementById('main');
    const p = UI.route.path, sec = p[0] || 'overview';
    let html = '';
    if (S.notice && !UI.noticeDismissed) html += `<div class="note note-warning" role="alert">${ic('alert')}<div>${h(S.notice)}</div><button type="button" class="icon-btn" data-act="notice-x" aria-label="إخفاء">${ic('x')}</button></div>`;
    try {
      const P = UI.pages;
      if (sec === 'overview') html += P.overview();
      else if (sec === 'policies' && p[1] && p[2] === 'edit') html += P.builder(p[1], parseInt(p[3], 10));
      else if (sec === 'policies' && p[1]) html += P.policyView(p[1]);
      else if (sec === 'policies') html += P.policies();
      else if (sec === 'assignments') html += P.assignments();
      else if (sec === 'requests' && p[1]) html += P.requestDetail(p[1]);
      else if (sec === 'requests') html += P.requests();
      else if (sec === 'refunds') html += P.refunds();
      else if (sec === 'activity') html += P.activity();
      else if (sec === 'simulator') html += P.simulator();
      else if (sec === 'checkout') html += P.checkout();
      else html += empty('الصفحة غير موجودة', 'الرابط غير معروف.', `<a class="btn btn-primary" href="#/overview">العودة للنظرة العامة</a>`);
    } catch (e) {
      console.error(e);
      html += `<div class="note note-danger" role="alert">${ic('alert')}<div>تعذّر عرض الصفحة: ${h(e.message)}</div></div>`;
    }
    main.innerHTML = html;
    if (UI.afterRender) { const f = UI.afterRender; UI.afterRender = null; f(); }
  }

  function render() {
    const ae = document.activeElement;
    const key = ae && (ae.id || (ae.dataset && ae.dataset.bind));
    const selStart = ae && 'selectionStart' in ae ? ae.selectionStart : null;
    renderDemobar(); renderViewTabs();
    const views = { office: 'view-office', customer: 'view-customer', jokrs: 'view-jokrs' };
    Object.keys(views).forEach((k) => { const el = document.getElementById(views[k]); if (el) el.hidden = UI.view !== k; });
    document.body.dataset.view = UI.view;
    if (UI.view === 'office') { renderSidebar(); renderMain(); }
    else if (UI.view === 'customer' && UI.renderCustomer) UI.renderCustomer();
    else if (UI.view === 'jokrs' && UI.renderJokrs) UI.renderJokrs();
    if (UI.modal) renderModal();
    if (key) {
      const el = document.getElementById(key) || document.querySelector(`[data-bind="${CSS.escape(key)}"]`);
      if (el && el !== document.activeElement) {
        el.focus({ preventScroll: true });
        try { if (selStart !== null && el.setSelectionRange && /text|search|number/.test(el.type || 'text')) el.setSelectionRange(selStart, selStart); } catch (e) { /* number inputs */ }
      }
    }
  }

  /* ---------------- event delegation ---------------- */
  function bindEvents() {
    document.addEventListener('click', (e) => {
      const dis = e.target.closest('[aria-disabled="true"]');
      if (dis) { e.preventDefault(); toast(dis.dataset.why || 'هذا الإجراء غير متاح.', 'info'); return; }
      if (e.target.matches('[data-backdrop]')) { closeModal(); return; }
      const a = e.target.closest('[data-act]');
      if (a && UI.act[a.dataset.act]) { e.preventDefault(); UI.act[a.dataset.act](a, e); }
    });
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.bind && UI.onBind) { UI.onBind(el); return; }
      const n = el.dataset.onChange;
      if (n && UI.act[n]) UI.act[n](el, e);
    });
    document.addEventListener('input', (e) => {
      const n = e.target.dataset.onInput;
      if (n && UI.act[n]) UI.act[n](e.target, e);
    });
    document.addEventListener('submit', (e) => {
      const f = e.target.closest('form[data-submit]');
      if (!f) return;
      e.preventDefault();
      const n = f.dataset.submit;
      if (UI.act[n]) UI.act[n](f, e);
    });
    document.addEventListener('keydown', (e) => {
      if (!UI.modal) return;
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
      if (e.key === 'Tab') {
        const box = document.querySelector('#overlay-root [role=dialog]');
        if (!box) return;
        const f = Array.from(box.querySelectorAll(FOCUSABLE)).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    window.addEventListener('hashchange', onRoute);
    // keyboard navigation between the three view tabs
    document.addEventListener('keydown', (e) => {
      const t = e.target.closest && e.target.closest('.vt-tab');
      if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const keys = VIEWS.map((v) => v[0]); let i = keys.indexOf(UI.view);
      if (e.key === 'Home') i = 0; else if (e.key === 'End') i = keys.length - 1;
      else i = (i + (e.key === 'ArrowLeft' ? 1 : -1) + keys.length) % keys.length; // RTL: left = next
      setView(keys[i]); const nt = document.getElementById('vt-' + keys[i]); if (nt) nt.focus();
    });
    // live sync with other windows of the simulation (e.g. each view opened alone)
    window.addEventListener('storage', (e) => {
      if (e.key !== S.KEY) return;
      if (S.reloadFromStorage()) { /* listeners re-render */ }
    });
  }
  function setView(v) {
    if (UI.view === v) return;
    if (UI.view === 'office' && UI.editor && UI.editor.dirty) { toast('لديك مسودة غير محفوظة في محرر السياسة — احفظها أولاً أو غادر المحرر قبل تبديل الواجهة.', 'info'); return; }
    UI.view = v;
    try { window.localStorage.setItem('jokrs.crr.view', v); } catch (e) { /* storage blocked */ }
    closeModal(true);
    render();
    window.scrollTo(0, 0);
  }

  /* ---------------- shell actions ---------------- */
  Object.assign(UI.act, {
    'modal-close': () => closeModal(),
    'view-set': (el) => setView(el.dataset.v),
    'notice-x': () => { UI.noticeDismissed = true; render(); },
    'nav-toggle': () => { UI.navOpen = !UI.navOpen; renderSidebar(); },
    'demo-toggle': () => { UI.demoOpen = !UI.demoOpen; renderDemobar(); },
    'demo-office': (el) => {
      if (UI.editor && UI.editor.dirty) { toast('احفظ المسودة أو غادر المحرر قبل تبديل المكتب.', 'info'); el.value = S.state.demo.officeId; return; }
      UI.editor = null; UI.sim = null; UI.co = null; UI.cp = null; UI.scenario = null;
      UI.filters = { requests: {}, refunds: {}, activity: {}, policies: {} };
      run('setDemo', { officeId: el.value });
      toast('تم التبديل إلى: ' + office().office.name + ' — كل البيانات معزولة لكل مكتب.', 'info');
      const sec = UI.route.path[0] || 'overview';
      go('/' + (['requests', 'policies'].includes(sec) ? sec : sec === 'refunds' ? 'refunds' : sec));
    },
    'demo-role': (el) => { run('setDemo', { role: el.value }); toast('الدور الحالي: ' + roleLabel(), 'info'); },
    'demo-outage': (el) => { run('setDemo', { providerOutage: el.checked }); toast(el.checked ? 'عطل مزوّد الدفع مفعّل: محاولات الاسترداد بالبطاقة ستفشل.' : 'عاد مزوّد الدفع للعمل.', 'info'); },
    'demo-now': (f) => {
      const v = f.elements.now.value;
      const iso = JK.riyadhISO(v);
      if (!iso) { toast('أدخل وقتاً صالحاً.', 'danger'); return; }
      run('setDemo', { now: iso }, 'الوقت المحاكى الآن: ' + JK.fmtDT(iso));
    },
    'demo-reset': () => {
      confirmDialog({ title: 'إعادة ضبط بيانات العرض', body: '<p>ستُحذف كل التغييرات التي أجريتها في المكاتب الثلاثة (السياسات، الطلبات، المبالغ المستردة، السجل) وتعود البيانات الأولية. لا يمكن التراجع.</p>', ok: 'إعادة الضبط', danger: true })
        .then((yes) => { if (!yes) return; UI.editor = null; UI.sim = null; UI.co = null; UI.cp = null; UI.scenario = null; (UI.resetHooks || []).forEach((f) => f()); S.reset(); toast('أُعيدت البيانات الأولية.', 'success'); go('/overview'); });
    }
  });

  Object.assign(UI, { h, ic, money, dt, dts, badge, reqBadge, refundBadge, visitBadge, TONES, btn, permNote, empty, pageHead, kv, toast, run, openModal, closeModal, renderModal, confirmDialog,
    go, render, onRoute, parseHash, bindEvents, setView, office, now, can, byId, inputVal, roleLabel });
})(window);

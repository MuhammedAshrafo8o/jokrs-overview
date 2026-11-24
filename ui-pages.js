/* =====================================================================
   ui-pages.js — Overview, Policies, Assignments, Requests, Refunds,
   Activity, and the shared calculation view.
   ===================================================================== */
(function (G) {
  'use strict';
  const JK = G.JK, S = JK.Store, L = JK.L, UI = JK.UI;
  const { h, ic, money, dt, dts, badge, reqBadge, refundBadge, visitBadge, TONES, btn, permNote, empty, pageHead, kv, toast, run, openModal, closeModal, confirmDialog, go, render } = UI;
  const office = () => S.office(), now = () => S.state.demo.now, byId = (a, id) => JK.store.byId(a, id);

  /* ---------------- shared helpers ---------------- */
  function policyStatus(p, at) {
    if (p.archived) return { label: 'مؤرشفة', tone: 'muted', key: 'archived' };
    const eff = JK.effectiveVersion(p, at);
    if (eff) return { label: 'منشورة', tone: 'success', key: 'published', v: eff };
    const sch = JK.scheduledVersions(p, at);
    if (sch.length) return { label: 'منشورة — تسري لاحقاً', tone: 'info', key: 'scheduled', v: sch[sch.length - 1] };
    const last = p.versions[p.versions.length - 1];
    return { label: L.versionStatus[last.status], tone: TONES.version[last.status], key: last.status, v: last };
  }
  function openVersion(p) { return p.versions.find((v) => ['draft', 'pending_review', 'rejected'].includes(v.status)); }
  function versionState(p, v, at) {
    if (v.status !== 'published') return { label: L.versionStatus[v.status], tone: TONES.version[v.status] };
    const eff = JK.effectiveVersion(p, at);
    if (eff && eff.version === v.version) return { label: 'منشورة — سارية', tone: 'success' };
    if (Date.parse(v.effectiveFrom) > Date.parse(at)) return { label: 'منشورة — تسري ' + JK.fmtDTs(v.effectiveFrom), tone: 'info' };
    return { label: 'منشورة — سابقة', tone: 'muted' };
  }
  function targetLabel(o, a) {
    if (a.level === 'office_default') return 'افتراضي المكتب';
    if (a.level === 'service') { const s = byId(o.services, a.targetId); return 'خدمة: ' + (s ? s.name : a.targetId); }
    const f = JK.findPackage(o, a.targetId); return 'باقة: ' + (f ? f.pkg.name : a.targetId);
  }
  const SOURCE_TONE = { package: 'accent', service: 'info', office_default: 'neutral' };
  UI.helpers = { policyStatus, openVersion, versionState, targetLabel };

  /* ---------------- shared calculation view ---------------- */
  function calcView(c, b, opts) {
    opts = opts || {};
    if (!c) return '';
    if (!c.ok) {
      return `<div class="note note-danger" role="alert">${ic('alert')}<div><b>لا يمكن المعالجة آلياً:</b> ${h(c.blocked)}${c.canRequestReview ? '<br><span class="muted">يبقى للعميل حق تقديم طلب مراجعة استثنائية/حقوقية.</span>' : ''}</div></div>${traceView(c)}`;
    }
    const f = c.finance;
    const rows = [];
    if (c.outcome === 'reschedule') {
      const s = c.effects.schedule;
      rows.push(['الموعد الحالي', dt(s.from)], ['الموعد الجديد', dt(s.to)], ['يُحتسب من حد تعديلات العميل', s.counts ? 'نعم' : 'لا (سبب من المكتب)'], ['رسوم التعديل', money(s.fee)]);
      if (s.lockBand) rows.push(['تثبيت شريحة الإلغاء', h(s.lockBand.label + ' — ' + JK.describeFee(s.lockBand.fee))]);
    } else {
      rows.push(['قيمة الخدمة المدفوعة (بعد الخصم)', money(f.serviceNet)], ['مستهلك (زيارات منفذة/محتسبة)', money(f.consumed)], ['مسترد أو مسوّى سابقاً', money(f.settled)],
        ['المتبقي القابل للاسترداد في الحجز', money(f.remaining)], ['قيمة الحصص المتأثرة', money(c.affectedOpen)], ['القيمة المؤهلة لهذه العملية', money(c.eligible)]);
      if (c.waiver) rows.push(['رسوم المكتب قبل الإعفاء', money(c.officeFeeBeforeWaiver)], ['إعفاء معتمد', money(-c.waiver)]);
    }
    const sum = c.outcome === 'reschedule' ? '' : `
      <table class="calc-sum"><tbody>
        <tr><th scope="row">رسوم المكتب المحتفظ بها</th><td>${money(c.officeFee)}</td></tr>
        <tr><th scope="row">استرداد الخدمة</th><td>${money(c.serviceRefund)}</td></tr>
        <tr><th scope="row">تعديل ضريبي محاكى <span class="muted">(بيانات عرض)</span></th><td>${money(c.taxRefund)}</td></tr>
        <tr><th scope="row">رسوم منصة JOKRS المستردة</th><td>${money(c.jokrs.refund)}</td></tr>
        <tr class="total"><th scope="row">الإجمالي المعاد للعميل</th><td>${money(c.totalRefund)}</td></tr>
      </tbody></table>`;
    const outcomeText = {
      cash_refund: 'استرداد نقدي', release_authorization: 'إلغاء تفويض دفع غير مُحصّل', credit_restore: 'إعادة استحقاق زيارة إلى الرصيد — لا استرداد نقدي',
      replacement: 'موعد بديل تنتقل إليه القيمة المدفوعة — لا استرداد نقدي', no_refund: c.creditOutcome === 'forfeited' ? 'يُحتسب الرصيد — لا مبلغ مستحق' : 'لا مبلغ مستحق', reschedule: 'تغيير موعد'
    }[c.outcome];
    const dests = c.destinations.length ? `<ul class="dest-list">${c.destinations.map((d) => `<li>${ic('coins')}<span>${h(L.destAction[d.action])} — ${h(L.payMethod[d.method] || d.method)}${d.chosen ? ' (اختيار العميل)' : ''}</span>${money(d.amount)}</li>`).join('')}</ul>` : '';
    const visits = c.affected.length ? `<div class="table-wrap"><table class="tbl tbl-compact"><caption class="sr-only">الزيارات المتأثرة</caption><thead><tr><th>الزيارة</th><th>الموعد</th><th>قبل الموعد</th><th>القيمة المفتوحة</th><th>الرسوم</th><th>القاعدة</th></tr></thead><tbody>
      ${c.affected.map((a) => `<tr><td>${h(a.label)} ${a.origin && a.origin !== 'paid' ? badge(L.origin[a.origin] || a.origin, 'accent') : ''}${a.partial ? ' ' + badge('جزء من العمالة', 'info') : ''}<div class="muted small">${h((a.workers || []).join('، '))}</div></td><td>${a.start ? dts(a.start) : '—'}</td><td>${a.msBefore != null ? h(JK.durText(a.msBefore)) : '—'}</td><td>${money(a.open)}</td><td>${money(a.fee)}</td><td class="small">${h(a.rule)}${a.creditExpiry ? '<br>الصلاحية: ' + h(JK.fmtDate(a.creditExpiry)) : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '';
    return `<div class="calc">
      <div class="calc-rule"><span class="muted small">القاعدة المطبقة · ${h(L.precedence[c.rule ? c.rule.level : 3])}</span><strong>${h(c.rule ? c.rule.label : '—')}</strong>
        <span class="calc-outcome">${badge(outcomeText, c.outcome === 'cash_refund' ? 'success' : c.outcome === 'no_refund' ? 'muted' : 'info')}${c.needsReview && !opts.decided ? ' ' + badge('يتطلب مراجعة', 'warning') : ''}</span></div>
      ${c.reviewReasons.length && !opts.decided ? `<ul class="reasons">${c.reviewReasons.map((r) => `<li>${ic('info')}${h(r)}</li>`).join('')}</ul>` : ''}
      ${c.warnings.length ? `<ul class="reasons warn">${c.warnings.map((r) => `<li>${ic('alert')}${h(r)}</li>`).join('')}</ul>` : ''}
      <div class="calc-grid"><div>${kv(rows.map(([k, v]) => [k, v]))}</div><div>${sum}${dests}</div></div>
      <p class="jokrs-line">${ic('shield')}<span><b>رسوم JOKRS:</b> ${h(c.jokrs.text)}</span></p>
      ${visits}
      ${opts.noTrace ? '' : traceView(c)}
    </div>`;
  }
  function traceView(c) {
    if (!c.trace || !c.trace.length) return '';
    return `<details class="trace"><summary>تسلسل تطبيق القواعد (${c.trace.length})</summary><ol>${c.trace.map((t) => `<li class="${t.applied ? '' : 'skipped'}"><span class="lvl">${t.level}</span><span>${h(t.text)}</span></li>`).join('')}</ol>
      <p class="muted small">الأولوية الثابتة: 1) قيود المنصة الإلزامية والاستثناءات المعتمدة ← 2) قواعد خلل المكتب ← 3) سياسة الحجز المقبولة ← 4) فترة السماح ثم شريحة الوقت ← 5) القاعدة الاحتياطية.</p></details>`;
  }
  UI.calcView = calcView;

  function policyTextView(sections) {
    return `<div class="ptext">${sections.map((s) => `<section><h4>${h(s.title)}</h4><ul>${s.items.map((i) => `<li>${h(i)}</li>`).join('')}</ul></section>`).join('')}</div>`;
  }
  UI.policyTextView = policyTextView;

  /* =================================================================== */
  /* Overview                                                            */
  /* =================================================================== */
  UI.pages.overview = function () {
    const o = office(), at = now();
    const activePolicies = o.policies.filter((p) => !p.archived && JK.effectiveVersion(p, at)).length;
    const awaiting = o.requests.filter((r) => r.status === 'awaiting_review');
    const info = o.requests.filter((r) => r.status === 'info_requested');
    const proposals = o.requests.filter((r) => r.status === 'proposal_sent');
    const pendingRefunds = o.refunds.filter((r) => ['awaiting_review', 'approved', 'processing'].includes(r.state));
    const failed = o.refunds.filter((r) => r.state === 'failed');
    const rg = UI.kpiRange;
    const toDate = rg.to || JK.toRiyadhInput(at).slice(0, 10);
    const fromT = Date.parse(JK.riyadhISO(rg.from + ' 00:00')), toT = Date.parse(JK.riyadhISO(toDate + ' 23:59')) + 59999;
    const completedInRange = o.refunds.filter((r) => r.state === 'completed' && Date.parse(r.completedAt) >= fromT && Date.parse(r.completedAt) <= toT);
    const refundedSum = JK.sum(completedInRange.map((r) => r.components.total));
    const sumOf = (a) => JK.sum(a.map((r) => r.components.total));
    const kpi = (href, label, value, sub, tone) => `<a class="kpi kpi-${tone || 'neutral'}" href="${href}"><span class="kpi-label">${h(label)}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span><span class="kpi-go">${ic('chev')}<span class="sr-only">عرض التفاصيل</span></span></a>`;
    const recent = o.requests.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 6);
    const alerts = [];
    JK.store.uncovered(o, at).forEach((pk) => alerts.push(['danger', `"${pk.name}" معروضة للبيع دون سياسة صالحة.`, '#/assignments']));
    o.services.forEach((s) => s.packages.forEach((pk) => {
      const r = JK.resolvePolicy(o, pk.id, at);
      if (!pk.salesEnabled && !r.policy) alerts.push(['warning', `البيع متوقف لـ "${pk.name}" لعدم وجود سياسة صالحة (${r.tried.map((t) => t.text).filter((x) => x !== 'لا يوجد تخصيص').join('، ') || 'لا يوجد تخصيص'}).`, '#/assignments']);
      if (r.policy) {
        const nxt = JK.scheduledVersions(r.policy, at);
        if (nxt.length) alerts.push(['info', `"${pk.name}": النسخة ${nxt[0].version} من "${r.policy.name}" تسري ${JK.fmtDT(nxt[0].effectiveFrom)} للحجوزات الجديدة فقط.`, '#/policies/' + r.policy.id]);
      }
    }));
    o.policies.forEach((p) => p.versions.forEach((v) => {
      if (v.status === 'pending_review') alerts.push(['warning', `"${p.name}" النسخة ${v.version} بانتظار مراجعة المنصة.`, '#/policies/' + p.id]);
      if (v.status === 'rejected') alerts.push(['danger', `"${p.name}" النسخة ${v.version}: طلبت المنصة تعديلات.`, '#/policies/' + p.id]);
    }));
    const seen = {}; const uniq = alerts.filter((a) => { if (seen[a[1]]) return false; seen[a[1]] = 1; return true; });
    return `${pageHead('نظرة عامة', `${h(o.office.profile)} · الوقت الحالي (محاكاة): ${dt(at)}`)}
      <section class="kpis" aria-label="مؤشرات">
        ${kpi('#/policies?status=published', 'السياسات المنشورة السارية', activePolicies, 'من أصل ' + o.policies.filter((p) => !p.archived).length + ' سياسة غير مؤرشفة', 'info')}
        ${kpi('#/requests?status=awaiting_review', 'طلبات بانتظار المراجعة', awaiting.length, `${info.length} بانتظار معلومات · ${proposals.length} بانتظار رد العميل`, awaiting.length ? 'warning' : 'neutral')}
        ${kpi('#/refunds?state=pending', 'مبالغ بانتظار التنفيذ', money(sumOf(pendingRefunds)), pendingRefunds.length + ' عملية (غير مكتملة — لا تُحتسب مستردة)', 'info')}
        ${kpi('#/refunds?state=failed', 'استردادات فاشلة تحتاج إجراء', failed.length, failed.length ? money(sumOf(failed)) + ' معلّقة' : 'لا يوجد', failed.length ? 'danger' : 'neutral')}
        <div class="kpi kpi-success kpi-range">
          <a class="kpi-link" href="#/refunds?state=completed&from=${h(rg.from)}&to=${h(toDate)}"><span class="kpi-label">المبلغ المسترد فعلياً</span><span class="kpi-value">${money(refundedSum)}</span><span class="kpi-sub">${completedInRange.length} عملية مكتملة فقط</span></a>
          <div class="range"><label>من <input type="date" id="kpi-from" value="${h(rg.from)}" data-on-change="kpi-range"></label><label>إلى <input type="date" id="kpi-to" value="${h(toDate)}" data-on-change="kpi-range"></label></div>
        </div>
      </section>
      <div class="grid-2 wide-left">
        <section class="card"><div class="card-head"><h2>أحدث الطلبات</h2><a href="#/requests" class="link">كل الطلبات</a></div>
          ${recent.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الطلب</th><th>العميل</th><th>النوع</th><th>الحالة</th><th>وقت الطلب</th></tr></thead><tbody>
          ${recent.map((r) => `<tr><td><a href="#/requests/${h(r.id)}">${h(r.ref)}</a><div class="muted small">${h(r.bookingRef)}</div></td><td>${h(r.customerName)}</td><td>${h(L.requestType[r.type])}</td><td>${reqBadge(r.status)}</td><td>${dts(r.requestedAt)}</td></tr>`).join('')}
          </tbody></table></div>` : empty('لا توجد طلبات بعد', 'ستظهر هنا طلبات الإلغاء والتعديل.')}
        </section>
        <section class="card"><div class="card-head"><h2>تنبيهات ربط السياسات</h2><a href="#/assignments" class="link">إدارة الربط</a></div>
          ${uniq.length ? `<ul class="alerts">${uniq.map(([t, m, href]) => `<li class="alert-${t}">${ic(t === 'info' ? 'info' : 'alert')}<a href="${href}">${h(m)}</a></li>`).join('')}</ul>` : empty('لا توجد تنبيهات', 'كل الباقات المعروضة للبيع لها سياسة صالحة.')}
        </section>
      </div>`;
  };
  UI.act['kpi-range'] = () => {
    const f = UI.inputVal('kpi-from'), t = UI.inputVal('kpi-to');
    if (f && t && f > t) { toast('تاريخ البداية يجب أن يسبق تاريخ النهاية.', 'danger'); return; }
    UI.kpiRange = { from: f || '2026-01-01', to: t };
    render();
  };

  /* =================================================================== */
  /* Policies list                                                       */
  /* =================================================================== */
  UI.pages.policies = function () {
    const o = office(), at = now(), f = UI.filters.policies;
    let list = o.policies.slice();
    if (f.q) list = list.filter((p) => (p.name + ' ' + p.id).includes(f.q));
    if (f.type) list = list.filter((p) => p.bookingType === f.type);
    if (f.status) list = list.filter((p) => { const st = policyStatus(p, at).key; const ov = openVersion(p); return st === f.status || (ov && ov.status === f.status); });
    const rows = list.map((p) => {
      const st = policyStatus(p, at), ov = openVersion(p);
      const links = o.assignments.filter((a) => a.policyId === p.id);
      const cur = JK.effectiveVersion(p, at) || p.versions.filter((v) => v.status === 'published').slice(-1)[0];
      const lastUpd = p.versions.reduce((m, v) => Math.max(m, Date.parse(v.publishedAt || v.submittedAt || v.createdAt)), 0);
      const actions = [`<a class="btn btn-ghost btn-sm" href="#/policies/${h(p.id)}">${ic('eye')}<span>عرض</span></a>`];
      if (!p.archived) {
        if (ov && ['draft', 'rejected'].includes(ov.status)) actions.push(UI.can('policy.manage') ? `<a class="btn btn-ghost btn-sm" href="#/policies/${h(p.id)}/edit/${ov.version}">${ic('edit')}<span>تحرير المسودة v${ov.version}</span></a>` : btn({ label: 'تحرير المسودة', icon: 'edit', kind: 'ghost', small: true, perm: 'policy.manage' }));
        else if (!ov) actions.push(btn({ label: 'نسخة جديدة', icon: 'edit', kind: 'ghost', small: true, perm: 'policy.manage', act: 'policy-newver', data: { id: p.id } }));
        actions.push(btn({ label: 'أرشفة', icon: 'archive', kind: 'ghost', small: true, perm: 'policy.manage', act: 'policy-archive', data: { id: p.id } }));
      }
      actions.push(btn({ label: 'تكرار', icon: 'copy', kind: 'ghost', small: true, perm: 'policy.manage', act: 'policy-dup', data: { id: p.id } }));
      return `<tr>
        <td><a href="#/policies/${h(p.id)}" class="strong">${h(p.name)}</a><div class="muted small">${h(p.id)}</div></td>
        <td>${h(L.bookingType[p.bookingType])}</td>
        <td>${links.length ? `<ul class="mini-list">${links.map((a) => `<li>${h(targetLabel(o, a))}</li>`).join('')}</ul>` : '<span class="muted">غير مرتبطة</span>'}</td>
        <td>${cur ? 'v' + cur.version : '—'}${JK.scheduledVersions(p, at).filter((x) => !cur || x.version !== cur.version).map((x) => `<div class="small">${badge('v' + x.version + ' تسري ' + JK.fmtDTs(x.effectiveFrom), 'info')}</div>`).join('')}${ov ? `<div class="small">${badge('v' + ov.version + ' ' + L.versionStatus[ov.status], TONES.version[ov.status])}</div>` : ''}</td>
        <td>${badge(st.label, st.tone)}</td>
        <td>${cur ? dts(cur.effectiveFrom) : (st.v ? dts(st.v.effectiveFrom) : '—')}</td>
        <td>${dts(new Date(lastUpd).toISOString())}</td>
        <td><div class="row-actions">${actions.join('')}</div></td></tr>`;
    }).join('');
    const sel = (id, label, opts, val) => `<label class="field-inline"><span>${label}</span><select id="${id}" data-on-change="pol-filter" data-key="${id.replace('pf-', '')}"><option value="">الكل</option>${opts.map(([v, l]) => `<option value="${v}"${val === v ? ' selected' : ''}>${h(l)}</option>`).join('')}</select></label>`;
    return `${pageHead('السياسات', 'سياسات الإلغاء والاسترداد وإعادة الجدولة الخاصة بالمكتب. النسخ المنشورة ثابتة؛ أي تعديل ينشئ نسخة جديدة.', btn({ label: 'سياسة جديدة', icon: 'plus', kind: 'primary', perm: 'policy.manage', act: 'policy-new' }))}
      ${permNote(['policy.manage'])}
      <div class="filters" role="search">
        <label class="field-inline grow"><span class="sr-only">بحث</span>${ic('search')}<input id="pf-q" type="search" placeholder="ابحث بالاسم أو الرمز" value="${h(f.q || '')}" data-on-input="pol-filter" data-key="q"></label>
        ${sel('pf-type', 'نوع الحجز', Object.entries(L.bookingType), f.type)}
        ${sel('pf-status', 'الحالة', [['published', 'منشورة سارية'], ['scheduled', 'تسري لاحقاً'], ['draft', 'مسودة'], ['pending_review', 'بانتظار المراجعة'], ['rejected', 'مطلوب تعديلات'], ['archived', 'مؤرشفة']], f.status)}
      </div>
      <section class="card flush">${rows ? `<div class="table-wrap"><table class="tbl"><caption class="sr-only">قائمة السياسات</caption><thead><tr><th>الاسم</th><th>نوع الحجز</th><th>الخدمات/الباقات المرتبطة</th><th>النسخة الحالية</th><th>الحالة</th><th>تاريخ السريان</th><th>آخر تحديث</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : empty('لا توجد سياسات مطابقة', 'جرّب تغيير الفلاتر.', `<button class="btn btn-secondary" data-act="pol-clear">مسح الفلاتر</button>`)}</section>`;
  };
  UI.act['pol-filter'] = (el) => { UI.filters.policies[el.dataset.key] = el.value; render(); };
  UI.act['pol-clear'] = () => { UI.filters.policies = {}; go('/policies'); };
  UI.act['policy-new'] = () => {
    openModal({
      title: 'سياسة جديدة', size: 'sm',
      body: `<form id="dlg-form" data-submit="policy-new-submit" class="form">
        <label class="field"><span>اسم السياسة بالعربية</span><input name="name" id="np-name" required minlength="3" placeholder="مثال: سياسة الباقات الشهرية"></label>
        <fieldset class="field"><legend>نوع الحجز المطبق</legend>${Object.entries(L.bookingType).map(([k, l], i) => `<label class="radio"><input type="radio" name="type" value="${k}"${i === 0 ? ' checked' : ''}> ${h(l)}</label>`).join('')}</fieldset>
        <p class="muted small">تبدأ السياسة كمسودة بإعدادات افتراضية آمنة، ثم تكمل الخطوات الست في المحرر.</p></form>`,
      foot: `<button class="btn btn-secondary" data-act="modal-close" type="button">إلغاء</button><button class="btn btn-primary" type="submit" form="dlg-form">إنشاء ومتابعة</button>`
    });
  };
  UI.act['policy-new-submit'] = (f) => {
    const r = run('createPolicy', { name: f.elements.name.value, bookingType: f.elements.type.value });
    if (r.ok) { closeModal(true); toast('أُنشئت مسودة السياسة.', 'success'); go(`/policies/${r.res.id}/edit/1`); }
  };
  UI.act['policy-dup'] = (el) => { const r = run('duplicatePolicy', { policyId: el.dataset.id }, 'أُنشئت نسخة مكررة كمسودة.'); if (r.ok) go(`/policies/${r.res.id}/edit/1`); };
  UI.act['policy-newver'] = (el) => { const r = run('newVersion', { policyId: el.dataset.id }, (v) => `أُنشئت النسخة ${v.version} كمسودة. النسخ المنشورة لم تتغير.`); if (r.ok) go(`/policies/${el.dataset.id}/edit/${r.res.version}`); };
  UI.act['policy-archive'] = (el) => {
    const o = office(), p = byId(o.policies, el.dataset.id), at = now();
    const refs = o.assignments.filter((a) => a.policyId === p.id);
    const alts = o.policies.filter((x) => x.id !== p.id && !x.archived && x.bookingType === p.bookingType && JK.effectiveVersion(x, at));
    openModal({
      title: 'أرشفة: ' + p.name, size: 'md',
      body: `<form id="dlg-form" data-submit="policy-archive-submit" data-id="${h(p.id)}" class="form">
        <p>الأرشفة تمنع الربط والاستخدام للحجوزات الجديدة، وتحفظ كل النسخ والسجل. الحجوزات الحالية تحتفظ بلقطاتها المقبولة.</p>
        ${refs.length ? `<div class="note note-warning">${ic('alert')}<div>السياسة مرتبطة بـ: ${h(refs.map((a) => targetLabel(o, a)).join('، '))}. يجب اختيار بديل أو إيقاف البيع حتى لا تبقى خدمة معروضة دون سياسة.</div></div>
        <label class="field"><span>سياسة بديلة (نفس نوع الحجز ولها نسخة سارية)</span><select name="replacement"><option value="">— بدون بديل —</option>${alts.map((x) => `<option value="${h(x.id)}">${h(x.name)}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="disable"> إيقاف البيع للباقات التي ستبقى دون سياسة صالحة</label>` : '<p class="muted">السياسة غير مرتبطة بأي خدمة أو باقة.</p>'}
        <label class="field"><span>سبب الأرشفة (للسجل)</span><input name="reason" placeholder="مثال: استُبدلت بسياسة 2027"></label></form>`,
      foot: `<button class="btn btn-secondary" data-act="modal-close" type="button">إلغاء</button><button class="btn btn-danger" type="submit" form="dlg-form">أرشفة</button>`
    });
  };
  UI.act['policy-archive-submit'] = (f) => {
    const r = run('archivePolicy', { policyId: f.dataset.id, replacementPolicyId: f.elements.replacement ? f.elements.replacement.value || null : null, disableSales: f.elements.disable ? f.elements.disable.checked : false, reason: f.elements.reason.value }, 'أُرشفت السياسة وحُفظ سجلها.');
    if (r.ok) closeModal();
  };

  /* =================================================================== */
  /* Policy view                                                         */
  /* =================================================================== */
  UI.pages.policyView = function (id) {
    const o = office(), p = byId(o.policies, id), at = now();
    if (!p) return empty('السياسة غير موجودة في هذا المكتب', 'كل مكتب يرى سياساته فقط.', `<a class="btn btn-primary" href="#/policies">العودة للسياسات</a>`);
    if (!UI.pv || UI.pv.id !== id) {
      const cur = JK.effectiveVersion(p, at) || p.versions[p.versions.length - 1];
      UI.pv = { id, v: cur.version, a: Math.max(1, cur.version - 1), b: cur.version, onlyChanged: true };
    }
    const q = UI.route.query; if (q.v) { UI.pv.v = parseInt(q.v, 10); UI.route.query = {}; }
    const v = p.versions.find((x) => x.version === UI.pv.v) || p.versions[p.versions.length - 1];
    const st = policyStatus(p, at), ov = openVersion(p);
    const links = o.assignments.filter((a) => a.policyId === p.id);
    const bookings = o.bookings.filter((b) => b.policySnapshot.policyId === p.id);
    const vs = versionState(p, v, at);
    const restricted = JK.restrictedReasons(v.rules, p.bookingType, S.state.platform);
    const actions = [];
    if (!p.archived) {
      if (ov && ['draft', 'rejected'].includes(ov.status)) actions.push(UI.can('policy.manage') ? `<a class="btn btn-primary" href="#/policies/${h(p.id)}/edit/${ov.version}">${ic('edit')}<span>تحرير المسودة v${ov.version}</span></a>` : btn({ label: 'تحرير المسودة', icon: 'edit', kind: 'primary', perm: 'policy.manage' }));
      else if (!ov) actions.push(btn({ label: 'تعديل (نسخة جديدة)', icon: 'edit', kind: 'primary', perm: 'policy.manage', act: 'policy-newver', data: { id: p.id } }));
      actions.push(btn({ label: 'أرشفة', icon: 'archive', perm: 'policy.manage', act: 'policy-archive', data: { id: p.id } }));
    }
    actions.push(btn({ label: 'تكرار', icon: 'copy', perm: 'policy.manage', act: 'policy-dup', data: { id: p.id } }));
    const va = p.versions.find((x) => x.version === UI.pv.a), vb = p.versions.find((x) => x.version === UI.pv.b);
    const diff = va && vb ? JK.diffVersions(p.bookingType, va, vb).filter((d) => !UI.pv.onlyChanged || d.changed) : [];
    const verOpts = (sel) => p.versions.map((x) => `<option value="${x.version}"${x.version === sel ? ' selected' : ''}>النسخة ${x.version} — ${h(versionState(p, x, at).label)}</option>`).join('');
    return `<nav class="crumbs" aria-label="مسار التنقل"><a href="#/policies">السياسات</a> ${ic('chev')} <span>${h(p.name)}</span></nav>
      ${pageHead(p.name, `${h(p.id)} · ${h(L.bookingType[p.bookingType])} · ${badge(st.label, st.tone)}`, actions.join(''))}
      <div class="ver-pills" role="tablist" aria-label="النسخ">${p.versions.map((x) => `<button type="button" role="tab" aria-selected="${x.version === v.version}" class="pill${x.version === v.version ? ' active' : ''}" data-act="pv-ver" data-v="${x.version}">v${x.version} ${badge(versionState(p, x, at).label, versionState(p, x, at).tone)}</button>`).join('')}</div>
      <div class="grid-2 wide-left">
        <section class="card"><div class="card-head"><h2>النسخة ${v.version}</h2>${badge(vs.label, vs.tone)}</div>
          ${kv([['الاسم', h(v.name)], ['الوصف الداخلي', h(v.description || '—')], ['سارية من', dt(v.effectiveFrom)], ['تنتهي', v.effectiveTo ? dt(v.effectiveTo) : 'مفتوحة'], ['أنشأها', h(v.createdBy || '—') + ' · ' + dts(v.createdAt)],
            ['النشر', v.publishedAt ? dts(v.publishedAt) + (v.platformApproved ? ' — باعتماد المنصة' : ' — نشر مباشر') : '—'], v.basedOn ? ['مبنية على', 'النسخة ' + v.basedOn] : null, v.reviewNote ? ['ملاحظة المنصة', `<span class="text-danger">${h(v.reviewNote)}</span>`] : null])}
          ${restricted.length ? `<div class="note note-info">${ic('shield')}<div><b>${v.platformApproved ? 'قواعد مقيدة — اعتمدتها المنصة لهذه النسخة:' : 'قواعد تتطلب مراجعة المنصة:'}</b><ul>${restricted.map((r) => `<li>${h(r)}</li>`).join('')}</ul></div></div>` : ''}
          <h3 class="h3">الصياغة المعروضة للعميل (مولّدة من القواعد)</h3>
          ${policyTextView(JK.policyText(v.rules, p.bookingType, S.state.platform))}
          ${v.customerTextEn ? `<h3 class="h3">English customer text (optional)</h3><p dir="ltr" class="en-text">${h(v.customerTextEn)}</p>` : ''}
        </section>
        <div class="stack">
          <section class="card"><div class="card-head"><h2>الربط الحالي</h2><a class="link" href="#/assignments">إدارة الربط</a></div>
            ${links.length ? `<ul class="mini-list">${links.map((a) => `<li>${h(targetLabel(o, a))}</li>`).join('')}</ul>` : '<p class="muted">غير مرتبطة بأي خدمة أو باقة.</p>'}</section>
          <section class="card"><div class="card-head"><h2>الحجوزات ولقطات النسخ</h2></div>
            <p class="muted small">كل حجز يحتفظ بنسخة السياسة التي قبلها العميل؛ النسخ الأحدث لا تُطبّق بأثر رجعي.</p>
            ${bookings.length ? `<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>الحجز</th><th>العميل</th><th>النسخة المقبولة</th><th>وقت القبول</th></tr></thead><tbody>
            ${bookings.map((b) => `<tr><td>${h(b.ref)}</td><td>${h(b.customerName)}</td><td>${badge('v' + b.policySnapshot.version, b.policySnapshot.version === (JK.effectiveVersion(p, at) || {}).version ? 'success' : 'accent')}</td><td>${dts(b.policySnapshot.acceptedAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا توجد حجوزات على هذه السياسة.</p>'}
          </section>
        </div>
      </div>
      <section class="card"><div class="card-head"><h2>سجل النسخ والمقارنة</h2></div>
        <div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>النسخة</th><th>الحالة</th><th>تسري من</th><th>أُرسلت</th><th>نُشرت</th><th>أنشأها</th></tr></thead><tbody>
          ${p.versions.slice().reverse().map((x) => `<tr><td>v${x.version}</td><td>${badge(versionState(p, x, at).label, versionState(p, x, at).tone)}</td><td>${dts(x.effectiveFrom)}</td><td>${x.submittedAt ? dts(x.submittedAt) : '—'}</td><td>${x.publishedAt ? dts(x.publishedAt) : '—'}</td><td>${h(x.createdBy || '—')}</td></tr>`).join('')}
        </tbody></table></div>
        ${p.versions.length > 1 ? `<div class="compare-bar"><label class="field-inline"><span>من</span><select id="pv-a" data-on-change="pv-cmp" data-k="a">${verOpts(UI.pv.a)}</select></label><label class="field-inline"><span>إلى</span><select id="pv-b" data-on-change="pv-cmp" data-k="b">${verOpts(UI.pv.b)}</select></label>
          <label class="check"><input type="checkbox" id="pv-only" data-on-change="pv-only"${UI.pv.onlyChanged ? ' checked' : ''}> التغييرات فقط</label></div>
          ${diff.length ? `<div class="table-wrap"><table class="tbl tbl-compact diff"><caption class="sr-only">مقارنة النسخ</caption><thead><tr><th>البند</th><th>النسخة ${UI.pv.a}</th><th>النسخة ${UI.pv.b}</th></tr></thead><tbody>${diff.map((d) => `<tr class="${d.changed ? 'changed' : ''}"><th scope="row">${h(d.label)}</th><td>${h(d.a)}</td><td>${h(d.b)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا توجد فروقات بين النسختين المختارتين.</p>'}` : '<p class="muted">نسخة واحدة فقط — لا توجد مقارنة.</p>'}
      </section>`;
  };
  UI.act['pv-ver'] = (el) => { UI.pv.v = parseInt(el.dataset.v, 10); render(); };
  UI.act['pv-cmp'] = (el) => { UI.pv[el.dataset.k] = parseInt(el.value, 10); render(); };
  UI.act['pv-only'] = (el) => { UI.pv.onlyChanged = el.checked; render(); };

  /* =================================================================== */
  /* Assignments                                                         */
  /* =================================================================== */
  UI.pages.assignments = function () {
    const o = office(), at = now();
    const find = (level, target) => o.assignments.find((a) => a.level === level && (a.targetId || null) === (target || null));
    const pName = (a) => { if (!a) return '<span class="muted">— وراثة —</span>'; const p = byId(o.policies, a.policyId); return p ? `<a href="#/policies/${h(p.id)}">${h(p.name)}</a>${p.archived ? ' ' + badge('مؤرشفة', 'muted') : ''}` : '—'; };
    const def = find('office_default', null);
    const services = o.services.map((s) => {
      const sa = find('service', s.id);
      const rows = s.packages.map((pk) => {
        const pa = find('package', pk.id), r = JK.resolvePolicy(o, pk.id, at);
        const warns = [];
        if (!r.policy) warns.push(badge('لا توجد سياسة صالحة', 'danger'));
        r.tried.filter((t) => ['type_mismatch', 'archived', 'no_published', 'conflict'].includes(t.status)).forEach((t) => warns.push(`<div class="small text-warning">${ic('alert')} ${h(JK.LEVEL_LABEL[t.level] + ': ' + t.text)}</div>`));
        if (!pk.salesEnabled) warns.push(badge('البيع متوقف', 'warning'));
        const nxt = r.policy ? JK.scheduledVersions(r.policy, at) : [];
        const eff = r.policy ? `v${r.version.version} · سارية منذ ${h(JK.fmtDTs(r.version.effectiveFrom))}${nxt.length ? `<div class="small">${badge('v' + nxt[0].version + ' تسري ' + JK.fmtDTs(nxt[0].effectiveFrom), 'info')}</div>` : ''}` : '—';
        const nB = o.bookings.filter((b) => b.packageId === pk.id).length;
        return `<tr>
          <td><strong>${h(pk.name)}</strong><div class="muted small">${h(pk.id)}</div></td>
          <td>${h(L.bookingType[pk.bookingType])}</td>
          <td>${pName(pa)}</td>
          <td>${r.policy ? `<a href="#/policies/${h(r.policy.id)}">${h(r.policy.name)}</a> ${badge(r.sourceLabel, SOURCE_TONE[r.source])}` : '<span class="text-danger">غير محددة</span>'}</td>
          <td>${eff}</td>
          <td>${warns.join(' ') || badge('مغطاة', 'success')}</td>
          <td><div class="row-actions">${btn({ label: 'تغيير', icon: 'edit', kind: 'ghost', small: true, perm: 'assignment.manage', act: 'as-edit', data: { level: 'package', target: pk.id } })}
            ${btn({ label: `الحجوزات (${nB})`, icon: 'eye', kind: 'ghost', small: true, act: 'as-bookings', data: { pkg: pk.id } })}
            ${btn({ label: pk.salesEnabled ? 'إيقاف البيع' : 'تفعيل البيع', kind: 'ghost', small: true, perm: 'assignment.manage', act: 'as-sales', data: { pkg: pk.id, on: pk.salesEnabled ? '0' : '1' } })}</div></td></tr>`;
      }).join('');
      return `<section class="card flush"><div class="card-head pad"><div><h2>${h(s.name)}</h2><p class="muted small">سياسة الخدمة: ${pName(sa)}</p></div>${btn({ label: 'سياسة الخدمة', icon: 'edit', small: true, perm: 'assignment.manage', act: 'as-edit', data: { level: 'service', target: s.id } })}</div>
        <div class="table-wrap"><table class="tbl"><caption class="sr-only">باقات ${h(s.name)}</caption><thead><tr><th>الباقة</th><th>نوع الحجز</th><th>تخصيص الباقة</th><th>السياسة المطبقة ومصدرها</th><th>النسخة / السريان</th><th>التغطية</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join('');
    return `${pageHead('ربط السياسات', 'ترتيب الحسم ثابت: تخصيص الباقة ← سياسة الخدمة ← السياسة الافتراضية للمكتب. تُطبّق سياسة واحدة كاملة دون دمج بنود من عدة سياسات، وتُضاف إليها قواعد رسوم JOKRS وقيود المنصة الإلزامية بشكل منفصل.')}
      ${permNote(['assignment.manage'])}
      <div class="note note-info">${ic('info')}<div>تغيير الربط يؤثر على الحجوزات الجديدة فقط. الحجوزات الحالية تحتفظ بنسخة السياسة المقبولة — استعرضها من زر "الحجوزات".</div></div>
      <section class="card"><div class="card-head"><div><h2>السياسة الافتراضية للمكتب</h2><p class="muted small">تُستخدم عند عدم وجود تخصيص للباقة أو الخدمة، وبشرط تطابق نوع الحجز.</p></div>${btn({ label: 'تغيير', icon: 'edit', small: true, perm: 'assignment.manage', act: 'as-edit', data: { level: 'office_default', target: '' } })}</div>
        <p>${pName(def)}</p></section>
      ${services}`;
  };
  UI.act['as-edit'] = (el) => {
    const o = office(), level = el.dataset.level, target = el.dataset.target || null, at = now();
    const cur = o.assignments.find((a) => a.level === level && (a.targetId || null) === target);
    let type = null, label = 'افتراضي المكتب';
    if (level === 'package') { const f = JK.findPackage(o, target); type = f.pkg.bookingType; label = 'باقة: ' + f.pkg.name; }
    if (level === 'service') { const s = byId(o.services, target); label = 'خدمة: ' + s.name; }
    const opts = o.policies.filter((p) => !p.archived && p.versions.some((v) => v.status === 'published') && (!type || p.bookingType === type));
    const chain = level === 'package' ? JK.resolvePolicy(o, target, at) : null;
    openModal({
      title: 'ربط سياسة — ' + label, size: 'md',
      body: `<form id="dlg-form" data-submit="as-save" data-level="${h(level)}" data-target="${h(target || '')}" class="form">
        <label class="field"><span>السياسة</span><select name="policy"><option value="">— بدون تخصيص (وراثة من المستوى الأعلى) —</option>${opts.map((p) => `<option value="${h(p.id)}"${cur && cur.policyId === p.id ? ' selected' : ''}>${h(p.name)} — ${h(L.bookingType[p.bookingType])}${JK.effectiveVersion(p, at) ? '' : ' (تسري لاحقاً)'}</option>`).join('')}</select></label>
        ${type ? `<p class="muted small">تظهر فقط السياسات المنشورة من نوع "${h(L.bookingType[type])}". لا يمكن ربط سياستين بنفس المستوى.</p>` : '<p class="muted small">لا تُطبّق السياسة إلا على الباقات المطابقة لنوعها.</p>'}
        ${chain ? `<h3 class="h3">مسار الحسم الحالي</h3><ol class="chain">${chain.tried.map((t) => `<li class="st-${t.status}">${h(JK.LEVEL_LABEL[t.level])}: ${h(t.text)}${t.policy ? ' — ' + h(t.policy.name) : ''}</li>`).join('')}</ol>` : ''}
        <label class="check"><input type="checkbox" name="disable"> إذا ترك التغيير باقة معروضة دون سياسة صالحة: أوقف بيعها بدلاً من رفض التغيير</label>
        <div class="note note-info">${ic('info')}<div>يُطبّق على الحجوزات الجديدة فقط.</div></div></form>`,
      foot: `<button class="btn btn-secondary" data-act="modal-close" type="button">إلغاء</button><button class="btn btn-primary" type="submit" form="dlg-form">حفظ الربط</button>`
    });
  };
  UI.act['as-save'] = (f) => {
    const r = run('setAssignment', { level: f.dataset.level, targetId: f.dataset.target || null, policyId: f.elements.policy.value || null, disableSalesIfUncovered: f.elements.disable.checked }, 'حُفظ الربط. الحجوزات الحالية لم تتأثر.');
    if (r.ok) closeModal();
  };
  UI.act['as-sales'] = (el) => { run('setSales', { packageId: el.dataset.pkg, enabled: el.dataset.on === '1' }, el.dataset.on === '1' ? 'فُعّل البيع.' : 'أُوقف البيع للحجوزات الجديدة.'); };
  UI.act['as-bookings'] = (el) => {
    const o = office(), f = JK.findPackage(o, el.dataset.pkg), at = now();
    const r = JK.resolvePolicy(o, f.pkg.id, at);
    const list = o.bookings.filter((b) => b.packageId === f.pkg.id);
    openModal({
      title: 'الحجوزات الحالية — ' + f.pkg.name, drawer: true,
      body: `<p>السياسة للحجوزات الجديدة الآن: <b>${r.policy ? h(r.policy.name + ' — v' + r.version.version) : 'لا توجد'}</b>.</p>
        ${list.length ? `<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>الحجز</th><th>العميل</th><th>السياسة المقبولة</th><th>الحالة</th></tr></thead><tbody>
        ${list.map((b) => { const same = r.policy && b.policySnapshot.policyId === r.policy.id && b.policySnapshot.version === r.version.version;
          return `<tr><td>${h(b.ref)}<div class="muted small">${dts(b.createdAt)}</div></td><td>${h(b.customerName)}</td><td>${h(b.policySnapshot.policyName)} ${badge('v' + b.policySnapshot.version, same ? 'success' : 'accent')}</td><td>${same ? 'مطابقة للحالية' : 'تحتفظ بنسخة أقدم/مختلفة'}</td></tr>`; }).join('')}</tbody></table></div>` : empty('لا توجد حجوزات', 'لم تُحجز هذه الباقة بعد.')}`
    });
  };

  /* =================================================================== */
  /* Requests list                                                       */
  /* =================================================================== */
  function requestMoney(r, o) {
    if (r.refundId) { const rf = byId(o.refunds, r.refundId); return rf ? money(rf.components.total) : '—'; }
    if (['approved', 'auto_approved', 'rejected'].includes(r.status)) return '<span class="muted">—</span>';
    const b = byId(o.bookings, r.bookingId);
    try { const c = JK.calculate({ booking: b, platform: S.state.platform, req: { type: r.type, baseType: r.baseType, at: r.requestedAt, visitIds: r.visitIds, workerIds: r.workerIds, initiator: r.initiator, cause: r.cause, remedy: r.remedy, deliveredWorkerIds: r.deliveredWorkerIds, evidence: r.evidence, disputed: r.disputed, reasonCode: r.reasonCode, waiver: r.waiver, newStart: r.newStart, qualityAmount: r.qualityAmount } });
      return c.ok ? `<span class="muted small">متوقع</span> ${money(c.totalRefund)}` : '—'; } catch (e) { return '—'; }
  }
  UI.pages.requests = function () {
    const o = office(), f = UI.filters.requests;
    let list = o.requests.slice().sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
    if (f.type) list = list.filter((r) => r.type === f.type || r.baseType === f.type);
    if (f.status === 'open') list = list.filter((r) => ['awaiting_review', 'info_requested', 'proposal_sent'].includes(r.status));
    else if (f.status) list = list.filter((r) => r.status === f.status);
    if (f.btype) list = list.filter((r) => r.bookingType === f.btype);
    if (f.cause) list = list.filter((r) => r.cause === f.cause);
    if (f.customer) list = list.filter((r) => r.customerName.includes(f.customer));
    if (f.ref) list = list.filter((r) => (r.bookingRef + ' ' + r.ref).toUpperCase().includes(f.ref.toUpperCase()));
    if (f.from) list = list.filter((r) => Date.parse(r.requestedAt) >= Date.parse(JK.riyadhISO(f.from + ' 00:00')));
    if (f.to) list = list.filter((r) => Date.parse(r.requestedAt) <= Date.parse(JK.riyadhISO(f.to + ' 23:59')) + 59999);
    const sel = (key, label, opts) => `<label class="field-inline"><span>${label}</span><select id="rf-${key}" data-on-change="rq-filter" data-key="${key}"><option value="">الكل</option>${opts.map(([v, l]) => `<option value="${v}"${f[key] === v ? ' selected' : ''}>${h(l)}</option>`).join('')}</select></label>`;
    const rows = list.map((r) => `<tr>
      <td><a href="#/requests/${h(r.id)}" class="strong">${h(r.ref)}</a></td><td>${h(r.bookingRef)}<div class="muted small">${h(L.bookingType[r.bookingType])}</div></td><td>${h(r.customerName)}</td>
      <td>${h(L.requestType[r.type])}${r.baseType ? `<div class="muted small">على: ${h(L.requestType[r.baseType])}</div>` : ''}</td><td>${reqBadge(r.status)}${r.disputed ? ' ' + badge('متنازع عليه', 'danger') : ''}</td>
      <td>${dts(r.requestedAt)}</td><td>${h(L.initiator[r.initiator])} / ${h(L.cause[r.cause] || '—')}</td><td>${requestMoney(r, o)}</td></tr>`).join('');
    const active = Object.values(f).some(Boolean);
    return `${pageHead('طلبات الإلغاء والتعديل', 'طلبات العملاء وإجراءات المكتب. حالة الطلب منفصلة عن حالة الاسترداد المالي.', btn({ label: 'تسجيل إجراء من المكتب', icon: 'plus', kind: 'primary', perm: 'request.office', act: 'rq-office-new' }))}
      ${permNote(['request.review'])}
      <div class="filters" role="search">
        ${sel('type', 'النوع', Object.entries(L.requestType))}
        ${sel('status', 'الحالة', [['open', 'كل المفتوحة']].concat(Object.entries(L.requestStatus)))}
        ${sel('btype', 'نوع الحجز', Object.entries(L.bookingType))}
        ${sel('cause', 'الطرف المسؤول', [['customer', 'العميل'], ['office', 'المكتب'], ['disputed', 'متنازع عليه'], ['external', 'ظرف خارجي']])}
        <label class="field-inline"><span>من</span><input type="date" id="rf-from" value="${h(f.from || '')}" data-on-change="rq-filter" data-key="from"></label>
        <label class="field-inline"><span>إلى</span><input type="date" id="rf-to" value="${h(f.to || '')}" data-on-change="rq-filter" data-key="to"></label>
        <label class="field-inline"><span>العميل</span><input type="search" id="rf-customer" value="${h(f.customer || '')}" data-on-input="rq-filter" data-key="customer" placeholder="اسم العميل"></label>
        <label class="field-inline"><span>المرجع</span><input type="search" id="rf-ref" value="${h(f.ref || '')}" data-on-input="rq-filter" data-key="ref" placeholder="BK-… أو R-…" dir="ltr"></label>
        ${active ? `<button type="button" class="btn btn-ghost btn-sm" data-act="rq-clear">${ic('x')}<span>مسح الفلاتر</span></button>` : ''}
      </div>
      <p class="muted small" aria-live="polite">${list.length} طلب</p>
      <section class="card flush">${rows ? `<div class="table-wrap"><table class="tbl"><caption class="sr-only">الطلبات</caption><thead><tr><th>الطلب</th><th>الحجز</th><th>العميل</th><th>النوع</th><th>الحالة</th><th>وقت الطلب</th><th>المبادر / المسؤول</th><th>المبلغ</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : empty('لا توجد طلبات مطابقة للفلاتر', 'غيّر الفلاتر أو امسحها لعرض كل الطلبات.', `<button class="btn btn-secondary" data-act="rq-clear">مسح الفلاتر</button>`)}</section>`;
  };
  UI.act['rq-filter'] = (el) => { UI.filters.requests[el.dataset.key] = el.value; render(); };
  UI.act['rq-clear'] = () => { UI.filters.requests = {}; if (location.hash !== '#/requests') go('/requests'); else render(); };

  UI.act['rq-office-new'] = () => {
    const o = office();
    const bks = o.bookings.filter((b) => b.visits.some((v) => ['scheduled', 'completed'].includes(v.status)));
    UI.officeForm = UI.officeForm || { bookingId: bks[0] && bks[0].id, type: 'office_cancel' };
    const body = () => {
      const fm = UI.officeForm, b = byId(o.bookings, fm.bookingId);
      const types = [['office_cancel', 'إلغاء/تعذّر من المكتب'], ['reschedule', 'إعادة جدولة بسبب المكتب'], ['no_show', 'تعذّر استقبال العاملة (إبلاغ)'], ['partial_delivery', 'تنفيذ جزئي'], ['quality_issue', 'مشكلة بعد بدء الخدمة']];
      const visits = b ? b.visits.filter((v) => fm.type === 'quality_issue' ? v.status === 'completed' : v.status === 'scheduled') : [];
      return `<form id="dlg-form" data-submit="rq-office-submit" class="form">
        <label class="field"><span>الحجز</span><select id="of-b" data-on-change="of-set" data-k="bookingId">${bks.map((x) => `<option value="${h(x.id)}"${x.id === fm.bookingId ? ' selected' : ''}>${h(x.ref)} — ${h(x.customerName)} — ${h(x.packageName)}</option>`).join('')}</select></label>
        <label class="field"><span>نوع الإجراء</span><select id="of-t" data-on-change="of-set" data-k="type">${types.map(([k, l]) => `<option value="${k}"${k === fm.type ? ' selected' : ''}>${h(l)}</option>`).join('')}</select></label>
        <fieldset class="field"><legend>الزيارة</legend>${visits.length ? visits.map((v, i) => `<label class="radio"><input type="radio" name="visit" value="${h(v.id)}"${i === 0 ? ' checked' : ''}> زيارة ${h(v.label)} — ${h(JK.fmtDTs(v.start))} ${v.workers.length > 1 ? '(' + v.workers.length + ' عمالة)' : ''}</label>`).join('') : '<p class="muted">لا توجد زيارات مناسبة لهذا الإجراء في الحجز.</p>'}</fieldset>
        ${fm.type === 'office_cancel' ? `<label class="field"><span>السبب</span><select name="reasonCode"><option value="no_worker">تعذّر توفير العاملة</option><option value="office_cancel">إلغاء من المكتب</option><option value="late">تأخر يتجاوز المهلة المقبولة</option></select></label>
          <fieldset class="field"><legend>المعالجة</legend><label class="radio"><input type="radio" name="remedy" value="refund" checked> استرداد كامل دون رسوم</label><label class="radio"><input type="radio" name="remedy" value="replacement"> اقتراح موعد بديل (يتطلب موافقة العميل)</label></fieldset>
          <label class="field"><span>الموعد البديل (عند اختيار البديل)</span><input type="datetime-local" name="newStart"></label>` : ''}
        ${fm.type === 'reschedule' ? `<label class="field"><span>الموعد الجديد</span><input type="datetime-local" name="newStart" required></label><p class="muted small">التعديل بسبب المكتب لا يُحتسب من حد تعديلات العميل.</p>` : ''}
        ${fm.type === 'no_show' ? `<label class="field"><span>نوع الحالة</span><select name="reasonCode"><option value="no_show">لم يتم استقبال العاملة</option><option value="wrong_address">عنوان غير صحيح</option><option value="unsafe">ظروف غير آمنة</option></select></label><label class="field"><span>الإثبات (مطلوب لاحتساب أي رسوم)</span><input name="evidence" placeholder="مثال: سجل وصول التطبيق 9:02 + 3 اتصالات"></label>` : ''}
        ${fm.type === 'partial_delivery' && b ? `<fieldset class="field"><legend>العمالة التي حضرت فعلاً</legend>${(visits[0] ? visits[0].workers : []).map((w) => `<label class="check"><input type="checkbox" name="delivered" value="${h(w.id)}"> ${h(w.name)}</label>`).join('') || '<p class="muted">—</p>'}</fieldset><p class="muted small">تُعرض عمالة الزيارة الأولى المختارة؛ غيّر الزيارة من القائمة أعلاه عند الحاجة.</p>` : ''}
        ${fm.type === 'quality_issue' ? `<label class="field"><span>مبلغ التعويض المقترح (ر.س)</span><input name="amount" inputmode="decimal" required></label>` : ''}
        <label class="field"><span>الوصف / السبب</span><textarea name="reason" rows="2" required minlength="5"></textarea></label></form>`;
    };
    openModal({ title: 'تسجيل إجراء من المكتب', size: 'md', body, foot: `<button class="btn btn-secondary" data-act="modal-close" type="button">إلغاء</button><button class="btn btn-primary" type="submit" form="dlg-form">تسجيل</button>` });
  };
  UI.act['of-set'] = (el) => { UI.officeForm[el.dataset.k] = el.value; UI.renderModal(); };
  UI.act['rq-office-submit'] = (f) => {
    const fm = UI.officeForm, el = f.elements;
    const visit = el.visit ? (el.visit.value || (el.visit[0] && el.visit[0].value)) : null;
    if (!visit) { toast('اختر الزيارة.', 'danger'); return; }
    const p = { bookingId: fm.bookingId, type: fm.type, visitIds: [visit], reason: el.reason.value.trim() };
    if (p.reason.length < 5) { toast('اكتب وصفاً واضحاً (5 أحرف على الأقل).', 'danger'); return; }
    if (fm.type === 'office_cancel') {
      p.reasonCode = el.reasonCode.value; p.reasonLabel = el.reasonCode.options[el.reasonCode.selectedIndex].text; p.remedy = el.remedy.value;
      if (p.remedy === 'replacement') { if (!el.newStart.value) { toast('حدد الموعد البديل.', 'danger'); return; } p.newStart = JK.riyadhISO(el.newStart.value); }
    }
    if (fm.type === 'reschedule') { if (!el.newStart.value) { toast('حدد الموعد الجديد.', 'danger'); return; } p.newStart = JK.riyadhISO(el.newStart.value); p.cause = 'office'; }
    if (fm.type === 'no_show') { p.reasonCode = el.reasonCode.value; p.cause = p.reasonCode === 'unsafe' ? 'external' : 'customer'; p.evidence = el.evidence.value.trim() ? [{ by: 'office', type: 'note', label: el.evidence.value.trim() }] : []; }
    if (fm.type === 'partial_delivery') p.deliveredWorkerIds = Array.from(f.querySelectorAll('input[name=delivered]:checked')).map((x) => x.value);
    if (fm.type === 'quality_issue') { const a = JK.parseSAR(el.amount.value); if (a === null) { toast('أدخل مبلغاً صحيحاً.', 'danger'); return; } p.qualityAmount = a; p.cause = 'office'; }
    const r = run('submitOfficeAction', p);
    if (r.ok) { closeModal(true); UI.officeForm = null; toast('سُجّل الإجراء: ' + r.res.ref + ' — ' + L.requestStatus[r.res.status], 'success'); go('/requests/' + r.res.id); }
  };

  /* =================================================================== */
  /* Request detail                                                      */
  /* =================================================================== */
  function liveCalc(r, extra) {
    const b = byId(office().bookings, r.bookingId);
    return JK.calculate({ booking: b, platform: S.state.platform, req: Object.assign({ type: r.type, baseType: r.baseType, at: r.requestedAt, visitIds: r.visitIds, workerIds: r.workerIds, initiator: r.initiator, cause: r.cause, remedy: r.remedy, destination: r.destination, deliveredWorkerIds: r.deliveredWorkerIds, evidence: r.evidence, disputed: r.disputed, reasonCode: r.reasonCode, waiver: r.waiver, newStart: r.newStart, qualityAmount: r.qualityAmount, reasonLabel: r.reasonLabel }, extra || {}) });
  }
  UI.liveCalc = liveCalc;
  function visitTimeline(b, affectedIds) {
    return `<ol class="timeline">${b.visits.map((v) => {
      const hist = v.history.filter((x) => x.type === 'reschedule');
      const credit = b.credits && v.creditId ? byId(b.credits.items, v.creditId) : null;
      return `<li class="${affectedIds.includes(v.id) ? 'affected' : ''}"><div class="tl-dot tone-${TONES.visit[v.status]}"></div><div class="tl-body">
        <div class="tl-top"><strong>زيارة ${h(v.label)}</strong> ${visitBadge(v.status)} ${v.origin !== 'paid' ? badge(L.origin[v.origin], 'accent') : ''} ${affectedIds.includes(v.id) ? badge('ضمن الطلب', 'warning') : ''}</div>
        <div class="small">${dt(v.start)} · ${h(v.workers.map((w) => w.name + (w.status !== 'assigned' && w.status !== 'delivered' ? ' (' + ({ canceled: 'ملغاة', not_delivered: 'لم تنفذ', replaced: 'نُقلت للبديل' }[w.status] || w.status) + ')' : '')).join('، '))}</div>
        <div class="small muted">القيمة المخصصة: ${h(JK.sar(v.alloc))}${v.discountAlloc ? ' (بعد خصم ' + h(JK.sar(v.discountAlloc)) + ')' : ''} · المفتوح: ${h(JK.sar(JK.visitOpen(v)))}${credit ? ' · ' + h(credit.label) + ' (' + h(L.creditState[credit.state]) + ')' : ''}</div>
        ${v.originalStart ? `<div class="small">الموعد الأصلي: <s>${h(JK.fmtDTs(v.originalStart))}</s></div>` : ''}
        ${hist.map((x) => `<div class="small muted">${ic('calendar')} ${h(JK.fmtDTs(x.from))} ← ${h(JK.fmtDTs(x.to))} (${x.counts ? 'يُحتسب للعميل' : 'بسبب المكتب'}) · ${h(x.ref)}</div>`).join('')}
        ${v.lockedBand ? `<div class="small text-warning">${ic('alert')} شريحة إلغاء مثبتة: ${h(v.lockedBand.label)}</div>` : ''}
        ${v.linkedVisitId ? `<div class="small">مرتبطة بقيمة الزيارة ${h(v.linkedVisitId.split('-V')[1])}</div>` : ''}${v.note ? `<div class="small muted">${h(v.note)}</div>` : ''}
      </div></li>`;
    }).join('')}</ol>`;
  }
  UI.visitTimeline = visitTimeline;
  function bookingSummary(b) {
    return kv([['العميل', h(b.customerName)], ['الحجز', h(b.ref) + ' · ' + h(b.packageName)], ['نوع الحجز', h(L.bookingType[b.type])], ['تاريخ التأكيد', dts(b.confirmedAt)],
      ['قبول المكتب', b.officeAcceptance === 'pending' ? badge('بانتظار قبول المكتب', 'warning') : 'مقبول'],
      ['المدفوع', money(b.price.total) + `<div class="small muted">${b.price.payments.map((p) => `${h(L.payMethod[p.method])}: ${h(JK.sar(p.amount))} (${p.state === 'authorized' ? 'تفويض غير مُحصّل' : 'مُحصّل'}${p.refunded ? '، مسترد ' + h(JK.sar(p.refunded)) : ''})`).join(' · ')}</div>`],
      ['تسوية المكتب', b.officePayout === 'paid_out' ? badge('صُرفت للمكتب', 'warning') : 'محتجزة لدى المنصة'],
      b.credits ? ['الرصيد', `${b.credits.items.filter((c) => c.state === 'available').length} متاح · ${b.credits.items.filter((c) => c.state === 'scheduled').length} محجوز · ${b.credits.items.filter((c) => c.state === 'used').length} مستخدم · ينتهي ${h(JK.fmtDate(b.credits.items[0].expiresAt))}`] : null]);
  }
  UI.bookingSummary = bookingSummary;
  function priceView(b) {
    const p = b.price;
    return `<table class="calc-sum"><tbody>${p.lines.map((l) => `<tr><th scope="row">${h(l.label)}</th><td>${money(l.amount)}</td></tr>`).join('')}
      ${p.discount ? `<tr><th scope="row">${h(p.discountLabel || 'خصم')} (موزع على الزيارات)</th><td>${money(-p.discount)}</td></tr>` : ''}
      <tr><th scope="row">صافي قيمة الخدمة</th><td>${money(p.serviceNet)}</td></tr>
      <tr><th scope="row">ضريبة (بيانات عرض ${p.vatBps / 100}%)</th><td>${money(p.vat)}</td></tr>
      <tr><th scope="row">رسوم منصة JOKRS</th><td>${money(p.jokrsFee)}</td></tr>
      <tr class="total"><th scope="row">الإجمالي المدفوع</th><td>${money(p.total)}</td></tr></tbody></table>
      <p class="muted small">لقطة سعر ثابتة من وحدة التكلفة (${h(p.costingVersion)}) — لا يُعاد التسعير بأسعار اليوم.</p>`;
  }
  UI.priceView = priceView;

  UI.pages.requestDetail = function (id) {
    const o = office(), r = byId(o.requests, id);
    if (!r) return empty('الطلب غير موجود في هذا المكتب', 'الطلبات معزولة لكل مكتب.', `<a class="btn btn-primary" href="#/requests">العودة للطلبات</a>`);
    const b = byId(o.bookings, r.bookingId);
    const open = ['awaiting_review', 'info_requested', 'proposal_sent'].includes(r.status);
    const c = open ? liveCalc(r) : r.calc;
    const rf = r.refundId ? byId(o.refunds, r.refundId) : null;
    const snap = b.policySnapshot;
    const isRes = r.type === 'reschedule' || r.baseType === 'reschedule';
    const acts = [];
    if (['awaiting_review', 'info_requested'].includes(r.status)) {
      acts.push(btn({ label: 'اعتماد وفق السياسة', icon: 'check', kind: 'primary', perm: 'request.review', act: 'rq-approve', data: { id: r.id }, why: c && !c.ok ? 'لا يمكن الاعتماد: ' + c.blocked : '' }));
      if (r.type === 'no_show' || r.type === 'exception_review') acts.push(btn({ label: 'حسم لصالح العميل', icon: 'shield', perm: 'request.review', act: 'rq-favor', data: { id: r.id } }));
      if (isRes) acts.push(btn({ label: 'اقتراح موعد بديل', icon: 'calendar', perm: 'request.review', act: 'rq-propose', data: { id: r.id } }));
      if (r.status === 'awaiting_review') acts.push(btn({ label: 'طلب معلومات', icon: 'info', perm: 'request.review', act: 'rq-info', data: { id: r.id } }));
      acts.push(btn({ label: 'إضافة إثبات', icon: 'plus', perm: 'request.review', act: 'rq-evidence', data: { id: r.id } }));
      if (c && c.ok && c.officeFeeBeforeWaiver > 0) acts.push(btn({ label: 'إعفاء/تخفيض رسوم المكتب', icon: 'coins', perm: 'request.waive', act: 'rq-waive', data: { id: r.id } }));
      if (r.type !== 'office_cancel') acts.push(btn({ label: 'رفض مع سبب', icon: 'x', kind: 'danger', perm: 'request.review', act: 'rq-reject', data: { id: r.id } }));
    }
    if (r.status === 'proposal_sent' && r.type !== 'office_cancel') acts.push(btn({ label: 'سحب ورفض مع سبب', icon: 'x', kind: 'danger', perm: 'request.review', act: 'rq-reject', data: { id: r.id } }));
    const sim = [];
    if (r.status === 'info_requested') sim.push(btn({ label: 'تسجيل رد العميل', perm: 'customer.simulate', act: 'rq-cust-info', data: { id: r.id } }));
    if (r.status === 'proposal_sent') { sim.push(btn({ label: 'العميل يقبل المقترح', icon: 'check', perm: 'customer.simulate', act: 'rq-cust-resp', data: { id: r.id, a: '1' } })); sim.push(btn({ label: 'العميل يرفض المقترح', icon: 'x', perm: 'customer.simulate', act: 'rq-cust-resp', data: { id: r.id, a: '0' } })); }
    const props = r.proposals.length ? `<section class="card"><div class="card-head"><h2>المواعيد المقترحة</h2></div><ul class="mini-list">${r.proposals.map((p) => `<li>${dt(p.start)} — ${badge({ pending: 'بانتظار الرد', accepted: 'مقبول', rejected: 'مرفوض', withdrawn: 'مسحوب', unavailable: 'لم يعد متاحاً' }[p.status], { pending: 'info', accepted: 'success', rejected: 'danger', withdrawn: 'muted', unavailable: 'warning' }[p.status])} <span class="muted small">اقترحه ${h(p.by)} · ${h(JK.fmtDTs(p.at))}</span></li>`).join('')}</ul></section>` : '';
    return `<nav class="crumbs" aria-label="مسار التنقل"><a href="#/requests">الطلبات</a> ${ic('chev')} <span>${h(r.ref)}</span></nav>
      ${pageHead(r.ref + ' — ' + L.requestType[r.type], `${reqBadge(r.status)} ${r.disputed ? badge('متنازع عليه', 'danger') : ''} ${rf ? 'الاسترداد: ' + refundBadge(rf.state) : ''} ${r.baseType ? '· على: ' + h(L.requestType[r.baseType]) : ''}`)}
      <div class="detail">
        <div class="stack">
          <section class="card"><div class="card-head"><h2>الطلب</h2></div>
            ${kv([['وقت الطلب الأصلي', dt(r.requestedAt) + '<div class="small muted">يُحتسب كل شيء على هذا الوقت؛ رفض أي مقترح لاحق لا يغيّره.</div>'], ['المبادر', h(L.initiator[r.initiator])], ['الطرف المسبب', h(L.cause[r.cause] || '—')],
              ['السبب', h(r.reason || '—')], r.reasonLabel ? ['تصنيف', h(r.reasonLabel)] : null, r.newStart ? ['الموعد المطلوب', dt(r.newStart)] : null,
              r.destination === 'wallet' ? ['وجهة الاسترداد', 'المحفظة (اختيار العميل)'] : null, r.waiver ? ['إعفاء معتمد', money(r.waiver)] : null,
              r.decision ? ['القرار', `${h(r.decision.by)} (${h(L.role[r.decision.role] || r.decision.role)}) · ${dts(r.decision.at)}${r.decision.note ? '<div class="small">' + h(r.decision.note) + '</div>' : ''}`] : null])}
            <h3 class="h3">الإثباتات</h3>${r.evidence.length ? `<ul class="evidence">${r.evidence.map((e) => `<li>${badge(e.by === 'office' ? 'المكتب' : 'العميل', e.by === 'office' ? 'info' : 'accent')} ${h(e.label)} <span class="muted small">${h(JK.fmtDTs(e.at))}</span></li>`).join('')}</ul>` : '<p class="muted">لا توجد إثباتات.</p>'}
          </section>
          <section class="card"><div class="card-head"><h2>الحساب ${open ? '<span class="muted small">(معاينة مباشرة)</span>' : '<span class="muted small">(لقطة وقت القرار)</span>'}</h2></div>${c ? calcView(c, b, { decided: !open }) : '<p class="muted">لا يوجد حساب محفوظ.</p>'}</section>
          <section class="card"><div class="card-head"><h2>مواعيد الحجز</h2></div>${visitTimeline(b, r.visitIds || [])}</section>
          ${props}
          <section class="card"><div class="card-head"><h2>نشاط الطلب</h2></div><ol class="activity">${r.activity.map((a) => `<li><span class="muted small">${h(JK.fmtDTs(a.at))}</span> <b>${h(a.actor)}</b> <span class="muted small">(${h(L.role[a.role] || a.role)})</span><div>${h(a.text)}</div></li>`).join('')}</ol></section>
        </div>
        <aside class="stack">
          <section class="card"><div class="card-head"><h2>الإجراءات</h2></div>${permNote(['request.review'])}${acts.length ? `<div class="action-stack">${acts.join('')}</div>` : '<p class="muted">لا توجد إجراءات متاحة في هذه الحالة.</p>'}
            ${sim.length ? `<div class="sim-box"><p class="sim-title">${ic('flask')} محاكاة رد العميل</p><div class="action-stack">${sim.join('')}</div></div>` : ''}</section>
          ${rf ? `<section class="card"><div class="card-head"><h2>الاسترداد المرتبط</h2>${refundBadge(rf.state)}</div>${kv([['المرجع', `<a href="#/refunds?open=${h(rf.id)}">${h(rf.ref)}</a>`], ['المبلغ', money(rf.components.total)], ['ملاحظة', h(rf.note || '—')]])}</section>` : ''}
          <section class="card"><div class="card-head"><h2>العميل والحجز</h2></div>${bookingSummary(b)}<details class="mt"><summary>تفاصيل السعر</summary>${priceView(b)}</details></section>
          <section class="card"><div class="card-head"><h2>لقطة السياسة المقبولة</h2></div>
            ${kv([['السياسة', h(snap.policyName) + ' ' + badge('v' + snap.version, 'accent')], ['قُبلت في', dts(snap.acceptedAt)], ['شروط المنصة', h(snap.termsVersion)], ['قواعد الرسوم', h(snap.feeRuleVersion)], ['اعتماد المنصة', snap.platformApproved ? 'نعم' : 'لا']])}
            <button type="button" class="btn btn-ghost btn-sm" data-act="snap-text" data-b="${h(b.id)}">${ic('doc')}<span>النص الذي وافق عليه العميل</span></button></section>
        </aside>
      </div>`;
  };
  UI.act['snap-text'] = (el) => {
    const b = byId(office().bookings, el.dataset.b);
    openModal({ title: 'النص المقبول — ' + b.ref, drawer: true, body: `<p class="muted small">لقطة محفوظة مع الحجز · ${h(b.policySnapshot.policyName)} v${b.policySnapshot.version} · اللغة: العربية · ${h(JK.fmtDT(b.acceptance.at))}</p>${policyTextView(b.policySnapshot.textSnapshot)}` });
  };
  function reqDialog(title, id, inner, submit, okLabel, danger) {
    openModal({ title, size: 'md', body: `<form id="dlg-form" data-submit="${submit}" data-id="${h(id)}" class="form">${inner}</form>`,
      foot: `<button class="btn btn-secondary" data-act="modal-close" type="button">إلغاء</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit" form="dlg-form">${h(okLabel)}</button>` });
  }
  UI.act['rq-approve'] = (el) => {
    const r = byId(office().requests, el.dataset.id), c = liveCalc(r);
    reqDialog('اعتماد ' + r.ref, r.id, `<p>سيُنفّذ القرار وفق الحساب التالي (على وقت الطلب الأصلي):</p>${calcView(c, null, { noTrace: true })}
      <label class="field"><span>ملاحظة القرار${r.disputed ? ' (إلزامية للحالات المتنازع عليها — 10 أحرف على الأقل)' : ' (اختيارية)'}</span><textarea name="note" rows="2"${r.disputed ? ' required minlength="10"' : ''}></textarea></label>
      ${c.totalRefund > 0 ? '<p class="muted small">سيُنشأ استرداد بحالة مستقلة؛ لا يُعتبر مكتملاً حتى يؤكده مزوّد الدفع.</p>' : ''}`, 'rq-approve-submit', 'اعتماد');
  };
  UI.act['rq-approve-submit'] = (f) => { const r = run('approveRequest', { requestId: f.dataset.id, note: f.elements.note.value }, 'اعتُمد الطلب.'); if (r.ok) closeModal(); };
  UI.act['rq-favor'] = (el) => {
    const r = byId(office().requests, el.dataset.id);
    const c = liveCalc(r, r.type === 'no_show' ? { type: 'office_cancel', remedy: 'refund', cause: 'office' } : {});
    reqDialog('حسم لصالح العميل — ' + r.ref, r.id, `<p>تُعامل الحالة كخلل من جهة المكتب: لا رسوم على العميل.</p>${calcView(c, null, { noTrace: true })}<label class="field"><span>سبب الحسم (إلزامي)</span><textarea name="note" rows="2" required minlength="10"></textarea></label>`, 'rq-favor-submit', 'حسم لصالح العميل');
  };
  UI.act['rq-favor-submit'] = (f) => { const r = run('approveRequest', { requestId: f.dataset.id, note: f.elements.note.value, inCustomerFavor: true }, 'حُسم الطلب لصالح العميل.'); if (r.ok) closeModal(); };
  UI.act['rq-reject'] = (el) => reqDialog('رفض الطلب', el.dataset.id, `<label class="field"><span>سبب الرفض (يُعرض للعميل — إلزامي)</span><textarea name="reason" rows="3" required minlength="5"></textarea></label><p class="muted small">الرفض لا يغيّر الموعد الأصلي، ويبقى للعميل حق طلب مراجعة لدى JOKRS.</p>`, 'rq-reject-submit', 'رفض', true);
  UI.act['rq-reject-submit'] = (f) => { const r = run('rejectRequest', { requestId: f.dataset.id, reason: f.elements.reason.value }, 'رُفض الطلب وسُجّل السبب.'); if (r.ok) closeModal(); };
  UI.act['rq-info'] = (el) => reqDialog('طلب معلومات من العميل', el.dataset.id, `<label class="field"><span>المعلومات المطلوبة</span><textarea name="msg" rows="3" required minlength="5"></textarea></label>`, 'rq-info-submit', 'إرسال الطلب');
  UI.act['rq-info-submit'] = (f) => { const r = run('requestInfo', { requestId: f.dataset.id, message: f.elements.msg.value }, 'أُرسل طلب المعلومات (محاكاة — لا رسائل فعلية).'); if (r.ok) closeModal(); };
  UI.act['rq-evidence'] = (el) => reqDialog('إضافة إثبات من المكتب', el.dataset.id, `<label class="field"><span>النوع</span><select name="kind"><option value="gps">سجل موقع/وصول</option><option value="call">سجل اتصالات</option><option value="photo">صورة بطابع زمني</option><option value="note">ملاحظة</option></select></label><label class="field"><span>الوصف</span><input name="label" required minlength="5"></label><p class="muted small">محاكاة: لا تُرفع ملفات فعلية.</p>`, 'rq-evidence-submit', 'إضافة');
  UI.act['rq-evidence-submit'] = (f) => { const r = run('addEvidence', { requestId: f.dataset.id, kind: f.elements.kind.value, label: f.elements.label.value }, 'أُضيف الإثبات.'); if (r.ok) closeModal(); };
  UI.act['rq-waive'] = (el) => {
    const r = byId(office().requests, el.dataset.id), c = liveCalc(r, { waiver: 0 });
    reqDialog('إعفاء أو تخفيض رسوم المكتب', r.id, `<p>رسوم المكتب المحتسبة: <b>${money(c.officeFeeBeforeWaiver)}</b>. الإعفاء يزيد مبلغ العميل فقط؛ لا يمكن تعديل رسوم JOKRS أو تقليل استحقاق العميل.</p>
      <label class="field"><span>مبلغ الإعفاء (ر.س)</span><input name="amount" inputmode="decimal" required value="${h(JK.halalasToInput(c.officeFeeBeforeWaiver))}"></label>
      <label class="field"><span>السبب (للسجل)</span><textarea name="reason" rows="2" required minlength="5"></textarea></label>`, 'rq-waive-submit', 'تطبيق الإعفاء');
  };
  UI.act['rq-waive-submit'] = (f) => {
    const a = JK.parseSAR(f.elements.amount.value);
    if (a === null) { toast('أدخل مبلغاً صحيحاً (مثال: 51.25).', 'danger'); return; }
    const r = run('waiveFee', { requestId: f.dataset.id, amount: a, reason: f.elements.reason.value }, 'سُجّل الإعفاء؛ يظهر أثره في الحساب قبل الاعتماد.');
    if (r.ok) closeModal();
  };
  UI.act['rq-propose'] = (el) => {
    const r = byId(office().requests, el.dataset.id), b = byId(office().bookings, r.bookingId), v = byId(b.visits, r.visitIds[0]);
    reqDialog('اقتراح موعد بديل', r.id, `<p>الموعد الحالي: ${dt(v.start)} — يبقى مؤكداً حتى يقبل العميل البديل.</p>
      <label class="field"><span>الموعد المقترح (بتوقيت الرياض)</span><input type="datetime-local" name="start" id="pr-start" required data-on-change="pr-check" data-r="${h(r.id)}"></label>
      <div id="pr-av" aria-live="polite" class="muted small">اختر موعداً للتحقق من توفر العمالة.</div>`, 'rq-propose-submit', 'إرسال المقترح');
  };
  UI.act['pr-check'] = (el) => {
    const r = byId(office().requests, el.dataset.r), b = byId(office().bookings, r.bookingId), v = byId(b.visits, r.visitIds[0]);
    const iso = JK.riyadhISO(el.value), out = document.getElementById('pr-av');
    if (!iso) { out.textContent = ''; return; }
    const av = JK.checkAvailability(office(), v.workers.filter((w) => w.status === 'assigned').map((w) => w.workerId), iso, b.durationMin, v.id);
    out.innerHTML = av.ok ? `<span class="text-success">${ic('check')} متاح: ${h(v.workers.map((w) => w.name).join('، '))}</span>` : `<span class="text-danger">${ic('alert')} غير متاح: ${h(av.conflicts.map((c) => c.text).join('؛ '))}</span>`;
  };
  UI.act['rq-propose-submit'] = (f) => { const iso = JK.riyadhISO(f.elements.start.value); const r = run('proposeAlternative', { requestId: f.dataset.id, start: iso }, 'أُرسل المقترح للعميل (محاكاة).'); if (r.ok) closeModal(); };
  UI.act['rq-cust-info'] = (el) => reqDialog('رد العميل (محاكاة)', el.dataset.id, `<label class="field"><span>رد العميل</span><textarea name="text" rows="3" required></textarea></label>`, 'rq-cust-info-submit', 'تسجيل الرد');
  UI.act['rq-cust-info-submit'] = (f) => { const r = run('customerProvideInfo', { requestId: f.dataset.id, text: f.elements.text.value }, 'سُجّل رد العميل وعاد الطلب للمراجعة.'); if (r.ok) closeModal(); };
  UI.act['rq-cust-resp'] = (el) => {
    const r = run('respondProposal', { requestId: el.dataset.id, accept: el.dataset.a === '1' });
    if (r.ok) toast(r.res.warning || (el.dataset.a === '1' ? 'قبل العميل المقترح.' : 'رفض العميل المقترح.'), r.res.warning ? 'info' : 'success');
  };

  /* =================================================================== */
  /* Refunds                                                             */
  /* =================================================================== */
  const PENDING = ['awaiting_review', 'approved', 'processing'];
  UI.pages.refunds = function () {
    const o = office(), f = UI.filters.refunds;
    let list = o.refunds.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (f.state === 'pending') list = list.filter((r) => PENDING.includes(r.state));
    else if (f.state) list = list.filter((r) => r.state === f.state);
    if (f.q) list = list.filter((r) => (r.ref + ' ' + r.requestRef + ' ' + r.bookingRef + ' ' + r.customerName).toUpperCase().includes(f.q.toUpperCase()));
    if (f.from) list = list.filter((r) => Date.parse(r.completedAt || r.createdAt) >= Date.parse(JK.riyadhISO(f.from + ' 00:00')));
    if (f.to) list = list.filter((r) => Date.parse(r.completedAt || r.createdAt) <= Date.parse(JK.riyadhISO(f.to + ' 23:59')) + 59999);
    const openId = UI.route.query.open;
    if (openId) UI.afterRender = () => { UI.route.query = {}; openRefund(openId); };
    const rows = list.map((r) => `<tr class="clickable" data-act="rf-open" data-id="${h(r.id)}" tabindex="0">
      <td><button type="button" class="link-btn" data-act="rf-open" data-id="${h(r.id)}">${h(r.ref)}</button></td><td>${h(r.requestRef)}</td><td>${h(r.bookingRef)}<div class="muted small">${h(r.customerName)}</div></td>
      <td>${money(r.components.total)}</td><td class="small">${r.destinations.length ? h(r.destinations.map((d) => L.destAction[d.action]).join(' + ')) : h(r.outcome === 'credit_restore' ? 'إعادة استحقاق' : r.outcome === 'replacement' ? 'موعد بديل' : '—')}</td>
      <td>${refundBadge(r.state)}</td><td>${dts(r.createdAt)}</td><td>${r.completedAt ? dts(r.completedAt) : '—'}</td></tr>`).join('');
    const opt = (v, l) => `<option value="${v}"${f.state === v ? ' selected' : ''}>${h(l)}</option>`;
    return `${pageHead('المبالغ المستردة', 'حالة الاسترداد منفصلة عن حالة الطلب. عمليات محاكاة فقط — لا مدفوعات فعلية. كل عملية لها معرّف ثابت يمنع الازدواج.')}
      ${permNote(['refund.finance'])}
      <div class="filters" role="search">
        <label class="field-inline"><span>الحالة</span><select id="rff-state" data-on-change="rf-filter" data-key="state"><option value="">الكل</option>${opt('pending', 'بانتظار التنفيذ (كل غير المكتمل)')}${Object.entries(L.refundState).map(([k, l]) => opt(k, l)).join('')}</select></label>
        <label class="field-inline grow"><span class="sr-only">بحث</span>${ic('search')}<input id="rff-q" type="search" placeholder="مرجع الاسترداد أو الطلب أو الحجز أو العميل" value="${h(f.q || '')}" data-on-input="rf-filter" data-key="q"></label>
        <label class="field-inline"><span>من</span><input type="date" id="rff-from" value="${h(f.from || '')}" data-on-change="rf-filter" data-key="from"></label>
        <label class="field-inline"><span>إلى</span><input type="date" id="rff-to" value="${h(f.to || '')}" data-on-change="rf-filter" data-key="to"></label>
        ${Object.values(f).some(Boolean) ? `<button type="button" class="btn btn-ghost btn-sm" data-act="rf-clear">${ic('x')}<span>مسح</span></button>` : ''}
      </div>
      <section class="card flush">${rows ? `<div class="table-wrap"><table class="tbl"><caption class="sr-only">المبالغ المستردة</caption><thead><tr><th>الاسترداد</th><th>الطلب</th><th>الحجز / العميل</th><th>المبلغ</th><th>الوجهة</th><th>الحالة</th><th>أُنشئ</th><th>اكتمل</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : empty('لا توجد عمليات مطابقة', 'غيّر الفلاتر لعرض عمليات أخرى.', `<button class="btn btn-secondary" data-act="rf-clear">مسح الفلاتر</button>`)}</section>`;
  };
  UI.act['rf-filter'] = (el) => { UI.filters.refunds[el.dataset.key] = el.value; render(); };
  UI.act['rf-clear'] = () => { UI.filters.refunds = {}; if (location.hash !== '#/refunds') go('/refunds'); else render(); };
  UI.act['rf-open'] = (el) => openRefund(el.dataset.id);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('tr.clickable')) { e.preventDefault(); openRefund(e.target.dataset.id); } });

  function refundBody(id) {
    const o = office(), rf = byId(o.refunds, id);
    if (!rf) return empty('العملية غير موجودة في هذا المكتب', '');
    const b = byId(o.bookings, rf.bookingId), led = o.ledger.filter((l) => l.refundId === rf.id);
    const c = rf.components;
    const acts = [];
    if (rf.state === 'awaiting_review') acts.push(btn({ label: 'اعتماد الاسترداد', icon: 'check', kind: 'primary', perm: 'refund.finance', act: 'rf-approve', data: { id } }));
    if (rf.state === 'approved') {
      const lbl = rf.destinations.every((d) => d.action === 'release_authorization') ? 'إلغاء تفويض الدفع' : rf.destinations.every((d) => d.action === 'wallet_credit') ? 'إضافة الرصيد للمحفظة' : 'بدء تنفيذ الاسترداد';
      acts.push(btn({ label: lbl, icon: 'play', kind: 'primary', perm: 'refund.finance', act: 'rf-process', data: { id } }));
    }
    if (rf.state === 'failed') acts.push(btn({ label: 'إعادة المحاولة (نفس معرّف العملية)', icon: 'refresh', kind: 'primary', perm: 'refund.finance', act: 'rf-retry', data: { id } }));
    const pending = rf.attempts.find((a) => a.status === 'pending');
    const lastAtt = rf.attempts[rf.attempts.length - 1];
    const prov = [];
    if (pending) { prov.push(`<button type="button" class="btn btn-secondary btn-sm" data-act="rf-cb" data-id="${h(id)}" data-att="${h(pending.id)}" data-res="success">${ic('check')}<span>إشعار نجاح</span></button>`, `<button type="button" class="btn btn-secondary btn-sm" data-act="rf-cb" data-id="${h(id)}" data-att="${h(pending.id)}" data-res="failure">${ic('x')}<span>إشعار فشل</span></button>`); }
    if (rf.state === 'completed' && lastAtt) prov.push(`<button type="button" class="btn btn-secondary btn-sm" data-act="rf-cb" data-id="${h(id)}" data-att="${h(lastAtt.id)}" data-res="success">${ic('refresh')}<span>إرسال إشعار نجاح مكرر</span></button>`);
    return `<div class="refund-head">${refundBadge(rf.state)} <span class="muted small">معرّف العملية الثابت: <code dir="ltr">${h(rf.opId)}</code></span></div>
      ${rf.note ? `<div class="note note-info">${ic('info')}<div>${h(rf.note)}</div></div>` : ''}
      ${rf.failureReason && rf.state === 'failed' ? `<div class="note note-danger">${ic('alert')}<div><b>سبب الفشل:</b> ${h(rf.failureReason)}</div></div>` : ''}
      ${kv([['الطلب', rf.requestId ? `<a href="#/requests/${h(rf.requestId)}">${h(rf.requestRef)}</a>` : h(rf.requestRef)], ['الحجز', h(rf.bookingRef) + ' · ' + h(rf.customerName)], ['أُنشئ', dts(rf.createdAt)], ['مرجع المزوّد', rf.providerRef ? `<code dir="ltr">${h(rf.providerRef)}</code>` : '—'], ['اكتمل', rf.completedAt ? dts(rf.completedAt) : '—'],
        ['تسوية المكتب', b && b.officePayout === 'paid_out' ? '<span class="text-warning">أموال المكتب صُرفت سابقاً — يلزم استرداد من مستحقاته القادمة</span>' : 'محتجزة لدى المنصة']])}
      <h3 class="h3">المكونات</h3>
      <table class="calc-sum"><tbody><tr><th scope="row">استرداد الخدمة</th><td>${money(c.service)}</td></tr><tr><th scope="row">تعديل ضريبي محاكى</th><td>${money(c.tax)}</td></tr><tr><th scope="row">رسوم JOKRS (حساب المنصة)</th><td>${money(c.jokrs)}</td></tr><tr class="total"><th scope="row">الإجمالي</th><td>${money(c.total)}</td></tr><tr><th scope="row" class="muted">رسوم المكتب المحتفظ بها (منفصلة)</th><td>${money(rf.officeFeeRetained)}</td></tr></tbody></table>
      ${rf.destinations.length ? `<h3 class="h3">الوجهات</h3><ul class="dest-list">${rf.destinations.map((d) => `<li>${ic('coins')}<span>${h(L.destAction[d.action])} — ${h(L.payMethod[d.method] || d.method)}${d.paymentId ? ' <code dir="ltr">' + h(d.paymentId) + '</code>' : ''}</span>${money(d.amount)}</li>`).join('')}</ul>` : ''}
      ${acts.length ? `<div class="action-row">${acts.join('')}</div>` : ''}
      ${prov.length ? `<div class="sim-box"><p class="sim-title">${ic('flask')} محاكاة مزوّد الدفع (خارج سير عمل المكتب)</p><div class="action-row">${prov.join('')}</div><p class="muted small">الإشعارات المكررة لا يكون لها أي أثر مالي إضافي.</p></div>` : ''}
      <h3 class="h3">المسار الزمني</h3><ol class="activity">${rf.timeline.map((t) => `<li><span class="muted small">${h(JK.fmtDTs(t.at))}</span> ${refundBadge(t.state)} <span class="small">${h(t.by)}${t.attempt ? ' · ' + h(t.attempt) : ''}</span></li>`).join('')}</ol>
      <h3 class="h3">المحاولات</h3>${rf.attempts.length ? `<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>المحاولة</th><th>الوقت</th><th>النتيجة</th><th>المرجع/السبب</th></tr></thead><tbody>${rf.attempts.map((a) => `<tr><td>${h(a.id)}</td><td>${dts(a.at)}</td><td>${badge({ pending: 'بانتظار المزوّد', succeeded: 'نجحت', failed: 'فشلت' }[a.status], { pending: 'info', succeeded: 'success', failed: 'danger' }[a.status])}</td><td class="small">${h(a.providerRef || a.reason || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لم تبدأ أي محاولة.</p>'}
      <h3 class="h3">قيود الأستاذ المرتبطة</h3>${led.length ? `<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>القيد</th><th>الحساب</th><th>المبلغ</th><th>الوصف</th></tr></thead><tbody>${led.map((l) => `<tr><td>${h(l.id)}<div class="muted small">${h(JK.fmtDTs(l.at))}</div></td><td>${h(LEDGER[l.account] || l.account)}${l.kind === 'memo' ? ' ' + badge('مذكرة', 'muted') : ''}</td><td>${money(l.amount)}</td><td class="small">${h(l.label)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا تُسجّل حركات نقدية قبل الاكتمال.</p>'}`;
  }
  const LEDGER = { customer_refund: 'مبلغ للعميل', office_service_reversal: 'عكس إيراد المكتب', office_fee_retained: 'رسوم محتفظ بها للمكتب', tax_adjustment: 'تعديل ضريبي (عرض)', jokrs_fee_reversal: 'عكس رسوم JOKRS', office_settlement_recovery: 'استرداد من تسوية المكتب', entitlement_restored: 'إعادة استحقاق', entitlement_transferred: 'نقل استحقاق' };
  function openRefund(id) {
    const rf = byId(office().refunds, id);
    openModal({ title: rf ? 'الاسترداد ' + rf.ref : 'الاسترداد', drawer: true, body: () => refundBody(id) });
  }
  UI.openRefund = openRefund;
  UI.act['rf-approve'] = (el) => run('refundApprove', { refundId: el.dataset.id }, 'اعتُمد الاسترداد للتنفيذ.');
  UI.act['rf-process'] = (el) => run('refundProcess', { refundId: el.dataset.id }, (rf) => rf.state === 'completed' ? 'اكتملت العملية داخلياً.' : rf.state === 'failed' ? 'فشلت المحاولة: ' + rf.failureReason : 'أُرسلت العملية لمزوّد الدفع (محاكاة) — بانتظار الإشعار.');
  UI.act['rf-retry'] = (el) => run('refundRetry', { refundId: el.dataset.id }, (rf) => rf.state === 'failed' ? 'فشلت المحاولة مجدداً: ' + rf.failureReason : 'أُعيدت المحاولة بنفس معرّف العملية.');
  UI.act['rf-cb'] = (el) => {
    const r = run('providerCallback', { refundId: el.dataset.id, attemptId: el.dataset.att, result: el.dataset.res, reason: el.dataset.res === 'failure' ? 'رفض البنك المصدر العملية (محاكاة)' : undefined });
    if (r.ok) toast(r.res.duplicate ? 'إشعار مكرر — تم تجاهله دون أي أثر مالي (سُجّل في السجل).' : el.dataset.res === 'success' ? 'أكّد المزوّد نجاح الاسترداد.' : 'سجّل المزوّد فشل العملية.', r.res.duplicate ? 'info' : 'success');
  };

  /* =================================================================== */
  /* Activity                                                            */
  /* =================================================================== */
  const ACTION_LABEL = {
    'policy.created': 'إنشاء سياسة/نسخة', 'policy.edited': 'تعديل مسودة', 'policy.version_created': 'إنشاء نسخة جديدة', 'policy.duplicated': 'تكرار سياسة', 'policy.submitted': 'إرسال للمراجعة',
    'policy.published': 'نشر سياسة', 'policy.changes_requested': 'طلب تعديلات من المنصة', 'policy.archived': 'أرشفة سياسة', 'assignment.changed': 'تغيير ربط', 'sales.disabled': 'إيقاف البيع', 'sales.enabled': 'تفعيل البيع',
    'customer.accepted_policy': 'موافقة العميل على السياسة', 'booking.created': 'إنشاء حجز', 'request.submitted': 'تقديم طلب', 'request.decided': 'قرار على طلب', 'request.info_requested': 'طلب معلومات',
    'request.info_provided': 'رد العميل', 'request.evidence_added': 'إضافة إثبات', 'request.proposal_accepted': 'قبول موعد بديل', 'request.proposal_rejected': 'رفض موعد بديل', 'fee.waived': 'إعفاء من رسوم المكتب',
    'schedule.proposed': 'اقتراح موعد', 'schedule.changed': 'تغيير موعد', 'refund.created': 'إنشاء استرداد', 'refund.approved': 'اعتماد استرداد', 'refund.started': 'بدء تنفيذ استرداد', 'refund.completed': 'اكتمال استرداد',
    'refund.failed': 'فشل استرداد', 'refund.retried': 'إعادة محاولة استرداد', 'refund.duplicate_callback_ignored': 'تجاهل إشعار مكرر', 'costing.prices_changed': 'تغيّر أسعار التكلفة', 'platform.rules_changed': 'تعديل قواعد المنصة'
  };
  UI.ACTION_LABEL = ACTION_LABEL;
  const KEY_LABEL = { status: 'الحالة', version: 'النسخة', name: 'الاسم', state: 'الحالة', total: 'الإجمالي', refund: 'الاسترداد', fee: 'الرسوم', officeFee: 'رسوم المكتب', waiver: 'الإعفاء', rule: 'القاعدة', reason: 'السبب', reasons: 'الأسباب', changes: 'التغييرات',
    effectiveFrom: 'السريان', platformApproved: 'اعتماد المنصة', policy: 'السياسة', start: 'الموعد', proposedStart: 'الموعد المقترح', replacementStart: 'الموعد البديل', countsTowardAllowance: 'يُحتسب للعميل', salesEnabled: 'البيع مفعّل',
    type: 'النوع', booking: 'الحجز', requestedAt: 'وقت الطلب', initiator: 'المبادر', cause: 'المسبب', preview: 'معاينة', attempt: 'المحاولة', operationId: 'معرّف العملية', providerRef: 'مرجع المزوّد', destinations: 'الوجهات',
    customerId: 'العميل', bookingId: 'الحجز', platformTerms: 'شروط المنصة', feeRules: 'قواعد الرسوم', lang: 'اللغة', at: 'الوقت', acceptedAt: 'وقت الموافقة', package: 'الباقة', visits: 'عدد الزيارات', remedy: 'المعالجة', basedOn: 'مبنية على',
    archived: 'مؤرشفة', replacement: 'البديل', salesDisabled: 'أوقف بيعها', from: 'من', evidence: 'إثبات', maxVisitFeePct: 'حد رسوم الزيارة %', maxPackageFeePct: 'حد رسوم الباقة %', allowConsumeEntitlement: 'السماح بالاستهلاك', minGraceMinutes: 'حد السماح (دقيقة)', minGraceLeadHours: 'مهلة السماح', reviewRequiredFor: 'تتطلب مراجعة' };
  const MONEY_KEYS = ['total', 'refund', 'fee', 'officeFee', 'waiver'];
  function fmtVal(k, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
    if (typeof v === 'number') return MONEY_KEYS.includes(k) ? JK.sar(v) : String(v);
    if (Array.isArray(v)) return v.map((x) => typeof x === 'object' ? fmtObj(x) : String(x)).join('؛ ');
    if (typeof v === 'object') return fmtObj(v);
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return JK.fmtDTs(v);
    return L.requestStatus[v] || L.refundState[v] || L.versionStatus[v] || L.requestType[v] || L.initiator[v] || v;
  }
  function fmtObj(o) { return Object.entries(o).map(([k, v]) => (KEY_LABEL[k] || k) + ': ' + fmtVal(k, v)).join('، '); }
  function changeList(obj) {
    if (!obj) return '<span class="muted">—</span>';
    return `<ul class="mini-list">${Object.entries(obj).map(([k, v]) => `<li><span class="muted">${h(KEY_LABEL[k] || k)}:</span> ${h(fmtVal(k, v))}</li>`).join('')}</ul>`;
  }
  UI.pages.activity = function () {
    const o = office(), f = UI.filters.activity;
    UI.actLimit = UI.actLimit || 60;
    let list = o.audit.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (b.id > a.id ? 1 : -1));
    if (f.group) list = list.filter((e) => e.action.startsWith(f.group));
    if (f.role) list = list.filter((e) => e.role === f.role);
    if (f.q) list = list.filter((e) => (e.actor + ' ' + e.entityId + ' ' + e.note + ' ' + (ACTION_LABEL[e.action] || e.action)).includes(f.q));
    const total = list.length; list = list.slice(0, UI.actLimit);
    const groups = [['policy', 'السياسات'], ['assignment', 'الربط'], ['sales', 'البيع'], ['customer', 'موافقات العملاء'], ['booking', 'الحجوزات'], ['request', 'الطلبات'], ['fee', 'الإعفاءات'], ['schedule', 'المواعيد'], ['refund', 'المبالغ المستردة'], ['costing', 'التكلفة'], ['platform', 'المنصة']];
    const rows = list.map((e) => `<tr><td>${dts(e.at)}<div class="muted small">${h(e.id)}</div></td><td>${h(e.actor)}<div class="muted small">${h(L.role[e.role] || e.role)}</div></td><td>${h(ACTION_LABEL[e.action] || e.action)}</td><td>${h(e.entityId)}</td>
      <td class="small">${h(e.note || '')}${e.before || e.after ? `<details><summary>قبل / بعد</summary><div class="ba"><div><b>قبل</b>${changeList(e.before)}</div><div><b>بعد</b>${changeList(e.after)}</div></div></details>` : ''}</td></tr>`).join('');
    return `${pageHead('سجل النشاط', 'سجل تدقيق إضافي فقط — لا يمكن تعديله أو حذفه من الواجهة. كل حدث يتضمن الفاعل والدور والوقت والسجل المرتبط.')}
      <div class="filters" role="search">
        <label class="field-inline"><span>الفئة</span><select id="af-group" data-on-change="ac-filter" data-key="group"><option value="">الكل</option>${groups.map(([k, l]) => `<option value="${k}"${f.group === k ? ' selected' : ''}>${h(l)}</option>`).join('')}</select></label>
        <label class="field-inline"><span>الدور</span><select id="af-role" data-on-change="ac-filter" data-key="role"><option value="">الكل</option>${Object.entries(L.role).map(([k, l]) => `<option value="${k}"${f.role === k ? ' selected' : ''}>${h(l)}</option>`).join('')}</select></label>
        <label class="field-inline grow"><span class="sr-only">بحث</span>${ic('search')}<input id="af-q" type="search" value="${h(f.q || '')}" placeholder="الفاعل، المرجع، الملاحظة" data-on-input="ac-filter" data-key="q"></label>
      </div>
      <p class="muted small" aria-live="polite">${total} حدث</p>
      <section class="card flush">${rows ? `<div class="table-wrap"><table class="tbl"><caption class="sr-only">سجل النشاط</caption><thead><tr><th>الوقت</th><th>الفاعل</th><th>الحدث</th><th>السجل</th><th>التفاصيل</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('لا توجد أحداث مطابقة', 'غيّر الفلاتر.', `<button class="btn btn-secondary" data-act="ac-clear">مسح الفلاتر</button>`)}</section>
      ${total > list.length ? `<div class="center"><button type="button" class="btn btn-secondary" data-act="ac-more">عرض المزيد (${total - list.length})</button></div>` : ''}`;
  };
  UI.act['ac-filter'] = (el) => { UI.filters.activity[el.dataset.key] = el.value; UI.actLimit = 60; render(); };
  UI.act['ac-clear'] = () => { UI.filters.activity = {}; render(); };
  UI.act['ac-more'] = () => { UI.actLimit += 60; render(); };
})(window);

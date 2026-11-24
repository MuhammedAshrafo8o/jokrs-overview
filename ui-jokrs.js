/* =====================================================================
   ui-jokrs.js — "لوحة منصة JOKRS": the platform operator's dashboard.
   Cross-office oversight on the same shared store: policy review,
   guardrails, coverage, requests, refunds (+ simulated payment provider),
   ledger and the merged audit trail. Actions run via
   JK.Store.dispatchAs(..., {role:'platform'}).
   ===================================================================== */
(function (G) {
  'use strict';
  const JK = G.JK, S = JK.Store, L = JK.L, UI = JK.UI;
  const { h, ic, badge, money, toast, openModal, kv } = UI;
  const byId = (a, id) => JK.store.byId(a, id);
  const now = () => S.state.demo.now;
  const offices = () => Object.values(S.state.offices);

  const NAV = [
    ['overview', 'نظرة عامة', 'home'], ['reviews', 'مراجعة السياسات', 'shield'], ['offices', 'المكاتب والتغطية', 'building'],
    ['requests', 'الطلبات', 'inbox'], ['refunds', 'المبالغ المستردة والمزوّد', 'coins'], ['ledger', 'الرسوم والقيود', 'doc'],
    ['rules', 'قيود المنصة', 'sliders'], ['audit', 'سجل التدقيق الموحد', 'history']
  ];
  function freshJx() { return { sec: 'overview', office: 'A', f: { office: '', status: 'open', type: '', q: '' }, rf: { office: '', state: '' }, lg: { office: '', account: '' }, au: { office: '', role: '', q: '' } }; }
  UI.jx = freshJx();
  (UI.resetHooks = UI.resetHooks || []).push(() => { UI.jx = freshJx(); });
  const jx = () => UI.jx;

  function jxRun(name, args, okMsg, officeId) {
    try {
      const res = S.dispatchAs(name, args, { officeId: officeId || 'A', role: 'platform' });
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(res) : okMsg, 'success');
      return { ok: true, res };
    } catch (e) {
      if (!e.isAction) { console.error(e); toast('خطأ غير متوقع: ' + e.message, 'danger'); return { ok: false, error: e }; }
      toast(e.message, 'danger');
      return { ok: false, error: e };
    }
  }

  /* ---------------- derived data ---------------- */
  const OPEN = ['awaiting_review', 'info_requested', 'proposal_sent'];
  function pendingVersions() {
    const out = [];
    offices().forEach((o) => o.policies.forEach((p) => p.versions.forEach((v) => { if (v.status === 'pending_review') out.push({ o, p, v }); })));
    return out;
  }
  function overdue(o, r) {
    if (r.status !== 'awaiting_review') return false;
    const b = byId(o.bookings, r.bookingId);
    const hrs = (b && b.policySnapshot.rules.refund && b.policySnapshot.rules.refund.reviewTargetHours) || 24;
    return Date.parse(now()) - Date.parse(r.createdAt) > hrs * JK.HOUR;
  }
  function allRequests() { return offices().flatMap((o) => o.requests.map((r) => ({ o, r }))); }
  function allRefunds() { return offices().flatMap((o) => o.refunds.map((rf) => ({ o, rf }))); }
  function officeStats(o) {
    const at = Date.parse(now());
    const active = o.bookings.filter((b) => b.visits.some((v) => v.status === 'scheduled' && Date.parse(v.start) > at) || (b.credits && b.credits.items.some((c) => c.state === 'available'))).length;
    const open = o.requests.filter((r) => OPEN.includes(r.status));
    const cancels = o.requests.filter((r) => ['cancel_visits', 'cancel_all_remaining', 'credit_cancel', 'package_refund'].includes(r.type) || r.baseType && r.baseType.indexOf('cancel') === 0).length;
    const uncovered = JK.store.uncovered(o, now());
    const stopped = o.services.flatMap((s) => s.packages).filter((pk) => !pk.salesEnabled);
    return {
      bookings: o.bookings.length, active, gmv: JK.sum(o.bookings.map((b) => b.price.total)),
      open: open.length, overdue: open.filter((r) => overdue(o, r)).length, exceptions: open.filter((r) => r.type === 'exception_review' || r.disputed).length,
      rfPending: o.refunds.filter((r) => ['awaiting_review', 'approved', 'processing'].includes(r.state)).length, rfFailed: o.refunds.filter((r) => r.state === 'failed').length,
      refunded: JK.sum(o.refunds.filter((r) => r.state === 'completed').map((r) => r.components.total)),
      cancelRate: o.bookings.length ? Math.round((cancels / o.bookings.length) * 100) : 0,
      uncovered, stopped,
      pendingV: o.policies.reduce((n, p) => n + p.versions.filter((v) => v.status === 'pending_review').length, 0),
      rejectedV: o.policies.reduce((n, p) => n + p.versions.filter((v) => v.status === 'rejected').length, 0),
      jokrsCollected: JK.sum(o.bookings.map((b) => b.price.jokrsFee)),
      jokrsReversed: -JK.sum(o.ledger.filter((e) => e.account === 'jokrs_fee_reversal').map((e) => e.amount)),
      recovery: -JK.sum(o.ledger.filter((e) => e.account === 'office_settlement_recovery').map((e) => e.amount))
    };
  }

  UI.jokrsTabInfo = function () {
    const n = pendingVersions().length + allRefunds().filter((x) => x.rf.state === 'failed').length;
    return { sub: 'مراجع المنصة · ' + offices().length + ' مكاتب', count: n, countTitle: 'نسخ بانتظار المراجعة واستردادات فاشلة' };
  };

  /* =================================================================== */
  /* Sections                                                            */
  /* =================================================================== */
  const SEC = {};
  const head = (t, sub, actions) => `<div class="page-head"><div><h1>${h(t)}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div><div class="page-actions">${actions || ''}</div></div>`;
  const officeSel = (id, val, act) => `<select id="${id}" data-on-change="${act}"><option value="">كل المكاتب</option>${offices().map((o) => `<option value="${h(o.office.id)}"${o.office.id === val ? ' selected' : ''}>${h(o.office.name)}</option>`).join('')}</select>`;
  const oName = (o) => `<span class="jx-office jx-o-${h(o.office.id)}">${h(o.office.name.split(' ').slice(0, 2).join(' '))}</span>`;

  SEC.overview = function () {
    const st = offices().map((o) => ({ o, s: officeStats(o) }));
    const tot = (k) => JK.sum(st.map((x) => x.s[k]));
    const pend = pendingVersions();
    const kpi = (sec, label, value, sub, tone) => `<button type="button" class="kpi kpi-${tone || 'neutral'} jx-kpi" data-act="jx-sec" data-s="${sec}"><span class="kpi-label">${h(label)}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></button>`;
    const attention = [];
    pend.forEach(({ o, p, v }) => attention.push(['warning', 'shield', `${o.office.name}: "${p.name}" النسخة ${v.version} بانتظار اعتماد المنصة`, 'reviews']));
    allRefunds().filter((x) => x.rf.state === 'failed').forEach(({ o, rf }) => attention.push(['danger', 'coins', `${o.office.name}: فشل الاسترداد ${rf.ref} (${JK.sar(rf.components.total)}) — ${rf.failureReason || ''}`, 'refunds']));
    allRequests().filter(({ o, r }) => overdue(o, r)).forEach(({ o, r }) => attention.push(['warning', 'clock', `${o.office.name}: الطلب ${r.ref} تجاوز مهلة المراجعة المعلنة للعميل`, 'requests']));
    allRequests().filter(({ r }) => OPEN.includes(r.status) && (r.type === 'exception_review' || r.disputed)).forEach(({ o, r }) => attention.push(['info', 'alert', `${o.office.name}: ${r.ref} ${r.disputed ? 'نزاع على تعذّر الاستقبال' : 'مراجعة استثنائية / حقوقية'} — قيد متابعة المنصة`, 'requests']));
    st.forEach(({ o, s }) => s.uncovered.forEach((pk) => attention.push(['danger', 'link', `${o.office.name}: "${pk.name}" معروضة للبيع دون سياسة صالحة`, 'offices'])));
    return `${head('نظرة عامة على المنصة', 'متابعة كل المكاتب في مكان واحد. المنصة تعتمد القواعد المقيدة وتراقب الطلبات والاستردادات، والقرار التشغيلي يبقى لكل مكتب.')}
      <div class="kpis">
        ${kpi('offices', 'الحجوزات النشطة', tot('active'), 'من ' + tot('bookings') + ' حجزاً في ' + st.length + ' مكاتب', 'info')}
        ${kpi('requests', 'طلبات مفتوحة', tot('open'), tot('overdue') ? `<span class="text-danger">${tot('overdue')} متأخرة عن المهلة</span>` : 'لا يوجد تأخير', tot('overdue') ? 'warning' : 'neutral')}
        ${kpi('reviews', 'نسخ بانتظار اعتماد المنصة', pend.length, pend.length ? 'تحتاج قرارك' : 'لا يوجد', pend.length ? 'warning' : 'success')}
        ${kpi('refunds', 'استردادات قيد التنفيذ', tot('rfPending'), tot('rfFailed') ? `<span class="text-danger">${tot('rfFailed')} فاشلة</span>` : 'لا فشل', tot('rfFailed') ? 'danger' : 'neutral')}
        ${kpi('ledger', 'رسوم JOKRS المحصلة', money(tot('jokrsCollected')), 'مستردة للعملاء: ' + h(JK.sar(tot('jokrsReversed'))), 'success')}
        ${kpi('ledger', 'إجمالي المسترد للعملاء', money(tot('refunded')), 'استردادات مكتملة', 'neutral')}
      </div>
      <section class="card"><h2>المكاتب</h2>
          <div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>المكتب</th><th>حجوزات</th><th>طلبات مفتوحة</th><th>متأخرة</th><th>استردادات</th><th>نسبة الإلغاء</th><th>التغطية</th><th>سياسات</th></tr></thead><tbody>
          ${st.map(({ o, s }) => `<tr class="clickable" data-act="jx-office" data-o="${h(o.office.id)}"><td><b>${h(o.office.name)}</b><div class="muted small">${h(o.office.city)}</div></td><td>${s.active}/${s.bookings}</td><td>${s.open}</td><td>${s.overdue ? badge(s.overdue, 'danger') : '—'}</td>
            <td>${s.rfPending}${s.rfFailed ? ' ' + badge(s.rfFailed + ' فشل', 'danger') : ''}</td><td>${s.cancelRate}%</td>
            <td>${s.uncovered.length ? badge(s.uncovered.length + ' بلا سياسة', 'danger') : s.stopped.length ? badge(s.stopped.length + ' بيع متوقف', 'warning') : badge('مكتملة', 'success')}</td>
            <td>${s.pendingV ? badge(s.pendingV + ' للمراجعة', 'warning') : ''}${s.rejectedV ? ' ' + badge(s.rejectedV + ' تعديلات', 'muted') : ''}${!s.pendingV && !s.rejectedV ? '—' : ''}</td></tr>`).join('')}
          </tbody></table></div></section>
      <div class="jx-grid2">
        <section class="card"><h2>يحتاج انتباه المنصة (${attention.length})</h2>
          ${attention.length ? `<ul class="jx-attn">${attention.slice(0, 12).map(([t, i, txt, sec]) => `<li class="jx-attn-${t}"><button type="button" data-act="jx-sec" data-s="${sec}">${ic(i)}<span>${h(txt)}</span>${ic('chev')}</button></li>`).join('')}</ul>${attention.length > 12 ? `<p class="muted small">و${attention.length - 12} عناصر أخرى.</p>` : ''}` : `<p class="muted">${ic('check')} لا يوجد ما يحتاج تدخلاً.</p>`}
        </section>
        <section class="card"><h2>نتائج الطلبات عبر المكاتب</h2>${outcomeBars()}</section>
      </div>`;
  };
  function outcomeBars() {
    const groups = { approved: 0, auto_approved: 0, rejected: 0, open: 0 };
    allRequests().forEach(({ r }) => { if (OPEN.includes(r.status)) groups.open++; else groups[r.status] = (groups[r.status] || 0) + 1; });
    const total = Object.values(groups).reduce((a, b) => a + b, 0) || 1;
    const rows = [['auto_approved', 'معتمد آلياً', 'success'], ['approved', 'معتمد بعد مراجعة', 'info'], ['open', 'مفتوح', 'warning'], ['rejected', 'مرفوض', 'danger']];
    return `<div class="jx-bars">${rows.map(([k, l, t]) => `<div class="jx-bar"><span class="jx-bar-l">${h(l)}</span><span class="jx-bar-track"><span class="jx-bar-fill jx-fill-${t}" style="width:${Math.round((groups[k] / total) * 100)}%"></span></span><span class="jx-bar-v">${groups[k]}</span></div>`).join('')}</div>
      <p class="muted small">المعالجة الآلية تُطبق فقط على القواعد الواضحة؛ ما عداها يُراجع من المكتب.</p>`;
  }

  /* ---- policy review ---- */
  SEC.reviews = function () {
    const pf = S.state.platform, pend = pendingVersions();
    const decided = offices().flatMap((o) => o.audit.filter((e) => e.role === 'platform' && ['policy.published', 'policy.changes_requested'].includes(e.action)).map((e) => ({ o, e }))).sort((a, b) => Date.parse(b.e.at) - Date.parse(a.e.at)).slice(0, 10);
    return `${head('مراجعة السياسات', 'النسخ التي تتضمن قواعد مقيدة (مثل احتساب الزيارة مستهلكة أو نسب رسوم أعلى من الحد) لا تُنشر إلا باعتماد المنصة.')}
      <div class="note note-warning">${ic('alert')}<div>${h(pf.legalStatus)}.</div></div>
      ${pend.length ? pend.map(({ o, p, v }) => {
        const prev = p.versions.filter((x) => x.status === 'published').slice(-1)[0];
        const diff = prev ? JK.diffVersions(p.bookingType, prev, v).filter((d) => d.changed) : [];
        const rr = JK.restrictedReasons(v.rules, p.bookingType, pf);
        const val = JK.validatePolicy({ name: v.name || p.name, bookingType: p.bookingType, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo }, v.rules, pf, { forPublish: true, now: now() });
        const errs = val && val.errors ? val.errors : [];
        return `<article class="card jx-review"><div class="card-head"><div><span class="muted small">${h(o.office.name)} · ${h(o.office.city)}</span><h2>${h(p.name)} — النسخة ${v.version}</h2></div>${badge('بانتظار المراجعة', 'warning')}</div>
          ${kv([['نوع الحجز', h(L.bookingType[p.bookingType])], ['تسري من', h(JK.fmtDT(v.effectiveFrom))], ['أُرسلت', h(JK.fmtDTs(v.submittedAt))], ['أعدّها', h(v.createdBy || '—')]])}
          ${rr.length ? `<h3 class="h3">سبب الحاجة لاعتماد المنصة</h3><ul class="mini-list">${rr.map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
          ${errs.length ? `<div class="note note-danger">${ic('alert')}<div>${errs.map((e) => h(e.msg || e)).join('<br>')}</div></div>` : ''}
          ${diff.length ? `<h3 class="h3">التغييرات مقارنة بالنسخة المنشورة v${prev.version}</h3><div class="table-wrap"><table class="tbl tbl-compact diff"><thead><tr><th>البند</th><th>المنشور</th><th>المقترح</th></tr></thead><tbody>${diff.map((d) => `<tr class="changed"><th scope="row">${h(d.label)}</th><td>${h(d.a)}</td><td><b>${h(d.b)}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">لا توجد نسخة منشورة سابقة للمقارنة.</p>'}
          <p><button type="button" class="btn btn-ghost btn-sm" data-act="jx-ptext" data-o="${h(o.office.id)}" data-p="${h(p.id)}" data-v="${v.version}">${ic('eye')}<span>النص الذي سيراه العميل</span></button></p>
          <form data-submit="jx-decide" data-o="${h(o.office.id)}" data-p="${h(p.id)}" data-v="${v.version}" class="form"><label class="field"><span>ملاحظة المراجع</span><input name="note" id="jx-note-${h(p.id)}-${v.version}" placeholder="إلزامية عند طلب التعديل — تظهر للمكتب"></label>
            <div class="action-row"><button class="btn btn-primary btn-sm" type="submit" name="d" value="approve">${ic('check')}<span>اعتماد ونشر</span></button><button class="btn btn-danger btn-sm" type="submit" name="d" value="reject">طلب تعديلات</button></div></form></article>`;
      }).join('') : `<div class="card">${UI.empty('لا توجد نسخ بانتظار المراجعة', 'من بوابة المكتب: أنشئ نسخة تتضمن قاعدة مقيدة (مثل نسبة رسوم أعلى من ' + pf.rules.reviewRequiredFor.visitFeePctAbove + '% أو احتساب الزيارة مستهلكة) وأرسلها للمراجعة.')}</div>`}
      <section class="card"><h2>آخر قرارات المنصة</h2>${decided.length ? `<ul class="jx-list">${decided.map(({ o, e }) => `<li>${badge(e.action === 'policy.published' ? 'اعتماد' : 'طلب تعديلات', e.action === 'policy.published' ? 'success' : 'danger')} <b>${h(o.office.name)}</b> · ${h(e.entityId)} v${h((e.after && e.after.version) || '')} <span class="muted small">${h(JK.fmtDTs(e.at))}${e.note ? ' — ' + h(e.note) : ''}</span></li>`).join('')}</ul>` : '<p class="muted">لا قرارات بعد.</p>'}</section>`;
  };

  /* ---- offices & coverage ---- */
  SEC.offices = function () {
    const o = S.state.offices[jx().office] || offices()[0], at = now(), s = officeStats(o);
    return `${head('المكاتب والتغطية', 'لكل باقة معروضة للبيع يجب أن تكون هناك سياسة إلغاء صالحة واحدة كاملة (باقة ← خدمة ← افتراضي المكتب).')}
      <div class="jx-otabs" role="tablist">${offices().map((x) => `<button type="button" role="tab" aria-selected="${x === o}" class="${x === o ? 'on' : ''}" data-act="jx-office" data-o="${h(x.office.id)}">${h(x.office.name)}<span>${h(x.office.city)}</span></button>`).join('')}</div>
      <div class="kpis">
        <div class="kpi kpi-info"><span class="kpi-label">حجوزات نشطة</span><span class="kpi-value">${s.active}</span><span class="kpi-sub">من ${s.bookings}</span></div>
        <div class="kpi"><span class="kpi-label">قيمة الحجوزات</span><span class="kpi-value">${money(s.gmv)}</span><span class="kpi-sub">شاملة الضريبة ورسوم JOKRS</span></div>
        <div class="kpi ${s.overdue ? 'kpi-warning' : ''}"><span class="kpi-label">طلبات مفتوحة</span><span class="kpi-value">${s.open}</span><span class="kpi-sub">${s.overdue} متأخرة · ${s.exceptions} استثنائية/نزاع</span></div>
        <div class="kpi ${s.recovery ? 'kpi-warning' : ''}"><span class="kpi-label">مطالبات تسوية على المكتب</span><span class="kpi-value">${money(s.recovery)}</span><span class="kpi-sub">استردادات بعد صرف مستحقاته</span></div>
      </div>
      <section class="card"><h2>الباقات والسياسة المطبقة الآن</h2><div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>الخدمة / الباقة</th><th>النوع</th><th>السياسة السارية</th><th>المصدر</th><th>البيع</th></tr></thead><tbody>
        ${o.services.flatMap((sv) => sv.packages.map((pk) => { const r = JK.resolvePolicy(o, pk.id, at); return `<tr><td>${h(sv.name)}<div class="muted small">${h(pk.name)}</div></td><td>${h(L.bookingType[pk.bookingType])}</td>
          <td>${r.policy ? `${h(r.policy.name)} <span class="muted">v${r.version.version}</span>${r.version.platformApproved ? ' ' + badge('معتمدة من المنصة', 'accent') : ''}` : '<span class="text-danger">لا توجد</span>'}</td><td>${r.policy ? h(r.sourceLabel) : '—'}</td>
          <td>${pk.salesEnabled ? (r.policy ? badge('مفعّل', 'success') : badge('مفعّل بلا سياسة!', 'danger')) : badge('متوقف', 'muted')}</td></tr>`; })).join('')}
      </tbody></table></div></section>
      <section class="card"><h2>السياسات والنسخ</h2><div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>السياسة</th><th>النوع</th><th>النسخ</th></tr></thead><tbody>
        ${o.policies.map((p) => `<tr><td>${h(p.name)}${p.archived ? ' ' + badge('مؤرشفة', 'muted') : ''}<div class="muted small">${h(p.id)}</div></td><td>${h(L.bookingType[p.bookingType])}</td>
          <td>${p.versions.map((v) => `<span class="jx-ver">v${v.version} ${badge(L.versionStatus[v.status] || v.status, UI.TONES.version[v.status])}${v.platformApproved ? ' ' + ic('shield') : ''}</span>`).join(' ')}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  };

  /* ---- requests ---- */
  SEC.requests = function () {
    const f = jx().f;
    let list = allRequests();
    if (f.office) list = list.filter((x) => x.o.office.id === f.office);
    if (f.status === 'open') list = list.filter((x) => OPEN.includes(x.r.status));
    else if (f.status === 'flag') list = list.filter((x) => x.r.type === 'exception_review' || x.r.disputed || overdue(x.o, x.r));
    else if (f.status) list = list.filter((x) => x.r.status === f.status);
    if (f.type) list = list.filter((x) => x.r.type === f.type);
    if (f.q) list = list.filter((x) => (x.r.ref + ' ' + x.r.bookingRef + ' ' + x.r.customerName).includes(f.q));
    list.sort((a, b) => Date.parse(b.r.createdAt) - Date.parse(a.r.createdAt));
    return `${head('الطلبات عبر المكاتب', 'عرض رقابي للقراءة: القرار على الطلب يتخذه المكتب وفق السياسة التي وافق عليها العميل. المنصة تتابع المهل والنزاعات والمراجعات الاستثنائية.')}
      <div class="filters card">
        <label class="field"><span>المكتب</span>${officeSel('jx-f-office', f.office, 'jx-f')}</label>
        <label class="field"><span>الحالة</span><select id="jx-f-status" data-on-change="jx-f"><option value="">الكل</option><option value="open"${f.status === 'open' ? ' selected' : ''}>مفتوحة</option><option value="flag"${f.status === 'flag' ? ' selected' : ''}>تحتاج متابعة المنصة</option>${Object.keys(L.requestStatus).map((k) => `<option value="${k}"${f.status === k ? ' selected' : ''}>${h(L.requestStatus[k])}</option>`).join('')}</select></label>
        <label class="field"><span>النوع</span><select id="jx-f-type" data-on-change="jx-f"><option value="">الكل</option>${Object.keys(L.requestType).map((k) => `<option value="${k}"${f.type === k ? ' selected' : ''}>${h(L.requestType[k])}</option>`).join('')}</select></label>
        <label class="field"><span>بحث</span><input id="jx-f-q" type="search" value="${h(f.q)}" placeholder="رقم الطلب أو الحجز أو العميل" data-on-change="jx-f"></label>
      </div>
      <section class="card"><p class="muted small">${list.length} طلب</p>${list.length ? `<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>الطلب</th><th>المكتب</th><th>العميل</th><th>النوع</th><th>الحالة</th><th>المبلغ المعاد</th><th>رسوم المكتب</th><th>مؤشرات</th></tr></thead><tbody>
        ${list.map(({ o, r }) => `<tr class="clickable" data-act="jx-req" data-o="${h(o.office.id)}" data-id="${h(r.id)}"><td><b>${h(r.ref)}</b><div class="muted small">${h(JK.fmtDTs(r.createdAt))}</div></td><td>${oName(o)}</td><td>${h(r.customerName)}<div class="muted small">${h(r.bookingRef)}</div></td>
          <td>${h(L.requestType[r.type])}${r.initiator === 'office' ? '<div class="muted small">بمبادرة المكتب</div>' : ''}</td><td>${UI.reqBadge(r.status)}</td>
          <td>${r.calc ? money(r.calc.totalRefund) : '—'}</td><td>${r.calc ? money(r.calc.officeFee) : '—'}</td>
          <td>${overdue(o, r) ? badge('متأخر', 'danger') : ''}${r.type === 'exception_review' ? ' ' + badge('استثنائي', 'accent') : ''}${r.disputed ? ' ' + badge('نزاع', 'warning') : ''}${r.waiver ? ' ' + badge('إعفاء', 'info') : ''}</td></tr>`).join('')}
      </tbody></table></div>` : UI.empty('لا توجد طلبات مطابقة', 'غيّر عوامل التصفية.')}</section>`;
  };
  function requestDrawer(o, r) {
    const b = byId(o.bookings, r.bookingId), rf = r.refundId ? byId(o.refunds, r.refundId) : null;
    return `${kv([['المكتب', h(o.office.name)], ['الحجز', h(b.ref) + ' · ' + h(b.packageName)], ['العميل', h(r.customerName)], ['النوع', h(L.requestType[r.type])], ['الحالة', UI.reqBadge(r.status)],
        ['وقت الطلب', h(JK.fmtDT(r.requestedAt))], ['المبادر / المسبب', h(L.initiator[r.initiator] || r.initiator) + ' / ' + h(L.cause[r.cause] || r.cause)], ['السياسة المقبولة', h(r.policyVersion)], r.reason ? ['السبب', h(r.reason)] : null])}
      ${r.calc ? `<h3 class="h3">الحساب المطبق</h3>${UI.calcView(r.calc, b)}` : `<p class="muted">لم يُتخذ قرار بعد.</p>`}
      ${rf ? `<h3 class="h3">الاسترداد ${h(rf.ref)}</h3><p>${UI.refundBadge(rf.state)} ${money(rf.components.total)}</p>` : ''}
      <h3 class="h3">سجل الطلب</h3><ul class="timeline">${r.activity.map((a) => `<li><time>${h(JK.fmtDTs(a.at))}</time> <b>${h(a.actor)}</b> <span class="muted small">(${h(L.role[a.role] || a.role)})</span><div>${h(a.text)}</div></li>`).join('')}</ul>`;
  }

  /* ---- refunds & provider ---- */
  SEC.refunds = function () {
    const f = jx().rf, d = S.state.demo;
    let list = allRefunds();
    if (f.office) list = list.filter((x) => x.o.office.id === f.office);
    if (f.state) list = list.filter((x) => x.rf.state === f.state);
    list.sort((a, b) => Date.parse(b.rf.createdAt) - Date.parse(a.rf.createdAt));
    const pendingAtt = (rf) => rf.state === 'processing' && rf.attempts.length && rf.attempts[rf.attempts.length - 1].status === 'pending';
    return `${head('المبالغ المستردة ومزوّد الدفع', 'المالية في كل مكتب تعتمد وتبدأ التنفيذ؛ نتيجة التحويل تصل من مزوّد الدفع. هنا تحاكي المنصة إشعارات المزوّد — بما فيها الإشعارات المكررة التي يجب ألا يكون لها أثر مالي.')}
      <div class="card jx-provider ${d.providerOutage ? 'down' : ''}"><div>${ic(d.providerOutage ? 'alert' : 'check')}<b>مزوّد الدفع (محاكاة): ${d.providerOutage ? 'متعطل — محاولات الاسترداد بالبطاقة ستفشل' : 'يعمل'}</b></div>
        <label class="check"><input type="checkbox" id="jx-outage" data-on-change="jx-outage"${d.providerOutage ? ' checked' : ''}> محاكاة عطل المزوّد</label></div>
      <div class="filters card"><label class="field"><span>المكتب</span>${officeSel('jx-rf-office', f.office, 'jx-rf')}</label>
        <label class="field"><span>الحالة</span><select id="jx-rf-state" data-on-change="jx-rf"><option value="">الكل</option>${Object.keys(L.refundState).map((k) => `<option value="${k}"${f.state === k ? ' selected' : ''}>${h(L.refundState[k])}</option>`).join('')}</select></label></div>
      <section class="card">${list.length ? `<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>الاسترداد</th><th>المكتب</th><th>العميل</th><th>المبلغ</th><th>منها رسوم JOKRS</th><th>الوجهة</th><th>الحالة</th><th>إشعار المزوّد</th></tr></thead><tbody>
        ${list.map(({ o, rf }) => { const att = rf.attempts[rf.attempts.length - 1]; return `<tr><td><button type="button" class="link-btn" data-act="jx-rfopen" data-o="${h(o.office.id)}" data-id="${h(rf.id)}"><b>${h(rf.ref)}</b></button><div class="muted small">${h(rf.requestRef)}</div></td><td>${oName(o)}</td><td>${h(rf.customerName)}</td>
          <td>${money(rf.components.total)}</td><td>${rf.components.jokrs ? money(rf.components.jokrs) : '—'}</td><td class="small">${rf.destinations.map((x) => h(L.destAction[x.action])).join('<br>') || '—'}</td><td>${UI.refundBadge(rf.state)}${rf.attempts.length > 1 ? `<div class="muted small">${rf.attempts.length} محاولات</div>` : ''}</td>
          <td>${pendingAtt(rf) ? `<div class="action-row"><button type="button" class="btn btn-primary btn-sm" data-act="jx-cb" data-o="${h(o.office.id)}" data-id="${h(rf.id)}" data-att="${h(att.id)}" data-res="success">نجاح</button><button type="button" class="btn btn-danger btn-sm" data-act="jx-cb" data-o="${h(o.office.id)}" data-id="${h(rf.id)}" data-att="${h(att.id)}" data-res="failure">فشل</button></div>`
            : rf.state === 'completed' && att ? `<button type="button" class="btn btn-ghost btn-sm" data-act="jx-cb" data-o="${h(o.office.id)}" data-id="${h(rf.id)}" data-att="${h(att.id)}" data-res="success" title="يجب ألا يضيف أي مبلغ">إشعار مكرر</button>`
            : rf.state === 'failed' ? '<span class="muted small">بانتظار إعادة المحاولة من مالية المكتب</span>' : rf.state === 'approved' ? '<span class="muted small">بانتظار بدء التنفيذ من المكتب</span>' : rf.state === 'awaiting_review' ? '<span class="muted small">بانتظار اعتماد مالية المكتب</span>' : '—'}</td></tr>`; }).join('')}
      </tbody></table></div>` : UI.empty('لا توجد استردادات مطابقة', '')}</section>`;
  };
  function refundDrawer(o, rf) {
    const led = o.ledger.filter((e) => e.refundId === rf.id);
    return `${kv([['المكتب', h(o.office.name)], ['الطلب', h(rf.requestRef)], ['الحجز', h(rf.bookingRef)], ['العميل', h(rf.customerName)], ['الحالة', UI.refundBadge(rf.state)], ['معرّف العملية', `<code dir="ltr">${h(rf.opId)}</code>`], rf.providerRef ? ['مرجع المزوّد', `<code dir="ltr">${h(rf.providerRef)}</code>`] : null, rf.failureReason ? ['سبب الفشل', h(rf.failureReason)] : null])}
      <h3 class="h3">المكونات</h3>${kv([['خدمة المكتب', money(rf.components.service)], ['تعديل ضريبي', money(rf.components.tax)], ['رسوم JOKRS', money(rf.components.jokrs)], ['الإجمالي', money(rf.components.total)], ['رسوم المكتب المحتفظ بها', money(rf.officeFeeRetained)]])}
      <h3 class="h3">المسار</h3><ul class="timeline">${rf.timeline.map((t) => `<li><time>${h(JK.fmtDTs(t.at))}</time> ${UI.refundBadge(t.state)} <span class="muted small">${h(t.by)}${t.attempt ? ' · ' + h(t.attempt) : ''}</span></li>`).join('')}</ul>
      <h3 class="h3">قيود الدفتر</h3>${led.length ? `<table class="tbl tbl-compact"><tbody>${led.map((e) => `<tr><td>${h(e.label)}</td><td>${money(e.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">لا قيود بعد — تُسجل عند الاكتمال فقط.</p>'}`;
  }

  /* ---- ledger ---- */
  const ACCOUNTS = { customer_refund: 'مبالغ أعيدت للعملاء', office_service_reversal: 'عكس إيراد خدمة المكتب', tax_adjustment: 'تعديل ضريبي (محاكاة)', jokrs_fee_reversal: 'عكس رسوم JOKRS', office_settlement_recovery: 'مطالبة تسوية على المكتب', office_fee_retained: 'رسوم مكتب محتفظ بها (مذكرة)', entitlement_restored: 'إعادة استحقاق (مذكرة)', entitlement_transferred: 'نقل استحقاق (مذكرة)' };
  SEC.ledger = function () {
    const f = jx().lg;
    const os = f.office ? [S.state.offices[f.office]] : offices();
    const entries = os.flatMap((o) => o.ledger.map((e) => ({ o, e }))).filter((x) => !f.account || x.e.account === f.account).sort((a, b) => Date.parse(b.e.at) - Date.parse(a.e.at));
    const sumAcc = (o, k) => JK.sum(o.ledger.filter((e) => e.account === k).map((e) => e.amount));
    const accs = ['customer_refund', 'office_service_reversal', 'tax_adjustment', 'jokrs_fee_reversal', 'office_settlement_recovery', 'office_fee_retained'];
    return `${head('رسوم JOKRS والقيود', 'كل استرداد مكتمل يُنتج قيوداً مرتبطة: للعميل، للمكتب، للضريبة، ولحساب المنصة. رسوم JOKRS حساب منفصل عن رسوم المكتب.')}
      <section class="card"><h2>ملخص لكل مكتب</h2><div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>الحساب</th>${offices().map((o) => `<th>${h(o.office.name.split(' ').slice(0, 2).join(' '))}</th>`).join('')}<th>المجموع</th></tr></thead><tbody>
        <tr><th scope="row">رسوم JOKRS المحصلة</th>${offices().map((o) => `<td>${money(JK.sum(o.bookings.map((b) => b.price.jokrsFee)))}</td>`).join('')}<td><b>${money(JK.sum(offices().map((o) => JK.sum(o.bookings.map((b) => b.price.jokrsFee)))))}</b></td></tr>
        ${accs.map((k) => `<tr><th scope="row">${h(ACCOUNTS[k])}</th>${offices().map((o) => `<td>${money(sumAcc(o, k))}</td>`).join('')}<td><b>${money(JK.sum(offices().map((o) => sumAcc(o, k))))}</b></td></tr>`).join('')}
      </tbody></table></div></section>
      <div class="filters card"><label class="field"><span>المكتب</span>${officeSel('jx-lg-office', f.office, 'jx-lg')}</label>
        <label class="field"><span>الحساب</span><select id="jx-lg-acc" data-on-change="jx-lg"><option value="">الكل</option>${Object.keys(ACCOUNTS).map((k) => `<option value="${k}"${f.account === k ? ' selected' : ''}>${h(ACCOUNTS[k])}</option>`).join('')}</select></label></div>
      <section class="card"><h2>القيود (${entries.length})</h2>${entries.length ? `<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>القيد</th><th>المكتب</th><th>الحساب</th><th>البيان</th><th>المبلغ</th></tr></thead><tbody>
        ${entries.slice(0, 150).map(({ o, e }) => `<tr><td>${h(e.id)}<div class="muted small">${h(JK.fmtDTs(e.at))} · ${h(e.refundRef || '')}</div></td><td>${oName(o)}</td><td>${h(ACCOUNTS[e.account] || e.account)}${e.kind === 'memo' ? ' ' + badge('مذكرة', 'muted') : ''}</td><td class="small">${h(e.label)}</td><td>${money(e.amount)}</td></tr>`).join('')}
      </tbody></table></div>` : UI.empty('لا قيود', '')}</section>`;
  };

  /* ---- guardrails ---- */
  SEC.rules = function () {
    const pf = S.state.platform, r = pf.rules, j = pf.jokrsFee;
    const jl = { refund: 'تُسترد', retain: 'لا تُسترد' };
    return `${head('قيود المنصة', 'حدود تنطبق على سياسات كل المكاتب. أي نسخة تتجاوزها تُرفض عند الحفظ، وما يتجاوز حدود المراجعة يحتاج اعتماد المنصة قبل النشر.')}
      <div class="note note-warning">${ic('alert')}<div>${h(pf.legalStatus)}. التعديل هنا يُسجل في سجل كل مكتب.</div></div>
      <div class="jx-grid2">
        <section class="card"><h2>حدود السياسات (${h(pf.version)})</h2>
          <form data-submit="jx-rules" class="form form-grid">
            <label class="field"><span>الحد الأقصى لرسوم إلغاء الزيارة %</span><input name="maxVisitFeePct" id="jx-r1" type="number" min="0" max="100" value="${r.maxVisitFeePct}"></label>
            <label class="field"><span>الحد الأقصى لرسوم إلغاء الباقة %</span><input name="maxPackageFeePct" id="jx-r2" type="number" min="0" max="100" value="${r.maxPackageFeePct}"></label>
            <label class="field"><span>فترة سماح إلزامية بعد التأكيد (دقيقة، 0 = لا يوجد)</span><input name="minGraceMinutes" id="jx-r3" type="number" min="0" max="1440" value="${r.minGraceMinutes}"></label>
            <label class="check"><input type="checkbox" name="allowConsume" id="jx-r4"${r.allowConsumeEntitlement ? ' checked' : ''}> السماح بخيار "احتساب الزيارة مستهلكة" (يتطلب المراجعة)</label>
            <label class="check"><input type="checkbox" name="direct" id="jx-r5"${pf.allowDirectPublish ? ' checked' : ''}> السماح للمكاتب بالنشر المباشر للقواعد الاعتيادية</label>
            <div><button class="btn btn-primary btn-sm" type="submit">${ic('check')}<span>حفظ قيود المنصة</span></button></div>
          </form>
          <p class="muted small">تتطلب المراجعة: احتساب الزيارة مستهلكة · رسوم زيارة أعلى من ${r.reviewRequiredFor.visitFeePctAbove}% · رسوم باقة أعلى من ${r.reviewRequiredFor.packageFeePctAbove}%.</p></section>
        <section class="card"><h2>قواعد رسوم JOKRS (${h(pf.feeRuleVersion)})</h2>
          ${kv([['الرسوم لكل حجز', money(j.amount)], ['خلل أو إلغاء من المكتب', h(jl[j.officeFault])], ['إلغاء العميل ضمن فترة السماح', h(jl[j.customerCancelWithinGrace])], ['قبل قبول المكتب للحجز', h(jl[j.pendingAcceptance])], ['إلغاء العميل العادي', h(jl[j.customerCancel])]])}
          <p class="muted small">تعرض للعميل قبل الدفع كبند منفصل عن رسوم المكتب. ${h(pf.termsVersion)}.</p></section>
      </div>`;
  };

  /* ---- unified audit ---- */
  SEC.audit = function () {
    const f = jx().au;
    let list = offices().flatMap((o) => o.audit.map((e) => ({ o, e })));
    if (f.office) list = list.filter((x) => x.o.office.id === f.office);
    if (f.role) list = list.filter((x) => (f.role === 'office' ? ['admin', 'operations', 'finance', 'viewer'].includes(x.e.role) : x.e.role === f.role));
    if (f.q) list = list.filter((x) => (x.e.actor + ' ' + x.e.entityId + ' ' + x.e.note + ' ' + (UI.ACTION_LABEL[x.e.action] || x.e.action)).includes(f.q));
    list.sort((a, b) => Date.parse(b.e.at) - Date.parse(a.e.at) || (b.e.id > a.e.id ? 1 : -1));
    const roleTone = { customer: 'info', platform: 'accent', system: 'muted' };
    return `${head('سجل التدقيق الموحد', 'سجل إلحاقي فقط لكل المكاتب: من فعل ماذا ومتى، مع القيم قبل وبعد.')}
      <div class="filters card"><label class="field"><span>المكتب</span>${officeSel('jx-au-office', f.office, 'jx-au')}</label>
        <label class="field"><span>المنفّذ</span><select id="jx-au-role" data-on-change="jx-au"><option value="">الكل</option><option value="office"${f.role === 'office' ? ' selected' : ''}>موظفو المكاتب</option><option value="customer"${f.role === 'customer' ? ' selected' : ''}>العملاء</option><option value="platform"${f.role === 'platform' ? ' selected' : ''}>المنصة</option><option value="system"${f.role === 'system' ? ' selected' : ''}>النظام / المزوّد</option></select></label>
        <label class="field"><span>بحث</span><input id="jx-au-q" type="search" value="${h(f.q)}" data-on-change="jx-au"></label></div>
      <section class="card"><p class="muted small">${list.length} حدث${list.length > 150 ? ' — يُعرض أحدث 150' : ''}</p><div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>الوقت</th><th>المكتب</th><th>المنفّذ</th><th>الإجراء</th><th>السجل</th><th>ملاحظة</th></tr></thead><tbody>
        ${list.slice(0, 150).map(({ o, e }) => `<tr><td>${h(JK.fmtDTs(e.at))}<div class="muted small">${h(e.id)}</div></td><td>${oName(o)}</td><td>${h(e.actor)}<div>${badge(L.role[e.role] || e.role, roleTone[e.role] || 'warning')}</div></td><td>${h(UI.ACTION_LABEL[e.action] || e.action)}</td><td dir="ltr" class="small">${h(e.entityId)}</td><td class="small">${h(e.note || '')}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  };

  /* =================================================================== */
  /* Frame                                                               */
  /* =================================================================== */
  UI.renderJokrs = function () {
    const root = document.getElementById('view-jokrs');
    const sec = SEC[jx().sec] ? jx().sec : 'overview';
    const pend = pendingVersions().length, failed = allRefunds().filter((x) => x.rf.state === 'failed').length;
    const flagged = allRequests().filter(({ o, r }) => OPEN.includes(r.status) && (overdue(o, r) || r.type === 'exception_review' || r.disputed)).length;
    const counts = { reviews: pend ? badge(pend, 'warning') : '', refunds: failed ? badge(failed, 'danger') : '', requests: flagged ? badge(flagged, 'warning') : '' };
    let body;
    try { body = SEC[sec](); } catch (e) { console.error(e); body = `<div class="note note-danger">${ic('alert')}<div>تعذّر عرض القسم: ${h(e.message)}</div></div>`; }
    root.innerHTML = `<div class="jx-shell">
      <aside class="jx-side" aria-label="أقسام لوحة المنصة">
        <div class="jx-brand"><span class="jx-logo">J</span><div><strong>JOKRS</strong><span>لوحة المنصة</span></div></div>
        <nav><ul>${NAV.map(([k, l, i]) => `<li><button type="button" class="jx-nav${k === sec ? ' active' : ''}" data-act="jx-sec" data-s="${k}"${k === sec ? ' aria-current="page"' : ''}>${ic(i)}<span>${h(l)}</span>${counts[k] || ''}</button></li>`).join('')}</ul></nav>
        <div class="side-user">${ic('shield')}<div><strong>مراجع منصة JOKRS</strong><span>محاكاة</span></div></div>
        <p class="side-fine">لوحة تمثيلية لفريق المنصة، وليست لوحة الإدارة العليا الكاملة.</p>
      </aside>
      <main class="jx-main" id="jx-main" tabindex="-1">${body}</main></div>`;
  };

  let lastSubmit = null;
  document.addEventListener('click', (e) => { const b = e.target.closest('#view-jokrs button[type=submit][name=d]'); if (b) lastSubmit = b.value; }, true);
  Object.assign(UI.act, {
    'jx-sec': (el) => { jx().sec = el.dataset.s; UI.render(); window.scrollTo(0, 0); const m = document.getElementById('jx-main'); if (m) m.focus({ preventScroll: true }); },
    'jx-office': (el) => { jx().office = el.dataset.o; jx().sec = 'offices'; UI.render(); },
    'jx-f': () => { const f = jx().f; f.office = UI.inputVal('jx-f-office'); f.status = UI.inputVal('jx-f-status'); f.type = UI.inputVal('jx-f-type'); f.q = UI.inputVal('jx-f-q').trim(); UI.render(); },
    'jx-rf': () => { const f = jx().rf; f.office = UI.inputVal('jx-rf-office'); f.state = UI.inputVal('jx-rf-state'); UI.render(); },
    'jx-lg': () => { const f = jx().lg; f.office = UI.inputVal('jx-lg-office'); f.account = UI.inputVal('jx-lg-acc'); UI.render(); },
    'jx-au': () => { const f = jx().au; f.office = UI.inputVal('jx-au-office'); f.role = UI.inputVal('jx-au-role'); f.q = UI.inputVal('jx-au-q').trim(); UI.render(); },
    'jx-req': (el) => { const o = S.state.offices[el.dataset.o], r = byId(o.requests, el.dataset.id); openModal({ title: 'الطلب ' + r.ref, drawer: true, body: () => requestDrawer(o, byId(o.requests, r.id)) }); },
    'jx-rfopen': (el) => { const o = S.state.offices[el.dataset.o]; openModal({ title: 'الاسترداد ' + el.dataset.id, drawer: true, body: () => refundDrawer(o, byId(o.refunds, el.dataset.id)) }); },
    'jx-ptext': (el) => {
      const o = S.state.offices[el.dataset.o], p = byId(o.policies, el.dataset.p), v = p.versions.find((x) => x.version === parseInt(el.dataset.v, 10));
      openModal({ title: p.name + ' — v' + v.version + ' (كما يراها العميل)', drawer: true, body: UI.policyTextView(JK.policyText(v.rules, p.bookingType, S.state.platform, {})) });
    },
    'jx-decide': (f) => {
      const d = lastSubmit || 'approve'; lastSubmit = null;
      jxRun('platformDecide', { officeId: f.dataset.o, policyId: f.dataset.p, version: parseInt(f.dataset.v, 10), decision: d, note: f.elements.note.value }, d === 'approve' ? 'اعتُمدت النسخة ونُشرت — ستظهر للعملاء في الحجوزات الجديدة من تاريخ سريانها.' : 'أُعيدت النسخة للمكتب مع ملاحظاتك.', f.dataset.o);
    },
    'jx-outage': (el) => { jxRun('setDemo', { providerOutage: el.checked }, el.checked ? 'عطل المزوّد مفعّل: محاولات الاسترداد بالبطاقة ستفشل.' : 'عاد مزوّد الدفع للعمل.'); },
    'jx-cb': (el) => {
      const r = jxRun('providerCallback', { refundId: el.dataset.id, attemptId: el.dataset.att, result: el.dataset.res, reason: el.dataset.res === 'failure' ? 'رفض البنك المصدر العملية (محاكاة)' : undefined }, null, el.dataset.o);
      if (r.ok) toast(r.res.duplicate ? 'إشعار مكرر — تم تجاهله دون أي أثر مالي (سُجّل في التدقيق).' : el.dataset.res === 'success' ? 'اكتمل الاسترداد وسُجلت القيود.' : 'فشل الاسترداد — يظهر لمالية المكتب لإعادة المحاولة.', r.res.duplicate ? 'info' : el.dataset.res === 'success' ? 'success' : 'danger');
    },
    'jx-rules': (f) => {
      const e = f.elements, n = (x, lo, hi) => { const v = Number(x.value); return x.value !== '' && Number.isFinite(v) && v >= lo && v <= hi ? v : null; };
      const r = { maxVisitFeePct: n(e.maxVisitFeePct, 0, 100), maxPackageFeePct: n(e.maxPackageFeePct, 0, 100), minGraceMinutes: n(e.minGraceMinutes, 0, 1440), allowConsumeEntitlement: e.allowConsume.checked };
      if (Object.values(r).some((v) => v === null)) { toast('قيم غير صالحة: النسب بين 0 و100 والدقائق بين 0 و1440.', 'danger'); return; }
      if (r.minGraceMinutes > 0) r.minGraceLeadHours = 0;
      jxRun('setPlatform', { rules: r, allowDirectPublish: e.direct.checked }, 'حُفظت قيود المنصة وسُجّلت في سجل كل مكتب.');
    }
  });
})(window);

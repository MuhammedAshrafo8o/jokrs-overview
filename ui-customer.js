/* =====================================================================
   ui-customer.js — "تطبيق العميل": a standalone customer mobile app view.
   Shares the same store as the office portal and the JOKRS dashboard.
   Every action goes through JK.Store.dispatchAs(..., {role:'customer'})
   so the same rules, calculation and audit trail apply.
   ===================================================================== */
(function (G) {
  'use strict';
  const JK = G.JK, S = JK.Store, L = JK.L, UI = JK.UI;
  const { h, ic, badge, toast, openModal, confirmDialog } = UI;
  const byId = (a, id) => JK.store.byId(a, id);
  const now = () => S.state.demo.now;

  /* ---------------- customer-facing wording ---------------- */
  const REQ_STATUS = { awaiting_review: 'قيد المراجعة لدى المكتب', info_requested: 'مطلوب منك معلومات', proposal_sent: 'بانتظار ردك', approved: 'تم', auto_approved: 'تم', rejected: 'مرفوض' };
  const REQ_TONE = { awaiting_review: 'warning', info_requested: 'danger', proposal_sent: 'danger', approved: 'success', auto_approved: 'success', rejected: 'muted' };
  const RF_STATUS = { awaiting_review: 'قيد المراجعة', approved: 'معتمد — سيُحوَّل قريباً', processing: 'جارٍ التحويل', completed: 'تم الاسترداد', failed: 'تأخر التحويل — نعيد المحاولة', not_required: 'لا يوجد مبلغ نقدي' };
  const RF_TONE = { awaiting_review: 'warning', approved: 'info', processing: 'info', completed: 'success', failed: 'danger', not_required: 'muted' };
  const VISIT_STATUS = { scheduled: 'مؤكدة', completed: 'تمت', canceled: 'ملغاة', customer_no_show: 'لم تتم (تعذّر الاستقبال)', partially_delivered: 'تمت جزئياً', office_canceled: 'ألغاها المكتب', replaced: 'استُبدلت بموعد آخر', canceled_late: 'ملغاة — احتُسب الرصيد' };
  const REASONS = [['plans', 'تغيّرت خططي'], ['travel', 'سفر'], ['emergency', 'ظرف طارئ'], ['price', 'وجدت بديلاً'], ['other', 'سبب آخر']];
  const TABS = [['home', 'الرئيسية', 'home'], ['bookings', 'حجوزاتي', 'calendar'], ['requests', 'طلباتي', 'inbox'], ['wallet', 'المحفظة', 'wallet']];

  /* ---------------- state ---------------- */
  function freshCx() { return { officeId: 'A', customerId: 'c-a4', stack: [{ s: 'home' }], book: null, cn: null, rs: null, iq: null }; }
  UI.cx = freshCx();
  (UI.resetHooks = UI.resetHooks || []).push(() => { UI.cx = freshCx(); });
  const cx = () => UI.cx;
  const cxOffice = () => S.state.offices[cx().officeId];
  const cxCustomer = () => byId(cxOffice().customers, cx().customerId) || cxOffice().customers[0];
  const top = () => cx().stack[cx().stack.length - 1];
  const myBookings = () => cxOffice().bookings.filter((b) => b.customerId === cxCustomer().id);
  const myRequests = () => { const ids = myBookings().map((b) => b.id); return cxOffice().requests.filter((r) => ids.includes(r.bookingId)); };
  const myRefunds = () => { const ids = myBookings().map((b) => b.id); return cxOffice().refunds.filter((r) => ids.includes(r.bookingId)); };
  const needsAction = (r) => ['proposal_sent', 'info_requested'].includes(r.status);
  const money = (v) => `<span class="money">${h(JK.sar(v))}</span>`;

  function nav(s, p) { cx().stack.push(Object.assign({ s }, p || {})); UI.render(); scrollPhone(); }
  function replace(s, p) { cx().stack[cx().stack.length - 1] = Object.assign({ s }, p || {}); UI.render(); scrollPhone(); }
  function back() { if (cx().stack.length > 1) cx().stack.pop(); UI.render(); scrollPhone(); }
  function tab(s) { cx().stack = [{ s }]; UI.render(); scrollPhone(); }
  function scrollPhone() { const el = document.getElementById('cx-scroll'); if (el) el.scrollTop = 0; }

  /** Run a store action as this customer. */
  function cxRun(name, args, okMsg) {
    const c = cxCustomer();
    try {
      const res = S.dispatchAs(name, args, { officeId: cx().officeId, role: 'customer', actor: { name: c.name, role: 'customer' } });
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(res) : okMsg, 'success');
      return { ok: true, res };
    } catch (e) {
      if (!e.isAction) { console.error(e); toast('خطأ غير متوقع: ' + e.message, 'danger'); return { ok: false, error: e }; }
      toast(e.message, 'danger');
      return { ok: false, error: e };
    }
  }

  /* ---------------- tab info for the top switcher ---------------- */
  UI.customerTabInfo = function () {
    const c = cxCustomer();
    const n = myRequests().filter(needsAction).length;
    return { sub: c.name + ' · ' + cxOffice().office.name, count: n, countTitle: 'طلبات تنتظر ردك' };
  };

  /* ---------------- booking helpers ---------------- */
  function upcoming(b) { const t = Date.parse(now()); return b.visits.filter((v) => v.status === 'scheduled' && Date.parse(v.start) > t).sort((a, z) => Date.parse(a.start) - Date.parse(z.start)); }
  function bookingStatus(b) {
    const up = upcoming(b);
    if (b.type === 'credits') {
      const av = b.credits.items.filter((c) => c.state === 'available' && Date.parse(c.expiresAt) > Date.parse(now())).length;
      if (av || up.length) return ['نشط · ' + av + ' رصيد متاح', 'success'];
      return ['منتهٍ', 'muted'];
    }
    if (up.length) return [b.officeAcceptance === 'pending' ? 'بانتظار قبول المكتب' : 'نشط', b.officeAcceptance === 'pending' ? 'warning' : 'success'];
    if (b.visits.every((v) => ['canceled', 'canceled_late', 'office_canceled', 'replaced'].includes(v.status))) return ['ملغى', 'muted'];
    return ['مكتمل', 'neutral'];
  }
  function priceOf(q) { const net = JK.sum(q.lines.map((l) => l.amount)), vat = Math.round((net * q.vatBps) / 10000); return { lines: q.lines, net, vat, jokrsFee: q.jokrsFee, total: net + vat + q.jokrsFee }; }
  function pkgAvailable(o, pk) { const r = JK.resolvePolicy(o, pk.id, now()); return pk.salesEnabled && !!r.policy; }
  function startOf(d) { return d && d.date && d.time ? JK.riyadhISO(d.date + 'T' + d.time) : null; }
  function defaultDate(days) { return JK.toRiyadhInput(new Date(Date.parse(now()) + (days || 3) * JK.DAY).toISOString()).slice(0, 10); }
  const TIMES = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
  function dateTimeFields(prefix, d) {
    return `<div class="cx-row2"><label class="cx-field"><span>التاريخ</span><input type="date" id="${prefix}-date" value="${h(d.date || '')}" data-on-change="cx-dt" data-p="${prefix}" data-k="date"></label>
      <label class="cx-field"><span>الوقت</span><select id="${prefix}-time" data-on-change="cx-dt" data-p="${prefix}" data-k="time">${TIMES.map((t) => `<option${t === d.time ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>`;
  }

  /* =================================================================== */
  /* Screens                                                             */
  /* =================================================================== */
  const SCREENS = {};

  SCREENS.home = function () {
    const o = cxOffice(), c = cxCustomer(), at = now();
    const act = myRequests().filter(needsAction);
    const next = myBookings().flatMap((b) => upcoming(b).map((v) => ({ b, v }))).sort((a, z) => Date.parse(a.v.start) - Date.parse(z.v.start))[0];
    const q0 = new Date(Date.parse(at) + 3 * JK.DAY).toISOString();
    return {
      title: 'مرحباً ' + c.name.split(' ')[0], noBack: true,
      body: `
        ${act.length ? `<section class="cx-sec"><h3 class="cx-h">${ic('bell')} يحتاج ردّك</h3>${act.map((r) => `<button type="button" class="cx-alert" data-act="cx-go" data-s="request" data-id="${h(r.id)}"><strong>${h(r.status === 'proposal_sent' ? 'اقترح المكتب موعداً بديلاً' : 'المكتب يطلب معلومات إضافية')}</strong><span>${h(L.requestType[r.type])} · ${h(r.bookingRef)}</span>${ic('chev')}</button>`).join('')}</section>` : ''}
        ${next ? `<section class="cx-sec"><h3 class="cx-h">موعدك القادم</h3><button type="button" class="cx-next" data-act="cx-go" data-s="booking" data-id="${h(next.b.id)}">
            <span class="cx-next-date">${ic('calendar')}<span><b>${h(JK.fmtDate(next.v.start))}</b><span>${h(JK.fmtTime(next.v.start))} · ${h(next.b.durationMin / 60)} ساعات</span></span></span>
            <span class="cx-next-meta">${h(next.b.packageName)}<span class="cx-muted">${h(next.v.workers.filter((w) => w.status === 'assigned').map((w) => w.name).join('، '))}</span></span>
            ${freeTill(next.b, next.v)}</button></section>` : ''}
        <section class="cx-sec"><h3 class="cx-h">احجز خدمة من ${h(o.office.name)}</h3>
          ${o.services.map((s) => `<div class="cx-svc"><p class="cx-svc-name">${h(s.name)}</p>${s.packages.map((pk) => {
            const ok = pkgAvailable(o, pk);
            const q = JK.store.quote(o, S.state.platform, { packageId: pk.id, start: q0 }, at), p = priceOf(q);
            return `<button type="button" class="cx-pkg${ok ? '' : ' off'}" ${ok ? `data-act="cx-book" data-pk="${h(pk.id)}"` : `aria-disabled="true" data-why="هذه الباقة غير متاحة للحجز حالياً."`}>
              <span class="cx-pkg-main"><b>${h(pk.name)}</b><span class="cx-muted">${h(L.bookingType[pk.bookingType])}${pk.bookingType !== 'single' ? ' · ' + pk.visits + ' زيارات' : ''}</span></span>
              <span class="cx-pkg-price">${ok ? money(p.total) : '<span class="cx-off">غير متاحة حالياً</span>'}</span></button>`;
          }).join('')}</div>`).join('')}
        </section>`
    };
  };
  function freeTill(b, v) {
    if (b.type === 'credits') return '';
    const dl = JK.freeDeadline(b.policySnapshot.rules, v.start);
    if (!dl) return '';
    const open = Date.parse(dl) > Date.parse(now());
    return `<span class="cx-free ${open ? 'ok' : 'late'}">${ic(open ? 'check' : 'clock')} ${open ? 'إلغاء مجاني حتى ' + h(JK.fmtDT(dl)) : 'انتهت فترة الإلغاء المجاني'}</span>`;
  }

  /* ---- book: package detail ---- */
  SCREENS.book = function (p) {
    const o = cxOffice(), f = JK.findPackage(o, p.pk);
    if (!f) return { title: 'الباقة', body: '<p class="cx-muted">الباقة غير موجودة.</p>' };
    const pk = f.pkg;
    const d = cx().book && cx().book.packageId === pk.id ? cx().book : (cx().book = { packageId: pk.id, date: defaultDate(3), time: '10:00', workers: pk.costing.defaultWorkers || 1 });
    const start = startOf(d);
    const q = JK.store.quote(o, S.state.platform, { packageId: pk.id, workerCount: parseInt(d.workers, 10) || 1, start: start || now() }, now()), pr = priceOf(q);
    const ok = pkgAvailable(o, pk);
    const terms = q.resolved.policy ? UI.keyTerms(q.resolved.version.rules, pk.bookingType, pk.bookingType !== 'credits' ? start : null) : [];
    const future = start && Date.parse(start) > Date.parse(now());
    return {
      title: pk.name,
      body: `
        <section class="cx-sec"><p class="cx-muted">${h(f.service.name)} · ${h(L.bookingType[pk.bookingType])}${pk.bookingType !== 'single' ? ' · ' + pk.visits + ' زيارات' : ''} · ${h(pk.costing.hours)} ساعات للزيارة</p>
          ${pk.bookingType === 'credits' ? `<p class="cx-note">${ic('info')} تحصل على ${pk.visits} أرصدة زيارات صالحة ${pk.validityDays || 90} يوماً، وتحجز المواعيد لاحقاً.</p>`
            : `<h3 class="cx-h">${pk.bookingType === 'scheduled' ? 'موعد الزيارة الأولى (ثم أسبوعياً)' : 'موعد الزيارة'}</h3>${dateTimeFields('bk', d)}
              ${pk.bookingType === 'single' ? `<label class="cx-field"><span>عدد العاملات</span><select id="bk-w" data-on-change="cx-dt" data-p="bk" data-k="workers">${[1, 2, 3].map((n) => `<option value="${n}"${String(n) === String(d.workers) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
              ${!future ? `<p class="cx-warn">${ic('alert')} اختر موعداً في المستقبل.</p>` : ''}
              ${q.plan.length > 1 && future ? `<ul class="cx-dates">${q.plan.slice(0, 4).map((x) => `<li>${ic('calendar')}${h(JK.fmtDT(x.start))}</li>`).join('')}${q.plan.length > 4 ? `<li class="cx-muted">+ ${q.plan.length - 4} مواعيد أخرى</li>` : ''}</ul>` : ''}`}
        </section>
        <section class="cx-sec"><h3 class="cx-h">السعر</h3>${priceTable(pr)}</section>
        ${q.resolved.policy ? `<section class="cx-sec"><h3 class="cx-h">ملخص سياسة الإلغاء</h3><dl class="cx-terms">${terms.slice(0, 4).map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${h(v)}</dd></div>`).join('')}</dl><p class="cx-muted small">ستوافق على السياسة كاملة قبل الدفع.</p></section>` : ''}`,
      foot: ok ? `<button type="button" class="cx-cta" data-act="cx-checkout"${pk.bookingType !== 'credits' && !future ? ' aria-disabled="true" data-why="اختر موعداً في المستقبل."' : ''}>متابعة للدفع · ${h(JK.sar(pr.total))}</button>`
        : `<button type="button" class="cx-cta" aria-disabled="true" data-why="الباقة غير متاحة للحجز.">غير متاحة حالياً</button>`
    };
  };
  function priceTable(pr) {
    return `<table class="cx-price"><tbody>${pr.lines.map((l) => `<tr><td>${h(l.label)}</td><td>${money(l.amount)}</td></tr>`).join('')}
      ${pr.discount ? `<tr><td>${h(pr.discountLabel || 'خصم')}</td><td>${money(-pr.discount)}</td></tr>` : ''}
      <tr><td>ضريبة القيمة المضافة</td><td>${money(pr.vat)}</td></tr><tr><td>رسوم منصة JOKRS</td><td>${money(pr.jokrsFee)}</td></tr>
      <tr class="cx-total"><td>الإجمالي</td><td>${money(pr.total)}</td></tr></tbody></table>`;
  }

  /* ---- checkout with policy acceptance ---- */
  SCREENS.checkout = function () {
    const o = cxOffice(), sess = o.checkout, c = cxCustomer(), d = cx().book;
    const mine = sess && d && sess.customerId === c.id && sess.packageId === d.packageId && !sess.result;
    if (!mine) return { title: 'الدفع', body: `<div class="cx-empty">${ic('alert')}<p>انتهت جلسة الدفع أو بدأت جلسة أخرى لهذا المكتب.</p><button type="button" class="cx-btn" data-act="cx-back">العودة للباقة</button></div>` };
    const q = JK.store.quote(o, S.state.platform, sess, now()), pr = priceOf(q);
    const accepted = !!(sess.accepted && sess.acceptedKey === q.key);
    const stale = sess.accepted && sess.acceptedKey && sess.acceptedKey !== q.key;
    if (!q.resolved.policy || !q.pkg.salesEnabled) return { title: 'الدفع', body: `<div class="cx-alert-box">${ic('alert')}<span>هذه الباقة لم تعد متاحة للحجز (لا توجد سياسة إلغاء صالحة أو البيع متوقف).</span></div>` };
    const terms = UI.keyTerms(q.resolved.version.rules, q.pkg.bookingType, q.plan[0] ? q.plan[0].start : null);
    const pf = S.state.platform;
    return {
      title: 'مراجعة الحجز والدفع',
      body: `
        <section class="cx-sec"><b>${h(q.pkg.name)}</b><p class="cx-muted">${h(o.office.name)}${q.plan[0] ? ' · يبدأ ' + h(JK.fmtDT(q.plan[0].start)) : ''}${q.plan.length > 1 ? ' · ' + q.plan.length + ' زيارات' : ''}</p></section>
        <section class="cx-sec">${priceTable(pr)}</section>
        <section class="cx-sec"><h3 class="cx-h">سياسة الإلغاء والاسترداد</h3><dl class="cx-terms">${terms.map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${h(v)}</dd></div>`).join('')}</dl>
          <button type="button" class="cx-link" data-act="cx-fullpolicy">عرض السياسة كاملة</button></section>
        <div class="cx-jokrs">${ic('shield')}<span>رسوم JOKRS (${h(JK.sar(pf.jokrsFee.amount))}) منفصلة عن رسوم المكتب: تُسترد عند خلل المكتب${pf.jokrsFee.customerCancelWithinGrace === 'refund' ? ' أو الإلغاء ضمن فترة السماح' : ''}، ولا تُسترد عند الإلغاء العادي.</span></div>
        ${stale ? `<div class="cx-alert-box" role="alert">${ic('alert')}<span>تم تحديث السياسة منذ موافقتك (النسخة الحالية v${q.resolved.version.version}). راجع الشروط ووافق من جديد.</span></div>` : ''}
        <label class="cx-accept" for="cx-accept"><input type="checkbox" id="cx-accept" data-on-change="cx-accept"${accepted ? ' checked' : ''}> <span>قرأت سياسة الإلغاء والاسترداد وشروط المنصة وأوافق عليها</span></label>
        <p class="cx-ver">${h(q.resolved.policy.name)} — النسخة ${q.resolved.version.version} · ${h(pf.termsVersion)} · ${h(pf.feeRuleVersion)}</p>`,
      foot: accepted ? `<button type="button" class="cx-cta" data-act="cx-pay">ادفع ${h(JK.sar(pr.total))} <span class="cx-sim">(محاكاة)</span></button>`
        : `<button type="button" class="cx-cta" aria-disabled="true" data-why="يجب الموافقة على السياسة الحالية أولاً.">ادفع ${h(JK.sar(pr.total))}</button>`
    };
  };
  SCREENS.done = function (p) {
    const b = byId(cxOffice().bookings, p.id);
    if (!b) return { title: 'تم', body: '' };
    return {
      title: 'تم الحجز', noBack: true,
      body: `<div class="cx-done">${ic('check', 'cx-done-ic')}<h3>تم تأكيد حجزك</h3><p class="cx-muted">رقم الحجز <b dir="ltr">${h(b.ref)}</b></p>
        <p>دفعت ${money(b.price.total)} (محاكاة). حُفظت نسخة من سياسة الإلغاء التي وافقت عليها (${h(b.policySnapshot.policyName)} v${b.policySnapshot.version}) مع حجزك — ولن تتغير حتى لو عدّل المكتب سياسته لاحقاً.</p></div>`,
      foot: `<button type="button" class="cx-cta" data-act="cx-go" data-s="booking" data-id="${h(b.id)}" data-reset="1">عرض الحجز</button>`
    };
  };

  /* ---- bookings ---- */
  SCREENS.bookings = function () {
    const list = myBookings().slice().sort((a, z) => Date.parse(z.createdAt) - Date.parse(a.createdAt));
    return {
      title: 'حجوزاتي', noBack: true,
      body: list.length ? list.map((b) => {
        const [st, tone] = bookingStatus(b), nx = upcoming(b)[0];
        return `<button type="button" class="cx-card" data-act="cx-go" data-s="booking" data-id="${h(b.id)}">
          <span class="cx-card-top"><b>${h(b.packageName)}</b>${badge(st, tone)}</span>
          <span class="cx-muted">${h(b.ref)} · ${h(L.bookingType[b.type])}</span>
          ${nx ? `<span class="cx-card-line">${ic('calendar')} القادم: ${h(JK.fmtDT(nx.start))}</span>` : ''}
          ${myRequests().some((r) => r.bookingId === b.id && needsAction(r)) ? `<span class="cx-card-line cx-red">${ic('bell')} طلب ينتظر ردك</span>` : ''}</button>`;
      }).join('') : `<div class="cx-empty">${ic('calendar')}<p>لا توجد حجوزات بعد.</p><button type="button" class="cx-btn" data-act="cx-tab" data-s="home">احجز خدمة</button></div>`
    };
  };

  SCREENS.booking = function (p) {
    const o = cxOffice(), b = byId(o.bookings, p.id);
    if (!b) return { title: 'الحجز', body: '<p class="cx-muted">الحجز غير موجود.</p>' };
    const at = Date.parse(now());
    const up = upcoming(b);
    const reqs = myRequests().filter((r) => r.bookingId === b.id).sort((a, z) => Date.parse(z.createdAt) - Date.parse(a.createdAt));
    const openReq = reqs.find((r) => ['awaiting_review', 'info_requested', 'proposal_sent'].includes(r.status));
    const canCancel = up.length > 0 || (b.type === 'credits' && b.credits.items.some((c) => c.state === 'available'));
    const done = b.visits.filter((v) => ['completed', 'partially_delivered'].includes(v.status));
    const [st, tone] = bookingStatus(b);
    const visits = b.visits.slice().sort((a, z) => Date.parse(a.start) - Date.parse(z.start));
    return {
      title: b.packageName,
      body: `
        <section class="cx-sec"><div class="cx-card-top"><span class="cx-muted" dir="ltr">${h(b.ref)}</span>${badge(st, tone)}</div>
          <p class="cx-muted">${h(o.office.name)} · ${h(L.bookingType[b.type])} · دُفع ${money(b.price.total)}</p>
          ${b.officeAcceptance === 'pending' ? `<p class="cx-note">${ic('clock')} بانتظار قبول المكتب. يمكنك الإلغاء قبل القبول وفق السياسة.</p>` : ''}</section>
        ${openReq ? `<button type="button" class="cx-alert" data-act="cx-go" data-s="request" data-id="${h(openReq.id)}"><strong>${h(L.requestType[openReq.type])}</strong><span>${h(REQ_STATUS[openReq.status])}</span>${ic('chev')}</button>` : ''}
        ${b.type === 'credits' ? `<section class="cx-sec"><h3 class="cx-h">رصيد الزيارات</h3>${creditSummary(b)}</section>` : ''}
        ${visits.length ? `<section class="cx-sec"><h3 class="cx-h">${b.type === 'credits' ? 'المواعيد المحجوزة من الرصيد' : 'المواعيد'}</h3><ul class="cx-visits">${visits.map((v) => {
          const fut = v.status === 'scheduled' && Date.parse(v.start) > at;
          return `<li class="${fut ? '' : 'past'}"><span class="cx-v-date"><b>${h(JK.fmtDate(v.start))}</b><span>${h(JK.fmtTime(v.start))}</span></span>
            <span class="cx-v-meta">${badge(VISIT_STATUS[v.status] || v.status, UI.TONES.visit[v.status])}${v.origin === 'replacement' ? ' ' + badge('موعد بديل', 'accent') : ''}${v.origin === 'promo' ? ' ' + badge('مجانية', 'accent') : ''}
            <span class="cx-muted">${h(v.workers.filter((w) => ['assigned', 'delivered'].includes(w.status)).map((w) => w.name).join('، ') || '—')}</span>${v.originalStart ? `<span class="cx-muted">كان ${h(JK.fmtDTs(v.originalStart))}</span>` : ''}</span></li>`;
        }).join('')}</ul></section>` : ''}
        ${up[0] && b.type !== 'credits' ? `<p>${freeTill(b, up[0])}</p>` : ''}
        <section class="cx-sec"><h3 class="cx-h">السياسة التي وافقت عليها</h3><p>${h(b.policySnapshot.policyName)} — النسخة ${b.policySnapshot.version}</p>
          <p class="cx-muted">وافقت في ${h(JK.fmtDT(b.acceptance.at))} · محفوظة مع الحجز ولا تتأثر بتعديلات المكتب اللاحقة.</p>
          <button type="button" class="cx-link" data-act="cx-snapshot" data-id="${h(b.id)}">عرض الشروط التي وافقت عليها</button></section>
        ${reqs.length ? `<section class="cx-sec"><h3 class="cx-h">الطلبات على هذا الحجز</h3>${reqs.map(reqRow).join('')}</section>` : ''}`,
      foot: `<div class="cx-actions">
        ${canCancel ? `<button type="button" class="cx-btn danger" data-act="cx-go" data-s="cancel" data-id="${h(b.id)}">${ic('x')} ${b.type === 'credits' ? 'إلغاء / استرداد' : 'إلغاء'}</button>` : ''}
        ${up.length ? `<button type="button" class="cx-btn" data-act="cx-go" data-s="reschedule" data-id="${h(b.id)}">${ic('calendar')} تغيير موعد</button>` : ''}
        ${done.length ? `<button type="button" class="cx-btn" data-act="cx-go" data-s="issue" data-id="${h(b.id)}">${ic('alert')} الإبلاغ عن مشكلة</button>` : ''}
      </div>`
    };
  };
  function creditSummary(b) {
    const at = Date.parse(now());
    const cnt = {}; b.credits.items.forEach((c) => { const k = c.state === 'available' && Date.parse(c.expiresAt) <= at ? 'expired' : c.state; cnt[k] = (cnt[k] || 0) + 1; });
    const exp = b.credits.items.filter((c) => c.state === 'available').map((c) => c.expiresAt).sort()[0];
    return `<div class="cx-credits">${Object.keys(cnt).map((k) => `<span class="cx-chip cx-chip-${k}"><b>${cnt[k]}</b> ${h(L.creditState[k] || k)}</span>`).join('')}</div>
      ${exp ? `<p class="cx-muted">صالح حتى ${h(JK.fmtDate(exp))}</p>` : ''}`;
  }
  function reqRow(r) {
    return `<button type="button" class="cx-req" data-act="cx-go" data-s="request" data-id="${h(r.id)}"><span><b>${h(L.requestType[r.type])}</b><span class="cx-muted">${h(r.ref)} · ${h(JK.fmtDTs(r.createdAt))}</span></span>${badge(REQ_STATUS[r.status], REQ_TONE[r.status])}</button>`;
  }

  /* ---- cancel ---- */
  function cancelOps(b) {
    return b.type === 'single' ? [['cancel_visits', 'إلغاء الزيارة']] : b.type === 'scheduled' ? [['cancel_visits', 'إلغاء زيارات محددة'], ['cancel_all_remaining', 'إلغاء كل الزيارات المتبقية']] : [['credit_cancel', 'إلغاء موعد محجوز'], ['package_refund', 'استرداد الرصيد غير المستخدم']];
  }
  SCREENS.cancel = function (p) {
    const o = cxOffice(), b = byId(o.bookings, p.id);
    if (!b) return { title: 'إلغاء', body: '' };
    if (!cx().cn || cx().cn.bookingId !== b.id) cx().cn = { bookingId: b.id, op: cancelOps(b)[0][0], visitIds: [], destination: 'original', reason: 'plans', exc: '' };
    const cn = cx().cn, ops = cancelOps(b);
    if (!ops.some(([k]) => k === cn.op)) cn.op = ops[0][0];
    const vs = upcoming(b), needV = ['cancel_visits', 'credit_cancel'].includes(cn.op), multi = cn.op === 'cancel_visits' && b.type === 'scheduled';
    cn.visitIds = cn.visitIds.filter((id) => vs.some((v) => v.id === id));
    if (needV && !cn.visitIds.length && vs.length) cn.visitIds = [vs[0].id];
    const c = JK.calculate({ booking: b, platform: S.state.platform, req: { type: cn.op, at: now(), visitIds: needV ? cn.visitIds : [], destination: cn.destination, initiator: 'customer', cause: 'customer' } });
    const authorized = b.price.payments.some((x) => x.state === 'authorized');
    const rf = b.policySnapshot.rules.refund;
    return {
      title: 'إلغاء — ' + b.packageName,
      body: `
        <section class="cx-sec">${ops.length > 1 ? `<div class="cx-seg" role="radiogroup" aria-label="نوع العملية">${ops.map(([k, l]) => `<button type="button" role="radio" aria-checked="${k === cn.op}" class="${k === cn.op ? 'on' : ''}" data-act="cx-cn" data-k="op" data-v="${k}">${h(l)}</button>`).join('')}</div>` : ''}
          ${needV ? `<fieldset class="cx-pick"><legend>${multi ? 'اختر المواعيد' : 'اختر الموعد'}</legend>${vs.map((v) => `<label><input type="${multi ? 'checkbox' : 'radio'}" name="cx-cv" value="${h(v.id)}" data-on-change="cx-cv"${cn.visitIds.includes(v.id) ? ' checked' : ''}> <span>${h(JK.fmtDT(v.start))}</span>${v.origin === 'promo' ? badge('مجانية', 'accent') : ''}</label>`).join('') || '<p class="cx-muted">لا مواعيد قادمة.</p>'}</fieldset>` : ''}
          ${cn.op === 'cancel_all_remaining' ? `<p class="cx-muted">يشمل كل الزيارات القادمة (${vs.length}).</p>` : ''}
          ${cn.op === 'package_refund' ? `<p class="cx-muted">استرداد قيمة الأرصدة غير المستخدمة وغير المنتهية.</p>` : ''}</section>
        ${c.ok ? `<section class="cx-sec cx-calc"><h3 class="cx-h">ما الذي ستحصل عليه</h3>
            <div class="cx-big">${c.outcome === 'credit_restore' ? `${ic('refresh')}<span>يُعاد الموعد إلى رصيدك</span>` : c.creditOutcome === 'forfeited' ? `${ic('alert')}<span>يُحتسب الرصيد — لا مبلغ</span>` : `<span class="cx-big-amt">${money(c.totalRefund)}</span><span class="cx-muted">يُعاد إليك</span>`}</div>
            <dl class="cx-terms">
              <div><dt>القاعدة المطبقة</dt><dd>${h(c.rule ? c.rule.label : '—')}</dd></div>
              ${c.officeFee ? `<div><dt>رسوم الإلغاء للمكتب</dt><dd>${money(c.officeFee)}</dd></div>` : ''}
              ${c.jokrs.retained ? `<div><dt>رسوم JOKRS غير المستردة</dt><dd>${money(c.jokrs.retained)}</dd></div>` : ''}
              ${c.jokrs.refund ? `<div><dt>منها رسوم JOKRS مستردة</dt><dd>${money(c.jokrs.refund)}</dd></div>` : ''}
              ${c.destinations.length ? `<div><dt>إلى</dt><dd>${c.destinations.map((d) => h(L.destAction[d.action]) + ' ' + h(JK.sar(d.amount))).join('<br>')}</dd></div>` : ''}
              ${c.totalRefund > 0 ? `<div><dt>المدة المتوقعة</dt><dd>خلال ${rf.processingDays} ${rf.dayType === 'business' ? 'أيام عمل' : 'أيام'} من الاعتماد</dd></div>` : ''}
            </dl>
            ${c.totalRefund > 0 && !authorized && rf.allowWallet ? `<fieldset class="cx-pick"><legend>أين تريد المبلغ؟</legend><label><input type="radio" name="cx-dst" value="original" data-on-change="cx-dst"${cn.destination !== 'wallet' ? ' checked' : ''}> وسيلة الدفع الأصلية</label><label><input type="radio" name="cx-dst" value="wallet" data-on-change="cx-dst"${cn.destination === 'wallet' ? ' checked' : ''}> محفظة JOKRS (أسرع)</label></fieldset>` : ''}
            ${authorized ? `<p class="cx-muted">${ic('info')} لم يُخصم المبلغ من بطاقتك بعد؛ سيُلغى التفويض فقط.</p>` : ''}
            ${c.needsReview ? `<p class="cx-note">${ic('clock')} ${h(c.reviewReasons[0] || 'سيراجع المكتب طلبك قبل التنفيذ.')}</p>` : ''}
            ${c.warnings.length ? `<p class="cx-muted small">${h(c.warnings[0])}</p>` : ''}</section>
          <label class="cx-field"><span>سبب الإلغاء</span><select id="cx-reason" data-on-change="cx-cnset" data-k="reason">${REASONS.map(([k, l]) => `<option value="${k}"${k === cn.reason ? ' selected' : ''}>${h(l)}</option>`).join('')}</select></label>`
        : `<div class="cx-alert-box" role="alert">${ic('alert')}<span>${h(c.blocked)}</span></div>
          ${c.canRequestReview ? `<section class="cx-sec"><h3 class="cx-h">طلب مراجعة استثنائية</h3><p class="cx-muted">إذا كان لديك ظرف خاص، يمكنك طلب مراجعة من المكتب. لن يُنفذ شيء تلقائياً.</p>
            <label class="cx-field"><span>اشرح ظرفك</span><textarea id="cx-exc" rows="3" data-on-change="cx-cnset" data-k="exc">${h(cn.exc)}</textarea></label></section>` : ''}`}`,
      foot: c.ok ? `<button type="button" class="cx-cta danger" data-act="cx-cancel-go">تأكيد الإلغاء</button>`
        : c.canRequestReview ? `<button type="button" class="cx-cta" data-act="cx-cancel-go" data-exc="1">إرسال طلب المراجعة</button>` : ''
    };
  };

  /* ---- reschedule ---- */
  SCREENS.reschedule = function (p) {
    const o = cxOffice(), b = byId(o.bookings, p.id);
    if (!b) return { title: 'تغيير موعد', body: '' };
    const vs = upcoming(b);
    if (!cx().rs || cx().rs.bookingId !== b.id || !vs.some((v) => v.id === cx().rs.visitId)) {
      const v0 = vs[0]; const d = v0 ? JK.toRiyadhInput(new Date(Date.parse(v0.start) + 2 * JK.DAY).toISOString()) : '';
      cx().rs = { bookingId: b.id, visitId: v0 ? v0.id : null, date: d.slice(0, 10), time: d ? d.slice(11, 16) : '10:00', exc: '' };
      if (!TIMES.includes(cx().rs.time)) cx().rs.time = '10:00';
    }
    const rs = cx().rs, v = byId(b.visits, rs.visitId);
    const ns = startOf(rs);
    const c = v ? JK.calculate({ booking: b, platform: S.state.platform, req: { type: 'reschedule', at: now(), visitIds: [v.id], newStart: ns, initiator: 'customer', cause: 'customer' } }) : null;
    const wIds = v ? v.workers.filter((w) => w.status === 'assigned').map((w) => w.workerId) : [];
    const av = v && ns ? JK.checkAvailability(o, wIds, ns, b.durationMin, v.id) : { ok: true, conflicts: [] };
    const r = b.policySnapshot.rules.reschedule;
    return {
      title: 'تغيير موعد',
      body: `
        <section class="cx-sec"><fieldset class="cx-pick"><legend>الموعد الحالي</legend>${vs.map((x) => `<label><input type="radio" name="cx-rv" value="${h(x.id)}" data-on-change="cx-rv"${x.id === rs.visitId ? ' checked' : ''}> ${h(JK.fmtDT(x.start))}</label>`).join('')}</fieldset></section>
        <section class="cx-sec"><h3 class="cx-h">الموعد الجديد</h3>${dateTimeFields('rs', rs)}
          ${r && r.enabled ? `<p class="cx-muted small">قبل ${r.minNoticeHours} ساعة على الأقل · ${r.freeChanges} تعديلات مجانية${r.feeAfterFree ? ' ثم ' + JK.sar(r.feeAfterFree) + ' للتعديل' : ''} · استخدمت ${b.customerReschedules || 0}</p>` : ''}</section>
        ${c && c.ok ? `<section class="cx-sec cx-calc"><dl class="cx-terms"><div><dt>القاعدة</dt><dd>${h(c.rule.label)}</dd></div><div><dt>رسوم التعديل</dt><dd>${c.rescheduleFee ? money(c.rescheduleFee) + ' <span class="cx-muted">(تُخصم من قيمة الزيارة المدفوعة)</span>' : 'مجاناً'}</dd></div></dl>
            ${av.ok ? `<p class="cx-ok">${ic('check')} العاملة متاحة في هذا الموعد</p>` : `<p class="cx-warn">${ic('alert')} ${h(av.conflicts.map((x) => x.text).join('؛ '))} — سيراجع المكتب ويقترح موعداً بديلاً.</p>`}
            ${c.effects.schedule && c.effects.schedule.lockBand ? `<p class="cx-note">${ic('info')} التعديل داخل فترة رسوم الإلغاء؛ ستبقى شريحة "${h(c.effects.schedule.lockBand.label)}" مطبقة على هذه الزيارة إن ألغيتها لاحقاً.</p>` : ''}</section>`
          : c ? `<div class="cx-alert-box" role="alert">${ic('alert')}<span>${h(c.blocked)}</span></div>${c.canRequestReview ? `<label class="cx-field"><span>اشرح سبب طلبك (مراجعة استثنائية)</span><textarea id="cx-rexc" rows="3" data-on-change="cx-rsset" data-k="exc">${h(rs.exc)}</textarea></label>` : ''}` : ''}`,
      foot: c && c.ok ? `<button type="button" class="cx-cta" data-act="cx-rs-go">طلب تغيير الموعد</button>` : c && c.canRequestReview ? `<button type="button" class="cx-cta" data-act="cx-rs-go" data-exc="1">إرسال طلب المراجعة</button>` : ''
    };
  };

  /* ---- report an issue (after service) ---- */
  SCREENS.issue = function (p) {
    const o = cxOffice(), b = byId(o.bookings, p.id);
    const vs = b ? b.visits.filter((v) => ['completed', 'partially_delivered'].includes(v.status)) : [];
    if (!cx().iq || cx().iq.bookingId !== p.id) cx().iq = { bookingId: p.id, visitId: vs.length ? vs[vs.length - 1].id : null, text: '', amount: '' };
    const iq = cx().iq;
    return {
      title: 'الإبلاغ عن مشكلة',
      body: `<section class="cx-sec"><fieldset class="cx-pick"><legend>الزيارة</legend>${vs.map((v) => `<label><input type="radio" name="cx-iv" value="${h(v.id)}" data-on-change="cx-iqset" data-k="visitId"${v.id === iq.visitId ? ' checked' : ''}> ${h(JK.fmtDT(v.start))} · ${h(VISIT_STATUS[v.status])}</label>`).join('')}</fieldset></section>
        <label class="cx-field"><span>ماذا حدث؟</span><textarea id="cx-itext" rows="4" data-on-change="cx-iqset" data-k="text" placeholder="مثال: لم يُنظف المطبخ">${h(iq.text)}</textarea></label>
        <label class="cx-field"><span>التعويض الذي تطلبه (اختياري، ر.س)</span><input id="cx-iamt" inputmode="decimal" value="${h(iq.amount)}" data-on-change="cx-iqset" data-k="amount"></label>
        <p class="cx-note">${ic('info')} يراجع المكتب البلاغ ويحدد التعويض. رسوم JOKRS لا تتأثر بتعويض الجودة.</p>`,
      foot: `<button type="button" class="cx-cta" data-act="cx-issue-go">إرسال البلاغ</button>`
    };
  };

  /* ---- requests ---- */
  SCREENS.requests = function () {
    const list = myRequests().slice().sort((a, z) => (needsAction(z) - needsAction(a)) || Date.parse(z.createdAt) - Date.parse(a.createdAt));
    return { title: 'طلباتي', noBack: true, body: list.length ? list.map(reqRow).join('') : `<div class="cx-empty">${ic('inbox')}<p>لا توجد طلبات.</p></div>` };
  };
  SCREENS.request = function (p) {
    const o = cxOffice(), r = byId(o.requests, p.id);
    if (!r) return { title: 'الطلب', body: '<p class="cx-muted">الطلب غير موجود.</p>' };
    const b = byId(o.bookings, r.bookingId), rf = r.refundId ? byId(o.refunds, r.refundId) : null;
    const prop = r.proposals.filter((x) => x.status === 'pending').slice(-1)[0];
    const decided = ['approved', 'auto_approved', 'rejected'].includes(r.status);
    const hasMoney = rf && rf.components.total > 0;
    const steps = [['تم الإرسال', true], ['مراجعة المكتب', decided || r.status !== 'awaiting_review'], [r.status === 'rejected' ? 'مرفوض' : 'القرار', decided]];
    if (hasMoney) steps.push(['الاسترداد', rf.state === 'completed']);
    const cur = steps.findIndex((s) => !s[1]);
    const lastInfo = r.status === 'info_requested' ? r.activity.slice().reverse().find((a) => a.role !== 'customer') : null;
    const rules = b.policySnapshot.rules.refund;
    const approvedAt = rf && (rf.timeline.find((t) => t.state === 'approved') || {}).at;
    return {
      title: L.requestType[r.type],
      body: `
        <section class="cx-sec"><div class="cx-card-top"><span class="cx-muted" dir="ltr">${h(r.ref)}</span>${badge(REQ_STATUS[r.status], REQ_TONE[r.status])}</div>
          <p class="cx-muted">${h(b.packageName)} · ${h(b.ref)}${r.visitIds.length ? ' · ' + r.visitIds.map((id) => { const v = byId(b.visits, id); return v ? JK.fmtDTs(v.originalStart || v.start) : ''; }).join('، ') : ''}</p>
          <ol class="cx-steps">${steps.map(([l, ok], i) => `<li class="${ok ? 'done' : i === cur ? 'cur' : ''}"><span>${ok ? ic('check') : i + 1}</span>${h(l)}</li>`).join('')}</ol></section>
        ${r.status === 'proposal_sent' && prop ? `<section class="cx-sec cx-action"><h3 class="cx-h">${ic('bell')} ${r.type === 'office_cancel' ? 'المكتب يعتذر ويقترح موعداً بديلاً' : 'اقترح المكتب موعداً بديلاً'}</h3>
            <p class="cx-prop">${ic('calendar')} <b>${h(JK.fmtDT(prop.start))}</b></p>
            ${r.type === 'office_cancel' ? `<p class="cx-muted">لأن الإلغاء من المكتب: إن رفضت البديل تسترد المبلغ كاملاً بلا رسوم (بما فيها رسوم JOKRS).</p>` : `<p class="cx-muted">موعدك الأصلي يبقى مؤكداً حتى تقرر. رفضك لا يغيّر وقت طلبك ولا شريحة الرسوم.</p>`}
            <div class="cx-actions"><button type="button" class="cx-btn primary" data-act="cx-prop" data-id="${h(r.id)}" data-a="1">قبول الموعد</button><button type="button" class="cx-btn" data-act="cx-prop" data-id="${h(r.id)}" data-a="0">${r.type === 'office_cancel' ? 'رفض واسترداد كامل' : 'رفض'}</button></div></section>` : ''}
        ${r.status === 'info_requested' ? `<section class="cx-sec cx-action"><h3 class="cx-h">${ic('bell')} المكتب يطلب معلومات</h3>${lastInfo ? `<p class="cx-quote">${h(lastInfo.text.replace(/^طُلبت معلومات من العميل:\s*/, ''))}</p>` : ''}
            <label class="cx-field"><span>ردّك</span><textarea id="cx-info" rows="3"></textarea></label><button type="button" class="cx-btn primary" data-act="cx-info" data-id="${h(r.id)}">إرسال الرد</button></section>` : ''}
        ${r.status === 'rejected' && r.decision ? `<section class="cx-sec"><h3 class="cx-h">سبب الرفض</h3><p class="cx-quote">${h(r.decision.note)}</p><p class="cx-muted small">يحق لك طلب مراجعة القرار لدى منصة JOKRS.</p></section>` : ''}
        ${r.calc && decided && r.status !== 'rejected' ? `<section class="cx-sec cx-calc"><h3 class="cx-h">النتيجة</h3><dl class="cx-terms">
            ${r.calc.outcome === 'reschedule' ? `<div><dt>الموعد الجديد</dt><dd>${h(JK.fmtDT(r.calc.effects.schedule.to))}</dd></div><div><dt>رسوم التعديل</dt><dd>${r.calc.rescheduleFee ? money(r.calc.rescheduleFee) : 'مجاناً'}</dd></div>`
              : r.calc.outcome === 'credit_restore' ? `<div><dt>النتيجة</dt><dd>أُعيد الموعد إلى رصيدك</dd></div>`
              : r.calc.outcome === 'replacement' ? `<div><dt>النتيجة</dt><dd>تم حجز الموعد البديل دون أي رسوم</dd></div>`
              : `<div><dt>المبلغ المعاد</dt><dd>${money(r.calc.totalRefund)}</dd></div>${r.calc.officeFee ? `<div><dt>رسوم المكتب</dt><dd>${money(r.calc.officeFee)}</dd></div>` : ''}${r.calc.jokrs.retained ? `<div><dt>رسوم JOKRS غير المستردة</dt><dd>${money(r.calc.jokrs.retained)}</dd></div>` : ''}`}
            ${r.waiver ? `<div><dt>إعفاء من المكتب</dt><dd>${money(r.waiver)}</dd></div>` : ''}</dl></section>` : ''}
        ${hasMoney ? `<section class="cx-sec"><h3 class="cx-h">تتبع الاسترداد</h3><div class="cx-card-top"><b>${money(rf.components.total)}</b>${badge(RF_STATUS[rf.state], RF_TONE[rf.state])}</div>
            <p class="cx-muted">${rf.destinations.map((d) => h(L.destAction[d.action])).join(' + ')}</p>
            ${approvedAt && rf.state !== 'completed' ? `<p class="cx-muted">متوقع قبل ${h(JK.fmtDate(JK.addDays(approvedAt, rules.processingDays, rules.dayType)))}</p>` : ''}
            ${rf.state === 'completed' ? `<p class="cx-ok">${ic('check')} اكتمل في ${h(JK.fmtDT(rf.completedAt))}${rf.providerRef ? ` · مرجع <span dir="ltr">${h(rf.providerRef)}</span>` : ''}</p>` : ''}
            ${rf.state === 'failed' ? `<p class="cx-warn">${ic('alert')} تأخر التحويل من مزوّد الدفع. سيُعاد المحاولة دون أي إجراء منك، ولن يُحتسب المبلغ مرتين.</p>` : ''}</section>`
          : rf && rf.note ? `<section class="cx-sec"><p class="cx-muted">${h(rf.note)}</p></section>` : ''}
        <section class="cx-sec"><h3 class="cx-h">السجل</h3><ul class="cx-log">${r.activity.slice().reverse().map((a) => `<li><span class="cx-log-who">${h(a.role === 'customer' ? 'أنت' : a.role === 'system' ? 'آلي' : 'المكتب')}</span><span>${h(a.text)}</span><time>${h(JK.fmtDTs(a.at))}</time></li>`).join('')}</ul></section>`
    };
  };

  /* ---- wallet ---- */
  SCREENS.wallet = function () {
    const bks = myBookings(), rfs = myRefunds().slice().sort((a, z) => Date.parse(z.createdAt) - Date.parse(a.createdAt));
    const wallet = JK.sum(bks.map((b) => b.walletCredited || 0));
    const pending = JK.sum(rfs.filter((r) => ['awaiting_review', 'approved', 'processing', 'failed'].includes(r.state)).map((r) => r.components.total));
    const credits = bks.filter((b) => b.type === 'credits');
    return {
      title: 'المحفظة', noBack: true,
      body: `<div class="cx-wallet"><span class="cx-muted">رصيد المحفظة</span><b>${money(wallet)}</b>${pending ? `<span class="cx-muted">+ ${h(JK.sar(pending))} استردادات قيد التنفيذ</span>` : ''}</div>
        ${credits.length ? `<section class="cx-sec"><h3 class="cx-h">أرصدة الزيارات</h3>${credits.map((b) => `<button type="button" class="cx-card" data-act="cx-go" data-s="booking" data-id="${h(b.id)}"><span class="cx-card-top"><b>${h(b.packageName)}</b></span>${creditSummary(b)}</button>`).join('')}</section>` : ''}
        <section class="cx-sec"><h3 class="cx-h">الاستردادات</h3>${rfs.length ? rfs.map((rf) => `<button type="button" class="cx-req" data-act="cx-go" data-s="request" data-id="${h(rf.requestId)}"><span><b>${rf.components.total ? money(rf.components.total) : h(rf.outcome === 'credit_restore' ? 'إعادة رصيد' : 'بدون مبلغ')}</b><span class="cx-muted">${h(rf.bookingRef)} · ${h(JK.fmtDTs(rf.createdAt))}</span></span>${badge(RF_STATUS[rf.state], RF_TONE[rf.state])}</button>`).join('') : '<p class="cx-muted">لا توجد استردادات.</p>'}</section>`
    };
  };

  /* =================================================================== */
  /* Frame + side panels                                                 */
  /* =================================================================== */
  UI.renderCustomer = function () {
    const root = document.getElementById('view-customer');
    const t = top(), fn = SCREENS[t.s] || SCREENS.home;
    let sc;
    try { sc = fn(t); } catch (e) { console.error(e); sc = { title: 'خطأ', body: `<div class="cx-alert-box">${ic('alert')}<span>تعذّر عرض الشاشة: ${h(e.message)}</span></div>` }; }
    const rootTab = TABS.some(([k]) => k === cx().stack[0].s) ? cx().stack[0].s : 'home';
    const actN = myRequests().filter(needsAction).length;
    const scrollEl = document.getElementById('cx-scroll'), keep = scrollEl && root.dataset.screen === JSON.stringify(t) ? scrollEl.scrollTop : 0;
    root.innerHTML = `<div class="cx-layout">
        ${contextPanel()}
        <div class="cx-stage"><p class="cx-stage-cap">${ic('phone')} تطبيق العميل — ما يراه العميل على جواله</p>
          <div class="cx-phone" role="region" aria-label="شاشة تطبيق العميل"><div class="cx-screen">
            <div class="cx-status"><span>${h(JK.fmtTime(now()))}</span><span class="cx-brand">JOKRS</span><span>${ic('wallet')}</span></div>
            <div class="cx-appbar">${cx().stack.length > 1 && !sc.noBack ? `<button type="button" class="cx-icon" data-act="cx-back" aria-label="رجوع">${ic('chev', 'flip')}</button>` : '<span class="cx-icon-sp"></span>'}<h2 class="cx-title">${h(sc.title)}</h2><span class="cx-icon-sp"></span></div>
            <div class="cx-scroll" id="cx-scroll">${sc.body}</div>
            ${sc.foot ? `<div class="cx-foot">${sc.foot}</div>` : ''}
            <nav class="cx-tabs" aria-label="أقسام التطبيق">${TABS.map(([k, l, i]) => `<button type="button" class="${rootTab === k ? 'on' : ''}" data-act="cx-tab" data-s="${k}"${rootTab === k ? ' aria-current="page"' : ''}>${ic(i)}<span>${h(l)}</span>${k === 'requests' && actN ? `<i class="cx-dot">${actN}</i>` : ''}</button>`).join('')}</nav>
          </div></div></div>
        ${backstagePanel()}
      </div>`;
    root.dataset.screen = JSON.stringify(t);
    const ns = document.getElementById('cx-scroll'); if (ns && keep) ns.scrollTop = keep;
  };

  function contextPanel() {
    const st = S.state, c = cxCustomer();
    return `<aside class="cx-side card" aria-label="هوية العميل في المحاكاة">
      <h2 class="h3">${ic('user')} تتصفح التطبيق كعميل</h2>
      <label class="field"><span>العميل (وهمي)</span><select id="cx-who" data-on-change="cx-who">${Object.values(st.offices).map((o) => `<optgroup label="${h(o.office.name)} — ${h(o.office.city)}">${o.customers.map((cu) => {
        const bs = o.bookings.filter((b) => b.customerId === cu.id), n = bs.length;
        const wait = o.requests.some((r) => bs.some((b) => b.id === r.bookingId) && needsAction(r));
        return `<option value="${h(o.office.id + '|' + cu.id)}"${o.office.id === cx().officeId && cu.id === c.id ? ' selected' : ''}>${h(cu.name)}${n ? ` (${n} حجز)` : ''}${wait ? ' • ينتظر ردّه' : ''}</option>`;
      }).join('')}</optgroup>`).join('')}</select></label>
      <p class="muted small">في هذه المحاكاة يرتبط كل عميل بمكتب واحد، ويرى خدمات ذلك المكتب وحجوزاته فقط.</p>
      <h3 class="h3">جرّب</h3>
      <ul class="cx-tips">
        <li>احجز باقة ووافق على السياسة، ثم افتح <b>بوابة المكتب ← سجل النشاط</b> لترى الموافقة المسجلة.</li>
        <li>ألغِ زيارة وشاهد الرسوم والمبلغ المعاد قبل التأكيد، ثم تابع الاسترداد في <b>لوحة JOKRS</b>.</li>
        <li>اطلب تغيير موعد، ثم من بوابة المكتب اقترح موعداً بديلاً — وارجع هنا لقبوله أو رفضه.</li>
        <li>غيّر <b>الوقت المحاكى</b> من الشريط العلوي لترى كيف تتغير الرسوم مع اقتراب الموعد.</li>
      </ul>
      <p class="muted small">الدفع والرسائل محاكاة فقط. لا توجد معاملات حقيقية.</p>
    </aside>`;
  }
  function backstagePanel() {
    const o = cxOffice(), bIds = myBookings().map((b) => b.id), rIds = myRequests().map((r) => r.id), fIds = myRefunds().map((r) => r.id);
    const mine = (e) => bIds.includes(e.entityId) || rIds.includes(e.entityId) || fIds.includes(e.entityId) || bIds.some((id) => String(e.entityId).indexOf(id + '-') === 0);
    const ev = o.audit.filter(mine).slice(-12).reverse();
    const who = (e) => e.role === 'customer' ? ['العميل', 'info'] : e.role === 'platform' ? ['JOKRS', 'accent'] : e.role === 'system' ? ['آلي', 'muted'] : ['المكتب', 'warning'];
    return `<aside class="cx-side card cx-back" aria-label="خلف الكواليس">
      <h2 class="h3">${ic('history')} خلف الكواليس</h2>
      <p class="muted small">ما يُسجَّل في سجل التدقيق لحجوزات هذا العميل — من أي واجهة.</p>
      ${ev.length ? `<ul class="cx-feed">${ev.map((e) => { const [l, t] = who(e); return `<li>${badge(l, t)}<div><b>${h(UI.ACTION_LABEL[e.action] || e.action)}</b><span class="muted small">${h(e.actor)} · <span dir="ltr">${h(e.entityId)}</span></span><time class="muted small">${h(JK.fmtDTs(e.at))}</time></div></li>`; }).join('')}</ul>` : '<p class="muted">لا أحداث بعد.</p>'}
    </aside>`;
  }

  /* =================================================================== */
  /* Actions                                                             */
  /* =================================================================== */
  Object.assign(UI.act, {
    'cx-tab': (el) => tab(el.dataset.s),
    'cx-back': () => back(),
    'cx-go': (el) => { if (el.dataset.reset) cx().stack = [{ s: 'bookings' }]; nav(el.dataset.s, { id: el.dataset.id }); },
    'cx-who': (el) => { const [oid, cid] = el.value.split('|'); UI.cx = Object.assign(freshCx(), { officeId: oid, customerId: cid }); UI.render(); },
    'cx-book': (el) => { cx().book = null; nav('book', { pk: el.dataset.pk }); },
    'cx-dt': (el) => {
      const map = { bk: cx().book, rs: cx().rs };
      const d = map[el.dataset.p]; if (!d) return;
      d[el.dataset.k] = el.value; UI.render();
    },
    'cx-checkout': () => {
      const d = cx().book, o = cxOffice(), f = JK.findPackage(o, d.packageId);
      const start = f.pkg.bookingType === 'credits' ? new Date(Date.parse(now()) + JK.DAY).toISOString() : startOf(d);
      const r = cxRun('checkoutStart', { packageId: d.packageId, customerId: cxCustomer().id, start, workerCount: f.pkg.bookingType === 'single' ? (parseInt(d.workers, 10) || 1) : null });
      if (r.ok) nav('checkout');
    },
    'cx-accept': (el) => { cxRun('checkoutAccept', { checked: el.checked }); },
    'cx-fullpolicy': () => {
      const o = cxOffice(), q = JK.store.quote(o, S.state.platform, o.checkout, now());
      openModal({ title: 'السياسة كاملة — ' + q.resolved.policy.name + ' v' + q.resolved.version.version, drawer: true, body: UI.policyTextView(JK.policyText(q.resolved.version.rules, q.pkg.bookingType, S.state.platform, { firstVisitStart: q.plan[0] ? q.plan[0].start : null })) });
    },
    'cx-pay': () => {
      const r = cxRun('checkoutConfirm', null, (b) => 'تم الدفع (محاكاة) — الحجز ' + b.ref);
      if (r.ok) { cx().book = null; cx().stack = [{ s: 'home' }]; nav('done', { id: r.res.id }); }
      else if (r.error && r.error.code === 'terms_changed') UI.render();
    },
    'cx-snapshot': (el) => {
      const b = byId(cxOffice().bookings, el.dataset.id);
      openModal({ title: 'الشروط التي وافقت عليها — ' + b.policySnapshot.policyName + ' v' + b.policySnapshot.version, drawer: true,
        body: `<p class="muted small">لقطة محفوظة وقت الموافقة (${h(JK.fmtDT(b.acceptance.at))}) · ${h(b.policySnapshot.termsVersion)} · ${h(b.policySnapshot.feeRuleVersion)}</p>` + UI.policyTextView(b.policySnapshot.textSnapshot) });
    },
    'cx-cn': (el) => { cx().cn[el.dataset.k] = el.dataset.v; cx().cn.visitIds = []; UI.render(); },
    'cx-cnset': (el) => { cx().cn[el.dataset.k] = el.value; if (el.dataset.k !== 'exc') UI.render(); },
    'cx-cv': () => { cx().cn.visitIds = Array.from(document.querySelectorAll('input[name=cx-cv]:checked')).map((x) => x.value); UI.render(); },
    'cx-dst': (el) => { cx().cn.destination = el.value; UI.render(); },
    'cx-cancel-go': (el) => {
      const cn = cx().cn, exc = el.dataset.exc === '1';
      const txt = document.getElementById('cx-exc'); if (txt) cn.exc = txt.value;
      if (exc && (!cn.exc || cn.exc.trim().length < 5)) { toast('اشرح ظرفك في 5 أحرف على الأقل.', 'danger'); return; }
      const go = () => {
        const needV = ['cancel_visits', 'credit_cancel'].includes(cn.op);
        const reasonLabel = (REASONS.find((x) => x[0] === cn.reason) || [, ''])[1];
        const r = cxRun('submitCustomerRequest', { bookingId: cn.bookingId, type: cn.op, visitIds: needV ? cn.visitIds : [], destination: cn.destination, reasonCode: cn.reason, reason: exc ? cn.exc.trim() : reasonLabel, asException: exc },
          (res) => 'أُرسل الطلب ' + res.ref + ' — ' + REQ_STATUS[res.status]);
        if (r.ok) { cx().cn = null; replace('request', { id: r.res.id }); }
      };
      if (exc) go();
      else confirmDialog({ title: 'تأكيد الإلغاء', body: '<p>هل تريد تأكيد الإلغاء؟ سيُطبق ما عُرض عليك من رسوم ومبلغ معاد.</p>', ok: 'تأكيد الإلغاء', cancel: 'تراجع', danger: true }).then((y) => { if (y) go(); });
    },
    'cx-rv': (el) => { cx().rs.visitId = el.value; UI.render(); },
    'cx-rsset': (el) => { cx().rs[el.dataset.k] = el.value; },
    'cx-rs-go': (el) => {
      const rs = cx().rs, exc = el.dataset.exc === '1';
      const t = document.getElementById('cx-rexc'); if (t) rs.exc = t.value;
      if (exc && (!rs.exc || rs.exc.trim().length < 5)) { toast('اشرح سبب طلبك في 5 أحرف على الأقل.', 'danger'); return; }
      const r = cxRun('submitCustomerRequest', { bookingId: rs.bookingId, type: 'reschedule', visitIds: [rs.visitId], newStart: startOf(rs), reason: exc ? rs.exc.trim() : 'طلب تغيير موعد من التطبيق', asException: exc },
        (res) => 'أُرسل طلب تغيير الموعد ' + res.ref + ' — ' + REQ_STATUS[res.status]);
      if (r.ok) { cx().rs = null; replace('request', { id: r.res.id }); }
    },
    'cx-iqset': (el) => { cx().iq[el.dataset.k] = el.value; if (el.dataset.k === 'visitId') UI.render(); },
    'cx-issue-go': () => {
      const iq = cx().iq;
      ['cx-itext', 'cx-iamt'].forEach((id) => { const e = document.getElementById(id); if (e) iq[id === 'cx-itext' ? 'text' : 'amount'] = e.value; });
      if (!iq.visitId) { toast('اختر الزيارة.', 'danger'); return; }
      if (!iq.text || iq.text.trim().length < 5) { toast('صف المشكلة في 5 أحرف على الأقل.', 'danger'); return; }
      const amt = iq.amount ? JK.parseSAR(iq.amount) : 0;
      if (iq.amount && (amt === null || isNaN(amt))) { toast('أدخل مبلغاً صحيحاً.', 'danger'); return; }
      const r = cxRun('submitCustomerRequest', { bookingId: iq.bookingId, type: 'quality_issue', visitIds: [iq.visitId], qualityAmount: amt || 0, reason: iq.text.trim() }, (res) => 'أُرسل البلاغ ' + res.ref);
      if (r.ok) { cx().iq = null; replace('request', { id: r.res.id }); }
    },
    'cx-prop': (el) => {
      const accept = el.dataset.a === '1';
      const r = cxRun('respondProposal', { requestId: el.dataset.id, accept });
      if (r.ok) toast(r.res && r.res.warning ? r.res.warning : accept ? 'قبلت الموعد البديل.' : 'رفضت المقترح.', r.res && r.res.warning ? 'info' : 'success');
    },
    'cx-info': (el) => {
      const t = document.getElementById('cx-info');
      cxRun('customerProvideInfo', { requestId: el.dataset.id, text: t ? t.value : '' }, 'أُرسل ردك للمكتب.');
    }
  });
})(window);

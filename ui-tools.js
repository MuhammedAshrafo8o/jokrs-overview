/* =====================================================================
   ui-tools.js — Policy simulator, embedded customer previews (checkout
   + cancellation), scenario loader, platform review (demo), tests.
   ===================================================================== */
(function (G) {
  'use strict';
  const JK = G.JK, S = JK.Store, L = JK.L, UI = JK.UI;
  const { h, ic, money, dt, dts, badge, btn, empty, pageHead, permNote, toast, run, openModal, closeModal, renderModal, go, render } = UI;
  const office = () => S.office(), now = () => S.state.demo.now, byId = (a, id) => JK.store.byId(a, id);

  /* =================================================================== */
  /* Simulator                                                           */
  /* =================================================================== */
  const OPS = {
    single: ['cancel_visits', 'reschedule', 'office_cancel', 'no_show', 'partial_delivery', 'quality_issue'],
    scheduled: ['cancel_visits', 'cancel_all_remaining', 'reschedule', 'office_cancel', 'no_show', 'partial_delivery', 'quality_issue'],
    credits: ['credit_cancel', 'package_refund', 'reschedule', 'office_cancel', 'no_show']
  };
  const MULTI = ['cancel_visits', 'office_cancel'];
  function defaultSim(o) {
    const b = o.bookings[0];
    return { bookingId: b.id, type: OPS[b.type][0], visitIds: [], workerIds: [], deliveredWorkerIds: [], at: JK.toRiyadhInput(now()), initiator: 'customer', remedy: 'refund', newStart: '', disputed: false, evidence: true, reasonCode: 'no_show', destination: 'original', qualityAmount: '' };
  }
  function simReq(sim) {
    const office_ = sim.type === 'office_cancel' || (sim.type === 'partial_delivery' && sim.initiator === 'office') || (sim.type === 'reschedule' && sim.initiator === 'office');
    return {
      type: sim.type, at: JK.riyadhISO(sim.at), visitIds: sim.type === 'cancel_all_remaining' || sim.type === 'package_refund' ? [] : sim.visitIds,
      workerIds: sim.type === 'cancel_visits' && sim.workerIds.length ? sim.workerIds : null, deliveredWorkerIds: sim.deliveredWorkerIds,
      initiator: office_ ? 'office' : (sim.type === 'no_show' ? 'office' : 'customer'),
      cause: sim.type === 'office_cancel' || sim.type === 'partial_delivery' ? 'office' : sim.type === 'reschedule' && sim.initiator === 'office' ? 'office' : sim.type === 'no_show' ? (sim.disputed ? 'disputed' : sim.reasonCode === 'unsafe' ? 'external' : 'customer') : 'customer',
      remedy: sim.remedy, newStart: sim.newStart ? JK.riyadhISO(sim.newStart) : null, disputed: sim.disputed, reasonCode: sim.reasonCode,
      evidence: sim.type === 'no_show' && sim.evidence ? [{ by: 'office', type: 'gps', label: 'سجل وصول العاملة (محاكاة)' }] : [],
      destination: sim.destination, qualityAmount: JK.parseSAR(sim.qualityAmount || '0') || 0
    };
  }
  UI.pages.simulator = function () {
    const o = office();
    if (!UI.sim || !byId(o.bookings, UI.sim.bookingId)) UI.sim = defaultSim(o);
    const sim = UI.sim, b = byId(o.bookings, sim.bookingId);
    if (!OPS[b.type].includes(sim.type)) sim.type = OPS[b.type][0];
    const at = JK.riyadhISO(sim.at);
    const vOk = (v) => {
      if (sim.type === 'quality_issue') return ['completed', 'partially_delivered'].includes(v.status);
      if (sim.type === 'cancel_all_remaining' || sim.type === 'package_refund') return false;
      return v.status === 'scheduled';
    };
    const visits = b.visits.filter(vOk);
    sim.visitIds = sim.visitIds.filter((id) => visits.some((v) => v.id === id));
    if (!sim.visitIds.length && visits.length && !['cancel_all_remaining', 'package_refund'].includes(sim.type)) {
      const fut = visits.find((v) => ['no_show', 'partial_delivery'].includes(sim.type) ? Date.parse(v.start) <= Date.parse(at) : Date.parse(v.start) > Date.parse(at));
      sim.visitIds = [(fut || visits[0]).id];
    }
    const multi = MULTI.includes(sim.type);
    const selV = sim.visitIds.length === 1 ? byId(b.visits, sim.visitIds[0]) : null;
    const assigned = selV ? selV.workers.filter((w) => w.status === 'assigned') : [];
    let c = null; try { c = JK.calculate({ booking: b, platform: S.state.platform, req: simReq(sim) }); } catch (e) { c = null; console.error(e); }
    const sc = UI.scenario && UI.scenario.preset && UI.scenario.preset.bookingId === b.id && UI.scenario.office === o.office.id ? UI.scenario : null;
    const groups = Object.keys(L.bookingType).map((t) => `<optgroup label="${h(L.bookingType[t])}">${o.bookings.filter((x) => x.type === t).map((x) => `<option value="${h(x.id)}"${x.id === b.id ? ' selected' : ''}>${h(x.ref)} — ${h(x.customerName)} — ${h(x.packageName)}</option>`).join('')}</optgroup>`).join('');
    const future = Date.parse(at) > Date.parse(now()) + 60000;
    return `${pageHead('محاكي السياسات', 'اختر حجزاً وزيارات وسبباً ووقت الطلب لرؤية القاعدة المطابقة والنتيجة المالية الدقيقة — بنفس دالة الحساب المستخدمة في القرارات والاسترداد.')}
      <div class="sim">
        <section class="card sim-form"><h2 class="h3">المدخلات</h2>
          <label class="field"><span>الحجز</span><select id="sm-b" data-on-change="sim-set" data-k="bookingId">${groups}</select></label>
          <p class="muted small">${h(L.bookingType[b.type])} · السياسة المقبولة: ${h(b.policySnapshot.policyName)} v${b.policySnapshot.version} · مؤكد ${h(JK.fmtDTs(b.confirmedAt))}</p>
          <label class="field"><span>العملية</span><select id="sm-t" data-on-change="sim-set" data-k="type">${OPS[b.type].map((t) => `<option value="${t}"${t === sim.type ? ' selected' : ''}>${h(L.requestType[t])}</option>`).join('')}</select></label>
          ${visits.length && !['cancel_all_remaining', 'package_refund'].includes(sim.type) ? `<fieldset class="field"><legend>${multi ? 'الزيارات المتأثرة' : 'الزيارة'}</legend>${visits.map((v) => `<label class="${multi ? 'check' : 'radio'}"><input type="${multi ? 'checkbox' : 'radio'}" name="sm-v" value="${h(v.id)}" data-on-change="sim-visit"${sim.visitIds.includes(v.id) ? ' checked' : ''}> ${h('زيارة ' + v.label)} — ${h(JK.fmtDTs(v.start))} ${v.origin !== 'paid' ? badge(L.origin[v.origin], 'accent') : ''} <span class="muted small">${h(JK.sar(JK.visitOpen(v)))}</span></label>`).join('')}</fieldset>`
            : ['cancel_all_remaining', 'package_refund'].includes(sim.type) ? '<p class="muted small">تشمل العملية كل الزيارات/الأرصدة المتبقية المؤهلة.</p>' : '<p class="muted">لا توجد زيارات مناسبة لهذه العملية.</p>'}
          ${sim.type === 'cancel_visits' && selV && assigned.length > 1 ? `<fieldset class="field"><legend>إلغاء جزء من العمالة فقط (اختياري)</legend>${assigned.map((w) => `<label class="check"><input type="checkbox" data-on-change="sim-worker" data-k="workerIds" value="${h(w.id)}"${sim.workerIds.includes(w.id) ? ' checked' : ''}> ${h(w.name)}</label>`).join('')}</fieldset>` : ''}
          ${sim.type === 'partial_delivery' && selV ? `<fieldset class="field"><legend>العمالة التي حضرت</legend>${assigned.map((w) => `<label class="check"><input type="checkbox" data-on-change="sim-worker" data-k="deliveredWorkerIds" value="${h(w.id)}"${sim.deliveredWorkerIds.includes(w.id) ? ' checked' : ''}> ${h(w.name)}</label>`).join('')}</fieldset>` : ''}
          ${['reschedule', 'partial_delivery'].includes(sim.type) ? `<label class="field"><span>المبادر/السبب</span><select id="sm-i" data-on-change="sim-set" data-k="initiator"><option value="customer"${sim.initiator === 'customer' ? ' selected' : ''}>العميل</option><option value="office"${sim.initiator === 'office' ? ' selected' : ''}>المكتب (سبب من المكتب)</option></select></label>` : ''}
          ${sim.type === 'office_cancel' && b.type !== 'credits' ? `<label class="field"><span>المعالجة</span><select id="sm-r" data-on-change="sim-set" data-k="remedy"><option value="refund"${sim.remedy === 'refund' ? ' selected' : ''}>استرداد كامل</option><option value="replacement"${sim.remedy === 'replacement' ? ' selected' : ''}>موعد بديل يقبله العميل</option></select></label>` : ''}
          ${sim.type === 'reschedule' || (sim.type === 'office_cancel' && sim.remedy === 'replacement') ? `<label class="field"><span>الموعد الجديد</span><input type="datetime-local" id="sm-ns" value="${h(sim.newStart)}" data-on-change="sim-set" data-k="newStart"></label>` : ''}
          ${sim.type === 'no_show' ? `<label class="field"><span>الحالة</span><select id="sm-rc" data-on-change="sim-set" data-k="reasonCode"><option value="no_show"${sim.reasonCode === 'no_show' ? ' selected' : ''}>لم يتم الاستقبال</option><option value="wrong_address"${sim.reasonCode === 'wrong_address' ? ' selected' : ''}>عنوان غير صحيح</option><option value="unsafe"${sim.reasonCode === 'unsafe' ? ' selected' : ''}>ظروف غير آمنة</option></select></label>
            <label class="check"><input type="checkbox" id="sm-ev" data-on-change="sim-bool" data-k="evidence"${sim.evidence ? ' checked' : ''}> يوجد إثبات من المكتب</label><label class="check"><input type="checkbox" id="sm-d" data-on-change="sim-bool" data-k="disputed"${sim.disputed ? ' checked' : ''}> العميل يعترض</label>` : ''}
          ${sim.type === 'quality_issue' ? `<label class="field"><span>تعويض مقترح (ر.س)</span><input id="sm-q" inputmode="decimal" value="${h(sim.qualityAmount)}" data-on-change="sim-set" data-k="qualityAmount"></label>` : ''}
          ${['cancel_visits', 'cancel_all_remaining', 'package_refund'].includes(sim.type) ? `<label class="field"><span>وجهة الاسترداد</span><select id="sm-dst" data-on-change="sim-set" data-k="destination"><option value="original">وسيلة الدفع الأصلية</option><option value="wallet"${sim.destination === 'wallet' ? ' selected' : ''}>المحفظة (اختيار العميل)</option></select></label>` : ''}
          <label class="field"><span>وقت الطلب (بتوقيت الرياض)</span><input type="datetime-local" id="sm-at" value="${h(sim.at)}" data-on-change="sim-set" data-k="at"></label>
          <div class="quick-times"><button type="button" class="btn btn-ghost btn-sm" data-act="sim-now">الآن (${h(JK.fmtTime(now()))})</button>${selV ? [24, 12, 3].map((hh) => `<button type="button" class="btn btn-ghost btn-sm" data-act="sim-before" data-h="${hh}">قبل الزيارة بـ ${hh} س</button>`).join('') : ''}</div>
          <div class="sim-submit">${btn({ label: 'إرسال كطلب فعلي في المحاكاة', icon: 'play', kind: 'primary', perm: (simReq(sim).initiator === 'office' ? 'request.office' : 'customer.simulate'), act: 'sim-submit', why: future ? 'وقت الطلب في المستقبل؛ اضبط الوقت المحاكى من أدوات العرض أو اختر وقتاً حالياً.' : (c && !c.ok && !c.canRequestReview ? c.blocked : '') })}
            ${c && !c.ok && c.canRequestReview && !future ? btn({ label: 'إرسال كطلب مراجعة استثنائية', icon: 'shield', perm: 'customer.simulate', act: 'sim-submit', data: { exc: '1' } }) : ''}</div>
        </section>
        <section class="card sim-out" aria-live="polite"><h2 class="h3">النتيجة</h2>
          ${sc ? scenarioBox(sc, c) : ''}
          ${c ? UI.calcView(c, b) : '<p class="muted">تعذّر الحساب.</p>'}
          <details class="mt"><summary>مواعيد الحجز والسعر المحفوظ</summary>${UI.visitTimeline(b, sim.visitIds)}${UI.priceView(b)}</details>
        </section>
      </div>`;
  };
  function scenarioBox(sc, c) {
    const checks = (sc.checks || []).map((k) => { let ok = false; try { ok = !!(c && c.ok && k.fn(c)); } catch (e) { ok = false; } return `<li class="${ok ? 'pass' : 'fail'}">${ic(ok ? 'check' : 'x')}${h(k.label)}</li>`; }).join('');
    return `<div class="scenario"><p class="sc-title">${ic('flask')} سيناريو ${h(sc.title)}</p><p>${h(sc.expect)}</p>${checks ? `<ul class="checks">${checks}</ul>` : ''}</div>`;
  }
  Object.assign(UI.act, {
    'sim-set': (el) => { const s = UI.sim; s[el.dataset.k] = el.value; if (el.dataset.k === 'bookingId' || el.dataset.k === 'type') { s.visitIds = []; s.workerIds = []; s.deliveredWorkerIds = []; } render(); },
    'sim-bool': (el) => { UI.sim[el.dataset.k] = el.checked; render(); },
    'sim-visit': () => { UI.sim.visitIds = Array.from(document.querySelectorAll('input[name=sm-v]:checked')).map((x) => x.value); UI.sim.workerIds = []; UI.sim.deliveredWorkerIds = []; render(); },
    'sim-worker': (el) => { const arr = UI.sim[el.dataset.k]; const i = arr.indexOf(el.value); if (el.checked && i < 0) arr.push(el.value); if (!el.checked && i >= 0) arr.splice(i, 1); render(); },
    'sim-now': () => { UI.sim.at = JK.toRiyadhInput(now()); render(); },
    'sim-before': (el) => { const b = byId(office().bookings, UI.sim.bookingId), v = byId(b.visits, UI.sim.visitIds[0]); UI.sim.at = JK.toRiyadhInput(new Date(Date.parse(v.start) - parseInt(el.dataset.h, 10) * JK.HOUR).toISOString()); render(); },
    'sim-submit': (el) => {
      const sim = UI.sim, req = simReq(sim);
      const p = Object.assign({}, req, { bookingId: sim.bookingId, reason: 'طلب من محاكي السياسات', asException: el.dataset.exc === '1' });
      const r = run(req.initiator === 'office' ? 'submitOfficeAction' : 'submitCustomerRequest', p);
      if (r.ok) { toast('سُجّل الطلب ' + r.res.ref + ' — ' + L.requestStatus[r.res.status], 'success'); UI.sim = null; go('/requests/' + r.res.id); }
    }
  });

  /* =================================================================== */
  /* Phone previews                                                      */
  /* =================================================================== */
  function keyTerms(rules, type, firstStart) {
    const items = [], c = rules.cancel;
    if (type !== 'credits' && firstStart) {
      const dl = JK.freeDeadline(rules, firstStart);
      if (dl) items.push(['إلغاء مجاني حتى', JK.fmtDT(dl)]);
      else items.push(['إلغاء مجاني', 'غير متاح خارج فترة السماح']);
      JK.sortedBands(c.bands).filter((b) => b.fee.type !== 'none').forEach((b) => items.push([JK.bandLabel(b), JK.describeFee(b.fee, true)]));
    }
    if (c.grace && c.grace.enabled) items.push(['فترة السماح', c.grace.minutes + ' دقيقة بعد التأكيد (إذا كانت الزيارة بعد ' + c.grace.minLeadHours + ' ساعة أو أكثر)']);
    if (type === 'scheduled') items.push(['إلغاء الباقة بعد البدء', JK.describeFee(c.packageAfterStart, true)]);
    if (type === 'credits' && rules.credits) { items.push(['إلغاء موعد', 'قبل ' + rules.credits.restoreMinNoticeHours + ' ساعة: يُعاد الرصيد']); items.push(['استرداد الرصيد غير المستخدم', JK.describeFee(rules.credits.refundAfterUse, true)]); }
    const rs = rules.reschedule;
    items.push(['تعديل الموعد', rs.enabled ? 'قبل ' + rs.minNoticeHours + ' ساعة، حتى ' + JK.sizeLimit(rs, type === 'single' ? 1 : 8) + ' تعديل' : 'عبر طلب مراجعة']);
    const rf = rules.refund;
    items.push(['الاسترداد', 'إلى وسيلة الدفع الأصلية' + (rf.allowWallet ? ' أو المحفظة' : '') + ' خلال ' + rf.processingDays + ' ' + (rf.dayType === 'business' ? 'أيام عمل' : 'أيام') + ' من الاعتماد']);
    return items;
  }
  UI.keyTerms = keyTerms;
  UI.phoneCheckout = function (o) {
    const pf = S.state.platform, p = o.price;
    const terms = keyTerms(o.rules, o.type, o.firstStart);
    const dates = (o.visitDates || (o.firstStart ? [o.firstStart] : []));
    const acceptId = o.preview ? 'pv-accept' : 'co-accept';
    return `<div class="phone"><div class="phone-screen">
      <div class="ph-top"><span>${h(o.officeName)}</span><span class="ph-step">الدفع</span></div>
      <div class="ph-sec"><strong>${h(o.pkgName)}</strong><div class="ph-muted">${h(L.bookingType[o.type])}${o.visits ? ' · ' + o.visits + ' زيارة' : ''}</div>
        ${dates.length ? `<ul class="ph-dates">${dates.slice(0, 3).map((d) => `<li>${ic('calendar')}${h(JK.fmtDT(d))}</li>`).join('')}${dates.length > 3 ? `<li class="ph-muted">و${dates.length - 3} مواعيد أخرى أسبوعياً</li>` : ''}</ul>` : ''}</div>
      <div class="ph-sec"><table class="ph-price"><tbody>${p.lines.map((l) => `<tr><td>${h(l.label)}</td><td>${h(JK.sar(l.amount))}</td></tr>`).join('')}
        ${p.discount ? `<tr><td>خصم</td><td>${h(JK.sar(-p.discount))}</td></tr>` : ''}<tr><td>الضريبة (عرض)</td><td>${h(JK.sar(p.vat))}</td></tr><tr><td>رسوم منصة JOKRS</td><td>${h(JK.sar(p.jokrsFee))}</td></tr><tr class="ph-total"><td>الإجمالي</td><td>${h(JK.sar(p.total))}</td></tr></tbody></table></div>
      <div class="ph-sec"><strong class="ph-h">سياسة الإلغاء والاسترداد</strong><dl class="ph-terms">${terms.map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${h(v)}</dd></div>`).join('')}</dl>
        <button type="button" class="ph-link" data-act="co-full" data-preview="${o.preview ? 1 : 0}">عرض السياسة كاملة</button></div>
      <div class="ph-sec ph-jokrs">${ic('shield')}<span>رسوم JOKRS منفصلة عن رسوم المكتب: تُسترد عند خلل المكتب${pf.jokrsFee.customerCancelWithinGrace === 'refund' ? ' أو الإلغاء ضمن فترة السماح' : ''}، ولا تُسترد عند الإلغاء العادي.</span></div>
      ${o.staleNotice ? `<div class="ph-alert" role="alert">${ic('alert')}<span>${h(o.staleNotice)}</span></div>` : ''}
      <label class="ph-accept" for="${acceptId}"><input type="checkbox" id="${acceptId}"${o.preview ? ' disabled' : ` data-on-change="co-accept"`}${o.accepted ? ' checked' : ''}> أوافق على سياسة الإلغاء والاسترداد وشروط المنصة</label>
      <p class="ph-ver">${h(o.versionLabel || '')}</p>
      ${o.preview ? `<button type="button" class="ph-pay" aria-disabled="true" data-why="معاينة داخل المحرر فقط — لا يمكن الدفع.">ادفع ${h(JK.sar(p.total))}</button>`
        : o.accepted ? `<button type="button" class="ph-pay" data-act="co-pay">ادفع ${h(JK.sar(p.total))} (محاكاة)</button>` : `<button type="button" class="ph-pay" aria-disabled="true" data-why="يجب الموافقة على السياسة الحالية أولاً.">ادفع ${h(JK.sar(p.total))}</button>`}
    </div></div>`;
  };

  /* =================================================================== */
  /* Checkout + cancellation preview                                     */
  /* =================================================================== */
  function quotePrice(q) {
    const net = JK.sum(q.lines.map((l) => l.amount)), vat = Math.round((net * q.vatBps) / 10000);
    return { lines: q.lines, discount: 0, serviceNet: net, vat, jokrsFee: q.jokrsFee, total: net + vat + q.jokrsFee };
  }
  UI.pages.checkout = function () {
    const o = office(), at = now();
    const pkgs = o.services.flatMap((s) => s.packages.map((pk) => ({ s, pk })));
    if (!UI.co || !pkgs.some((x) => x.pk.id === UI.co.packageId)) {
      const first = pkgs.find((x) => x.pk.salesEnabled) || pkgs[0];
      const d = new Date(Date.parse(at) + 3 * JK.DAY); const ds = JK.toRiyadhInput(d.toISOString()).slice(0, 10) + 'T10:00';
      UI.co = { packageId: first.pk.id, customerId: o.customers[0].id, start: ds, workers: first.pk.costing.defaultWorkers || 1 };
    }
    const co = UI.co, sess = o.checkout;
    const q = JK.store.quote(o, S.state.platform, { packageId: co.packageId, workerCount: parseInt(co.workers, 10) || 1, start: JK.riyadhISO(co.start) }, at);
    const sameCfg = sess && sess.packageId === co.packageId && sess.customerId === co.customerId && sess.start === JK.riyadhISO(co.start) && String(sess.workerCount || '') === String(q.pkg.bookingType === 'single' ? (parseInt(co.workers, 10) || 1) : '');
    const accepted = !!(sameCfg && sess.accepted && sess.acceptedKey === q.key);
    const stale = sameCfg && sess.accepted && sess.acceptedKey && sess.acceptedKey !== q.key;
    const pr = quotePrice(q);
    const recent = o.bookings.filter((b) => b.packageId === co.packageId).slice(-1)[0];
    const cust = byId(o.customers, co.customerId);
    let phone;
    if (!q.pkg.salesEnabled || !q.resolved.policy) phone = `<div class="phone"><div class="phone-screen"><div class="ph-top"><span>${h(o.office.name)}</span></div><div class="ph-alert" role="alert">${ic('alert')}<span>هذه الباقة غير متاحة للحجز: ${!q.resolved.policy ? 'لا توجد سياسة إلغاء صالحة مرتبطة' : 'البيع متوقف'}. لا يمكن عرضها للعملاء دون سياسة.</span></div></div></div>`;
    else phone = UI.phoneCheckout({ officeName: o.office.name, pkgName: q.pkg.name, rules: q.resolved.version.rules, type: q.pkg.bookingType, firstStart: q.plan[0] ? q.plan[0].start : null, visitDates: q.plan.map((x) => x.start), visits: q.plan.length,
      price: pr, accepted, staleNotice: stale ? 'تم تحديث السياسة منذ موافقتك (النسخة الحالية v' + q.resolved.version.version + '). راجع الشروط ووافق من جديد.' : '', versionLabel: q.resolved.policy.name + ' — النسخة ' + q.resolved.version.version + ' · ' + S.state.platform.termsVersion + ' · ' + S.state.platform.feeRuleVersion });
    const result = sess && sess.result ? `<div class="note note-success">${ic('check')}<div>أُنشئ الحجز <b>${h(sess.result.ref)}</b> وسُجّلت موافقة العميل مع لقطة السياسة. <a href="#/simulator" data-act="co-sim" data-b="${h(sess.result.bookingId)}">افتحه في المحاكي</a></div></div>` : '';
    return `${pageHead('معاينة العميل', 'معاينة مضمّنة داخل بوابة المكتب لما يراه العميل قبل الدفع وعند الإلغاء. ليست تطبيق العميل الكامل؛ الدفع والرسائل محاكاة فقط.')}
      ${permNote(['customer.simulate'])}
      <div class="co-grid">
        <section class="card"><h2 class="h3">إعداد الحجز</h2>
          <label class="field"><span>الخدمة / الباقة</span><select id="co-pkg" data-on-change="co-set" data-k="packageId">${o.services.map((s) => `<optgroup label="${h(s.name)}">${s.packages.map((pk) => `<option value="${h(pk.id)}"${pk.id === co.packageId ? ' selected' : ''}>${h(pk.name)}${pk.salesEnabled ? '' : ' (البيع متوقف)'}</option>`).join('')}</optgroup>`).join('')}</select></label>
          <label class="field"><span>العميل (وهمي)</span><select id="co-c" data-on-change="co-set" data-k="customerId">${o.customers.map((c) => `<option value="${h(c.id)}"${c.id === co.customerId ? ' selected' : ''}>${h(c.name)}</option>`).join('')}</select></label>
          ${q.pkg.bookingType !== 'credits' ? `<label class="field"><span>موعد الزيارة الأولى</span><input type="datetime-local" id="co-s" value="${h(co.start)}" data-on-change="co-set" data-k="start"></label>` : '<p class="muted small">باقة رصيد: تُحجز المواعيد لاحقاً من الرصيد.</p>'}
          ${q.pkg.bookingType === 'single' ? `<label class="field"><span>عدد العمالة</span><select id="co-w" data-on-change="co-set" data-k="workers">${[1, 2, 3].map((n) => `<option value="${n}"${String(n) === String(co.workers) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
          <div class="readonly-box"><h3 class="h3">${ic('coins')} مخرجات وحدة التكلفة (للقراءة فقط)</h3>
            <p class="small">نسخة الأسعار الحالية: <b>${h(o.costing.version)}</b></p>
            <ul class="mini-list">${q.lines.map((l) => `<li>${h(l.label)}: ${money(l.amount)}</li>`).join('')}</ul>
            ${recent ? `<p class="small">آخر حجز مؤكد لهذه الباقة (${h(recent.ref)}) يحتفظ بسعره المقبول: ${money(recent.price.serviceNet)} — ${h(recent.price.costingVersion)}.</p>` : ''}
            <div class="sim-box"><p class="sim-title">${ic('flask')} محاكاة نظام خارجي</p><button type="button" class="btn btn-secondary btn-sm" data-act="co-costing">محاكاة تغيّر أسعار التكلفة +10%</button><p class="muted small">تتغير أسعار الحجوزات الجديدة فقط؛ تخصيصات الحجوزات المؤكدة لا تتغير.</p></div></div>
          <div class="readonly-box"><h3 class="h3">السياسة المطبقة الآن</h3>${q.resolved.policy ? `<p>${h(q.resolved.policy.name)} — v${q.resolved.version.version} ${badge(q.resolved.sourceLabel, 'info')}</p>${(() => { const nx = JK.scheduledVersions(q.resolved.policy, at); return nx.length ? `<p class="small text-warning">${ic('info')} النسخة ${nx[0].version} تسري ${h(JK.fmtDT(nx[0].effectiveFrom))}. إذا وافق العميل ثم تغيّر الوقت المحاكى بعدها، تُبطل الموافقة ويُطلب قبول الشروط المحدثة.</p>` : ''; })()}` : '<p class="text-danger">لا توجد سياسة صالحة.</p>'}</div>
          ${sameCfg ? '' : `<div class="note note-info">${ic('info')}<div>ابدأ جلسة دفع لهذا الإعداد لتفعيل الموافقة. أي تغيير في الإعداد يتطلب موافقة جديدة.</div></div>${btn({ label: 'بدء جلسة الدفع', icon: 'play', kind: 'primary', perm: 'customer.simulate', act: 'co-start' })}`}
          ${result}
          ${sess && sess.accepted && sameCfg ? `<p class="muted small">سُجّلت الموافقة على: <code dir="ltr">${h(sess.acceptedKey)}</code> في ${h(JK.fmtDTs(sess.acceptedAt))}</p>` : ''}
        </section>
        <div class="phones">
          <div><p class="phone-cap">1. صفحة الدفع والموافقة — ${h(cust ? cust.name : '')}</p>${sameCfg ? phone : `<div class="phone"><div class="phone-screen ph-empty"><p>${ic('phone')}</p><p>اضغط "بدء جلسة الدفع"</p></div></div>`}</div>
          <div><p class="phone-cap">2. معاينة الإلغاء للعميل</p>${cancelPhone(o)}</div>
        </div>
      </div>`;
  };
  function cancelPhone(o) {
    const bks = o.bookings.filter((b) => b.visits.some((v) => v.status === 'scheduled' && Date.parse(v.start) > Date.parse(now())) || (b.credits && b.credits.items.some((c) => c.state === 'available')));
    if (!bks.length) return `<div class="phone"><div class="phone-screen ph-empty"><p>لا توجد حجوزات قابلة للإلغاء.</p></div></div>`;
    if (!UI.cp || !bks.some((b) => b.id === UI.cp.bookingId)) UI.cp = { bookingId: bks[0].id, op: '', visitIds: [], destination: 'original' };
    const cp = UI.cp, b = byId(o.bookings, cp.bookingId);
    const ops = b.type === 'single' ? [['cancel_visits', 'إلغاء الزيارة']] : b.type === 'scheduled' ? [['cancel_visits', 'إلغاء زيارات محددة'], ['cancel_all_remaining', 'إلغاء كل المتبقي']] : [['credit_cancel', 'إلغاء موعد'], ['package_refund', 'استرداد الرصيد غير المستخدم']];
    if (!ops.some(([k]) => k === cp.op)) cp.op = ops[0][0];
    const vs = b.visits.filter((v) => v.status === 'scheduled' && Date.parse(v.start) > Date.parse(now()));
    const needV = ['cancel_visits', 'credit_cancel'].includes(cp.op);
    cp.visitIds = cp.visitIds.filter((id) => vs.some((v) => v.id === id));
    if (needV && !cp.visitIds.length && vs.length) cp.visitIds = [vs[0].id];
    const multi = cp.op === 'cancel_visits' && b.type === 'scheduled';
    const authorized = b.price.payments.some((p) => p.state === 'authorized');
    const c = JK.calculate({ booking: b, platform: S.state.platform, req: { type: cp.op, at: now(), visitIds: needV ? cp.visitIds : [], destination: cp.destination, initiator: 'customer', cause: 'customer' } });
    const retained = c.ok ? c.officeFee + (c.jokrs.retained || 0) : 0;
    return `<div class="phone"><div class="phone-screen">
      <div class="ph-top"><span>${h(o.office.name)}</span><span class="ph-step">إلغاء</span></div>
      <div class="ph-sec"><label class="ph-field"><span>الحجز</span><select id="cp-b" data-on-change="cp-set" data-k="bookingId">${bks.map((x) => `<option value="${h(x.id)}"${x.id === b.id ? ' selected' : ''}>${h(x.ref)} — ${h(x.customerName)}</option>`).join('')}</select></label>
        <label class="ph-field"><span>العملية</span><select id="cp-op" data-on-change="cp-set" data-k="op">${ops.map(([k, l]) => `<option value="${k}"${k === cp.op ? ' selected' : ''}>${h(l)}</option>`).join('')}</select></label>
        ${needV ? `<fieldset class="ph-visits"><legend>المواعيد</legend>${vs.map((v) => `<label><input type="${multi ? 'checkbox' : 'radio'}" name="cp-v" value="${h(v.id)}" data-on-change="cp-visit"${cp.visitIds.includes(v.id) ? ' checked' : ''}> ${h(JK.fmtDTs(v.start))}${v.origin !== 'paid' && v.origin !== 'credit' ? ' · ' + h(L.origin[v.origin]) : ''}</label>`).join('') || '<p class="ph-muted">لا مواعيد قادمة.</p>'}</fieldset>` : ''}</div>
      ${c.ok ? `<div class="ph-sec"><dl class="ph-terms">
          <div><dt>المواعيد المتأثرة</dt><dd>${h(c.affected.map((a) => a.start ? JK.fmtDTs(a.start) : a.label).join('، ') || '—')}</dd></div>
          <div><dt>القاعدة</dt><dd>${h(c.rule ? c.rule.label : '')}</dd></div>
          <div><dt>رسوم المكتب المحتفظ بها</dt><dd>${h(JK.sar(c.officeFee))}</dd></div>
          ${c.jokrs.retained ? `<div><dt>رسوم JOKRS غير المستردة</dt><dd>${h(JK.sar(c.jokrs.retained))}</dd></div>` : ''}
          <div class="ph-total"><dt>${c.outcome === 'credit_restore' ? 'النتيجة' : 'المبلغ المعاد'}</dt><dd>${c.outcome === 'credit_restore' ? 'يُعاد الموعد إلى رصيدك (بدون مبلغ نقدي)' : c.outcome === 'no_refund' && c.creditOutcome === 'forfeited' ? 'يُحتسب الرصيد — لا مبلغ' : h(JK.sar(c.totalRefund))}</dd></div></dl>
          ${c.totalRefund > 0 ? `<fieldset class="ph-visits"><legend>الوجهة</legend>${authorized ? '<p class="ph-muted">لم يُحصّل المبلغ بعد: سيُلغى التفويض.</p>' : `<label><input type="radio" name="cp-d" value="original" data-on-change="cp-dest"${cp.destination !== 'wallet' ? ' checked' : ''}> وسيلة الدفع الأصلية</label>${b.policySnapshot.rules.refund.allowWallet ? `<label><input type="radio" name="cp-d" value="wallet" data-on-change="cp-dest"${cp.destination === 'wallet' ? ' checked' : ''}> المحفظة</label>` : ''}`}</fieldset>` : ''}
          ${c.needsReview ? `<p class="ph-muted">${h(c.reviewReasons[0] || 'سيُراجع الطلب من المكتب.')}</p>` : ''}
          <p class="ph-muted">لا تُسترد قيمة الزيارات المنفذة. إجمالي المحتفظ به: ${h(JK.sar(retained))}.</p></div>
        <button type="button" class="ph-pay" data-act="cp-confirm">تأكيد ${c.outcome === 'credit_restore' ? 'الإلغاء وإعادة الرصيد' : 'الإلغاء'}</button>`
        : `<div class="ph-alert" role="alert">${ic('alert')}<span>${h(c.blocked)}</span></div>${c.canRequestReview ? `<button type="button" class="ph-pay ph-secondary" data-act="cp-confirm" data-exc="1">طلب مراجعة استثنائية</button>` : ''}`}
    </div></div>`;
  }
  Object.assign(UI.act, {
    'co-set': (el) => { UI.co[el.dataset.k] = el.value; render(); },
    'co-start': () => { const co = UI.co, o = office(), f = JK.findPackage(o, co.packageId); run('checkoutStart', { packageId: co.packageId, customerId: co.customerId, start: JK.riyadhISO(co.start), workerCount: f.pkg.bookingType === 'single' ? (parseInt(co.workers, 10) || 1) : null }); },
    'co-accept': (el) => { run('checkoutAccept', { checked: el.checked }); },
    'co-pay': () => {
      const r = run('checkoutConfirm', null, (b) => 'تم الدفع (محاكاة) وأُنشئ الحجز ' + b.ref + ' مع لقطة السياسة v' + b.policySnapshot.version + '.');
      if (!r.ok && r.error && r.error.code === 'terms_changed') render();
    },
    'co-full': (el) => {
      let rules, type, label;
      if (el.dataset.preview === '1' && UI.editor) { rules = UI.editor.rules; type = UI.editor.meta.bookingType; label = UI.editor.meta.name + ' (مسودة)'; }
      else { const q = JK.store.quote(office(), S.state.platform, { packageId: UI.co.packageId, start: JK.riyadhISO(UI.co.start) }, now()); rules = q.resolved.version.rules; type = q.pkg.bookingType; label = q.resolved.policy.name + ' v' + q.resolved.version.version; }
      openModal({ title: 'السياسة كاملة — ' + label, drawer: true, body: UI.policyTextView(JK.policyText(rules, type, S.state.platform, { firstVisitStart: UI.co ? JK.riyadhISO(UI.co.start) : null })) });
    },
    'co-costing': () => run('costingChange', { pct: 10 }, 'تغيّرت أسعار التكلفة للحجوزات الجديدة؛ الحجوزات المؤكدة احتفظت بأسعارها.'),
    'co-sim': (el) => { UI.sim = Object.assign(defaultSim(office()), { bookingId: el.dataset.b }); },
    'cp-set': (el) => { UI.cp[el.dataset.k] = el.value; if (el.dataset.k !== 'destination') UI.cp.visitIds = []; render(); },
    'cp-visit': () => { UI.cp.visitIds = Array.from(document.querySelectorAll('input[name=cp-v]:checked')).map((x) => x.value); render(); },
    'cp-dest': (el) => { UI.cp.destination = el.value; render(); },
    'cp-confirm': (el) => {
      const cp = UI.cp;
      const r = run('submitCustomerRequest', { bookingId: cp.bookingId, type: cp.op, visitIds: ['cancel_visits', 'credit_cancel'].includes(cp.op) ? cp.visitIds : [], destination: cp.destination, reason: 'إلغاء من معاينة العميل', asException: el.dataset.exc === '1' });
      if (r.ok) { toast('سُجّل الطلب ' + r.res.ref + ' — ' + L.requestStatus[r.res.status] + (r.res.refundId ? ' · الاسترداد: ' + L.refundState[byId(office().refunds, r.res.refundId).state] : ''), 'success'); UI.cp.visitIds = []; }
    }
  });

  /* =================================================================== */
  /* Scenarios, platform review, tests (demo toolbar)                    */
  /* =================================================================== */
  UI.act['demo-scenario'] = (f) => {
    const sc = JK.SCENARIOS.find((s) => s.id === f.elements.sc.value);
    if (!sc) return;
    if (UI.editor && UI.editor.dirty) { toast('احفظ المسودة الحالية أو غادر المحرر قبل تحميل سيناريو.', 'info'); return; }
    UI.editor = null; UI.pv = null; UI.co = null; UI.cp = null;
    const role = sc.role || (S.state.demo.role === 'viewer' ? 'admin' : S.state.demo.role);
    run('setDemo', { officeId: sc.office, role });
    UI.scenario = sc; UI.filters = { requests: {}, refunds: {}, activity: {}, policies: {} };
    const o = office();
    if (sc.route === 'simulator') {
      const p = sc.preset;
      UI.sim = Object.assign(defaultSim(o), { bookingId: p.bookingId, type: p.type, visitIds: (p.visitIds || []).slice(), deliveredWorkerIds: (p.deliveredWorkerIds || []).slice(), at: p.at, remedy: p.remedy || 'refund', initiator: p.initiator || 'customer' });
      go('/simulator');
    } else if (sc.route === 'request') {
      const r = o.requests.find((x) => x.ref === sc.requestRef);
      go(r ? '/requests/' + r.id : '/requests');
    } else if (sc.route === 'policy') go('/policies/' + sc.policyId);
    else if (sc.route === 'refund') {
      const rf = o.refunds.find((x) => x.ref === sc.refundRef) || o.refunds.find((x) => x.state === 'failed');
      go('/refunds' + (rf ? '?open=' + rf.id : ''));
    } else go('/' + sc.route);
    toast('حُمّل السيناريو ' + sc.title + ' — ' + sc.expect, 'info');
  };

  function platformBody() {
    const st = S.state, pf = st.platform;
    const pend = [];
    Object.values(st.offices).forEach((o) => o.policies.forEach((p) => p.versions.forEach((v) => { if (v.status === 'pending_review') pend.push({ o, p, v }); })));
    return `<div class="note note-warning">${ic('alert')}<div>هذه أداة عرض تمثل فريق مراجعة المنصة — ليست جزءاً من بوابة المكتب، ولا يمكن لمستخدم المكتب اعتماد قواعده المقيدة. ${h(pf.legalStatus)}.</div></div>
      <h3 class="h3">نسخ بانتظار المراجعة (${pend.length})</h3>
      ${pend.length ? pend.map(({ o, p, v }) => {
        const prev = p.versions.filter((x) => x.status === 'published').slice(-1)[0];
        const diff = prev ? JK.diffVersions(p.bookingType, prev, v).filter((d) => d.changed) : [];
        const rr = JK.restrictedReasons(v.rules, p.bookingType, pf);
        return `<article class="card"><div class="card-head"><div><strong>${h(o.office.name)}</strong> · ${h(p.name)} — v${v.version}</div>${badge('بانتظار المراجعة', 'warning')}</div>
          <p class="small">تسري من ${h(JK.fmtDT(v.effectiveFrom))} · أُرسلت ${h(JK.fmtDTs(v.submittedAt))}</p>
          ${rr.length ? `<ul class="mini-list">${rr.map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
          ${diff.length ? `<details><summary>التغييرات مقارنة بالنسخة المنشورة v${prev.version}</summary><ul class="mini-list">${diff.map((d) => `<li>${h(d.label)}: ${h(d.a)} ← <b>${h(d.b)}</b></li>`).join('')}</ul></details>` : ''}
          <form data-submit="pl-decide" data-o="${h(o.office.id)}" data-p="${h(p.id)}" data-v="${v.version}" class="form"><label class="field"><span>ملاحظة المراجع</span><input name="note" placeholder="إلزامية عند طلب التعديل"></label>
          <div class="action-row"><button class="btn btn-primary btn-sm" type="submit" name="d" value="approve">اعتماد ونشر</button><button class="btn btn-danger btn-sm" type="submit" name="d" value="reject">طلب تعديلات</button></div></form></article>`;
      }).join('') : '<p class="muted">لا توجد نسخ بانتظار المراجعة. أرسل نسخة تتضمن قاعدة مقيدة (مثل احتساب الزيارة مستهلكة) لتجربة المسار.</p>'}
      <h3 class="h3">قيود المنصة التجريبية (${h(pf.version)})</h3>
      <form data-submit="pl-rules" class="form form-grid">
        <label class="field"><span>حد رسوم الزيارة %</span><input name="maxVisitFeePct" type="number" min="0" max="100" value="${pf.rules.maxVisitFeePct}"></label>
        <label class="field"><span>حد رسوم إلغاء الباقة %</span><input name="maxPackageFeePct" type="number" min="0" max="100" value="${pf.rules.maxPackageFeePct}"></label>
        <label class="field"><span>فترة سماح إلزامية (دقيقة، 0 = لا يوجد)</span><input name="minGraceMinutes" type="number" min="0" max="1440" value="${pf.rules.minGraceMinutes}"></label>
        <label class="check"><input type="checkbox" name="allowConsume"${pf.rules.allowConsumeEntitlement ? ' checked' : ''}> السماح بخيار احتساب الزيارة مستهلكة (مع المراجعة)</label>
        <label class="check"><input type="checkbox" name="direct"${pf.allowDirectPublish ? ' checked' : ''}> السماح بالنشر المباشر للقواعد الاعتيادية</label>
        <div><button class="btn btn-secondary btn-sm" type="submit">حفظ قيود المنصة</button></div></form>
      <p class="muted small">قواعد رسوم JOKRS: ${h(JK.sar(pf.jokrsFee.amount))} لكل حجز (${h(pf.feeRuleVersion)}) — للقراءة فقط في هذا العرض.</p>`;
  }
  UI.act['platform-open'] = () => openModal({ title: 'مراجعة المنصة (أداة عرض)', drawer: true, body: platformBody });
  let lastSubmitter = null;
  document.addEventListener('click', (e) => { const b = e.target.closest('button[type=submit][name=d]'); if (b) lastSubmitter = b.value; }, true);
  UI.act['pl-decide'] = (f) => {
    const d = lastSubmitter || 'approve'; lastSubmitter = null;
    run('platformDecide', { officeId: f.dataset.o, policyId: f.dataset.p, version: parseInt(f.dataset.v, 10), decision: d, note: f.elements.note.value }, d === 'approve' ? 'اعتُمدت النسخة ونُشرت (محاكاة).' : 'أُعيدت النسخة للمكتب مع ملاحظات.');
  };
  UI.act['pl-rules'] = (f) => {
    const e = f.elements, n = (x, lo, hi) => { const v = Number(x.value); return Number.isFinite(v) && v >= lo && v <= hi ? v : null; };
    const r = { maxVisitFeePct: n(e.maxVisitFeePct, 0, 100), maxPackageFeePct: n(e.maxPackageFeePct, 0, 100), minGraceMinutes: n(e.minGraceMinutes, 0, 1440), allowConsumeEntitlement: e.allowConsume.checked };
    if (Object.values(r).some((v) => v === null)) { toast('قيم غير صالحة: النسب بين 0 و100 والدقائق بين 0 و1440.', 'danger'); return; }
    if (r.minGraceMinutes > 0) r.minGraceLeadHours = 0;
    run('setPlatform', { rules: r, allowDirectPublish: e.direct.checked }, 'حُفظت قيود المنصة التجريبية وسُجّلت في سجل كل مكتب.');
  };
  UI.act['tests-open'] = () => {
    let res;
    try { res = JK.runTests(); } catch (e) { res = [{ name: 'تعذّر تشغيل الفحوصات', ok: false, detail: e.message }]; }
    const fail = res.filter((r) => !r.ok).length;
    openModal({ title: 'فحوصات الحسابات والثوابت', drawer: true,
      body: `<p>${fail ? `<span class="text-danger">${fail} فحص فشل</span>` : `<span class="text-success">${ic('check')} نجحت كل الفحوصات</span>`} — ${res.length - fail}/${res.length}. تعمل على نسخة منفصلة في الذاكرة ولا تغيّر بياناتك. يمكن تشغيلها أيضاً عبر <code dir="ltr">node tests.js</code>.</p>
        <ul class="checks">${res.map((r) => `<li class="${r.ok ? 'pass' : 'fail'}">${ic(r.ok ? 'check' : 'x')}<span>${h(r.name)}${r.detail ? `<br><span class="small muted">${h(r.detail)}</span>` : ''}</span></li>`).join('')}</ul>` });
  };
})(window);

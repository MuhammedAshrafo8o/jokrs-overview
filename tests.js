/* =====================================================================
   tests.js — dependency-free verification of the money/rule engine and
   state invariants. Runs in Node:   node tests.js
   and in the browser via the demo toolbar ("تشغيل الفحوصات").
   Browser runs use an in-memory copy and never touch saved demo data.
   ===================================================================== */
(function (G) {
  'use strict';
  var JK = (G.JK = G.JK || {});

  function runTests() {
    var S = JK.Store, st = JK.store;
    var saved = { state: S.state, storage: S.storage, listeners: S.listeners, notice: S.notice };
    var results = [];
    function t(name, fn) {
      try { var r = fn(); results.push({ name: name, ok: r !== false, detail: typeof r === 'string' ? r : '' }); }
      catch (e) { results.push({ name: name, ok: false, detail: e && e.message ? e.message : String(e) }); }
    }
    function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'expected') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }
    function throwsCode(fn, code) {
      try { fn(); } catch (e) { if (code && e.code !== code) throw new Error('threw ' + e.code + ' (' + e.message + ') instead of ' + code); return true; }
      throw new Error('expected an error' + (code ? ' (' + code + ')' : ''));
    }
    function fresh(officeId, role, nowLocal) {
      S.storage = 'memory'; S.listeners = [];
      S.state = JK.buildSeed();
      S.state.demo.officeId = officeId || 'A'; S.state.demo.role = role || 'admin';
      if (nowLocal) S.state.demo.now = JK.riyadhISO(nowLocal);
      return S.state;
    }
    function office(id) { return S.state.offices[id]; }
    function booking(o, ref) { return st.byId(office(o).bookings, ref); }
    function calc(o, ref, req) { return JK.calculate({ booking: booking(o, ref), platform: S.state.platform, req: Object.assign({ at: S.state.demo.now }, req) }); }
    function as(role, officeId) { S.state.demo.role = role; if (officeId) S.state.demo.officeId = officeId; }

    try {
      /* ---------- Money primitives ---------- */
      t('التوزيع الحتمي يجمع الإجمالي دائماً (Largest remainder)', function () {
        var cases = [[100000, [1, 1, 1]], [1, [1, 1, 1]], [99999, [3, 7, 11, 13]], [0, [5, 5]], [12345, [0, 0, 0]]];
        cases.forEach(function (c) { var a = JK.allocate(c[0], c[1]); eq(JK.sum(a), c[0], 'sum'); eq(JSON.stringify(JK.allocate(c[0], c[1])), JSON.stringify(a), 'determinism'); });
        eq(JSON.stringify(JK.allocate(100, [1, 1, 1])), '[34,33,33]', 'tie-break by index');
      });
      t('النسب المئوية بالهللات مع تقريب نصف للأعلى', function () { eq(JK.pctOf(35000, 25), 8750); eq(JK.pctOf(333, 50), 167); eq(JK.pctOf(1000, 12.5), 125); });
      t('تحويل الإدخال إلى هللات', function () { eq(JK.parseSAR('425'), 42500); eq(JK.parseSAR('0.5'), 50); eq(JK.parseSAR('١٢٫٥'), null); eq(JK.parseSAR('12.345'), null); eq(JK.parseSAR('-3'), null); });

      /* ---------- Required calculation examples ---------- */
      fresh('A');
      t('سيناريو A: 8 زيارات، 3 منفذة، رسوم ثابتة 200 ← استرداد 425 ر.س بالضبط', function () {
        var r = calc('A', 'BK-A-1001', { type: 'cancel_all_remaining' });
        eq(r.eligible, 62500, 'remaining'); eq(r.officeFee, 20000, 'fee'); eq(r.serviceRefund, 42500, 'service refund'); eq(r.totalRefund, 42500, 'total');
      });
      t('سيناريو B: 35 ر.س لكل زيارة ملغاة ← رسوم 175 واسترداد 450 ر.س بالضبط', function () {
        var r = calc('B', 'BK-B-1001', { type: 'cancel_all_remaining' });
        eq(r.officeFee, 17500, 'fee'); eq(r.serviceRefund, 45000, 'refund'); eq(r.totalRefund, 45000, 'total');
      });
      t('جميع سيناريوهات المحاكي (A–N) تطابق النتائج المتوقعة', function () {
        var bad = [];
        JK.SCENARIOS.filter(function (s) { return s.preset; }).forEach(function (s) {
          var p = s.preset, r = JK.calculate({ booking: booking(s.office, p.bookingId), platform: S.state.platform, req: Object.assign({}, p, { at: JK.riyadhISO(p.at.replace('T', ' ')) }) });
          if (!r.ok) bad.push(s.id + ': ' + r.blocked);
          (s.checks || []).forEach(function (c) { if (!c.fn(r)) bad.push(s.id + ': ' + c.label); });
        });
        if (bad.length) throw new Error(bad.join(' | '));
      });
      t('C: إلغاء زيارة واحدة لا يلغي الباقة ويحافظ على المواعيد الأخرى', function () {
        fresh('A', 'admin');
        var b = booking('A', 'BK-A-1001'), before = b.visits.map(function (v) { return v.start + v.status; });
        S.dispatch('submitCustomerRequest', { bookingId: 'BK-A-1001', type: 'cancel_visits', visitIds: ['BK-A-1001-V6'] });
        b = booking('A', 'BK-A-1001');
        var changed = b.visits.filter(function (v, i) { return v.start + v.status !== before[i]; });
        eq(changed.length, 1, 'changed visits'); eq(changed[0].id, 'BK-A-1001-V6');
        eq(b.visits.filter(function (v) { return v.status === 'scheduled'; }).length, 4, 'remaining scheduled');
      });
      t('E: حد الشريحة شامل — 12:00 ساعة بالضبط بدون رسوم، 11:59 ساعة 25%', function () {
        fresh('A');
        var r1 = calc('A', 'BK-A-1002', { type: 'cancel_visits', visitIds: ['BK-A-1002-V1'], at: JK.riyadhISO('2026-11-23 22:00') });
        var r2 = calc('A', 'BK-A-1002', { type: 'cancel_visits', visitIds: ['BK-A-1002-V1'], at: JK.riyadhISO('2026-11-23 22:01') });
        eq(r1.officeFee, 0, 'at boundary'); eq(r2.officeFee, 8750, 'one minute later');
      });
      t('D: فترة السماح شاملة حتى نهايتها ثم تنطبق الشريحة', function () {
        var a = calc('B', 'BK-B-1002', { type: 'cancel_visits', visitIds: ['BK-B-1002-V1'], at: JK.riyadhISO('2026-11-23 09:20') });
        var b = calc('B', 'BK-B-1002', { type: 'cancel_visits', visitIds: ['BK-B-1002-V1'], at: JK.riyadhISO('2026-11-23 09:21') });
        eq(a.officeFee, 0, 'grace end inclusive'); eq(a.jokrs.refund, 1500, 'jokrs refunded in grace');
        eq(b.officeFee, JK.pctOf(23000, 25), 'after grace'); eq(b.jokrs.refund, 0, 'jokrs retained after grace');
      });
      t('F: خلل المكتب لا يفرض أي رسوم على العميل', function () {
        var r = calc('A', 'BK-A-1004', { type: 'office_cancel', visitIds: ['BK-A-1004-V1'], remedy: 'refund' });
        eq(r.officeFee, 0); eq(r.totalRefund, r.finance.remaining + booking('A', 'BK-A-1004').price.vat + booking('A', 'BK-A-1004').price.jokrsFee, 'full refund');
        var rep = calc('A', 'BK-A-1004', { type: 'office_cancel', visitIds: ['BK-A-1004-V1'], remedy: 'replacement', newStart: JK.riyadhISO('2026-11-29 10:00') });
        eq(rep.totalRefund, 0, 'replacement has no cash'); eq(rep.outcome, 'replacement');
      });
      t('G: إعادة رصيد الزيارة لا تنتج استرداداً نقدياً', function () {
        var r = calc('C', 'BK-C-1001', { type: 'credit_cancel', visitIds: ['BK-C-1001-V4'] });
        eq(r.totalRefund, 0); eq(r.destinations.length, 0); eq(r.creditOutcome, 'restored');
        var late = calc('C', 'BK-C-1002', { type: 'credit_cancel', visitIds: ['BK-C-1002-V2'] });
        eq(late.creditOutcome, 'forfeited', 'late consumes (approved version)'); eq(late.totalRefund, 0);
      });
      t('J: الزيارة الترويجية بلا قيمة؛ البديلة تحتفظ بقيمة الزيارة المدفوعة', function () {
        eq(calc('A', 'BK-A-1007', { type: 'cancel_visits', visitIds: ['BK-A-1007-V5'] }).totalRefund, 0, 'promo');
        eq(calc('A', 'BK-A-1007', { type: 'cancel_visits', visitIds: ['BK-A-1007-V1-R'] }).serviceRefund, 25000, 'replacement');
      });
      t('M: الاسترداد الجزئي السابق يقلل المتبقي القابل للاسترداد', function () {
        var r = calc('A', 'BK-A-1006', { type: 'cancel_all_remaining' });
        eq(r.affectedOpen, 50000); eq(r.eligible, 35000); eq(r.serviceRefund, 15000);
      });
      t('لا يُجمع بين استرداد نقدي وإعادة استحقاق في أي طلب', function () {
        Object.keys(S.state.offices).forEach(function (k) {
          office(k).requests.forEach(function (r) {
            if (!r.calc) return;
            var restored = r.calc.effects.credits.some(function (e) { return e.newState === 'available'; }) || !!r.calc.effects.replacement;
            if (restored && r.calc.totalRefund > 0) throw new Error(r.ref + ' has both');
          });
        });
      });
      t('منع تجاوز شريحة الإلغاء المتأخر عبر إعادة الجدولة (تثبيت الشريحة)', function () {
        fresh('A', 'admin', '2026-11-24 15:00');
        var origStart = booking('A', 'BK-A-1001').visits[3].start;
        // reschedule V4 (Nov 25 10:00, 19h away → inside the fee band) to Nov 27 10:00
        S.state.offices.A.bookings[0].policySnapshot.rules.reschedule.minNoticeHours = 12;
        var r = calc('A', 'BK-A-1001', { type: 'reschedule', visitIds: ['BK-A-1001-V4'], newStart: JK.riyadhISO('2026-11-27 10:00') });
        if (!r.ok) throw new Error(r.blocked);
        if (!r.effects.schedule.lockBand) throw new Error('band not locked');
        S.dispatch('submitCustomerRequest', { bookingId: 'BK-A-1001', type: 'reschedule', visitIds: ['BK-A-1001-V4'], newStart: JK.riyadhISO('2026-11-27 10:00') });
        var c2 = calc('A', 'BK-A-1001', { type: 'cancel_visits', visitIds: ['BK-A-1001-V4'], at: JK.riyadhISO('2026-11-24 16:00') });
        eq(c2.officeFee, 5000, 'locked late fee still applies although now 66h before the new time');
        eq(booking('A', 'BK-A-1001').visits[3].originalStart, origStart, 'original schedule preserved');
      });

      /* ---------- Refund state machine & idempotency ---------- */
      t('L: استرداد فاشل ثم إعادة محاولة ناجحة دون ازدواج', function () {
        fresh('A', 'finance');
        var o = office('A'), rf = o.refunds.filter(function (x) { return x.state === 'failed'; })[0];
        var b = booking('A', rf.bookingId), paidBefore = b.price.payments[0].refunded, ledgerBefore = o.ledger.length;
        S.dispatch('refundRetry', { refundId: rf.id });
        rf = st.byId(office('A').refunds, rf.id);
        eq(rf.state, 'processing');
        var att = rf.attempts[rf.attempts.length - 1].id;
        S.dispatch('providerCallback', { refundId: rf.id, attemptId: att, result: 'success' });
        var dup = S.dispatch('providerCallback', { refundId: rf.id, attemptId: att, result: 'success' });
        eq(dup.duplicate, true, 'duplicate flagged');
        rf = st.byId(office('A').refunds, rf.id); b = booking('A', rf.bookingId);
        eq(rf.state, 'completed');
        eq(b.price.payments[0].refunded - paidBefore, rf.components.total, 'credited exactly once');
        eq(office('A').ledger.filter(function (l) { return l.refundId === rf.id && l.account === 'customer_refund'; }).length, 1, 'one customer ledger entry');
        if (office('A').ledger.length <= ledgerBefore) throw new Error('ledger not posted');
        throwsCode(function () { S.dispatch('refundRetry', { refundId: rf.id }); }, 'state');
      });
      t('الضغط المزدوج على "اعتماد" لا ينشئ استرداداً ثانياً', function () {
        fresh('B', 'operations');
        var r = office('B').requests.filter(function (x) { return x.type === 'partial_delivery'; })[0];
        var n = office('B').refunds.length;
        S.dispatch('approveRequest', { requestId: r.id });
        throwsCode(function () { S.dispatch('approveRequest', { requestId: r.id }); }, 'state');
        eq(office('B').refunds.length, n + 1);
      });
      t('الاسترداد المعتمد لا يُعتبر مكتملاً قبل تأكيد المزوّد', function () {
        fresh('C', 'finance');
        var rf = office('C').refunds.filter(function (x) { return x.state === 'approved'; })[0];
        S.dispatch('refundProcess', { refundId: rf.id });
        eq(st.byId(office('C').refunds, rf.id).state, 'processing');
      });
      t('الدفع المختلط يُعاد لكل مصدر بنسبته ولا يتجاوز المدفوع', function () {
        fresh('B', 'finance');
        var rf = office('B').refunds.filter(function (x) { return x.bookingRef === 'BK-B-1007'; })[0];
        eq(rf.destinations.length, 2); eq(JK.sum(rf.destinations.map(function (d) { return d.amount; })), rf.components.total);
        S.dispatch('refundApprove', { refundId: rf.id }); S.dispatch('refundProcess', { refundId: rf.id });
        S.dispatch('providerCallback', { refundId: rf.id, attemptId: 'ATT-1', result: 'success' });
        var led = office('B').ledger.filter(function (l) { return l.refundId === rf.id; });
        if (!led.some(function (l) { return l.account === 'office_settlement_recovery'; })) throw new Error('missing settlement recovery for paid-out office funds');
      });
      t('تفويض غير مُحصّل يُلغى ولا يُسترد كمبلغ مُحصّل', function () {
        fresh('A');
        var r = calc('A', 'BK-A-1005', { type: 'cancel_all_remaining' });
        eq(r.officeFee, 0, 'pending acceptance free'); eq(r.outcome, 'release_authorization');
      });

      /* ---------- Roles enforced in handlers ---------- */
      t('صلاحيات الأدوار مفروضة داخل معالجات الإجراءات', function () {
        fresh('A', 'viewer');
        throwsCode(function () { S.dispatch('createPolicy', { name: 'سياسة اختبار', bookingType: 'single' }); }, 'forbidden');
        throwsCode(function () { S.dispatch('submitCustomerRequest', { bookingId: 'BK-A-1001', type: 'cancel_all_remaining' }); }, 'forbidden');
        as('finance'); var rq = office('A').requests.filter(function (r) { return r.status === 'awaiting_review'; })[0];
        throwsCode(function () { S.dispatch('approveRequest', { requestId: rq.id }); }, 'forbidden');
        as('operations');
        throwsCode(function () { S.dispatch('waiveFee', { requestId: rq.id, amount: 100, reason: 'اختبار' }); }, 'forbidden');
        throwsCode(function () { S.dispatch('refundProcess', { refundId: office('A').refunds[0].id }); }, 'forbidden');
        as('admin');
        throwsCode(function () { S.dispatch('refundRetry', { refundId: office('A').refunds[0].id }); }, 'forbidden');
      });
      t('الإعفاء لا يتجاوز رسوم المكتب ولا يمس رسوم JOKRS', function () {
        fresh('A', 'admin');
        var rq = office('A').requests.filter(function (r) { return r.type === 'exception_review' && r.status === 'awaiting_review'; })[0];
        throwsCode(function () { S.dispatch('waiveFee', { requestId: rq.id, amount: 999999, reason: 'تجاوز' }); }, 'bounds');
        S.dispatch('waiveFee', { requestId: rq.id, amount: 5125, reason: 'ظرف صحي موثق' });
        var r = JK.calculate({ booking: booking('A', rq.bookingId), platform: S.state.platform, req: { type: 'exception_review', baseType: 'cancel_visits', visitIds: rq.visitIds, at: rq.requestedAt, waiver: 5125 } });
        eq(r.officeFee, 0); eq(r.jokrs.refund, 0, 'JOKRS fee unchanged by office waiver');
      });

      /* ---------- Policy lifecycle ---------- */
      t('النسخ المنشورة غير قابلة للتعديل؛ التعديل ينشئ نسخة جديدة', function () {
        fresh('A', 'admin');
        throwsCode(function () { S.dispatch('saveDraft', { policyId: 'P-A-01', version: 2, meta: { name: 'تعديل' } }); }, 'immutable');
        throwsCode(function () { S.dispatch('newVersion', { policyId: 'P-A-02' }); }, 'open_version');
        var v = S.dispatch('newVersion', { policyId: 'P-A-01' });
        eq(v.version, 4); eq(v.status, 'draft');
      });
      t('K: الحجز القديم يحتفظ بالنسخة 1 بعد نشر نسخ أحدث', function () {
        fresh('A', 'admin');
        var b = booking('A', 'BK-A-1003'), snapBefore = JSON.stringify(b.policySnapshot);
        var v = S.dispatch('newVersion', { policyId: 'P-A-01' });
        var rules = JK.clone(v.rules); rules.cancel.bands = [{ id: 'x1', minHours: 48, maxHours: null, fee: { type: 'none' } }, { id: 'x2', minHours: 0, maxHours: 48, fee: { type: 'fixed_per_visit', amount: 3000 } }];
        S.dispatch('saveDraft', { policyId: 'P-A-01', version: v.version, rules: rules });
        S.dispatch('submitVersion', { policyId: 'P-A-01', version: v.version });
        eq(booking('A', 'BK-A-1003').policySnapshot.version, 1);
        eq(JSON.stringify(booking('A', 'BK-A-1003').policySnapshot), snapBefore, 'snapshot untouched');
      });
      t('القواعد المقيدة تنتظر اعتماد المنصة ولا يعتمدها المكتب بنفسه', function () {
        fresh('A', 'admin');
        var v = S.dispatch('newVersion', { policyId: 'P-A-01' });
        var rules = JK.clone(v.rules); rules.cancel.bands[2].fee = { type: 'consume' };
        S.dispatch('saveDraft', { policyId: 'P-A-01', version: v.version, rules: rules });
        eq(S.dispatch('submitVersion', { policyId: 'P-A-01', version: v.version }).status, 'pending_review');
        if (st.ACTIONS.platformDecide.perm) throw new Error('platform approval must not be an office permission');
      });
      t('التحقق: تداخل وفجوات الشرائح، النسب، الرسوم السالبة، الأساس، التواريخ', function () {
        var pf = S.state.platform, r = JK.defaultRules('single');
        r.cancel.bands = [{ minHours: 0, maxHours: 30, fee: { type: 'percent', pct: 120, base: 'affected_allocation' } }, { minHours: 24, maxHours: null, fee: { type: 'fixed_per_visit', amount: -100 } }];
        var v = JK.validatePolicy({ name: 'اختبار', bookingType: 'single', effectiveFrom: '2026-12-01T00:00:00Z', effectiveTo: '2026-11-01T00:00:00Z' }, r, pf, {});
        var msgs = v.errors.map(function (e) { return e.msg; }).join('\n');
        ['تداخل', '0% و100%', 'سالبة', 'بعد تاريخ البدء'].forEach(function (k) { if (msgs.indexOf(k) < 0) throw new Error('missing: ' + k); });
        r = JK.defaultRules('single');
        r.cancel.bands = [{ minHours: 24, maxHours: null, fee: { type: 'none' } }, { minHours: 0, maxHours: 12, fee: { type: 'percent', pct: 10 } }];
        msgs = JK.validatePolicy({ name: 'اختبار', bookingType: 'single', effectiveFrom: '2026-12-01T00:00:00Z' }, r, pf, {}).errors.map(function (e) { return e.msg; }).join('\n');
        if (msgs.indexOf('غير مغطاة') < 0) throw new Error('gap not detected');
        if (msgs.indexOf('أساس احتساب') < 0) throw new Error('undefined percentage base not detected');
        r.cancel.fallback = { type: 'none' }; r.cancel.bands[1].fee.base = 'affected_allocation';
        eq(JK.validatePolicy({ name: 'اختبار', bookingType: 'single', effectiveFrom: '2026-12-01T00:00:00Z' }, r, pf, {}).errors.length, 0, 'explicit fallback covers the gap');
      });
      t('النشر بأثر رجعي مرفوض', function () {
        fresh('A', 'admin');
        var v = S.dispatch('newVersion', { policyId: 'P-A-01' });
        S.dispatch('saveDraft', { policyId: 'P-A-01', version: v.version, meta: { effectiveFrom: JK.riyadhISO('2026-11-01 00:00') } });
        throwsCode(function () { S.dispatch('submitVersion', { policyId: 'P-A-01', version: v.version }); }, 'validation');
      });

      /* ---------- Assignments ---------- */
      t('أولوية الربط: الباقة ← الخدمة ← افتراضي المكتب (حتمية)', function () {
        fresh('A');
        var o = office('A'), now = S.state.demo.now;
        eq(JK.resolvePolicy(o, 'pk-a-8w', now).source, 'package');
        eq(JK.resolvePolicy(o, 'pk-a-single', now).source, 'service');
        eq(JK.resolvePolicy(o, 'pk-a-elder', now).source, 'office_default');
        eq(JK.resolvePolicy(o, 'pk-a-events', now).policy, null, 'type mismatch → no merging, no policy');
      });
      t('لا يُسمح بترك باقة معروضة للبيع دون سياسة صالحة', function () {
        fresh('A', 'admin');
        throwsCode(function () { S.dispatch('setAssignment', { level: 'package', targetId: 'pk-a-8w', policyId: null }); }, 'coverage');
        throwsCode(function () { S.dispatch('archivePolicy', { policyId: 'P-A-02' }); }, 'coverage');
        S.dispatch('setAssignment', { level: 'package', targetId: 'pk-a-8w', policyId: null, disableSalesIfUncovered: true });
        eq(JK.findPackage(office('A'), 'pk-a-8w').pkg.salesEnabled, false);
      });
      t('عزل المكاتب: التغيير في مكتب لا يؤثر على غيره', function () {
        fresh('A', 'admin');
        var bBefore = JSON.stringify(office('B')), cBefore = JSON.stringify(office('C'));
        S.dispatch('createPolicy', { name: 'سياسة جديدة للمكتب أ', bookingType: 'single' });
        S.dispatch('submitCustomerRequest', { bookingId: 'BK-A-1001', type: 'cancel_all_remaining' });
        throwsCode(function () { S.dispatch('submitCustomerRequest', { bookingId: 'BK-B-1001', type: 'cancel_all_remaining' }); });
        eq(JSON.stringify(office('B')), bBefore); eq(JSON.stringify(office('C')), cBefore);
      });

      /* ---------- Checkout acceptance ---------- */
      t('الدفع لا يتم دون موافقة حالية، وتغيّر النسخة يبطل الموافقة', function () {
        fresh('A', 'admin', '2026-11-23 11:00');
        S.dispatch('checkoutStart', { packageId: 'pk-a-single', customerId: 'c-a1', start: JK.riyadhISO('2026-11-30 10:00'), workerCount: 1 });
        throwsCode(function () { S.dispatch('checkoutConfirm'); }, 'acceptance_required');
        S.dispatch('checkoutAccept', { checked: true });
        S.state.demo.now = JK.riyadhISO('2026-11-23 12:30'); // v3 becomes effective
        throwsCode(function () { S.dispatch('checkoutConfirm'); }, 'terms_changed');
        S.dispatch('checkoutAccept', { checked: true });
        var b = S.dispatch('checkoutConfirm');
        eq(b.acceptance.version, 3); eq(b.policySnapshot.version, 3); eq(b.acceptance.lang, 'ar');
      });
      t('N: تغيّر أسعار التكلفة لا يغيّر تخصيصات الحجز المؤكد', function () {
        fresh('A', 'admin');
        var before = JSON.stringify(booking('A', 'BK-A-1002').price) + JSON.stringify(booking('A', 'BK-A-1002').visits.map(function (v) { return v.alloc; }));
        S.dispatch('costingChange', { pct: 10 });
        eq(JSON.stringify(booking('A', 'BK-A-1002').price) + JSON.stringify(booking('A', 'BK-A-1002').visits.map(function (v) { return v.alloc; })), before);
      });

      /* ---------- Invariants across all seeded + mutated state ---------- */
      t('ثوابت مالية: التخصيصات تساوي قيمة الخدمة، والمتبقي ≥ 0، والمسترد ≤ المدفوع', function () {
        fresh('A');
        var errs = [];
        Object.keys(S.state.offices).forEach(function (k) {
          office(k).bookings.forEach(function (b) {
            var p = b.price;
            if (p.serviceGross - p.discount !== p.serviceNet) errs.push(b.ref + ' net');
            if (p.serviceNet + p.vat + p.jokrsFee !== p.total) errs.push(b.ref + ' total');
            if (b.credits) { if (JK.sum(b.credits.items.map(function (c) { return c.alloc; })) !== p.serviceNet) errs.push(b.ref + ' credits alloc'); }
            else {
              var s = 0; b.visits.forEach(function (v) { v.workers.forEach(function (w) { s += w.alloc - (w.transferred || 0); }); });
              if (s !== p.serviceNet) errs.push(b.ref + ' visit alloc ' + s + '≠' + p.serviceNet);
            }
            var f = JK.bookingFinance(b);
            if (f.remaining < 0 || f.taxLeft < 0 || f.jokrsLeft < 0) errs.push(b.ref + ' negative remaining');
            b.price.payments.forEach(function (pp) { if (pp.refunded > pp.amount) errs.push(b.ref + ' over-refunded payment'); });
            var refunded = JK.sum(office(k).refunds.filter(function (r) { return r.bookingId === b.id; }).map(function (r) { return r.components.total; }));
            if (refunded > p.total) errs.push(b.ref + ' refunds exceed paid');
            b.visits.forEach(function (v) { v.workers.forEach(function (w) { if (JK.workerOpen(w) < 0) errs.push(v.id + ' negative open'); }); });
          });
        });
        if (errs.length) throw new Error(errs.join(', '));
      });
      t('الإجراء الفاشل لا يترك تغييرات جزئية (ذرية)', function () {
        fresh('A', 'admin');
        var before = JSON.stringify(S.state);
        throwsCode(function () { S.dispatch('archivePolicy', { policyId: 'P-A-01', replacementPolicyId: 'P-A-02' }); });
        eq(JSON.stringify(S.state), before);
      });
      t('سجل التدقيق إضافي فقط ويحتوي الفاعل والدور والوقت', function () {
        fresh('A', 'admin');
        var o = office('A'), first = JSON.stringify(o.audit.slice(0, 5)), n = o.audit.length;
        S.dispatch('createPolicy', { name: 'سياسة للتدقيق', bookingType: 'single' });
        eq(office('A').audit.length, n + 1); eq(JSON.stringify(office('A').audit.slice(0, 5)), first);
        var e = office('A').audit[n]; if (!e.actor || !e.role || !e.at || !e.entityId) throw new Error('incomplete audit event');
      });
      t('بيانات محفوظة تالفة لا توقف التطبيق', function () {
        S.init({ memoryOnly: true, raw: '{"schema":3, broken' });
        if (!S.state || !S.notice) throw new Error('no recovery');
        S.init({ memoryOnly: true, raw: JSON.stringify({ schema: 3, offices: {} }) });
        if (!st.validState(S.state)) throw new Error('invalid state accepted');
      });
    } finally {
      S.state = saved.state; S.storage = saved.storage; S.listeners = saved.listeners; S.notice = saved.notice;
    }
    return results;
  }
  JK.runTests = runTests;

  if (typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
    var path = require('path');
    ['engine.js', 'store.js', 'seed.js'].forEach(function (f) { require(path.join(__dirname, f)); });
    var res = runTests(), failed = res.filter(function (r) { return !r.ok; });
    res.forEach(function (r) { console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log('\n' + (res.length - failed.length) + '/' + res.length + ' passed');
    process.exitCode = failed.length ? 1 : 0;
  }
})(typeof window !== 'undefined' ? window : globalThis);

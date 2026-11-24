/* =====================================================================
   store.js — state, persistence, permission-checked actions, audit.
   No DOM rendering here. Runs in the browser and in Node (tests).
   NOTE: role simulation in a frontend is NOT production security.
   ===================================================================== */
(function (G) {
  'use strict';
  var JK = G.JK;
  var KEY = 'jokrs.crr.demo.v1', SCHEMA = 3;
  var E = JK; // engine helpers

  /* ------------------------------------------------------------------ */
  /* Permissions — enforced inside dispatch(), not just in the UI        */
  /* ------------------------------------------------------------------ */
  var PERMS = {
    'policy.manage': ['admin'],
    'assignment.manage': ['admin'],
    'request.review': ['admin', 'operations'],
    'request.office': ['admin', 'operations'],
    'request.waive': ['admin'],
    'refund.finance': ['finance'],
    'customer.simulate': ['admin', 'operations', 'finance', 'customer']
  };
  var PERM_LABEL = {
    'policy.manage': 'إدارة السياسات متاحة لمدير المكتب فقط',
    'assignment.manage': 'تغيير ربط السياسات متاح لمدير المكتب فقط',
    'request.review': 'مراجعة الطلبات متاحة للعمليات ومدير المكتب',
    'request.office': 'تسجيل إجراءات المكتب متاح للعمليات ومدير المكتب',
    'request.waive': 'الإعفاء من رسوم المكتب أو تخفيضها متاح لمدير المكتب فقط',
    'refund.finance': 'تنفيذ المبالغ المستردة متاح لفريق المالية فقط',
    'customer.simulate': 'دور المشاهد للقراءة فقط ولا يمكنه إنشاء طلبات محاكاة'
  };
  function can(role, perm) { return !!(PERMS[perm] && PERMS[perm].indexOf(role) >= 0); }
  function ActionError(msg, code, details) { var e = new Error(msg); e.isAction = true; e.code = code || 'action'; e.details = details || null; return e; }
  function requirePerm(role, perm) { if (!can(role, perm)) throw ActionError('غير مسموح: ' + PERM_LABEL[perm] + '. (دورك الحالي: ' + E.L.role[role] + ')', 'forbidden'); }

  /* ------------------------------------------------------------------ */
  /* Persistence with memory fallback                                    */
  /* ------------------------------------------------------------------ */
  var Store = { state: null, notice: null, storage: 'memory', listeners: [] };
  var mem = {};
  function storageAvailable() {
    try { if (typeof window === 'undefined' || !window.localStorage) return false; var k = '__jk_probe'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return true; }
    catch (e) { return false; }
  }
  function sGet() {
    if (Store.storage === 'local') { try { return window.localStorage.getItem(KEY); } catch (e) { Store.storage = 'memory'; } }
    return mem[KEY] || null;
  }
  function sSet(v) {
    if (Store.storage === 'local') {
      try { window.localStorage.setItem(KEY, v); return; }
      catch (e) { Store.storage = 'memory'; Store.notice = 'تعذّر الحفظ في المتصفح؛ تُحفظ التغييرات مؤقتاً في الذاكرة فقط.'; }
    }
    mem[KEY] = v;
  }
  function validState(s) {
    if (!s || s.schema !== SCHEMA || !s.demo || !s.platform || !s.offices) return false;
    return ['A', 'B', 'C'].every(function (k) {
      var o = s.offices[k];
      return o && o.office && Array.isArray(o.bookings) && Array.isArray(o.policies) && Array.isArray(o.audit) && Array.isArray(o.refunds) && Array.isArray(o.requests) && Array.isArray(o.assignments);
    });
  }
  function init(opts) {
    opts = opts || {};
    Store.storage = opts.memoryOnly ? 'memory' : (storageAvailable() ? 'local' : 'memory');
    if (Store.storage === 'memory' && !opts.memoryOnly) Store.notice = 'التخزين المحلي غير متاح؛ تعمل المحاكاة في الذاكرة وستُفقد التغييرات عند تحديث الصفحة.';
    var raw = opts.raw !== undefined ? opts.raw : sGet();
    if (raw) {
      try {
        var s = JSON.parse(raw);
        if (validState(s)) { Store.state = s; return Store; }
        Store.notice = 'بيانات العرض المحفوظة غير متوافقة مع هذا الإصدار أو ناقصة؛ أُعيد تحميل البيانات الأولية.';
      } catch (e) { Store.notice = 'تعذّرت قراءة بيانات العرض المحفوظة (بيانات تالفة)؛ أُعيد تحميل البيانات الأولية دون توقف.'; }
    }
    Store.state = JK.buildSeed();
    save();
    return Store;
  }
  function save() { sSet(JSON.stringify(Store.state)); }
  function emit() { Store.listeners.forEach(function (f) { try { f(); } catch (e) { if (typeof console !== 'undefined') console.error(e); } }); }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  function pad(n, w) { var s = String(n); while (s.length < (w || 4)) s = '0' + s; return s; }
  function nextRef(o, kind, prefix, base) { o.seq[kind] = (o.seq[kind] || base) + 1; return prefix + '-' + o.office.code + '-' + o.seq[kind]; }
  function byId(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }
  function actorFor(state, officeId, role) {
    var o = state.offices[officeId];
    if (role === 'platform') return { name: 'مراجع منصة JOKRS (محاكاة)', role: 'platform' };
    if (role === 'system') return { name: 'المعالجة الآلية', role: 'system' };
    return { name: o.office.staff[role] || E.L.role[role], role: role };
  }
  function customerActor(b) { return { name: b.customerName, role: 'customer' }; }
  function mkCtx(state, officeId, role, now) {
    var o = state.offices[officeId];
    return { state: state, o: o, role: role, now: now, actor: actorFor(state, officeId, role), platform: state.platform };
  }
  function audit(ctx, action, entity, entityId, before, after, note, actor) {
    var o = ctx.o, a = actor || ctx.actor;
    o.seq.audit = (o.seq.audit || 0) + 1;
    o.audit.push({ id: 'EV-' + o.office.code + '-' + pad(o.seq.audit, 5), at: ctx.now, actor: a.name, role: a.role, action: action, entity: entity, entityId: entityId,
      before: before === undefined ? null : E.clone(before), after: after === undefined ? null : E.clone(after), note: note || '' });
  }
  function actLog(r, ctx, text, actor) { var a = actor || ctx.actor; r.activity.push({ at: ctx.now, actor: a.name, role: a.role, text: text }); }

  /* ------------------------------------------------------------------ */
  /* Booking construction (shared by checkout and seed)                  */
  /* ------------------------------------------------------------------ */
  function quote(o, platform, s, now) {
    var f = E.findPackage(o, s.packageId);
    if (!f) return null;
    var pkg = f.pkg, svc = f.service, c = pkg.costing, lines = [];
    var workers = pkg.bookingType === 'single' ? (s.workerCount || c.defaultWorkers || 1) : (c.workers || 1);
    if (pkg.bookingType === 'single') {
      lines.push({ code: 'svc', label: svc.name + ' — ' + workers + ' عاملة × ' + c.hours + ' ساعات × ' + E.sar(c.hourly) + ' للساعة', amount: c.hourly * c.hours * workers });
      if (c.transport) lines.push({ code: 'transport', label: 'رسوم التوصيل', amount: c.transport });
    } else {
      lines.push({ code: 'pkg', label: pkg.name + ' — سعر الباقة', amount: c.price });
      if (c.transport) lines.push({ code: 'transport', label: 'رسوم التوصيل للباقة', amount: c.transport });
    }
    var start = s.start, plan = [];
    if (pkg.bookingType !== 'credits') for (var i = 0; i < pkg.visits; i++) plan.push({ start: new Date(Date.parse(start) + i * 7 * E.DAY).toISOString() });
    var resolved = E.resolvePolicy(o, pkg.id, now);
    var key = resolved.policy ? resolved.policy.id + ':v' + resolved.version.version + '|' + platform.termsVersion + '|' + platform.feeRuleVersion : null;
    return { pkg: pkg, service: svc, lines: lines, workers: workers, plan: plan, resolved: resolved, key: key, vatBps: o.costing.vatBps, jokrsFee: platform.jokrsFee.amount, costingVersion: o.costing.version, durationMin: c.hours * 60 };
  }

  function snapshotOf(policy, v, platform, at, firstStart) {
    var text = E.policyText(v.rules, policy.bookingType, platform, { firstVisitStart: firstStart, confirmAt: at });
    return { policyId: policy.id, policyName: v.name || policy.name, version: v.version, rules: E.clone(v.rules), platformApproved: !!v.platformApproved,
      acceptedAt: at, platformVersion: platform.version, termsVersion: platform.termsVersion, feeRuleVersion: platform.feeRuleVersion, lang: 'ar',
      textSnapshot: text.map(function (sct) { return { title: sct.title, items: sct.items.slice() }; }) };
  }

  /** spec: {ref, customer, packageId, createdAt, confirmedAt, officeAcceptance, workerCount, workerIds, visits:[{start,status,origin,label,workerIds}],
   *        lines?, discount?, vatBps?, jokrsFee?, payments, policyId, version, officePayout, credits:{count, expiresAt, items:[{state, visitIndex}]}} */
  function buildBooking(o, platform, spec) {
    var f = E.findPackage(o, spec.packageId), pkg = f.pkg, svc = f.service, c = pkg.costing;
    var q = quote(o, platform, { packageId: pkg.id, workerCount: spec.workerCount, start: spec.visits && spec.visits[0] ? spec.visits[0].start : spec.createdAt }, spec.createdAt);
    var lines = spec.lines || q.lines;
    var gross = E.sum(lines.map(function (l) { return l.amount; }));
    var discount = spec.discount ? spec.discount.amount : 0;
    var net = gross - discount;
    var vatBps = spec.vatBps !== undefined ? spec.vatBps : o.costing.vatBps;
    var vat = Math.round((net * vatBps) / 10000);
    var jokrs = spec.jokrsFee !== undefined ? spec.jokrsFee : platform.jokrsFee.amount;
    var total = net + vat + jokrs;
    var pays = (spec.payments || [{ method: 'card', state: 'captured' }]).map(function (p, i) {
      return { id: 'PAY-' + spec.ref.replace(/^BK-/, '') + '-' + (i + 1), method: p.method, state: p.state || 'captured', amount: p.amount !== undefined ? p.amount : null, refunded: 0 };
    });
    var known = E.sum(pays.filter(function (p) { return p.amount !== null; }).map(function (p) { return p.amount; }));
    pays.forEach(function (p) { if (p.amount === null) p.amount = total - known; });
    if (E.sum(pays.map(function (p) { return p.amount; })) !== total) throw new Error('Seed payments do not sum to total for ' + spec.ref);
    var dur = (c.hours || 4) * 60;
    var workersN = pkg.bookingType === 'single' ? (spec.workerCount || c.defaultWorkers || 1) : (c.workers || 1);
    var b = {
      id: spec.ref, ref: spec.ref, officeId: o.office.id, customerId: spec.customer.id, customerName: spec.customer.name,
      serviceId: svc.id, serviceName: svc.name, packageId: pkg.id, packageName: pkg.name, type: pkg.bookingType,
      createdAt: spec.createdAt, confirmedAt: spec.confirmedAt || spec.createdAt, officeAcceptance: spec.officeAcceptance || 'accepted',
      officePayout: spec.officePayout || 'held', durationMin: dur,
      price: { lines: lines, serviceGross: gross, discount: discount, discountLabel: spec.discount ? spec.discount.label : '', serviceNet: net, vatBps: vatBps, vat: vat, jokrsFee: jokrs, total: total, payments: pays, costingVersion: spec.costingVersion || o.costing.version, pricedAt: spec.createdAt },
      visits: [], credits: null, adjustments: [], taxRefunded: 0, jokrsRefunded: 0, customerReschedules: spec.customerReschedules || 0, walletCredited: 0
    };
    var visitsSpec = spec.visits || [];
    if (pkg.bookingType === 'credits') {
      var count = spec.credits.count, allocs = E.allocate(net, visitsArr(count));
      b.credits = { total: count, expiresAt: spec.credits.expiresAt, items: [] };
      for (var k = 0; k < count; k++) b.credits.items.push({ id: b.ref + '-C' + (k + 1), label: 'رصيد ' + (k + 1), alloc: allocs[k], state: 'available', consumed: 0, refunded: 0, fee: 0, absorbed: 0, expiresAt: spec.credits.expiresAt, visitId: null, restoredCount: 0, expiryHistory: [] });
      visitsSpec.forEach(function (vs, idx) {
        var cr = b.credits.items[idx];
        var v = mkVisit(b, vs, idx, dur, 0, 0, 0, vs.workerIds || spec.workerIds, o);
        v.origin = 'credit'; v.creditId = cr.id; v.label = 'موعد ' + (idx + 1);
        cr.visitId = v.id;
        if (vs.status === 'completed') { cr.state = 'used'; cr.consumed = cr.alloc; }
        else if (vs.status === 'scheduled') cr.state = 'scheduled';
        b.visits.push(v);
      });
      (spec.credits.expired || []).forEach(function (idx) { b.credits.items[idx].expiresAt = spec.credits.expiredAt; });
    } else {
      var paid = visitsSpec.map(function (vs, i) { return { vs: vs, i: i }; }).filter(function (x) { return (x.vs.origin || 'paid') === 'paid'; });
      var w = paid.map(function (x) { return (x.vs.workerIds || spec.workerIds || [1]).length; });
      var ga = E.allocate(gross, w), da = E.allocate(discount, w);
      var pi = 0;
      visitsSpec.forEach(function (vs, idx) {
        var isPaid = (vs.origin || 'paid') === 'paid';
        var g = isPaid ? ga[pi] : 0, d = isPaid ? da[pi] : 0;
        if (isPaid) pi++;
        b.visits.push(mkVisit(b, vs, idx, dur, g, d, g - d, vs.workerIds || spec.workerIds, o));
      });
    }
    var pol = byId(o.policies, spec.policyId), ver = pol.versions.filter(function (x) { return x.version === spec.version; })[0];
    b.policySnapshot = snapshotOf(pol, ver, platform, b.confirmedAt, b.visits[0] ? b.visits[0].start : null);
    b.acceptance = { customerId: b.customerId, bookingId: b.id, policyId: pol.id, version: ver.version, platformTermsVersion: platform.termsVersion, feeRuleVersion: platform.feeRuleVersion,
      textSnapshotRef: 'لقطة نص السياسة محفوظة مع الحجز', at: b.confirmedAt, lang: 'ar' };
    return b;
  }
  function visitsArr(n) { var a = []; for (var i = 0; i < n; i++) a.push(1); return a; }
  function mkVisit(b, vs, idx, dur, gross, disc, net, workerIds, o) {
    var ids = workerIds || [];
    var wa = E.allocate(net, visitsArr(ids.length || 1));
    var v = {
      id: b.ref + '-V' + (idx + 1), label: vs.label || String(idx + 1), seq: idx + 1, origin: vs.origin || 'paid', start: vs.start,
      end: new Date(Date.parse(vs.start) + dur * E.MIN).toISOString(), status: 'scheduled', grossAlloc: gross, discountAlloc: disc, alloc: net,
      workers: ids.map(function (wid, i) { var wk = byId(o.workers, wid); return { id: b.ref + '-V' + (idx + 1) + '-W' + (i + 1), workerId: wid, name: wk ? wk.name : wid, alloc: wa[i], consumed: 0, refunded: 0, fee: 0, transferred: 0, absorbed: 0, status: 'assigned' }; }),
      history: [], customerReschedules: 0, lockedBand: null, originalStart: null, linkedVisitId: vs.linkedVisitId || null, note: vs.note || ''
    };
    if (vs.status === 'completed') { v.status = 'completed'; v.workers.forEach(function (w) { w.consumed = w.alloc; w.status = 'delivered'; }); }
    return v;
  }

  /* ------------------------------------------------------------------ */
  /* Applying a decision (effects from the shared calculation)           */
  /* ------------------------------------------------------------------ */
  function findVisit(b, id) { return byId(b.visits, id); }
  function applyEffects(ctx, b, calc, r) {
    var now = ctx.now;
    calc.effects.workers.forEach(function (e) {
      var v = findVisit(b, e.visitId), w = byId(v.workers, e.workerId);
      w.absorbed += e.absorb || 0; w.fee += e.fee || 0; w.refunded += e.refund || 0; w.consumed += e.consume || 0;
      if (e.newStatus) w.status = e.newStatus;
    });
    calc.effects.visits.forEach(function (e) {
      var v = findVisit(b, e.visitId);
      v.history.push({ at: now, type: 'status', from: v.status, to: e.newStatus, ref: r.ref });
      v.status = e.newStatus;
    });
    calc.effects.credits.forEach(function (e) {
      var c = byId(b.credits.items, e.creditId);
      var from = c.state;
      c.state = e.newState; c.refunded += e.refund || 0; c.fee += e.fee || 0; c.consumed += e.consume || 0; c.absorbed += e.absorb || 0;
      if (e.expiresAt && e.expiresAt !== c.expiresAt) { c.expiryHistory.push({ at: now, from: c.expiresAt, to: e.expiresAt, ref: r.ref }); c.expiresAt = e.expiresAt; }
      if (e.newState === 'available' && from !== 'available') { c.restoredCount++; c.visitId = null; }
      if (!c.log) c.log = [];
      c.log.push({ at: now, from: from, to: e.newState, ref: r.ref });
    });
    var s = calc.effects.schedule;
    if (s) {
      var v = findVisit(b, s.visitId);
      if (!v.originalStart) v.originalStart = v.start;
      v.history.push({ at: now, type: 'reschedule', from: s.from, to: s.to, counts: s.counts, ref: r.ref, by: r.initiator });
      v.start = s.to; v.end = s.toEnd;
      if (s.counts) { v.customerReschedules++; b.customerReschedules++; }
      if (s.lockBand) v.lockedBand = s.lockBand;
      if (s.fee > 0) {
        var ws = v.workers.filter(function (w) { return w.status === 'assigned'; });
        var parts = E.allocate(s.fee, ws.map(E.workerOpen));
        ws.forEach(function (w, i) { w.fee += parts[i]; });
      }
    }
    var rp = calc.effects.replacement;
    if (rp) {
      var ov = findVisit(b, rp.visitId);
      var nv = {
        id: ov.id + '-R', label: 'بديلة عن ' + ov.label, seq: ov.seq, origin: 'replacement', start: rp.start, end: new Date(Date.parse(rp.start) + (Date.parse(ov.end) - Date.parse(ov.start))).toISOString(),
        status: 'scheduled', grossAlloc: 0, discountAlloc: 0, alloc: E.visitOpen(ov), workers: [], history: [{ at: now, type: 'created', note: 'موعد بديل لزيارة مدفوعة ألغاها المكتب', ref: r.ref }],
        customerReschedules: 0, lockedBand: null, originalStart: null, linkedVisitId: ov.id, note: 'تحتفظ بقيمة الزيارة الأصلية المدفوعة'
      };
      ov.workers.forEach(function (w, i) {
        var open = E.workerOpen(w);
        if (w.status !== 'assigned') return;
        nv.workers.push({ id: nv.id + '-W' + (i + 1), workerId: rp.workerIds && rp.workerIds[i] ? rp.workerIds[i] : w.workerId, name: rp.workerNames && rp.workerNames[i] ? rp.workerNames[i] : w.name, alloc: open, consumed: 0, refunded: 0, fee: 0, transferred: 0, absorbed: 0, status: 'assigned' });
        w.transferred += open; w.status = 'replaced';
      });
      ov.history.push({ at: now, type: 'status', from: ov.status, to: 'replaced', ref: r.ref });
      ov.status = 'replaced'; ov.replacementVisitId = nv.id;
      b.visits.push(nv);
    }
    b.taxRefunded += calc.taxRefund || 0;
    b.jokrsRefunded += (calc.jokrs && calc.jokrs.refund) || 0;
  }

  function ledgerAdd(ctx, rf, account, amount, label, kind) {
    var o = ctx.o;
    o.seq.ledger = (o.seq.ledger || 0) + 1;
    o.ledger.push({ id: 'LG-' + o.office.code + '-' + pad(o.seq.ledger, 5), at: ctx.now, refundId: rf ? rf.id : null, refundRef: rf ? rf.ref : null, bookingRef: rf ? rf.bookingRef : null, account: account, amount: amount, label: label, kind: kind || 'movement' });
  }

  function createRefund(ctx, b, r, calc) {
    var o = ctx.o, opId = 'op-' + r.id;
    var existing = o.refunds.filter(function (x) { return x.opId === opId; })[0];
    if (existing) return existing; // idempotent: never create twice for one request
    var total = calc.totalRefund;
    var state = total === 0 ? 'not_required' : (total > o.office.refundReviewThreshold ? 'awaiting_review' : 'approved');
    var kindNote = {
      credit_restore: 'أُعيد استحقاق الزيارة إلى رصيد العميل — لا استرداد نقدي.',
      replacement: 'قُبل موعد بديل تنتقل إليه قيمة الزيارة المدفوعة — لا استرداد نقدي.',
      no_refund: calc.creditOutcome === 'forfeited' ? 'احتُسب الرصيد بسبب الإلغاء المتأخر — لا مبلغ مستحق.' : 'لا يوجد مبلغ مستحق للعميل وفق الحساب.'
    };
    var rf = {
      id: nextRef(o, 'refund', 'RF', 3000), opId: opId, requestId: r.id, requestRef: r.ref, bookingId: b.id, bookingRef: b.ref, customerName: b.customerName,
      state: state, outcome: calc.outcome, components: { service: calc.serviceRefund, tax: calc.taxRefund, jokrs: calc.jokrs.refund, total: total },
      officeFeeRetained: calc.officeFee, destinations: E.clone(calc.destinations), createdAt: ctx.now, timeline: [{ state: state, at: ctx.now, by: ctx.actor.name }],
      attempts: [], providerRef: null, failureReason: null, completedAt: null, note: total === 0 ? (kindNote[calc.outcome] || kindNote.no_refund) : ''
    };
    rf.ref = rf.id;
    o.refunds.push(rf);
    r.refundId = rf.id;
    audit(ctx, 'refund.created', 'refund', rf.id, null, { state: state, total: total, destinations: rf.destinations.map(function (d) { return E.L.destAction[d.action] + ' ' + E.sar(d.amount); }) }, r.ref);
    if (calc.officeFee > 0) ledgerAdd(ctx, rf, 'office_fee_retained', calc.officeFee, 'رسوم إلغاء/تعديل محتفظ بها للمكتب (قيد مذكرة — لا حركة نقدية)', 'memo');
    if (state === 'not_required') {
      if (calc.outcome === 'credit_restore') ledgerAdd(ctx, rf, 'entitlement_restored', 0, 'إعادة استحقاق زيارة إلى الرصيد (غير نقدي)', 'memo');
      if (calc.outcome === 'replacement') ledgerAdd(ctx, rf, 'entitlement_transferred', 0, 'نقل قيمة زيارة مدفوعة إلى موعد بديل (غير نقدي)', 'memo');
    }
    return rf;
  }

  function completeRefund(ctx, rf, att) {
    var o = ctx.o;
    if (rf.state === 'completed' || o.postedOps.indexOf(rf.opId) >= 0) return false;
    var b = byId(o.bookings, rf.bookingId);
    rf.state = 'completed'; rf.completedAt = ctx.now; rf.failureReason = null;
    if (att) rf.providerRef = att.providerRef;
    rf.timeline.push({ state: 'completed', at: ctx.now, by: att ? 'مزوّد الدفع (محاكاة)' : ctx.actor.name });
    rf.destinations.forEach(function (d) {
      var p = d.paymentId ? byId(b.price.payments, d.paymentId) : null;
      if (p) p.refunded += d.amount;
      if (d.action === 'wallet_credit') b.walletCredited += d.amount;
    });
    var c = rf.components;
    ledgerAdd(ctx, rf, 'customer_refund', -c.total, 'مبلغ مُعاد للعميل (' + rf.destinations.map(function (d) { return E.L.destAction[d.action]; }).join(' + ') + ')');
    if (c.service) ledgerAdd(ctx, rf, 'office_service_reversal', -c.service, 'عكس إيراد خدمة المكتب');
    if (c.tax) ledgerAdd(ctx, rf, 'tax_adjustment', -c.tax, 'تعديل ضريبي محاكى على الجزء المسترد (بيانات عرض — ليست استشارة ضريبية)');
    if (c.jokrs) ledgerAdd(ctx, rf, 'jokrs_fee_reversal', -c.jokrs, 'عكس رسوم JOKRS — حساب المنصة وليس المكتب');
    if (b.officePayout === 'paid_out' && c.service) ledgerAdd(ctx, rf, 'office_settlement_recovery', -c.service, 'مطالبة تسوية: أموال المكتب لهذا الحجز صُرفت سابقاً؛ يُخصم المبلغ من مستحقات المكتب القادمة');
    o.postedOps.push(rf.opId);
    audit(ctx, 'refund.completed', 'refund', rf.id, { state: 'processing' }, { state: 'completed', providerRef: rf.providerRef, total: c.total }, rf.requestRef, att ? { name: 'مزوّد الدفع (محاكاة)', role: 'system' } : null);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Requests                                                            */
  /* ------------------------------------------------------------------ */
  function reqFromRequest(r, extra) {
    return Object.assign({
      type: r.type, baseType: r.baseType, at: r.requestedAt, visitIds: r.visitIds, workerIds: r.workerIds, initiator: r.initiator, cause: r.cause,
      remedy: r.remedy, destination: r.destination, deliveredWorkerIds: r.deliveredWorkerIds, evidence: r.evidence, disputed: r.disputed,
      reasonCode: r.reasonCode, waiver: r.waiver, newStart: r.newStart, qualityAmount: r.qualityAmount, reasonLabel: r.reasonLabel
    }, extra || {});
  }
  function calcFor(ctx, r, extra) {
    var b = byId(ctx.o.bookings, r.bookingId);
    return E.calculate({ booking: b, platform: ctx.platform, req: reqFromRequest(r, extra) });
  }
  var OPEN = ['awaiting_review', 'info_requested', 'proposal_sent'];
  function visitWorkerIds(v) { return v.workers.filter(function (w) { return w.status === 'assigned'; }).map(function (w) { return w.workerId; }); }

  function applyDecision(ctx, r, calc, status, note, actor) {
    var b = byId(ctx.o.bookings, r.bookingId);
    applyEffects(ctx, b, calc, r);
    r.calc = calc;
    r.status = status;
    r.decision = { at: ctx.now, by: (actor || ctx.actor).name, role: (actor || ctx.actor).role, note: note || '', outcome: calc.outcome };
    if (calc.outcome !== 'reschedule') createRefund(ctx, b, r, calc);
    if (calc.effects.schedule) audit(ctx, 'schedule.changed', 'visit', calc.effects.schedule.visitId, { start: calc.effects.schedule.from }, { start: calc.effects.schedule.to, countsTowardAllowance: calc.effects.schedule.counts, fee: calc.effects.schedule.fee }, r.ref, actor);
    if (calc.effects.replacement) audit(ctx, 'schedule.changed', 'visit', calc.effects.replacement.visitId, { status: 'scheduled' }, { replacementStart: calc.effects.replacement.start }, r.ref + ' — موعد بديل', actor);
  }

  function submitRequest(ctx, p) {
    var o = ctx.o, b = byId(o.bookings, p.bookingId);
    if (!b) throw ActionError('الحجز غير موجود في هذا المكتب.');
    var at = p.at || ctx.now;
    var vids = p.visitIds || [];
    var clash = o.requests.filter(function (r) { return r.bookingId === b.id && OPEN.indexOf(r.status) >= 0 && (r.visitIds || []).some(function (v) { return vids.indexOf(v) >= 0 || !vids.length; }); })[0];
    if (clash) throw ActionError('يوجد طلب مفتوح على نفس الزيارة (' + clash.ref + ' — ' + E.L.requestStatus[clash.status] + '). أكمل معالجته أولاً.', 'duplicate');
    var type = p.type, baseType = null;
    var req = Object.assign({}, p, { at: at });
    var calc = E.calculate({ booking: b, platform: ctx.platform, req: req });
    if (!calc.ok) {
      if (p.asException && calc.canRequestReview) {
        baseType = type; type = 'exception_review';
        calc = E.calculate({ booking: b, platform: ctx.platform, req: Object.assign({}, req, { type: 'exception_review', baseType: baseType }) });
        if (!calc.ok) throw ActionError(calc.blocked, 'blocked');
      } else throw ActionError(calc.blocked, 'blocked', { canRequestReview: calc.canRequestReview });
    }
    var isCustomer = p.initiator !== 'office';
    var actor = isCustomer ? customerActor(b) : ctx.actor;
    var r = {
      id: nextRef(o, 'request', 'R', 2000), bookingId: b.id, bookingRef: b.ref, bookingType: b.type, customerId: b.customerId, customerName: b.customerName,
      type: type, baseType: baseType, status: 'awaiting_review', requestedAt: at, createdAt: ctx.now, initiator: p.initiator || 'customer', cause: p.cause || 'customer',
      reasonCode: p.reasonCode || null, reasonLabel: p.reasonLabel || null, reason: p.reason || '', evidence: (p.evidence || []).map(function (x) { return Object.assign({ at: ctx.now }, x); }),
      disputed: !!p.disputed, visitIds: vids, workerIds: p.workerIds || null, deliveredWorkerIds: p.deliveredWorkerIds || null, newStart: p.newStart || null,
      remedy: p.remedy || null, destination: p.destination || 'original', qualityAmount: p.qualityAmount || 0, waiver: 0, proposals: [], decision: null, refundId: null,
      activity: [], calc: null, policyVersion: b.policySnapshot.policyName + ' — v' + b.policySnapshot.version
    };
    r.ref = r.id;
    o.requests.push(r);
    actLog(r, ctx, 'قُدّم الطلب: ' + E.L.requestType[type] + (p.reason ? ' — "' + p.reason + '"' : ''), actor);
    audit(ctx, 'request.submitted', 'request', r.id, null, { type: type, booking: b.ref, requestedAt: at, initiator: r.initiator, cause: r.cause, preview: { refund: calc.totalRefund, fee: calc.officeFee } }, p.reason || '', actor);
    var sys = { name: 'المعالجة الآلية', role: 'system' };
    if (type === 'office_cancel' && p.remedy === 'replacement') {
      var v = findVisit(b, vids[0]);
      var wIds = p.replacementWorkerIds || visitWorkerIds(v);
      var av = E.checkAvailability(o, wIds, p.newStart, b.durationMin, v.id);
      if (!p.newStart) throw ActionError('حدد موعد الزيارة البديلة.');
      if (!av.ok) throw ActionError('الموعد البديل غير متاح: ' + av.conflicts.map(function (c) { return c.text; }).join('؛ '), 'unavailable');
      r.proposals.push({ start: p.newStart, at: ctx.now, by: ctx.actor.name, status: 'pending', kind: 'replacement', workerIds: wIds });
      r.status = 'proposal_sent';
      actLog(r, ctx, 'اقتُرح موعد بديل ' + E.fmtDT(p.newStart) + ' بانتظار موافقة العميل. يبقى خيار الاسترداد الكامل متاحاً للعميل.');
      audit(ctx, 'schedule.proposed', 'request', r.id, null, { proposedStart: p.newStart }, 'موعد بديل لخلل من المكتب');
      return r;
    }
    if (type === 'reschedule' && calc.ok) {
      var vv = findVisit(b, vids[0]);
      var av2 = E.checkAvailability(o, visitWorkerIds(vv), p.newStart, b.durationMin, vv.id);
      if (!av2.ok) {
        r.status = 'awaiting_review';
        actLog(r, ctx, 'الموعد المطلوب غير متاح (' + av2.conflicts.map(function (c) { return c.text; }).join('؛ ') + '). الموعد الأصلي يبقى مؤكداً حتى يُعتمد بديل.', sys);
        return r;
      }
    }
    if (!calc.needsReview && p.autoProcess !== false) {
      applyDecision(ctx, r, calc, 'auto_approved', 'معالجة آلية — قاعدة واضحة دون استثناءات', sys);
      actLog(r, ctx, 'اعتُمد آلياً وفق: ' + (calc.rule ? calc.rule.label : '') , sys);
      audit(ctx, 'request.decided', 'request', r.id, { status: 'submitted' }, { status: 'auto_approved', refund: calc.totalRefund, fee: calc.officeFee, rule: calc.rule && calc.rule.label }, 'معالجة آلية', sys);
    } else {
      actLog(r, ctx, 'أُحيل للمراجعة: ' + (calc.reviewReasons.join(' ') || 'يتطلب قراراً من المكتب'), sys);
    }
    return r;
  }

  function reviewable(r) { if (['awaiting_review', 'info_requested'].indexOf(r.status) < 0) throw ActionError('لا يمكن تنفيذ الإجراء: الطلب ' + r.ref + ' في حالة "' + E.L.requestStatus[r.status] + '" (ربما عولج مسبقاً).', 'state'); }

  function approveRequest(ctx, p) {
    var r = byId(ctx.o.requests, p.requestId); if (!r) throw ActionError('الطلب غير موجود.');
    reviewable(r);
    var b = byId(ctx.o.bookings, r.bookingId);
    var extra = {};
    if (p.inCustomerFavor) {
      if (['no_show', 'exception_review', 'quality_issue'].indexOf(r.type) < 0 && r.baseType !== 'no_show') throw ActionError('الحسم لصالح العميل متاح لحالات تعذّر الاستقبال والمراجعات الاستثنائية.');
      if (!p.note || p.note.trim().length < 10) throw ActionError('اكتب سبب الحسم لصالح العميل (10 أحرف على الأقل).');
      extra = r.type === 'no_show' ? { type: 'office_cancel', remedy: 'refund', cause: 'office', reasonLabel: 'حُسم لصالح العميل' } : { waiver: 0 };
    }
    var calc = calcFor(ctx, r, extra);
    if (!calc.ok) throw ActionError('لا يمكن الاعتماد: ' + calc.blocked, 'blocked');
    if (r.type === 'no_show' && !p.inCustomerFavor) {
      var rules = b.policySnapshot.rules;
      var officeEvidence = r.evidence.filter(function (e) { return e.by === 'office'; });
      if (calc.officeFee > 0 && rules.exceptions.noShow.requireEvidence && !officeEvidence.length) throw ActionError('أرفق إثباتاً من المكتب قبل احتساب رسوم تعذّر الاستقبال.', 'evidence');
      if (r.disputed && (!p.note || p.note.trim().length < 10)) throw ActionError('القرار على واقعة متنازع عليها يتطلب سبباً مكتوباً يوضح الإثباتات (10 أحرف على الأقل). يحق للعميل رفع الحالة لمراجعة JOKRS.', 'reason');
    }
    if ((r.type === 'reschedule' || r.baseType === 'reschedule')) {
      var v = findVisit(b, r.visitIds[0]);
      var av = E.checkAvailability(ctx.o, visitWorkerIds(v), r.newStart, b.durationMin, v.id);
      if (!av.ok) throw ActionError('الموعد المطلوب غير متاح: ' + av.conflicts.map(function (c) { return c.text; }).join('؛ ') + ' — استخدم "اقتراح موعد بديل". الموعد الأصلي لم يتغير.', 'unavailable');
    }
    if (r.type === 'quality_issue' && !(r.qualityAmount > 0)) throw ActionError('حدّد مبلغ التعويض أولاً.');
    var before = { status: r.status };
    applyDecision(ctx, r, calc, 'approved', p.note || '');
    actLog(r, ctx, (p.inCustomerFavor ? 'حُسم لصالح العميل: ' : 'اعتُمد وفق السياسة: ') + (calc.rule ? calc.rule.label : '') + (p.note ? ' — ' + p.note : ''));
    audit(ctx, 'request.decided', 'request', r.id, before, { status: 'approved', refund: calc.totalRefund, officeFee: calc.officeFee, waiver: calc.waiver, rule: calc.rule && calc.rule.label }, p.note || '');
    return r;
  }

  function rejectRequest(ctx, p) {
    var r = byId(ctx.o.requests, p.requestId); if (!r) throw ActionError('الطلب غير موجود.');
    if (['awaiting_review', 'info_requested', 'proposal_sent'].indexOf(r.status) < 0) throw ActionError('لا يمكن رفض طلب في حالة "' + E.L.requestStatus[r.status] + '".', 'state');
    if (r.type === 'office_cancel') throw ActionError('لا يمكن رفض إجراء ناتج عن خلل المكتب؛ العميل يختار بين الاسترداد أو البديل.');
    if (!p.reason || p.reason.trim().length < 5) throw ActionError('سبب الرفض مطلوب (5 أحرف على الأقل) ويُعرض للعميل.', 'reason');
    var before = { status: r.status };
    r.proposals.forEach(function (x) { if (x.status === 'pending') x.status = 'withdrawn'; });
    r.status = 'rejected';
    r.decision = { at: ctx.now, by: ctx.actor.name, role: ctx.actor.role, note: p.reason.trim(), outcome: 'rejected' };
    actLog(r, ctx, 'رُفض الطلب: ' + p.reason.trim() + ' — يبقى للعميل حق طلب مراجعة لدى JOKRS.');
    audit(ctx, 'request.decided', 'request', r.id, before, { status: 'rejected', reason: p.reason.trim() }, p.reason.trim());
    return r;
  }

  function requestInfo(ctx, p) {
    var r = byId(ctx.o.requests, p.requestId); if (!r) throw ActionError('الطلب غير موجود.');
    if (r.status !== 'awaiting_review') throw ActionError('يمكن طلب معلومات لطلب بانتظار المراجعة فقط.', 'state');
    if (!p.message || p.message.trim().length < 5) throw ActionError('اكتب المعلومات المطلوبة من العميل.');
    r.status = 'info_requested';
    actLog(r, ctx, 'طُلبت معلومات من العميل: ' + p.message.trim());
    audit(ctx, 'request.info_requested', 'request', r.id, { status: 'awaiting_review' }, { status: 'info_requested' }, p.message.trim());
    return r;
  }
  function customerProvideInfo(ctx, p) {
    var r = byId(ctx.o.requests, p.requestId); if (!r) throw ActionError('الطلب غير موجود.');
    if (r.status !== 'info_requested') throw ActionError('لا توجد معلومات مطلوبة على هذا الطلب.', 'state');
    if (!p.text || p.text.trim().length < 3) throw ActionError('اكتب رد العميل.');
    var b = byId(ctx.o.bookings, r.bookingId);
    r.evidence.push({ by: 'customer', type: 'note', label: p.text.trim(), at: ctx.now });
    r.status = 'awaiting_review';
    actLog(r, ctx, 'ردّ العميل: ' + p.text.trim(), customerActor(b));
    audit(ctx, 'request.info_provided', 'request', r.id, { status: 'info_requested' }, { status: 'awaiting_review' }, p.text.trim(), customerActor(b));
    return r;
  }
  function addEvidence(ctx, p) {
    var r = byId(ctx.o.requests, p.requestId); if (!r) throw ActionError('الطلب غير موجود.');
    if (OPEN.indexOf(r.status) < 0) throw ActionError('لا يمكن إضافة إثبات لطلب مغلق.', 'state');
    if (!p.label || p.label.trim().length < 5) throw ActionError('صف الإثبات (5 أحرف على الأقل).');
    r.evidence.push({ by: 'office', type: p.kind || 'note', label: p.label.trim(), at: ctx.now });
    actLog(r, ctx, 'أُضيف إثبات من المكتب: ' + p.label.trim());
    audit(ctx, 'request.evidence_added', 'request', r.id, null, { evidence: p.label.trim() }, '');
    return r;
  }
  function waiveFee(ctx, p) {
    var r = byId(ctx.o.requests, p.requestId); if (!r) throw ActionError('الطلب غير موجود.');
    reviewable(r);
    var base = calcFor(ctx, r, { waiver: 0 });
    if (!base.ok) throw ActionError('لا يمكن حساب الرسوم: ' + base.blocked);
    var amt = p.amount;
    if (!Number.isInteger(amt) || amt < 0) throw ActionError('أدخل مبلغ إعفاء صحيحاً.');
    if (amt > base.officeFeeBeforeWaiver) throw ActionError('لا يمكن أن يتجاوز الإعفاء رسوم المكتب المحتسبة (' + E.sar(base.officeFeeBeforeWaiver) + '). لا يمكن تعديل رسوم JOKRS أو تقليل استحقاق العميل.', 'bounds');
    if (!p.reason || p.reason.trim().length < 5) throw ActionError('سبب الإعفاء مطلوب للسجل.');
    var before = { waiver: r.waiver, officeFee: base.officeFeeBeforeWaiver - (r.waiver || 0) };
    r.waiver = amt;
    actLog(r, ctx, 'إعفاء من رسوم المكتب: ' + E.sar(amt) + ' — ' + p.reason.trim());
    audit(ctx, 'fee.waived', 'request', r.id, before, { waiver: amt, officeFee: base.officeFeeBeforeWaiver - amt }, p.reason.trim());
    return r;
  }
  function proposeAlternative(ctx, p) {
    var r = byId(ctx.o.requests, p.requestId); if (!r) throw ActionError('الطلب غير موجود.');
    reviewable(r);
    if (r.type !== 'reschedule' && r.baseType !== 'reschedule') throw ActionError('اقتراح موعد بديل متاح لطلبات إعادة الجدولة.');
    var b = byId(ctx.o.bookings, r.bookingId), v = findVisit(b, r.visitIds[0]);
    if (!p.start || isNaN(Date.parse(p.start))) throw ActionError('حدد الموعد المقترح.');
    if (Date.parse(p.start) <= Date.parse(ctx.now)) throw ActionError('الموعد المقترح يجب أن يكون في المستقبل.');
    var av = E.checkAvailability(ctx.o, visitWorkerIds(v), p.start, b.durationMin, v.id);
    if (!av.ok) throw ActionError('الموعد المقترح غير متاح: ' + av.conflicts.map(function (c) { return c.text; }).join('؛ '), 'unavailable');
    r.proposals.push({ start: p.start, at: ctx.now, by: ctx.actor.name, status: 'pending', kind: 'reschedule' });
    var before = { status: r.status };
    r.status = 'proposal_sent';
    actLog(r, ctx, 'اقتُرح موعد بديل: ' + E.fmtDT(p.start) + ' (تم التحقق من التوفر). الموعد الأصلي يبقى مؤكداً.');
    audit(ctx, 'schedule.proposed', 'request', r.id, before, { status: 'proposal_sent', proposedStart: p.start }, '');
    return r;
  }
  function respondProposal(ctx, p) {
    var r = byId(ctx.o.requests, p.requestId); if (!r) throw ActionError('الطلب غير موجود.');
    if (r.status !== 'proposal_sent') throw ActionError('لا يوجد مقترح بانتظار رد العميل.', 'state');
    var b = byId(ctx.o.bookings, r.bookingId), cust = customerActor(b);
    var prop = r.proposals.filter(function (x) { return x.status === 'pending'; }).slice(-1)[0];
    if (!prop) throw ActionError('لا يوجد مقترح معلّق.');
    if (p.accept) {
      var v = findVisit(b, r.visitIds[0]);
      var wIds = prop.workerIds || visitWorkerIds(v);
      var av = E.checkAvailability(ctx.o, wIds, prop.start, b.durationMin, v.id);
      if (!av.ok) {
        prop.status = 'unavailable'; r.status = 'awaiting_review';
        actLog(r, ctx, 'لم يعد الموعد المقترح متاحاً عند الموافقة؛ أعيد الطلب للمراجعة دون تغيير الموعد الأصلي أو وقت الطلب.', { name: 'المعالجة الآلية', role: 'system' });
        return { r: r, warning: 'الموعد المقترح لم يعد متاحاً — أُعيد الطلب للمراجعة.' };
      }
      var extra = r.type === 'office_cancel' ? { remedy: 'replacement', newStart: prop.start } : { newStart: prop.start, override: true };
      var calc = calcFor(ctx, r, extra);
      if (!calc.ok) throw ActionError('تعذّر تطبيق المقترح: ' + calc.blocked);
      if (calc.effects.replacement) {
        var ws = v.workers.filter(function (w) { return w.status === 'assigned'; });
        calc.effects.replacement.workerIds = wIds;
        calc.effects.replacement.workerNames = wIds.map(function (id, i) { var wk = byId(ctx.o.workers, id); return wk ? wk.name : (ws[i] && ws[i].name); });
      }
      prop.status = 'accepted'; prop.respondedAt = ctx.now;
      r.newStart = prop.start;
      applyDecision(ctx, r, calc, 'approved', 'قبل العميل الموعد البديل', cust);
      actLog(r, ctx, 'وافق العميل على الموعد ' + E.fmtDT(prop.start) + '. حُفظ الموعد الأصلي في السجل.', cust);
      audit(ctx, 'request.proposal_accepted', 'request', r.id, { status: 'proposal_sent' }, { status: 'approved', start: prop.start }, '', cust);
      return { r: r };
    }
    prop.status = 'rejected'; prop.respondedAt = ctx.now;
    if (r.type === 'office_cancel') {
      var calc2 = calcFor(ctx, r, { remedy: 'refund' });
      if (!calc2.ok) throw ActionError(calc2.blocked);
      r.remedy = 'refund';
      applyDecision(ctx, r, calc2, 'approved', 'رفض العميل البديل واختار الاسترداد', cust);
      actLog(r, ctx, 'رفض العميل الموعد البديل واختار الاسترداد الكامل دون رسوم.', cust);
      audit(ctx, 'request.proposal_rejected', 'request', r.id, { status: 'proposal_sent' }, { status: 'approved', remedy: 'refund', refund: calc2.totalRefund }, '', cust);
    } else {
      r.status = 'awaiting_review';
      actLog(r, ctx, 'رفض العميل المقترح. بقي وقت الطلب الأصلي (' + E.fmtDTs(r.requestedAt) + ') دون تغيير، ولم تتأثر شريحة الإلغاء.', cust);
      audit(ctx, 'request.proposal_rejected', 'request', r.id, { status: 'proposal_sent' }, { status: 'awaiting_review' }, '', cust);
    }
    return { r: r };
  }

  /* ------------------------------------------------------------------ */
  /* Refund operations                                                   */
  /* ------------------------------------------------------------------ */
  function getRefund(ctx, id) { var rf = byId(ctx.o.refunds, id); if (!rf) throw ActionError('عملية الاسترداد غير موجودة.'); return rf; }
  function refundApprove(ctx, p) {
    var rf = getRefund(ctx, p.refundId);
    if (rf.state !== 'awaiting_review') throw ActionError('الاسترداد ليس بانتظار المراجعة (الحالة: ' + E.L.refundState[rf.state] + ').', 'state');
    rf.state = 'approved'; rf.timeline.push({ state: 'approved', at: ctx.now, by: ctx.actor.name });
    audit(ctx, 'refund.approved', 'refund', rf.id, { state: 'awaiting_review' }, { state: 'approved' }, rf.requestRef);
    return rf;
  }
  function startAttempt(ctx, rf) {
    rf.attempts.push({ id: 'ATT-' + (rf.attempts.length + 1), at: ctx.now, status: 'pending', providerRef: null, reason: null });
    var att = rf.attempts[rf.attempts.length - 1];
    rf.state = 'processing'; rf.timeline.push({ state: 'processing', at: ctx.now, by: ctx.actor.name, attempt: att.id });
    var needsProvider = rf.destinations.some(function (d) { return d.action === 'refund_capture'; });
    if (ctx.state.demo.providerOutage && needsProvider) {
      att.status = 'failed'; att.reason = 'انتهت مهلة الاتصال بمزوّد الدفع (عطل محاكى مفعّل من أدوات العرض)';
      rf.state = 'failed'; rf.failureReason = att.reason; rf.timeline.push({ state: 'failed', at: ctx.now, by: 'مزوّد الدفع (محاكاة)', attempt: att.id });
      audit(ctx, 'refund.failed', 'refund', rf.id, { state: 'processing' }, { state: 'failed', reason: att.reason, attempt: att.id }, rf.requestRef, { name: 'مزوّد الدفع (محاكاة)', role: 'system' });
      return att;
    }
    if (!needsProvider) {
      att.status = 'succeeded'; att.providerRef = 'INT-' + rf.id + '-' + att.id;
      completeRefund(ctx, rf, att);
    }
    return att;
  }
  function refundProcess(ctx, p) {
    var rf = getRefund(ctx, p.refundId);
    if (rf.state !== 'approved') throw ActionError('يمكن بدء التنفيذ لاسترداد معتمد فقط (الحالة الحالية: ' + E.L.refundState[rf.state] + ').', 'state');
    var att = startAttempt(ctx, rf);
    audit(ctx, 'refund.started', 'refund', rf.id, { state: 'approved' }, { state: rf.state, attempt: att.id, operationId: rf.opId }, rf.requestRef);
    return rf;
  }
  function refundRetry(ctx, p) {
    var rf = getRefund(ctx, p.refundId);
    if (rf.state !== 'failed') throw ActionError('إعادة المحاولة متاحة للعمليات الفاشلة فقط.', 'state');
    var att = startAttempt(ctx, rf);
    audit(ctx, 'refund.retried', 'refund', rf.id, { state: 'failed' }, { state: rf.state, attempt: att.id, operationId: rf.opId + ' (نفس معرّف العملية — لا ازدواج)' }, rf.requestRef);
    return rf;
  }
  /** Simulated provider callback. Idempotent: repeated callbacks have no financial effect. */
  function providerCallback(ctx, p) {
    var rf = getRefund(ctx, p.refundId);
    var prov = { name: 'مزوّد الدفع (محاكاة)', role: 'system' };
    var att = rf.attempts.filter(function (a) { return a.id === p.attemptId; })[0] || rf.attempts[rf.attempts.length - 1];
    if (!att || att.status !== 'pending' || rf.state === 'completed') {
      audit(ctx, 'refund.duplicate_callback_ignored', 'refund', rf.id, null, { state: rf.state, attempt: att ? att.id : null }, 'إشعار مكرر من المزوّد — لا أثر مالي', prov);
      return { duplicate: true, rf: rf };
    }
    if (p.result === 'success') {
      att.status = 'succeeded'; att.providerRef = 'SIM-PSP-' + rf.id.replace(/\D/g, '') + '-' + att.id.replace(/\D/g, '');
      completeRefund(ctx, rf, att);
    } else {
      att.status = 'failed'; att.reason = p.reason || 'رفض البنك المصدر العملية (محاكاة)';
      rf.state = 'failed'; rf.failureReason = att.reason; rf.timeline.push({ state: 'failed', at: ctx.now, by: prov.name, attempt: att.id });
      audit(ctx, 'refund.failed', 'refund', rf.id, { state: 'processing' }, { state: 'failed', reason: att.reason, attempt: att.id }, rf.requestRef, prov);
    }
    return { duplicate: false, rf: rf };
  }

  /* ------------------------------------------------------------------ */
  /* Policies & assignments                                              */
  /* ------------------------------------------------------------------ */
  function getPolicy(ctx, id) { var p = byId(ctx.o.policies, id); if (!p) throw ActionError('السياسة غير موجودة في هذا المكتب.'); return p; }
  function getVersion(p, n) { var v = p.versions.filter(function (x) { return x.version === n; })[0]; if (!v) throw ActionError('النسخة غير موجودة.'); return v; }
  function versionMeta(v) { return { name: v.name, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, rules: v.rules }; }
  function nextHour(now) { var t = Date.parse(now); return new Date(Math.ceil((t + 1) / E.HOUR) * E.HOUR).toISOString(); }

  function createPolicy(ctx, p) {
    var o = ctx.o;
    if (!p.name || p.name.trim().length < 3) throw ActionError('اسم السياسة مطلوب (3 أحرف على الأقل).');
    if (!E.L.bookingType[p.bookingType]) throw ActionError('اختر نوع الحجز.');
    o.seq.policy = (o.seq.policy || 0) + 1;
    var id = 'P-' + o.office.code + '-' + pad(o.seq.policy, 2);
    var pol = { id: id, officeId: o.office.id, name: p.name.trim(), bookingType: p.bookingType, archived: false, archivedAt: null, createdAt: ctx.now,
      versions: [{ version: 1, status: 'draft', name: p.name.trim(), description: p.description || '', customerTextEn: '', effectiveFrom: p.effectiveFrom || nextHour(ctx.now), effectiveTo: null,
        rules: p.rules ? E.clone(p.rules) : E.defaultRules(p.bookingType), createdAt: ctx.now, createdBy: ctx.actor.name, submittedAt: null, publishedAt: null, platformApproved: false, reviewNote: '' }] };
    o.policies.push(pol);
    audit(ctx, 'policy.created', 'policy', id, null, { name: pol.name, bookingType: p.bookingType, version: 1, status: 'draft' }, '');
    return pol;
  }
  function duplicatePolicy(ctx, p) {
    var src = getPolicy(ctx, p.policyId);
    var latest = src.versions[src.versions.length - 1];
    var pol = createPolicy(ctx, { name: 'نسخة من ' + src.name, bookingType: src.bookingType, description: 'مكررة من ' + src.id + ' v' + latest.version, rules: latest.rules });
    audit(ctx, 'policy.duplicated', 'policy', pol.id, null, { from: src.id + ' v' + latest.version }, '');
    return pol;
  }
  function saveDraft(ctx, p) {
    var pol = getPolicy(ctx, p.policyId);
    if (pol.archived) throw ActionError('السياسة مؤرشفة ولا يمكن تعديلها.');
    var v = getVersion(pol, p.version);
    if (['draft', 'rejected'].indexOf(v.status) < 0) throw ActionError('النسخة ' + v.version + ' (' + E.L.versionStatus[v.status] + ') غير قابلة للتعديل. النسخ المنشورة ثابتة؛ أنشئ نسخة جديدة.', 'immutable');
    var before = { name: v.name, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, rules: v.rules };
    var m = p.meta || {};
    if (m.bookingType && m.bookingType !== pol.bookingType) {
      if (!E.L.bookingType[m.bookingType]) throw ActionError('نوع حجز غير معروف.');
      if (pol.versions.some(function (x) { return x.status === 'published'; }) || ctx.o.assignments.some(function (a) { return a.policyId === pol.id; }) || ctx.o.bookings.some(function (b) { return b.policySnapshot.policyId === pol.id; }))
        throw ActionError('لا يمكن تغيير نوع الحجز لسياسة لها نسخ منشورة أو ربط أو حجوزات؛ كرر السياسة بدلاً من ذلك.', 'immutable');
      pol.bookingType = m.bookingType;
    }
    ['name', 'description', 'customerTextEn', 'effectiveFrom', 'effectiveTo', 'targets'].forEach(function (k) { if (m[k] !== undefined) v[k] = E.clone(m[k]); });
    if (p.rules) v.rules = E.clone(p.rules);
    var wasRejected = v.status === 'rejected';
    v.status = 'draft';
    if (pol.versions.length === 1 || !pol.versions.some(function (x) { return x.status === 'published'; })) pol.name = v.name;
    var changes = E.diffVersions(pol.bookingType, before, versionMeta(v)).filter(function (d) { return d.changed; }).map(function (d) { return d.label + ': ' + d.a + ' ← ' + d.b; });
    if (before.name !== v.name) changes.unshift('الاسم: ' + before.name + ' ← ' + v.name);
    audit(ctx, 'policy.edited', 'policy', pol.id, { version: v.version, status: wasRejected ? 'rejected' : 'draft' }, { version: v.version, changes: changes.length ? changes : ['لا تغييرات جوهرية'] }, '');
    return v;
  }
  function newVersion(ctx, p) {
    var pol = getPolicy(ctx, p.policyId);
    if (pol.archived) throw ActionError('لا يمكن إنشاء نسخة لسياسة مؤرشفة.');
    var open = pol.versions.filter(function (x) { return ['draft', 'pending_review', 'rejected'].indexOf(x.status) >= 0; })[0];
    if (open) throw ActionError('توجد نسخة غير منشورة (v' + open.version + ' — ' + E.L.versionStatus[open.status] + '). أكمل تحريرها أو انتظر قرار المنصة.', 'open_version');
    var pubs = pol.versions.filter(function (x) { return x.status === 'published'; });
    var base = pubs[pubs.length - 1] || pol.versions[pol.versions.length - 1];
    var n = Math.max.apply(null, pol.versions.map(function (x) { return x.version; })) + 1;
    var v = { version: n, status: 'draft', name: base.name, description: base.description, customerTextEn: base.customerTextEn || '', effectiveFrom: nextHour(ctx.now), effectiveTo: null,
      rules: E.clone(base.rules), createdAt: ctx.now, createdBy: ctx.actor.name, submittedAt: null, publishedAt: null, platformApproved: false, reviewNote: '', basedOn: base.version };
    pol.versions.push(v);
    audit(ctx, 'policy.version_created', 'policy', pol.id, null, { version: n, basedOn: base.version, status: 'draft' }, 'تعديل سياسة منشورة يُنشئ نسخة جديدة؛ النسخة ' + base.version + ' لم تتغير');
    return v;
  }
  function submitVersion(ctx, p) {
    var pol = getPolicy(ctx, p.policyId);
    if (pol.archived) throw ActionError('السياسة مؤرشفة.');
    var v = getVersion(pol, p.version);
    if (v.status !== 'draft') throw ActionError('يمكن إرسال المسودات فقط (الحالة: ' + E.L.versionStatus[v.status] + ').', 'state');
    var val = E.validatePolicy({ name: v.name, bookingType: pol.bookingType, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo }, v.rules, ctx.platform, { forPublish: true, now: ctx.now });
    if (val.errors.length) throw ActionError('لا يمكن الإرسال: توجد ' + val.errors.length + ' مشكلات تحقق.', 'validation', val.errors);
    v.submittedAt = ctx.now;
    if (val.restricted.length || !ctx.platform.allowDirectPublish) {
      v.status = 'pending_review';
      audit(ctx, 'policy.submitted', 'policy', pol.id, { version: v.version, status: 'draft' }, { version: v.version, status: 'pending_review', reasons: val.restricted.length ? val.restricted : ['إعدادات المنصة تتطلب المراجعة لكل النسخ'] }, 'بانتظار اعتماد المنصة — لا يمكن للمكتب اعتماد قواعده المقيدة بنفسه');
      return { status: 'pending_review', reasons: val.restricted };
    }
    v.status = 'published'; v.publishedAt = ctx.now;
    pol.name = v.name;
    audit(ctx, 'policy.published', 'policy', pol.id, { version: v.version, status: 'draft' }, { version: v.version, status: 'published', effectiveFrom: v.effectiveFrom }, 'نشر مباشر — قواعد اعتيادية');
    return { status: 'published' };
  }
  function platformDecide(ctx, p) {
    var o = ctx.state.offices[p.officeId];
    var c2 = mkCtx(ctx.state, p.officeId, 'platform', ctx.now);
    var pol = byId(o.policies, p.policyId); if (!pol) throw ActionError('السياسة غير موجودة.');
    var v = getVersion(pol, p.version);
    if (v.status !== 'pending_review') throw ActionError('النسخة ليست بانتظار المراجعة.', 'state');
    if (p.decision === 'approve') {
      if (Date.parse(v.effectiveFrom) < Date.parse(ctx.now) - E.MIN) throw ActionError('تاريخ سريان النسخة (' + E.fmtDTs(v.effectiveFrom) + ') انقضى؛ اطلب من المكتب تعديله (رفض مع ملاحظة).', 'validation');
      v.status = 'published'; v.publishedAt = ctx.now; v.platformApproved = true; v.reviewNote = p.note || '';
      pol.name = v.name;
      audit(c2, 'policy.published', 'policy', pol.id, { version: v.version, status: 'pending_review' }, { version: v.version, status: 'published', platformApproved: true }, 'اعتماد المنصة (محاكاة)' + (p.note ? ': ' + p.note : ''));
    } else {
      if (!p.note || p.note.trim().length < 5) throw ActionError('ملاحظة التعديلات المطلوبة إلزامية.');
      v.status = 'rejected'; v.reviewNote = p.note.trim();
      audit(c2, 'policy.changes_requested', 'policy', pol.id, { version: v.version, status: 'pending_review' }, { version: v.version, status: 'rejected' }, p.note.trim());
    }
    return v;
  }
  function uncovered(o, now) {
    var out = [];
    o.services.forEach(function (s) { s.packages.forEach(function (pk) { if (pk.salesEnabled && !E.resolvePolicy(o, pk.id, now).policy) out.push(pk); }); });
    return out;
  }
  function assignmentTargetLabel(o, level, targetId) {
    if (level === 'office_default') return 'افتراضي المكتب';
    if (level === 'service') { var s = byId(o.services, targetId); return s ? 'خدمة: ' + s.name : targetId; }
    var f = E.findPackage(o, targetId); return f ? 'باقة: ' + f.pkg.name : targetId;
  }
  function setAssignment(ctx, p) {
    var o = ctx.o, level = p.level, target = level === 'office_default' ? null : p.targetId;
    var beforeUncovered = uncovered(o, ctx.now).map(function (x) { return x.id; });
    var existing = o.assignments.filter(function (a) { return a.level === level && (a.targetId || null) === target; });
    if (existing.length > 1) throw ActionError('تعارض بيانات: أكثر من تخصيص بنفس المستوى. يجب حل التعارض.');
    var ex = existing[0] || null;
    var beforeName = ex ? (byId(o.policies, ex.policyId) || {}).name : null;
    if (p.policyId) {
      var pol = getPolicy(ctx, p.policyId);
      if (pol.archived) throw ActionError('لا يمكن ربط سياسة مؤرشفة.');
      var hasPub = pol.versions.some(function (v) { return v.status === 'published'; });
      if (!hasPub) throw ActionError('السياسة ليس لها نسخة منشورة بعد.');
      if (level === 'package') {
        var f = E.findPackage(o, target);
        if (!f) throw ActionError('الباقة غير موجودة.');
        if (f.pkg.bookingType !== pol.bookingType) throw ActionError('نوع السياسة (' + E.L.bookingType[pol.bookingType] + ') لا يطابق نوع الباقة (' + E.L.bookingType[f.pkg.bookingType] + ').', 'type');
      }
      if (level === 'service') {
        var s = byId(o.services, target);
        if (!s) throw ActionError('الخدمة غير موجودة.');
        if (!s.packages.some(function (pk) { return pk.bookingType === pol.bookingType; })) throw ActionError('لا توجد في هذه الخدمة باقة من نوع ' + E.L.bookingType[pol.bookingType] + '.', 'type');
      }
      if (ex && ex.policyId === pol.id) throw ActionError('هذه السياسة مرتبطة بالفعل بنفس المستوى.');
      if (ex) { ex.policyId = pol.id; ex.changedAt = ctx.now; ex.changedBy = ctx.actor.name; }
      else o.assignments.push({ id: 'AS-' + o.office.code + '-' + (o.assignments.length + 1) + '-' + Date.parse(ctx.now) % 100000, level: level, targetId: target, policyId: pol.id, createdAt: ctx.now, changedAt: ctx.now, changedBy: ctx.actor.name });
    } else {
      if (!ex) throw ActionError('لا يوجد تخصيص لإزالته.');
      o.assignments.splice(o.assignments.indexOf(ex), 1);
    }
    var nowUncovered = uncovered(o, ctx.now).filter(function (pk) { return beforeUncovered.indexOf(pk.id) < 0; });
    if (nowUncovered.length) {
      if (!p.disableSalesIfUncovered) throw ActionError('هذا التغيير سيترك ' + nowUncovered.map(function (x) { return '"' + x.name + '"'; }).join('، ') + ' دون سياسة صالحة وهي معروضة للبيع. اختر سياسة بديلة أو فعّل خيار إيقاف البيع.', 'coverage', nowUncovered.map(function (x) { return x.id; }));
      nowUncovered.forEach(function (pk) { pk.salesEnabled = false; audit(ctx, 'sales.disabled', 'package', pk.id, { salesEnabled: true }, { salesEnabled: false }, 'لا توجد سياسة صالحة بعد تغيير الربط'); });
    }
    audit(ctx, 'assignment.changed', 'assignment', assignmentTargetLabel(o, level, target), { policy: beforeName }, { policy: p.policyId ? byId(o.policies, p.policyId).name : null }, 'يؤثر على الحجوزات الجديدة فقط؛ الحجوزات الحالية تحتفظ بلقطتها');
    return true;
  }
  function setSales(ctx, p) {
    var f = E.findPackage(ctx.o, p.packageId); if (!f) throw ActionError('الباقة غير موجودة.');
    if (p.enabled && !E.resolvePolicy(ctx.o, f.pkg.id, ctx.now).policy) throw ActionError('لا يمكن تفعيل البيع: لا توجد سياسة صالحة لهذه الباقة. اربط سياسة أولاً.', 'coverage');
    var before = f.pkg.salesEnabled;
    f.pkg.salesEnabled = !!p.enabled;
    audit(ctx, p.enabled ? 'sales.enabled' : 'sales.disabled', 'package', f.pkg.id, { salesEnabled: before }, { salesEnabled: !!p.enabled }, f.pkg.name);
    return true;
  }
  function archivePolicy(ctx, p) {
    var o = ctx.o, pol = getPolicy(ctx, p.policyId);
    if (pol.archived) throw ActionError('السياسة مؤرشفة مسبقاً.');
    var refs = o.assignments.filter(function (a) { return a.policyId === pol.id; });
    var beforeUncovered = uncovered(o, ctx.now).map(function (x) { return x.id; });
    if (refs.length) {
      if (p.replacementPolicyId) {
        var rp = getPolicy(ctx, p.replacementPolicyId);
        if (rp.id === pol.id || rp.archived) throw ActionError('اختر سياسة بديلة صالحة.');
        if (rp.bookingType !== pol.bookingType) throw ActionError('السياسة البديلة يجب أن تكون لنفس نوع الحجز.');
        if (!E.effectiveVersion(rp, ctx.now)) throw ActionError('السياسة البديلة ليس لها نسخة منشورة سارية الآن.');
        refs.forEach(function (a) {
          a.policyId = rp.id; a.changedAt = ctx.now; a.changedBy = ctx.actor.name;
          audit(ctx, 'assignment.changed', 'assignment', assignmentTargetLabel(o, a.level, a.targetId), { policy: pol.name }, { policy: rp.name }, 'استبدال بسبب أرشفة السياسة');
        });
      } else if (p.disableSales) {
        refs.forEach(function (a) { o.assignments.splice(o.assignments.indexOf(a), 1); audit(ctx, 'assignment.changed', 'assignment', assignmentTargetLabel(o, a.level, a.targetId), { policy: pol.name }, { policy: null }, 'إزالة بسبب الأرشفة'); });
      } else throw ActionError('السياسة مرتبطة بـ ' + refs.length + ' تخصيص. اختر سياسة بديلة أو أوقف البيع للخدمات المتأثرة.', 'coverage');
    }
    pol.archived = true; pol.archivedAt = ctx.now;
    var nowUnc = uncovered(o, ctx.now).filter(function (pk) { return beforeUncovered.indexOf(pk.id) < 0; });
    if (nowUnc.length) {
      if (!p.disableSales) throw ActionError('الأرشفة ستترك ' + nowUnc.map(function (x) { return x.name; }).join('، ') + ' دون سياسة صالحة.', 'coverage');
      nowUnc.forEach(function (pk) { pk.salesEnabled = false; audit(ctx, 'sales.disabled', 'package', pk.id, { salesEnabled: true }, { salesEnabled: false }, 'أرشفة السياسة ' + pol.name); });
    }
    audit(ctx, 'policy.archived', 'policy', pol.id, { archived: false }, { archived: true, replacement: p.replacementPolicyId || null, salesDisabled: nowUnc.map(function (x) { return x.name; }) }, p.reason || 'السجل والنسخ محفوظة');
    return pol;
  }

  /* ------------------------------------------------------------------ */
  /* Checkout (embedded customer preview)                                */
  /* ------------------------------------------------------------------ */
  function checkoutStart(ctx, p) {
    var f = E.findPackage(ctx.o, p.packageId); if (!f) throw ActionError('اختر الخدمة/الباقة.');
    if (!p.start || isNaN(Date.parse(p.start))) throw ActionError('حدد موعد أول زيارة.');
    ctx.o.checkout = { packageId: p.packageId, customerId: p.customerId, start: p.start, workerCount: p.workerCount || null, accepted: false, acceptedKey: null, acceptedAt: null, startedAt: ctx.now, result: null };
    return ctx.o.checkout;
  }
  function checkoutAccept(ctx, p) {
    var s = ctx.o.checkout; if (!s) throw ActionError('لا توجد جلسة دفع.');
    var q = quote(ctx.o, ctx.platform, s, ctx.now);
    if (p.checked) {
      if (!q.key) throw ActionError('لا توجد سياسة صالحة للموافقة عليها.');
      s.accepted = true; s.acceptedKey = q.key; s.acceptedAt = ctx.now;
    } else { s.accepted = false; s.acceptedKey = null; s.acceptedAt = null; }
    return s;
  }
  function checkoutConfirm(ctx) {
    var o = ctx.o, s = o.checkout; if (!s) throw ActionError('لا توجد جلسة دفع.');
    var q = quote(o, ctx.platform, s, ctx.now);
    if (!q.pkg.salesEnabled) throw ActionError('البيع متوقف لهذه الباقة: لا توجد سياسة صالحة مرتبطة.', 'sales');
    if (!q.resolved.policy) throw ActionError('لا توجد سياسة إلغاء صالحة لهذه الباقة؛ لا يمكن إتمام الدفع.', 'coverage');
    if (!s.accepted || !s.acceptedKey) throw ActionError('يجب الموافقة على سياسة الإلغاء والاسترداد قبل الدفع.', 'acceptance_required');
    if (s.acceptedKey !== q.key) throw ActionError('تغيّرت السياسة أو شروط المنصة منذ موافقتك (المقبول: ' + s.acceptedKey + ' — الحالي: ' + q.key + '). راجع الشروط المحدثة ووافق عليها من جديد.', 'terms_changed');
    if (Date.parse(s.start) <= Date.parse(ctx.now)) throw ActionError('موعد الزيارة الأولى يجب أن يكون في المستقبل.');
    var cust = byId(o.customers, s.customerId);
    var ref = nextRef(o, 'booking', 'BK', 1000);
    var spec = { ref: ref, customer: cust, packageId: q.pkg.id, createdAt: ctx.now, confirmedAt: ctx.now, workerCount: q.workers, workerIds: o.workers.slice(0, q.workers).map(function (w) { return w.id; }),
      policyId: q.resolved.policy.id, version: q.resolved.version.version, payments: [{ method: 'card', state: 'captured' }] };
    if (q.pkg.bookingType === 'credits') { spec.credits = { count: q.pkg.visits, expiresAt: E.addDays(ctx.now, q.pkg.validityDays || 90, 'calendar') }; spec.visits = []; }
    else spec.visits = q.plan.map(function (x) { return { start: x.start }; });
    var b = buildBooking(o, ctx.platform, spec);
    o.bookings.push(b);
    var cActor = { name: cust.name, role: 'customer' };
    audit(ctx, 'customer.accepted_policy', 'booking', b.id, null, { customerId: cust.id, bookingId: b.id, policy: b.acceptance.policyId, version: b.acceptance.version, platformTerms: b.acceptance.platformTermsVersion, feeRules: b.acceptance.feeRuleVersion, lang: 'ar', at: ctx.now, acceptedAt: s.acceptedAt }, 'لقطة نص السياسة محفوظة مع الحجز', cActor);
    audit(ctx, 'booking.created', 'booking', b.id, null, { package: b.packageName, total: b.price.total, visits: b.visits.length }, 'دفع محاكى — لا معاملة حقيقية', cActor);
    s.result = { bookingId: b.id, ref: b.ref };
    s.accepted = false; s.acceptedKey = null;
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* Demo-only actions (separate toolbar)                                */
  /* ------------------------------------------------------------------ */
  function costingChange(ctx, p) {
    var o = ctx.o, pct = p.pct || 10;
    o.services.forEach(function (s) { s.packages.forEach(function (pk) {
      var c = pk.costing;
      if (c.hourly) c.hourly = Math.round(c.hourly * (100 + pct) / 100);
      if (c.price) c.price = Math.round(c.price * (100 + pct) / 100);
    }); });
    var before = o.costing.version;
    o.costing.version = 'تكلفة ' + ctx.now.slice(0, 10) + ' (+' + pct + '%)';
    audit(ctx, 'costing.prices_changed', 'costing', 'catalog', { version: before }, { version: o.costing.version }, 'محاكاة تغيير أسعار وحدة التكلفة — الحجوزات المؤكدة تحتفظ بأسعارها', { name: 'وحدة التكلفة (محاكاة)', role: 'system' });
  }

  /* ------------------------------------------------------------------ */
  /* Dispatch                                                            */
  /* ------------------------------------------------------------------ */
  var ACTIONS = {
    createPolicy: { perm: 'policy.manage', run: createPolicy },
    duplicatePolicy: { perm: 'policy.manage', run: duplicatePolicy },
    saveDraft: { perm: 'policy.manage', run: saveDraft },
    newVersion: { perm: 'policy.manage', run: newVersion },
    submitVersion: { perm: 'policy.manage', run: submitVersion },
    archivePolicy: { perm: 'policy.manage', run: archivePolicy },
    setAssignment: { perm: 'assignment.manage', run: setAssignment },
    setSales: { perm: 'assignment.manage', run: setSales },
    submitCustomerRequest: { perm: 'customer.simulate', run: function (ctx, p) { return submitRequest(ctx, Object.assign({}, p, { initiator: 'customer', cause: p.cause || 'customer' })); } },
    submitOfficeAction: { perm: 'request.office', run: function (ctx, p) { return submitRequest(ctx, Object.assign({}, p, { initiator: 'office', cause: p.cause || 'office' })); } },
    approveRequest: { perm: 'request.review', run: approveRequest },
    rejectRequest: { perm: 'request.review', run: rejectRequest },
    requestInfo: { perm: 'request.review', run: requestInfo },
    addEvidence: { perm: 'request.review', run: addEvidence },
    proposeAlternative: { perm: 'request.review', run: proposeAlternative },
    waiveFee: { perm: 'request.waive', run: waiveFee },
    customerProvideInfo: { perm: 'customer.simulate', run: customerProvideInfo },
    respondProposal: { perm: 'customer.simulate', run: respondProposal },
    refundApprove: { perm: 'refund.finance', run: refundApprove },
    refundProcess: { perm: 'refund.finance', run: refundProcess },
    refundRetry: { perm: 'refund.finance', run: refundRetry },
    checkoutStart: { perm: 'customer.simulate', run: checkoutStart },
    checkoutAccept: { perm: 'customer.simulate', run: checkoutAccept },
    checkoutConfirm: { perm: 'customer.simulate', run: checkoutConfirm },
    // demo toolbar / simulated external systems (not office workflow actions)
    providerCallback: { demo: true, run: providerCallback },
    platformDecide: { demo: true, run: platformDecide },
    costingChange: { demo: true, run: costingChange },
    setDemo: { demo: true, run: function (ctx, p) {
      var d = ctx.state.demo;
      if (p.officeId) { if (!ctx.state.offices[p.officeId]) throw ActionError('مكتب غير معروف.'); d.officeId = p.officeId; }
      if (p.role) { if (!E.L.role[p.role] || ['customer', 'platform', 'system'].indexOf(p.role) >= 0) throw ActionError('دور غير معروف.'); d.role = p.role; }
      if (p.now) { if (isNaN(Date.parse(p.now))) throw ActionError('وقت غير صالح.'); d.now = new Date(Date.parse(p.now)).toISOString(); }
      if (p.providerOutage !== undefined) d.providerOutage = !!p.providerOutage;
    } },
    setPlatform: { demo: true, run: function (ctx, p) {
      var pl = ctx.state.platform, before = E.clone(pl.rules);
      Object.keys(p.rules || {}).forEach(function (k) { pl.rules[k] = p.rules[k]; });
      if (p.allowDirectPublish !== undefined) pl.allowDirectPublish = !!p.allowDirectPublish;
      Object.keys(ctx.state.offices).forEach(function (k) {
        audit(mkCtx(ctx.state, k, 'platform', ctx.now), 'platform.rules_changed', 'platform', pl.version, before, pl.rules, 'تعديل بيانات المنصة التجريبية من أدوات العرض');
      });
    } }
  };

  function dispatch(name, args) {
    var def = ACTIONS[name];
    if (!def) throw ActionError('إجراء غير معروف: ' + name);
    var st = Store.state;
    var ctx = mkCtx(st, st.demo.officeId, st.demo.role, st.demo.now);
    if (def.perm) requirePerm(st.demo.role, def.perm);
    var backup = JSON.stringify(st);
    try {
      var res = def.run(ctx, args || {});
      save(); emit();
      return res;
    } catch (e) {
      Store.state = JSON.parse(backup); // atomic: a failed action leaves no partial changes
      throw e;
    }
  }
  function reset() { Store.state = JK.buildSeed(); save(); emit(); }

  /** Run an action as a specific actor context (customer app / JOKRS dashboard),
   *  without touching the office portal's selected office or role. */
  function dispatchAs(name, args, as) {
    var def = ACTIONS[name];
    if (!def) throw ActionError('إجراء غير معروف: ' + name);
    var st = Store.state, officeId = (as && as.officeId) || st.demo.officeId, role = (as && as.role) || st.demo.role;
    if (!st.offices[officeId]) throw ActionError('مكتب غير معروف.');
    var ctx = mkCtx(st, officeId, role, st.demo.now);
    if (as && as.actor) ctx.actor = as.actor;
    if (def.perm) requirePerm(role, def.perm);
    else if (role === 'customer') throw ActionError('هذا الإجراء غير متاح من تطبيق العميل.', 'forbidden');
    var backup = JSON.stringify(st);
    try {
      var res = def.run(ctx, args || {});
      save(); emit();
      return res;
    } catch (e) {
      Store.state = JSON.parse(backup);
      throw e;
    }
  }
  /** Re-read state written by another window/tab of the simulation. */
  function reloadFromStorage() {
    var raw = sGet();
    if (!raw) return false;
    try { var s = JSON.parse(raw); if (validState(s)) { Store.state = s; emit(); return true; } } catch (e) { /* ignore */ }
    return false;
  }

  Object.assign(Store, {
    init: init, save: save, dispatch: dispatch, dispatchAs: dispatchAs, reloadFromStorage: reloadFromStorage, reset: reset, can: function (perm) { return can(Store.state.demo.role, perm); },
    office: function () { return Store.state.offices[Store.state.demo.officeId]; },
    subscribe: function (f) { Store.listeners.push(f); }, PERM_LABEL: PERM_LABEL, KEY: KEY
  });
  JK.Store = Store;
  JK.store = { can: can, PERMS: PERMS, ActionError: ActionError, mkCtx: mkCtx, quote: quote, buildBooking: buildBooking, snapshotOf: snapshotOf, audit: audit,
    ops: { createPolicy: createPolicy, saveDraft: saveDraft, newVersion: newVersion, submitVersion: submitVersion, platformDecide: platformDecide, archivePolicy: archivePolicy,
      setAssignment: setAssignment, submitRequest: submitRequest, approveRequest: approveRequest, rejectRequest: rejectRequest, requestInfo: requestInfo, addEvidence: addEvidence,
      waiveFee: waiveFee, proposeAlternative: proposeAlternative, respondProposal: respondProposal, customerProvideInfo: customerProvideInfo,
      refundApprove: refundApprove, refundProcess: refundProcess, refundRetry: refundRetry, providerCallback: providerCallback,
      checkoutStart: checkoutStart, checkoutAccept: checkoutAccept, checkoutConfirm: checkoutConfirm },
    ACTIONS: ACTIONS, uncovered: uncovered, byId: byId, SCHEMA: SCHEMA, validState: validState, nextRef: nextRef, ledgerAdd: ledgerAdd, completeRefund: completeRefund, applyEffects: applyEffects };
})(typeof window !== 'undefined' ? window : globalThis);

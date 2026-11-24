/* =====================================================================
   seed.js — fictional demo data for three offices.
   All offices, people, policies and numbers are fictional. Demo rules
   are NOT Saudi legal requirements. Platform guardrails are editable
   demo fixtures whose legal status is unverified.
   Histories (approved/rejected requests, refunds) are produced by
   running the real store operations at past timestamps so every record
   is internally consistent.
   ===================================================================== */
(function (G) {
  'use strict';
  var JK = G.JK;

  function T(s) { return JK.riyadhISO(s); }
  function merge(t, s) {
    Object.keys(s).forEach(function (k) {
      if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], s[k]);
      else t[k] = s[k];
    });
    return t;
  }
  function rules(type, patch) { return merge(JK.defaultRules(type), patch || {}); }
  function band(min, max, fee) { return { id: 'b' + min + '_' + max, minHours: min, maxHours: max, fee: fee }; }
  var NONE = { type: 'none' };
  function pct(p, base, cap) { return { type: 'percent', pct: p, base: base || 'affected_allocation', cap: cap || 0 }; }
  function perVisit(h) { return { type: 'fixed_per_visit', amount: h, cap: 0 }; }
  function fixed(h) { return { type: 'fixed', amount: h, cap: 0 }; }
  function ver(n, status, name, eff, r, o) {
    o = o || {};
    return { version: n, status: status, name: name, description: o.description || '', customerTextEn: o.en || '', effectiveFrom: eff, effectiveTo: o.effectiveTo || null, rules: r,
      createdAt: o.createdAt || eff, createdBy: o.createdBy || '', submittedAt: o.submittedAt || (status !== 'draft' ? (o.createdAt || eff) : null),
      publishedAt: status === 'published' ? (o.publishedAt || eff) : null, platformApproved: !!o.approved, reviewNote: o.reviewNote || '', basedOn: o.basedOn || null };
  }
  function people(prefix, names) { return names.map(function (n, i) { return { id: prefix + (i + 1), name: n }; }); }

  /* ------------------------------ Platform (demo fixture) ------------------------------ */
  function platformFixture() {
    return {
      version: 'P-2026.4', termsVersion: 'شروط المنصة T-2026.2', feeRuleVersion: 'رسوم JOKRS ‏F-3',
      legalStatus: 'بيانات عرض قابلة للتعديل — الوضع القانوني غير متحقق ولا تمثل متطلبات نظامية',
      allowDirectPublish: true,
      rules: {
        maxVisitFeePct: 50, maxPackageFeePct: 60, allowConsumeEntitlement: true, minGraceMinutes: 0, minGraceLeadHours: 0,
        reviewRequiredFor: { consume: true, visitFeePctAbove: 40, packageFeePctAbove: 25 }
      },
      jokrsFee: { amount: 1500, officeFault: 'refund', customerCancelWithinGrace: 'refund', pendingAcceptance: 'refund', customerCancel: 'retain' }
    };
  }

  /* ------------------------------ Office A ------------------------------ */
  function officeA() {
    var r1 = rules('single', {
      cancel: { bands: [band(24, null, NONE), band(0, 24, pct(50))] },
      reschedule: { minNoticeHours: 24, maxPerVisit: 1, sizeLimits: [{ upToVisits: null, maxChanges: 1 }], freeChanges: 1, latestReplacementDays: 14 },
      refund: { processingDays: 7, allowWallet: false, reviewTargetHours: 24 }
    });
    var r2 = rules('single', {
      cancel: { allowPartialWorkers: true, grace: { enabled: true, minutes: 15, minLeadHours: 6 }, bands: [band(12, null, NONE), band(3, 12, pct(25)), band(0, 3, pct(50))] },
      reschedule: { minNoticeHours: 12, maxPerVisit: 1, sizeLimits: [{ upToVisits: null, maxChanges: 1 }], freeChanges: 1, latestReplacementDays: 14 },
      refund: { processingDays: 5, allowWallet: true, reviewTargetHours: 12 }
    });
    var r3 = JK.clone(r2);
    r3.cancel.bands = [band(12, null, NONE), band(3, 12, perVisit(4000)), band(0, 3, pct(50))];
    r3.refund.extraText = 'يرجى إبلاغنا عبر التطبيق بأي تغيير في العنوان قبل الزيارة.';
    var pk1 = rules('scheduled', {
      cancel: { allowSelectedVisits: true, allowAllRemaining: true, bands: [band(24, null, NONE), band(0, 24, perVisit(5000))],
        packageBeforeStart: fixed(10000), packageAfterStart: fixed(20000), packageVsBand: 'greater_of' },
      reschedule: { minNoticeHours: 24, maxPerVisit: 1, sizeLimits: [{ upToVisits: 4, maxChanges: 1 }, { upToVisits: null, maxChanges: 3 }], freeChanges: 2, feeAfterFree: 2500, latestReplacementDays: 14 },
      exceptions: { noShow: { fee: pct(40), requireEvidence: true } },
      refund: { processingDays: 5, allowWallet: true }
    });
    var pk2 = JK.clone(pk1);
    pk2.cancel.packageAfterStart = fixed(25000);
    pk2.refund.extraText = 'تُطبّق الرسوم الجديدة على الباقات المحجوزة بعد تاريخ السريان فقط.';
    var eid = rules('scheduled', { cancel: { bands: [band(48, null, NONE), band(0, 48, perVisit(7500))], packageAfterStart: fixed(15000) } });
    var admin = 'منيرة الحربي';
    return {
      office: { id: 'A', code: 'A', name: 'مكتب الندى للخدمات المنزلية', city: 'الرياض', refundReviewThreshold: 100000,
        profile: 'زيارات مفردة وباقات مجدولة — شرائح وقت للزيارة ورسوم ثابتة لإلغاء الزيارات المتبقية',
        staff: { admin: admin, operations: 'سلطان العمري', finance: 'نوف القرني', viewer: 'زياد الشهري' } },
      costing: { version: 'تكلفة 2026-11-01', vatBps: 1500 },
      workers: people('w-a', ['ماريا سانتوس', 'أنيتا كوماري', 'سيتي رحمة', 'جوي ريس', 'ليلى بيغوم']),
      workerBlocks: [{ workerId: 'w-a1', workerName: 'ماريا سانتوس', from: T('2026-11-26 08:00'), to: T('2026-11-26 14:00'), reason: 'إجازة مرضية معتمدة' }],
      customers: people('c-a', ['نورة العتيبي', 'فهد القحطاني', 'سارة الشمري', 'عبدالله الدوسري', 'خالد المطيري', 'هيفاء الزهراني', 'ريم الحربي', 'بدر السهلي', 'أمل القرشي', 'مشاعل العنزي']),
      services: [
        { id: 'svc-a-clean', name: 'تنظيف منزلي', packages: [
          { id: 'pk-a-single', name: 'زيارة تنظيف (4 ساعات)', bookingType: 'single', visits: 1, salesEnabled: true, costing: { hourly: 4500, hours: 4, transport: 2500, defaultWorkers: 2 } },
          { id: 'pk-a-8w', name: 'باقة 8 زيارات أسبوعية (4 ساعات)', bookingType: 'scheduled', visits: 8, salesEnabled: true, costing: { price: 100000, hours: 4, workers: 1 } },
          { id: 'pk-a-4w', name: 'باقة 4 زيارات مميزة (6 ساعات)', bookingType: 'scheduled', visits: 4, salesEnabled: true, costing: { price: 100000, hours: 6, workers: 1 } }
        ] },
        { id: 'svc-a-elder', name: 'مرافقة كبار السن', packages: [
          { id: 'pk-a-elder', name: 'زيارة مرافقة (3 ساعات)', bookingType: 'single', visits: 1, salesEnabled: true, costing: { hourly: 6000, hours: 3, transport: 2500, defaultWorkers: 1 } }
        ] },
        { id: 'svc-a-events', name: 'تنظيف بعد المناسبات', packages: [
          { id: 'pk-a-events', name: 'باقة 3 مناسبات (6 ساعات)', bookingType: 'scheduled', visits: 3, salesEnabled: false, costing: { price: 90000, hours: 6, workers: 2 } }
        ] }
      ],
      policies: [
        { id: 'P-A-01', officeId: 'A', name: 'سياسة الزيارة المفردة', bookingType: 'single', archived: false, createdAt: T('2026-08-20 10:00'), versions: [
          ver(1, 'published', 'سياسة الزيارة المفردة', T('2026-09-01 00:00'), r1, { createdAt: T('2026-08-20 10:00'), createdBy: admin, approved: true, description: 'النسخة الأولى: شريحتان (24 ساعة).' }),
          ver(2, 'published', 'سياسة الزيارة المفردة', T('2026-11-20 00:00'), r2, { createdAt: T('2026-11-12 09:00'), createdBy: admin, approved: true, publishedAt: T('2026-11-14 11:00'), basedOn: 1, description: 'ثلاث شرائح + فترة سماح 15 دقيقة + إلغاء جزء من العمالة.', en: 'Free cancellation 12h+ before the visit; 25% between 3–12h; 50% under 3h.' }),
          ver(3, 'published', 'سياسة الزيارة المفردة', T('2026-11-23 12:00'), r3, { createdAt: T('2026-11-21 10:00'), createdBy: admin, approved: true, publishedAt: T('2026-11-22 15:00'), basedOn: 2, description: 'رسوم ثابتة 40 ر.س لشريحة 3–12 ساعة بدلاً من النسبة.' })
        ] },
        { id: 'P-A-02', officeId: 'A', name: 'سياسة الباقات المجدولة', bookingType: 'scheduled', archived: false, createdAt: T('2026-07-25 10:00'), versions: [
          ver(1, 'published', 'سياسة الباقات المجدولة', T('2026-08-01 00:00'), pk1, { createdAt: T('2026-07-25 10:00'), createdBy: admin, description: 'رسوم ثابتة لإلغاء الزيارات المتبقية: 100 ر.س قبل البدء و200 ر.س بعده.' }),
          ver(2, 'draft', 'سياسة الباقات المجدولة', T('2026-12-01 00:00'), pk2, { createdAt: T('2026-11-21 14:00'), createdBy: admin, basedOn: 1, description: 'رفع رسوم الإلغاء بعد البدء إلى 250 ر.س.' })
        ] },
        { id: 'P-A-03', officeId: 'A', name: 'سياسة موسم الأعياد', bookingType: 'scheduled', archived: false, createdAt: T('2026-11-20 13:00'), versions: [
          ver(1, 'draft', 'سياسة موسم الأعياد', T('2026-12-15 00:00'), eid, { createdAt: T('2026-11-20 13:00'), createdBy: admin, description: 'مسودة لم تُربط بعد.' })
        ] }
      ],
      assignments: [
        { id: 'AS-A-1', level: 'office_default', targetId: null, policyId: 'P-A-01', createdAt: T('2026-09-01 00:00') },
        { id: 'AS-A-2', level: 'service', targetId: 'svc-a-clean', policyId: 'P-A-01', createdAt: T('2026-09-01 00:00') },
        { id: 'AS-A-3', level: 'package', targetId: 'pk-a-8w', policyId: 'P-A-02', createdAt: T('2026-08-01 00:00') },
        { id: 'AS-A-4', level: 'package', targetId: 'pk-a-4w', policyId: 'P-A-02', createdAt: T('2026-08-01 00:00') }
      ],
      bookings: [], requests: [], refunds: [], ledger: [], audit: [], postedOps: [], checkout: null,
      seq: { request: 2000, refund: 3000, booking: 1011, policy: 3, audit: 0, ledger: 0 }
    };
  }

  /* ------------------------------ Office B ------------------------------ */
  function officeB() {
    var s1 = rules('single', {
      cancel: { allowPartialWorkers: true, grace: { enabled: true, minutes: 30, minLeadHours: 4 }, bands: [band(12, null, NONE), band(3, 12, pct(25)), band(0, 3, pct(50))] },
      reschedule: { minNoticeHours: 6, maxPerVisit: 1, sizeLimits: [{ upToVisits: null, maxChanges: 1 }], freeChanges: 1 },
      exceptions: { arrivalToleranceMin: 45, noShow: { fee: pct(50), requireEvidence: true } },
      refund: { processingDays: 3, dayType: 'business', allowWallet: true, reviewTargetHours: 12 }
    });
    var p1 = rules('scheduled', {
      cancel: { allowSelectedVisits: true, allowAllRemaining: true, grace: { enabled: true, minutes: 30, minLeadHours: 24 },
        bands: [band(24, null, NONE), band(6, 24, perVisit(3500)), band(0, 6, pct(40))],
        packageBeforeStart: perVisit(1500), packageAfterStart: perVisit(3500), packageVsBand: 'greater_of' },
      reschedule: { minNoticeHours: 12, maxPerVisit: 1, sizeLimits: [{ upToVisits: 4, maxChanges: 1 }, { upToVisits: 8, maxChanges: 2 }, { upToVisits: null, maxChanges: 3 }], freeChanges: 1, feeAfterFree: 2000, latestReplacementDays: 21 },
      exceptions: { arrivalToleranceMin: 45, noShow: { fee: perVisit(5000), requireEvidence: true } },
      refund: { processingDays: 3, dayType: 'business', allowWallet: true, reviewTargetHours: 12 }
    });
    var p2 = JK.clone(p1);
    p2.cancel.bands = [band(24, null, NONE), band(6, 24, perVisit(3500)), band(0, 6, { type: 'consume' })];
    var i1 = rules('single', { cancel: { bands: [band(6, null, NONE), band(0, 6, perVisit(3000))] }, reschedule: { minNoticeHours: 6 }, refund: { processingDays: 3 } });
    var i2 = JK.clone(i1); i2.cancel.bands = [band(6, null, NONE), band(0, 6, pct(60))];
    var admin = 'رنا باحارث';
    return {
      office: { id: 'B', code: 'B', name: 'مؤسسة ركن الراحة للخدمات المنزلية', city: 'جدة', refundReviewThreshold: 30000,
        profile: 'رسوم لكل زيارة ملغاة، فترة سماح عند الحجز، وحدود تعديل حسب حجم الباقة',
        staff: { admin: admin, operations: 'وليد الغامدي', finance: 'أسماء الزهراني', viewer: 'باسل المالكي' } },
      costing: { version: 'تكلفة 2026-10-15', vatBps: 1500 },
      workers: people('w-b', ['روزا ديلا كروز', 'فاطمة بيغوم', 'لكشمي ناير', 'ميرنا أوكافور', 'جانيت مويو']),
      workerBlocks: [{ workerId: 'w-b4', workerName: 'ميرنا أوكافور', from: T('2026-12-05 07:00'), to: T('2026-12-05 22:00'), reason: 'تدريب إلزامي' }],
      customers: people('c-b', ['ماجد السبيعي', 'لمى الغامدي', 'تركي العنزي', 'دانة الشهري', 'منصور البقمي', 'أمل الجهني', 'سلطان الحارثي', 'وعد المالكي']),
      services: [
        { id: 'svc-b-clean', name: 'تنظيف شامل', packages: [
          { id: 'pk-b-single', name: 'زيارة تنظيف شامل (4 ساعات)', bookingType: 'single', visits: 1, salesEnabled: true, costing: { hourly: 5000, hours: 4, transport: 3000, defaultWorkers: 1 } },
          { id: 'pk-b-4', name: 'باقة 4 زيارات', bookingType: 'scheduled', visits: 4, salesEnabled: true, costing: { price: 60000, hours: 4, workers: 1 } },
          { id: 'pk-b-8', name: 'باقة 8 زيارات', bookingType: 'scheduled', visits: 8, salesEnabled: true, costing: { price: 100000, hours: 4, workers: 1 } },
          { id: 'pk-b-12', name: 'باقة 12 زيارة', bookingType: 'scheduled', visits: 12, salesEnabled: true, costing: { price: 144000, hours: 4, workers: 1 } }
        ] },
        { id: 'svc-b-iron', name: 'كي وترتيب ملابس', packages: [
          { id: 'pk-b-iron', name: 'زيارة كي (3 ساعات)', bookingType: 'single', visits: 1, salesEnabled: true, costing: { hourly: 4000, hours: 3, transport: 2000, defaultWorkers: 1 } }
        ] }
      ],
      policies: [
        { id: 'P-B-01', officeId: 'B', name: 'إلغاء الزيارة المفردة — ركن الراحة', bookingType: 'single', archived: false, createdAt: T('2026-06-20 10:00'), versions: [
          ver(1, 'published', 'إلغاء الزيارة المفردة — ركن الراحة', T('2026-07-01 00:00'), s1, { createdAt: T('2026-06-20 10:00'), createdBy: admin, approved: true, description: 'فترة سماح 30 دقيقة من الحجز.' })
        ] },
        { id: 'P-B-02', officeId: 'B', name: 'باقات ركن الراحة', bookingType: 'scheduled', archived: false, createdAt: T('2026-05-20 10:00'), versions: [
          ver(1, 'published', 'باقات ركن الراحة', T('2026-06-01 00:00'), p1, { createdAt: T('2026-05-20 10:00'), createdBy: admin, description: '35 ر.س عن كل زيارة متبقية ملغاة بعد البدء.' }),
          ver(2, 'pending_review', 'باقات ركن الراحة', T('2026-12-01 00:00'), p2, { createdAt: T('2026-11-21 09:00'), submittedAt: T('2026-11-22 10:00'), createdBy: admin, basedOn: 1, description: 'احتساب الزيارة مستهلكة عند الإلغاء خلال 6 ساعات (يتطلب اعتماد المنصة).' })
        ] },
        { id: 'P-B-03', officeId: 'B', name: 'سياسة الكي المختصرة', bookingType: 'single', archived: false, createdAt: T('2026-06-25 10:00'), versions: [
          ver(1, 'published', 'سياسة الكي المختصرة', T('2026-07-01 00:00'), i1, { createdAt: T('2026-06-25 10:00'), createdBy: admin }),
          ver(2, 'rejected', 'سياسة الكي المختصرة', T('2026-12-01 00:00'), i2, { createdAt: T('2026-11-18 10:00'), submittedAt: T('2026-11-18 11:00'), createdBy: admin, basedOn: 1, reviewNote: 'نسبة 60% أعلى من حد المنصة لرسوم الزيارة (50%) — سيتم تقييدها تلقائياً. يرجى التعديل أو التوضيح.' })
        ] }
      ],
      assignments: [
        { id: 'AS-B-1', level: 'office_default', targetId: null, policyId: 'P-B-01', createdAt: T('2026-07-01 00:00') },
        { id: 'AS-B-2', level: 'service', targetId: 'svc-b-clean', policyId: 'P-B-01', createdAt: T('2026-07-01 00:00') },
        { id: 'AS-B-3', level: 'package', targetId: 'pk-b-4', policyId: 'P-B-02', createdAt: T('2026-06-01 00:00') },
        { id: 'AS-B-4', level: 'package', targetId: 'pk-b-8', policyId: 'P-B-02', createdAt: T('2026-06-01 00:00') },
        { id: 'AS-B-5', level: 'package', targetId: 'pk-b-12', policyId: 'P-B-02', createdAt: T('2026-06-01 00:00') },
        { id: 'AS-B-6', level: 'service', targetId: 'svc-b-iron', policyId: 'P-B-03', createdAt: T('2026-07-01 00:00') }
      ],
      bookings: [], requests: [], refunds: [], ledger: [], audit: [], postedOps: [], checkout: null,
      seq: { request: 2000, refund: 3000, booking: 1009, policy: 3, audit: 0, ledger: 0 }
    };
  }

  /* ------------------------------ Office C ------------------------------ */
  function officeC() {
    var c1 = rules('credits', {
      cancel: { grace: { enabled: true, minutes: 60, minLeadHours: 0 } },
      credits: { restoreMinNoticeHours: 12, lateAction: 'consume', expiryOnRestore: 'keep', extendDays: 0, officeFaultExtendDays: 0, refundBeforeUse: pct(15, 'remaining_value'), refundAfterUse: fixed(10000), expiredRefundable: false },
      reschedule: { minNoticeHours: 12, maxPerVisit: 2, sizeLimits: [{ upToVisits: null, maxChanges: 10 }], freeChanges: 10 },
      refund: { processingDays: 10, dayType: 'calendar', allowWallet: true, reviewTargetHours: 48 }
    });
    var c2 = JK.clone(c1);
    c2.credits.restoreMinNoticeHours = 6; c2.credits.officeFaultExtendDays = 14; c2.credits.refundBeforeUse = pct(10, 'remaining_value'); c2.credits.refundAfterUse = fixed(7500);
    c2.reschedule.minNoticeHours = 6; c2.refund.reviewTargetHours = 24;
    var sOld = rules('single', { cancel: { bands: [band(48, null, NONE), band(0, 48, pct(30))] }, refund: { processingDays: 14, dayType: 'calendar' } });
    var sNew = rules('single', { cancel: { bands: [band(24, null, NONE), band(0, 24, perVisit(5000))] }, refund: { processingDays: 10, dayType: 'calendar', allowWallet: false } });
    var admin = 'عبير الدوسري';
    return {
      office: { id: 'C', code: 'C', name: 'دار السكينة للعمالة المنزلية', city: 'الدمام', refundReviewThreshold: 50000,
        profile: 'باقات رصيد زيارات مرنة: إعادة الاستحقاق عند الإلغاء المؤهل، وقواعد منفصلة لاسترداد الباقة نفسها',
        staff: { admin: admin, operations: 'حمد الخالدي', finance: 'شهد العمري', viewer: 'يوسف الهاجري' } },
      costing: { version: 'تكلفة 2026-10-01', vatBps: 1500 },
      workers: people('w-c', ['سيتي آمنة', 'ديوي لستاري', 'نور العين بيغوم', 'إيفا موراليس']),
      workerBlocks: [],
      customers: people('c-c', ['غادة السالم', 'سلمان الرشيد', 'أريج الفيفي', 'نواف الشمري', 'جود القحطاني', 'هند البلوي']),
      services: [
        { id: 'svc-c-flex', name: 'ساعات تنظيف مرنة', packages: [
          { id: 'pk-c-10', name: 'رصيد 10 زيارات مرنة (4 ساعات)', bookingType: 'credits', visits: 10, validityDays: 90, salesEnabled: true, costing: { price: 150000, hours: 4, workers: 1 } },
          { id: 'pk-c-5', name: 'رصيد 5 زيارات مرنة (4 ساعات)', bookingType: 'credits', visits: 5, validityDays: 60, salesEnabled: true, costing: { price: 80000, hours: 4, workers: 1 } }
        ] },
        { id: 'svc-c-single', name: 'زيارة تنظيف مفردة', packages: [
          { id: 'pk-c-single', name: 'زيارة تنظيف (4 ساعات)', bookingType: 'single', visits: 1, salesEnabled: true, costing: { hourly: 4800, hours: 4, transport: 2000, defaultWorkers: 1 } }
        ] }
      ],
      policies: [
        { id: 'P-C-01', officeId: 'C', name: 'سياسة الرصيد المرن', bookingType: 'credits', archived: false, createdAt: T('2026-04-20 10:00'), versions: [
          ver(1, 'published', 'سياسة الرصيد المرن', T('2026-05-01 00:00'), c1, { createdAt: T('2026-04-20 10:00'), createdBy: admin, approved: true, description: 'مهلة 12 ساعة لإعادة الرصيد.' }),
          ver(2, 'published', 'سياسة الرصيد المرن', T('2026-10-01 00:00'), c2, { createdAt: T('2026-09-15 10:00'), publishedAt: T('2026-09-20 10:00'), createdBy: admin, approved: true, basedOn: 1, description: 'مهلة 6 ساعات + تمديد 14 يوماً عند خلل المكتب.' })
        ] },
        { id: 'P-C-02', officeId: 'C', name: 'الزيارة المفردة — السكينة (قديمة)', bookingType: 'single', archived: false, createdAt: T('2026-03-01 10:00'), versions: [
          ver(1, 'published', 'الزيارة المفردة — السكينة (قديمة)', T('2026-03-10 00:00'), sOld, { createdAt: T('2026-03-01 10:00'), createdBy: admin })
        ] },
        { id: 'P-C-03', officeId: 'C', name: 'الزيارة المفردة 2026', bookingType: 'single', archived: false, createdAt: T('2026-08-20 10:00'), versions: [
          ver(1, 'published', 'الزيارة المفردة 2026', T('2026-09-01 00:00'), sNew, { createdAt: T('2026-08-20 10:00'), createdBy: admin })
        ] }
      ],
      assignments: [
        { id: 'AS-C-1', level: 'office_default', targetId: null, policyId: 'P-C-02', createdAt: T('2026-03-10 00:00') },
        { id: 'AS-C-2', level: 'service', targetId: 'svc-c-single', policyId: 'P-C-02', createdAt: T('2026-03-10 00:00') },
        { id: 'AS-C-3', level: 'service', targetId: 'svc-c-flex', policyId: 'P-C-01', createdAt: T('2026-05-01 00:00') }
      ],
      bookings: [], requests: [], refunds: [], ledger: [], audit: [], postedOps: [], checkout: null,
      seq: { request: 2000, refund: 3000, booking: 1008, policy: 3, audit: 0, ledger: 0 }
    };
  }

  /* ------------------------------ Build ------------------------------ */
  function weekly(dates, time, status) { return dates.map(function (d) { return { start: T(d + ' ' + time), status: status }; }); }

  JK.buildSeed = function () {
    var S = JK.store, ops = S.ops;
    var platform = platformFixture();
    var state = { schema: S.SCHEMA, demo: { officeId: 'A', role: 'admin', now: T('2026-11-23 09:00'), providerOutage: false }, platform: platform, offices: { A: officeA(), B: officeB(), C: officeC() } };
    function ctx(o, role, at) { return S.mkCtx(state, o, role, T(at)); }
    function cust(o, id) { return S.byId(state.offices[o].customers, id); }
    function add(o, spec) { var b = S.buildBooking(state.offices[o], platform, spec); state.offices[o].bookings.push(b); return b; }
    function vid(b, n) { return b.id + '-V' + n; }
    function wid(b, n, w) { return b.id + '-V' + n + '-W' + w; }
    function lastReq(o) { var a = state.offices[o].requests; return a[a.length - 1]; }
    function lastRefund(o) { var a = state.offices[o].refunds; return a[a.length - 1]; }
    function process(o, rf, at, cbAt, result, reason) {
      ops.refundProcess(ctx(o, 'finance', at), { refundId: rf.id });
      if (cbAt) ops.providerCallback(ctx(o, 'finance', cbAt), { refundId: rf.id, attemptId: rf.attempts[rf.attempts.length - 1].id, result: result || 'success', reason: reason });
    }
    // seeded policy history events
    Object.keys(state.offices).forEach(function (k) {
      var o = state.offices[k];
      o.policies.forEach(function (p) {
        p.versions.forEach(function (v) {
          var c = S.mkCtx(state, k, 'admin', v.createdAt);
          S.audit(c, 'policy.created', 'policy', p.id, null, { version: v.version, name: v.name }, v.description);
          if (v.submittedAt && v.status !== 'draft') S.audit(S.mkCtx(state, k, 'admin', v.submittedAt), 'policy.submitted', 'policy', p.id, { version: v.version, status: 'draft' }, { version: v.version, status: 'pending_review' }, '');
          if (v.status === 'published') S.audit(S.mkCtx(state, k, v.platformApproved ? 'platform' : 'admin', v.publishedAt), 'policy.published', 'policy', p.id, null, { version: v.version, effectiveFrom: v.effectiveFrom, platformApproved: v.platformApproved }, v.platformApproved ? 'اعتماد المنصة (محاكاة)' : 'نشر مباشر');
          if (v.status === 'rejected') S.audit(S.mkCtx(state, k, 'platform', v.submittedAt), 'policy.changes_requested', 'policy', p.id, { version: v.version }, { version: v.version, status: 'rejected' }, v.reviewNote);
        });
      });
    });

    /* ---------- Office A ---------- */
    var A = 'A';
    var a1 = add(A, { ref: 'BK-A-1001', customer: cust(A, 'c-a1'), packageId: 'pk-a-8w', createdAt: T('2026-10-30 14:00'), workerIds: ['w-a1'], vatBps: 0, jokrsFee: 0, policyId: 'P-A-02', version: 1,
      visits: weekly(['2026-11-04', '2026-11-11', '2026-11-18'], '10:00', 'completed').concat(weekly(['2026-11-25', '2026-12-02', '2026-12-09', '2026-12-16', '2026-12-23'], '10:00')) });
    add(A, { ref: 'BK-A-1002', customer: cust(A, 'c-a2'), packageId: 'pk-a-single', workerCount: 2, workerIds: ['w-a2', 'w-a3'], createdAt: T('2026-11-21 11:00'), discount: { label: 'قسيمة HOME35', amount: 3500 }, policyId: 'P-A-01', version: 2, visits: [{ start: T('2026-11-24 10:00') }] });
    var a3 = add(A, { ref: 'BK-A-1003', customer: cust(A, 'c-a3'), packageId: 'pk-a-single', workerCount: 1, workerIds: ['w-a4'], createdAt: T('2026-11-10 16:00'), policyId: 'P-A-01', version: 1, costingVersion: 'تكلفة 2026-10-01', visits: [{ start: T('2026-11-27 16:00') }] });
    var a4 = add(A, { ref: 'BK-A-1004', customer: cust(A, 'c-a4'), packageId: 'pk-a-single', workerCount: 1, workerIds: ['w-a1'], createdAt: T('2026-11-19 12:00'), policyId: 'P-A-01', version: 2, visits: [{ start: T('2026-11-26 09:00') }] });
    add(A, { ref: 'BK-A-1005', customer: cust(A, 'c-a5'), packageId: 'pk-a-4w', workerIds: ['w-a5'], createdAt: T('2026-11-23 08:30'), officeAcceptance: 'pending', payments: [{ method: 'card', state: 'authorized' }], policyId: 'P-A-02', version: 1,
      visits: weekly(['2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20'], '09:00') });
    var a6 = add(A, { ref: 'BK-A-1006', customer: cust(A, 'c-a6'), packageId: 'pk-a-4w', workerIds: ['w-a2'], createdAt: T('2026-11-05 10:00'), policyId: 'P-A-02', version: 1,
      visits: weekly(['2026-11-09', '2026-11-16'], '15:00', 'completed').concat(weekly(['2026-11-30', '2026-12-07'], '15:00')) });
    var a7 = add(A, { ref: 'BK-A-1007', customer: cust(A, 'c-a7'), packageId: 'pk-a-4w', workerIds: ['w-a3'], createdAt: T('2026-11-08 09:00'), policyId: 'P-A-02', version: 1,
      visits: [{ start: T('2026-11-12 10:00') }, { start: T('2026-11-19 10:00'), status: 'completed' }, { start: T('2026-11-26 15:00') }, { start: T('2026-12-03 10:00') }, { start: T('2026-12-10 10:00'), origin: 'promo', label: 'ترويجية', note: 'زيارة مجانية ضمن عرض ترويجي — بلا قيمة نقدية مستقلة' }] });
    var a8 = add(A, { ref: 'BK-A-1008', customer: cust(A, 'c-a8'), packageId: 'pk-a-single', workerCount: 1, workerIds: ['w-a4'], createdAt: T('2026-11-18 20:00'), policyId: 'P-A-01', version: 2, visits: [{ start: T('2026-11-23 13:00') }] });
    var a9 = add(A, { ref: 'BK-A-1009', customer: cust(A, 'c-a9'), packageId: 'pk-a-single', workerCount: 1, workerIds: ['w-a2'], createdAt: T('2026-11-14 10:00'), policyId: 'P-A-01', version: 1, visits: [{ start: T('2026-11-22 10:00') }] });
    var a10 = add(A, { ref: 'BK-A-1010', customer: cust(A, 'c-a10'), packageId: 'pk-a-single', workerCount: 2, workerIds: ['w-a4', 'w-a5'], createdAt: T('2026-11-15 18:00'), policyId: 'P-A-01', version: 1, visits: [{ start: T('2026-11-25 16:00') }] });
    var a11 = add(A, { ref: 'BK-A-1011', customer: cust(A, 'c-a3'), packageId: 'pk-a-elder', createdAt: T('2026-11-16 10:00'), workerIds: ['w-a1'], policyId: 'P-A-01', version: 1, visits: [{ start: T('2026-11-24 17:00') }] });

    // M: earlier booking-level partial refund (price adjustment) on BK-A-1006
    (function () {
      var c = ctx(A, 'admin', '2026-11-17 10:00'), o = state.offices[A];
      var amt = 15000, tax = Math.round(a6.price.vat * amt / a6.price.serviceNet);
      a6.adjustments.push({ amount: amt, label: 'تعديل سعر جزئي بعد تقليص نطاق الخدمة في الزيارات المتبقية', at: c.now });
      a6.taxRefunded += tax;
      var rf = { id: S.nextRef(o, 'refund', 'RF', 3000), opId: 'op-adj-' + a6.id, requestId: null, requestRef: 'تعديل يدوي', bookingId: a6.id, bookingRef: a6.ref, customerName: a6.customerName,
        state: 'approved', outcome: 'cash_refund', components: { service: amt, tax: tax, jokrs: 0, total: amt + tax }, officeFeeRetained: 0,
        destinations: [{ paymentId: a6.price.payments[0].id, method: 'card', action: 'refund_capture', amount: amt + tax }], createdAt: c.now,
        timeline: [{ state: 'approved', at: c.now, by: c.actor.name }], attempts: [], providerRef: null, failureReason: null, completedAt: null, note: 'استرداد جزئي سابق على مستوى الحجز (غير مرتبط بزيارة محددة).' };
      rf.ref = rf.id; o.refunds.push(rf);
      S.audit(c, 'refund.created', 'refund', rf.id, null, { total: rf.components.total, reason: 'تعديل سعر جزئي' }, a6.ref);
      process(A, rf, '2026-11-17 11:00', '2026-11-18 09:00', 'success');
    })();
    // J: office cancels V1 of BK-A-1007 and the customer accepts a replacement (value stays linked)
    ops.submitRequest(ctx(A, 'operations', '2026-11-11 08:00'), { bookingId: a7.id, type: 'office_cancel', initiator: 'office', cause: 'office', remedy: 'replacement', visitIds: [vid(a7, 1)], newStart: T('2026-11-28 10:00'), reasonCode: 'no_worker', reasonLabel: 'تعذّر توفير العاملة', reason: 'العاملة المخصصة في إجازة طارئة' });
    ops.respondProposal(ctx(A, 'operations', '2026-11-11 09:30'), { requestId: lastReq(A).id, accept: true });
    // F (seeded open case): office cannot provide worker for BK-A-1004 → replacement proposed, awaiting customer
    ops.submitRequest(ctx(A, 'operations', '2026-11-22 18:00'), { bookingId: a4.id, type: 'office_cancel', initiator: 'office', cause: 'office', remedy: 'replacement', visitIds: [vid(a4, 1)], newStart: T('2026-11-28 14:00'), replacementWorkerIds: ['w-a2'], reasonCode: 'no_worker', reasonLabel: 'تعذّر توفير العاملة', reason: 'العاملة المخصصة لديها إجازة مرضية معتمدة يوم الموعد' });
    // completed refund history
    ops.submitRequest(ctx(A, 'operations', '2026-11-19 12:00'), { bookingId: a9.id, type: 'cancel_visits', initiator: 'customer', visitIds: [vid(a9, 1)], reason: 'تغيّر موعد السفر' });
    process(A, lastRefund(A), '2026-11-19 15:00', '2026-11-20 10:00', 'success');
    // L: failed refund
    ops.submitRequest(ctx(A, 'operations', '2026-11-21 10:00'), { bookingId: a10.id, type: 'cancel_visits', initiator: 'customer', visitIds: [vid(a10, 1)], reason: 'لم أعد بحاجة للخدمة' });
    process(A, lastRefund(A), '2026-11-21 14:00', '2026-11-22 09:00', 'failure', 'رفض البنك المصدر العملية: انتهت مهلة الاتصال (رمز محاكى 91)');
    // processing refund
    ops.submitRequest(ctx(A, 'operations', '2026-11-22 20:00'), { bookingId: a11.id, type: 'cancel_visits', initiator: 'customer', visitIds: [vid(a11, 1)], reason: 'تحسن الحالة الصحية للوالدة' });
    process(A, lastRefund(A), '2026-11-23 08:00');
    // exception request awaiting review (late cancellation waiver)
    ops.submitRequest(ctx(A, 'operations', '2026-11-23 08:40'), { bookingId: a8.id, type: 'exception_review', baseType: 'cancel_visits', initiator: 'customer', visitIds: [vid(a8, 1)], reason: 'ظرف صحي طارئ في الأسرة — أطلب الإعفاء من رسوم الإلغاء المتأخر', evidence: [{ by: 'customer', type: 'document', label: 'تقرير مراجعة طوارئ (مرفق من العميل)' }] });
    // rejected reschedule beyond latest allowed date
    ops.submitRequest(ctx(A, 'operations', '2026-11-20 10:00'), { bookingId: a3.id, type: 'reschedule', initiator: 'customer', visitIds: [vid(a3, 1)], newStart: T('2026-12-20 16:00'), asException: true, reason: 'سأكون خارج المدينة حتى منتصف ديسمبر' });
    ops.rejectRequest(ctx(A, 'operations', '2026-11-20 15:00'), { requestId: lastReq(A).id, reason: 'الموعد المطلوب يتجاوز آخر موعد بديل تسمح به السياسة (11 ديسمبر). يمكن طلب موعد حتى هذا التاريخ.' });

    /* ---------- Office B ---------- */
    var B = 'B';
    add(B, { ref: 'BK-B-1001', customer: cust(B, 'c-b1'), packageId: 'pk-b-8', createdAt: T('2026-10-30 12:00'), workerIds: ['w-b1'], vatBps: 0, jokrsFee: 0, policyId: 'P-B-02', version: 1,
      visits: weekly(['2026-11-03', '2026-11-10', '2026-11-17'], '10:00', 'completed').concat(weekly(['2026-11-24', '2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22'], '10:00')) });
    add(B, { ref: 'BK-B-1002', customer: cust(B, 'c-b2'), packageId: 'pk-b-single', workerIds: ['w-b2'], createdAt: T('2026-11-23 08:50'), policyId: 'P-B-01', version: 1, visits: [{ start: T('2026-11-23 18:00') }] });
    var b3 = add(B, { ref: 'BK-B-1003', customer: cust(B, 'c-b3'), packageId: 'pk-b-single', workerIds: ['w-b2'], createdAt: T('2026-11-18 10:00'), policyId: 'P-B-01', version: 1, visits: [{ start: T('2026-11-22 09:00') }] });
    var b4 = add(B, { ref: 'BK-B-1004', customer: cust(B, 'c-b4'), packageId: 'pk-b-single', workerIds: ['w-b3'], createdAt: T('2026-11-17 13:00'), policyId: 'P-B-01', version: 1, visits: [{ start: T('2026-11-21 16:00') }] });
    var b5 = add(B, { ref: 'BK-B-1005', customer: cust(B, 'c-b5'), packageId: 'pk-b-single', workerCount: 2, workerIds: ['w-b1', 'w-b3'], createdAt: T('2026-11-15 11:00'), policyId: 'P-B-01', version: 1, visits: [{ start: T('2026-11-22 14:00') }] });
    var b6 = add(B, { ref: 'BK-B-1006', customer: cust(B, 'c-b6'), packageId: 'pk-b-4', workerIds: ['w-b4'], createdAt: T('2026-11-10 10:00'), policyId: 'P-B-02', version: 1,
      visits: weekly(['2026-11-18'], '10:00', 'completed').concat(weekly(['2026-11-24', '2026-12-02', '2026-12-09'], '10:00')) });
    var b7 = add(B, { ref: 'BK-B-1007', customer: cust(B, 'c-b7'), packageId: 'pk-b-4', workerIds: ['w-b5'], createdAt: T('2026-11-12 10:00'), policyId: 'P-B-02', version: 1, officePayout: 'paid_out',
      payments: [{ method: 'card', state: 'captured', amount: 50500 }, { method: 'wallet', state: 'captured', amount: 20000 }],
      visits: weekly(['2026-11-20'], '16:00', 'completed').concat(weekly(['2026-11-27', '2026-12-04', '2026-12-11'], '16:00')) });
    var b8 = add(B, { ref: 'BK-B-1008', customer: cust(B, 'c-b8'), packageId: 'pk-b-iron', workerIds: ['w-b2'], createdAt: T('2026-11-15 09:00'), policyId: 'P-B-03', version: 1, visits: [{ start: T('2026-11-20 10:00') }] });
    var b9 = add(B, { ref: 'BK-B-1009', customer: cust(B, 'c-b1'), packageId: 'pk-b-single', workerIds: ['w-b1'], createdAt: T('2026-11-19 10:00'), policyId: 'P-B-01', version: 1, visits: [{ start: T('2026-11-26 10:00') }] });
    // H1: no-show reported by office with evidence (undisputed) → awaiting review
    ops.submitRequest(ctx(B, 'operations', '2026-11-22 10:30'), { bookingId: b3.id, type: 'no_show', initiator: 'office', cause: 'customer', visitIds: [vid(b3, 1)], reason: 'لم يفتح أحد الباب ولم يرد العميل على الاتصالات',
      evidence: [{ by: 'office', type: 'gps', label: 'سجل وصول العاملة عبر التطبيق 08:52 مع الموقع' }, { by: 'office', type: 'call', label: '3 محاولات اتصال مسجلة بين 09:00 و09:20' }, { by: 'office', type: 'photo', label: 'صورة لمدخل المبنى بطابع زمني 09:05' }] });
    // H2: disputed no-show
    ops.submitRequest(ctx(B, 'operations', '2026-11-21 17:00'), { bookingId: b4.id, type: 'no_show', initiator: 'office', cause: 'disputed', disputed: true, visitIds: [vid(b4, 1)], reason: 'المكتب يفيد بعدم الاستقبال؛ العميلة تعترض',
      evidence: [{ by: 'office', type: 'gps', label: 'سجل وصول العاملة 15:55 (دقة الموقع 120 م)' }, { by: 'customer', type: 'statement', label: 'العميلة: كنت في المنزل ولم يصل أحد، ولا يوجد اتصال مسجل على هاتفي' }] });
    // I: partial delivery reported by customer → review
    ops.submitRequest(ctx(B, 'operations', '2026-11-22 19:00'), { bookingId: b5.id, type: 'partial_delivery', initiator: 'customer', cause: 'office', visitIds: [vid(b5, 1)], deliveredWorkerIds: [wid(b5, 1, 1)], reason: 'حضرت عاملة واحدة فقط من اثنتين' });
    // reschedule used, then limit reached → exception rejected
    ops.submitRequest(ctx(B, 'operations', '2026-11-20 09:00'), { bookingId: b6.id, type: 'reschedule', initiator: 'customer', visitIds: [vid(b6, 2)], newStart: T('2026-11-25 10:00'), reason: 'موعد طبي' });
    ops.submitRequest(ctx(B, 'operations', '2026-11-22 11:00'), { bookingId: b6.id, type: 'reschedule', initiator: 'customer', visitIds: [vid(b6, 3)], newStart: T('2026-12-05 10:00'), asException: true, reason: 'زيارة عائلية' });
    ops.rejectRequest(ctx(B, 'operations', '2026-11-22 16:00'), { requestId: lastReq(B).id, reason: 'تم استخدام التعديل الوحيد المسموح لباقة 4 زيارات، والعاملة غير متاحة في 5 ديسمبر. يمكنك إلغاء الزيارة وفق السياسة.' });
    // mixed payment cancel-all-remaining on a paid-out booking → finance review
    ops.submitRequest(ctx(B, 'operations', '2026-11-22 10:00'), { bookingId: b7.id, type: 'cancel_all_remaining', initiator: 'customer', reason: 'انتقال إلى مدينة أخرى' });
    // completed + processing
    ops.submitRequest(ctx(B, 'operations', '2026-11-16 09:00'), { bookingId: b8.id, type: 'cancel_visits', initiator: 'customer', visitIds: [vid(b8, 1)], reason: 'لم أعد بحاجة للخدمة', destination: 'wallet' });
    process(B, lastRefund(B), '2026-11-16 12:00');
    ops.submitRequest(ctx(B, 'operations', '2026-11-22 08:00'), { bookingId: b9.id, type: 'cancel_visits', initiator: 'customer', visitIds: [vid(b9, 1)], reason: 'سفر مفاجئ' });
    process(B, lastRefund(B), '2026-11-22 12:00');

    /* ---------- Office C ---------- */
    var C = 'C';
    add(C, { ref: 'BK-C-1001', customer: cust(C, 'c-c1'), packageId: 'pk-c-10', workerIds: ['w-c1'], createdAt: T('2026-10-15 10:00'), policyId: 'P-C-01', version: 2,
      credits: { count: 10, expiresAt: T('2027-01-13 23:59') },
      visits: weekly(['2026-10-20', '2026-11-03', '2026-11-17'], '10:00', 'completed').concat(weekly(['2026-11-25'], '10:00')) });
    add(C, { ref: 'BK-C-1002', customer: cust(C, 'c-c2'), packageId: 'pk-c-5', workerIds: ['w-c2'], createdAt: T('2026-11-01 12:00'), policyId: 'P-C-01', version: 2,
      credits: { count: 5, expiresAt: T('2026-12-31 23:59') }, visits: weekly(['2026-11-10'], '12:00', 'completed').concat(weekly(['2026-11-23'], '12:00')) });
    var c3 = add(C, { ref: 'BK-C-1003', customer: cust(C, 'c-c3'), packageId: 'pk-c-10', workerIds: ['w-c2'], createdAt: T('2026-11-02 10:00'), policyId: 'P-C-01', version: 2,
      credits: { count: 10, expiresAt: T('2027-01-31 23:59') }, visits: weekly(['2026-11-09'], '10:00', 'completed').concat([{ start: T('2026-11-20 10:00') }, { start: T('2026-11-24 08:00') }]) });
    var c4 = add(C, { ref: 'BK-C-1004', customer: cust(C, 'c-c4'), packageId: 'pk-c-5', workerIds: ['w-c3'], createdAt: T('2026-11-05 10:00'), policyId: 'P-C-01', version: 2,
      credits: { count: 5, expiresAt: T('2027-01-04 23:59') }, visits: weekly(['2026-11-12'], '10:00', 'completed') });
    add(C, { ref: 'BK-C-1005', customer: cust(C, 'c-c5'), packageId: 'pk-c-5', workerIds: ['w-c4'], createdAt: T('2026-07-20 10:00'), policyId: 'P-C-01', version: 1,
      credits: { count: 5, expiresAt: T('2026-09-18 23:59') }, visits: weekly(['2026-07-25', '2026-08-10', '2026-08-25'], '10:00', 'completed') });
    var c6 = add(C, { ref: 'BK-C-1006', customer: cust(C, 'c-c6'), packageId: 'pk-c-single', workerIds: ['w-c3'], createdAt: T('2026-11-10 10:00'), policyId: 'P-C-03', version: 1, visits: [{ start: T('2026-11-21 10:00') }] });
    var c7 = add(C, { ref: 'BK-C-1007', customer: cust(C, 'c-c3'), packageId: 'pk-c-5', workerIds: ['w-c1'], createdAt: T('2026-11-03 10:00'), policyId: 'P-C-01', version: 2,
      credits: { count: 5, expiresAt: T('2027-01-02 23:59') }, visits: [] });
    var c8 = add(C, { ref: 'BK-C-1008', customer: cust(C, 'c-c5'), packageId: 'pk-c-single', workerIds: ['w-c4'], createdAt: T('2026-11-18 10:00'), policyId: 'P-C-03', version: 1, visits: [{ start: T('2026-11-27 12:00') }] });
    // archive the old single policy with a replacement (history preserved)
    S.ops.archivePolicy(ctx(C, 'admin', '2026-09-01 09:00'), { policyId: 'P-C-02', replacementPolicyId: 'P-C-03', reason: 'استُبدلت بسياسة 2026' });
    // office-caused cancellation of a credit appointment → credit restored + expiry extended
    ops.submitRequest(ctx(C, 'operations', '2026-11-19 18:00'), { bookingId: c3.id, type: 'office_cancel', initiator: 'office', cause: 'office', visitIds: [vid(c3, 2)], reasonCode: 'no_worker', reasonLabel: 'تعذّر توفير العاملة', reason: 'العاملة في إجازة مرضية' });
    // package refund before use → approved → finance review → completed
    ops.submitRequest(ctx(C, 'operations', '2026-11-04 09:00'), { bookingId: c7.id, type: 'package_refund', initiator: 'customer', reason: 'تغيّرت ظروف العمل' });
    ops.approveRequest(ctx(C, 'operations', '2026-11-04 12:00'), { requestId: lastReq(C).id, note: 'تم التحقق: لا مواعيد مستخدمة' });
    ops.refundApprove(ctx(C, 'finance', '2026-11-04 14:00'), { refundId: lastRefund(C).id });
    process(C, lastRefund(C), '2026-11-04 15:00', '2026-11-05 10:00', 'success');
    // completed single-visit refund
    ops.submitRequest(ctx(C, 'operations', '2026-11-15 10:00'), { bookingId: c6.id, type: 'cancel_visits', initiator: 'customer', visitIds: [vid(c6, 1)], reason: 'تأجيل الانتقال للمنزل الجديد' });
    process(C, lastRefund(C), '2026-11-15 13:00', '2026-11-16 09:00', 'success');
    // approved refund waiting for finance
    ops.submitRequest(ctx(C, 'operations', '2026-11-22 18:00'), { bookingId: c8.id, type: 'cancel_visits', initiator: 'customer', visitIds: [vid(c8, 1)], reason: 'ظرف عائلي' });
    // package refund after use → awaiting office review
    ops.submitRequest(ctx(C, 'operations', '2026-11-22 13:00'), { bookingId: c4.id, type: 'package_refund', initiator: 'customer', reason: 'الانتقال إلى مدينة أخرى' });

    state.demo.now = T('2026-11-23 09:00');
    return state;
  };

  /* ------------------------------ Scenarios A–N ------------------------------ */
  JK.SCENARIOS = [
    { id: 'A', title: 'A — باقة 8 زيارات: رسوم ثابتة 200 ر.س', office: 'A', route: 'simulator',
      preset: { bookingId: 'BK-A-1001', type: 'cancel_all_remaining', at: '2026-11-23T09:00' },
      expect: 'المتبقي 625 ر.س − رسوم ثابتة 200 ر.س = استرداد الخدمة 425 ر.س (دون ضرائب أو رسوم إضافية).',
      checks: [{ label: 'القيمة المتبقية = 625.00', fn: function (r) { return r.eligible === 62500; } }, { label: 'الرسوم = 200.00', fn: function (r) { return r.officeFee === 20000; } }, { label: 'استرداد الخدمة = 425.00', fn: function (r) { return r.serviceRefund === 42500 && r.totalRefund === 42500; } }] },
    { id: 'B', title: 'B — نفس الباقة: 35 ر.س لكل زيارة ملغاة', office: 'B', route: 'simulator',
      preset: { bookingId: 'BK-B-1001', type: 'cancel_all_remaining', at: '2026-11-23T09:00' },
      expect: '5 زيارات × 35 ر.س = 175 ر.س؛ 625 − 175 = استرداد الخدمة 450 ر.س.',
      checks: [{ label: 'الرسوم = 175.00', fn: function (r) { return r.officeFee === 17500; } }, { label: 'استرداد الخدمة = 450.00', fn: function (r) { return r.serviceRefund === 45000 && r.totalRefund === 45000; } }] },
    { id: 'C', title: 'C — إلغاء زيارة واحدة من باقة', office: 'A', route: 'simulator',
      preset: { bookingId: 'BK-A-1001', type: 'cancel_visits', visitIds: ['BK-A-1001-V6'], at: '2026-11-23T09:00' },
      expect: 'تتأثر الزيارة 6 فقط (125 ر.س)، وتبقى مواعيد الزيارات الأخرى كما هي.',
      checks: [{ label: 'زيارة واحدة متأثرة', fn: function (r) { return r.effects.visits.length === 1 && r.effects.visits[0].visitId === 'BK-A-1001-V6'; } }, { label: 'استرداد 125.00 بدون رسوم', fn: function (r) { return r.serviceRefund === 12500 && r.officeFee === 0; } }] },
    { id: 'D', title: 'D — إلغاء ضمن فترة السماح عند الحجز', office: 'B', route: 'simulator',
      preset: { bookingId: 'BK-B-1002', type: 'cancel_visits', visitIds: ['BK-B-1002-V1'], at: '2026-11-23T09:10' },
      expect: 'أُكّد الحجز 8:50 ص؛ فترة السماح 30 دقيقة حتى 9:20 ص (شاملة). الإلغاء 9:10 ص بدون رسوم مع استرداد رسوم JOKRS. جرّب 9:25 ص لترى شريحة 25%.',
      checks: [{ label: 'رسوم المكتب = 0', fn: function (r) { return r.officeFee === 0; } }, { label: 'استرداد رسوم JOKRS', fn: function (r) { return r.jokrs.refund === 1500; } }] },
    { id: 'E', title: 'E — الإلغاء عند حد الشريحة بالضبط', office: 'A', route: 'simulator',
      preset: { bookingId: 'BK-A-1002', type: 'cancel_visits', visitIds: ['BK-A-1002-V1'], at: '2026-11-23T22:00' },
      expect: 'الحد الأدنى للشريحة مشمول: قبل 12:00 ساعة بالضبط ← شريحة "12 ساعة فأكثر" بدون رسوم. عند 10:01 م (11:59 ساعة) تُطبّق 25%.',
      checks: [{ label: 'عند 12 ساعة بالضبط: رسوم 0', fn: function (r) { return r.officeFee === 0 && r.serviceRefund === 35000; } }] },
    { id: 'F', title: 'F — المكتب يلغي زيارة مدفوعة', office: 'A', route: 'simulator',
      preset: { bookingId: 'BK-A-1004', type: 'office_cancel', visitIds: ['BK-A-1004-V1'], remedy: 'refund', at: '2026-11-23T09:00' },
      expect: 'لا رسوم على العميل؛ استرداد كامل (خدمة 205 + ضريبة 30.75 + رسوم JOKRS 15). البديل: موعد بديل بموافقة العميل (انظر الطلب المفتوح على نفس الحجز).',
      checks: [{ label: 'رسوم العميل = 0', fn: function (r) { return r.officeFee === 0; } }, { label: 'استرداد كامل 250.75', fn: function (r) { return r.totalRefund === 25075; } }] },
    { id: 'G', title: 'G — إعادة رصيد زيارة مرنة', office: 'C', route: 'simulator',
      preset: { bookingId: 'BK-C-1001', type: 'credit_cancel', visitIds: ['BK-C-1001-V4'], at: '2026-11-23T09:00' },
      expect: 'يُعاد الاستحقاق إلى الرصيد دون أي استرداد نقدي، وتبقى الصلاحية كما هي (13 يناير 2027).',
      checks: [{ label: 'بدون مبلغ نقدي', fn: function (r) { return r.totalRefund === 0 && r.destinations.length === 0; } }, { label: 'الرصيد مُعاد', fn: function (r) { return r.creditOutcome === 'restored' && r.effects.credits[0].newState === 'available'; } }] },
    { id: 'H1', title: 'H — تعذّر استقبال مع إثباتات', office: 'B', route: 'request', requestRef: 'R-B-2001', role: 'operations',
      expect: 'الطلب ينتظر مراجعة العمليات؛ الإثباتات مرفقة. الاعتماد يحتسب 50% وفق السياسة، ولا يُعرض كزيارة منفذة.' },
    { id: 'H2', title: 'H — تعذّر استقبال متنازع عليه', office: 'B', route: 'request', requestRef: 'R-B-2002', role: 'operations',
      expect: 'لا قرار آلي. الاعتماد ضد العميل يتطلب سبباً مكتوباً، ويمكن الحسم لصالح العميل.' },
    { id: 'I', title: 'I — تنفيذ جزئي: عاملتان وحضرت واحدة', office: 'B', route: 'simulator',
      preset: { bookingId: 'BK-B-1005', type: 'partial_delivery', visitIds: ['BK-B-1005-V1'], deliveredWorkerIds: ['BK-B-1005-V1-W1'], at: '2026-11-23T09:00', initiator: 'office' },
      expect: 'تُسترد حصة العاملة غير الحاضرة كاملة (215 ر.س + الضريبة + حصة رسوم JOKRS) دون رسوم.',
      checks: [{ label: 'استرداد الخدمة = 215.00', fn: function (r) { return r.serviceRefund === 21500 && r.officeFee === 0; } }] },
    { id: 'J1', title: 'J — زيارة ترويجية مجانية', office: 'A', route: 'simulator',
      preset: { bookingId: 'BK-A-1007', type: 'cancel_visits', visitIds: ['BK-A-1007-V5'], at: '2026-11-23T09:00' },
      expect: 'الزيارة الترويجية بلا قيمة نقدية مستقلة: الإلغاء لا ينتج مبلغاً.',
      checks: [{ label: 'لا مبلغ نقدي', fn: function (r) { return r.totalRefund === 0; } }] },
    { id: 'J2', title: 'J — زيارة بديلة لزيارة مدفوعة', office: 'A', route: 'simulator',
      preset: { bookingId: 'BK-A-1007', type: 'cancel_visits', visitIds: ['BK-A-1007-V1-R'], at: '2026-11-23T09:00' },
      expect: 'الزيارة البديلة تحتفظ بقيمة الزيارة الأصلية المدفوعة (250 ر.س) — تُسترد عند إلغائها في الشريحة المجانية.',
      checks: [{ label: 'استرداد الخدمة = 250.00', fn: function (r) { return r.serviceRefund === 25000; } }] },
    { id: 'K', title: 'K — حجز قديم يحتفظ بالنسخة 1', office: 'A', route: 'policy', policyId: 'P-A-01',
      expect: 'BK-A-1003 قُبل على النسخة 1 ويحتفظ بها رغم نشر النسختين 2 و3.' },
    { id: 'L', title: 'L — استرداد فاشل ثم إعادة المحاولة', office: 'A', route: 'refund', refundRef: 'RF-A-3004', role: 'finance',
      expect: 'أعد المحاولة ثم أكّد نجاح المزوّد. الإشعار المكرر لا يضيف أي مبلغ.' },
    { id: 'M', title: 'M — استرداد جزئي سابق يقلل المتبقي', office: 'A', route: 'simulator',
      preset: { bookingId: 'BK-A-1006', type: 'cancel_all_remaining', at: '2026-11-23T09:00' },
      expect: 'قيمة الزيارتين المفتوحتين 500 ر.س، لكن رُدّ سابقاً 150 ر.س؛ المؤهل 350 − رسوم 200 = 150 ر.س.',
      checks: [{ label: 'المؤهل = 350.00', fn: function (r) { return r.eligible === 35000; } }, { label: 'استرداد الخدمة = 150.00', fn: function (r) { return r.serviceRefund === 15000; } }] },
    { id: 'N', title: 'N — تغيّر أسعار التكلفة لا يغيّر الحجز', office: 'A', route: 'checkout',
      expect: 'استخدم "محاكاة تغيّر أسعار التكلفة" ثم قارن: السعر الجديد يظهر في الدفع، بينما يحتفظ BK-A-1002 بتخصيصاته.' }
  ];
})(typeof window !== 'undefined' ? window : globalThis);

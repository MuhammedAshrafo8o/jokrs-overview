/* =====================================================================
   JOKRS — Cancellation, Refunds & Rescheduling (frontend simulation)
   engine.js — pure rules & money engine. No DOM access.
   All money values are integer halalas (1 SAR = 100 halalas).
   ONE shared calculation function (calculate) is used by: the policy
   simulator, the policy-builder simulation, the customer cancellation
   preview, office request decisions and refund creation.
   ===================================================================== */
(function (G) {
  'use strict';
  var JK = (G.JK = G.JK || {});
  var MIN = 60000, HOUR = 3600000, DAY = 86400000, RIYADH = 3 * HOUR;

  /* ------------------------------------------------------------------ */
  /* Money                                                               */
  /* ------------------------------------------------------------------ */
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }

  /** Deterministic largest-remainder allocation. Parts always sum to total.
   *  Ties are broken by the lowest index so results never vary between runs. */
  function allocate(total, weights) {
    if (!Number.isInteger(total) || total < 0) throw new Error('allocate: total must be a non-negative integer (halalas)');
    var n = weights.length;
    if (!n) return [];
    var w = weights.map(function (x) { return Math.max(0, Math.round(x || 0)); });
    var ws = sum(w);
    if (ws === 0) { w = w.map(function () { return 1; }); ws = n; }
    var base = w.map(function (x) { return Math.floor((total * x) / ws); });
    var rems = w.map(function (x, i) { return { i: i, r: total * x - base[i] * ws }; });
    var left = total - sum(base);
    rems.sort(function (a, b) { return b.r - a.r || a.i - b.i; });
    for (var k = 0; k < left; k++) base[rems[k].i]++;
    return base;
  }

  /** percentage of a halala base, pct may have up to 2 decimals; rounds half up */
  function pctOf(base, pct) {
    var bp = Math.round(Number(pct) * 100); // basis points * 1
    return Math.floor((base * bp + 5000) / 10000);
  }

  var NF = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** SAR display. The signed number is wrapped in LTR isolates so it renders correctly inside RTL text. */
  function sar(h) {
    if (h === null || h === undefined || isNaN(h)) return '—';
    var neg = h < 0;
    return '⁦' + (neg ? '-' : '') + NF.format(Math.abs(h) / 100) + '⁩ ر.س';
  }
  function parseSAR(str) {
    var s = String(str == null ? '' : str).trim().replace(/[,\s]/g, '').replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    var parts = s.split('.');
    return parseInt(parts[0], 10) * 100 + (parts[1] ? parseInt((parts[1] + '0').slice(0, 2), 10) : 0);
  }
  function halalasToInput(h) { return (h / 100).toFixed(2).replace(/\.00$/, ''); }
  function fmtPct(p) { return '⁦' + (Math.round(p * 100) / 100) + '%⁩'; }

  /* ------------------------------------------------------------------ */
  /* Dates — Asia/Riyadh (UTC+3, no DST)                                 */
  /* ------------------------------------------------------------------ */
  function mkFmt(opts) {
    try { return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', Object.assign({ timeZone: 'Asia/Riyadh' }, opts)); }
    catch (e) { return null; }
  }
  var F_FULL = mkFmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  var F_SHORT = mkFmt({ day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  var F_DATE = mkFmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  var F_TIME = mkFmt({ hour: 'numeric', minute: '2-digit' });
  function fallbackFmt(t) { return new Date(t + RIYADH).toISOString().slice(0, 16).replace('T', ' '); }
  function _f(fmt, v) {
    if (v === null || v === undefined || v === '') return '—';
    var t = typeof v === 'number' ? v : Date.parse(v);
    if (isNaN(t)) return '—';
    return fmt ? fmt.format(new Date(t)) : fallbackFmt(t);
  }
  function fmtDT(v) { return _f(F_FULL, v); }
  function fmtDTs(v) { return _f(F_SHORT, v); }
  function fmtDate(v) { return _f(F_DATE, v); }
  function fmtTime(v) { return _f(F_TIME, v); }
  /** 'YYYY-MM-DD HH:mm' (Riyadh wall clock) → ISO UTC */
  function riyadhISO(s) {
    var str = String(s).replace(' ', 'T');
    if (str.length === 16) str += ':00';
    var t = Date.parse(str + 'Z');
    if (isNaN(t)) return null;
    return new Date(t - RIYADH).toISOString();
  }
  /** ISO → 'YYYY-MM-DDTHH:mm' in Riyadh wall clock, for datetime-local inputs */
  function toRiyadhInput(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    return new Date(t + RIYADH).toISOString().slice(0, 16);
  }
  function addDays(iso, n, type) {
    var t = Date.parse(iso);
    if (type !== 'business') return new Date(t + n * DAY).toISOString();
    var added = 0;
    while (added < n) {
      t += DAY;
      var dow = new Date(t + RIYADH).getUTCDay(); // Riyadh weekday; Fri=5, Sat=6 are weekend
      if (dow !== 5 && dow !== 6) added++;
    }
    return new Date(t).toISOString();
  }
  function durText(ms) {
    var neg = ms < 0; ms = Math.abs(ms);
    var d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / MIN);
    var parts = [];
    if (d) parts.push(d + ' يوم');
    if (h) parts.push(h + ' ساعة');
    if (m || !parts.length) parts.push(m + ' دقيقة');
    return (neg ? 'منذ ' : '') + parts.join(' و');
  }

  /* ------------------------------------------------------------------ */
  /* Labels                                                              */
  /* ------------------------------------------------------------------ */
  var L = {
    bookingType: { single: 'زيارة مفردة', scheduled: 'باقة زيارات مجدولة', credits: 'باقة رصيد زيارات مرن' },
    feeType: { none: 'بدون رسوم', fixed: 'مبلغ ثابت مرة واحدة لكل عملية', fixed_per_visit: 'مبلغ ثابت عن كل زيارة ملغاة', percent: 'نسبة مئوية من أساس محدد', consume: 'احتساب الزيارة مستهلكة (بلا استرداد)', unset: 'غير محددة' },
    feeBase: { affected_allocation: 'القيمة المخصصة للزيارات المتأثرة', remaining_value: 'القيمة المتبقية المؤهلة في الباقة' },
    feeBaseCustomer: { affected_allocation: 'قيمة الزيارة الملغاة', remaining_value: 'قيمة الزيارات المتبقية المؤهلة' },
    versionStatus: { draft: 'مسودة', pending_review: 'بانتظار مراجعة المنصة', published: 'منشورة', rejected: 'مطلوب تعديلات' },
    requestType: {
      cancel_visits: 'إلغاء زيارة / زيارات محددة', cancel_all_remaining: 'إلغاء جميع الزيارات المتبقية', reschedule: 'إعادة جدولة زيارة',
      office_cancel: 'إلغاء أو تعذّر من المكتب', no_show: 'تعذّر استقبال العاملة', partial_delivery: 'تنفيذ جزئي للخدمة',
      quality_issue: 'مشكلة بعد بدء الخدمة', credit_cancel: 'إلغاء موعد من الرصيد', package_refund: 'استرداد قيمة الباقة', exception_review: 'مراجعة استثنائية / حقوقية'
    },
    requestStatus: { awaiting_review: 'بانتظار المراجعة', info_requested: 'بانتظار معلومات من العميل', proposal_sent: 'بانتظار رد العميل على المقترح', override_sent: 'بانتظار موافقة العميل على المبلغ المعدّل', approved: 'معتمد', auto_approved: 'معتمد آلياً', rejected: 'مرفوض' },
    refundState: { awaiting_review: 'بانتظار مراجعة المالية', approved: 'معتمد — بانتظار التنفيذ', processing: 'قيد المعالجة', completed: 'مكتمل', failed: 'فشل', not_required: 'غير مطلوب' },
    cause: { customer: 'العميل', office: 'المكتب', disputed: 'متنازع عليه', external: 'ظرف خارجي / سلامة', none: '—' },
    initiator: { customer: 'العميل', office: 'المكتب', platform: 'المنصة' },
    role: { admin: 'مدير المكتب', operations: 'العمليات', finance: 'المالية', viewer: 'مشاهد (قراءة فقط)', customer: 'العميل (محاكاة)', platform: 'مراجع المنصة (محاكاة)', system: 'النظام' },
    visitStatus: { scheduled: 'مجدولة', completed: 'منفذة', canceled: 'ملغاة', customer_no_show: 'تعذّر الاستقبال — لم تُنفذ', partially_delivered: 'منفذة جزئياً', office_canceled: 'ألغاها المكتب', replaced: 'استُبدلت بموعد بديل', canceled_late: 'ملغاة متأخراً — احتُسب الرصيد' },
    origin: { paid: 'مدفوعة', promo: 'ترويجية مجانية', replacement: 'بديلة لزيارة مدفوعة', credit: 'من الرصيد' },
    creditState: { available: 'متاح', scheduled: 'محجوز لموعد', used: 'مستخدم', refunded: 'مسترد نقداً', expired: 'منتهي الصلاحية', forfeited: 'احتُسب بسبب إلغاء متأخر' },
    payMethod: { card: 'بطاقة (مدى/ائتمان)', apple_pay: 'Apple Pay', wallet: 'محفظة العميل', stc_pay: 'محفظة رقمية' },
    destAction: { refund_capture: 'استرداد مبلغ مُحصّل', release_authorization: 'إلغاء تفويض غير مُحصّل', wallet_credit: 'إضافة رصيد نقدي للمحفظة', credit_restore: 'إعادة استحقاق زيارة' },
    precedence: { 1: 'قيود المنصة الإلزامية والاستثناءات المعتمدة', 2: 'قواعد خلل المكتب', 3: 'سياسة الحجز المقبولة', 4: 'فترة السماح / شريحة الوقت حسب الأولوية', 5: 'القاعدة الاحتياطية الصريحة' }
  };

  /* ------------------------------------------------------------------ */
  /* Policy rules: defaults, fees, bands                                 */
  /* ------------------------------------------------------------------ */
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  function defaultRules(type) {
    return {
      cancel: {
        allowSingleVisit: true,
        allowSelectedVisits: type === 'scheduled',
        allowAllRemaining: type === 'scheduled',
        allowPartialWorkers: false,
        pendingAcceptance: 'free',
        grace: { enabled: false, minutes: 15, minLeadHours: 6 },
        bands: [
          { id: 'b1', minHours: 24, maxHours: null, fee: { type: 'none' } },
          { id: 'b2', minHours: 0, maxHours: 24, fee: { type: 'percent', pct: 25, base: 'affected_allocation', cap: 0 } }
        ],
        fallback: { type: 'unset' },
        packageBeforeStart: { type: 'none' },
        packageAfterStart: { type: 'fixed', amount: 10000, cap: 0 },
        packageVsBand: 'greater_of'
      },
      reschedule: {
        enabled: true, minNoticeHours: 24, maxPerVisit: 1,
        sizeLimits: [{ upToVisits: null, maxChanges: type === 'single' ? 1 : 2 }],
        freeChanges: type === 'single' ? 1 : 2, feeAfterFree: 0,
        latestReplacementDays: 14, allowRepeatOnRescheduled: false, lockLateBand: true,
        requireCustomerAcceptanceForWorkerChange: true
      },
      exceptions: {
        arrivalToleranceMin: 30,
        officeFaultRemedy: 'customer_choice',
        noShow: { fee: { type: 'percent', pct: 50, base: 'affected_allocation', cap: 0 }, requireEvidence: true },
        unsafe: 'review_no_fee',
        serviceIssue: 'review',
        partialDelivery: 'pro_rata'
      },
      refund: { destinationDefault: 'original', allowWallet: true, processingDays: 5, dayType: 'business', reviewTargetHours: 24, extraText: '' },
      credits: type === 'credits' ? {
        restoreMinNoticeHours: 6, lateAction: 'consume', expiryOnRestore: 'keep', extendDays: 0, officeFaultExtendDays: 14,
        refundBeforeUse: { type: 'percent', pct: 10, base: 'remaining_value', cap: 0 },
        refundAfterUse: { type: 'fixed', amount: 7500, cap: 0 },
        expiredRefundable: false
      } : null
    };
  }

  function evalFee(fee, ctx) {
    if (!fee || fee.type === 'none') return { amount: 0, text: 'بدون رسوم' };
    var amt = 0, text = '';
    switch (fee.type) {
      case 'fixed': amt = fee.amount | 0; text = sar(fee.amount) + ' مرة واحدة لهذه العملية'; break;
      case 'fixed_per_visit': amt = (fee.amount | 0) * ctx.visits; text = sar(fee.amount) + ' × ' + ctx.visits + ' زيارة'; break;
      case 'percent': {
        var base = fee.base === 'remaining_value' ? ctx.remaining : ctx.affected;
        amt = pctOf(base, fee.pct);
        text = fmtPct(fee.pct) + ' من ' + (L.feeBase[fee.base] || 'أساس غير محدد') + ' (' + sar(base) + ')';
        break;
      }
      case 'consume': amt = ctx.affected; text = 'احتساب الزيارة مستهلكة — قيمة الزيارة ' + sar(ctx.affected); break;
      default: throw new Error('نوع رسوم غير معروف: ' + fee.type);
    }
    if (fee.cap > 0 && fee.type !== 'consume' && amt > fee.cap) { amt = fee.cap; text += ' — بحد أقصى ' + sar(fee.cap); }
    return { amount: amt, text: text };
  }

  function describeFee(fee, customer) {
    if (!fee || fee.type === 'none') return 'بدون رسوم';
    var s;
    switch (fee.type) {
      case 'fixed': s = sar(fee.amount) + ' مرة واحدة لكل عملية إلغاء'; break;
      case 'fixed_per_visit': s = sar(fee.amount) + ' عن كل زيارة ملغاة'; break;
      case 'percent': s = fmtPct(fee.pct) + ' من ' + ((customer ? L.feeBaseCustomer : L.feeBase)[fee.base] || 'أساس غير محدد'); break;
      case 'consume': s = customer ? 'تُحتسب الزيارة مستهلكة دون استرداد قيمتها' : 'احتساب الزيارة مستهلكة (يتطلب سماح المنصة)'; break;
      case 'unset': return 'غير محددة';
      default: return '—';
    }
    if (fee.cap > 0 && fee.type !== 'consume') s += '، بحد أقصى ' + sar(fee.cap);
    return s;
  }

  function hoursTxt(h) { return (Math.round(h * 100) / 100) + ' ساعة'; }
  function bandLabel(b) {
    if (b.maxHours === null || b.maxHours === undefined || b.maxHours === '') return hoursTxt(b.minHours) + ' فأكثر قبل الزيارة';
    if (!b.minHours) return 'أقل من ' + hoursTxt(b.maxHours) + ' قبل الزيارة';
    return 'من ' + hoursTxt(b.minHours) + ' إلى أقل من ' + hoursTxt(b.maxHours);
  }
  /** Bands: lower bound INCLUSIVE, upper bound EXCLUSIVE. Measured in ms until the visit start. */
  function matchBand(bands, msBefore) {
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var lo = b.minHours * HOUR;
      var hi = b.maxHours === null || b.maxHours === undefined || b.maxHours === '' ? Infinity : b.maxHours * HOUR;
      if (msBefore >= lo && msBefore < hi) return b;
    }
    return null;
  }
  function sortedBands(bands) { return bands.slice().sort(function (a, b) { return b.minHours - a.minHours; }); }

  function sizeLimit(rs, visitCount) {
    var lim = (rs.sizeLimits || []).slice().sort(function (a, b) {
      var av = a.upToVisits == null ? Infinity : a.upToVisits, bv = b.upToVisits == null ? Infinity : b.upToVisits; return av - bv;
    });
    for (var i = 0; i < lim.length; i++) {
      var up = lim[i].upToVisits == null ? Infinity : lim[i].upToVisits;
      if (visitCount <= up) return lim[i].maxChanges;
    }
    return 0;
  }

  /* ------------------------------------------------------------------ */
  /* Validation                                                          */
  /* ------------------------------------------------------------------ */
  function isInt(x) { return typeof x === 'number' && Number.isInteger(x); }

  function validateFee(fee, allowed, where, errs, step, platform) {
    if (!fee || !fee.type || fee.type === 'unset') { errs.push({ step: step, msg: where + ': اختر نوع الرسوم.' }); return; }
    if (allowed.indexOf(fee.type) < 0) { errs.push({ step: step, msg: where + ': نوع الرسوم "' + (L.feeType[fee.type] || fee.type) + '" غير مسموح هنا.' }); return; }
    if (fee.type === 'fixed' || fee.type === 'fixed_per_visit') {
      if (!isInt(fee.amount)) errs.push({ step: step, msg: where + ': أدخل مبلغاً صحيحاً بالريال (حتى خانتين عشريتين).' });
      else if (fee.amount < 0) errs.push({ step: step, msg: where + ': لا يمكن أن تكون الرسوم سالبة.' });
    }
    if (fee.type === 'percent') {
      if (typeof fee.pct !== 'number' || isNaN(fee.pct)) errs.push({ step: step, msg: where + ': أدخل النسبة المئوية.' });
      else if (fee.pct < 0 || fee.pct > 100) errs.push({ step: step, msg: where + ': النسبة يجب أن تكون بين 0% و100%.' });
      if (!fee.base || !L.feeBase[fee.base]) errs.push({ step: step, msg: where + ': حدّد أساس احتساب النسبة صراحةً (لا يوجد خيار "نسبة من الحجز" دون أساس).' });
    }
    if (fee.cap !== undefined && fee.cap !== null && fee.cap !== 0) {
      if (!isInt(fee.cap) || fee.cap < 0) errs.push({ step: step, msg: where + ': الحد الأقصى يجب أن يكون مبلغاً موجباً.' });
    }
    if (fee.type === 'consume' && platform && !platform.rules.allowConsumeEntitlement) {
      errs.push({ step: step, msg: where + ': قواعد المنصة الحالية لا تسمح باحتساب الزيارة مستهلكة.' });
    }
  }

  function validateBands(bands, fallback, errs) {
    if (!bands || !bands.length) { errs.push({ step: 2, msg: 'أضف شريحة زمنية واحدة على الأقل أو قاعدة احتياطية.' }); return; }
    var s = bands.slice().sort(function (a, b) { return a.minHours - b.minHours; });
    var gaps = [];
    s.forEach(function (b) {
      if (typeof b.minHours !== 'number' || isNaN(b.minHours) || b.minHours < 0) errs.push({ step: 2, msg: 'بداية الشريحة يجب أن تكون صفراً أو أكثر.' });
      if (b.maxHours !== null && b.maxHours !== undefined && (typeof b.maxHours !== 'number' || b.maxHours <= b.minHours)) errs.push({ step: 2, msg: 'نهاية الشريحة (' + b.maxHours + ' ساعة) يجب أن تكون أكبر من بدايتها (' + b.minHours + ' ساعة).' });
    });
    for (var i = 0; i < s.length; i++) {
      var cur = s[i], next = s[i + 1];
      if (i === 0 && cur.minHours > 0) gaps.push('من 0 إلى ' + cur.minHours + ' ساعة');
      if (next) {
        if (cur.maxHours === null || cur.maxHours === undefined) errs.push({ step: 2, msg: 'تداخل: الشريحة "' + bandLabel(cur) + '" مفتوحة النهاية وتتداخل مع "' + bandLabel(next) + '".' });
        else if (cur.maxHours > next.minHours) errs.push({ step: 2, msg: 'تداخل بين "' + bandLabel(cur) + '" و"' + bandLabel(next) + '".' });
        else if (cur.maxHours < next.minHours) gaps.push('من ' + cur.maxHours + ' إلى ' + next.minHours + ' ساعة');
      } else if (cur.maxHours !== null && cur.maxHours !== undefined) gaps.push('من ' + cur.maxHours + ' ساعة فأكثر');
    }
    if (gaps.length && (!fallback || fallback.type === 'unset')) errs.push({ step: 2, msg: 'فترات غير مغطاة (' + gaps.join('، ') + ') دون قاعدة احتياطية صريحة.' });
    return gaps;
  }

  function restrictedReasons(rules, type, platform) {
    var out = [], rr = platform.rules.reviewRequiredFor || {};
    function chk(fee, where, pkg) {
      if (!fee) return;
      if (fee.type === 'consume' && rr.consume) out.push(where + ': احتساب الزيارة مستهلكة يتطلب مراجعة المنصة.');
      if (fee.type === 'percent') {
        if (!pkg && rr.visitFeePctAbove != null && fee.pct > rr.visitFeePctAbove) out.push(where + ': نسبة ' + fee.pct + '% أعلى من ' + rr.visitFeePctAbove + '% وتتطلب مراجعة.');
        if (pkg && rr.packageFeePctAbove != null && fee.pct > rr.packageFeePctAbove) out.push(where + ': نسبة ' + fee.pct + '% أعلى من ' + rr.packageFeePctAbove + '% وتتطلب مراجعة.');
      }
    }
    if (type !== 'credits') (rules.cancel.bands || []).forEach(function (b) { chk(b.fee, 'شريحة ' + bandLabel(b)); });
    chk(rules.cancel.fallback, 'القاعدة الاحتياطية');
    if (type === 'scheduled') { chk(rules.cancel.packageBeforeStart, 'إلغاء الباقة قبل البدء', true); chk(rules.cancel.packageAfterStart, 'إلغاء الباقة بعد البدء', true); }
    chk(rules.exceptions.noShow.fee, 'تعذّر الاستقبال');
    if (type === 'credits' && rules.credits) {
      if (rules.credits.lateAction === 'consume' && rr.consume) out.push('الإلغاء المتأخر للرصيد: احتساب الرصيد مستهلكاً يتطلب مراجعة المنصة.');
      chk(rules.credits.refundBeforeUse, 'استرداد الباقة قبل الاستخدام', true);
      chk(rules.credits.refundAfterUse, 'استرداد الباقة بعد الاستخدام', true);
    }
    return out;
  }

  /** Full validation of a policy version. opts: {forPublish, now} */
  function validatePolicy(meta, rules, platform, opts) {
    opts = opts || {};
    var errs = [], warns = [], type = meta.bookingType;
    // Step 1
    if (!meta.name || meta.name.trim().length < 3) errs.push({ step: 1, msg: 'اسم السياسة بالعربية مطلوب (3 أحرف على الأقل).' });
    if (!L.bookingType[type]) errs.push({ step: 1, msg: 'اختر نوع الحجز المطبق.' });
    var ef = Date.parse(meta.effectiveFrom);
    if (!meta.effectiveFrom || isNaN(ef)) errs.push({ step: 1, msg: 'تاريخ بدء السريان مطلوب.' });
    if (meta.effectiveTo) {
      var et = Date.parse(meta.effectiveTo);
      if (isNaN(et)) errs.push({ step: 1, msg: 'تاريخ الانتهاء غير صالح.' });
      else if (!isNaN(ef) && et <= ef) errs.push({ step: 1, msg: 'تاريخ انتهاء السريان يجب أن يكون بعد تاريخ البدء.' });
    }
    if (opts.forPublish && !isNaN(ef) && opts.now && ef < Date.parse(opts.now) - MIN) {
      errs.push({ step: 1, msg: 'تاريخ السريان (' + fmtDTs(ef) + ') يسبق وقت النشر. النسخ الجديدة لا تُطبّق بأثر رجعي؛ اختر وقتاً حالياً أو مستقبلياً.' });
    }
    if (!rules) { errs.push({ step: 2, msg: 'لا توجد قواعد.' }); return { errors: errs, warnings: warns, restricted: [] }; }
    var c = rules.cancel;
    // Step 2
    if (type !== 'credits') {
      if (!c.allowSingleVisit && !c.allowAllRemaining && !c.allowSelectedVisits) errs.push({ step: 2, msg: 'يجب السماح بنوع واحد على الأقل من الإلغاء.' });
      validateBands(c.bands, c.fallback, errs);
      (c.bands || []).forEach(function (b) { validateFee(b.fee, ['none', 'fixed_per_visit', 'percent', 'consume'], 'شريحة ' + bandLabel(b), errs, 2, platform); });
      if (c.fallback && c.fallback.type !== 'unset') validateFee(c.fallback, ['none', 'fixed_per_visit', 'percent', 'consume'], 'القاعدة الاحتياطية', errs, 2, platform);
    }
    if (c.grace && c.grace.enabled) {
      if (!isInt(c.grace.minutes) || c.grace.minutes < 1 || c.grace.minutes > 1440) errs.push({ step: 2, msg: 'مدة فترة السماح يجب أن تكون بين 1 و1440 دقيقة.' });
      if (typeof c.grace.minLeadHours !== 'number' || c.grace.minLeadHours < 0) errs.push({ step: 2, msg: 'الحد الأدنى للمدة قبل الزيارة في فترة السماح يجب أن يكون صفراً أو أكثر.' });
    }
    if (platform.rules.minGraceMinutes > 0 && (!c.grace || !c.grace.enabled || c.grace.minutes < platform.rules.minGraceMinutes)) {
      warns.push('قيد المنصة: فترة سماح لا تقل عن ' + platform.rules.minGraceMinutes + ' دقيقة ستُطبّق تلقائياً بغض النظر عن إعداد المكتب.');
    }
    if (type === 'scheduled') {
      validateFee(c.packageBeforeStart, ['none', 'fixed', 'fixed_per_visit', 'percent'], 'إلغاء الباقة قبل البدء', errs, 2, platform);
      validateFee(c.packageAfterStart, ['none', 'fixed', 'fixed_per_visit', 'percent'], 'إلغاء الباقة بعد البدء', errs, 2, platform);
      [c.packageBeforeStart, c.packageAfterStart].forEach(function (f) {
        if (f && f.type === 'fixed') warns.push('الرسوم الثابتة للباقة (' + sar(f.amount) + ') ستُحدّ تلقائياً بالقيمة المؤهلة عند الإلغاء — لا يوجد نموذج مديونية.');
      });
    }
    if (type === 'credits') {
      var cr = rules.credits;
      if (!cr) errs.push({ step: 2, msg: 'قواعد الرصيد المرن مطلوبة لهذا النوع.' });
      else {
        if (typeof cr.restoreMinNoticeHours !== 'number' || cr.restoreMinNoticeHours < 0) errs.push({ step: 2, msg: 'مهلة إعادة الرصيد يجب أن تكون صفراً أو أكثر.' });
        if (['consume', 'restore'].indexOf(cr.lateAction) < 0) errs.push({ step: 2, msg: 'حدّد ما يحدث عند الإلغاء المتأخر للموعد.' });
        if (cr.lateAction === 'consume' && !platform.rules.allowConsumeEntitlement) errs.push({ step: 2, msg: 'قواعد المنصة لا تسمح باحتساب الرصيد مستهلكاً.' });
        if (cr.expiryOnRestore === 'extend' && (!isInt(cr.extendDays) || cr.extendDays < 1)) errs.push({ step: 2, msg: 'حدّد عدد أيام تمديد الصلاحية عند إعادة الرصيد.' });
        if (!isInt(cr.officeFaultExtendDays) || cr.officeFaultExtendDays < 0) errs.push({ step: 2, msg: 'أيام التمديد عند خلل المكتب يجب أن تكون صفراً أو أكثر.' });
        validateFee(cr.refundBeforeUse, ['none', 'fixed', 'percent'], 'استرداد الباقة قبل الاستخدام', errs, 2, platform);
        validateFee(cr.refundAfterUse, ['none', 'fixed', 'percent'], 'استرداد الباقة بعد الاستخدام', errs, 2, platform);
      }
    }
    // Step 3
    var rs = rules.reschedule;
    if (rs && rs.enabled) {
      if (typeof rs.minNoticeHours !== 'number' || rs.minNoticeHours < 0) errs.push({ step: 3, msg: 'الحد الأدنى للإشعار المسبق مطلوب (صفر أو أكثر).' });
      if (!isInt(rs.maxPerVisit) || rs.maxPerVisit < 1) errs.push({ step: 3, msg: 'الحد الأقصى للتعديلات لكل زيارة يجب أن يكون 1 أو أكثر.' });
      if (!rs.sizeLimits || !rs.sizeLimits.length) errs.push({ step: 3, msg: 'حدّد حدود التعديل حسب حجم الباقة.' });
      else {
        var open = rs.sizeLimits.filter(function (x) { return x.upToVisits === null || x.upToVisits === undefined; });
        if (open.length !== 1) errs.push({ step: 3, msg: 'يجب أن تحتوي حدود حجم الباقة على صف واحد مفتوح ("أي حجم أكبر").' });
        rs.sizeLimits.forEach(function (x) {
          if (!isInt(x.maxChanges) || x.maxChanges < 0) errs.push({ step: 3, msg: 'عدد التعديلات المسموح يجب أن يكون صفراً أو أكثر.' });
          if (x.upToVisits !== null && x.upToVisits !== undefined && (!isInt(x.upToVisits) || x.upToVisits < 1)) errs.push({ step: 3, msg: 'حجم الباقة في حدود التعديل يجب أن يكون عدداً صحيحاً موجباً.' });
        });
        var seen = {};
        rs.sizeLimits.forEach(function (x) { var k = String(x.upToVisits); if (seen[k]) errs.push({ step: 3, msg: 'حجم باقة مكرر في حدود التعديل.' }); seen[k] = 1; });
      }
      if (!isInt(rs.freeChanges) || rs.freeChanges < 0) errs.push({ step: 3, msg: 'عدد التعديلات المجانية مطلوب (صفر أو أكثر).' });
      if (!isInt(rs.feeAfterFree) || rs.feeAfterFree < 0) errs.push({ step: 3, msg: 'رسوم التعديل بعد المجاني يجب أن تكون مبلغاً غير سالب.' });
      if (!isInt(rs.latestReplacementDays) || rs.latestReplacementDays < 1) errs.push({ step: 3, msg: 'آخر موعد بديل مسموح (بالأيام) مطلوب.' });
    }
    // Step 4
    var ex = rules.exceptions;
    if (!isInt(ex.arrivalToleranceMin) || ex.arrivalToleranceMin < 0 || ex.arrivalToleranceMin > 240) errs.push({ step: 4, msg: 'مهلة التأخر المقبولة يجب أن تكون بين 0 و240 دقيقة.' });
    validateFee(ex.noShow.fee, ['none', 'fixed_per_visit', 'percent', 'consume'], 'رسوم تعذّر الاستقبال', errs, 4, platform);
    if (ex.noShow.fee && ex.noShow.fee.type !== 'none' && !ex.noShow.requireEvidence) errs.push({ step: 4, msg: 'لا يمكن فرض رسوم تعذّر الاستقبال دون اشتراط الإثبات والمراجعة.' });
    // Step 5
    var rf = rules.refund;
    if (rf.destinationDefault !== 'original') errs.push({ step: 5, msg: 'الوجهة الافتراضية للاسترداد يجب أن تكون وسيلة الدفع الأصلية.' });
    if (!isInt(rf.processingDays) || rf.processingDays < 1 || rf.processingDays > 30) errs.push({ step: 5, msg: 'مدة معالجة الاسترداد يجب أن تكون بين 1 و30 يوماً.' });
    if (['business', 'calendar'].indexOf(rf.dayType) < 0) errs.push({ step: 5, msg: 'حدّد نوع الأيام (أيام عمل أو أيام تقويمية).' });
    if (!isInt(rf.reviewTargetHours) || rf.reviewTargetHours < 1 || rf.reviewTargetHours > 168) errs.push({ step: 5, msg: 'هدف المراجعة الداخلية يجب أن يكون بين 1 و168 ساعة.' });
    if (rf.extraText && /\d+\s*(%|ريال|ر\.س|SAR)/.test(rf.extraText)) warns.push('النص الإضافي يحتوي أرقاماً مالية. النص الإضافي لا يغيّر القواعد المحسوبة — تأكد من عدم تعارضه معها.');
    return { errors: errs, warnings: warns, restricted: restrictedReasons(rules, type, platform) };
  }

  /* ------------------------------------------------------------------ */
  /* Policy resolution: package → service → office default               */
  /* ------------------------------------------------------------------ */
  function effectiveVersion(policy, atISO) {
    if (!policy) return null;
    var at = Date.parse(atISO), best = null;
    policy.versions.forEach(function (v) {
      if (v.status !== 'published') return;
      if (Date.parse(v.effectiveFrom) > at) return;
      if (v.effectiveTo && Date.parse(v.effectiveTo) <= at) return;
      if (!best || v.version > best.version) best = v;
    });
    return best;
  }
  function scheduledVersions(policy, atISO) {
    var at = Date.parse(atISO);
    return policy.versions.filter(function (v) { return v.status === 'published' && Date.parse(v.effectiveFrom) > at; });
  }
  function findPackage(office, packageId) {
    for (var i = 0; i < office.services.length; i++) {
      var s = office.services[i];
      for (var j = 0; j < s.packages.length; j++) if (s.packages[j].id === packageId) return { service: s, pkg: s.packages[j] };
    }
    return null;
  }
  var LEVEL_LABEL = { package: 'تخصيص على مستوى الباقة', service: 'سياسة الخدمة', office_default: 'السياسة الافتراضية للمكتب' };
  function resolvePolicy(office, packageId, atISO) {
    var f = findPackage(office, packageId);
    if (!f) return { policy: null, tried: [], error: 'الباقة غير موجودة' };
    var type = f.pkg.bookingType, tried = [];
    var chain = [['package', packageId], ['service', f.service.id], ['office_default', null]];
    for (var i = 0; i < chain.length; i++) {
      var level = chain[i][0], target = chain[i][1];
      var a = office.assignments.filter(function (x) { return x.level === level && (x.targetId || null) === (target || null); });
      if (a.length > 1) { tried.push({ level: level, status: 'conflict', text: 'تعارض: أكثر من تخصيص بنفس المستوى' }); return { policy: null, tried: tried, conflict: true }; }
      a = a[0];
      if (!a) { tried.push({ level: level, status: 'none', text: 'لا يوجد تخصيص' }); continue; }
      var p = office.policies.filter(function (x) { return x.id === a.policyId; })[0];
      if (!p) { tried.push({ level: level, status: 'missing', text: 'السياسة غير موجودة' }); continue; }
      if (p.archived) { tried.push({ level: level, status: 'archived', policy: p, text: 'السياسة "' + p.name + '" مؤرشفة' }); continue; }
      if (p.bookingType !== type) { tried.push({ level: level, status: 'type_mismatch', policy: p, text: 'السياسة "' + p.name + '" لنوع ' + L.bookingType[p.bookingType] + ' والباقة ' + L.bookingType[type] }); continue; }
      var v = effectiveVersion(p, atISO);
      if (!v) { tried.push({ level: level, status: 'no_published', policy: p, text: 'لا توجد نسخة منشورة سارية للسياسة "' + p.name + '"' }); continue; }
      tried.push({ level: level, status: 'ok', policy: p, text: 'مطبّقة' });
      return { policy: p, version: v, source: level, sourceLabel: LEVEL_LABEL[level], assignment: a, tried: tried, service: f.service, pkg: f.pkg };
    }
    return { policy: null, tried: tried, service: f.service, pkg: f.pkg };
  }

  /* ------------------------------------------------------------------ */
  /* Booking finance                                                     */
  /* ------------------------------------------------------------------ */
  function workerOpen(w) { return w.alloc - (w.consumed || 0) - (w.refunded || 0) - (w.fee || 0) - (w.transferred || 0) - (w.absorbed || 0); }
  function visitOpen(v) { return sum(v.workers.map(workerOpen)); }
  function creditOpen(c) { return c.alloc - (c.consumed || 0) - (c.refunded || 0) - (c.fee || 0) - (c.absorbed || 0); }
  function bookingFinance(b) {
    var consumed = 0, refunded = 0, fees = 0;
    b.visits.forEach(function (v) { v.workers.forEach(function (w) { consumed += w.consumed || 0; refunded += w.refunded || 0; fees += w.fee || 0; }); });
    if (b.credits) b.credits.items.forEach(function (c) { consumed += c.consumed || 0; refunded += c.refunded || 0; fees += c.fee || 0; });
    var adjustments = sum((b.adjustments || []).map(function (a) { return a.amount; }));
    var settled = refunded + fees + adjustments;
    return {
      serviceNet: b.price.serviceNet, consumed: consumed, refunded: refunded, fees: fees, adjustments: adjustments, settled: settled,
      remaining: Math.max(0, b.price.serviceNet - consumed - settled),
      taxLeft: (b.price.vat || 0) - (b.taxRefunded || 0), jokrsLeft: (b.price.jokrsFee || 0) - (b.jokrsRefunded || 0)
    };
  }
  function paidVisitCount(b) {
    if (b.credits) return b.credits.items.length;
    return b.visits.filter(function (v) { return v.origin === 'paid'; }).length;
  }

  /* ------------------------------------------------------------------ */
  /* Availability                                                        */
  /* ------------------------------------------------------------------ */
  function checkAvailability(office, workerIds, startISO, durationMin, excludeVisitId) {
    var s = Date.parse(startISO), e = s + durationMin * MIN, conflicts = [];
    if (isNaN(s)) return { ok: false, conflicts: [{ text: 'وقت غير صالح' }] };
    var lh = new Date(s + RIYADH).getUTCHours(), le = new Date(e + RIYADH);
    var endMins = le.getUTCHours() * 60 + le.getUTCMinutes();
    if (lh < 7 || endMins > 22 * 60 || new Date(s + RIYADH).getUTCDate() !== le.getUTCDate()) conflicts.push({ text: 'خارج ساعات عمل المكتب (7:00 ص – 10:00 م بتوقيت الرياض)' });
    office.bookings.forEach(function (b) {
      b.visits.forEach(function (v) {
        if (v.id === excludeVisitId || v.status !== 'scheduled') return;
        var vs = Date.parse(v.start), ve = Date.parse(v.end);
        if (vs < e && s < ve) v.workers.forEach(function (w) {
          if (w.status === 'assigned' && workerIds.indexOf(w.workerId) >= 0) conflicts.push({ text: w.name + ' لديها زيارة أخرى (' + b.ref + ') ' + fmtDTs(vs) });
        });
      });
    });
    (office.workerBlocks || []).forEach(function (bl) {
      if (workerIds.indexOf(bl.workerId) >= 0 && Date.parse(bl.from) < e && s < Date.parse(bl.to)) conflicts.push({ text: bl.workerName + ': ' + bl.reason + ' (' + fmtDTs(bl.from) + ' – ' + fmtTime(bl.to) + ')' });
    });
    return { ok: conflicts.length === 0, conflicts: conflicts };
  }

  /* ------------------------------------------------------------------ */
  /* THE shared calculation                                              */
  /* ------------------------------------------------------------------ */
  function newResult(req) {
    return {
      type: req.type, at: req.at, ok: true, blocked: null, canRequestReview: false, needsReview: false, reviewReasons: [], warnings: [], trace: [],
      rule: null, affected: [], eligible: 0, affectedOpen: 0, absorbed: 0, officeFeeBeforeWaiver: 0, waiver: 0, officeFee: 0,
      serviceRefund: 0, taxRefund: 0, jokrs: { refund: 0, retained: 0, text: '' }, totalRefund: 0, rescheduleFee: 0,
      outcome: 'no_refund', destinations: [], creditOutcome: null, manual: null,
      effects: { workers: [], visits: [], credits: [], schedule: null, replacement: null }
    };
  }
  function block(R, msg, canReview) { R.ok = false; R.blocked = msg; R.canRequestReview = canReview !== false; return R; }
  function tr(R, level, text, applied) { R.trace.push({ level: level, text: text, applied: applied !== false }); }
  /** policy-limit blocks can be overridden by an exception review; physical impossibilities cannot */
  function limitBlock(R, req, msg) {
    if (req.override) { R.warnings.push('تجاوز بموجب مراجعة استثنائية: ' + msg); tr(R, 1, 'استثناء مراجعة: ' + msg); return false; }
    block(R, msg, true); return true;
  }

  function freeReason(R, b, rules, at, visits, platform) {
    if (b.officeAcceptance === 'pending' && rules.cancel.pendingAcceptance === 'free') {
      return { level: 4, code: 'pending', text: 'الحجز بانتظار قبول المكتب — الإلغاء بدون رسوم', mode: 'pendingAcceptance' };
    }
    var g = rules.cancel.grace || {};
    var minutes = g.enabled ? g.minutes : 0, minLead = g.enabled ? g.minLeadHours : 0;
    var pMin = (platform.rules.minGraceMinutes || 0);
    var platformForced = false;
    if (pMin > minutes) { minutes = pMin; minLead = platform.rules.minGraceLeadHours || 0; platformForced = true; }
    if (minutes > 0) {
      var conf = Date.parse(b.confirmedAt), elapsed = at - conf;
      var lead = visits.length ? Math.min.apply(null, visits.map(function (v) { return Date.parse(v.start) - at; })) : Infinity;
      var end = conf + minutes * MIN;
      if (elapsed >= 0 && elapsed <= minutes * MIN && lead >= minLead * HOUR) {
        return { level: platformForced ? 1 : 4, code: 'grace', text: (platformForced ? 'فترة سماح إلزامية من المنصة' : 'ضمن فترة السماح') + ': ' + minutes + ' دقيقة من التأكيد (حتى ' + fmtDTs(end) + ' شاملة)', mode: 'customerCancelWithinGrace' };
      }
      tr(R, 4, 'فترة السماح لا تنطبق: ' + (elapsed > minutes * MIN ? 'انتهت في ' + fmtDTs(end) : 'موعد الزيارة أقرب من ' + minLead + ' ساعة'), false);
    }
    return null;
  }

  function visitFee(R, v, open, msBefore, rules, platform, approvedRestricted) {
    var band = matchBand(rules.cancel.bands || [], msBefore), f, label, level, feeDef;
    if (band) { feeDef = band.fee; f = evalFee(feeDef, { affected: open, remaining: open, visits: 1 }); label = bandLabel(band) + ': ' + f.text; level = 4; }
    else if (rules.cancel.fallback && rules.cancel.fallback.type !== 'unset') { feeDef = rules.cancel.fallback; f = evalFee(feeDef, { affected: open, remaining: open, visits: 1 }); label = 'القاعدة الاحتياطية: ' + f.text; level = 5; }
    else return { blocked: 'لا توجد شريحة زمنية ولا قاعدة احتياطية تغطي توقيت الإلغاء (' + durText(msBefore) + ' قبل الزيارة)' };
    var fee = f.amount;
    if (v.lockedBand && rules.reschedule && rules.reschedule.lockLateBand !== false) {
      var lf = evalFee(v.lockedBand.fee, { affected: open, remaining: open, visits: 1 });
      if (lf.amount > fee) { fee = lf.amount; feeDef = v.lockedBand.fee; label = 'شريحة مثبتة بسبب إعادة جدولة أثناء فترة الرسوم (' + v.lockedBand.label + '): ' + lf.text; level = 3; }
    }
    var isConsume = feeDef && feeDef.type === 'consume';
    if (!(isConsume && approvedRestricted)) {
      var cap = pctOf(open, platform.rules.maxVisitFeePct);
      if (fee > cap) { fee = cap; label += ' — حُدّت بقيد المنصة (' + platform.rules.maxVisitFeePct + '% من قيمة الزيارة)'; tr(R, 1, 'قيد المنصة: حد أقصى ' + platform.rules.maxVisitFeePct + '% لرسوم الزيارة' + (isConsume ? ' (احتساب الزيارة مستهلكة غير معتمد من المنصة لهذه النسخة)' : '')); }
    }
    return { fee: Math.min(fee, open), label: label, level: level, band: band };
  }

  /** settle groups → effects.workers. groups: [{visit, items:[{worker, open}], fee, newWorkerStatus}] */
  function settle(R, groups, eligible) {
    var flat = [];
    groups.forEach(function (g) { g.items.forEach(function (it) { flat.push({ g: g, it: it }); }); });
    var opens = flat.map(function (f) { return f.it.open; });
    var absorb = Math.max(0, sum(opens) - eligible);
    var absParts = allocate(absorb, opens);
    flat.forEach(function (f, i) { f.abs = absParts[i]; f.rem = f.it.open - absParts[i]; });
    var feeTotal = 0;
    groups.forEach(function (g) {
      var fl = flat.filter(function (f) { return f.g === g; });
      var gRem = sum(fl.map(function (f) { return f.rem; }));
      var gFee = Math.min(g.fee || 0, gRem);
      feeTotal += gFee;
      var fp = allocate(gFee, fl.map(function (f) { return f.rem; }));
      fl.forEach(function (f, j) {
        R.effects.workers.push({ visitId: g.visit.id, workerId: f.it.worker.id, absorb: f.abs, fee: fp[j], refund: f.rem - fp[j], consume: 0, newStatus: g.newWorkerStatus || 'canceled' });
      });
    });
    R.absorbed = absorb;
    return feeTotal;
  }
  function groupOpen(g) { return g.open !== undefined ? g.open : g.items ? sum(g.items.map(function (it) { return it.open; })) : (g.fee || 0); }
  function applyWaiver(R, groups, req, cap) {
    var total = sum(groups.map(function (g) { return g.fee || 0; }));
    R.officeFeeBeforeWaiver = total;
    if (req.manualFee !== undefined && req.manualFee !== null) {
      // Office manual override: the office sets the final office fee by hand (0 → full value).
      var max = cap !== undefined ? cap : sum(groups.map(groupOpen));
      var F = Math.max(0, Math.min(Math.round(req.manualFee), max));
      var parts = groups.length === 1 ? [F] : allocate(F, groups.map(groupOpen));
      groups.forEach(function (g, i) { g.fee = parts[i]; });
      R.manual = { fee: F, policyFee: total, direction: F > total ? 'above' : F < total ? 'below' : 'same' };
      R.waiver = 0;
      tr(R, 1, 'تعديل يدوي من المكتب: رسوم المكتب النهائية ' + sar(F) + ' بدلاً من ' + sar(total) + ' وفق السياسة' + (F > total ? ' (أعلى من السياسة — تتطلب موافقة العميل)' : ''));
      return;
    }
    var w = Math.max(0, Math.min(req.waiver || 0, total));
    if (req.waiver > total) R.warnings.push('الإعفاء المطلوب أكبر من الرسوم؛ طُبّق بحد الرسوم (' + sar(total) + ').');
    if (w > 0) {
      var parts = allocate(w, groups.map(function (g) { return g.fee || 0; }));
      groups.forEach(function (g, i) { g.fee -= parts[i]; });
      tr(R, 1, 'استثناء معتمد: إعفاء من رسوم المكتب بمبلغ ' + sar(w) + ' (لا يمس رسوم JOKRS أو استحقاق العميل)');
    }
    R.waiver = w;
  }
  function itemsFor(v, workerIds) {
    return v.workers.filter(function (w) { return w.status === 'assigned' && (!workerIds || workerIds.indexOf(w.id) >= 0); })
      .map(function (w) { return { worker: w, open: workerOpen(w) }; });
  }

  function calcCancelVisits(R, b, rules, platform, req, at, ctx) {
    var ids = req.visitIds || [];
    if (b.type === 'credits') return block(R, 'هذه باقة رصيد مرن — استخدم "إلغاء موعد من الرصيد".', false);
    if (!ids.length) return block(R, 'اختر زيارة واحدة على الأقل.', false);
    var visits = [];
    for (var i = 0; i < ids.length; i++) {
      var v = b.visits.filter(function (x) { return x.id === ids[i]; })[0];
      if (!v) return block(R, 'زيارة غير موجودة في الحجز.', false);
      if (v.status !== 'scheduled') return block(R, 'الزيارة رقم ' + v.label + ' ليست مجدولة (' + L.visitStatus[v.status] + ').', false);
      if (Date.parse(v.start) <= at) return block(R, 'بدأ موعد الزيارة رقم ' + v.label + ' أو انقضى؛ استخدم مسار "تعذّر الاستقبال" أو اطلب مراجعة.', true);
      visits.push(v);
    }
    var partial = req.workerIds && req.workerIds.length;
    if (partial) {
      if (visits.length !== 1) return block(R, 'إلغاء جزء من العمالة متاح لزيارة واحدة فقط في كل طلب.', false);
      if (!rules.cancel.allowPartialWorkers && limitBlock(R, req, 'السياسة لا تسمح بإلغاء جزء من العمالة المحجوزة.')) return R;
      var assigned = visits[0].workers.filter(function (w) { return w.status === 'assigned'; });
      if (req.workerIds.length >= assigned.length) return block(R, 'يجب أن تبقى عاملة واحدة على الأقل؛ لإلغاء الزيارة كاملة ألغِ الزيارة دون تحديد عمالة.', false);
    }
    var openFuture = b.visits.filter(function (x) { return x.status === 'scheduled' && Date.parse(x.start) > at && x.origin !== 'promo'; });
    var selPaid = visits.filter(function (x) { return x.origin !== 'promo'; });
    if (!partial && b.type === 'scheduled' && selPaid.length > 1 && selPaid.length === openFuture.length && rules.cancel.allowAllRemaining) {
      tr(R, 3, 'تم اختيار كل الزيارات المتبقية؛ تُطبّق قاعدة إلغاء الباقة حتى لا يُتجاوز حكمها باختيار الزيارات واحدة واحدة.');
      return calcAllRemaining(R, b, rules, platform, req, at, ctx);
    }
    if (visits.length === 1 && !rules.cancel.allowSingleVisit && limitBlock(R, req, 'السياسة لا تسمح بإلغاء زيارة منفردة؛ يمكن إلغاء جميع الزيارات المتبقية أو طلب مراجعة.')) return R;
    if (visits.length > 1 && !rules.cancel.allowSelectedVisits && limitBlock(R, req, 'السياسة لا تسمح باختيار عدة زيارات في عملية واحدة.')) return R;

    var free = freeReason(R, b, rules, at, visits, platform);
    var groups = [];
    for (var k = 0; k < visits.length; k++) {
      var vv = visits[k], items = itemsFor(vv, partial ? req.workerIds : null), open = sum(items.map(function (x) { return x.open; }));
      var msBefore = Date.parse(vv.start) - at, fee = 0, label;
      if (vv.origin === 'promo') { label = 'زيارة ترويجية مجانية — لا قيمة نقدية مستقلة'; }
      else if (free) { label = free.text; }
      else {
        var vf = visitFee(R, vv, open, msBefore, rules, platform, ctx.approvedRestricted);
        if (vf.blocked) return block(R, vf.blocked, true);
        fee = vf.fee; label = vf.label;
      }
      if (vv.origin === 'replacement') label += ' — زيارة بديلة مرتبطة بقيمة زيارة مدفوعة سابقاً';
      groups.push({ visit: vv, items: items, fee: fee, open: open, newWorkerStatus: 'canceled' });
      R.affected.push({ visitId: vv.id, label: vv.label, start: vv.start, msBefore: msBefore, open: open, fee: fee, rule: label, origin: vv.origin,
        workers: items.map(function (x) { return x.worker.name; }), partial: !!partial });
    }
    if (free) { tr(R, free.level, free.text); R.rule = { level: free.level, label: free.text }; }
    else {
      var labels = R.affected.map(function (a) { return a.rule; }).filter(function (x, i, arr) { return arr.indexOf(x) === i; });
      R.rule = { level: 4, label: labels.length === 1 ? labels[0] : 'شريحة زمنية لكل زيارة على حدة' };
      R.affected.forEach(function (a) { tr(R, 4, 'زيارة ' + a.label + ' (' + durText(a.msBefore) + ' قبل الموعد): ' + a.rule); });
    }
    applyWaiver(R, groups, req);
    var openSum = sum(groups.map(function (g) { return g.open; }));
    R.affectedOpen = openSum;
    R.eligible = Math.min(openSum, ctx.fin.remaining);
    if (R.eligible < openSum) tr(R, 3, 'القيمة المؤهلة حُدّت بالمتبقي القابل للاسترداد (' + sar(ctx.fin.remaining) + ') بسبب مبالغ سُوّيت أو رُدّت سابقاً.');
    R.officeFee = settle(R, groups, R.eligible);
    R.serviceRefund = R.eligible - R.officeFee;
    if (!partial) groups.forEach(function (g) { R.effects.visits.push({ visitId: g.visit.id, newStatus: 'canceled' }); });
    ctx.jMode = free ? free.mode : 'customerCancel';
    ctx.share = R.eligible;
    return R;
  }

  function calcAllRemaining(R, b, rules, platform, req, at, ctx) {
    if (b.type !== 'scheduled') return block(R, 'إلغاء جميع الزيارات المتبقية متاح لباقات الزيارات المجدولة فقط.', false);
    if (!rules.cancel.allowAllRemaining && limitBlock(R, req, 'السياسة لا تسمح بإلغاء جميع الزيارات المتبقية.')) return R;
    var visits = b.visits.filter(function (v) { return v.status === 'scheduled' && Date.parse(v.start) > at; });
    if (!visits.length) return block(R, 'لا توجد زيارات مستقبلية متبقية قابلة للإلغاء.', false);
    var started = b.visits.some(function (v) { return ['completed', 'customer_no_show', 'partially_delivered'].indexOf(v.status) >= 0; });
    var groups = visits.map(function (v) { var items = itemsFor(v); return { visit: v, items: items, open: sum(items.map(function (x) { return x.open; })), fee: 0, newWorkerStatus: 'canceled' }; });
    var openSum = sum(groups.map(function (g) { return g.open; }));
    var eligible = Math.min(openSum, ctx.fin.remaining);
    var paidCount = groups.filter(function (g) { return g.open > 0; }).length;
    var free = freeReason(R, b, rules, at, visits, platform), fee = 0, label;
    tr(R, 3, 'المرحلة: ' + (started ? 'بعد بدء الباقة (توجد زيارات مستهلكة)' : 'قبل بدء الباقة'));
    if (free) { label = free.text; tr(R, free.level, free.text); }
    else {
      var pfDef = rules.cancel[started ? 'packageAfterStart' : 'packageBeforeStart'];
      var pf = evalFee(pfDef, { affected: openSum, remaining: eligible, visits: paidCount });
      fee = pf.amount;
      label = (started ? 'إلغاء الباقة بعد البدء: ' : 'إلغاء الباقة قبل البدء: ') + pf.text;
      tr(R, 4, 'قاعدة الباقة: ' + pf.text + ' = ' + sar(pf.amount));
      if (rules.cancel.packageVsBand === 'greater_of') {
        var bandSum = 0;
        for (var i = 0; i < groups.length; i++) {
          var g = groups[i];
          if (!g.open) continue;
          var vf = visitFee(R, g.visit, g.open, Date.parse(g.visit.start) - at, rules, platform, ctx.approvedRestricted);
          if (vf.blocked) return block(R, vf.blocked, true);
          bandSum += vf.fee;
        }
        tr(R, 4, 'مجموع رسوم شرائح الزيارات = ' + sar(bandSum) + ' — لا تُجمع الرسوم: يُطبّق الأعلى فقط');
        if (bandSum > fee) { fee = bandSum; label = 'رسوم شرائح الزيارات القريبة أعلى من رسوم الباقة — يُطبّق الأعلى دون جمع'; }
      } else tr(R, 4, 'رسوم الباقة فقط (لا تُضاف رسوم الشرائح)');
      var pcap = pctOf(eligible, platform.rules.maxPackageFeePct);
      if (fee > pcap) { fee = pcap; label += ' — حُدّت بقيد المنصة (' + platform.rules.maxPackageFeePct + '% من القيمة المؤهلة)'; tr(R, 1, 'قيد المنصة: حد أقصى ' + platform.rules.maxPackageFeePct + '% من القيمة المؤهلة لرسوم إلغاء الباقة'); }
      if (fee > eligible) { fee = eligible; R.warnings.push('رسوم الإلغاء حُدّت بالقيمة المؤهلة — لا يوجد نموذج مديونية.'); }
    }
    var parts = allocate(fee, groups.map(function (g) { return g.open; }));
    groups.forEach(function (g, i) { g.fee = parts[i]; });
    applyWaiver(R, groups, req);
    groups.forEach(function (g) {
      R.affected.push({ visitId: g.visit.id, label: g.visit.label, start: g.visit.start, msBefore: Date.parse(g.visit.start) - at, open: g.open, fee: g.fee, rule: g.visit.origin === 'promo' ? 'ترويجية — بلا قيمة نقدية' : 'ضمن عملية إلغاء الباقة', origin: g.visit.origin, workers: g.items.map(function (x) { return x.worker.name; }) });
    });
    R.rule = { level: free ? free.level : 4, label: label };
    R.affectedOpen = openSum;
    R.eligible = eligible;
    if (eligible < openSum) tr(R, 3, 'القيمة المؤهلة = ' + sar(eligible) + ' (أقل من قيمة الزيارات المفتوحة ' + sar(openSum) + ' بسبب مبالغ رُدّت سابقاً).');
    R.officeFee = settle(R, groups, eligible);
    R.serviceRefund = eligible - R.officeFee;
    groups.forEach(function (g) { R.effects.visits.push({ visitId: g.visit.id, newStatus: 'canceled' }); });
    ctx.jMode = free ? free.mode : 'customerCancel';
    ctx.share = eligible; ctx.allRemaining = true;
    return R;
  }

  function calcReschedule(R, b, rules, platform, req, at, ctx) {
    var v = b.visits.filter(function (x) { return x.id === (req.visitIds || [])[0]; })[0];
    if (!v) return block(R, 'اختر الزيارة المراد تعديلها.', false);
    if (v.status !== 'scheduled') return block(R, 'الزيارة ليست مجدولة.', false);
    var start = Date.parse(v.start);
    if (start <= at) return block(R, 'لا يمكن تعديل زيارة بدأ موعدها أو انقضى.', true);
    if (!req.newStart) return block(R, 'حدد الموعد الجديد المطلوب.', false);
    var ns = Date.parse(req.newStart);
    if (isNaN(ns) || ns <= at) return block(R, 'الموعد الجديد يجب أن يكون في المستقبل.', false);
    if (ns === start) return block(R, 'الموعد الجديد مطابق للموعد الحالي.', false);
    var dur = Date.parse(v.end) - start;
    var sched = { visitId: v.id, from: v.start, to: new Date(ns).toISOString(), toEnd: new Date(ns + dur).toISOString(), counts: false, fee: 0, lockBand: null };
    R.affected.push({ visitId: v.id, label: v.label, start: v.start, msBefore: start - at, open: visitOpen(v), fee: 0, rule: '', origin: v.origin, workers: v.workers.filter(function (w) { return w.status === 'assigned'; }).map(function (w) { return w.name; }) });
    if (req.initiator === 'office' || req.cause === 'office') {
      tr(R, 2, 'إعادة جدولة بسبب المكتب: لا تُحتسب من رصيد تعديلات العميل ولا رسوم.');
      R.rule = { level: 2, label: 'تعديل بسبب المكتب — بدون رسوم ولا يُحتسب من حد التعديلات' };
    } else {
      var rs = rules.reschedule;
      if (!rs || !rs.enabled) { if (limitBlock(R, req, 'السياسة لا تسمح بإعادة الجدولة من العميل.')) return R; rs = rs || defaultRules(b.type).reschedule; }
      var msBefore = start - at;
      if (msBefore < rs.minNoticeHours * HOUR && limitBlock(R, req, 'يجب طلب التعديل قبل ' + rs.minNoticeHours + ' ساعة على الأقل من الموعد. آخر وقت كان ' + fmtDT(start - rs.minNoticeHours * HOUR) + '.')) return R;
      var vCount = v.customerReschedules || 0;
      if (vCount > 0 && !rs.allowRepeatOnRescheduled && limitBlock(R, req, 'أُعيدت جدولة هذه الزيارة سابقاً، والسياسة لا تسمح بتعديلها مرة أخرى.')) return R;
      if (vCount >= rs.maxPerVisit && limitBlock(R, req, 'بلغت الزيارة الحد الأقصى للتعديلات (' + rs.maxPerVisit + ').')) return R;
      var n = paidVisitCount(b), limit = sizeLimit(rs, n), pCount = b.customerReschedules || 0;
      tr(R, 3, 'حد التعديلات لباقة من ' + n + ' زيارة: ' + limit + ' — المستخدم: ' + pCount);
      if (pCount >= limit && limitBlock(R, req, 'تم استخدام ' + pCount + ' من ' + limit + ' تعديلات مسموحة لباقة من ' + n + ' زيارات.')) return R;
      var anchor = Date.parse(v.originalStart || v.start), latest = anchor + rs.latestReplacementDays * DAY;
      if (ns > latest && limitBlock(R, req, 'آخر موعد بديل مسموح هو ' + fmtDT(latest) + ' (' + rs.latestReplacementDays + ' يوماً من الموعد الأصلي).')) return R;
      sched.counts = true;
      if (pCount >= rs.freeChanges && rs.feeAfterFree > 0) {
        sched.fee = Math.min(rs.feeAfterFree, visitOpen(v));
        R.rule = { level: 3, label: 'تعديل رقم ' + (pCount + 1) + ' بعد ' + rs.freeChanges + ' تعديلات مجانية — رسوم ' + sar(sched.fee) + ' تُخصم من قيمة الزيارة المدفوعة مسبقاً' };
      } else R.rule = { level: 3, label: 'تعديل مجاني (' + (pCount + 1) + ' من ' + Math.min(limit, rs.freeChanges) + ' مجانية)' };
      var band = matchBand(rules.cancel.bands || [], msBefore);
      if (band && band.fee && band.fee.type !== 'none' && rs.lockLateBand !== false) {
        sched.lockBand = { label: bandLabel(band), fee: clone(band.fee), lockedAt: new Date(at).toISOString() };
        tr(R, 3, 'التعديل تم داخل شريحة رسوم (' + bandLabel(band) + ')؛ تُثبّت هذه الشريحة للزيارة حتى لا يُتجاوز حكم الإلغاء المتأخر بإعادة الجدولة.');
      }
      if (v.lockedBand) tr(R, 3, 'الزيارة عليها شريحة مثبتة مسبقاً: ' + v.lockedBand.label);
      tr(R, 3, R.rule.label);
    }
    R.rescheduleFee = sched.fee;
    R.officeFee = sched.fee;
    R.affected[0].fee = sched.fee; R.affected[0].rule = R.rule.label;
    R.effects.schedule = sched;
    R.outcome = 'reschedule';
    ctx.noCash = true;
    return R;
  }

  function calcOfficeCancel(R, b, rules, platform, req, at, ctx) {
    var ids = req.visitIds || [];
    if (!ids.length) return block(R, 'اختر الزيارة/الزيارات المتأثرة.', false);
    var visits = ids.map(function (id) { return b.visits.filter(function (x) { return x.id === id; })[0]; });
    if (visits.some(function (v) { return !v || v.status !== 'scheduled'; })) return block(R, 'يمكن تسجيل إلغاء المكتب على زيارات مجدولة فقط.', false);
    tr(R, 2, 'السبب من جهة المكتب (' + (req.reasonLabel || 'إلغاء / تعذّر توفير عاملة / تأخر') + '): لا تُفرض أي رسوم إلغاء على العميل.');
    if (b.type === 'credits') {
      var cr = rules.credits || {};
      visits.forEach(function (v) {
        var c = b.credits.items.filter(function (x) { return x.id === v.creditId; })[0];
        if (!c) return;
        var newExp = cr.officeFaultExtendDays > 0 ? addDays(c.expiresAt, cr.officeFaultExtendDays, 'calendar') : c.expiresAt;
        R.effects.credits.push({ creditId: c.id, newState: 'available', expiresAt: newExp, refund: 0, fee: 0, consume: 0, visitId: v.id });
        R.effects.visits.push({ visitId: v.id, newStatus: 'office_canceled' });
        R.affected.push({ visitId: v.id, label: v.label, start: v.start, msBefore: Date.parse(v.start) - at, open: creditOpen(c), fee: 0, rule: 'إعادة الرصيد' + (newExp !== c.expiresAt ? ' مع تمديد الصلاحية ' + cr.officeFaultExtendDays + ' يوماً حتى ' + fmtDate(newExp) : ''), origin: 'credit', workers: v.workers.map(function (w) { return w.name; }) });
      });
      R.rule = { level: 2, label: 'خلل من المكتب: إعادة الرصيد للعميل' + (cr.officeFaultExtendDays ? ' وتمديد صلاحيته ' + cr.officeFaultExtendDays + ' يوماً' : '') + ' — بدون استرداد نقدي' };
      R.outcome = 'credit_restore'; R.creditOutcome = 'restored'; ctx.noCash = true;
      return R;
    }
    var remedy = req.remedy || 'refund';
    var groups = visits.map(function (v) { var items = itemsFor(v); return { visit: v, items: items, open: sum(items.map(function (x) { return x.open; })), fee: 0, newWorkerStatus: 'canceled' }; });
    groups.forEach(function (g) { R.affected.push({ visitId: g.visit.id, label: g.visit.label, start: g.visit.start, msBefore: Date.parse(g.visit.start) - at, open: g.open, fee: 0, rule: 'بدون رسوم — خلل المكتب', origin: g.visit.origin, workers: g.items.map(function (x) { return x.worker.name; }) }); });
    var openSum = sum(groups.map(function (g) { return g.open; }));
    R.affectedOpen = openSum;
    if (remedy === 'replacement') {
      if (visits.length !== 1) return block(R, 'الموعد البديل يُقترح لزيارة واحدة في كل طلب.', false);
      R.rule = { level: 2, label: 'خلل من المكتب: موعد بديل يقبله العميل — تنتقل قيمة الزيارة المدفوعة إلى الموعد البديل دون استرداد نقدي' };
      R.effects.replacement = { visitId: visits[0].id, start: req.newStart || null };
      R.outcome = 'replacement'; ctx.noCash = true;
      tr(R, 2, 'لا يُجمع بين الاسترداد النقدي والموعد البديل لنفس القيمة المدفوعة.');
      return R;
    }
    R.rule = { level: 2, label: 'خلل من المكتب: استرداد كامل لقيمة الزيارة المتأثرة بدون رسوم' };
    R.eligible = Math.min(openSum, ctx.fin.remaining);
    R.officeFee = settle(R, groups, R.eligible);
    R.serviceRefund = R.eligible - R.officeFee;
    groups.forEach(function (g) { R.effects.visits.push({ visitId: g.visit.id, newStatus: 'office_canceled' }); });
    ctx.jMode = 'officeFault'; ctx.share = R.eligible;
    var remainingAfter = b.visits.filter(function (x) { return x.status === 'scheduled' && ids.indexOf(x.id) < 0; }).length;
    ctx.allRemaining = remainingAfter === 0 && !b.visits.some(function (x) { return x.status === 'completed'; });
    return R;
  }

  function calcNoShow(R, b, rules, platform, req, at, ctx) {
    var v = b.visits.filter(function (x) { return x.id === (req.visitIds || [])[0]; })[0];
    if (!v) return block(R, 'اختر الزيارة.', false);
    if (v.status !== 'scheduled') return block(R, 'الزيارة ليست في حالة مجدولة.', false);
    if (Date.parse(v.start) > at) return block(R, 'لا يمكن تسجيل تعذّر الاستقبال قبل موعد الزيارة (' + fmtDT(v.start) + ').', false);
    var items = itemsFor(v), open = sum(items.map(function (x) { return x.open; }));
    var reason = req.reasonCode || 'no_show';
    R.needsReview = true;
    R.reviewReasons.push('ادعاء يخص العميل — يتطلب مراجعة بشرية ولا يُحسم آلياً.');
    var fee = 0, label;
    if (reason === 'unsafe') {
      label = 'ظروف غير آمنة: لا رسوم على العميل افتراضياً؛ تُراجع الحالة وتُسترد القيمة';
      tr(R, 1, 'السلامة أولاً — لا تُفرض رسوم تلقائياً على ظروف غير آمنة.');
    } else {
      var ns = rules.exceptions.noShow;
      if (req.disputed) R.reviewReasons.push('العميل يعترض على الواقعة — مطلوب فحص الإثباتات، ويمكن رفعها لمراجعة JOKRS.');
      if (ns.requireEvidence && !(req.evidence || []).length) R.reviewReasons.push('لا توجد إثباتات مرفقة؛ لا يمكن احتساب الرسوم قبل إرفاق إثبات.');
      var f = evalFee(ns.fee, { affected: open, remaining: open, visits: 1 });
      fee = f.amount;
      label = (reason === 'wrong_address' ? 'عنوان غير صحيح' : 'تعذّر استقبال العاملة') + ' (عند ثبوت الواقعة): ' + f.text;
      if (!(ns.fee.type === 'consume' && ctx.approvedRestricted)) {
        var cap = pctOf(open, platform.rules.maxVisitFeePct);
        if (fee > cap) { fee = cap; label += ' — حُدّت بقيد المنصة ' + platform.rules.maxVisitFeePct + '%'; tr(R, 1, 'قيد المنصة على رسوم الزيارة'); }
      }
      tr(R, 3, label);
    }
    var groups = [{ visit: v, items: items, open: open, fee: fee, newWorkerStatus: 'not_delivered' }];
    applyWaiver(R, groups, req);
    R.rule = { level: 3, label: label };
    R.affected.push({ visitId: v.id, label: v.label, start: v.start, msBefore: Date.parse(v.start) - at, open: open, fee: groups[0].fee, rule: label, origin: v.origin, workers: items.map(function (x) { return x.worker.name; }) });
    R.affectedOpen = open;
    R.eligible = Math.min(open, ctx.fin.remaining);
    R.officeFee = settle(R, groups, R.eligible);
    R.serviceRefund = R.eligible - R.officeFee;
    R.effects.visits.push({ visitId: v.id, newStatus: 'customer_no_show' });
    ctx.jMode = reason === 'unsafe' ? 'officeFault' : 'customerCancel'; ctx.share = R.eligible;
    return R;
  }

  function calcPartial(R, b, rules, platform, req, at, ctx) {
    var v = b.visits.filter(function (x) { return x.id === (req.visitIds || [])[0]; })[0];
    if (!v) return block(R, 'اختر الزيارة.', false);
    if (v.status !== 'scheduled') return block(R, 'الزيارة ليست مجدولة.', false);
    if (Date.parse(v.start) > at) return block(R, 'لا يمكن تسجيل تنفيذ جزئي قبل موعد الزيارة.', false);
    var assigned = v.workers.filter(function (w) { return w.status === 'assigned'; });
    var del = req.deliveredWorkerIds || [];
    if (!del.length || del.length >= assigned.length) return block(R, 'حدد العمالة التي حضرت فعلاً (واحدة على الأقل وأقل من العدد المحجوز ' + assigned.length + ').', false);
    var undelivered = assigned.filter(function (w) { return del.indexOf(w.id) < 0; });
    var delivered = assigned.filter(function (w) { return del.indexOf(w.id) >= 0; });
    tr(R, 2, 'التنفيذ الجزئي بسبب المكتب: تُسترد حصة العمالة غير المنفذة كاملة دون رسوم، وتُحتسب الحصة المنفذة فقط.');
    var items = undelivered.map(function (w) { return { worker: w, open: workerOpen(w) }; });
    var open = sum(items.map(function (x) { return x.open; }));
    var groups = [{ visit: v, items: items, open: open, fee: 0, newWorkerStatus: 'not_delivered' }];
    R.affectedOpen = open;
    R.eligible = Math.min(open, ctx.fin.remaining);
    R.officeFee = settle(R, groups, R.eligible);
    R.serviceRefund = R.eligible - R.officeFee;
    delivered.forEach(function (w) { R.effects.workers.push({ visitId: v.id, workerId: w.id, absorb: 0, fee: 0, refund: 0, consume: workerOpen(w), newStatus: 'delivered' }); });
    R.effects.visits.push({ visitId: v.id, newStatus: 'partially_delivered' });
    R.rule = { level: 2, label: 'تنفيذ جزئي (' + delivered.length + ' من ' + assigned.length + ' عمالة): استرداد حصة غير المنفذ بالكامل' };
    R.affected.push({ visitId: v.id, label: v.label, start: v.start, msBefore: Date.parse(v.start) - at, open: open, fee: 0, rule: R.rule.label, origin: v.origin, workers: undelivered.map(function (w) { return w.name + ' (لم تحضر)'; }).concat(delivered.map(function (w) { return w.name + ' (نُفذت)'; })) });
    if (req.initiator === 'customer') { R.needsReview = true; R.reviewReasons.push('بلاغ من العميل — يتطلب تأكيد العمليات لسجل الحضور.'); }
    ctx.jMode = 'officeFault'; ctx.share = R.eligible;
    return R;
  }

  function calcQuality(R, b, rules, platform, req, at, ctx) {
    var v = b.visits.filter(function (x) { return x.id === (req.visitIds || [])[0]; })[0];
    if (!v) return block(R, 'اختر الزيارة.', false);
    if (['completed', 'partially_delivered'].indexOf(v.status) < 0) return block(R, 'مسار "مشكلة بعد بدء الخدمة" للزيارات المنفذة فقط.', false);
    var consumed = sum(v.workers.map(function (w) { return w.consumed || 0; }));
    var amt = req.qualityAmount || 0;
    if (req.manualFee !== undefined && req.manualFee !== null) {
      var mf = Math.max(0, Math.min(Math.round(req.manualFee), consumed));
      R.manual = { fee: mf, policyFee: consumed - amt, direction: 'quality' };
      amt = consumed - mf;
      tr(R, 1, 'تعديل يدوي من المكتب: التعويض النهائي ' + sar(amt) + ' من قيمة الزيارة ' + sar(consumed));
    }
    R.needsReview = true;
    R.reviewReasons.push('مشكلة جودة/خدمة بعد البدء — تتطلب مراجعة وتحديد مبلغ التعويض.');
    if (amt > consumed) { R.warnings.push('المبلغ المقترح يتجاوز قيمة الزيارة المستهلكة؛ حُدّ بـ ' + sar(consumed) + '.'); amt = consumed; }
    if (amt < 0) amt = 0;
    var parts = allocate(amt, v.workers.map(function (w) { return w.consumed || 0; }));
    v.workers.forEach(function (w, i) { if (parts[i]) R.effects.workers.push({ visitId: v.id, workerId: w.id, absorb: 0, fee: 0, refund: parts[i], consume: -parts[i], newStatus: null }); });
    R.eligible = amt; R.serviceRefund = amt; R.affectedOpen = consumed;
    R.rule = { level: 3, label: 'تعويض جزئي بعد مراجعة الجودة: ' + sar(amt) + ' من قيمة الزيارة المنفذة ' + sar(consumed) };
    R.affected.push({ visitId: v.id, label: v.label, start: v.start, msBefore: Date.parse(v.start) - at, open: consumed, fee: 0, rule: R.rule.label, origin: v.origin, workers: v.workers.map(function (w) { return w.name; }) });
    tr(R, 3, R.rule.label);
    ctx.jMode = 'customerCancel'; ctx.share = amt; ctx.jokrsUnchanged = true;
    return R;
  }

  function calcCreditCancel(R, b, rules, platform, req, at, ctx) {
    if (b.type !== 'credits') return block(R, 'هذا المسار لباقات الرصيد المرن فقط.', false);
    var v = b.visits.filter(function (x) { return x.id === (req.visitIds || [])[0]; })[0];
    if (!v) return block(R, 'اختر الموعد.', false);
    if (v.status !== 'scheduled') return block(R, 'الموعد ليس مجدولاً.', false);
    if (Date.parse(v.start) <= at) return block(R, 'بدأ الموعد أو انقضى؛ استخدم مسار "تعذّر الاستقبال" أو اطلب مراجعة.', true);
    var c = b.credits.items.filter(function (x) { return x.id === v.creditId; })[0];
    var cr = rules.credits, msBefore = Date.parse(v.start) - at;
    var free = freeReason(R, b, rules, at, [v], platform);
    var restore = !!free || msBefore >= cr.restoreMinNoticeHours * HOUR, label;
    if (free) { label = free.text + ' — يُعاد الرصيد'; tr(R, free.level, free.text); }
    else if (restore) { label = 'إلغاء قبل ' + cr.restoreMinNoticeHours + ' ساعة أو أكثر (الحد شامل): يُعاد استحقاق الزيارة إلى الرصيد'; tr(R, 4, label); }
    else if (cr.lateAction === 'consume' && !ctx.approvedRestricted) {
      restore = true; label = 'إلغاء متأخر، لكن احتساب الرصيد مستهلكاً غير معتمد من المنصة لهذه النسخة — يُعاد الرصيد';
      tr(R, 1, 'قيد المنصة: احتساب الاستحقاق مستهلكاً يتطلب اعتماداً — طُبّق الخيار الأفضل للعميل.');
    } else if (cr.lateAction === 'consume') { label = 'إلغاء متأخر (أقل من ' + cr.restoreMinNoticeHours + ' ساعة): يُحتسب الرصيد مستهلكاً دون استرداد'; tr(R, 4, label); }
    else { restore = true; label = 'إلغاء متأخر: السياسة تعيد الرصيد'; tr(R, 4, label); }
    var newExp = c.expiresAt;
    if (restore && cr.expiryOnRestore === 'extend' && cr.extendDays > 0) newExp = addDays(c.expiresAt, cr.extendDays, 'calendar');
    if (restore) {
      R.effects.credits.push({ creditId: c.id, newState: 'available', expiresAt: newExp, refund: 0, fee: 0, consume: 0, visitId: v.id });
      R.effects.visits.push({ visitId: v.id, newStatus: 'canceled' });
      R.outcome = 'credit_restore'; R.creditOutcome = 'restored';
      tr(R, 3, 'الصلاحية: ' + (newExp === c.expiresAt ? 'تبقى كما هي (' + fmtDate(newExp) + ')' : 'تُمدد إلى ' + fmtDate(newExp)));
    } else {
      R.effects.credits.push({ creditId: c.id, newState: 'forfeited', refund: 0, fee: 0, consume: creditOpen(c), visitId: v.id });
      R.effects.visits.push({ visitId: v.id, newStatus: 'canceled_late' });
      R.outcome = 'no_refund'; R.creditOutcome = 'forfeited';
    }
    R.rule = { level: free ? free.level : 4, label: label };
    R.affected.push({ visitId: v.id, label: v.label, start: v.start, msBefore: msBefore, open: creditOpen(c), fee: restore ? 0 : creditOpen(c), rule: label, origin: 'credit', workers: v.workers.map(function (w) { return w.name; }), creditExpiry: newExp });
    tr(R, 3, 'لا يوجد استرداد نقدي عند إعادة الاستحقاق — لا يُجمع بين الاثنين.');
    ctx.noCash = true;
    return R;
  }

  function calcPackageRefund(R, b, rules, platform, req, at, ctx) {
    if (b.type !== 'credits') return block(R, 'استرداد الباقة بهذا المسار لباقات الرصيد المرن.', false);
    var cr = rules.credits, eligibleItems = [], expired = [];
    b.credits.items.forEach(function (c) {
      if (c.state === 'available' && Date.parse(c.expiresAt) <= at) { if (cr.expiredRefundable) eligibleItems.push(c); else expired.push(c); return; }
      if (c.state === 'available') eligibleItems.push(c);
      if (c.state === 'scheduled') {
        var v = b.visits.filter(function (x) { return x.id === c.visitId; })[0];
        if (v && Date.parse(v.start) > at) eligibleItems.push(c);
      }
    });
    if (expired.length) tr(R, 3, expired.length + ' رصيد منتهي الصلاحية غير مؤهل للاسترداد حسب السياسة (قيمته ' + sar(sum(expired.map(creditOpen))) + ').');
    if (!eligibleItems.length) {
      if (!expired.length) return block(R, 'لا يوجد رصيد متاح للاسترداد.', true);
      R.rule = { level: 3, label: 'كل الرصيد المتبقي منتهي الصلاحية — لا مبلغ مؤهل' };
      expired.forEach(function (c) { R.effects.credits.push({ creditId: c.id, newState: 'expired', refund: 0, fee: 0, consume: creditOpen(c) }); });
      ctx.jMode = 'customerCancel'; return R;
    }
    var opens = eligibleItems.map(creditOpen), openSum = sum(opens);
    var eligible = Math.min(openSum, ctx.fin.remaining - sum(expired.map(creditOpen)));
    eligible = Math.max(0, eligible);
    var started = b.credits.items.some(function (c) { return c.state === 'used' || c.state === 'forfeited'; });
    var free = freeReason(R, b, rules, at, [], platform), fee = 0, label;
    if (free) { label = free.text; tr(R, free.level, free.text); }
    else {
      var fdef = cr[started ? 'refundAfterUse' : 'refundBeforeUse'];
      var f = evalFee(fdef, { affected: openSum, remaining: eligible, visits: eligibleItems.length });
      fee = f.amount;
      label = (started ? 'استرداد الباقة بعد بدء الاستخدام: ' : 'استرداد الباقة قبل أي استخدام: ') + f.text;
      var pcap = pctOf(eligible, platform.rules.maxPackageFeePct);
      if (fee > pcap) { fee = pcap; label += ' — حُدّت بقيد المنصة'; tr(R, 1, 'قيد المنصة على رسوم إلغاء الباقة'); }
      if (fee > eligible) fee = eligible;
      tr(R, 4, label);
    }
    var gWaiver = [{ fee: fee }];
    applyWaiver(R, gWaiver, req, eligible); fee = gWaiver[0].fee;
    var absorb = openSum - eligible, absParts = allocate(absorb, opens);
    var rems = opens.map(function (o, i) { return o - absParts[i]; });
    var feeParts = allocate(fee, rems);
    eligibleItems.forEach(function (c, i) {
      R.effects.credits.push({ creditId: c.id, newState: 'refunded', refund: rems[i] - feeParts[i], fee: feeParts[i], absorb: absParts[i], consume: 0, visitId: c.state === 'scheduled' ? c.visitId : null });
      if (c.state === 'scheduled' && c.visitId) R.effects.visits.push({ visitId: c.visitId, newStatus: 'canceled' });
    });
    expired.forEach(function (c) { R.effects.credits.push({ creditId: c.id, newState: 'expired', refund: 0, fee: 0, consume: creditOpen(c) }); });
    R.rule = { level: free ? free.level : 4, label: label };
    R.needsReview = true;
    R.reviewReasons.push('استرداد قيمة باقة الرصيد يتطلب مراجعة المكتب للتحقق من الرصيد والمواعيد المحجوزة.');
    R.affectedOpen = openSum; R.eligible = eligible; R.officeFee = fee; R.serviceRefund = eligible - fee;
    R.affected.push({ visitId: null, label: eligibleItems.length + ' رصيد', start: null, msBefore: null, open: openSum, fee: fee, rule: label, origin: 'credit', workers: [] });
    ctx.jMode = free ? free.mode : 'customerCancel'; ctx.share = eligible; ctx.allRemaining = true;
    return R;
  }

  function jokrsPart(b, platform, mode, share, allRemaining) {
    var fee = b.price.jokrsFee || 0, left = fee - (b.jokrsRefunded || 0);
    var M = { officeFault: 'خلل من المكتب', customerCancelWithinGrace: 'إلغاء ضمن فترة السماح', pendingAcceptance: 'إلغاء قبل قبول المكتب', customerCancel: 'إلغاء من العميل' };
    if (!fee) return { refund: 0, retained: 0, text: 'لا توجد رسوم JOKRS على هذا الحجز', rule: '' };
    var rule = platform.jokrsFee[mode] || 'retain';
    if (rule !== 'refund' || share <= 0) return { refund: 0, retained: left, text: 'رسوم JOKRS (' + sar(fee) + ') غير مستردة في حالة: ' + M[mode] + ' — قاعدة منصة ' + platform.feeRuleVersion, rule: 'retain' };
    var amt = allRemaining ? left : Math.min(left, Math.round((fee * share) / b.price.serviceNet));
    return { refund: amt, retained: left - amt, text: 'تُسترد رسوم JOKRS ' + (allRemaining ? 'المتبقية كاملة' : 'بنسبة القيمة المستردة') + ' (' + M[mode] + ') — قاعدة منصة ' + platform.feeRuleVersion, rule: 'refund' };
  }

  function destinations(b, amount, pref, rules) {
    if (amount <= 0) return [];
    var pays = b.price.payments;
    var authorized = pays.filter(function (p) { return p.state === 'authorized'; });
    if (pref === 'wallet' && rules && rules.refund.allowWallet && !authorized.length) {
      return [{ paymentId: null, method: 'wallet', action: 'wallet_credit', amount: amount, chosen: true }];
    }
    var avail = pays.map(function (p) { return Math.max(0, p.amount - (p.refunded || 0)); });
    var parts = allocate(Math.min(amount, sum(avail)), avail);
    return pays.map(function (p, i) {
      return { paymentId: p.id, method: p.method, action: p.state === 'authorized' ? 'release_authorization' : (p.method === 'wallet' ? 'wallet_credit' : 'refund_capture'), amount: parts[i] };
    }).filter(function (d) { return d.amount > 0; });
  }

  function taxShare(b, serviceRefund) {
    var vat = b.price.vat || 0;
    if (!vat || serviceRefund <= 0) return 0;
    return Math.min(vat - (b.taxRefunded || 0), Math.round((vat * serviceRefund) / b.price.serviceNet));
  }

  /**
   * calculate({booking, platform, req, rules?, approvedRestricted?})
   * req: {type, at, visitIds, workerIds, initiator, cause, remedy, destination, deliveredWorkerIds,
   *       evidence, disputed, reasonCode, waiver, newStart, qualityAmount, override, baseType}
   */
  function calculate(input) {
    var b = input.booking, platform = input.platform, req = Object.assign({}, input.req);
    var snap = b.policySnapshot || {};
    var rules = input.rules || snap.rules;
    var R = newResult(req);
    var ctx = { approvedRestricted: input.rules ? !!input.approvedRestricted : !!snap.platformApproved, fin: bookingFinance(b), jMode: null, share: 0, allRemaining: false, noCash: false };
    R.finance = ctx.fin;
    R.policyLabel = input.rules ? (input.policyLabel || 'مسودة السياسة (محاكاة)') : (snap.policyName + ' — النسخة ' + snap.version);
    if (!rules) return block(R, 'لا توجد سياسة مقبولة على هذا الحجز.', true);
    var at = Date.parse(req.at);
    if (isNaN(at)) return block(R, 'وقت الطلب غير صالح.', false);
    tr(R, 1, 'فُحصت قيود المنصة الإلزامية (' + platform.version + ' — بيانات عرض، الوضع القانوني غير متحقق)');
    tr(R, 3, 'السياسة المطبقة: ' + R.policyLabel + (input.rules ? '' : ' — لقطة مقبولة في ' + fmtDTs(snap.acceptedAt)));
    var type = req.type;
    if (type === 'exception_review') {
      req.override = true; type = req.baseType || 'cancel_visits'; req.type = type;
      R.needsReview = true; R.reviewReasons.push('طلب مراجعة استثنائية/حقوقية — لا يُعالج آلياً.');
    }
    switch (type) {
      case 'cancel_visits': calcCancelVisits(R, b, rules, platform, req, at, ctx); break;
      case 'cancel_all_remaining': calcAllRemaining(R, b, rules, platform, req, at, ctx); break;
      case 'reschedule': calcReschedule(R, b, rules, platform, req, at, ctx); break;
      case 'office_cancel': calcOfficeCancel(R, b, rules, platform, req, at, ctx); break;
      case 'no_show': calcNoShow(R, b, rules, platform, req, at, ctx); break;
      case 'partial_delivery': calcPartial(R, b, rules, platform, req, at, ctx); break;
      case 'quality_issue': calcQuality(R, b, rules, platform, req, at, ctx); break;
      case 'credit_cancel': calcCreditCancel(R, b, rules, platform, req, at, ctx); break;
      case 'package_refund': calcPackageRefund(R, b, rules, platform, req, at, ctx); break;
      default: return block(R, 'نوع طلب غير مدعوم.', false);
    }
    if (!R.ok) return R;
    if (!ctx.noCash) {
      R.taxRefund = taxShare(b, R.serviceRefund);
      R.jokrs = ctx.jokrsUnchanged ? { refund: 0, retained: 0, text: 'رسوم JOKRS لا تتأثر بتعويض الجودة' } : jokrsPart(b, platform, ctx.jMode || 'customerCancel', ctx.share, ctx.allRemaining);
      R.totalRefund = R.serviceRefund + R.taxRefund + R.jokrs.refund;
      var pref = req.destination || 'original';
      if (pref === 'wallet' && !(rules.refund && rules.refund.allowWallet)) R.warnings.push('السياسة لا تدعم الاسترداد إلى المحفظة؛ سيُعاد المبلغ لوسيلة الدفع الأصلية.');
      R.destinations = destinations(b, R.totalRefund, pref, rules);
      if (R.totalRefund > 0) R.outcome = R.destinations.every(function (d) { return d.action === 'release_authorization'; }) ? 'release_authorization' : 'cash_refund';
      else R.outcome = 'no_refund';
    } else {
      R.jokrs = { refund: 0, retained: 0, text: R.outcome === 'reschedule' ? 'لا تغيير على رسوم JOKRS عند إعادة الجدولة' : 'لا استرداد نقدي — رسوم JOKRS دون تغيير' };
    }
    if (R.needsReview) R.outcome = R.outcome === 'no_refund' && R.totalRefund > 0 ? 'cash_refund' : R.outcome;
    return R;
  }

  /* ------------------------------------------------------------------ */
  /* Customer-facing wording generated from structured rules             */
  /* ------------------------------------------------------------------ */
  function freeDeadline(rules, startISO) {
    var bands = sortedBands(rules.cancel.bands || []);
    var top = bands[0];
    if (!top || (top.maxHours !== null && top.maxHours !== undefined) || (top.fee && top.fee.type !== 'none')) return null;
    return new Date(Date.parse(startISO) - top.minHours * HOUR).toISOString();
  }

  function policyText(rules, type, platform, opts) {
    opts = opts || {};
    var S = [], c = rules.cancel;
    if (type !== 'credits') {
      var items = [];
      if (opts.firstVisitStart) {
        var dl = freeDeadline(rules, opts.firstVisitStart);
        if (dl) items.push('آخر موعد للإلغاء المجاني للزيارة الأولى: ' + fmtDT(dl) + ' بتوقيت الرياض.');
      }
      if (c.grace && c.grace.enabled) items.push('يمكنك الإلغاء مجاناً خلال ' + c.grace.minutes + ' دقيقة من تأكيد الحجز' + (opts.confirmAt ? ' (حتى ' + fmtDT(Date.parse(opts.confirmAt) + c.grace.minutes * MIN) + ')' : '') + '، بشرط أن يكون موعد الزيارة بعد ' + c.grace.minLeadHours + ' ساعة على الأقل.');
      if (c.pendingAcceptance === 'free') items.push('قبل قبول المكتب لطلبك، يمكنك الإلغاء دون أي رسوم ويُلغى تفويض الدفع.');
      sortedBands(c.bands || []).forEach(function (b) {
        items.push('الإلغاء ' + (b.maxHours == null ? 'قبل ' + hoursTxt(b.minHours) + ' أو أكثر من الموعد' : (b.minHours ? 'قبل ' + hoursTxt(b.minHours) + ' إلى أقل من ' + hoursTxt(b.maxHours) + ' من الموعد' : 'قبل أقل من ' + hoursTxt(b.maxHours) + ' من الموعد')) + ': ' + describeFee(b.fee, true) + '.');
      });
      if (c.fallback && c.fallback.type !== 'unset') items.push('أي توقيت غير مذكور أعلاه: ' + describeFee(c.fallback, true) + '.');
      var bs = sortedBands(c.bands || []).filter(function (b) { return b.minHours > 0; });
      if (bs.length) items.push('تُحسب المدة حتى وقت بداية الزيارة، والحد الأدنى لكل فترة مشمول: الإلغاء قبل ' + hoursTxt(bs[bs.length - 1].minHours) + ' بالضبط يندرج في الفترة الأطول.');
      if (c.allowPartialWorkers) items.push('يمكنك تقليل عدد العمالة في زيارة واحدة مع بقاء عاملة واحدة على الأقل؛ تُحتسب الرسوم على حصة العمالة الملغاة فقط.');
      S.push({ key: 'cancel', title: 'إلغاء الزيارة', items: items });
    }
    if (type === 'scheduled') {
      var p = [];
      if (c.allowSingleVisit) p.push('يمكنك إلغاء زيارة واحدة دون التأثير على باقي مواعيد الباقة.');
      if (c.allowSelectedVisits) p.push('يمكنك اختيار عدة زيارات مستقبلية لإلغائها معاً؛ تُحتسب رسوم كل زيارة حسب توقيتها.');
      if (c.allowAllRemaining) {
        p.push('إلغاء جميع الزيارات المتبقية قبل بدء الباقة: ' + describeFee(c.packageBeforeStart, true) + '.');
        p.push('إلغاء جميع الزيارات المتبقية بعد تنفيذ زيارة أو أكثر: ' + describeFee(c.packageAfterStart, true) + '.');
        if (c.packageVsBand === 'greater_of') p.push('لا تُجمع رسوم الباقة مع رسوم الزيارات القريبة؛ يُطبّق المبلغ الأعلى فقط.');
        p.push('لا تُسترد قيمة الزيارات المنفذة، ولا يُعاد تسعيرها بأسعار اليوم.');
      }
      S.push({ key: 'package', title: 'إلغاء الباقة', items: p });
    }
    if (type === 'credits' && rules.credits) {
      var cr = rules.credits, ci = [];
      ci.push('إلغاء الموعد قبل ' + hoursTxt(cr.restoreMinNoticeHours) + ' أو أكثر: يُعاد الاستحقاق إلى رصيدك (دون استرداد نقدي).');
      ci.push('الإلغاء خلال أقل من ' + hoursTxt(cr.restoreMinNoticeHours) + ': ' + (cr.lateAction === 'consume' ? 'يُحتسب الرصيد مستهلكاً.' : 'يُعاد الرصيد أيضاً.'));
      ci.push('صلاحية الرصيد المعاد: ' + (cr.expiryOnRestore === 'extend' ? 'تُمدد ' + cr.extendDays + ' يوماً.' : 'تبقى كما هي دون تغيير.'));
      if (cr.officeFaultExtendDays) ci.push('إذا ألغى المكتب موعدك، يُعاد الرصيد وتُمدد صلاحيته ' + cr.officeFaultExtendDays + ' يوماً.');
      ci.push('استرداد قيمة الباقة قبل أي استخدام: ' + describeFee(cr.refundBeforeUse, true) + '.');
      ci.push('استرداد قيمة الرصيد غير المستخدم بعد بدء الاستخدام: ' + describeFee(cr.refundAfterUse, true) + '.');
      ci.push(cr.expiredRefundable ? 'الرصيد المنتهي يُسترد وفق القواعد أعلاه.' : 'الرصيد المنتهي الصلاحية لا يُسترد نقداً.');
      S.push({ key: 'credits', title: 'الرصيد المرن', items: ci });
    }
    var rs = rules.reschedule, ri = [];
    if (rs && rs.enabled) {
      ri.push('يمكنك تعديل موعد الزيارة قبل ' + hoursTxt(rs.minNoticeHours) + ' على الأقل من موعدها.');
      var lims = (rs.sizeLimits || []).slice().sort(function (a, b) { return (a.upToVisits == null ? 1e9 : a.upToVisits) - (b.upToVisits == null ? 1e9 : b.upToVisits); });
      if (type === 'single') ri.push('عدد التعديلات المسموح: ' + Math.min(rs.maxPerVisit, sizeLimit(rs, 1)) + '.');
      else ri.push('عدد التعديلات المسموح للباقة: ' + lims.map(function (x) { return (x.upToVisits == null ? 'الباقات الأكبر' : 'حتى ' + x.upToVisits + ' زيارات') + ' ← ' + x.maxChanges; }).join('، ') + '؛ وبحد ' + rs.maxPerVisit + ' لكل زيارة.');
      if (rs.feeAfterFree > 0) ri.push('أول ' + rs.freeChanges + ' تعديلات مجانية، وبعدها ' + sar(rs.feeAfterFree) + ' لكل تعديل تُخصم من قيمة الزيارة.');
      ri.push('يجب أن يكون الموعد الجديد خلال ' + rs.latestReplacementDays + ' يوماً من الموعد الأصلي.');
      if (!rs.allowRepeatOnRescheduled) ri.push('الزيارة التي عُدّل موعدها لا يمكن تعديلها مرة أخرى.');
      if (rs.lockLateBand) ri.push('إذا عدّلت الموعد خلال فترة تُفرض فيها رسوم إلغاء، تبقى تلك الرسوم مطبقة على الزيارة إذا ألغيتها لاحقاً.');
      ri.push('يبقى موعدك الأصلي مؤكداً حتى يُؤكد الموعد الجديد.');
    } else ri.push('تعديل الموعد غير متاح ذاتياً؛ يمكنك طلب مراجعة.');
    S.push({ key: 'reschedule', title: 'تعديل الموعد', items: ri });
    var ex = rules.exceptions;
    S.push({ key: 'service', title: 'إذا تعذّر تقديم الخدمة', items: [
      'إذا ألغى المكتب الزيارة، أو تعذّر توفير العاملة، أو تأخر الوصول أكثر من ' + ex.arrivalToleranceMin + ' دقيقة: لا تُفرض عليك أي رسوم، ولك الاختيار بين استرداد المبلغ أو موعد بديل توافق عليه.',
      'إذا تعذّر استقبال العاملة في الموعد دون إلغاء مسبق: ' + describeFee(ex.noShow.fee, true) + (ex.noShow.requireEvidence ? '، ولا تُطبّق إلا بعد مراجعة الإثباتات.' : '.'),
      'التنفيذ الجزئي (مثل حضور عاملة من اثنتين): تُسترد حصة غير المنفذ كاملة.',
      'في حال الظروف غير الآمنة أو أي خلاف، تُراجع الحالة يدوياً ولا تُحسم آلياً ضدك. يمكنك دائماً طلب مراجعة.'
    ] });
    var rf = rules.refund, fi = [];
    fi.push('يُعاد المبلغ افتراضياً إلى وسيلة الدفع الأصلية' + (rf.allowWallet ? '، ويمكنك اختيار المحفظة بدلاً من ذلك.' : '.'));
    fi.push('نراجع الطلب داخلياً خلال ' + rf.reviewTargetHours + ' ساعة، ثم يُنفذ الاسترداد خلال ' + rf.processingDays + ' ' + (rf.dayType === 'business' ? 'أيام عمل' : 'أيام تقويمية') + ' من الاعتماد (قد يختلف ظهوره حسب البنك).');
    fi.push('إعادة استحقاق زيارة إلى الرصيد ليست استرداداً نقدياً، ولا يُجمع بينهما لنفس القيمة.');
    S.push({ key: 'refund', title: 'الاسترداد', items: fi });
    if (platform) {
      var jf = platform.jokrsFee;
      S.push({ key: 'jokrs', title: 'رسوم منصة JOKRS (منفصلة عن رسوم المكتب)', items: [
        'رسوم JOKRS تحددها المنصة وليست جزءاً من رسوم إلغاء المكتب.',
        'تُسترد عند خلل المكتب: ' + (jf.officeFault === 'refund' ? 'نعم' : 'لا') + '؛ عند الإلغاء ضمن فترة السماح: ' + (jf.customerCancelWithinGrace === 'refund' ? 'نعم' : 'لا') + '؛ قبل قبول المكتب: ' + (jf.pendingAcceptance === 'refund' ? 'نعم' : 'لا') + '؛ عند الإلغاء العادي من العميل: ' + (jf.customerCancel === 'refund' ? 'نعم بنسبة المسترد' : 'لا') + '.',
        'نسخة قواعد الرسوم: ' + platform.feeRuleVersion + '.'
      ] });
    }
    if (rf.extraText && rf.extraText.trim()) S.push({ key: 'extra', title: 'ملاحظة إضافية من المكتب', items: [rf.extraText.trim(), 'هذه الملاحظة توضيحية ولا تغيّر طريقة احتساب المبالغ أعلاه.'] });
    return S;
  }

  /* ------------------------------------------------------------------ */
  /* Version diff                                                        */
  /* ------------------------------------------------------------------ */
  function flattenForDiff(meta, rules, type) {
    var out = [];
    function add(k, l, v) { out.push({ key: k, label: l, value: v }); }
    add('effectiveFrom', 'تاريخ السريان', fmtDTs(meta.effectiveFrom));
    add('effectiveTo', 'تاريخ الانتهاء', meta.effectiveTo ? fmtDTs(meta.effectiveTo) : 'مفتوح');
    var c = rules.cancel;
    add('grace', 'فترة السماح', c.grace && c.grace.enabled ? c.grace.minutes + ' دقيقة، بشرط ' + c.grace.minLeadHours + ' ساعة قبل الزيارة' : 'غير مفعّلة');
    add('pending', 'أثناء انتظار قبول المكتب', c.pendingAcceptance === 'free' ? 'إلغاء مجاني' : 'حسب الشرائح');
    if (type !== 'credits') {
      sortedBands(c.bands || []).forEach(function (b) { add('band:' + b.minHours + '-' + b.maxHours, 'شريحة: ' + bandLabel(b), describeFee(b.fee)); });
      add('fallback', 'القاعدة الاحتياطية', describeFee(c.fallback));
      add('opts', 'خيارات الإلغاء', [c.allowSingleVisit && 'زيارة منفردة', c.allowSelectedVisits && 'زيارات مختارة', c.allowAllRemaining && 'كل المتبقي', c.allowPartialWorkers && 'جزء من العمالة'].filter(Boolean).join('، ') || '—');
    }
    if (type === 'scheduled') {
      add('pkgBefore', 'إلغاء الباقة قبل البدء', describeFee(c.packageBeforeStart));
      add('pkgAfter', 'إلغاء الباقة بعد البدء', describeFee(c.packageAfterStart));
      add('stack', 'العلاقة مع رسوم الشرائح', c.packageVsBand === 'greater_of' ? 'الأعلى منهما دون جمع' : 'رسوم الباقة فقط');
    }
    if (type === 'credits' && rules.credits) {
      var cr = rules.credits;
      add('crNotice', 'مهلة إعادة الرصيد', cr.restoreMinNoticeHours + ' ساعة');
      add('crLate', 'الإلغاء المتأخر', cr.lateAction === 'consume' ? 'احتساب الرصيد مستهلكاً' : 'إعادة الرصيد');
      add('crExp', 'الصلاحية عند الإعادة', cr.expiryOnRestore === 'extend' ? 'تمديد ' + cr.extendDays + ' يوماً' : 'دون تغيير');
      add('crOffice', 'تمديد عند خلل المكتب', cr.officeFaultExtendDays + ' يوماً');
      add('crBefore', 'استرداد قبل الاستخدام', describeFee(cr.refundBeforeUse));
      add('crAfter', 'استرداد بعد الاستخدام', describeFee(cr.refundAfterUse));
    }
    var rs = rules.reschedule;
    add('rsEnabled', 'إعادة الجدولة', rs.enabled ? 'مفعّلة' : 'غير مفعّلة');
    if (rs.enabled) {
      add('rsNotice', 'الإشعار المسبق للتعديل', rs.minNoticeHours + ' ساعة');
      add('rsVisit', 'الحد لكل زيارة', String(rs.maxPerVisit));
      add('rsSize', 'الحد حسب حجم الباقة', (rs.sizeLimits || []).map(function (x) { return (x.upToVisits == null ? 'أكبر' : '≤' + x.upToVisits) + ':' + x.maxChanges; }).join('، '));
      add('rsFree', 'التعديلات المجانية / الرسوم بعدها', rs.freeChanges + ' / ' + sar(rs.feeAfterFree));
      add('rsLatest', 'آخر موعد بديل', rs.latestReplacementDays + ' يوماً');
      add('rsRepeat', 'تعديل زيارة معدلة سابقاً', rs.allowRepeatOnRescheduled ? 'مسموح' : 'غير مسموح');
    }
    var ex = rules.exceptions;
    add('exTol', 'مهلة التأخر المقبولة', ex.arrivalToleranceMin + ' دقيقة');
    add('exNoShow', 'رسوم تعذّر الاستقبال', describeFee(ex.noShow.fee) + (ex.noShow.requireEvidence ? ' (بإثبات)' : ''));
    var rf = rules.refund;
    add('rfWallet', 'المحفظة كخيار للعميل', rf.allowWallet ? 'متاحة' : 'غير متاحة');
    add('rfDays', 'مدة معالجة الاسترداد', rf.processingDays + ' ' + (rf.dayType === 'business' ? 'أيام عمل' : 'أيام تقويمية'));
    add('rfReview', 'هدف المراجعة الداخلية', rf.reviewTargetHours + ' ساعة');
    add('rfText', 'النص الإضافي', rf.extraText || '—');
    return out;
  }
  function diffVersions(type, a, b) {
    var fa = flattenForDiff(a, a.rules, type), fb = flattenForDiff(b, b.rules, type), map = {}, keys = [];
    fa.forEach(function (x) { map[x.key] = { label: x.label, a: x.value, b: '—' }; keys.push(x.key); });
    fb.forEach(function (x) { if (!map[x.key]) { map[x.key] = { label: x.label, a: '—', b: x.value }; keys.push(x.key); } else map[x.key].b = x.value; });
    return keys.map(function (k) { var m = map[k]; return { key: k, label: m.label, a: m.a, b: m.b, changed: m.a !== m.b }; });
  }

  Object.assign(JK, {
    MIN: MIN, HOUR: HOUR, DAY: DAY, L: L, LEVEL_LABEL: LEVEL_LABEL,
    sum: sum, allocate: allocate, pctOf: pctOf, sar: sar, parseSAR: parseSAR, halalasToInput: halalasToInput, fmtPct: fmtPct,
    fmtDT: fmtDT, fmtDTs: fmtDTs, fmtDate: fmtDate, fmtTime: fmtTime, riyadhISO: riyadhISO, toRiyadhInput: toRiyadhInput, addDays: addDays, durText: durText,
    clone: clone, defaultRules: defaultRules, evalFee: evalFee, describeFee: describeFee, bandLabel: bandLabel, matchBand: matchBand, sortedBands: sortedBands, sizeLimit: sizeLimit,
    validatePolicy: validatePolicy, restrictedReasons: restrictedReasons,
    effectiveVersion: effectiveVersion, scheduledVersions: scheduledVersions, findPackage: findPackage, resolvePolicy: resolvePolicy,
    workerOpen: workerOpen, visitOpen: visitOpen, creditOpen: creditOpen, bookingFinance: bookingFinance, paidVisitCount: paidVisitCount,
    checkAvailability: checkAvailability, calculate: calculate, taxShare: taxShare, refundDestinations: destinations, policyText: policyText, freeDeadline: freeDeadline,
    flattenForDiff: flattenForDiff, diffVersions: diffVersions
  });
})(typeof window !== 'undefined' ? window : globalThis);

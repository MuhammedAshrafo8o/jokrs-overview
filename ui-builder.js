/* =====================================================================
   ui-builder.js — guided 6-step policy editor (full page).
   Edits are held in UI.editor until "حفظ المسودة"; validation is live
   and uses the same engine functions as publishing.
   ===================================================================== */
(function (G) {
  'use strict';
  const JK = G.JK, S = JK.Store, L = JK.L, UI = JK.UI;
  const { h, ic, money, dt, badge, btn, empty, pageHead, toast, run, openModal, confirmDialog, go, render } = UI;
  const office = () => S.office(), now = () => S.state.demo.now, byId = (a, id) => JK.store.byId(a, id);
  const STEPS = ['الهوية والتطبيق', 'إلغاء العميل', 'إعادة الجدولة', 'الإخفاق والاستثناءات', 'الاسترداد والصياغة', 'المراجعة والنشر'];

  /* ---------------- path helpers ---------------- */
  function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, path, val) {
    const ks = path.split('.'); let t = o;
    for (let i = 0; i < ks.length - 1; i++) { if (t[ks[i]] == null) t[ks[i]] = {}; t = t[ks[i]]; }
    t[ks[ks.length - 1]] = val;
  }
  const fid = (path, s) => 'f-' + path.replace(/\./g, '-') + (s ? '-' + s : '');
  const mv = (x) => (Number.isInteger(x) ? JK.halalasToInput(x) : '');
  const nv = (x) => (typeof x === 'number' && !isNaN(x) ? String(x) : '');

  UI.onBind = function (el) {
    const ed = UI.editor; if (!ed) return;
    const path = el.dataset.bind, kind = el.dataset.kind || 'str';
    let val;
    switch (kind) {
      case 'bool': val = el.checked; break;
      case 'int': case 'num': val = el.value.trim() === '' ? NaN : Number(el.value); break;
      case 'numOrNull': val = el.value.trim() === '' ? null : Number(el.value); break;
      case 'money': val = el.value.trim() === '' && el.dataset.optional ? 0 : JK.parseSAR(el.value); break;
      case 'dt': val = el.value ? JK.riyadhISO(el.value) : null; break;
      case 'feeType': {
        const old = getPath(ed, path) || {};
        const t = el.value, bases = (el.dataset.bases || 'affected_allocation').split(',');
        const nf = { type: t };
        if (t === 'fixed' || t === 'fixed_per_visit') { nf.amount = Number.isInteger(old.amount) ? old.amount : 0; nf.cap = 0; }
        if (t === 'percent') { nf.pct = typeof old.pct === 'number' ? old.pct : 10; nf.base = bases.includes(old.base) ? old.base : bases[0]; nf.cap = old.cap || 0; }
        val = nf; break;
      }
      case 'target': {
        const arr = ed.meta.targets || (ed.meta.targets = []);
        const i = arr.indexOf(el.value);
        if (el.checked && i < 0) arr.push(el.value); if (!el.checked && i >= 0) arr.splice(i, 1);
        ed.dirty = true; render(); return;
      }
      default: val = el.value;
    }
    setPath(ed, path, val);
    ed.dirty = true;
    render();
  };

  /* ---------------- field components ---------------- */
  function field(label, inner, hint, id) {
    return `<div class="field"><label${id ? ` for="${id}"` : ''}>${h(label)}</label>${inner}${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
  }
  function num(path, val, o) {
    o = o || {}; const id = fid(path);
    return field(o.label, `<div class="input-unit"><input id="${id}" type="number" inputmode="decimal" step="${o.step || 1}" min="${o.min != null ? o.min : 0}"${o.max != null ? ` max="${o.max}"` : ''} value="${h(o.nullable && val === null ? '' : nv(val))}" data-bind="${path}" data-kind="${o.kind || 'num'}"${o.placeholder ? ` placeholder="${h(o.placeholder)}"` : ''}><span>${h(o.unit || '')}</span></div>`, o.hint, id);
  }
  function moneyIn(path, val, o) {
    o = o || {}; const id = fid(path);
    return field(o.label, `<div class="input-unit"><input id="${id}" inputmode="decimal" value="${h(mv(val))}" data-bind="${path}" data-kind="money"${o.optional ? ' data-optional="1" placeholder="بدون"' : ''}><span>ر.س</span></div>`, o.hint, id);
  }
  function check(path, val, label, hint) {
    const id = fid(path);
    return `<div class="field check-field"><label class="check" for="${id}"><input type="checkbox" id="${id}" data-bind="${path}" data-kind="bool"${val ? ' checked' : ''}> ${h(label)}</label>${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
  }
  function select(path, val, opts, label, hint) {
    const id = fid(path);
    return field(label, `<select id="${id}" data-bind="${path}">${opts.map(([v, l]) => `<option value="${h(v)}"${String(val) === String(v) ? ' selected' : ''}>${h(l)}</option>`).join('')}</select>`, hint, id);
  }
  function feeEd(path, fee, allowed, o) {
    o = o || {}; fee = fee || { type: 'unset' };
    const bases = o.bases || ['affected_allocation'];
    const id = fid(path);
    let parts = `<select id="${id}-t" aria-label="${h(o.label)} — نوع الرسوم" data-bind="${path}" data-kind="feeType" data-bases="${bases.join(',')}">${allowed.map((t) => `<option value="${t}"${fee.type === t ? ' selected' : ''}>${h(t === 'unset' ? 'لا توجد قاعدة احتياطية' : L.feeType[t])}</option>`).join('')}</select>`;
    if (fee.type === 'fixed' || fee.type === 'fixed_per_visit') parts += `<span class="input-unit sm"><input id="${id}-a" aria-label="المبلغ" inputmode="decimal" value="${h(mv(fee.amount))}" data-bind="${path}.amount" data-kind="money"><span>ر.س</span></span>`;
    if (fee.type === 'percent') {
      parts += `<span class="input-unit sm"><input id="${id}-p" aria-label="النسبة" type="number" min="0" max="100" step="0.5" value="${h(nv(fee.pct))}" data-bind="${path}.pct" data-kind="num"><span>%</span></span>`;
      parts += `<label class="sr-only" for="${id}-b">أساس النسبة</label><select id="${id}-b" data-bind="${path}.base">${bases.length > 1 ? '' : ''}${!fee.base ? '<option value="">— اختر الأساس —</option>' : ''}${bases.map((b) => `<option value="${b}"${fee.base === b ? ' selected' : ''}>من ${h(L.feeBase[b])}</option>`).join('')}</select>`;
    }
    let capHtml = '';
    if (['fixed', 'fixed_per_visit', 'percent'].includes(fee.type) && o.cap !== false) capHtml = `<details class="adv"${fee.cap > 0 ? ' open' : ''}><summary>حد أقصى للمبلغ (اختياري)</summary><span class="input-unit sm"><input id="${id}-c" aria-label="الحد الأقصى" inputmode="decimal" value="${h(fee.cap > 0 ? mv(fee.cap) : '')}" placeholder="بدون" data-bind="${path}.cap" data-kind="money" data-optional="1"><span>ر.س</span></span></details>`;
    const explain = { fixed: 'يُطبّق مرة واحدة على العملية كاملة مهما كان عدد الزيارات.', fixed_per_visit: 'يُضرب في عدد الزيارات الملغاة في العملية.', percent: 'الأساس محدد صراحةً؛ لا توجد "نسبة من الحجز" دون أساس.', consume: 'يتطلب سماح المنصة ومراجعتها، ويخضع لحدها إن لم يُعتمد.', none: '', unset: 'الفترات غير المغطاة بالشرائح ستمنع الحفظ للنشر.' }[fee.type] || '';
    return `<div class="fee-ed"><span class="fee-l" id="${id}-l">${h(o.label)}</span><div class="fee-parts" role="group" aria-labelledby="${id}-l">${parts}</div>${capHtml}<p class="hint">${h(fee.type === 'unset' ? '' : JK.describeFee(fee))}${explain ? ' — ' + h(explain) : ''}</p></div>`;
  }

  function bandBar(bands, fallback) {
    const s = (bands || []).filter((b) => typeof b.minHours === 'number').slice().sort((a, b) => a.minHours - b.minHours);
    const fin = s.map((b) => (b.maxHours == null ? b.minHours : b.maxHours)).filter((x) => !isNaN(x));
    const top = Math.max(48, Math.max.apply(null, fin.concat([0])) * 1.3);
    const seg = []; let cursor = 0;
    s.forEach((b) => {
      if (b.minHours > cursor) seg.push({ from: cursor, to: b.minHours, gap: true });
      const to = b.maxHours == null ? top : b.maxHours;
      seg.push({ from: b.minHours, to: Math.min(to, top), fee: b.fee, open: b.maxHours == null, overlap: b.minHours < cursor });
      cursor = Math.max(cursor, to);
    });
    if (cursor < top) seg.push({ from: cursor, to: top, gap: true });
    const W = (x) => Math.max(2, ((x.to - x.from) / top) * 100);
    return `<div class="bandbar" aria-hidden="true">${seg.map((x) => `<div class="seg ${x.gap ? (fallback && fallback.type !== 'unset' ? 'fallback' : 'gap') : x.overlap ? 'overlap' : x.fee && x.fee.type === 'none' ? 'free' : 'fee'}" style="width:${W(x)}%" title="${h(x.from + '–' + (x.open ? '∞' : x.to) + ' س')}"><span>${x.gap ? (fallback && fallback.type !== 'unset' ? 'احتياطي' : 'فجوة') : x.overlap ? 'تداخل' : h(x.fee && x.fee.type === 'none' ? 'مجاني' : JK.describeFee(x.fee))}</span></div>`).join('')}</div>
      <div class="bandbar-axis" aria-hidden="true"><span>عند الموعد (0)</span><span>${Math.round(top)} ساعة+ قبل الموعد</span></div>`;
  }

  /* ---------------- steps ---------------- */
  function step1(ed, p, val) {
    const o = office(), at = now();
    const canType = !p.versions.some((v) => v.status === 'published') && !o.assignments.some((a) => a.policyId === p.id);
    const pk = [];
    o.services.forEach((s) => s.packages.forEach((x) => { if (x.bookingType === ed.meta.bookingType) pk.push({ s, x }); }));
    return `<h2 class="step-title">1. الهوية ونطاق التطبيق</h2>
      <div class="form-grid">
        ${field('اسم السياسة بالعربية', `<input id="f-name" value="${h(ed.meta.name)}" data-bind="meta.name" required>`, '', 'f-name')}
        ${field('نوع الحجز', canType ? `<select id="f-type" data-on-change="ed-type">${Object.entries(L.bookingType).map(([k, l]) => `<option value="${k}"${ed.meta.bookingType === k ? ' selected' : ''}>${h(l)}</option>`).join('')}</select>` : `<input id="f-type" value="${h(L.bookingType[ed.meta.bookingType])}" readonly aria-readonly="true">`,
          canType ? 'تغيير النوع يعيد القواعد إلى الإعدادات الافتراضية لهذا النوع.' : 'ثابت لأن للسياسة نسخاً منشورة أو ربطاً. لنوع آخر كرر السياسة.', 'f-type')}
        ${field('بداية السريان (بتوقيت الرياض)', `<input id="f-from" type="datetime-local" value="${h(JK.toRiyadhInput(ed.meta.effectiveFrom))}" data-bind="meta.effectiveFrom" data-kind="dt">`, 'تُطبّق النسخة على الحجوزات الجديدة المؤهلة بعد هذا الوقت فقط.', 'f-from')}
        ${field('نهاية السريان (اختياري)', `<input id="f-to" type="datetime-local" value="${h(ed.meta.effectiveTo ? JK.toRiyadhInput(ed.meta.effectiveTo) : '')}" data-bind="meta.effectiveTo" data-kind="dt">`, '', 'f-to')}
      </div>
      ${field('وصف داخلي (لا يظهر للعميل)', `<textarea id="f-desc" rows="2" data-bind="meta.description">${h(ed.meta.description || '')}</textarea>`, '', 'f-desc')}
      <fieldset class="field"><legend>الخدمات/الباقات المطبقة (يُنفّذ الربط بعد النشر)</legend>
        ${pk.length ? `<div class="target-list">${pk.map(({ s, x }) => { const r = JK.resolvePolicy(o, x.id, at); return `<label class="check"><input type="checkbox" data-bind="meta.targets" data-kind="target" value="${h(x.id)}"${(ed.meta.targets || []).includes(x.id) ? ' checked' : ''}> ${h(s.name)} — ${h(x.name)} <span class="muted small">(حالياً: ${h(r.policy ? r.policy.name + ' v' + r.version.version : 'بدون سياسة')})</span></label>`; }).join('')}</div>
          <p class="hint">يُنشأ تخصيص على مستوى الباقة عند النشر المباشر. يمكن تعديله لاحقاً من صفحة "ربط السياسات".</p>` : '<p class="muted">لا توجد باقات من هذا النوع في المكتب.</p>'}</fieldset>
      <details class="adv"${ed.meta.customerTextEn ? ' open' : ''}><summary>نص اختياري بالإنجليزية للعميل</summary>
        ${field('English customer summary', `<textarea id="f-en" dir="ltr" rows="2" data-bind="meta.customerTextEn">${h(ed.meta.customerTextEn || '')}</textarea>`, 'نص توضيحي فقط؛ لا يغيّر القواعد المحسوبة.', 'f-en')}</details>`;
  }
  function step2(ed) {
    const r = ed.rules, c = r.cancel, t = ed.meta.bookingType;
    let out = `<h2 class="step-title">2. إلغاء العميل</h2>
      <div class="note note-info">${ic('info')}<div><b>الأولوية الحتمية:</b> قيود المنصة الإلزامية ← خلل المكتب ← سياسة الحجز المقبولة ← فترة السماح ثم شريحة الوقت ← القاعدة الاحتياطية. يُقاس مرجعان مستقلان: الوقت المنقضي منذ تأكيد الحجز (لفترة السماح)، والوقت المتبقي قبل الزيارة المتأثرة (للشرائح).</div></div>`;
    if (t !== 'credits') {
      out += `<fieldset class="field"><legend>ما يمكن للعميل إلغاؤه</legend><div class="check-row">
        ${check('rules.cancel.allowSingleVisit', c.allowSingleVisit, t === 'single' ? 'إلغاء الزيارة' : 'إلغاء زيارة واحدة')}
        ${t === 'scheduled' ? check('rules.cancel.allowSelectedVisits', c.allowSelectedVisits, 'إلغاء زيارات مستقبلية مختارة') + check('rules.cancel.allowAllRemaining', c.allowAllRemaining, 'إلغاء جميع الزيارات المتبقية') : ''}
        ${check('rules.cancel.allowPartialWorkers', c.allowPartialWorkers, 'إلغاء جزء من العمالة في زيارة', 'يبقى عامل واحد على الأقل؛ تُحتسب الرسوم على حصة العمالة الملغاة فقط.')}</div></fieldset>`;
    }
    out += `<fieldset class="field"><legend>فترة السماح بعد تأكيد الحجز</legend>${check('rules.cancel.grace.enabled', c.grace.enabled, 'تفعيل فترة سماح مجانية')}
      ${c.grace.enabled ? `<div class="form-grid">${num('rules.cancel.grace.minutes', c.grace.minutes, { label: 'المدة بعد التأكيد', unit: 'دقيقة', kind: 'int', min: 1, max: 1440, hint: 'شاملة للدقيقة الأخيرة.' })}${num('rules.cancel.grace.minLeadHours', c.grace.minLeadHours, { label: 'بشرط ألا يقل الوقت قبل الزيارة عن', unit: 'ساعة', step: 0.5, hint: 'تُقدّم فترة السماح على الشرائح عند تحقق الشرطين.' })}</div>` : ''}</fieldset>`;
    if (t !== 'credits') {
      out += `<fieldset class="field"><legend>شرائح الوقت قبل الزيارة</legend>
        <p class="hint">الحد الأدنى للشريحة <b>مشمول</b> والحد الأعلى <b>غير مشمول</b>: الإلغاء قبل 12 ساعة بالضبط يقع في شريحة "12 فأكثر". اترك "إلى" فارغاً لشريحة مفتوحة.</p>
        ${bandBar(c.bands, c.fallback)}
        <div class="bands">${c.bands.map((b, i) => `<div class="band-row"><span class="band-n">${i + 1}</span>
          ${num(`rules.cancel.bands.${i}.minHours`, b.minHours, { label: 'من (ساعة)', step: 0.5 })}
          ${num(`rules.cancel.bands.${i}.maxHours`, b.maxHours, { label: 'إلى أقل من (ساعة)', step: 0.5, kind: 'numOrNull', nullable: true, placeholder: '∞ مفتوحة' })}
          ${feeEd(`rules.cancel.bands.${i}.fee`, b.fee, ['none', 'fixed_per_visit', 'percent', 'consume'], { label: 'الرسوم', bases: ['affected_allocation'] })}
          <button type="button" class="icon-btn" data-act="bd-del" data-i="${i}" aria-label="حذف الشريحة ${i + 1}">${ic('x')}</button></div>`).join('')}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="bd-add">${ic('plus')}<span>إضافة شريحة</span></button></fieldset>
        <details class="adv"${c.fallback.type !== 'unset' ? ' open' : ''}><summary>خيارات متقدمة: القاعدة الاحتياطية وانتظار قبول المكتب</summary>
          ${feeEd('rules.cancel.fallback', c.fallback, ['unset', 'none', 'fixed_per_visit', 'percent', 'consume'], { label: 'القاعدة الاحتياطية للفترات غير المغطاة', bases: ['affected_allocation'] })}
          ${select('rules.cancel.pendingAcceptance', c.pendingAcceptance, [['free', 'إلغاء مجاني قبل قبول المكتب'], ['bands', 'تُطبّق الشرائح حتى قبل القبول']], 'أثناء انتظار قبول المكتب')}</details>`;
    }
    if (t === 'scheduled') {
      out += `<fieldset class="field"><legend>إلغاء جميع الزيارات المتبقية في الباقة</legend>
        <div class="form-grid">${feeEd('rules.cancel.packageBeforeStart', c.packageBeforeStart, ['none', 'fixed', 'fixed_per_visit', 'percent'], { label: 'قبل بدء الباقة', bases: ['remaining_value', 'affected_allocation'] })}
        ${feeEd('rules.cancel.packageAfterStart', c.packageAfterStart, ['none', 'fixed', 'fixed_per_visit', 'percent'], { label: 'بعد تنفيذ زيارة أو أكثر', bases: ['remaining_value', 'affected_allocation'] })}</div>
        ${select('rules.cancel.packageVsBand', c.packageVsBand, [['greater_of', 'الأعلى من رسوم الباقة ومجموع رسوم الشرائح — دون جمع'], ['package_only', 'رسوم الباقة فقط']], 'العلاقة مع رسوم شرائح الزيارات القريبة', 'الافتراضي عدم الجمع: لا تُفرض رسومان على نفس المبلغ. الزيارات المنفذة لا تُسترد ولا يُعاد تسعيرها.')}</fieldset>`;
    }
    if (t === 'credits') {
      const cr = r.credits;
      out += `<fieldset class="field"><legend>مواعيد الرصيد المرن</legend><div class="form-grid">
        ${num('rules.credits.restoreMinNoticeHours', cr.restoreMinNoticeHours, { label: 'يُعاد الاستحقاق عند الإلغاء قبل', unit: 'ساعة', step: 0.5, hint: 'الحد شامل. الإعادة ليست استرداداً نقدياً.' })}
        ${select('rules.credits.lateAction', cr.lateAction, [['consume', 'احتساب الرصيد مستهلكاً (يتطلب سماح المنصة)'], ['restore', 'إعادة الرصيد أيضاً']], 'عند الإلغاء المتأخر')}
        ${select('rules.credits.expiryOnRestore', cr.expiryOnRestore, [['keep', 'تبقى الصلاحية كما هي'], ['extend', 'تمديد الصلاحية']], 'الصلاحية عند الإعادة')}
        ${cr.expiryOnRestore === 'extend' ? num('rules.credits.extendDays', cr.extendDays, { label: 'أيام التمديد', unit: 'يوم', kind: 'int', min: 1 }) : ''}
        ${num('rules.credits.officeFaultExtendDays', cr.officeFaultExtendDays, { label: 'تمديد عند إلغاء المكتب للموعد', unit: 'يوم', kind: 'int' })}</div></fieldset>
        <fieldset class="field"><legend>استرداد قيمة الباقة نفسها (قواعد منفصلة)</legend><div class="form-grid">
        ${feeEd('rules.credits.refundBeforeUse', cr.refundBeforeUse, ['none', 'fixed', 'percent'], { label: 'قبل أي استخدام', bases: ['remaining_value'] })}
        ${feeEd('rules.credits.refundAfterUse', cr.refundAfterUse, ['none', 'fixed', 'percent'], { label: 'بعد بدء الاستخدام (على الرصيد غير المستخدم)', bases: ['remaining_value'] })}</div>
        ${check('rules.credits.expiredRefundable', cr.expiredRefundable, 'الرصيد المنتهي الصلاحية قابل للاسترداد')}</fieldset>`;
    }
    return out;
  }
  function step3(ed) {
    const rs = ed.rules.reschedule, t = ed.meta.bookingType;
    let out = `<h2 class="step-title">3. إعادة الجدولة</h2>${check('rules.reschedule.enabled', rs.enabled, 'السماح للعميل بتعديل الموعد ذاتياً', 'عند الإيقاف يبقى مسار طلب المراجعة متاحاً للعميل.')}`;
    if (!rs.enabled) return out;
    out += `<div class="form-grid">
      ${num('rules.reschedule.minNoticeHours', rs.minNoticeHours, { label: 'الحد الأدنى للإشعار قبل الموعد', unit: 'ساعة', step: 0.5 })}
      ${num('rules.reschedule.maxPerVisit', rs.maxPerVisit, { label: 'الحد الأقصى لكل زيارة', unit: 'مرة', kind: 'int', min: 1 })}
      ${num('rules.reschedule.latestReplacementDays', rs.latestReplacementDays, { label: 'آخر موعد بديل بعد الموعد الأصلي', unit: 'يوم', kind: 'int', min: 1 })}
      ${num('rules.reschedule.freeChanges', rs.freeChanges, { label: 'عدد التعديلات المجانية', unit: 'تعديل', kind: 'int' })}
      ${moneyIn('rules.reschedule.feeAfterFree', rs.feeAfterFree, { label: 'رسوم كل تعديل بعد المجاني', hint: 'تُخصم من قيمة الزيارة المدفوعة مسبقاً؛ لا يُنشأ دين على العميل.' })}</div>
      <fieldset class="field"><legend>الحد حسب حجم ${t === 'single' ? 'الحجز' : 'الباقة'}</legend>
        <div class="size-rows">${rs.sizeLimits.map((x, i) => `<div class="size-row">
          ${num(`rules.reschedule.sizeLimits.${i}.upToVisits`, x.upToVisits, { label: 'حتى عدد زيارات', kind: 'numOrNull', nullable: true, placeholder: 'أي حجم أكبر' })}
          ${num(`rules.reschedule.sizeLimits.${i}.maxChanges`, x.maxChanges, { label: 'التعديلات المسموحة', kind: 'int' })}
          <button type="button" class="icon-btn" data-act="sz-del" data-i="${i}" aria-label="حذف الصف">${ic('x')}</button></div>`).join('')}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="sz-add">${ic('plus')}<span>إضافة حد</span></button>
        <p class="hint">صف واحد فقط يكون مفتوحاً (فارغ) لأي حجم أكبر.</p></fieldset>
      <div class="check-row">${check('rules.reschedule.allowRepeatOnRescheduled', rs.allowRepeatOnRescheduled, 'السماح بتعديل زيارة سبق تعديلها')}
      ${check('rules.reschedule.lockLateBand', rs.lockLateBand, 'تثبيت شريحة الإلغاء المتأخر عند التعديل داخلها', 'يمنع تجاوز رسوم الإلغاء المتأخر بإعادة الجدولة المتكررة. القاعدة المختارة تظهر للعميل.')}
      ${check('rules.reschedule.requireCustomerAcceptanceForWorkerChange', rs.requireCustomerAcceptanceForWorkerChange, 'تغيير العاملة في الموعد البديل يتطلب موافقة العميل')}</div>
      <div class="note note-info">${ic('info')}<div>التعديل بسبب المكتب لا يُحتسب من حد العميل. الموعد الأصلي يبقى مؤكداً حتى يُؤكد البديل، ويُحفظ الجدولان الأصلي والمعدل. يُفحص التوفر قبل أي اقتراح أو تأكيد.</div></div>`;
    return out;
  }
  function step4(ed) {
    const ex = ed.rules.exceptions;
    return `<h2 class="step-title">4. الإخفاق في تقديم الخدمة والاستثناءات</h2>
      <div class="note note-info">${ic('info')}<div>يُفصل دائماً بين <b>من بدأ الإجراء</b> و<b>من تسبب في المشكلة</b>. عند خلل المكتب: لا رسوم إلغاء على العميل، ويُعرض استرداد مناسب أو موعد بديل يقبله العميل. الحالات المتنازع عليها تتطلب إثباتاً ومراجعة ولا تُحسم آلياً ضد العميل.</div></div>
      <div class="table-wrap"><table class="tbl tbl-compact"><thead><tr><th>الحالة</th><th>المسبب المعتاد</th><th>المعالجة</th></tr></thead><tbody>
        <tr><td>المكتب يلغي / لا تتوفر عاملة</td><td>المكتب</td><td>بدون رسوم — استرداد كامل أو بديل بموافقة العميل</td></tr>
        <tr><td>تأخر المكتب بعد المهلة</td><td>المكتب</td><td>كما سبق، بعد تجاوز المهلة أدناه</td></tr>
        <tr><td>تعذّر استقبال العاملة / عنوان غير صحيح</td><td>العميل (يتطلب إثباتاً)</td><td>رسوم السياسة أدناه بعد المراجعة؛ لا تظهر الزيارة كمنفذة</td></tr>
        <tr><td>ظروف غير آمنة</td><td>ظرف خارجي</td><td>مراجعة دون رسوم تلقائية</td></tr>
        <tr><td>مشكلة بعد البدء / تنفيذ جزئي</td><td>المكتب غالباً</td><td>مراجعة؛ استرداد حصة غير المنفذ بالكامل</td></tr></tbody></table></div>
      <div class="form-grid">${num('rules.exceptions.arrivalToleranceMin', ex.arrivalToleranceMin, { label: 'مهلة التأخر المقبولة لوصول العاملة', unit: 'دقيقة', kind: 'int', max: 240 })}</div>
      ${feeEd('rules.exceptions.noShow.fee', ex.noShow.fee, ['none', 'fixed_per_visit', 'percent', 'consume'], { label: 'رسوم تعذّر الاستقبال (بعد ثبوت الواقعة)', bases: ['affected_allocation'] })}
      ${check('rules.exceptions.noShow.requireEvidence', ex.noShow.requireEvidence, 'اشتراط إثبات من المكتب قبل احتساب أي رسوم', 'إلزامي عند وجود رسوم.')}`;
  }
  function step5(ed) {
    const rf = ed.rules.refund, pf = S.state.platform;
    return `<h2 class="step-title">5. الاسترداد وصياغة العميل</h2>
      <div class="form-grid">
        ${field('الوجهة الافتراضية', `<input id="f-dest" value="وسيلة الدفع الأصلية" readonly aria-readonly="true">`, 'ثابتة في هذا العرض. المدفوعات المختلطة تُعاد لكل مصدر بنسبته.', 'f-dest')}
        ${num('rules.refund.processingDays', rf.processingDays, { label: 'هدف تنفيذ الاسترداد', unit: 'يوم', kind: 'int', min: 1, max: 30 })}
        ${select('rules.refund.dayType', rf.dayType, [['business', 'أيام عمل (دون الجمعة والسبت)'], ['calendar', 'أيام تقويمية']], 'نوع الأيام')}
        ${num('rules.refund.reviewTargetHours', rf.reviewTargetHours, { label: 'هدف المراجعة الداخلية (منفصل عن التنفيذ)', unit: 'ساعة', kind: 'int', min: 1, max: 168 })}</div>
      ${check('rules.refund.allowWallet', rf.allowWallet, 'السماح للعميل باختيار المحفظة بدلاً من وسيلة الدفع', 'خيار صريح من العميل فقط. إعادة استحقاق الزيارة نتيجة مختلفة وليست استرداداً نقدياً.')}
      ${field('نص توضيحي إضافي (اختياري)', `<textarea id="f-extra" rows="2" data-bind="rules.refund.extraText">${h(rf.extraText || '')}</textarea>`, 'يُعرض كملاحظة منفصلة ولا يغيّر القواعد المالية المحسوبة.', 'f-extra')}
      <section class="readonly-box"><h3 class="h3">${ic('shield')} قواعد رسوم JOKRS (للقراءة فقط — تحكمها المنصة)</h3>
        <ul class="mini-list"><li>المبلغ: ${money(pf.jokrsFee.amount)} لكل حجز · نسخة القواعد: ${h(pf.feeRuleVersion)}</li><li>خلل المكتب: ${pf.jokrsFee.officeFault === 'refund' ? 'تُسترد' : 'لا تُسترد'} · ضمن فترة السماح: ${pf.jokrsFee.customerCancelWithinGrace === 'refund' ? 'تُسترد' : 'لا تُسترد'} · قبل قبول المكتب: ${pf.jokrsFee.pendingAcceptance === 'refund' ? 'تُسترد' : 'لا تُسترد'} · إلغاء عادي: ${pf.jokrsFee.customerCancel === 'refund' ? 'تُسترد' : 'لا تُسترد'}</li></ul>
        <p class="hint">رسوم المكتب ورسوم JOKRS تظهر دائماً منفصلة.</p></section>
      <h3 class="h3">الصياغة المولّدة للعميل</h3>${UI.policyTextView(JK.policyText(ed.rules, ed.meta.bookingType, pf))}`;
  }

  function sampleBooking(type, hoursBefore, elapsedMin) {
    const at = Date.parse(now()), H = JK.HOUR, first = at + hoursBefore * H;
    const mkW = (vid, n, alloc) => JK.allocate(alloc, Array(n).fill(1)).map((a, i) => ({ id: vid + '-W' + (i + 1), workerId: 'w' + (i + 1), name: ['عاملة 1', 'عاملة 2'][i], alloc: a, consumed: 0, refunded: 0, fee: 0, transferred: 0, absorbed: 0, status: 'assigned' }));
    const b = { id: 'SAMPLE', ref: 'حجز تجريبي', type, customerName: 'عميل تجريبي', confirmedAt: new Date(at - elapsedMin * JK.MIN).toISOString(), officeAcceptance: 'accepted', visits: [], credits: null, adjustments: [], taxRefunded: 0, jokrsRefunded: 0, customerReschedules: 0, policySnapshot: null };
    let net;
    if (type === 'single') { net = 30000; b.visits.push({ id: 'S-V1', label: '1', origin: 'paid', start: new Date(first).toISOString(), end: new Date(first + 4 * H).toISOString(), status: 'scheduled', alloc: net, workers: mkW('S-V1', 2, net), history: [], customerReschedules: 0 }); }
    else if (type === 'scheduled') {
      net = 100000; const al = JK.allocate(net, Array(8).fill(1));
      for (let i = 0; i < 8; i++) {
        const start = i < 3 ? first - (3 - i) * 7 * JK.DAY - 2 * JK.DAY : first + (i - 3) * 7 * JK.DAY;
        const v = { id: 'S-V' + (i + 1), label: String(i + 1), origin: 'paid', start: new Date(start).toISOString(), end: new Date(start + 4 * H).toISOString(), status: i < 3 ? 'completed' : 'scheduled', alloc: al[i], workers: mkW('S-V' + (i + 1), 1, al[i]), history: [], customerReschedules: 0 };
        if (i < 3) v.workers.forEach((w) => { w.consumed = w.alloc; w.status = 'delivered'; });
        b.visits.push(v);
      }
    } else {
      net = 150000; const al = JK.allocate(net, Array(10).fill(1));
      b.credits = { total: 10, items: al.map((a, i) => ({ id: 'S-C' + (i + 1), label: 'رصيد ' + (i + 1), alloc: a, state: i < 3 ? 'used' : i === 3 ? 'scheduled' : 'available', consumed: i < 3 ? a : 0, refunded: 0, fee: 0, absorbed: 0, expiresAt: new Date(at + 60 * JK.DAY).toISOString(), visitId: i === 3 ? 'S-V1' : null })) };
      b.visits.push({ id: 'S-V1', label: 'موعد 4', origin: 'credit', creditId: 'S-C4', start: new Date(first).toISOString(), end: new Date(first + 4 * H).toISOString(), status: 'scheduled', alloc: 0, workers: mkW('S-V1', 1, 0), history: [], customerReschedules: 0 });
    }
    const vat = Math.round(net * 0.15), jf = S.state.platform.jokrsFee.amount;
    b.price = { lines: [{ label: 'خدمة تجريبية', amount: net }], serviceGross: net, discount: 0, serviceNet: net, vatBps: 1500, vat, jokrsFee: jf, total: net + vat + jf, payments: [{ id: 'S-PAY', method: 'card', state: 'captured', amount: net + vat + jf, refunded: 0 }], costingVersion: 'عينة' };
    return b;
  }
  UI.sampleBooking = sampleBooking;

  function step6(ed, p, val) {
    const pf = S.state.platform, t = ed.meta.bookingType;
    const restricted = val.restricted, direct = !restricted.length && pf.allowDirectPublish;
    const sim = ed.sim;
    const ops = t === 'single' ? [['cancel_visits', 'إلغاء الزيارة'], ['reschedule', 'إعادة جدولة'], ['office_cancel', 'إلغاء من المكتب']]
      : t === 'scheduled' ? [['cancel_visits', 'إلغاء أقرب زيارة'], ['cancel_all_remaining', 'إلغاء الزيارات المتبقية'], ['reschedule', 'إعادة جدولة'], ['office_cancel', 'إلغاء من المكتب']]
        : [['credit_cancel', 'إلغاء موعد من الرصيد'], ['package_refund', 'استرداد الباقة'], ['office_cancel', 'إلغاء المكتب للموعد']];
    if (!ops.some(([k]) => k === sim.op)) sim.op = ops[0][0];
    const sb = sampleBooking(t, sim.hours, sim.elapsed);
    const firstOpen = sb.visits.find((v) => v.status === 'scheduled');
    const req = { type: sim.op, at: now(), visitIds: firstOpen ? [firstOpen.id] : [], initiator: sim.op === 'office_cancel' ? 'office' : 'customer', cause: sim.op === 'office_cancel' ? 'office' : 'customer', remedy: 'refund', newStart: firstOpen ? new Date(Date.parse(firstOpen.start) + 2 * JK.DAY).toISOString() : null };
    let c; try { c = JK.calculate({ booking: sb, platform: pf, req, rules: ed.rules, approvedRestricted: false, policyLabel: 'مسودة v' + ed.version }); } catch (e) { c = null; }
    const texts = JK.policyText(ed.rules, t, pf, { firstVisitStart: new Date(Date.parse(now()) + 3 * JK.DAY).toISOString() });
    const allErr = val.errors;
    return `<h2 class="step-title">6. المراجعة والنشر</h2>
      ${allErr.length ? `<div class="note note-danger" role="alert">${ic('alert')}<div><b>مشكلات يجب حلها قبل الإرسال (${allErr.length}):</b><ul>${allErr.map((e) => `<li><button type="button" class="link-btn" data-act="ed-step" data-step="${e.step}">الخطوة ${e.step}</button>: ${h(e.msg)}</li>`).join('')}</ul></div></div>` : `<div class="note note-success">${ic('check')}<div>لا توجد مشكلات تحقق.</div></div>`}
      ${val.warnings.length ? `<div class="note note-warning">${ic('alert')}<div><b>تنبيهات:</b><ul>${val.warnings.map((w) => `<li>${h(w)}</li>`).join('')}</ul></div></div>` : ''}
      ${restricted.length ? `<div class="note note-info">${ic('shield')}<div><b>تتطلب مراجعة المنصة — لا يمكن للمكتب اعتمادها بنفسه:</b><ul>${restricted.map((w) => `<li>${h(w)}</li>`).join('')}</ul></div></div>` : ''}
      <div class="review-grid">
        <section class="card"><div class="card-head"><h3>ملخص السياسة</h3></div>${UI.policyTextView(texts)}</section>
        <div class="stack">
          <section class="card"><div class="card-head"><h3>معاينة الدفع على الجوال</h3></div>${UI.phoneCheckout({ preview: true, officeName: office().office.name, pkgName: (office().services.flatMap((s) => s.packages).find((x) => x.bookingType === t) || { name: L.bookingType[t] }).name, rules: ed.rules, type: t, firstStart: new Date(Date.parse(now()) + 3 * JK.DAY).toISOString(), visits: t === 'scheduled' ? 8 : t === 'single' ? 1 : 0, price: sb.price, versionLabel: ed.meta.name + ' — مسودة v' + ed.version })}</section>
        </div>
      </div>
      <section class="card"><div class="card-head"><h3>محاكاة مالية على حجز تجريبي</h3><span class="muted small">نفس دالة الحساب المستخدمة في الطلبات والاسترداد</span></div>
        <div class="filters">
          <label class="field-inline"><span>العملية</span><select id="ed-sim-op" data-on-change="ed-sim" data-k="op">${ops.map(([k, l]) => `<option value="${k}"${sim.op === k ? ' selected' : ''}>${h(l)}</option>`).join('')}</select></label>
          <label class="field-inline"><span>قبل الموعد (ساعة)</span><input id="ed-sim-h" type="number" step="0.5" min="0.5" value="${h(sim.hours)}" data-on-change="ed-sim" data-k="hours"></label>
          <label class="field-inline"><span>منذ تأكيد الحجز (دقيقة)</span><input id="ed-sim-e" type="number" step="1" min="0" value="${h(sim.elapsed)}" data-on-change="ed-sim" data-k="elapsed"></label>
        </div>
        <p class="muted small">${h(t === 'scheduled' ? 'باقة 8 زيارات بقيمة 1,000 ر.س، نُفذت 3 زيارات.' : t === 'single' ? 'زيارة بعاملتين بقيمة 300 ر.س.' : '10 أرصدة بقيمة 1,500 ر.س، استُخدم 3 وموعد واحد محجوز.')} القواعد المقيدة تُحسب كأنها غير معتمدة بعد (يُطبّق حد المنصة).</p>
        ${c ? UI.calcView(c, sb) : '<p class="muted">أكمل الحقول المطلوبة لعرض المحاكاة.</p>'}</section>
      <div class="publish-bar">
        <div>${direct ? 'القواعد اعتيادية: ستُنشر مباشرة وتسري من ' + h(JK.fmtDT(ed.meta.effectiveFrom)) + '.' : 'ستُرسل النسخة لمراجعة المنصة وتبقى "بانتظار المراجعة" حتى الاعتماد من أدوات العرض.'}</div>
        ${btn({ label: direct ? 'نشر النسخة' : 'إرسال لمراجعة المنصة', icon: direct ? 'check' : 'shield', kind: 'primary', perm: 'policy.manage', act: 'ed-submit', why: allErr.length ? 'أصلح مشكلات التحقق أولاً (' + allErr.length + ').' : '' })}
      </div>`;
  }

  /* ---------------- page ---------------- */
  UI.pages.builder = function (policyId, version) {
    const o = office(), p = byId(o.policies, policyId);
    if (!p) return empty('السياسة غير موجودة في هذا المكتب', '', `<a class="btn btn-primary" href="#/policies">العودة</a>`);
    const v = p.versions.find((x) => x.version === version);
    if (!v) return empty('النسخة غير موجودة', '', `<a class="btn btn-primary" href="#/policies/${h(p.id)}">عرض السياسة</a>`);
    if (p.archived || !['draft', 'rejected'].includes(v.status)) {
      return `${pageHead(p.name + ' — v' + v.version, '')}<div class="note note-warning">${ic('alert')}<div>هذه النسخة (${h(L.versionStatus[v.status])}) غير قابلة للتعديل. النسخ المنشورة أو قيد المراجعة ثابتة؛ لتغييرها أنشئ نسخة جديدة.</div></div><a class="btn btn-primary" href="#/policies/${h(p.id)}">عرض السياسة</a>`;
    }
    if (!UI.can('policy.manage')) return `${pageHead(p.name, '')}${UI.permNote(['policy.manage'])}<a class="btn btn-primary" href="#/policies/${h(p.id)}">عرض السياسة للقراءة</a>`;
    let ed = UI.editor;
    if (!ed || ed.policyId !== p.id || ed.version !== v.version) {
      ed = UI.editor = { policyId: p.id, version: v.version, step: 1, dirty: false, sim: { op: '', hours: 8, elapsed: 600 },
        meta: { name: v.name, description: v.description || '', customerTextEn: v.customerTextEn || '', effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo || null, bookingType: p.bookingType, targets: (v.targets || []).slice() },
        rules: JK.clone(v.rules) };
    }
    const val = JK.validatePolicy({ name: ed.meta.name, bookingType: ed.meta.bookingType, effectiveFrom: ed.meta.effectiveFrom, effectiveTo: ed.meta.effectiveTo }, ed.rules, S.state.platform, { forPublish: true, now: now() });
    const errCount = (n) => val.errors.filter((e) => e.step === n).length;
    const stepErrs = val.errors.filter((e) => e.step === ed.step);
    const body = [null, step1, step2, step3, step4, step5, step6][ed.step](ed, p, val);
    return `<nav class="crumbs" aria-label="مسار التنقل"><a href="#/policies">السياسات</a> ${ic('chev')} <a href="#/policies/${h(p.id)}">${h(p.name)}</a> ${ic('chev')} <span>تحرير v${ed.version}</span></nav>
      ${pageHead(ed.meta.name || 'سياسة بدون اسم', `${badge('مسودة v' + ed.version, 'muted')} ${v.status === 'rejected' ? badge('مطلوب تعديلات', 'danger') : ''} ${ed.dirty ? badge('تغييرات غير محفوظة', 'warning') : badge('محفوظة', 'success')}`,
        `<button type="button" class="btn btn-secondary" data-act="ed-save">${ic('check')}<span>حفظ المسودة</span></button><a class="btn btn-ghost" href="#/policies/${h(p.id)}">إغلاق</a>`)}
      ${v.reviewNote && v.status === 'rejected' ? `<div class="note note-danger">${ic('alert')}<div><b>ملاحظة المنصة:</b> ${h(v.reviewNote)}</div></div>` : ''}
      <div class="builder">
        <nav class="stepper" aria-label="خطوات المحرر"><ol>${STEPS.map((s, i) => `<li><button type="button" class="step${ed.step === i + 1 ? ' active' : ''}" data-act="ed-step" data-step="${i + 1}"${ed.step === i + 1 ? ' aria-current="step"' : ''}><span class="step-n">${i + 1}</span><span class="step-l">${h(s)}</span>${errCount(i + 1) ? `<span class="step-err" aria-label="${errCount(i + 1)} مشكلة">${errCount(i + 1)}</span>` : ''}</button></li>`).join('')}</ol></nav>
        <section class="card builder-body" aria-labelledby="page-title">
          ${stepErrs.length && ed.step !== 6 ? `<div class="note note-danger" role="alert">${ic('alert')}<div><ul>${stepErrs.map((e) => `<li>${h(e.msg)}</li>`).join('')}</ul></div></div>` : ''}
          ${body}
          <div class="step-nav">${ed.step > 1 ? `<button type="button" class="btn btn-secondary" data-act="ed-step" data-step="${ed.step - 1}">السابق</button>` : '<span></span>'}${ed.step < 6 ? `<button type="button" class="btn btn-primary" data-act="ed-step" data-step="${ed.step + 1}">التالي: ${h(STEPS[ed.step])}</button>` : ''}</div>
        </section>
      </div>`;
  };

  /* ---------------- actions ---------------- */
  Object.assign(UI.act, {
    'ed-step': (el) => { UI.editor.step = parseInt(el.dataset.step, 10); render(); document.getElementById('main').scrollIntoView({ block: 'start' }); },
    'ed-type': (el) => {
      const ed = UI.editor, nt = el.value;
      confirmDialog({ title: 'تغيير نوع الحجز', body: `<p>ستُستبدل القواعد بالإعدادات الافتراضية لنوع "${h(L.bookingType[nt])}". متابعة؟</p>`, ok: 'تغيير النوع' }).then((yes) => {
        if (yes) { ed.meta.bookingType = nt; ed.rules = JK.defaultRules(nt); ed.meta.targets = []; ed.dirty = true; }
        render();
      });
    },
    'bd-add': () => { const ed = UI.editor; ed.rules.cancel.bands.push({ id: 'b' + Date.now(), minHours: 0, maxHours: 3, fee: { type: 'percent', pct: 50, base: 'affected_allocation', cap: 0 } }); ed.dirty = true; render(); },
    'bd-del': (el) => { const ed = UI.editor; ed.rules.cancel.bands.splice(parseInt(el.dataset.i, 10), 1); ed.dirty = true; render(); },
    'sz-add': () => { const ed = UI.editor; ed.rules.reschedule.sizeLimits.unshift({ upToVisits: 4, maxChanges: 1 }); ed.dirty = true; render(); },
    'sz-del': (el) => { const ed = UI.editor; ed.rules.reschedule.sizeLimits.splice(parseInt(el.dataset.i, 10), 1); ed.dirty = true; render(); },
    'ed-sim': (el) => { const s = UI.editor.sim; s[el.dataset.k] = el.dataset.k === 'op' ? el.value : Math.max(0, Number(el.value) || 0); render(); },
    'ed-save': () => {
      const ed = UI.editor;
      const r = run('saveDraft', { policyId: ed.policyId, version: ed.version, meta: Object.assign({}, ed.meta), rules: ed.rules }, 'حُفظت المسودة (تُسجّل التغييرات في سجل النشاط).');
      if (r.ok) { ed.dirty = false; render(); }
    },
    'ed-submit': () => {
      const ed = UI.editor;
      const s = run('saveDraft', { policyId: ed.policyId, version: ed.version, meta: Object.assign({}, ed.meta), rules: ed.rules });
      if (!s.ok) return;
      ed.dirty = false;
      const r = run('submitVersion', { policyId: ed.policyId, version: ed.version });
      if (!r.ok) { render(); return; }
      const pid = ed.policyId, targets = (ed.meta.targets || []).slice();
      UI.editor = null;
      if (r.res.status === 'published') {
        const msgs = [];
        targets.forEach((pk) => {
          const cur = office().assignments.find((a) => a.level === 'package' && a.targetId === pk);
          if (cur && cur.policyId === pid) return;
          try { S.dispatch('setAssignment', { level: 'package', targetId: pk, policyId: pid }); msgs.push('رُبطت: ' + JK.findPackage(office(), pk).pkg.name); }
          catch (e) { msgs.push('تعذّر ربط ' + pk + ': ' + e.message); }
        });
        toast('نُشرت النسخة.' + (msgs.length ? ' ' + msgs.join(' · ') : ''), 'success');
      } else toast('أُرسلت النسخة لمراجعة المنصة. يمكن اعتمادها من "مراجعة المنصة" في أدوات العرض. الربط يتم بعد الاعتماد.', 'info');
      go('/policies/' + pid);
    }
  });
})(window);

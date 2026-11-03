/* ==========================================================================
   MyBank — card management screens
     Customer:  #/cards  #/addcard  #/carddetail
     Admin:     #/admin/cards
   Registers its routes on the app's router object `R` and uses the app's own
   helpers (shell, back, pnav, ashell, I, esc, go, toast, sess, ui, $).
   Data comes only from MBCards.service, so swapping in a backend provider
   needs no change in this file.
   ========================================================================== */
(function (root) {
  'use strict';
  if (typeof R === 'undefined' || !root.MBCards || !root.MBCards.service) {
    if (root.console) console.error('MBCards: load card-utils.js and card-service.js after the app script and before card-ui.js');
    return;
  }
  var U = root.MBCards.utils, S = root.MBCards.service;

  var NFC = '<svg class="bc-nfc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8.5 8.5a5 5 0 0 1 0 7"/><path d="M12 6a8.5 8.5 0 0 1 0 12"/><path d="M15.5 3.5a12 12 0 0 1 0 17"/></svg>';
  function defer(fn) { Promise.resolve().then(fn); }

  /* ---------- shared pieces --------------------------------------------- */
  function groupsHTML(groups) {
    return groups.map(function (g) {
      return '<span class="g">' + g.map(function (ch) { return '<span class="' + (ch.on ? 'on' : 'd') + '">' + ch.c + '</span>'; }).join('') + '</span>';
    }).join('');
  }

  /* Number display for a STORED card: bullets plus the last 4 digits. */
  function maskedHTML(c) {
    var total = c.brandId === 'amex' ? 15 : 16, fake = '', i;
    for (i = 0; i < total - 4; i++) fake += '0';
    return groupsHTML(U.previewGroups(fake + c.last4, c.brandId));
  }

  function pillHTML(st) {
    var cls = { Active: 'p-ok', Pending: 'p-wait', Blocked: 'p-bad', Expired: 'p-mut' }[st] || 'p-wait';
    return '<span class="pill ' + cls + '">' + esc(st) + '</span>';
  }

  /* o: { id, sm, back, blocked, brandId, holder, exp, numberHtml, cvvDots, aria } */
  function cardHTML(o) {
    var brand = o.brandId || 'unknown', label = brand === 'unknown' ? '' : U.brandLabel(brand);
    return '<div class="bcard' + (o.sm ? ' sm' : '') + (o.blocked ? ' blocked' : '') + '" data-brand="' + brand + '"' + (o.id ? ' id="' + o.id + '"' : '') + ' role="img" aria-label="' + esc(o.aria || 'Bank card') + '">' +
      '<div class="bc-in">' +
        '<div class="bc-face"><div class="bc-top"><span class="bc-bank">' + BANK + 'MyBank</span><span class="bc-brand ' + brand + '" data-bc="brand">' + esc(label) + '</span></div>' +
          '<div class="bc-mid"><span class="bc-chip"></span>' + NFC + '</div>' +
          '<div class="bc-num" data-bc="num">' + o.numberHtml + '</div>' +
          '<div class="bc-bot"><div><div class="bc-l">Card holder</div><div class="bc-v' + (o.holder ? '' : ' ph') + '" data-bc="name">' + esc(o.holder || 'Your name') + '</div></div>' +
          '<div class="bc-r"><div class="bc-l">Expires</div><div class="bc-v' + (o.exp ? '' : ' ph') + '" data-bc="exp">' + esc(o.exp || 'MM/YY') + '</div></div></div></div>' +
        (o.back === false ? '' : '<div class="bc-face bc-back"><div class="bc-stripe"></div><div class="bc-sign" data-bc="cvv" aria-hidden="true">' + (o.cvvDots || '') + '</div><div class="bc-note">Simulated card for the MyBank prototype.</div></div>') +
      '</div></div>';
  }

  function storedCardHTML(c, opts) {
    var st = U.effectiveStatus(c);
    return cardHTML({ sm: opts && opts.sm, back: false, blocked: st === 'Blocked', brandId: c.brandId, holder: c.holder, exp: c.exp, numberHtml: maskedHTML(c),
      aria: c.brand + ' card ending ' + c.last4 });
  }

  function byNewest(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }

  /* ======================================================================
     CUSTOMER — card list
     ====================================================================== */
  R['cards'] = function () {
    defer(function () {
      if (!$('#cm_list')) return;
      S.listMine(sess.email).then(paintMine).catch(function () {
        var b = $('#cm_list'); if (b) b.innerHTML = '<div class="empty">We could not load your cards. Please try again.</div>';
      });
    });
    return shell('<div class="screen">' + back('My Cards', '#/home') + '<div id="cm_list"><div class="cm-skel"></div></div>' +
      '<button class="btn" onclick="go(\'#/addcard\')">+ Add Card</button></div>' + pnav('cards'));
  };

  function paintMine(cards) {
    var box = $('#cm_list'); if (!box) return;
    if (!cards.length) {
      box.innerHTML = '<div class="empty">' + I('card', 34) + '<div style="margin-top:8px">No cards yet. Add your first card.</div></div>';
      return;
    }
    box.innerHTML = cards.slice().sort(byNewest).map(function (c) {
      var st = U.effectiveStatus(c);
      return '<button class="cm-item" data-id="' + esc(c.id) + '" onclick="MBCards.ui.open(this.dataset.id)" aria-label="' + esc(c.brand + ' card ending ' + c.last4 + ', ' + st) + '">' +
        storedCardHTML(c, { sm: true }) +
        '<div class="cm-meta"><span>Added ' + esc(U.formatDate(c.createdAt)) + '</span>' + pillHTML(st) + '</div></button>';
    }).join('');
  }

  /* ======================================================================
     CUSTOMER — card detail
     ====================================================================== */
  R['carddetail'] = function () {
    var id = ui.cardId;
    if (!id) { go('#/cards'); return ''; }
    defer(function () {
      S.listMine(sess.email).then(function (cs) {
        var box = $('#cm_detail'); if (!box) return;
        var c = cs.filter(function (x) { return x.id === id; })[0];
        if (!c) { go('#/cards'); return; }
        box.innerHTML = detailHTML(c);
      });
    });
    return shell('<div class="screen">' + back('Card Details', '#/cards') + '<div id="cm_detail"><div class="cm-skel"></div></div></div>' + pnav('cards'));
  };

  function detailHTML(c) {
    var st = U.effectiveStatus(c);
    var row = function (l, v) { return '<div class="row"><div class="grow"><small>' + l + '</small><b>' + v + '</b></div></div>'; };
    var msg = st === 'Pending' ? '<div class="note">' + I('shield', 18) + '<div>This card is waiting for verification. We will let you know once it is approved.</div></div>' :
      st === 'Blocked' ? '<div class="note red">' + I('shield', 18) + '<div>This card has been blocked. Please contact customer care.</div></div>' :
      st === 'Expired' ? '<div class="note">' + I('shield', 18) + '<div>This card has expired. Remove it and add a new one.</div></div>' : '';
    return storedCardHTML(c) + msg +
      row('Card holder', esc(c.holder)) + row('Card type', esc(c.brand)) + row('Card number', U.maskNumber(c.last4)) +
      row('Expiry date', esc(c.exp)) + row('Status', pillHTML(st)) +
      row('Added', esc(U.formatDate(c.createdAt)) + ' at ' + esc(U.formatTime(c.createdAt))) + row('Reference', esc(c.id)) +
      '<div style="height:16px"></div><button class="btn out" data-id="' + esc(c.id) + '" onclick="MBCards.ui.removeMine(this.dataset.id)" style="color:var(--red)">Remove Card</button>';
  }

  /* ======================================================================
     CUSTOMER — add card (with live preview)
     ====================================================================== */
  var form = { submitted: false };

  R['addcard'] = function () {
    form.submitted = false;
    var months = '<option value="">MM</option>', years = '<option value="">YYYY</option>', m;
    for (m = 1; m <= 12; m++) months += '<option value="' + m + '">' + U.pad2(m) + '</option>';
    U.expiryYears().forEach(function (y) { years += '<option value="' + y + '">' + y + '</option>'; });

    var preview = cardHTML({ id: 'cm_prev', brandId: 'unknown', holder: U.normalizeName(sess.name).slice(0, 26), exp: '',
      numberHtml: groupsHTML(U.previewGroups('', 'unknown')), cvvDots: '', aria: 'Live preview of your card' });

    return shell('<div class="screen">' + back('Add Card', '#/cards') + preview +
      '<div class="cm-demo"><span>Prototype: use test details only.</span>' +
        '<button type="button" class="btn sm out" onclick="MBCards.ui.fill(\'visa\')">Test Visa</button>' +
        '<button type="button" class="btn sm out" onclick="MBCards.ui.fill(\'mastercard\')">Test Mastercard</button></div>' +
      '<form id="cm_form" onsubmit="return MBCards.ui.submit(event)" autocomplete="off" novalidate>' +
        '<label class="l" for="cm_name">Cardholder name</label>' +
        '<input class="field" id="cm_name" placeholder="Name on card" maxlength="26" autocomplete="cc-name" value="' + esc(U.normalizeName(sess.name).slice(0, 26)) + '" oninput="MBCards.ui.input(this)" aria-describedby="cm_e_holder">' +
        '<div class="cm-fm" id="cm_e_holder" role="alert"></div>' +
        '<label class="l" for="cm_num">Card number</label>' +
        '<div class="inwrap"><input class="field" id="cm_num" inputmode="numeric" autocomplete="off" placeholder="0000 0000 0000 0000" maxlength="23" oninput="MBCards.ui.input(this)" aria-describedby="cm_e_number"><span class="cm-tag" id="cm_tag" aria-live="polite"></span></div>' +
        '<div class="cm-fm" id="cm_e_number" role="alert"></div>' +
        '<div class="cm-row3">' +
          '<div><label class="l" for="cm_mm">Expiry month</label><select class="field" id="cm_mm" onchange="MBCards.ui.input(this)">' + months + '</select></div>' +
          '<div><label class="l" for="cm_yy">Expiry year</label><select class="field" id="cm_yy" onchange="MBCards.ui.input(this)">' + years + '</select></div>' +
          '<div><label class="l" for="cm_cvv">CVV</label><input class="field" id="cm_cvv" type="password" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="•••" onfocus="MBCards.ui.flip(true)" onblur="MBCards.ui.flip(false)" oninput="MBCards.ui.input(this)"></div>' +
        '</div>' +
        '<div class="cm-fm" id="cm_e_row" role="alert"></div>' +
        '<div class="cm-safe">' + I('lock', 15) + '<span>Only the last 4 digits are kept. Your full card number and CVV are never saved or shown to anyone.</span></div>' +
        '<div id="cm_err" class="err" role="alert"></div>' +
        '<button class="btn" id="cm_btn">Add Card</button>' +
      '</form></div>' + pnav('cards'));
  };

  function val(id) { var e = $('#' + id); return e ? e.value : ''; }
  function readDraft() {
    return { holder: val('cm_name'), number: val('cm_num'), expMonth: val('cm_mm'), expYear: val('cm_yy'), cvv: val('cm_cvv') };
  }
  function part(p, key) { return p.querySelector('[data-bc="' + key + '"]'); }

  function paintPreview() {
    var p = $('#cm_prev'); if (!p) return;
    var d = readDraft(), digits = U.onlyDigits(d.number), brand = U.detectBrand(digits);
    p.setAttribute('data-brand', brand);
    var b = part(p, 'brand'); b.className = 'bc-brand ' + brand; b.textContent = brand === 'unknown' ? '' : U.brandLabel(brand);
    part(p, 'num').innerHTML = groupsHTML(U.previewGroups(digits, brand));
    var name = U.normalizeName(d.holder), n = part(p, 'name');
    n.textContent = name || 'Your name'; n.classList.toggle('ph', !name);
    var e = part(p, 'exp'), has = d.expMonth || d.expYear;
    e.textContent = U.pad2(d.expMonth || 0).replace('00', 'MM') + '/' + (d.expYear ? U.pad2(+d.expYear % 100) : 'YY');
    e.classList.toggle('ph', !has);
    var dots = ''; for (var i = 0; i < String(d.cvv).length; i++) dots += '•';
    part(p, 'cvv').textContent = dots;
    var tag = $('#cm_tag'); if (tag) tag.textContent = brand === 'unknown' ? '' : U.brandLabel(brand);
  }

  /* Re-space the number while keeping the caret where the customer is typing. */
  function reformat(el) {
    var before = U.onlyDigits(el.value.slice(0, el.selectionStart == null ? el.value.length : el.selectionStart)).length;
    var digits = U.onlyDigits(el.value), brand = U.detectBrand(digits);
    digits = digits.slice(0, U.maxDigits(brand));
    var out = U.formatNumber(digits, brand);
    el.value = out;
    if (document.activeElement === el && el.setSelectionRange) {
      var i = 0, c = 0; while (i < out.length && c < before) { if (/\d/.test(out.charAt(i))) c++; i++; }
      el.setSelectionRange(i, i);
    }
  }

  function cvvMax() {
    var spec = U.BRANDS[U.detectBrand(val('cm_num'))];
    return spec.cvvLength;
  }

  var FIELD_MAP = { holder: ['cm_e_holder', ['cm_name']], number: ['cm_e_number', ['cm_num']], expiry: ['cm_e_row', ['cm_mm', 'cm_yy']], cvv: ['cm_e_row', ['cm_cvv']] };

  function paintErrors(errors) {
    ['cm_name', 'cm_num', 'cm_mm', 'cm_yy', 'cm_cvv'].forEach(function (id) { var e = $('#' + id); if (e) e.classList.remove('bad'); });
    ['cm_e_holder', 'cm_e_number', 'cm_e_row'].forEach(function (id) { var e = $('#' + id); if (e) e.textContent = ''; });
    var row = [];
    Object.keys(errors).forEach(function (k) {
      var m = FIELD_MAP[k]; if (!m) return;
      m[1].forEach(function (id) { var e = $('#' + id); if (e) e.classList.add('bad'); });
      if (m[0] === 'cm_e_row') row.push(errors[k]); else { var t = $('#' + m[0]); if (t) t.textContent = errors[k]; }
    });
    var r = $('#cm_e_row'); if (r) r.textContent = row.join(' ');
  }

  function focusFirst(errors) {
    var order = [['holder', 'cm_name'], ['number', 'cm_num'], ['expiry', val('cm_mm') ? 'cm_yy' : 'cm_mm'], ['cvv', 'cm_cvv']], i, el;
    for (i = 0; i < order.length; i++) if (errors[order[i][0]]) { el = $('#' + order[i][1]); if (el) el.focus(); return; }
  }

  function wipeSensitive() {
    var a = $('#cm_num'), b = $('#cm_cvv'); if (a) a.value = ''; if (b) b.value = '';
  }

  /* ======================================================================
     ADMIN — card management
     ====================================================================== */
  var adm = { rows: [], q: '', status: 'All', brand: 'All', sort: 'new', current: null, opener: null };

  R['admin/cards'] = function () {
    defer(function () {
      if (!$('#cm_rows')) return;
      S.listAll().then(function (rows) { adm.rows = rows; paintAdmin(); }).catch(function () {
        var b = $('#cm_rows'); if (b) b.innerHTML = '<tr><td colspan="6" class="cm-empty">We could not load card records.</td></tr>';
      });
    });
    var opt = function (list, cur) {
      return list.map(function (o) { var p = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(p[0]) + '"' + (p[0] === cur ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('');
    };
    return ashell('cards', 'Card Management',
      '<div class="cm-banner">' + I('shield', 18) + '<div>Showing sample records plus any cards customers add in this browser. Card numbers are always masked and CVVs are never stored or displayed. Connect the backend provider to show live data.</div></div>' +
      '<div class="stats" id="cm_stats"></div>' +
      '<div class="panel">' +
        '<div class="sbar">' +
          '<input id="cm_q" type="search" placeholder="Search cards..." value="' + esc(adm.q) + '" oninput="MBCards.ui.filter(\'q\',this.value)" aria-label="Search by name, email, last 4 digits or ID" title="Search by name, email, last 4 digits or ID">' +
          '<select aria-label="Filter by status" onchange="MBCards.ui.filter(\'status\',this.value)">' + opt([['All', 'All statuses'], 'Active', 'Pending', 'Blocked', 'Expired'], adm.status) + '</select>' +
          '<select aria-label="Filter by card brand" onchange="MBCards.ui.filter(\'brand\',this.value)">' + opt([['All', 'All brands'], ['visa', 'Visa'], ['mastercard', 'Mastercard'], ['verve', 'Verve'], ['amex', 'Amex']], adm.brand) + '</select>' +
          '<select aria-label="Sort records" onchange="MBCards.ui.filter(\'sort\',this.value)">' + opt([['new', 'Newest first'], ['old', 'Oldest first']], adm.sort) + '</select>' +
        '</div>' +
        '<div class="cm-count" id="cm_count" aria-live="polite"></div>' +
        '<div class="tblwrap"><table class="tbl cm-tbl"><thead><tr><th>Cardholder</th><th>Card</th><th>Expiry</th><th>Registered</th><th>Status</th><th></th></tr></thead>' +
        '<tbody id="cm_rows"><tr><td colspan="6" class="cm-empty">Loading card records…</td></tr></tbody></table></div>' +
      '</div>');
  };

  function filtered() {
    var q = adm.q.trim().toLowerCase();
    var rows = adm.rows.filter(function (c) {
      var st = U.effectiveStatus(c);
      if (adm.status !== 'All' && st !== adm.status) return false;
      if (adm.brand !== 'All' && c.brandId !== adm.brand) return false;
      if (!q) return true;
      return [c.holder, c.customer, c.email, c.last4, c.id, c.brand, st].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    rows.sort(adm.sort === 'old' ? function (a, b) { return byNewest(b, a); } : byNewest);
    return rows;
  }

  function paintAdmin() {
    var body = $('#cm_rows'); if (!body) return;
    var count = function (s) { return adm.rows.filter(function (c) { return U.effectiveStatus(c) === s; }).length; };
    var stat = function (ic, l, n) { return '<div class="stat"><span class="ico">' + I(ic, 20) + '</span><div><span class="sub">' + l + '</span><b>' + n + '</b></div></div>'; };
    var st = $('#cm_stats');
    if (st) st.innerHTML = stat('card', 'Total cards', adm.rows.length) + stat('shield', 'Active', count('Active')) + stat('bell', 'Pending review', count('Pending')) + stat('lock', 'Blocked or expired', count('Blocked') + count('Expired'));

    var rows = filtered();
    $('#cm_count').textContent = 'Showing ' + rows.length + ' of ' + adm.rows.length + ' cards';
    body.innerHTML = rows.length ? rows.map(function (c) {
      var s = U.effectiveStatus(c);
      return '<tr data-id="' + esc(c.id) + '" onclick="MBCards.ui.view(this.dataset.id)">' +
        '<td data-l="Cardholder"><div><b>' + esc(c.holder || '—') + '</b><span class="cm-sub">' + esc(c.email || '') + '</span></div></td>' +
        '<td data-l="Card"><span class="cm-brandcell"><span class="cm-chipb ' + c.brandId + '">' + esc(c.brand) + '</span><span class="cm-mono">•••• ' + esc(c.last4) + '</span></span></td>' +
        '<td data-l="Expiry"><span class="cm-mono">' + esc(c.exp || '—') + '</span></td>' +
        '<td data-l="Registered"><div>' + esc(U.formatDate(c.createdAt)) + '<span class="cm-sub">' + esc(U.formatTime(c.createdAt)) + '</span></div></td>' +
        '<td data-l="Status">' + pillHTML(s) + '</td>' +
        '<td data-l=""><button class="mini" onclick="event.stopPropagation();MBCards.ui.view(this.closest(\'tr\').dataset.id)" aria-label="View record ' + esc(c.id) + '">View</button></td></tr>';
    }).join('') : '<tr><td colspan="6" class="cm-empty">No cards match your search.</td></tr>';
  }

  /* ---------- view-record dialog ---------------------------------------- */
  function customerName(c) {
    var u = (typeof users !== 'undefined' ? users : []).filter(function (x) { return x.e === c.email; })[0];
    return c.customer || (u && u.n) || c.holder || '—';
  }

  function modalHTML(c) {
    var st = U.effectiveStatus(c);
    var d = function (l, v) { return '<div><small>' + l + '</small><b>' + v + '</b></div>'; };
    var acts = '';
    if (c.status !== 'Active') acts += '<button class="gbtn" data-s="Active" onclick="MBCards.ui.setStatus(this.dataset.s)">' + (c.status === 'Blocked' ? 'Unblock card' : 'Approve card') + '</button>';
    if (c.status !== 'Blocked') acts += '<button class="danger" data-s="Blocked" onclick="MBCards.ui.setStatus(this.dataset.s)">Block card</button>';
    return '<div class="cm-back" id="cm_modal" onclick="if(event.target===this)MBCards.ui.closeModal()">' +
      '<div class="cm-modal" role="dialog" aria-modal="true" aria-labelledby="cm_mt">' +
        '<div class="cm-mh"><h2 id="cm_mt">Card record</h2><button class="cm-x" id="cm_close" aria-label="Close" onclick="MBCards.ui.closeModal()">×</button></div>' +
        storedCardHTML(c) +
        '<div class="cm-dl">' +
          d('Record ID', esc(c.id)) + d('Status', pillHTML(st)) +
          d('Cardholder', esc(c.holder || '—')) + d('Customer', esc(customerName(c))) +
          d('Email', esc(c.email || '—')) + d('Card type', esc(c.brand)) +
          d('Card number', U.maskNumber(c.last4)) + d('Expiry date', esc(c.exp || '—')) +
          d('Registered date', esc(U.formatDate(c.createdAt))) + d('Registered time', esc(U.formatTime(c.createdAt))) +
          d('Source', c.source === 'mock' ? 'Sample data' : c.source === 'backend' ? 'Backend' : 'Customer submission') +
        '</div>' +
        '<div class="sub" style="margin-bottom:12px">Full card numbers and CVVs are never stored or shown. Only the last 4 digits are kept.</div>' +
        '<div class="cm-acts">' + acts + '<button class="btn sm out" onclick="MBCards.ui.closeModal()">Close</button></div>' +
      '</div></div>';
  }

  function showModal(c) {
    var old = $('#cm_modal'); if (old) old.parentNode.removeChild(old);
    if (!adm.opener) adm.opener = document.activeElement;
    adm.current = c;
    document.body.insertAdjacentHTML('beforeend', modalHTML(c));
    document.body.style.overflow = 'hidden';
    var x = $('#cm_close'); if (x) x.focus();
  }

  function closeModal() {
    var m = $('#cm_modal'); if (m) m.parentNode.removeChild(m);
    document.body.style.overflow = '';
    var o = adm.opener; adm.opener = null; adm.current = null;
    if (o && o.focus && document.contains(o)) o.focus();
  }

  document.addEventListener('keydown', function (e) {
    var m = $('#cm_modal'); if (!m) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key === 'Tab') {
      var f = m.querySelectorAll('button:not([disabled])'); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', closeModal);

  /* ======================================================================
     Handlers called from inline attributes
     ====================================================================== */
  root.MBCards.ui = {
    /* customer */
    open: function (id) { ui.cardId = id; go('#/carddetail'); },

    flip: function (on) { var p = $('#cm_prev'); if (p) p.classList.toggle('flip', !!on); },

    input: function (el) {
      if (el.id === 'cm_num') {
        reformat(el);
        var c = $('#cm_cvv'); if (c) c.value = U.onlyDigits(c.value).slice(0, cvvMax());
      } else if (el.id === 'cm_cvv') {
        el.value = U.onlyDigits(el.value).slice(0, cvvMax());
      }
      paintPreview();
      if (form.submitted) paintErrors(U.validateCard(readDraft()).errors);
    },

    /* Test details only. These are well-known public test numbers, not real cards. */
    fill: function (kind) {
      var num = kind === 'mastercard' ? '5555 5555 5555 4444' : '4111 1111 1111 1111';
      var n = $('#cm_num'), mm = $('#cm_mm'), yy = $('#cm_yy'), cv = $('#cm_cvv');
      n.value = num; mm.value = '12'; yy.value = String(new Date().getFullYear() + 3); cv.value = '123';
      paintPreview();
      if (form.submitted) paintErrors(U.validateCard(readDraft()).errors);
    },

    submit: function (ev) {
      ev.preventDefault();
      form.submitted = true;
      var draft = readDraft(), v = U.validateCard(draft);
      paintErrors(v.errors);
      $('#cm_err').textContent = '';
      if (!v.ok) { focusFirst(v.errors); return false; }
      var btn = $('#cm_btn'); btn.disabled = true; btn.textContent = 'Adding card…';
      S.add(sess.email, draft).then(function () {
        wipeSensitive(); draft.number = draft.cvv = '';
        toast('Card added. It is awaiting verification.');
        go('#/cards');
      }).catch(function (err) {
        draft.number = draft.cvv = '';
        var b = $('#cm_btn'); if (b) { b.disabled = false; b.textContent = 'Add Card'; }
        if (err && err.fieldErrors) paintErrors(err.fieldErrors);
        else { var e = $('#cm_err'); if (e) e.textContent = (err && err.message) || 'We could not add this card. Please try again.'; }
      });
      return false;
    },

    removeMine: function (id) {
      if (!confirm('Remove this card?')) return;
      S.remove(sess.email, id).then(function () { toast('Card removed'); go('#/cards'); });
    },

    /* admin */
    filter: function (key, value) { adm[key] = value; paintAdmin(); },

    view: function (id) {
      var c = adm.rows.filter(function (x) { return x.id === id; })[0];
      if (c) showModal(c);
    },

    setStatus: function (status) {
      var c = adm.current; if (!c) return;
      S.setStatus(c.email, c.id, status).then(function (upd) {
        adm.rows = adm.rows.map(function (r) { return r.id === upd.id ? upd : r; });
        paintAdmin();
        showModal(upd);
        toast(status === 'Blocked' ? 'Card blocked' : status === 'Active' ? 'Card approved' : 'Card updated');
      }).catch(function (e) { toast((e && e.message) || 'Could not update the card'); });
    },

    closeModal: closeModal
  };
})(typeof window !== 'undefined' ? window : globalThis);

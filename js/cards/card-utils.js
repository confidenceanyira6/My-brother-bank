/* ==========================================================================
   MyBank — card utilities
   Pure functions only: no DOM, no storage, no network.
   Safe to reuse from the backend integration layer and from tests.

   SECURITY RULE for this whole module family:
   a full card number and a CVV may exist ONLY inside the add-card form while
   the customer is typing. validateCard() reads them, toSafeRecord() drops them.
   Nothing downstream ever receives more than the last 4 digits.
   ========================================================================== */
(function (root) {
  'use strict';

  var BRANDS = {
    visa:       { id: 'visa',       label: 'Visa',       cvvLength: 3, lengths: [13, 16, 19] },
    mastercard: { id: 'mastercard', label: 'Mastercard', cvvLength: 3, lengths: [16] },
    verve:      { id: 'verve',      label: 'Verve',      cvvLength: 3, lengths: [16, 18, 19] },
    amex:       { id: 'amex',       label: 'Amex',       cvvLength: 4, lengths: [15] },
    unknown:    { id: 'unknown',    label: 'Card',       cvvLength: 4, lengths: [] }
  };

  var STATUSES = ['Pending', 'Active', 'Blocked', 'Expired'];

  function onlyDigits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  /* ---- brand ---------------------------------------------------------- */
  function detectBrand(digits) {
    var d = onlyDigits(digits);
    if (/^4/.test(d)) return 'visa';
    if (/^(5060|5061|6500)/.test(d)) return 'verve';
    if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
    if (/^3[47]/.test(d)) return 'amex';
    return 'unknown';
  }

  /* Accepts ids ('visa'), labels ('Visa') and legacy stored values ('VISA', 'Card'). */
  function normalizeBrand(value) {
    var v = String(value || '').toLowerCase();
    return BRANDS[v] ? v : 'unknown';
  }

  function brandLabel(id) { return (BRANDS[normalizeBrand(id)] || BRANDS.unknown).label; }

  function maxDigits(brandId) { return brandId === 'amex' ? 15 : 19; }

  /* ---- formatting ----------------------------------------------------- */
  function formatNumber(digits, brandId) {
    var d = onlyDigits(digits).slice(0, maxDigits(brandId));
    if (brandId === 'amex') {
      return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
    }
    return d.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  /* Masked display for a stored card: only the last 4 digits are ever known. */
  function maskNumber(last4) {
    var l = onlyDigits(last4).slice(-4);
    return '•••• •••• •••• ' + (l || '••••');
  }

  /* Live preview while typing. Returns groups of {c, on}: c = character to show,
     on = true once the customer has typed that position. Every position except
     the final 4 always shows a bullet, so the number is never displayed in full. */
  function previewGroups(digits, brandId) {
    var d = onlyDigits(digits).slice(0, maxDigits(brandId));
    var total = brandId === 'amex' ? 15 : Math.max(16, d.length);
    var sizes = brandId === 'amex' ? [4, 6, 5] : null;
    var groups = [], pos = 0, i, g, size;
    if (!sizes) { sizes = []; for (i = 0; i < total; i += 4) sizes.push(Math.min(4, total - i)); }
    for (g = 0; g < sizes.length; g++) {
      var group = [];
      for (size = 0; size < sizes[g]; size++, pos++) {
        var typed = pos < d.length;
        var isLast4 = pos >= total - 4;
        group.push({ c: isLast4 && typed ? d.charAt(pos) : '•', on: typed });
      }
      groups.push(group);
    }
    return groups;
  }

  /* ---- checks --------------------------------------------------------- */
  function luhn(digits) {
    var s = 0, dbl = false, i, x;
    digits = onlyDigits(digits);
    if (!digits) return false;
    for (i = digits.length - 1; i >= 0; i--) {
      x = +digits.charAt(i);
      if (dbl) { x *= 2; if (x > 9) x -= 9; }
      s += x; dbl = !dbl;
    }
    return s % 10 === 0;
  }

  /* A card is valid through the END of its expiry month. */
  function isExpired(expMonth, expYear, now) {
    var n = now || new Date();
    var m = +expMonth, y = +expYear;
    if (!(m >= 1 && m <= 12) || !(y > 0)) return false;
    return y < n.getFullYear() || (y === n.getFullYear() && m < n.getMonth() + 1);
  }

  function normalizeName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* draft = { holder, number, expMonth, expYear, cvv }  (raw form values)
     Returns { ok, errors, brand } where errors is keyed holder|number|expiry|cvv. */
  function validateCard(draft, now) {
    var errors = {};
    var holder = normalizeName(draft.holder);
    var digits = onlyDigits(draft.number);
    var brand = detectBrand(digits);
    var spec = BRANDS[brand];
    var cvv = String(draft.cvv == null ? '' : draft.cvv);
    var m = +draft.expMonth, y = +draft.expYear;

    if (holder.length < 2) errors.holder = 'Enter the name shown on the card.';
    else if (holder.length > 26 || !/^[\p{L}][\p{L} .'\-]*$/u.test(holder)) errors.holder = 'Use letters only, up to 26 characters.';

    if (!digits) errors.number = 'Enter your card number.';
    else if (brand === 'unknown') errors.number = 'We accept Visa, Mastercard, Verve and Amex cards.';
    else if (spec.lengths.indexOf(digits.length) === -1) errors.number = 'Card number is the wrong length.';
    else if (!luhn(digits)) errors.number = 'That card number does not look right. Check the digits.';

    if (!draft.expMonth || !draft.expYear || !(m >= 1 && m <= 12) || !(y >= 2000)) errors.expiry = 'Choose the expiry month and year.';
    else if (isExpired(m, y, now)) errors.expiry = 'This card has expired.';

    if (!cvv) errors.cvv = 'Enter the security code.';
    else if (!/^\d+$/.test(cvv) || cvv.length !== spec.cvvLength) {
      errors.cvv = 'CVV must be ' + (brand === 'unknown' ? '3 or 4' : spec.cvvLength) + ' digits.';
    }

    return { ok: Object.keys(errors).length === 0, errors: errors, brand: brand };
  }

  /* ---- records -------------------------------------------------------- */
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  function genId(prefix) {
    return (prefix || 'CRD') + '-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.floor(10 + Math.random() * 90);
  }

  /* Builds the ONLY shape the app stores or sends on: last 4 digits, never the
     full number, never the CVV. Call validateCard() first. */
  function toSafeRecord(draft, meta) {
    var digits = onlyDigits(draft.number);
    var brandId = detectBrand(digits);
    var m = +draft.expMonth, y = +draft.expYear;
    meta = meta || {};
    return {
      id: meta.id || genId('CRD'),
      holder: normalizeName(draft.holder),
      brandId: brandId,
      brand: BRANDS[brandId].label,
      last4: digits.slice(-4),
      expMonth: m,
      expYear: y,
      exp: pad2(m) + '/' + pad2(y % 100),
      status: meta.status || 'Pending',
      createdAt: meta.createdAt || new Date().toISOString()
    };
  }

  /* Status shown to people: blocked wins, then expiry, otherwise what is on record. */
  function effectiveStatus(rec, now) {
    if (rec.status === 'Blocked') return 'Blocked';
    if (isExpired(rec.expMonth, rec.expYear, now)) return 'Expired';
    return rec.status === 'Active' ? 'Active' : 'Pending';
  }

  /* ---- date / time display ------------------------------------------- */
  function formatDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function formatTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  /* Expiry year choices for the select: this year and the next 12. */
  function expiryYears(now) {
    var y = (now || new Date()).getFullYear(), out = [], i;
    for (i = 0; i <= 12; i++) out.push(y + i);
    return out;
  }

  root.MBCards = root.MBCards || {};
  root.MBCards.utils = {
    BRANDS: BRANDS, STATUSES: STATUSES,
    onlyDigits: onlyDigits, detectBrand: detectBrand, normalizeBrand: normalizeBrand, brandLabel: brandLabel,
    maxDigits: maxDigits, formatNumber: formatNumber, maskNumber: maskNumber, previewGroups: previewGroups,
    luhn: luhn, isExpired: isExpired, normalizeName: normalizeName, validateCard: validateCard,
    genId: genId, pad2: pad2, toSafeRecord: toSafeRecord, effectiveStatus: effectiveStatus,
    formatDate: formatDate, formatTime: formatTime, expiryYears: expiryYears
  };
})(typeof window !== 'undefined' ? window : globalThis);

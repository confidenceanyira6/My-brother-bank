/* ==========================================================================
   MyBank — card data service (frontend only)

   The UI never touches storage or the network directly. It calls
   MBCards.service, which delegates to a "provider". Today the provider is a
   local mock (browser storage + seeded sample records). When the backend
   exists, write a provider with the same methods and call
   MBCards.service.setProvider(myBackendProvider). No UI code has to change.

   Provider contract (every method returns a Promise):
     listForCustomer(email)        -> CardRecord[]    cards of one customer
     listAll()                     -> CardRecord[]    every card (admin)
     add(email, safeRecord)        -> CardRecord
     remove(email, id)             -> void
     setStatus(email, id, status)  -> CardRecord      status: Pending|Active|Blocked

   CardRecord = {
     id, email, customer, holder,
     brandId ('visa'|'mastercard'|'verve'|'amex'|'unknown'), brand (label),
     last4, expMonth, expYear, exp ('MM/YY'),
     status ('Pending'|'Active'|'Blocked'), createdAt (ISO 8601), source
   }

   There is intentionally no field for a full card number or a CVV.
   ========================================================================== */
(function (root) {
  'use strict';
  var U = root.MBCards.utils;

  var KEY = 'mb_cards:';          /* + customer email; same key the rest of the app already uses */
  var SEED_KEY = 'mb_cards_seed'; /* status changes an admin makes to the sample records */
  var SETTABLE = ['Pending', 'Active', 'Blocked'];

  /* ---- storage helpers (never throw) ---------------------------------- */
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function readJSON(k, d) {
    var s = ls(); if (!s) return d;
    try { var v = JSON.parse(s.getItem(k)); return v == null ? d : v; } catch (e) { return d; }
  }
  function writeJSON(k, v) { var s = ls(); if (s) { try { s.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full / blocked */ } } }

  function hash(str) {
    var h = 5381, i;
    for (i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36).toUpperCase();
  }

  /* Turns anything stored (including cards saved by the earlier version of the
     app, which had no id / status / createdAt) into a complete CardRecord. */
  function normalize(raw, email) {
    if (!raw) return null;
    var exp = String(raw.exp || ''), m = +raw.expMonth, y = +raw.expYear;
    var parts = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(exp);
    if (parts) { m = +parts[1]; y = +parts[2]; if (y < 100) y += 2000; }
    var brandId = U.normalizeBrand(raw.brandId || raw.brand);
    var last4 = U.onlyDigits(raw.last4).slice(-4);
    var created = raw.createdAt || '';
    if (!created && raw.added && !isNaN(new Date(raw.added))) created = new Date(raw.added).toISOString();
    return {
      id: raw.id || 'CRD-L' + hash(String(email) + '|' + last4 + '|' + exp),
      email: email || raw.email || '',
      customer: raw.customer || '',
      holder: U.normalizeName(raw.holder),
      brandId: brandId,
      brand: U.brandLabel(brandId),
      last4: last4,
      expMonth: m || 0,
      expYear: y || 0,
      exp: m && y ? U.pad2(m) + '/' + U.pad2(y % 100) : '',
      status: SETTABLE.indexOf(raw.status) !== -1 ? raw.status : 'Active', /* older cards pre-date review, so they count as Active */
      createdAt: created,
      source: raw.source || 'customer'
    };
  }

  /* ---- mock data (admin page) ----------------------------------------- */
  /* Sample records only. Brands and last 4 digits are made up. */
  var SEED = [
    { id: 'CRD-1008', email: 'confidenceanyira6@gmail.com', customer: 'Confidence Anyira', holder: 'Confidence Anyira', brandId: 'mastercard', last4: '7316', exp: '08/28', status: 'Pending', createdAt: '2026-11-02T22:47:00' },
    { id: 'CRD-1007', email: 'david@domain.com', customer: 'David Brown', holder: 'David Brown', brandId: 'visa', last4: '2290', exp: '01/30', status: 'Pending', createdAt: '2026-11-02T10:31:00' },
    { id: 'CRD-1006', email: 'john@domain.com', customer: 'John Doe', holder: 'John Doe', brandId: 'verve', last4: '6402', exp: '04/29', status: 'Active', createdAt: '2026-10-30T11:09:00' },
    { id: 'CRD-1005', email: 'jane@domain.com', customer: 'Jane Smith', holder: 'Jane Smith', brandId: 'mastercard', last4: '9034', exp: '09/27', status: 'Active', createdAt: '2026-10-27T13:05:00' },
    { id: 'CRD-1004', email: 'john@domain.com', customer: 'John Doe', holder: 'John Doe', brandId: 'visa', last4: '4821', exp: '12/28', status: 'Active', createdAt: '2026-10-26T08:42:00' },
    { id: 'CRD-1003', email: 'sarah@domain.com', customer: 'Sarah Wilson', holder: 'Sarah Wilson', brandId: 'amex', last4: '1005', exp: '02/29', status: 'Active', createdAt: '2026-10-24T15:18:00' },
    { id: 'CRD-1002', email: 'mike@domain.com', customer: 'Mike Johnson', holder: 'Mike Johnson', brandId: 'visa', last4: '1177', exp: '03/29', status: 'Blocked', createdAt: '2026-10-21T16:20:00' },
    { id: 'CRD-1001', email: 'jane@domain.com', customer: 'Jane Smith', holder: 'Jane Smith', brandId: 'visa', last4: '0058', exp: '06/26', status: 'Active', createdAt: '2026-09-14T09:55:00' }
  ];
  function seedRecords() {
    var overrides = readJSON(SEED_KEY, {});
    return SEED.map(function (s) {
      var r = normalize(s, s.email);
      r.source = 'mock';
      if (overrides[r.id] && SETTABLE.indexOf(overrides[r.id]) !== -1) r.status = overrides[r.id];
      return r;
    });
  }

  /* ---- local mock provider -------------------------------------------- */
  function readRaw(email) { var v = readJSON(KEY + email, []); return Array.isArray(v) ? v : []; }

  var LocalProvider = {
    name: 'local-mock',

    listForCustomer: function (email) {
      return Promise.resolve(readRaw(email).map(function (r) { return normalize(r, email); }).filter(Boolean));
    },

    listAll: function () {
      var out = seedRecords(), s = ls(), i, k;
      if (s) {
        for (i = 0; i < s.length; i++) {
          k = s.key(i);
          if (k && k.indexOf(KEY) === 0) {
            var email = k.slice(KEY.length);
            readRaw(email).forEach(function (r) { var n = normalize(r, email); if (n) out.push(n); });
          }
        }
      }
      out.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      return Promise.resolve(out);
    },

    add: function (email, rec) {
      var cs = readRaw(email);
      var dup = cs.some(function (c) {
        var n = normalize(c, email);
        return n.last4 === rec.last4 && n.exp === rec.exp && n.brandId === rec.brandId;
      });
      if (dup) return Promise.reject(new Error('This card is already added.'));
      /* Only ever the safe record: last 4 digits, brand, expiry, status, timestamps. */
      cs.push({ id: rec.id, holder: rec.holder, brandId: rec.brandId, brand: rec.brand, last4: rec.last4, expMonth: rec.expMonth, expYear: rec.expYear, exp: rec.exp, status: rec.status, createdAt: rec.createdAt });
      writeJSON(KEY + email, cs);
      return Promise.resolve(normalize(rec, email));
    },

    remove: function (email, id) {
      var cs = readRaw(email), kept = cs.filter(function (c) { return normalize(c, email).id !== id; });
      writeJSON(KEY + email, kept);
      return Promise.resolve();
    },

    setStatus: function (email, id, status) {
      if (SETTABLE.indexOf(status) === -1) return Promise.reject(new Error('Unknown status.'));
      var seed = SEED.filter(function (s) { return s.id === id; })[0];
      if (seed) {
        var o = readJSON(SEED_KEY, {}); o[id] = status; writeJSON(SEED_KEY, o);
        var r = normalize(seed, seed.email); r.source = 'mock'; r.status = status;
        return Promise.resolve(r);
      }
      var cs = readRaw(email), hit = null;
      cs.forEach(function (c) { if (normalize(c, email).id === id) { c.id = id; c.status = status; hit = c; } });
      if (!hit) return Promise.reject(new Error('Card not found.'));
      writeJSON(KEY + email, cs);
      return Promise.resolve(normalize(hit, email));
    }
  };

  /* ---- facade used by the UI ------------------------------------------ */
  var provider = LocalProvider;

  var service = {
    setProvider: function (p) { provider = p || LocalProvider; },
    getProvider: function () { return provider; },
    listMine: function (email) { return provider.listForCustomer(email); },
    listAll: function () { return provider.listAll(); },

    /* draft = raw form values { holder, number, expMonth, expYear, cvv }.
       Validated here, then reduced to a safe record. The provider never sees
       the full number or the CVV. */
    add: function (email, draft) {
      var v = U.validateCard(draft);
      if (!v.ok) {
        var err = new Error('Please check the card details.');
        err.fieldErrors = v.errors;
        return Promise.reject(err);
      }
      return provider.add(email, U.toSafeRecord(draft));
    },
    remove: function (email, id) { return provider.remove(email, id); },
    setStatus: function (email, id, status) { return provider.setStatus(email, id, status); }
  };

  /* ---- mapping to the planned database table ---------------------------
     Planned columns: id, card_number, cvv, date, time.
     - card_number: only a MASKED value is ever produced here (last 4 digits).
     - cvv: never produced and never read. It must not be stored anywhere.
     - date / time: split from createdAt (UTC).
     The admin page also needs holder name, brand, expiry, status and the
     customer's email. The planned table has no columns for those, so fromRow()
     reads them if the backend supplies them under the names used below. */
  var RowMapper = {
    toRow: function (rec) {
      var iso = new Date(rec.createdAt || Date.now()).toISOString();
      return {
        id: rec.id,
        card_number: '**** **** **** ' + rec.last4,
        date: iso.slice(0, 10),
        time: iso.slice(11, 19)
      };
    },
    fromRow: function (row) {
      row = row || {};
      var digits = U.onlyDigits(row.card_number);
      var brandId = row.brand ? U.normalizeBrand(row.brand) : (digits.length >= 13 ? U.detectBrand(digits) : 'unknown');
      var createdAt = row.created_at || (row.date ? row.date + 'T' + (row.time || '00:00:00') + 'Z' : '');
      /* Even if a row ever carries a full number, only the last 4 digits are kept. row.cvv is never read. */
      return normalize({
        id: row.id,
        holder: row.cardholder_name || row.holder_name || '',
        brandId: brandId,
        last4: digits.slice(-4),
        expMonth: row.exp_month,
        expYear: row.exp_year,
        status: row.status,
        createdAt: createdAt,
        customer: row.customer_name || '',
        source: 'backend'
      }, row.customer_email || '');
    }
  };

  root.MBCards.service = service;
  root.MBCards.LocalProvider = LocalProvider;
  root.MBCards.RowMapper = RowMapper;
  root.MBCards._normalize = normalize;
})(typeof window !== 'undefined' ? window : globalThis);

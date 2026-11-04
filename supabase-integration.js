(function () {
  const SUPABASE_URL = "https://ctfdaedtperwmpfofkmt.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1HTNf6siezvXmuqLbtqi-A_M7sKXLVS";
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let ready = false;
  let currentUser = null;
  let currentProfile = null;
  let currentAccount = null;
  let profiles = [];
  let accounts = [];
  let ledger = [];
  let identities = [];
  let deposits = [];
  let investments = [];
  let plans = [];
  let withdrawals = [];
  const baseRender = window.render;

  // Discard the old browser-only demo login. Authentication now comes from Supabase Auth.
  sess = null;
  localStorage.removeItem("mb_sess");

  function message(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || "";
    else if (text) toast(text);
  }

  function last4(value) {
    return String(value || "").replace(/\s/g, "").slice(-4);
  }

  function statusLabel(profile, identity) {
    const s = (identity && identity.verification_status) || profile.enrollment_status || "pending";
    if (s === "verified" || s === "approved") return "Verified";
    if (s === "rejected") return "Rejected";
    return "Pending";
  }

  async function operation(action, payload) {
    const result = await sb.functions.invoke("bank-operations", { body: { action: action, payload: payload || {} } });
    if (result.error) throw result.error;
    if (result.data && result.data.error) throw new Error(result.data.error);
    return result.data && result.data.data;
  }

  async function completeEnrollment(user, p) {
    if (!p) throw new Error("Enrollment details were not found on this device. Please contact support.");
    await operation("submit_enrollment", {
      p_full_name: p.full_name,
      p_phone: p.phone,
      p_date_of_birth: p.date_of_birth,
      p_gender: p.gender,
      p_city: p.city,
      p_address_line: p.address_line,
      p_postal_code: p.postal_code,
      p_occupation: p.occupation,
      p_next_of_kin_name: p.next_of_kin_name,
      p_next_of_kin_phone: p.next_of_kin_phone,
      p_next_of_kin_email: p.next_of_kin_email,
      p_nin_last4: p.nin_last4,
      p_bvn_last4: p.bvn_last4
    });
    const { error: profileError } = await sb.from("profiles").update({
      country: p.country,
      occupation: p.occupation
    }).eq("id", user.id);
    if (profileError) throw profileError;

    const { error: identityError } = await sb.rpc("store_sensitive_details", {
      p_nin_input: p.nin_last4,
      p_bvn_input: p.bvn_last4,
      p_id_input: p.id_last4,
      p_card_demo_input: null
    });
    if (identityError) throw identityError;

    localStorage.setItem("mb_currency:" + user.id, p.currency || "USD");
    localStorage.removeItem("mb_pending_enrollment:" + user.email.toLowerCase());
  }

  async function fetchRows(table, userId, isAdmin) {
    let query = sb.from(table).select("*").limit(1000);
    if (!isAdmin && userId) {
      const ownerColumn = table === "profiles" ? "id" : table === "identity_checks" ? "user_id" : "user_id";
      query = query.eq(ownerColumn, userId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  function toWallet(profile, account, entries) {
    const tx = (entries || []).filter(x => !account || x.account_id === account.id).map(x => ({
      n: x.description || String(x.entry_type || "Transaction").replace(/_/g, " "),
      d: x.created_at,
      a: (x.direction === "debit" ? -1 : 1) * Number(x.amount || 0),
      i: x.entry_type === "deposit" ? "deposit" : x.entry_type === "withdrawal" ? "withdraw" : x.entry_type.indexOf("transfer") === 0 ? "send" : "swap",
      s: x.status === "pending" ? "Pending" : undefined
    }));
    return { balance: account ? Number(account.balance || 0) : 0, tx: tx };
  }

  async function loadBackendData(user, profile) {
    currentUser = user;
    currentProfile = profile;
    const isAdmin = profile.role === "admin" || profile.role === "staff";
    const results = await Promise.all([
      fetchRows("profiles", user.id, isAdmin),
      fetchRows("accounts", user.id, isAdmin),
      fetchRows("ledger_entries", user.id, isAdmin),
      fetchRows("identity_checks", user.id, isAdmin),
      fetchRows("withdrawal_requests", user.id, isAdmin),
      fetchRows("investment_plans", user.id, isAdmin),
      fetchRows("investments", user.id, isAdmin),
      isAdmin ? fetchRows("deposit_requests", user.id, true) : Promise.resolve([])
    ]);
    profiles = results[0];
    accounts = results[1];
    ledger = results[2];
    identities = results[3];
    withdrawals = results[4];
    plans = results[5];
    investments = results[6];
    deposits = results[7];

    const emailById = {};
    profiles.forEach(p => { emailById[p.id] = p.email || ""; });

    users = profiles.map(p => ({
      n: p.full_name || "Customer",
      e: p.email || "",
      s: "Active",
      user_id: p.id,
      role: p.role
    }));

    reg = profiles.map(p => {
      const ident = identities.find(x => x.user_id === p.id) || {};
      const cur = localStorage.getItem("mb_currency:" + p.id) || (p.country === "Nigeria" ? "NGN" : "USD");
      return {
        name: p.full_name || "",
        email: p.email || "",
        phone: p.phone || "",
        dob: p.date_of_birth || "",
        gender: p.gender || "",
        taxLast4: ident.nin_last4 || "",
        bvnLast4: ident.bvn_last4 || "",
        idLast4: ident.id_last4 || "",
        cardLast4: ident.card_last4 || "",
        occupation: p.occupation || "",
        country: p.country || "",
        city: p.city || "",
        zip: p.postal_code || "",
        address: p.address_line || "",
        nok: { name: p.next_of_kin_name || "", email: p.next_of_kin_email || "", phone: p.next_of_kin_phone || "", relationship: "", address: "" },
        currency: cur,
        docType: "Identity document",
        photoName: "",
        docName: ""
      };
    });

    kyc = identities.map(x => {
      const p = profiles.find(z => z.id === x.user_id) || {};
      return {
        id: x.id,
        user_id: x.user_id,
        e: p.email || "",
        u: p.full_name || "Customer",
        t: "Identity documents",
        s: statusLabel(p, x),
        ninLast4: x.nin_last4 || "",
        bvnLast4: x.bvn_last4 || "",
        idLast4: x.id_last4 || "",
        cardLast4: x.card_last4 || ""
      };
    });

    wds = withdrawals.map(x => {
      const p = profiles.find(z => z.id === x.user_id) || {};
      return {
        id: x.id, user_id: x.user_id, e: p.email || "", u: p.full_name || "Customer",
        cur: x.currency, amt: Number(x.amount), bank: x.destination_label,
        acct: x.destination_reference_masked || "••••", holder: "", code: "",
        note: x.admin_note || "", date: x.created_at,
        s: x.status === "approved" ? "Completed" : x.status === "rejected" ? "Rejected" : "Pending"
      };
    });

    atx = ledger.map(x => ({
      id: x.id, u: profiles.find(p => p.id === x.user_id)?.full_name || "Customer",
      t: x.entry_type, a: (x.direction === "debit" ? -1 : 1) * Number(x.amount),
      s: x.status === "completed" ? "Completed" : x.status
    }));

    // Keep the existing screens' wallet interface, but refresh it from database balances and ledger rows.
    profiles.forEach(p => {
      const cur = localStorage.getItem("mb_currency:" + p.id) || (p.country === "Nigeria" ? "NGN" : "USD");
      const acct = accounts.find(a => a.user_id === p.id && a.currency === cur) || accounts.find(a => a.user_id === p.id);
      saveWalletOf(p.email || "", toWallet(p, acct, ledger));
    });

    const preferredCurrency = localStorage.getItem("mb_currency:" + user.id) || (profile.country === "Nigeria" ? "NGN" : "USD");
    currentAccount = accounts.find(a => a.user_id === user.id && a.currency === preferredCurrency) || accounts.find(a => a.user_id === user.id) || null;
    if (currentAccount) localStorage.setItem("mb_currency:" + user.id, currentAccount.currency);
    sess = {
      role: isAdmin ? "admin" : "user",
      name: profile.full_name || user.email,
      email: user.email,
      currency: currentAccount ? currentAccount.currency : preferredCurrency,
      user_id: user.id
    };
    wallet = toWallet(profile, currentAccount, ledger);
    save("mb_sess", sess);
    loans = [];
    ready = true;
  }

  async function getProfile(user) {
    const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) throw error;
    return data;
  }

  window.doLogin = async function (e) {
    e.preventDefault();
    const email = document.getElementById("lg_e").value.trim().toLowerCase();
    const password = document.getElementById("lg_p").value;
    message("lg_err", "");
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: email, password: password });
      if (error) throw error;
      let profile = await getProfile(data.user);
      if (!profile) {
        const pending = localStorage.getItem("mb_pending_enrollment:" + email);
        if (!pending) throw new Error("Your account has no completed enrollment record yet.");
        await completeEnrollment(data.user, JSON.parse(pending));
        profile = await getProfile(data.user);
      }
      if (!profile) throw new Error("Enrollment could not be loaded. Please try again.");
      await loadBackendData(data.user, profile);
      go(profile.role === "admin" || profile.role === "staff" ? "#/admin/dashboard" : "#/home");
    } catch (err) {
      message("lg_err", err.message || "Unable to sign in.");
    }
    return false;
  };

  window.doSignup = async function (e) {
    e.preventDefault();
    const v = id => (document.getElementById(id)?.value || "").trim();
    const err = text => { message("su_err", text); return false; };
    const email = v("su_e").toLowerCase();
    const password = document.getElementById("su_pw").value;
    if (!email || !password) return err("Enter your email and password.");
    if (password.length < 8) return err("Password must be at least 8 characters.");
    if (password !== document.getElementById("su_pw2").value) return err("Passwords do not match.");
    const nin = v("su_nin"), bvn = v("su_bvn"), idNumber = v("su_id");
    if (!nin || !bvn || !idNumber) return err("Enter your NIN, BVN and ID number.");
    if (!v("su_country")) return err("Select your country.");
    const cityValue = v("su_city");
    const city = cityValue === "__o" ? v("su_city_o") : cityValue;
    if (!city) return err("Select or enter your city.");
    if (typeof checkFile === "function") {
      const photoError = checkFile(document.getElementById("su_photo"));
      const docError = checkFile(document.getElementById("su_doc"));
      if (photoError || docError) return err(photoError || docError);
    }
    const genderMap = { "Male": "male", "Female": "female", "Other": "other", "Prefer not to say": "prefer_not_to_say" };
    const pending = {
      full_name: v("su_n"), phone: v("su_p"), date_of_birth: v("su_dob"),
      gender: genderMap[v("su_g")] || "prefer_not_to_say",
      city: city, address_line: v("su_addr"), postal_code: v("su_zip"),
      occupation: v("su_occ"), country: v("su_country"),
      next_of_kin_name: v("nk_n"), next_of_kin_phone: v("nk_p"), next_of_kin_email: v("nk_e"),
      nin_last4: last4(nin), bvn_last4: last4(bvn), id_last4: last4(idNumber),
      currency: v("su_cur") || "USD"
    };
    try {
      const { data, error } = await sb.auth.signUp({
        email: email,
        password: password,
        options: { data: { full_name: pending.full_name } }
      });
      if (error) throw error;
      localStorage.setItem("mb_pending_enrollment:" + email, JSON.stringify(pending));
      if (data.session && data.user) {
        await completeEnrollment(data.user, pending);
        await sb.auth.signOut();
        toast("Enrollment saved. You can now log in.");
      } else {
        toast("Account created. Confirm your email, then log in to finish enrollment.");
      }
      go("#/login");
    } catch (err) {
      err("Enrollment failed: " + (err.message || "Please try again."));
    }
    return false;
  };

  window.logout = async function () {
    await sb.auth.signOut();
    currentUser = null; currentProfile = null; currentAccount = null; ready = true;
    sess = null; wallet = null; save("mb_sess", null);
    go("#/login");
  };

  window.resetBankPassword = async function () {
    const email = (document.getElementById("lg_e")?.value || "").trim();
    if (!email) { message("lg_err", "Enter your email first, then choose Forgot Password."); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    message("lg_err", error ? error.message : "Password reset email sent if the account exists.");
  };

  window.amountAction = async function () {
    const amount = Number(prompt("Deposit amount (" + sym().trim() + ")"));
    if (!(amount > 0)) return;
    try {
      await operation("demo_deposit_request", {
        p_amount: amount, p_currency: curCode(),
        p_payment_method: "bank_transfer", p_reference: "Demo deposit request"
      });
      await loadBackendData(currentUser, currentProfile);
      toast("Deposit request submitted. An administrator must approve it.");
      render();
    } catch (err) { toast(err.message || "Deposit request failed."); }
  };

  window.doSend = async function (e) {
    e.preventDefault();
    const recipient = document.getElementById("sm_r").value.trim();
    const amount = Number(document.getElementById("sm_a").value);
    if (!recipient || !(amount > 0)) { message("sm_err", "Enter a destination account number and valid amount."); return false; }
    try {
      await operation("demo_transfer", {
        p_to_account_number: recipient, p_amount: amount,
        p_currency: curCode(), p_note: document.getElementById("sm_n").value.trim()
      });
      await loadBackendData(currentUser, currentProfile);
      toast("Demo transfer completed.");
      go("#/home");
    } catch (err) { message("sm_err", err.message || "Transfer failed."); }
    return false;
  };

  window.doWithdraw = async function (e) {
    e.preventDefault();
    const err = text => { message("wd_err", text); return false; };
    if (kycOf() !== "Verified") return err("Your enrollment must be approved before requesting a withdrawal.");
    const amount = Number(document.getElementById("wd_a").value);
    const bank = document.getElementById("wd_b").value.trim();
    const account = document.getElementById("wd_n").value.replace(/\s/g, "");
    if (!(amount > 0) || !bank || !account) return err("Enter a valid amount, bank and destination account.");
    try {
      await operation("demo_withdrawal_request", {
        p_amount: amount, p_currency: curCode(),
        p_destination_label: bank + (document.getElementById("wd_h").value.trim() ? " — " + document.getElementById("wd_h").value.trim() : ""),
        p_destination_masked: "••••" + last4(account)
      });
      await loadBackendData(currentUser, currentProfile);
      toast("Withdrawal request submitted for administrator review.");
      render();
    } catch (err2) { err(err2.message || "Withdrawal request failed."); }
    return false;
  };

  window.setKyc = async function (index, status) {
    const item = kyc[index];
    if (!item || !item.user_id) return;
    if (!confirm((status === "Verified" ? "Approve" : "Reject") + " this enrollment?")) return;
    try {
      await operation("admin_review_enrollment", {
        p_user_id: item.user_id, p_approve: status === "Verified",
        p_note: "Reviewed in MyBank admin dashboard"
      });
      await loadBackendData(currentUser, currentProfile);
      toast("Enrollment review saved.");
      render();
    } catch (err) { toast(err.message || "Enrollment review failed."); }
  };

  window.wdSet = async function (id, status) {
    if (!confirm((status === "Completed" ? "Approve" : "Reject") + " this withdrawal request?")) return;
    try {
      await operation("admin_review_withdrawal", {
        p_request_id: id, p_approve: status === "Completed",
        p_note: "Reviewed in MyBank admin dashboard"
      });
      await loadBackendData(currentUser, currentProfile);
      toast("Withdrawal review saved.");
      render();
    } catch (err) { toast(err.message || "Withdrawal review failed."); }
  };

  window.reviewDeposit = async function (id, approve) {
    if (!confirm((approve ? "Approve" : "Reject") + " this demo deposit?")) return;
    try {
      await operation("admin_review_deposit", {
        p_request_id: id, p_approve: approve,
        p_note: "Reviewed in MyBank admin dashboard"
      });
      await loadBackendData(currentUser, currentProfile);
      toast("Deposit review saved.");
      render();
    } catch (err) { toast(err.message || "Deposit review failed."); }
  };

  window.reviewInvestment = async function (id, approve) {
    if (!confirm((approve ? "Approve" : "Reject") + " this demo investment?")) return;
    try {
      await operation("admin_review_investment", {
        p_investment_id: id, p_approve: approve,
        p_note: "Reviewed in MyBank admin dashboard"
      });
      await loadBackendData(currentUser, currentProfile);
      toast("Investment review saved.");
      render();
    } catch (err) { toast(err.message || "Investment review failed."); }
  };

  window.doInvestment = async function (e) {
    e.preventDefault();
    const planId = document.getElementById("iv_plan").value;
    const amount = Number(document.getElementById("iv_amount").value);
    if (!planId || !(amount > 0)) { message("iv_err", "Choose a plan and enter a valid amount."); return false; }
    try {
      await operation("demo_create_investment", {
        p_plan_id: planId, p_amount: amount, p_currency: curCode()
      });
      await loadBackendData(currentUser, currentProfile);
      toast("Investment request submitted for review.");
      render();
    } catch (err) { message("iv_err", err.message || "Investment request failed."); }
    return false;
  };

  window.saveUser = async function (e, email) {
    e.preventDefault();
    const target = profiles.find(p => (p.email || "").toLowerCase() === String(email).toLowerCase());
    if (!target) { toast("Customer record not found."); return false; }
    const account = accounts.find(a => a.user_id === target.id && a.currency === (profile(email).currency || "USD")) ||
      accounts.find(a => a.user_id === target.id);
    if (!account) { toast("This customer has no approved account yet."); return false; }
    const desired = Number(document.getElementById("uf_bal").value);
    if (!(desired >= 0)) { toast("Enter a valid balance."); return false; }
    const delta = Math.round((desired - Number(account.balance)) * 100) / 100;
    if (!delta) { toast("No balance change to save."); return false; }
    const reason = "Admin dashboard balance adjustment";
    try {
      await operation("admin_adjust_demo_balance", {
        p_account_id: account.id, p_amount: Math.abs(delta),
        p_direction: delta > 0 ? "credit" : "debit", p_reason: reason
      });
      await loadBackendData(currentUser, currentProfile);
      toast("Demo balance adjustment saved. Other profile edits are not supported by the current backend.");
      render();
    } catch (err) { message("uf_err", err.message || "Balance adjustment failed."); }
    return false;
  };

  window.addUser = function () { toast("Create customer accounts through the customer sign-up form."); };
  window.toggleUser = function () { toast("Account suspension is not available in the current backend."); };
  window.doLoan = function (e) { e.preventDefault(); message("ln_err", "Loan requests are not included in the connected Supabase backend yet."); return false; };
  window.loanSet = function () { toast("Loan approvals are not available in the connected backend yet."); };
  window.doCare = function (e) { e.preventDefault(); message("cc_err", "Customer support messaging is not connected to the backend yet."); return false; };
  window.replyCare = function () { toast("Customer support messaging is not connected to the backend yet."); };
  window.sendNote = function (e) { e.preventDefault(); toast("Notifications are not connected to the backend yet."); return false; };

  R["admin/dashboard"] = function () {
    const pendingWithdrawals = withdrawals.filter(x => x.status === "pending").length;
    const pendingDeposits = deposits.filter(x => x.status === "pending").length;
    const pendingKyc = identities.filter(x => x.verification_status !== "verified" && x.verification_status !== "rejected").length;
    const pendingInvestments = investments.filter(x => x.status === "pending").length;
    return ashell("dashboard", "Dashboard",
      '<div class="stats">' +
      '<div class="stat"><span class="ico">' + I("users", 20) + '</span><div><span class="sub">Customers</span><b>' + profiles.filter(p => p.role === "customer").length + '</b></div></div>' +
      '<div class="stat"><span class="ico">' + I("swap", 20) + '</span><div><span class="sub">Ledger entries</span><b>' + ledger.length + '</b></div></div>' +
      '<div class="stat" onclick="go(\'#/admin/withdrawals\')" style="cursor:pointer"><span class="ico">' + I("withdraw", 20) + '</span><div><span class="sub">Pending withdrawals</span><b>' + pendingWithdrawals + '</b></div></div>' +
      '<div class="stat" onclick="go(\'#/admin/deposits\')" style="cursor:pointer"><span class="ico">' + I("deposit", 20) + '</span><div><span class="sub">Pending deposits</span><b>' + pendingDeposits + '</b></div></div>' +
      '<div class="stat" onclick="go(\'#/admin/kyc\')" style="cursor:pointer"><span class="ico">' + I("id", 20) + '</span><div><span class="sub">Pending enrollments</span><b>' + pendingKyc + '</b></div></div>' +
      '<div class="stat" onclick="go(\'#/admin/investments\')" style="cursor:pointer"><span class="ico">' + I("chart", 20) + '</span><div><span class="sub">Pending investments</span><b>' + pendingInvestments + '</b></div></div>' +
      '</div><div class="panel"><b>Backend connection active</b><p class="sub" style="margin-top:6px">Customer records, accounts, balances, ledger entries, deposits, withdrawals, enrollments and investments are loaded from Supabase.</p></div>');
  };

  R["admin/deposits"] = function () {
    return ashell("deposits", "Deposit Requests",
      '<div class="panel"><div class="tblwrap"><table class="tbl"><tr><th>Customer</th><th>Amount</th><th>Method</th><th>Reference</th><th>Date</th><th>Status</th><th>Action</th></tr>' +
      (deposits.length ? deposits.slice().reverse().map(x => {
        const p = profiles.find(z => z.id === x.user_id) || {};
        return '<tr><td>' + esc(p.full_name || "Customer") + '<br><span class="sub">' + esc(p.email || "") + '</span></td><td><b>' + fmt(x.amount, x.currency) + '</b></td><td>' + esc(x.payment_method) + '</td><td>' + esc(x.reference || "—") + '</td><td>' + esc(x.created_at) + '</td><td>' + pill(x.status === "approved" ? "Completed" : x.status === "rejected" ? "Rejected" : "Pending") + '</td><td>' + (x.status === "pending" ? '<button class="mini" onclick="reviewDeposit(\'' + x.id + '\',true)">Approve</button><button class="mini" onclick="reviewDeposit(\'' + x.id + '\',false)">Reject</button>' : "—") + '</td></tr>';
      }).join("") : '<tr><td colspan="7" class="sub">No deposit requests yet.</td></tr>') +
      '</table></div></div>');
  };

  R["admin/investments"] = function () {
    return ashell("investments", "Investment Requests",
      '<div class="panel"><div class="tblwrap"><table class="tbl"><tr><th>Customer</th><th>Principal</th><th>Plan</th><th>Projected return</th><th>Status</th><th>Action</th></tr>' +
      (investments.length ? investments.slice().reverse().map(x => {
        const p = profiles.find(z => z.id === x.user_id) || {};
        const plan = plans.find(z => z.id === x.plan_id) || {};
        return '<tr><td>' + esc(p.full_name || "Customer") + '<br><span class="sub">' + esc(p.email || "") + '</span></td><td>' + fmt(x.principal, x.currency) + '</td><td>' + esc(plan.name || "Investment plan") + '</td><td>' + fmt(x.projected_return, x.currency) + '</td><td>' + pill(x.status) + '</td><td>' + (x.status === "pending" ? '<button class="mini" onclick="reviewInvestment(\'' + x.id + '\',true)">Approve</button><button class="mini" onclick="reviewInvestment(\'' + x.id + '\',false)">Reject</button>' : "—") + '</td></tr>';
      }).join("") : '<tr><td colspan="6" class="sub">No investment requests yet.</td></tr>') +
      '</table></div></div>');
  };

  R["investments"] = function () {
    const mine = investments.filter(x => x.user_id === currentUser.id);
    const available = plans.filter(x => x.active && x.currency === curCode());
    return shell('<div class="screen">' + back("Investments", "#/home") +
      '<div class="card"><b>Available demo plans</b><p class="sub" style="margin-top:5px">Requests are reviewed by an administrator. Returns shown are illustrative only.</p></div>' +
      '<form onsubmit="return doInvestment(event)"><label class="l">Investment plan</label><select class="field" id="iv_plan" required><option value="">Choose a plan</option>' +
      available.map(x => '<option value="' + x.id + '">' + esc(x.name) + ' — minimum ' + fmt(x.minimum_amount, x.currency) + ' — ' + Number(x.projected_return_pct) + '% projected</option>').join("") +
      '</select><label class="l">Amount</label><input class="field" id="iv_amount" type="number" min="1" step="0.01" required><div id="iv_err" class="err"></div><button class="btn">Submit investment request</button></form>' +
      '<div class="mini2">Your investment requests</div>' +
      (mine.length ? mine.slice().reverse().map(x => '<div class="row"><div class="grow"><b>' + fmt(x.principal, x.currency) + '</b><small>' + esc(x.status) + ' · projected ' + fmt(x.projected_return, x.currency) + '</small></div>' + pill(x.status) + '</div>').join("") : '<div class="empty">No investment requests yet.</div>') +
      '</div>' + pnav("home"));
  };

  R["admin/loans"] = function () {
    return ashell("loans", "Loan Requests", '<div class="panel"><p class="sub">Loan requests are not part of the current Supabase schema or bank-operations API, so this page is not connected yet.</p></div>');
  };
  R["admin/support"] = function () {
    return ashell("support", "Customer Support", '<div class="panel"><p class="sub">Customer support messaging is not part of the current Supabase schema, so this page is not connected yet.</p></div>');
  };

  window.render = function (keepFocus) {
    if (!ready && !["splash", "welcome", "signup", "login"].includes((location.hash || "#/splash").slice(2))) {
      app.innerHTML = '<div class="stage"><div class="phone"><div class="screen center" style="justify-content:center">Connecting to MyBank…</div></div></div>';
      return;
    }
    baseRender(keepFocus);
    if (sess && sess.role === "user" && currentAccount) {
      const bal = document.querySelector(".bal");
      if (bal && !document.getElementById("sb-account-number")) {
        bal.insertAdjacentHTML("beforeend", '<span id="sb-account-number" class="acct" style="display:inline-block;margin-top:8px">Account No: ' + esc(currentAccount.account_number) + '</span>');
      }
      const qa = document.querySelector(".qa");
      if (qa && !document.getElementById("sb-investment-quick")) {
        qa.insertAdjacentHTML("beforeend", '<button id="sb-investment-quick" onclick="go(\'#/investments\')"><span class="c n">' + I("chart", 19) + '</span>Invest</button>');
      }
    }
    if (sess && sess.role === "admin") {
      const side = document.querySelector(".side");
      if (side && !document.getElementById("sb-deposits-link")) {
        side.insertAdjacentHTML("beforeend", '<button id="sb-deposits-link" onclick="go(\'#/admin/deposits\')">' + I("deposit", 18) + 'Deposit Requests</button><button id="sb-investments-link" onclick="go(\'#/admin/investments\')">' + I("chart", 18) + 'Investments</button>');
      }
    }
  };

  async function initialise() {
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (data.session && data.session.user) {
        let profile = await getProfile(data.session.user);
        if (!profile) {
          const pending = localStorage.getItem("mb_pending_enrollment:" + data.session.user.email.toLowerCase());
          if (pending) {
            await completeEnrollment(data.session.user, JSON.parse(pending));
            profile = await getProfile(data.session.user);
          }
        }
        if (profile) await loadBackendData(data.session.user, profile);
        else { await sb.auth.signOut(); ready = true; }
      } else {
        ready = true;
      }
    } catch (err) {
      console.error("MyBank backend initialisation:", err);
      ready = true;
      toast("Backend connection issue: " + (err.message || "Please log in again."));
    }
    render();
  }

  window.myBankSupabase = sb;
  initialise();
})();
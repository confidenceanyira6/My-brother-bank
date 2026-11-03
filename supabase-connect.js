/* ============ SUPABASE BACKEND CONNECTION (existing "bank broker" project) ============
   Replaces the temporary local demo data/logins with the real backend.
   Uses only the public publishable key; all access rules are enforced by the backend (RLS + RPCs). */
(function(){
if(!window.supabase){console.error('Supabase library failed to load - running in local demo mode.');return}
const sb=window.supabase.createClient('https://ctfdaedtperwmpfofkmt.supabase.co','sb_publishable_1HTNf6siezvXmuqLbtqi-A_M7sKXLVS');

/* the old hard-coded demo credentials must no longer work */
DEMO.admin.password=null;DEMO.customer.password=null;DEMO.customer.pin='';

const KS={approved:'Verified',pending:'Pending',rejected:'Rejected',not_started:'Pending'};
const WSM={pending:'Pending',approved:'Completed',rejected:'Rejected'};
const LED_ICON={deposit:'deposit',withdrawal:'withdraw',transfer_in:'deposit',transfer_out:'send',admin_adjustment:'swap',investment_debit:'chart',investment_return:'chart'};
const LED_LBL={deposit:'Deposit',withdrawal:'Withdrawal',transfer_in:'Money Received',transfer_out:'Money Sent',admin_adjustment:'Balance adjustment',investment_debit:'Investment',investment_return:'Investment return'};
const GEN_IN={'Male':'male','Female':'female','Other':'other','Prefer not to say':'prefer_not_to_say'};
const GEN_OUT={male:'Male',female:'Female',other:'Other',prefer_not_to_say:'Prefer not to say'};
const ACCT={}; /* email -> {id, number, currency} */
const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
const fdate=iso=>new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const rows=async q=>{const {data,error}=await q;if(error)throw new Error(error.message);return data||[]};

async function bankOp(action,payload){
  const {data,error}=await sb.functions.invoke('bank-operations',{body:{action,payload}});
  if(error){let m=error.message;try{const j=await error.context.json();if(j&&j.error)m=j.error}catch(_){}throw new Error(m)}
  if(data&&data.error)throw new Error(data.error);
  return data&&data.data}

function clearLocal(){
  Object.keys(localStorage).filter(k=>k==='mb_sess'||k==='mb_users'||k==='mb_kyc'||k==='mb_wd'||k.indexOf('mb_wallet:')===0).forEach(k=>localStorage.removeItem(k));
  users=[];kyc=[];wds=[];atx=[]}

function upsertReg(p,cur){
  const em=String(p.email||'');
  let r=reg.find(x=>x.email&&x.email.toLowerCase()===em.toLowerCase());
  if(!r){r=stub(em);r.pin='';reg.push(r)}
  Object.assign(r,{name:p.full_name||r.name,email:em,phone:p.phone||'',pw:'',dob:p.date_of_birth||'',gender:GEN_OUT[p.gender]||'',occupation:p.occupation||'',city:p.city||'',zip:p.postal_code||'',address:p.address_line||'',currency:cur||r.currency||'USD'});
  if(p.country)r.country=p.country;
  if(p.nin_last4)r.taxLast4=p.nin_last4;
  r.nok={name:p.next_of_kin_name||'',email:p.next_of_kin_email||'',phone:p.next_of_kin_phone||'',relationship:(r.nok&&r.nok.relationship)||'',address:(r.nok&&r.nok.address)||''};
  return r}

function mapWd(w,email,name){
  const parts=String(w.destination_label||'').split(' — ');
  return {id:w.id,e:email,u:name,cur:w.currency,amt:Number(w.amount),bank:parts[0]||'',acct:w.destination_reference_masked||'',holder:parts[1]||'',code:'',note:w.admin_note||'',date:fdate(w.created_at),s:WSM[w.status]||'Pending'}}

/* ---------- load a customer's data from the backend ---------- */
async function loadMe(session){
  const uid=session.user.id,email=session.user.email;
  let [prof]=await rows(sb.from('profiles').select('*').eq('id',uid));
  /* enrollment saved locally while the email was still unconfirmed: send it now */
  const pk='mb_enroll:'+email.toLowerCase();
  if(!prof){let pend=null;try{pend=JSON.parse(localStorage.getItem(pk))}catch(_){}
    if(pend){try{await bankOp('submit_enrollment',pend);localStorage.removeItem(pk);[prof]=await rows(sb.from('profiles').select('*').eq('id',uid))}catch(x){console.error(x)}}}
  else localStorage.removeItem(pk);
  if(prof&&prof.role!=='customer'){sess={role:'admin',name:prof.full_name||email,email};save('mb_sess',sess);await loadAdmin();return}
  const accts=await rows(sb.from('accounts').select('*').order('created_at'));
  const led=await rows(sb.from('ledger_entries').select('*').order('created_at',{ascending:false}).limit(200));
  const wr=await rows(sb.from('withdrawal_requests').select('*').order('created_at',{ascending:false}));
  const dr=await rows(sb.from('deposit_requests').select('*').order('created_at',{ascending:false}));
  const pref=localStorage.getItem('mb_cur:'+email.toLowerCase());
  const a=accts.find(x=>x.currency===pref)||accts[0]||null;
  const cur=a?a.currency:(pref||'USD'),name=(prof&&prof.full_name)||email;
  const tx=[];
  led.filter(l=>a&&l.account_id===a.id).forEach(l=>tx.push({ts:l.created_at,n:l.description||LED_LBL[l.entry_type]||'Transaction',d:fdate(l.created_at),a:(l.direction==='credit'?1:-1)*Number(l.amount),i:LED_ICON[l.entry_type]||'swap',...(l.status!=='completed'?{s:cap(l.status)}:{})}));
  wr.filter(w=>a&&w.account_id===a.id&&w.status!=='approved').forEach(w=>tx.push({ts:w.created_at,n:'Withdrawal to '+(String(w.destination_label||'').split(' — ')[0]||'bank'),d:fdate(w.created_at),a:-Number(w.amount),i:'withdraw',s:WSM[w.status],wid:w.id}));
  dr.filter(d=>a&&d.account_id===a.id&&d.status!=='approved').forEach(d=>tx.push({ts:d.created_at,n:'Deposit request',d:fdate(d.created_at),a:Number(d.amount),i:'deposit',s:WSM[d.status]}));
  tx.sort((x,y)=>y.ts.localeCompare(x.ts));
  sess={role:'user',name,email,currency:cur};save('mb_sess',sess);
  wallet={balance:a?Number(a.balance):0,tx};saveWalletOf(email,wallet);
  ACCT[email]=a?{id:a.id,number:a.account_number,currency:a.currency}:null;
  users=[{n:name,e:email,s:'Active'}];
  kyc=[{id:'KYC-'+uid.slice(0,6).toUpperCase(),e:email,u:name,t:'Identity check',s:KS[prof?prof.enrollment_status:'not_started']||'Pending',uid}];
  wds=wr.map(w=>mapWd(w,email,name));atx=[];
  upsertReg(prof||{email,full_name:name},cur);
  persist()}

/* ---------- load everything an admin/staff member can see ---------- */
async function loadAdmin(){
  const {data:ov,error:oe}=await sb.functions.invoke('get-admin-sensitive-summary',{body:{}});
  if(oe)throw new Error('Could not load users: '+oe.message);
  const entries=(ov&&ov.entries)||[];
  const accts=await rows(sb.from('accounts').select('*').order('created_at'));
  const led=await rows(sb.from('ledger_entries').select('*').order('created_at',{ascending:false}).limit(500));
  const wr=await rows(sb.from('withdrawal_requests').select('*').order('created_at',{ascending:true}));
  const byId={};entries.forEach(x=>{byId[x.user_id]=x});
  const first={};accts.forEach(a=>{if(!first[a.user_id])first[a.user_id]=a});
  users=entries.map(x=>({n:x.full_name||x.email,e:x.email,s:'Active'}));
  kyc=entries.map(x=>({id:'KYC-'+x.user_id.slice(0,6).toUpperCase(),e:x.email,u:x.full_name||x.email,t:'Identity check',s:KS[x.enrollment_status]||'Pending',uid:x.user_id}));
  entries.forEach(x=>{
    const a=first[x.user_id];
    ACCT[x.email]=a?{id:a.id,number:a.account_number,currency:a.currency}:null;
    const tx=led.filter(l=>a&&l.account_id===a.id).map(l=>({n:l.description||LED_LBL[l.entry_type]||'Transaction',d:fdate(l.created_at),a:(l.direction==='credit'?1:-1)*Number(l.amount),i:LED_ICON[l.entry_type]||'swap',...(l.status!=='completed'?{s:cap(l.status)}:{})}));
    saveWalletOf(x.email,{balance:a?Number(a.balance):0,tx});
    upsertReg(x,a?a.currency:'USD')});
  wds=wr.map(w=>{const u=byId[w.user_id]||{};return mapWd(w,u.email||'',u.full_name||u.email||'Unknown')});
  atx=led.slice(0,200).map(l=>({id:l.id.slice(0,8).toUpperCase(),u:(byId[l.user_id]||{}).full_name||'—',t:l.entry_type==='deposit'?'Deposit':l.entry_type==='withdrawal'?'Withdrawal':/^transfer/.test(l.entry_type)?'Transfer':'Adjustment',a:(l.direction==='credit'?1:-1)*Number(l.amount),s:cap(l.status)}));
  banks.length=0;accts.forEach(a=>{const u=byId[a.user_id]||{};banks.push([u.full_name||'—','MyBank '+a.currency,a.account_number,cap(a.status)])});
  persist()}

async function refreshMe(){const {data:{session}}=await sb.auth.getSession();if(session)await loadMe(session)}

/* ---------- auth ---------- */
window.doLogin=async function(e){e.preventDefault();
  const email=$('#lg_e').value.trim(),pw=$('#lg_p').value,err=$('#lg_err');err.textContent='';
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){err.textContent='Log in with the email address you registered with.';return false}
  const {data,error}=await sb.auth.signInWithPassword({email,password:pw});
  if(error){err.textContent=/confirm/i.test(error.message)?'Please confirm your email address first, then log in.':'Incorrect email or password.';return false}
  try{await loadMe(data.session)}catch(x){err.textContent='Signed in, but your data could not be loaded: '+x.message;return false}
  go(sess.role==='admin'?'#/admin/dashboard':'#/home');return false};

window.logout=async function(){try{await sb.auth.signOut()}catch(_){}clearLocal();sess=null;wallet=null;go('#/login')};

window.doSignup=async function(e){e.preventDefault();
  const v=id=>$('#'+id).value.trim();
  const err=m=>{const x=$('#su_err');x.textContent=m;x.scrollIntoView({block:'center',behavior:'smooth'});return false};
  const email=v('su_e'),phone=v('su_p');
  if(/^admin(@|$)/i.test(email))return err('This email is reserved.');
  if(!PHONE.test(phone)||phone.replace(/\D/g,'').length<7)return err('Enter a valid phone number.');
  const dob=new Date(v('su_dob')+'T00:00:00'),lim=new Date();lim.setFullYear(lim.getFullYear()-18);
  if(isNaN(dob)||dob.getFullYear()<1900)return err('Enter a valid date of birth.');
  if(dob>lim)return err('You must be at least 18 years old to open an account.');
  const ssn=$('#su_ssn').value.replace(/[\s-]/g,'');if(!/^[A-Za-z0-9]{4,20}$/.test(ssn))return err('Enter a valid Social Security Number / Tax ID.');
  const cs=$('#su_city').value,city=cs==='__o'?v('su_city_o'):cs;if(!city)return err('Please choose or type your city.');
  if(!PHONE.test(v('nk_p'))||v('nk_p').replace(/\D/g,'').length<7)return err("Enter a valid phone number for your next of kin.");
  const pw=$('#su_pw').value;if(pw.length<8)return err('Password must be at least 8 characters.');
  if(pw!==$('#su_pw2').value)return err('Passwords do not match.');
  const pin=$('#su_pin').value;if(!/^\d{4}$/.test(pin))return err('PIN must be exactly 4 digits.');
  const ph=$('#su_photo'),dc=$('#su_doc');
  let m=checkFile(ph);if(m)return err('Passport photograph: '+m);
  if(!$('#su_doct').value)return err('Select your means of identification.');
  m=checkFile(dc);if(m)return err('Identity document: '+m);
  const {data,error}=await sb.auth.signUp({email,password:pw});
  if(error)return err(error.message);
  if(data.user&&data.user.identities&&data.user.identities.length===0)return err('An account with this email already exists.');
  const payload={p_full_name:v('su_n'),p_phone:phone,p_date_of_birth:v('su_dob'),p_gender:GEN_IN[$('#su_g').value]||null,p_city:city,p_address_line:v('su_addr'),p_postal_code:v('su_zip'),p_occupation:v('su_occ'),p_next_of_kin_name:v('nk_n'),p_next_of_kin_phone:v('nk_p'),p_next_of_kin_email:v('nk_e'),p_nin_last4:ssn.slice(-4),p_bvn_last4:''};
  localStorage.setItem('mb_cur:'+email.toLowerCase(),$('#su_cur').value);
  let r=reg.find(x=>x.email&&x.email.toLowerCase()===email.toLowerCase());if(!r){r=stub(email);reg.push(r)}
  Object.assign(r,{name:payload.p_full_name,email,phone,pw:'',pin,currency:$('#su_cur').value});
  let msg='Account created. Please log in.';
  if(data.session){
    try{await bankOp('submit_enrollment',payload)}catch(x){localStorage.setItem('mb_enroll:'+email.toLowerCase(),JSON.stringify(payload))}
    try{await sb.auth.signOut()}catch(_){}
  }else{
    localStorage.setItem('mb_enroll:'+email.toLowerCase(),JSON.stringify(payload));
    msg='Account created. Confirm your email, then log in.'}
  persist();toast(msg);go('#/login');return false};

/* ---------- customer actions ---------- */
window.doSend=async function(e){e.preventDefault();
  const err=m=>{$('#sm_err').textContent=m;return false};
  const a=Math.round(parseFloat($('#sm_a').value)*100)/100;
  if(!(a>0))return err('Enter a valid amount.');
  if(a>wallet.balance)return err('Insufficient balance.');
  const to=$('#sm_r').value.trim().replace(/\s/g,'');
  try{await bankOp('demo_transfer',{p_to_account_number:to,p_amount:a,p_currency:curCode(),p_note:$('#sm_n').value.trim()||null});await refreshMe()}
  catch(x){return err(x.message)}
  toast('Transfer of '+money(a)+' sent');go('#/home');return false};

window.amountAction=async function(){
  const v=Math.round(parseFloat(prompt('Deposit amount ('+sym().trim()+')'))*100)/100;if(!(v>0))return;
  try{await bankOp('demo_deposit_request',{p_amount:v,p_currency:curCode(),p_payment_method:'bank_transfer',p_reference:null});await refreshMe()}
  catch(x){toast(x.message);return}
  toast('Deposit request submitted for approval');go('#/home')};

window.doWithdraw=async function(e){e.preventDefault();const err=m=>{$('#wd_err').textContent=m;return false};
  if(kycOf()!=='Verified')return err('Complete identity verification before withdrawing.');
  const a=Math.round(parseFloat($('#wd_a').value)*100)/100;if(!(a>0))return err('Enter a valid amount.');
  if(a>wallet.balance)return err('Insufficient balance.');
  const acct=$('#wd_n').value.replace(/\s/g,'');if(!/^[A-Za-z0-9]{6,34}$/.test(acct))return err('Enter a valid account number or IBAN.');
  if(Date.now()<ui.lock)return err('Too many wrong PIN attempts. Please try again in a few minutes.');
  if($('#wd_p').value!==myPin()){ui.fail++;if(ui.fail>=3){ui.lock=Date.now()+5*60000;ui.fail=0}return err('Incorrect PIN.')}
  ui.fail=0;
  const bank=$('#wd_b').value.trim(),holder=$('#wd_h').value.trim();
  try{await bankOp('demo_withdrawal_request',{p_amount:a,p_currency:curCode(),p_destination_label:(bank+' — '+holder).slice(0,80),p_destination_masked:'••••'+acct.slice(-4)});await refreshMe()}
  catch(x){return err(x.message)}
  toast('Withdrawal request submitted');render();return false};

/* ---------- admin actions ---------- */
window.wdSet=async function(id,s){const w=wds.find(x=>x.id===id);if(!w||w.s!=='Pending')return;
  if(!confirm((s==='Completed'?'Approve':'Reject')+' this withdrawal?'))return;
  try{await bankOp('admin_review_withdrawal',{p_request_id:id,p_approve:s==='Completed',p_note:null});await loadAdmin()}
  catch(x){toast(x.message);return}
  render()};

window.setKyc=async function(i,s){const k=kyc[i];if(!k||!k.uid)return;
  try{await bankOp('admin_review_enrollment',{p_user_id:k.uid,p_approve:s==='Verified',p_note:null});await loadAdmin()}
  catch(x){toast(x.message);return}
  render()};

window.saveUser=async function(ev,old){ev.preventDefault();
  const t=m=>{toast(m);return false};
  const k=kyc.find(x=>x.e===old),ksNew=$('#uf_ks').value;
  const bal=Math.round(parseFloat($('#uf_bal').value)*100)/100;
  if(isNaN(bal)||bal<0)return t('Enter a valid balance (0 or more).');
  try{
    if(k&&k.uid&&ksNew!==k.s&&(ksNew==='Verified'||ksNew==='Rejected')){await bankOp('admin_review_enrollment',{p_user_id:k.uid,p_approve:ksNew==='Verified',p_note:null});await loadAdmin()}
    const ac=ACCT[old],d=Math.round((bal-walletOf(old).balance)*100)/100;
    if(Math.abs(d)>=0.005){
      if(!ac)return t('This user has no bank account yet. Approve their identity first.');
      await bankOp('admin_adjust_demo_balance',{p_account_id:ac.id,p_amount:Math.abs(d),p_direction:d>0?'credit':'debit',p_reason:'Balance adjustment by admin'});await loadAdmin()}
  }catch(x){return t(x.message)}
  toast('Saved. Name, contact and address are not editable through the backend.');render();return false};

window.addTx=async function(){const e=ui.uemail,n=$('#ntx_n').value.trim(),a=Math.round(parseFloat($('#ntx_a').value)*100)/100;
  if(!n||isNaN(a)||a===0){toast('Enter a description and a non-zero amount');return}
  if(!$('#ntx_b').checked){toast('On the backend every entry changes the balance. Tick the balance option to add it.');return}
  const ac=ACCT[e];if(!ac){toast('This user has no bank account yet.');return}
  try{await bankOp('admin_adjust_demo_balance',{p_account_id:ac.id,p_amount:Math.abs(a),p_direction:a>0?'credit':'debit',p_reason:n});await loadAdmin()}
  catch(x){toast(x.message);return}
  toast('Entry added');render()};

/* ---------- features that have no backend table/function yet: stop them faking changes ---------- */
const nc=name=>()=>toast(name+' is not connected to the backend yet');
window.payBill=nc('Bill payment');
window.loanSet=nc('Loan approval');
window.saveTx=nc('Editing ledger records');
window.delTx=nc('Deleting ledger records');
window.addUser=nc('Adding users here');
window.toggleUser=nc('Suspending users');
window.deleteUser=nc('Deleting users');

/* ---------- restore an existing backend session on page load ---------- */
sb.auth.onAuthStateChange(ev=>{if(ev==='SIGNED_OUT'&&sess){clearLocal();sess=null;wallet=null;go('#/login')}});
(async()=>{try{
  const {data:{session}}=await sb.auth.getSession();
  if(session){await loadMe(session);render()}
  else if(sess){clearLocal();sess=null;wallet=null;go('#/login')}
}catch(x){console.error(x)}})();
})();

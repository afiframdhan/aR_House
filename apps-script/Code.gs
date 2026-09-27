const SHEETS = {
  USERS: 'USERS', SETTINGS: 'SETTINGS', ACCOUNTS: 'ACCOUNTS', CATEGORIES: 'CATEGORIES',
  TRANSACTIONS: 'TRANSACTIONS', SESSIONS: 'SESSIONS', ROUTINES: 'ROUTINES'
};

const HEADERS = {
  USERS: ['ID','USERNAME','PASSWORD','NAME','ROLE','ACTIVE','PHOTO'],
  SETTINGS: ['KEY','VALUE'],
  ACCOUNTS: ['ID','BOOK','NAME','TYPE','OPENING_BALANCE','ACTIVE'],
  CATEGORIES: ['ID','BOOK','TYPE','NAME','ACTIVE'],
  TRANSACTIONS: ['ID','DATE','BOOK','TYPE','CATEGORY','DESCRIPTION','PARTY','FROM_ACCOUNT','TO_ACCOUNT','AMOUNT','METHOD','NOTE','CREATED_BY','CREATED_AT','UPDATED_AT','ROUTINE_ID'],
  SESSIONS: ['TOKEN','USERNAME','EXPIRES_AT','CREATED_AT'],
  ROUTINES: ['ID','DESCRIPTION','CATEGORY','AMOUNT','PAYMENT_MODE','DUE_DAY','FROM_ACCOUNT','ACTIVE','NOTE']
};

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ok:true,service:'AR Family Finance API',version:'1.2'})).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let req = {};
  try { req = JSON.parse((e.parameter && e.parameter.payload) || '{}'); } catch (err) {}
  const requestId = req.requestId || '';
  let packet;
  try {
    const data = route_(req.action, req.token || '', req.data || {});
    packet = { source:'ar-finance-bridge', requestId, ok:true, data };
  } catch (err) {
    packet = { source:'ar-finance-bridge', requestId, ok:false, error:String(err && err.message ? err.message : err) };
  }
  const origin = getSetting_('GITHUB_ORIGIN') || '*';
  const html = `<!doctype html><html><body><script>
    (function(){
      var p=${JSON.stringify(packet)};
      var o=${JSON.stringify(origin)};
      try { window.top.postMessage(p, o); }
      catch (e) { try { window.top.postMessage(p, '*'); } catch (e2) {} }
    })();
  <\/script></body></html>`;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function route_(action, token, data) {
  if (action === 'login') return login_(data);
  if (action === 'logout') return logout_(token);
  const user = requireSession_(token);
  if (action === 'initialData' || action === 'sync') return appData_(data, user);
  if (action === 'bootstrap') return bootstrap_(user);
  if (action === 'dashboard') return dashboard_(data, user);
  if (action === 'transactions') return transactions_(data, user);
  if (action === 'addTransaction') return saveTransaction_(data, user, false);
  if (action === 'updateTransaction') return saveTransaction_(data, user, true);
  if (action === 'deleteTransaction') return deleteTransaction_(data, user);
  if (action === 'saveRoutine') return saveRoutine_(data, user);
  if (action === 'deleteRoutine') return deleteRoutine_(data, user);
  if (action === 'payRoutine') return payRoutine_(data, user);
  if (action === 'updateProfile') return updateProfile_(data, user, token);
  throw new Error('Action tidak dikenal.');
}

function setupDatabase() {
  Object.keys(HEADERS).forEach(k => ensureSheet_(SHEETS[k], HEADERS[k]));

  seedIfEmpty_(SHEETS.USERS, [
    ['USR-001','admin','admin123','Administrator','ADMIN',true,'']
  ]);
  seedIfEmpty_(SHEETS.SETTINGS, [
    ['APP_NAME','AR Family Finance'],['GITHUB_ORIGIN','*'],['PERSIST_LOGIN','TRUE'],['SESSION_DAYS','3650'],['CURRENCY','IDR']
  ]);
  seedIfEmpty_(SHEETS.ACCOUNTS, [
    ['ACC-H-BANK','HOUSE','Rumah · Bank','BANK',0,true],['ACC-H-CASH','HOUSE','Rumah · Tunai','CASH',0,true],
    ['ACC-S-BANK','STUDIO','Studio · Bank','BANK',0,true],['ACC-S-CASH','STUDIO','Studio · Tunai','CASH',0,true]
  ]);
  seedIfEmpty_(SHEETS.CATEGORIES, defaultCategories_());
  seedIfEmpty_(SHEETS.ROUTINES, [
    ['RUT-001','Listrik','Tagihan rumah',0,'ONLINE',10,'Rumah · Bank',false,'Contoh. Aktifkan dan isi nominal jika diperlukan.'],
    ['RUT-002','Belanja bulanan','Belanja dapur',0,'CASH_ATM',5,'Rumah · Tunai',false,'Contoh. Aktifkan dan isi nominal jika diperlukan.']
  ]);
  formatSheets_();
  return 'Database AR Family Finance v1.2 siap.';
}

function defaultCategories_() {
  const rows=[]; let i=1;
  const add=(book,type,names)=>names.forEach(n=>rows.push(['CAT-'+String(i++).padStart(3,'0'),book,type,n,true]));
  add('HOUSE','INCOME',['Gaji tetap','Usaha studio','Penghasilan lainnya']);
  add('HOUSE','EXPENSE',['Belanja dapur','Tagihan rumah','Transportasi','Pendidikan','Kesehatan','Makan di luar','Cicilan','Hiburan','Internet & telepon','Listrik','Air','Iuran','Lainnya']);
  add('HOUSE','TRANSFER',['Transfer antar akun']);
  add('STUDIO','INCOME',['Recording','Mixing','Mastering','Aransemen','Jingle','Video cover','Pendapatan lain']);
  add('STUDIO','EXPENSE',['Operator','Sewa & utilitas','Peralatan','Software','Pemasaran','Transportasi','Biaya lain']);
  add('STUDIO','TRANSFER',['Transfer antar akun']);
  add('STUDIO','PRIVE',['Prive pemilik']);
  return rows;
}

function login_(data) {
  const username = String(data.username||'').trim();
  const password = String(data.password||'');
  if (!username || !password) throw new Error('Username dan password wajib diisi.');
  const rows = sheetObjects_(SHEETS.USERS);
  const u = rows.find(r => String(r.USERNAME).toLowerCase()===username.toLowerCase() && truthy_(r.ACTIVE));
  if (!u || String(u.PASSWORD)!==password) throw new Error('Username atau password salah.');
  purgeSessions_();
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g,'');
  const days = Number(getSetting_('SESSION_DAYS')||3650);
  const expires = new Date(Date.now()+days*86400000);
  SpreadsheetApp.getActive().getSheetByName(SHEETS.SESSIONS).appendRow([token,u.USERNAME,expires,new Date()]);
  const user = safeUser_(u);
  const dataPack = appData_({book:'ALL',month:'ALL',year:new Date().getFullYear()}, user);
  return Object.assign({token}, dataPack);
}

function logout_(token) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.SESSIONS); if(!sh) return {ok:true};
  const vals=sh.getDataRange().getValues();
  for(let i=vals.length-1;i>=1;i--) if(String(vals[i][0])===String(token)) sh.deleteRow(i+1);
  return {ok:true};
}

function requireSession_(token) {
  if (!token) throw new Error('Session tidak tersedia. Silakan login ulang.');
  const sessions=sheetObjects_(SHEETS.SESSIONS); const s=sessions.find(x=>String(x.TOKEN)===String(token));
  if(!s) throw new Error('Session tidak ditemukan. Silakan login ulang.');
  const persistent = truthy_(getSetting_('PERSIST_LOGIN'));
  if(!persistent && new Date(s.EXPIRES_AT).getTime()<Date.now()) throw new Error('Session berakhir. Silakan login ulang.');
  const u=sheetObjects_(SHEETS.USERS).find(x=>String(x.USERNAME)===String(s.USERNAME) && truthy_(x.ACTIVE));
  if(!u) throw new Error('User tidak aktif atau username berubah. Silakan login ulang.');
  return safeUser_(u);
}

function safeUser_(u){
  return { id:String(u.ID||''), username:String(u.USERNAME||''), name:String(u.NAME||u.USERNAME||''), role:String(u.ROLE||'USER').toUpperCase(), photo:String(u.PHOTO||'') };
}

function appData_(filters, user){
  const meta = bootstrap_(user);
  const all = allTransactions_();
  const base = Object.assign({}, filters||{}, {book:'ALL'});
  return {
    user,
    meta,
    dashboards: {
      ALL: dashboardFromAll_(all, Object.assign({}, base, {book:'ALL'})),
      HOUSE: dashboardFromAll_(all, Object.assign({}, base, {book:'HOUSE'})),
      STUDIO: dashboardFromAll_(all, Object.assign({}, base, {book:'STUDIO'}))
    },
    transactions: {transactions: applyFilters_(all, base).sort(sortTransactions_)},
    routines: routineStatus_(base)
  };
}

function bootstrap_() {
  const accounts=sheetObjects_(SHEETS.ACCOUNTS).map(a=>({id:a.ID,book:a.BOOK,name:a.NAME,type:a.TYPE,openingBalance:Number(a.OPENING_BALANCE||0),active:truthy_(a.ACTIVE)}));
  const categories=sheetObjects_(SHEETS.CATEGORIES).map(c=>({id:c.ID,book:c.BOOK,type:c.TYPE,name:c.NAME,active:truthy_(c.ACTIVE)}));
  const tx=sheetObjects_(SHEETS.TRANSACTIONS); const years=[...new Set(tx.map(r=>dateParts_(r.DATE).year).filter(Boolean).concat([new Date().getFullYear()]))].sort((a,b)=>b-a);
  return {accounts,categories,years};
}

function transactions_(filters) {
  let tx = applyFilters_(allTransactions_(),filters); tx.sort(sortTransactions_);
  return {transactions:tx};
}

function dashboard_(filters) { return dashboardFromAll_(allTransactions_(), filters||{}); }

function dashboardFromAll_(all, filters) {
  const filtered=applyFilters_(all,filters);
  const income=sum_(filtered.filter(x=>x.type==='INCOME'),'amount');
  const expense=sum_(filtered.filter(x=>x.type==='EXPENSE'),'amount');
  const studioIncome=sum_(filtered.filter(x=>x.book==='STUDIO'&&x.type==='INCOME'),'amount');
  const studioExpense=sum_(filtered.filter(x=>x.book==='STUDIO'&&x.type==='EXPENSE'),'amount');
  const houseIncome=sum_(filtered.filter(x=>x.book==='HOUSE'&&x.type==='INCOME'),'amount');
  const houseExpense=sum_(filtered.filter(x=>x.book==='HOUSE'&&x.type==='EXPENSE'),'amount');
  const balances=calculateBalances_(all); const accountDefs=sheetObjects_(SHEETS.ACCOUNTS).filter(a=>truthy_(a.ACTIVE));
  const accounts=accountDefs.map(a=>({book:a.BOOK,name:a.NAME,type:a.TYPE,openingBalance:Number(a.OPENING_BALANCE||0),balance:Number(balances[a.NAME]||0)}));
  const year = Number(filters.year)||new Date().getFullYear();
  const trend=[];
  for(let m=1;m<=12;m++){
    const mt=all.filter(t=>dateParts_(t.date).year===year&&dateParts_(t.date).month===m&&(filters.book==='ALL'||!filters.book||t.book===filters.book));
    trend.push({label:['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][m-1],income:sum_(mt.filter(x=>x.type==='INCOME'),'amount'),expense:sum_(mt.filter(x=>x.type==='EXPENSE'),'amount')});
  }
  const catMap={}; filtered.filter(x=>x.type==='EXPENSE').forEach(x=>catMap[x.category]=(catMap[x.category]||0)+x.amount);
  const categories=Object.keys(catMap).map(k=>({name:k,amount:catMap[k]})).sort((a,b)=>b.amount-a.amount).slice(0,8);
  const recent=[...filtered].sort(sortTransactions_).slice(0,8);
  return {summary:{income,expense,net:income-expense,studioProfit:studioIncome-studioExpense,houseNet:houseIncome-houseExpense},balances,accounts,trend,categories,recent};
}

function saveTransaction_(d,user,isUpdate) {
  validateTx_(d);
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.TRANSACTIONS); const now=new Date();
  if(isUpdate){
    const vals=sh.getDataRange().getValues(); const head=vals[0].map(String); const idCol=head.indexOf('ID'); let row=-1;
    for(let i=1;i<vals.length;i++) if(String(vals[i][idCol])===String(d.id)){row=i+1;break;}
    if(row<0) throw new Error('Transaksi tidak ditemukan.');
    const old=Object.fromEntries(head.map((h,i)=>[h, vals[row-1][i]]));
    writeObjectRow_(sh,row,HEADERS.TRANSACTIONS,txObject_(d,d.id,old.CREATED_BY||user.username,old.CREATED_AT||now,now,d.routineId||old.ROUTINE_ID||''));
  } else {
    const id='TX-'+Utilities.getUuid().slice(0,8).toUpperCase();
    appendObject_(sh,HEADERS.TRANSACTIONS,txObject_(d,id,user.username,now,now,d.routineId||''));
  }
  return {ok:true};
}

function deleteTransaction_(d,user){
  if(user.role!=='ADMIN') throw new Error('Hanya Admin yang dapat menghapus transaksi.');
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.TRANSACTIONS); const vals=sh.getDataRange().getValues(); const idCol=vals[0].indexOf('ID');
  for(let i=1;i<vals.length;i++) if(String(vals[i][idCol])===String(d.id)){sh.deleteRow(i+1);return {ok:true};}
  throw new Error('Transaksi tidak ditemukan.');
}

function validateTx_(d){
  ['date','book','type','category','description'].forEach(k=>{if(!String(d[k]||'').trim()) throw new Error('Data transaksi belum lengkap: '+k);});
  if(!(Number(d.amount)>0)) throw new Error('Nominal harus lebih dari 0.');
  if(d.type==='INCOME'&&!d.toAccount) throw new Error('Pemasukan harus memiliki Akun Tujuan.');
  if((d.type==='EXPENSE'||d.type==='PRIVE')&&!d.fromAccount) throw new Error('Pengeluaran/Prive harus memiliki Akun Asal.');
  if(d.type==='TRANSFER'&&(!d.fromAccount||!d.toAccount)) throw new Error('Transfer harus memiliki Akun Asal dan Tujuan.');
  if(d.type==='TRANSFER'&&d.fromAccount===d.toAccount) throw new Error('Akun asal dan tujuan transfer harus berbeda.');
}

function txObject_(d,id,createdBy,createdAt,updatedAt,routineId){
  return {ID:id,DATE:new Date(d.date+'T00:00:00'),BOOK:d.book,TYPE:d.type,CATEGORY:d.category,DESCRIPTION:d.description,PARTY:d.party||'',FROM_ACCOUNT:d.fromAccount||'',TO_ACCOUNT:d.toAccount||'',AMOUNT:Number(d.amount),METHOD:d.method||'',NOTE:d.note||'',CREATED_BY:createdBy,CREATED_AT:createdAt,UPDATED_AT:updatedAt,ROUTINE_ID:routineId||''};
}

function allTransactions_(){
  return sheetObjects_(SHEETS.TRANSACTIONS).map(r=>({id:String(r.ID||''),date:isoDate_(r.DATE),book:String(r.BOOK||''),type:String(r.TYPE||''),category:String(r.CATEGORY||''),description:String(r.DESCRIPTION||''),party:String(r.PARTY||''),fromAccount:String(r.FROM_ACCOUNT||''),toAccount:String(r.TO_ACCOUNT||''),amount:Number(r.AMOUNT||0),method:String(r.METHOD||''),note:String(r.NOTE||''),createdBy:String(r.CREATED_BY||''),createdAt:isoDateTime_(r.CREATED_AT),updatedAt:isoDateTime_(r.UPDATED_AT),routineId:String(r.ROUTINE_ID||'')}));
}

function saveRoutine_(d,user){
  if(!String(d.description||'').trim()) throw new Error('Nama pengeluaran rutin wajib diisi.');
  if(!(Number(d.amount)>=0)) throw new Error('Nominal tidak valid.');
  const day=Math.max(1,Math.min(31,Number(d.dueDay||1)));
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.ROUTINES);
  const obj={ID:d.id||('RUT-'+Utilities.getUuid().slice(0,8).toUpperCase()),DESCRIPTION:String(d.description).trim(),CATEGORY:String(d.category||'Lainnya'),AMOUNT:Number(d.amount||0),PAYMENT_MODE:String(d.paymentMode||'ONLINE'),DUE_DAY:day,FROM_ACCOUNT:String(d.fromAccount||defaultRoutineAccount_(d.paymentMode)),ACTIVE:d.active!==false,NOTE:String(d.note||'')};
  if(d.id){
    const vals=sh.getDataRange().getValues(), idCol=vals[0].indexOf('ID'); let row=-1;
    for(let i=1;i<vals.length;i++) if(String(vals[i][idCol])===String(d.id)){row=i+1;break;}
    if(row<0) throw new Error('Pengeluaran rutin tidak ditemukan.');
    writeObjectRow_(sh,row,HEADERS.ROUTINES,obj);
  } else appendObject_(sh,HEADERS.ROUTINES,obj);
  return {ok:true};
}

function deleteRoutine_(d,user){
  if(user.role!=='ADMIN') throw new Error('Hanya Admin yang dapat menghapus pengeluaran rutin.');
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.ROUTINES); const vals=sh.getDataRange().getValues(); const idCol=vals[0].indexOf('ID');
  for(let i=1;i<vals.length;i++) if(String(vals[i][idCol])===String(d.id)){sh.deleteRow(i+1);return {ok:true};}
  throw new Error('Pengeluaran rutin tidak ditemukan.');
}

function payRoutine_(d,user){
  const routine=sheetObjects_(SHEETS.ROUTINES).find(r=>String(r.ID)===String(d.id));
  if(!routine) throw new Error('Pengeluaran rutin tidak ditemukan.');
  const year=Number(d.year)||new Date().getFullYear(), month=Number(d.month)||new Date().getMonth()+1;
  const existing=allTransactions_().find(t=>t.routineId===String(routine.ID)&&dateParts_(t.date).year===year&&dateParts_(t.date).month===month);
  if(existing) throw new Error('Pengeluaran rutin ini sudah dibayar pada periode tersebut.');
  if(!(Number(routine.AMOUNT)>0)) throw new Error('Nominal pengeluaran rutin masih 0. Edit terlebih dahulu.');
  const maxDay=new Date(year,month,0).getDate(); const day=Math.min(Number(routine.DUE_DAY||1),maxDay);
  const payDate = d.date || [year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
  const mode=String(routine.PAYMENT_MODE||'ONLINE');
  const tx={date:payDate,book:'HOUSE',type:'EXPENSE',category:String(routine.CATEGORY||'Lainnya'),description:String(routine.DESCRIPTION||'Pengeluaran rutin'),party:'',fromAccount:String(routine.FROM_ACCOUNT||defaultRoutineAccount_(mode)),toAccount:'',amount:Number(routine.AMOUNT||0),method:mode==='CASH_ATM'?'Cash/ATM':'Online',note:'Pengeluaran rutin bulanan',routineId:String(routine.ID)};
  saveTransaction_(tx,user,false);
  return {ok:true};
}

function routineStatus_(filters){
  const year=Number(filters.year)||new Date().getFullYear();
  const month=(filters.month && filters.month!=='ALL')?Number(filters.month):new Date().getMonth()+1;
  const tx=allTransactions_();
  return sheetObjects_(SHEETS.ROUTINES).map(r=>{
    const paid=tx.find(t=>t.routineId===String(r.ID)&&dateParts_(t.date).year===year&&dateParts_(t.date).month===month);
    return {id:String(r.ID||''),description:String(r.DESCRIPTION||''),category:String(r.CATEGORY||''),amount:Number(r.AMOUNT||0),paymentMode:String(r.PAYMENT_MODE||'ONLINE'),dueDay:Number(r.DUE_DAY||1),fromAccount:String(r.FROM_ACCOUNT||''),active:truthy_(r.ACTIVE),note:String(r.NOTE||''),paid:!!paid,paidDate:paid?paid.date:'',transactionId:paid?paid.id:'',year,month};
  });
}

function defaultRoutineAccount_(mode){ return String(mode)==='CASH_ATM'?'Rumah · Tunai':'Rumah · Bank'; }

function updateProfile_(d,user,token){
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.USERS), vals=sh.getDataRange().getValues(), head=vals[0].map(String), idCol=head.indexOf('ID');
  let row=-1; for(let i=1;i<vals.length;i++) if(String(vals[i][idCol])===String(user.id)){row=i+1;break;}
  if(row<0) throw new Error('Profil user tidak ditemukan.');
  const current=Object.fromEntries(head.map((h,i)=>[h,vals[row-1][i]]));
  const newUsername=String(d.username||current.USERNAME).trim();
  const duplicate=sheetObjects_(SHEETS.USERS).find(x=>String(x.ID)!==String(user.id)&&String(x.USERNAME).toLowerCase()===newUsername.toLowerCase());
  if(duplicate) throw new Error('Username sudah digunakan user lain.');
  let photo = d.photo===undefined ? String(current.PHOTO||'') : String(d.photo||'');
  if(photo.length>47000) throw new Error('Ukuran foto terlalu besar. Crop/kompres foto kembali.');
  const obj={ID:current.ID,USERNAME:newUsername,PASSWORD:String(d.password||'').trim()?String(d.password):current.PASSWORD,NAME:String(d.name||current.NAME||newUsername).trim(),ROLE:current.ROLE,ACTIVE:current.ACTIVE,PHOTO:photo};
  writeObjectRow_(sh,row,HEADERS.USERS,obj);
  if(newUsername!==String(current.USERNAME)){
    const ssh=SpreadsheetApp.getActive().getSheetByName(SHEETS.SESSIONS), svals=ssh.getDataRange().getValues(), tokenCol=svals[0].indexOf('TOKEN'), userCol=svals[0].indexOf('USERNAME');
    for(let i=1;i<svals.length;i++) if(String(svals[i][tokenCol])===String(token)) ssh.getRange(i+1,userCol+1).setValue(newUsername);
  }
  return {user:safeUser_(obj)};
}

function applyFilters_(tx,f){f=f||{};return tx.filter(t=>{const p=dateParts_(t.date);return(!f.book||f.book==='ALL'||t.book===f.book)&&(!f.year||Number(f.year)===p.year)&&(!f.month||f.month==='ALL'||Number(f.month)===p.month)&&(!f.type||f.type==='ALL'||t.type===f.type);});}
function sortTransactions_(a,b){return String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt));}
function calculateBalances_(tx){const bal={};sheetObjects_(SHEETS.ACCOUNTS).forEach(a=>bal[a.NAME]=Number(a.OPENING_BALANCE||0));tx.forEach(t=>{const n=Number(t.amount||0);if(t.type==='INCOME'&&t.toAccount)bal[t.toAccount]=(bal[t.toAccount]||0)+n;else if((t.type==='EXPENSE'||t.type==='PRIVE')&&t.fromAccount)bal[t.fromAccount]=(bal[t.fromAccount]||0)-n;else if(t.type==='TRANSFER'){if(t.fromAccount)bal[t.fromAccount]=(bal[t.fromAccount]||0)-n;if(t.toAccount)bal[t.toAccount]=(bal[t.toAccount]||0)+n;}});return bal;}

function importLegacyTransactions(){
  setupDatabase(); const ss=SpreadsheetApp.getActive(); const target=ss.getSheetByName(SHEETS.TRANSACTIONS); let count=0;
  [['Transaksi Rumah','HOUSE'],['Transaksi Studio','STUDIO']].forEach(pair=>{const sh=ss.getSheetByName(pair[0]); if(!sh)return; const vals=sh.getDataRange().getValues(); if(vals.length<2)return; const h=vals[0].map(x=>String(x).trim().toLowerCase()); const col=(names)=>{for(const n of names){const i=h.indexOf(n.toLowerCase());if(i>=0)return i;}return -1;};
    const ix={date:col(['Tanggal']),type:col(['Jenis']),cat:col(['Kategori']),desc:col(['Uraian / layanan','Uraian','Layanan']),party:col(['Klien / pihak','Klien','Pihak']),from:col(['Akun asal']),to:col(['Akun tujuan']),amount:col(['Nominal (Rp)','Nominal']),method:col(['Metode']),note:col(['Catatan'])};
    for(let r=1;r<vals.length;r++){if(ix.date<0||ix.amount<0||!vals[r][ix.date]||!vals[r][ix.amount])continue; const d={date:isoDate_(vals[r][ix.date]),book:pair[1],type:normalizeType_(ix.type>=0?vals[r][ix.type]:''),category:ix.cat>=0?vals[r][ix.cat]:'Lainnya',description:ix.desc>=0?vals[r][ix.desc]:'Impor data lama',party:ix.party>=0?vals[r][ix.party]:'',fromAccount:ix.from>=0?vals[r][ix.from]:'',toAccount:ix.to>=0?vals[r][ix.to]:'',amount:Number(vals[r][ix.amount]||0),method:ix.method>=0?vals[r][ix.method]:'',note:ix.note>=0?vals[r][ix.note]:''}; if(!d.type)d.type='EXPENSE'; const id='TX-'+Utilities.getUuid().slice(0,8).toUpperCase();appendObject_(target,HEADERS.TRANSACTIONS,txObject_(d,id,'IMPORT',new Date(),new Date(),''));count++;}
  }); return count+' transaksi diimpor.';
}

function normalizeType_(v){v=String(v||'').toLowerCase();if(v.includes('pemasukan')||v.includes('income')||v.includes('pendapatan'))return'INCOME';if(v.includes('pengeluaran')||v.includes('expense')||v.includes('biaya'))return'EXPENSE';if(v.includes('transfer'))return'TRANSFER';if(v.includes('prive'))return'PRIVE';return'';}
function purgeSessions_(){if(truthy_(getSetting_('PERSIST_LOGIN')))return;const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.SESSIONS);if(!sh)return;const vals=sh.getDataRange().getValues();for(let i=vals.length-1;i>=1;i--)if(new Date(vals[i][2]).getTime()<Date.now())sh.deleteRow(i+1);}
function getSetting_(key){const r=sheetObjects_(SHEETS.SETTINGS).find(x=>String(x.KEY)===String(key));return r?r.VALUE:'';}
function sheetObjects_(name){const sh=SpreadsheetApp.getActive().getSheetByName(name);if(!sh)return[];const vals=sh.getDataRange().getValues();if(vals.length<2)return[];const h=vals[0].map(String);return vals.slice(1).filter(r=>r.some(v=>v!==''&&v!==null)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])));}
function ensureSheet_(name,headers){const ss=SpreadsheetApp.getActive();let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0){sh.getRange(1,1,1,headers.length).setValues([headers]);return sh;}const existing=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);headers.forEach(h=>{if(existing.indexOf(h)<0){sh.getRange(1,sh.getLastColumn()+1).setValue(h);existing.push(h);}});return sh;}
function seedIfEmpty_(name,rows){const sh=SpreadsheetApp.getActive().getSheetByName(name);if(sh.getLastRow()<=1&&rows.length)sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);}
function appendObject_(sh,headers,obj){const actual=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);sh.appendRow(actual.map(h=>Object.prototype.hasOwnProperty.call(obj,h)?obj[h]:''));}
function writeObjectRow_(sh,row,headers,obj){const actual=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);sh.getRange(row,1,1,actual.length).setValues([actual.map(h=>Object.prototype.hasOwnProperty.call(obj,h)?obj[h]:'')]);}
function formatSheets_(){Object.values(SHEETS).forEach(n=>{const sh=SpreadsheetApp.getActive().getSheetByName(n);if(!sh)return;sh.setFrozenRows(1);sh.getRange(1,1,1,sh.getLastColumn()).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');sh.autoResizeColumns(1,Math.min(sh.getLastColumn(),10));});}
function truthy_(v){return v===true||String(v).toLowerCase()==='true'||String(v)==='1'||String(v).toLowerCase()==='yes';}
function sum_(arr,key){return arr.reduce((a,x)=>a+Number(x[key]||0),0);}
function isoDate_(v){if(!v)return'';const d=v instanceof Date?v:new Date(v);return Utilities.formatDate(d,Session.getScriptTimeZone()||'Asia/Jakarta','yyyy-MM-dd');}
function isoDateTime_(v){if(!v)return'';const d=v instanceof Date?v:new Date(v);return Utilities.formatDate(d,Session.getScriptTimeZone()||'Asia/Jakarta',"yyyy-MM-dd'T'HH:mm:ss");}
function dateParts_(v){if(!v)return{year:0,month:0};const d=v instanceof Date?v:new Date(String(v).slice(0,10)+'T00:00:00');return{year:d.getFullYear(),month:d.getMonth()+1};}

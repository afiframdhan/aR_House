const SHEETS = {
  USERS: 'USERS', SETTINGS: 'SETTINGS', ACCOUNTS: 'ACCOUNTS', CATEGORIES: 'CATEGORIES', TRANSACTIONS: 'TRANSACTIONS', SESSIONS: 'SESSIONS'
};

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ok:true,service:'AR Family Finance API'})).setMimeType(ContentService.MimeType.JSON);
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
    (function(){var p=${JSON.stringify(packet)}; try{parent.postMessage(p,${JSON.stringify(origin)});}catch(e){parent.postMessage(p,'*');}})();
  <\/script></body></html>`;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function route_(action, token, data) {
  if (action === 'login') return login_(data);
  if (action === 'session') return { user: requireSession_(token) };
  if (action === 'logout') return logout_(token);
  const user = requireSession_(token);
  if (action === 'bootstrap') return bootstrap_(user);
  if (action === 'dashboard') return dashboard_(data, user);
  if (action === 'transactions') return transactions_(data, user);
  if (action === 'addTransaction') return saveTransaction_(data, user, false);
  if (action === 'updateTransaction') return saveTransaction_(data, user, true);
  if (action === 'deleteTransaction') return deleteTransaction_(data, user);
  throw new Error('Action tidak dikenal.');
}

function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(SHEETS.USERS, ['ID','USERNAME','PASSWORD','NAME','ROLE','ACTIVE']);
  ensureSheet_(SHEETS.SETTINGS, ['KEY','VALUE']);
  ensureSheet_(SHEETS.ACCOUNTS, ['ID','BOOK','NAME','TYPE','OPENING_BALANCE','ACTIVE']);
  ensureSheet_(SHEETS.CATEGORIES, ['ID','BOOK','TYPE','NAME','ACTIVE']);
  ensureSheet_(SHEETS.TRANSACTIONS, ['ID','DATE','BOOK','TYPE','CATEGORY','DESCRIPTION','PARTY','FROM_ACCOUNT','TO_ACCOUNT','AMOUNT','METHOD','NOTE','CREATED_BY','CREATED_AT','UPDATED_AT']);
  ensureSheet_(SHEETS.SESSIONS, ['TOKEN','USERNAME','EXPIRES_AT','CREATED_AT']);

  seedIfEmpty_(SHEETS.USERS, [
    ['USR-001','admin','admin123','Administrator','ADMIN',true]
  ]);
  seedIfEmpty_(SHEETS.SETTINGS, [
    ['APP_NAME','AR Family Finance'],['GITHUB_ORIGIN','*'],['SESSION_HOURS','168'],['CURRENCY','IDR']
  ]);
  seedIfEmpty_(SHEETS.ACCOUNTS, [
    ['ACC-H-BANK','HOUSE','Rumah · Bank','BANK',0,true],['ACC-H-CASH','HOUSE','Rumah · Tunai','CASH',0,true],
    ['ACC-S-BANK','STUDIO','Studio · Bank','BANK',0,true],['ACC-S-CASH','STUDIO','Studio · Tunai','CASH',0,true]
  ]);
  seedIfEmpty_(SHEETS.CATEGORIES, defaultCategories_());
  formatSheets_();
  return 'Database siap.';
}

function defaultCategories_() {
  const rows=[]; let i=1;
  const add=(book,type,names)=>names.forEach(n=>rows.push(['CAT-'+String(i++).padStart(3,'0'),book,type,n,true]));
  add('HOUSE','INCOME',['Gaji tetap','Usaha studio','Penghasilan lainnya']);
  add('HOUSE','EXPENSE',['Belanja dapur','Tagihan rumah','Transportasi','Pendidikan','Kesehatan','Makan di luar','Cicilan','Hiburan','Lainnya']);
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
  const hours = Number(getSetting_('SESSION_HOURS')||168);
  const expires = new Date(Date.now()+hours*3600000);
  SpreadsheetApp.getActive().getSheetByName(SHEETS.SESSIONS).appendRow([token,u.USERNAME,expires,new Date()]);
  return { token, user:safeUser_(u) };
}

function logout_(token) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.SESSIONS); const vals=sh.getDataRange().getValues();
  for(let i=vals.length-1;i>=1;i--) if(String(vals[i][0])===String(token)) sh.deleteRow(i+1);
  return {ok:true};
}

function requireSession_(token) {
  if (!token) throw new Error('Session tidak tersedia. Silakan login ulang.');
  const sessions=sheetObjects_(SHEETS.SESSIONS); const s=sessions.find(x=>String(x.TOKEN)===String(token));
  if(!s || new Date(s.EXPIRES_AT).getTime()<Date.now()) throw new Error('Session berakhir. Silakan login ulang.');
  const u=sheetObjects_(SHEETS.USERS).find(x=>String(x.USERNAME)===String(s.USERNAME) && truthy_(x.ACTIVE));
  if(!u) throw new Error('User tidak aktif.');
  return safeUser_(u);
}

function safeUser_(u){ return { id:String(u.ID||''), username:String(u.USERNAME||''), name:String(u.NAME||u.USERNAME||''), role:String(u.ROLE||'USER').toUpperCase() }; }

function bootstrap_() {
  const accounts=sheetObjects_(SHEETS.ACCOUNTS).map(a=>({id:a.ID,book:a.BOOK,name:a.NAME,type:a.TYPE,openingBalance:Number(a.OPENING_BALANCE||0),active:truthy_(a.ACTIVE)}));
  const categories=sheetObjects_(SHEETS.CATEGORIES).map(c=>({id:c.ID,book:c.BOOK,type:c.TYPE,name:c.NAME,active:truthy_(c.ACTIVE)}));
  const tx=sheetObjects_(SHEETS.TRANSACTIONS); const years=[...new Set(tx.map(r=>dateParts_(r.DATE).year).filter(Boolean).concat([new Date().getFullYear()]))].sort((a,b)=>b-a);
  return {accounts,categories,years};
}

function transactions_(filters) {
  let tx = allTransactions_(); tx = applyFilters_(tx,filters);
  tx.sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return {transactions:tx};
}

function dashboard_(filters) {
  const all=allTransactions_(); const filtered=applyFilters_(all,filters);
  const income=sum_(filtered.filter(x=>x.type==='INCOME'),'amount');
  const expense=sum_(filtered.filter(x=>x.type==='EXPENSE'),'amount');
  const studioIncome=sum_(filtered.filter(x=>x.book==='STUDIO'&&x.type==='INCOME'),'amount');
  const studioExpense=sum_(filtered.filter(x=>x.book==='STUDIO'&&x.type==='EXPENSE'),'amount');
  const balances=calculateBalances_(all); const accountDefs=sheetObjects_(SHEETS.ACCOUNTS).filter(a=>truthy_(a.ACTIVE));
  const accounts=accountDefs.map(a=>({book:a.BOOK,name:a.NAME,type:a.TYPE,openingBalance:Number(a.OPENING_BALANCE||0),balance:Number(balances[a.NAME]||0)}));
  const year = Number(filters.year)||new Date().getFullYear();
  const trend=[]; for(let m=1;m<=12;m++){const mt=all.filter(t=>dateParts_(t.date).year===year&&dateParts_(t.date).month===m&&(filters.book==='ALL'||!filters.book||t.book===filters.book)); trend.push({label:['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][m-1],income:sum_(mt.filter(x=>x.type==='INCOME'),'amount'),expense:sum_(mt.filter(x=>x.type==='EXPENSE'),'amount')});}
  const catMap={}; filtered.filter(x=>x.type==='EXPENSE').forEach(x=>catMap[x.category]=(catMap[x.category]||0)+x.amount);
  const categories=Object.keys(catMap).map(k=>({name:k,amount:catMap[k]})).sort((a,b)=>b.amount-a.amount).slice(0,8);
  const recent=[...filtered].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,8);
  return {summary:{income,expense,net:income-expense,studioProfit:studioIncome-studioExpense},balances,accounts,trend,categories,recent};
}

function saveTransaction_(d,user,isUpdate) {
  validateTx_(d);
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.TRANSACTIONS); const now=new Date();
  if(isUpdate){
    const vals=sh.getDataRange().getValues(); const head=vals[0]; const idCol=head.indexOf('ID'); let row=-1;
    for(let i=1;i<vals.length;i++) if(String(vals[i][idCol])===String(d.id)){row=i+1;break;}
    if(row<0) throw new Error('Transaksi tidak ditemukan.');
    const createdBy=sh.getRange(row,head.indexOf('CREATED_BY')+1).getValue(); const createdAt=sh.getRange(row,head.indexOf('CREATED_AT')+1).getValue();
    sh.getRange(row,1,1,head.length).setValues([txRow_(d,d.id,createdBy||user.username,createdAt||now,now)]);
  } else {
    const id='TX-'+Utilities.getUuid().slice(0,8).toUpperCase(); sh.appendRow(txRow_(d,id,user.username,now,now));
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

function txRow_(d,id,createdBy,createdAt,updatedAt){return [id,new Date(d.date+'T00:00:00'),d.book,d.type,d.category,d.description,d.party||'',d.fromAccount||'',d.toAccount||'',Number(d.amount),d.method||'',d.note||'',createdBy,createdAt,updatedAt];}

function allTransactions_(){return sheetObjects_(SHEETS.TRANSACTIONS).map(r=>({id:String(r.ID||''),date:isoDate_(r.DATE),book:String(r.BOOK||''),type:String(r.TYPE||''),category:String(r.CATEGORY||''),description:String(r.DESCRIPTION||''),party:String(r.PARTY||''),fromAccount:String(r.FROM_ACCOUNT||''),toAccount:String(r.TO_ACCOUNT||''),amount:Number(r.AMOUNT||0),method:String(r.METHOD||''),note:String(r.NOTE||''),createdBy:String(r.CREATED_BY||''),createdAt:isoDateTime_(r.CREATED_AT),updatedAt:isoDateTime_(r.UPDATED_AT)}));}

function applyFilters_(tx,f){f=f||{};return tx.filter(t=>{const p=dateParts_(t.date);return(!f.book||f.book==='ALL'||t.book===f.book)&&(!f.year||Number(f.year)===p.year)&&(!f.month||f.month==='ALL'||Number(f.month)===p.month)&&(!f.type||f.type==='ALL'||t.type===f.type);});}

function calculateBalances_(tx){const bal={};sheetObjects_(SHEETS.ACCOUNTS).forEach(a=>bal[a.NAME]=Number(a.OPENING_BALANCE||0));tx.forEach(t=>{const n=Number(t.amount||0);if(t.type==='INCOME'&&t.toAccount)bal[t.toAccount]=(bal[t.toAccount]||0)+n;else if((t.type==='EXPENSE'||t.type==='PRIVE')&&t.fromAccount)bal[t.fromAccount]=(bal[t.fromAccount]||0)-n;else if(t.type==='TRANSFER'){if(t.fromAccount)bal[t.fromAccount]=(bal[t.fromAccount]||0)-n;if(t.toAccount)bal[t.toAccount]=(bal[t.toAccount]||0)+n;}});return bal;}

function importLegacyTransactions(){
  setupDatabase(); const ss=SpreadsheetApp.getActive(); const target=ss.getSheetByName(SHEETS.TRANSACTIONS); let count=0;
  [['Transaksi Rumah','HOUSE'],['Transaksi Studio','STUDIO']].forEach(pair=>{const sh=ss.getSheetByName(pair[0]); if(!sh)return; const vals=sh.getDataRange().getValues(); if(vals.length<2)return; const h=vals[0].map(x=>String(x).trim().toLowerCase()); const col=(names)=>{for(const n of names){const i=h.indexOf(n.toLowerCase());if(i>=0)return i;}return -1;};
    const ix={date:col(['Tanggal']),type:col(['Jenis']),cat:col(['Kategori']),desc:col(['Uraian / layanan','Uraian','Layanan']),party:col(['Klien / pihak','Klien','Pihak']),from:col(['Akun asal']),to:col(['Akun tujuan']),amount:col(['Nominal (Rp)','Nominal']),method:col(['Metode']),note:col(['Catatan'])};
    for(let r=1;r<vals.length;r++){if(!vals[r][ix.date]||!vals[r][ix.amount])continue; const d={date:isoDate_(vals[r][ix.date]),book:pair[1],type:normalizeType_(ix.type>=0?vals[r][ix.type]:''),category:ix.cat>=0?vals[r][ix.cat]:'Lainnya',description:ix.desc>=0?vals[r][ix.desc]:'Impor data lama',party:ix.party>=0?vals[r][ix.party]:'',fromAccount:ix.from>=0?vals[r][ix.from]:'',toAccount:ix.to>=0?vals[r][ix.to]:'',amount:Number(vals[r][ix.amount]||0),method:ix.method>=0?vals[r][ix.method]:'',note:ix.note>=0?vals[r][ix.note]:''}; if(!d.type)d.type='EXPENSE'; const id='TX-'+Utilities.getUuid().slice(0,8).toUpperCase();target.appendRow(txRow_(d,id,'IMPORT',new Date(),new Date()));count++;}
  }); return count+' transaksi diimpor.';
}

function normalizeType_(v){v=String(v||'').toLowerCase();if(v.includes('pemasukan')||v.includes('income')||v.includes('pendapatan'))return'INCOME';if(v.includes('pengeluaran')||v.includes('expense')||v.includes('biaya'))return'EXPENSE';if(v.includes('transfer'))return'TRANSFER';if(v.includes('prive'))return'PRIVE';return'';}

function purgeSessions_(){const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.SESSIONS);const vals=sh.getDataRange().getValues();for(let i=vals.length-1;i>=1;i--)if(new Date(vals[i][2]).getTime()<Date.now())sh.deleteRow(i+1);}
function getSetting_(key){const r=sheetObjects_(SHEETS.SETTINGS).find(x=>String(x.KEY)===String(key));return r?r.VALUE:'';}
function sheetObjects_(name){const sh=SpreadsheetApp.getActive().getSheetByName(name);if(!sh)return[];const vals=sh.getDataRange().getValues();if(vals.length<2)return[];const h=vals[0].map(String);return vals.slice(1).filter(r=>r.some(v=>v!==''&&v!==null)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])));}
function ensureSheet_(name,headers){const ss=SpreadsheetApp.getActive();let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0)sh.getRange(1,1,1,headers.length).setValues([headers]);return sh;}
function seedIfEmpty_(name,rows){const sh=SpreadsheetApp.getActive().getSheetByName(name);if(sh.getLastRow()<=1&&rows.length)sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);}
function formatSheets_(){Object.values(SHEETS).forEach(n=>{const sh=SpreadsheetApp.getActive().getSheetByName(n);if(!sh)return;sh.setFrozenRows(1);sh.getRange(1,1,1,sh.getLastColumn()).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');sh.autoResizeColumns(1,sh.getLastColumn());});}
function truthy_(v){return v===true||String(v).toLowerCase()==='true'||String(v)==='1'||String(v).toLowerCase()==='yes';}
function sum_(arr,key){return arr.reduce((a,x)=>a+Number(x[key]||0),0);}
function isoDate_(v){if(!v)return'';const d=v instanceof Date?v:new Date(v);return Utilities.formatDate(d,Session.getScriptTimeZone()||'Asia/Jakarta','yyyy-MM-dd');}
function isoDateTime_(v){if(!v)return'';const d=v instanceof Date?v:new Date(v);return Utilities.formatDate(d,Session.getScriptTimeZone()||'Asia/Jakarta',"yyyy-MM-dd'T'HH:mm:ss");}
function dateParts_(v){if(!v)return{year:0,month:0};const d=v instanceof Date?v:new Date(String(v).slice(0,10)+'T00:00:00');return{year:d.getFullYear(),month:d.getMonth()+1};}

(() => {
  'use strict';
  const API_URL = window.AR_FINANCE_CONFIG?.API_URL || '';
  const state = { token: localStorage.getItem('arFinanceToken') || '', user:null, meta:null, transactions:[], dashboard:null, trendChart:null, categoryChart:null };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const rupiah = n => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n||0));
  const dateID = s => s ? new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(s+'T00:00:00')) : '-';
  const today = () => new Date().toISOString().slice(0,10);
  let bridgeCounter = 0;
  const pending = new Map();

  function toast(msg, type='ok'){ const el=$('#toast'); el.textContent=msg; el.className='toast show'+(type==='error'?' error':''); clearTimeout(el._t); el._t=setTimeout(()=>el.className='toast',2600); }

  window.addEventListener('message', e => {
    const d=e.data;
    if(!d || d.source!=='ar-finance-bridge' || !d.requestId) return;
    const p=pending.get(d.requestId); if(!p) return;
    pending.delete(d.requestId); p.cleanup();
    if(d.ok) p.resolve(d.data); else p.reject(new Error(d.error||'API error'));
  });

  function api(action, payload={}){
    if(!API_URL || API_URL.includes('PASTE_')) return Promise.reject(new Error('API_URL belum diisi di config.js'));
    return new Promise((resolve,reject)=>{
      const requestId='req_'+Date.now()+'_'+(++bridgeCounter);
      const iframe=document.createElement('iframe'); iframe.name='bridge_'+requestId; iframe.style.display='none';
      const form=document.createElement('form'); form.method='POST'; form.action=API_URL; form.target=iframe.name; form.style.display='none';
      const input=document.createElement('input'); input.type='hidden'; input.name='payload'; input.value=JSON.stringify({requestId,action,token:state.token,data:payload}); form.appendChild(input);
      document.body.append(iframe,form);
      const timer=setTimeout(()=>{pending.delete(requestId); cleanup(); reject(new Error('Koneksi ke Apps Script timeout.'));},25000);
      const cleanup=()=>{clearTimeout(timer); form.remove(); setTimeout(()=>iframe.remove(),300);};
      pending.set(requestId,{resolve,reject,cleanup}); form.submit();
    });
  }

  async function login(username,password){
    const btn=$('#loginButton'); btn.disabled=true; btn.textContent='Memeriksa...';
    try{ const r=await api('login',{username,password}); state.token=r.token; state.user=r.user; localStorage.setItem('arFinanceToken',state.token); await bootstrap(); }
    catch(err){ toast(err.message,'error'); }
    finally{btn.disabled=false;btn.textContent='Masuk';}
  }
  async function logout(){ try{await api('logout');}catch(e){} localStorage.removeItem('arFinanceToken'); state.token=''; state.user=null; showLogin(); }
  function showLogin(){ $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
  function showApp(){ $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); $('#userName').textContent=state.user?.name||state.user?.username||'User'; $('#userRole').textContent=state.user?.role||'USER'; $('#userAvatar').textContent=(state.user?.name||state.user?.username||'A')[0].toUpperCase(); }

  async function bootstrap(){
    const session=await api('session'); state.user=session.user; showApp();
    const data=await api('bootstrap'); state.meta=data; fillFilters(); fillTransactionOptions(); await refreshAll();
  }

  function fillFilters(){
    const m=$('#monthFilter'); m.innerHTML='<option value="ALL">Semua Bulan</option>'+['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'].map((x,i)=>`<option value="${i+1}">${x}</option>`).join('');
    const y=$('#yearFilter'); const years=state.meta.years?.length?state.meta.years:[new Date().getFullYear()]; y.innerHTML=years.map(v=>`<option value="${v}">${v}</option>`).join(''); y.value=String(new Date().getFullYear());
  }
  function fillTransactionOptions(){ updateFormOptions(); }
  function updateFormOptions(){
    const book=$('#txBook').value, type=$('#txType').value;
    const cats=(state.meta?.categories||[]).filter(c=>c.book===book && (c.type===type || c.type==='ALL') && c.active);
    $('#txCategory').innerHTML=cats.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('') || '<option value="Lainnya">Lainnya</option>';
    const accts=(state.meta?.accounts||[]).filter(a=>a.book===book && a.active);
    const opts='<option value="">— Tidak ada —</option>'+accts.map(a=>`<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
    $('#txFromAccount').innerHTML=opts; $('#txToAccount').innerHTML=opts;
    const hints={INCOME:'Pemasukan: pilih Akun Tujuan.',EXPENSE:'Pengeluaran: pilih Akun Asal.',TRANSFER:'Transfer: pilih Akun Asal dan Akun Tujuan.',PRIVE:'Prive: pilih Akun Asal Studio.'};
    $('#transactionRuleHint').textContent=hints[type]||'';
  }

  function currentFilters(){ return {book:$('#bookFilter').value,month:$('#monthFilter').value,year:$('#yearFilter').value,type:$('#typeFilter')?.value||'ALL'}; }
  async function refreshAll(){
    try{
      const f=currentFilters(); const [dash,txs]=await Promise.all([api('dashboard',f),api('transactions',f)]); state.dashboard=dash; state.transactions=txs.transactions; renderDashboard(); renderTransactions(); renderAccounts();
    }catch(err){ if(/session/i.test(err.message)){ localStorage.removeItem('arFinanceToken'); showLogin(); } toast(err.message,'error'); }
  }

  function renderDashboard(){
    const d=state.dashboard;
    const cards=[
      ['Pemasukan',d.summary.income,'positive','Periode terpilih'],['Pengeluaran',d.summary.expense,'negative','Periode terpilih'],['Arus Kas Bersih',d.summary.net,d.summary.net>=0?'positive':'negative','Pemasukan − pengeluaran'],['Laba Studio',d.summary.studioProfit,d.summary.studioProfit>=0?'positive':'negative','Pendapatan − biaya operasional'],
      ['Bank Rumah',d.balances['Rumah · Bank']||0,'','Saldo berjalan'],['Tunai Rumah',d.balances['Rumah · Tunai']||0,'','Saldo berjalan'],['Bank Studio',d.balances['Studio · Bank']||0,'','Saldo berjalan'],['Tunai Studio',d.balances['Studio · Tunai']||0,'','Saldo berjalan']
    ];
    $('#kpiGrid').innerHTML=cards.map(c=>`<article class="kpi ${c[2]}"><div class="label">${c[0]}</div><div class="value">${rupiah(c[1])}</div><div class="sub">${c[3]}</div></article>`).join('');
    $('#accountBalances').innerHTML=d.accounts.map(a=>`<div class="account-row"><div><span class="name">${esc(a.name)}</span><span class="book">${a.book==='HOUSE'?'RUMAH TANGGA':'AR STUDIO'}</span></div><strong>${rupiah(a.balance)}</strong></div>`).join('');
    $('#recentTransactions').innerHTML=d.recent.map(tx=>`<tr><td>${dateID(tx.date)}</td><td><span class="badge ${tx.book}">${tx.book==='HOUSE'?'Rumah':'Studio'}</span></td><td>${typeLabel(tx.type)}</td><td>${esc(tx.description||tx.category)}</td><td class="money ${tx.type.toLowerCase()}">${tx.type==='INCOME'?'+':tx.type==='TRANSFER'?'':'−'} ${rupiah(tx.amount)}</td></tr>`).join('') || '<tr><td colspan="5">Belum ada transaksi.</td></tr>';
    drawCharts(d);
  }
  function drawCharts(d){
    if(state.trendChart) state.trendChart.destroy(); if(state.categoryChart) state.categoryChart.destroy();
    state.trendChart=new Chart($('#trendChart'),{type:'bar',data:{labels:d.trend.map(x=>x.label),datasets:[{label:'Pemasukan',data:d.trend.map(x=>x.income),borderWidth:0,borderRadius:6},{label:'Pengeluaran',data:d.trend.map(x=>x.expense),borderWidth:0,borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{x:{grid:{display:false}},y:{ticks:{callback:v=>new Intl.NumberFormat('id-ID',{notation:'compact'}).format(v)}}}}});
    state.categoryChart=new Chart($('#categoryChart'),{type:'doughnut',data:{labels:d.categories.map(x=>x.name),datasets:[{data:d.categories.map(x=>x.amount),borderWidth:3,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:10}}},cutout:'68%'}});
  }
  function renderTransactions(){
    const q=($('#transactionSearch')?.value||'').toLowerCase(); const type=$('#typeFilter')?.value||'ALL';
    let txs=state.transactions.filter(t=>(type==='ALL'||t.type===type) && (!q||[t.description,t.category,t.party,t.note].join(' ').toLowerCase().includes(q)));
    $('#transactionsTable').innerHTML=txs.map(tx=>`<tr><td>${dateID(tx.date)}</td><td><span class="badge ${tx.book}">${tx.book==='HOUSE'?'Rumah':'Studio'}</span></td><td>${typeLabel(tx.type)}</td><td>${esc(tx.category)}</td><td>${esc(tx.description)}</td><td>${esc(tx.fromAccount||tx.toAccount||'-')}</td><td class="money ${tx.type.toLowerCase()}">${rupiah(tx.amount)}</td><td><div class="row-actions"><button class="mini-btn" data-edit="${tx.id}">Edit</button>${state.user?.role==='ADMIN'?`<button class="mini-btn" data-delete="${tx.id}">Hapus</button>`:''}</div></td></tr>`).join('') || '<tr><td colspan="8">Tidak ada transaksi.</td></tr>';
  }
  function renderAccounts(){
    const a=state.dashboard?.accounts||[]; $('#accountCards').innerHTML=a.map(x=>`<div class="account-card"><div class="meta">${x.book==='HOUSE'?'RUMAH TANGGA':'AR STUDIO'} · ${esc(x.type)}</div><div><b>${esc(x.name)}</b></div><div class="balance">${rupiah(x.balance)}</div><div class="meta">Saldo awal ${rupiah(x.openingBalance)}</div></div>`).join('');
  }

  function openTransaction(tx=null){
    $('#transactionModalTitle').textContent=tx?'Edit Transaksi':'Tambah Transaksi'; $('#txId').value=tx?.id||''; $('#txDate').value=tx?.date||today(); $('#txBook').value=tx?.book||'HOUSE'; $('#txType').value=tx?.type||'EXPENSE'; updateFormOptions();
    if(tx){ $('#txCategory').value=tx.category; $('#txDescription').value=tx.description||''; $('#txParty').value=tx.party||''; $('#txMethod').value=tx.method||'Transfer'; $('#txFromAccount').value=tx.fromAccount||''; $('#txToAccount').value=tx.toAccount||''; $('#txAmount').value=tx.amount||''; $('#txNote').value=tx.note||''; }
    else { $('#txDescription').value='';$('#txParty').value='';$('#txAmount').value='';$('#txNote').value=''; }
    $('#transactionDialog').showModal();
  }
  async function saveTransaction(){
    const tx={id:$('#txId').value,date:$('#txDate').value,book:$('#txBook').value,type:$('#txType').value,category:$('#txCategory').value,description:$('#txDescription').value.trim(),party:$('#txParty').value.trim(),fromAccount:$('#txFromAccount').value,toAccount:$('#txToAccount').value,amount:Number($('#txAmount').value||0),method:$('#txMethod').value,note:$('#txNote').value.trim()};
    const btn=$('#saveTransactionBtn');btn.disabled=true;
    try{await api(tx.id?'updateTransaction':'addTransaction',tx);$('#transactionDialog').close();toast('Transaksi disimpan.');await refreshAll();}
    catch(e){toast(e.message,'error');}finally{btn.disabled=false;}
  }
  async function deleteTransaction(id){ if(!confirm('Hapus transaksi ini?')) return; try{await api('deleteTransaction',{id});toast('Transaksi dihapus.');await refreshAll();}catch(e){toast(e.message,'error');} }

  function switchPage(page){ $$('.page').forEach(x=>x.classList.add('hidden')); $('#'+page+'Page').classList.remove('hidden'); $$('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.page===page)); const title={dashboard:'Dashboard',transactions:'Transaksi',accounts:'Akun & Saldo'}; $('#pageTitle').textContent=title[page]||'Dashboard'; $('#sidebar').classList.remove('open'); }
  function typeLabel(t){ return ({INCOME:'Pemasukan',EXPENSE:'Pengeluaran',TRANSFER:'Transfer',PRIVE:'Prive'})[t]||t; }
  function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  $('#loginForm').addEventListener('submit',e=>{e.preventDefault();login($('#loginUsername').value.trim(),$('#loginPassword').value);});
  $('#logoutBtn').addEventListener('click',logout); $('#addTransactionBtn').addEventListener('click',()=>openTransaction()); $('#closeModalBtn').addEventListener('click',()=>$('#transactionDialog').close()); $('#cancelModalBtn').addEventListener('click',()=>$('#transactionDialog').close());
  $('#transactionForm').addEventListener('submit',e=>{e.preventDefault();saveTransaction();}); $('#txBook').addEventListener('change',updateFormOptions); $('#txType').addEventListener('change',updateFormOptions);
  ['bookFilter','monthFilter','yearFilter'].forEach(id=>$('#'+id).addEventListener('change',refreshAll)); $('#typeFilter').addEventListener('change',renderTransactions); $('#transactionSearch').addEventListener('input',renderTransactions);
  $$('.nav-link').forEach(b=>b.addEventListener('click',()=>switchPage(b.dataset.page))); $$('[data-go]').forEach(b=>b.addEventListener('click',()=>switchPage(b.dataset.go))); $('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#transactionsTable').addEventListener('click',e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]'); if(edit){const tx=state.transactions.find(x=>x.id===edit.dataset.edit);if(tx)openTransaction(tx);} if(del)deleteTransaction(del.dataset.delete);});

  (async()=>{ if(state.token){ try{await bootstrap();}catch(e){localStorage.removeItem('arFinanceToken');state.token='';showLogin();} } else showLogin(); })();
})();

(() => {
  'use strict';
  const API_URL = window.AR_FINANCE_CONFIG?.API_URL || '';
  const CACHE_KEY='arFinanceCacheV15', TOKEN_KEY='arFinanceToken';
  const state={token:localStorage.getItem(TOKEN_KEY)||'',user:null,meta:null,dashboards:{},transactions:[],routines:[],savings:null,page:'overall',charts:{},pendingPhoto:undefined,routineMode:localStorage.getItem('arRoutineMode')||'ALL',routineView:localStorage.getItem('arRoutineView')||'CARD',categoryBook:'ALL',categoryType:'ALL'};
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const rupiah=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n||0));
  const dateID=s=>s?new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(s+'T00:00:00')):'-';
  const today=()=>new Date().toISOString().slice(0,10);
  const currentMonth=()=>new Date().getMonth()+1;
  const currentYear=()=>new Date().getFullYear();
  let bridgeCounter=0; const pending=new Map();

  function toast(msg,type='ok'){const el=$('#toast');el.textContent=msg;el.className='toast show'+(type==='error'?' error':'');clearTimeout(el._t);el._t=setTimeout(()=>el.className='toast',2700);}
  function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function typeLabel(t){return ({INCOME:'Pemasukan',EXPENSE:'Pengeluaran',TRANSFER:'Transfer',PRIVE:'Prive'})[t]||t;}

  const chartPalette=['#2563eb','#16a34a','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#eab308','#ec4899','#14b8a6','#6366f1'];
  const fixedChartColors={
    'belanja dapur':'#16a34a','tagihan rumah':'#2563eb','transportasi':'#f59e0b','pendidikan':'#8b5cf6','kesehatan':'#ef4444','makan di luar':'#f97316','cicilan':'#6366f1','hiburan':'#ec4899','internet & telepon':'#06b6d4','listrik':'#eab308','air':'#14b8a6','iuran':'#84cc16','lainnya':'#64748b',
    'saving':'#2563eb','investasi':'#16a34a','jajan & jalan-jalan':'#f97316','jajan & jalan jalan':'#f97316','sedekah':'#8b5cf6','sisa tidak dialokasikan':'#94a3b8'
  };
  function normalizeChartLabel(label=''){return String(label).trim().toLowerCase().replace(/\s+/g,' ');}
  function colorForLabel(label='',book='',type='EXPENSE'){
    const custom=(state.meta?.categories||[]).find(c=>normalizeChartLabel(c.name)===normalizeChartLabel(label)&&(!book||c.book===book)&&(!type||c.type===type));
    if(custom?.color&&/^#[0-9a-f]{6}$/i.test(custom.color))return custom.color;
    const key=normalizeChartLabel(label);if(fixedChartColors[key])return fixedChartColors[key];
    let h=0;for(let i=0;i<key.length;i++)h=((h<<5)-h)+key.charCodeAt(i);return chartPalette[Math.abs(h)%chartPalette.length];
  }
  function getChartColors(labels=[],book='',type='EXPENSE'){return labels.map(label=>colorForLabel(label,book,type));}
  function renderChartLegend(el,labels,values,colors){
    if(!el)return;const total=values.reduce((a,v)=>a+Number(v||0),0);
    el.innerHTML=labels.map((label,i)=>{const val=Number(values[i]||0),pct=total>0?(val/total*100):0;return `<div class="chart-legend-item"><span class="chart-dot" style="background:${colors[i]}"></span><span class="chart-legend-name">${esc(label)}</span><strong>${rupiah(val)}</strong><small>${pct.toLocaleString('id-ID',{maximumFractionDigits:1})}%</small></div>`;}).join('');
  }

  window.addEventListener('message',e=>{const d=e.data;if(!d||d.source!=='ar-finance-bridge'||!d.requestId)return;const p=pending.get(d.requestId);if(!p)return;pending.delete(d.requestId);p.cleanup();d.ok?p.resolve(d.data):p.reject(new Error(d.error||'API error'));});
  function api(action,data={}){
    if(!API_URL||API_URL.includes('PASTE_'))return Promise.reject(new Error('API_URL belum diisi di config.js'));
    return new Promise((resolve,reject)=>{
      const requestId='req_'+Date.now()+'_'+(++bridgeCounter), iframe=document.createElement('iframe'), form=document.createElement('form');
      iframe.name='bridge_'+requestId;iframe.style.display='none';form.method='POST';form.action=API_URL;form.target=iframe.name;form.style.display='none';
      const input=document.createElement('input');input.type='hidden';input.name='payload';input.value=JSON.stringify({requestId,action,token:state.token,data});form.appendChild(input);document.body.append(iframe,form);
      const cleanup=()=>{clearTimeout(timer);setTimeout(()=>{iframe.remove();form.remove();},50);};
      const timer=setTimeout(()=>{pending.delete(requestId);cleanup();reject(new Error('Koneksi ke Apps Script timeout.'));},25000);
      pending.set(requestId,{resolve,reject,cleanup});form.submit();
    });
  }

  function dashboardTemplate(key,title){return `<div class="kpi-grid" id="kpi-${key}"></div><div class="chart-grid"><article class="panel span-2"><div class="panel-head"><div><p class="eyebrow">12 BULAN</p><h3>Arus Kas ${title}</h3></div></div><div class="chart-wrap"><canvas id="trend-${key}"></canvas></div></article><article class="panel"><div class="panel-head"><div><p class="eyebrow">KATEGORI</p><h3>Pengeluaran</h3></div></div><div class="chart-wrap"><canvas id="cat-${key}"></canvas></div><div id="catLegend-${key}" class="chart-legend-list"></div></article></div><div class="content-grid"><article class="panel"><div class="panel-head"><div><p class="eyebrow">SALDO</p><h3>Akun</h3></div></div><div id="balances-${key}" class="account-list"></div></article><article class="panel span-2"><div class="panel-head"><div><p class="eyebrow">TERBARU</p><h3>Transaksi Terakhir</h3></div><button class="text-btn" data-go="transactions">Lihat semua</button></div><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Buku</th><th>Jenis</th><th>Uraian</th><th>Nominal</th></tr></thead><tbody id="recent-${key}"></tbody></table></div></article></div>`;}
  $('#overallPage').innerHTML=dashboardTemplate('ALL','Keseluruhan');
  $('#studioPage').innerHTML=dashboardTemplate('STUDIO','AR Studio');
  $('#housePage').innerHTML=dashboardTemplate('HOUSE','Rumah Tangga');

  function saveCache(){try{localStorage.setItem(CACHE_KEY,JSON.stringify({user:state.user,meta:state.meta,dashboards:state.dashboards,transactions:state.transactions,routines:state.routines,savings:state.savings,month:$('#monthFilter')?.value||String(currentMonth()),year:$('#yearFilter')?.value||String(currentYear())}));}catch(e){}}
  function loadCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'null');}catch(e){return null;}}
  function applyData(data,fromCache=false){
    if(data.user)state.user=data.user;if(data.meta)state.meta=data.meta;if(data.dashboards)state.dashboards=data.dashboards;
    if(data.transactions)state.transactions=data.transactions.transactions||[];if(data.routines)state.routines=data.routines||[];if(data.savings)state.savings=data.savings;
    if(!fromCache)saveCache();renderAll();
  }

  function showApp(){ $('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');applyUserVisuals(); }
  function showLogin(){ $('#appView').classList.add('hidden');$('#loginView').classList.remove('hidden'); }
  function applyUserVisuals(){
    const u=state.user||{};$('#userName').textContent=u.name||u.username||'User';$('#userRole').textContent=u.role||'USER';
    const initial=(u.name||u.username||'A').trim().charAt(0).toUpperCase(); const av=$('#userAvatar');av.textContent=u.photo?'':initial;av.style.backgroundImage=u.photo?`url(${u.photo})`:'';
    $('#profileDisplayName').textContent=u.name||u.username||'User';$('#profileDisplayUser').textContent='@'+(u.username||'');$('#profileName').value=u.name||'';$('#profileUsername').value=u.username||'';
    const pp=$('#profilePhotoPreview');pp.textContent=u.photo?'':initial;pp.style.backgroundImage=u.photo?`url(${u.photo})`:'';
  }

  async function login(username,password){const btn=$('#loginButton');btn.disabled=true;btn.textContent='Memuat...';try{const data=await api('login',{username,password});state.token=data.token;localStorage.setItem(TOKEN_KEY,state.token);applyData(data);fillFilters();showApp();switchPage('overall');toast('Login berhasil.');}catch(e){toast(e.message,'error');}finally{btn.disabled=false;btn.textContent='Masuk';}}
  async function logout(){try{await api('logout');}catch(e){}localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(CACHE_KEY);state.token='';showLogin();}

  function fillFilters(cached){
    const m=$('#monthFilter');const months=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];m.innerHTML='<option value="ALL">Semua Bulan</option>'+months.map((x,i)=>`<option value="${i+1}">${x}</option>`).join('');m.value=String(cached?.month||currentMonth());
    const years=state.meta?.years?.length?state.meta.years:[currentYear()];$('#yearFilter').innerHTML=years.map(v=>`<option value="${v}">${v}</option>`).join('');$('#yearFilter').value=String(cached?.year||currentYear());
    fillTransactionOptions();fillRoutineOptions();fillSavingOptions();
  }
  function currentPeriod(){return {month:$('#monthFilter').value,year:$('#yearFilter').value};}
  async function refreshData(){
    const filters={book:'ALL',...currentPeriod()};
    try{const data=await api('sync',filters);applyData(data);}catch(e){if(/session|user tidak aktif|username berubah/i.test(e.message)){localStorage.removeItem(TOKEN_KEY);state.token='';showLogin();}toast(e.message,'error');}
  }

  function renderAll(){applyUserVisuals();['ALL','HOUSE','STUDIO'].forEach(renderDashboard);renderTransactions();renderRoutines();renderSavings();renderAccounts();renderCategories();}
  function renderDashboard(key){
    const d=state.dashboards?.[key];if(!d)return;
    let cards;
    if(key==='STUDIO')cards=[['Pemasukan Studio',d.summary.income,'positive','Periode terpilih'],['Biaya Studio',d.summary.expense,'negative','Periode terpilih'],['Laba Studio',d.summary.studioProfit,d.summary.studioProfit>=0?'positive':'negative','Pendapatan − biaya'],['Saldo Studio',(d.balances['Studio · Bank']||0)+(d.balances['Studio · Tunai']||0),'','Bank + Tunai']];
    else if(key==='HOUSE')cards=[['Pemasukan Rumah',d.summary.income,'positive','Periode terpilih'],['Pengeluaran Rumah',d.summary.expense,'negative','Periode terpilih'],['Sisa Bulanan',d.summary.houseNet,d.summary.houseNet>=0?'positive':'negative','Pemasukan − pengeluaran'],['Saldo Rumah',(d.balances['Rumah · Bank']||0)+(d.balances['Rumah · Tunai']||0),'','Bank + Tunai']];
    else cards=[['Total Pemasukan',d.summary.income,'positive','Periode terpilih'],['Total Pengeluaran',d.summary.expense,'negative','Periode terpilih'],['Arus Kas Bersih',d.summary.net,d.summary.net>=0?'positive':'negative','Pemasukan − pengeluaran'],['Laba AR Studio',d.summary.studioProfit,d.summary.studioProfit>=0?'positive':'negative','Pendapatan − biaya studio']];
    $(`#kpi-${key}`).innerHTML=cards.map(c=>`<article class="kpi ${c[2]}"><div class="label">${c[0]}</div><div class="value">${rupiah(c[1])}</div><div class="sub">${c[3]}</div></article>`).join('');
    const accounts=d.accounts.filter(a=>key==='ALL'||a.book===key);$(`#balances-${key}`).innerHTML=accounts.map(a=>`<div class="account-row"><div><span class="name">${esc(a.name)}</span><span class="book">${a.book==='HOUSE'?'RUMAH TANGGA':'AR STUDIO'}</span></div><strong>${rupiah(a.balance)}</strong></div>`).join('');
    $(`#recent-${key}`).innerHTML=d.recent.map(tx=>`<tr><td>${dateID(tx.date)}</td><td><span class="badge ${tx.book}">${tx.book==='HOUSE'?'Rumah':'Studio'}</span></td><td>${typeLabel(tx.type)}</td><td>${esc(tx.description||tx.category)}</td><td class="money ${tx.type.toLowerCase()}">${tx.type==='INCOME'?'+':tx.type==='TRANSFER'?'':'−'} ${rupiah(tx.amount)}</td></tr>`).join('')||'<tr><td colspan="5">Belum ada transaksi.</td></tr>';
    drawCharts(key,d);
  }
  function drawCharts(key,d){
    if(typeof Chart==='undefined')return;if(state.charts['trend'+key])state.charts['trend'+key].destroy();if(state.charts['cat'+key])state.charts['cat'+key].destroy();
    state.charts['trend'+key]=new Chart($(`#trend-${key}`),{type:'bar',data:{labels:d.trend.map(x=>x.label),datasets:[{label:'Pemasukan',data:d.trend.map(x=>x.income),borderWidth:0,borderRadius:6},{label:'Pengeluaran',data:d.trend.map(x=>x.expense),borderWidth:0,borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom'}},scales:{x:{grid:{display:false}},y:{ticks:{callback:v=>new Intl.NumberFormat('id-ID',{notation:'compact'}).format(v)}}}}});
    const catLabels=d.categories.map(x=>x.name);const catValues=d.categories.map(x=>x.amount);const catColors=d.categories.map(x=>x.color||colorForLabel(x.name,key==='ALL'?'':key,'EXPENSE'));
    state.charts['cat'+key]=new Chart($(`#cat-${key}`),{type:'doughnut',data:{labels:catLabels,datasets:[{data:catValues,backgroundColor:catColors,hoverBackgroundColor:catColors,borderWidth:3,borderColor:'#fff',hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${rupiah(ctx.raw)}`}}},cutout:'68%'}});
    renderChartLegend($(`#catLegend-${key}`),catLabels,catValues,catColors);
  }

  function renderTransactions(){const q=($('#transactionSearch')?.value||'').toLowerCase(),type=$('#typeFilter')?.value||'ALL',book=$('#bookFilter')?.value||'ALL';const txs=state.transactions.filter(t=>(type==='ALL'||t.type===type)&&(book==='ALL'||t.book===book)&&(!q||[t.description,t.category,t.party,t.note].join(' ').toLowerCase().includes(q)));$('#transactionsTable').innerHTML=txs.map(tx=>`<tr><td>${dateID(tx.date)}</td><td><span class="badge ${tx.book}">${tx.book==='HOUSE'?'Rumah':'Studio'}</span></td><td>${typeLabel(tx.type)}</td><td>${esc(tx.category)}</td><td>${esc(tx.description)}</td><td>${esc(tx.fromAccount||tx.toAccount||'-')}</td><td class="money ${tx.type.toLowerCase()}">${rupiah(tx.amount)}</td><td><div class="row-actions"><button class="mini-btn" data-edit="${tx.id}">Edit</button>${state.user?.role==='ADMIN'?`<button class="mini-btn" data-delete="${tx.id}">Hapus</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="8">Tidak ada transaksi.</td></tr>';}
  function renderAccounts(){const a=state.dashboards?.ALL?.accounts||[];$('#accountCards').innerHTML=a.map(x=>`<div class="account-card"><div class="meta">${x.book==='HOUSE'?'RUMAH TANGGA':'AR STUDIO'} · ${esc(x.type)}</div><div><b>${esc(x.name)}</b></div><div class="balance">${rupiah(x.balance)}</div><div class="meta">Saldo awal ${rupiah(x.openingBalance)}</div></div>`).join('');}

  function routineActions(r){return `${r.active&&!r.paid?`<button class="mini-btn pay" data-pay-routine="${r.id}">Tandai Dibayar</button>`:''}<button class="mini-btn" data-edit-routine="${r.id}">Edit</button>${state.user?.role==='ADMIN'?`<button class="mini-btn" data-delete-routine="${r.id}">Hapus</button>`:''}`;}
  function renderRoutines(){
    const active=state.routines.filter(r=>r.active);
    const cash=active.filter(r=>r.paymentMode==='CASH_ATM');
    const online=active.filter(r=>r.paymentMode==='ONLINE');
    const unpaid=active.filter(r=>!r.paid),paid=active.filter(r=>r.paid);
    const sum=list=>list.reduce((a,r)=>a+Number(r.amount||0),0);
    const cashNeed=sum(cash.filter(r=>!r.paid)),onlineNeed=sum(online.filter(r=>!r.paid));
    const cashPlan=sum(cash),onlinePlan=sum(online),unpaidTotal=sum(unpaid),paidTotal=sum(paid);
    $('#routineFundCards').innerHTML=`
      <article class="fund-card cash"><div class="fund-icon">ATM</div><div><span class="fund-label">Ambil dari ATM</span><strong>${rupiah(cashNeed)}</strong><small>Total rencana Cash/ATM ${rupiah(cashPlan)}</small></div></article>
      <article class="fund-card online"><div class="fund-icon">↗</div><div><span class="fund-label">Transfer ke Rekening Online</span><strong>${rupiah(onlineNeed)}</strong><small>Total rencana Online ${rupiah(onlinePlan)}</small></div></article>
      <article class="fund-card total"><div class="fund-icon">Σ</div><div><span class="fund-label">Dana Belum Disiapkan / Dibayar</span><strong>${rupiah(unpaidTotal)}</strong><small>${unpaid.length} pengeluaran belum dibayar</small></div></article>
      <article class="fund-card paid"><div class="fund-icon">✓</div><div><span class="fund-label">Sudah Dibayar</span><strong>${rupiah(paidTotal)}</strong><small>${paid.length} pengeluaran selesai</small></div></article>`;

    $$('#routineModeFilter [data-routine-mode]').forEach(b=>b.classList.toggle('active',b.dataset.routineMode===state.routineMode));
    $$('#routineViewToggle [data-routine-view]').forEach(b=>b.classList.toggle('active',b.dataset.routineView===state.routineView));
    const filtered=state.routines.filter(r=>state.routineMode==='ALL'||r.paymentMode===state.routineMode);
    const filteredActive=filtered.filter(r=>r.active),filteredUnpaid=filteredActive.filter(r=>!r.paid);
    $('#routineSummary').innerHTML=`<span class="summary-pill">Ditampilkan <b>${filtered.length}</b></span><span class="summary-pill">Aktif <b>${filteredActive.length}</b></span><span class="summary-pill">Belum dibayar <b>${filteredUnpaid.length}</b></span><span class="summary-pill">Total aktif <b>${rupiah(sum(filteredActive))}</b></span><span class="summary-pill">Sisa perlu disiapkan <b>${rupiah(sum(filteredUnpaid))}</b></span>`;

    $('#routineGrid').classList.toggle('hidden',state.routineView!=='CARD');
    $('#routineTableWrap').classList.toggle('hidden',state.routineView!=='TABLE');
    $('#routineGrid').innerHTML=filtered.map(r=>`<article class="routine-card ${r.active?'':'inactive'}"><div class="routine-top"><div><span class="status-badge ${r.paid?'paid':'unpaid'}">${r.paid?'Sudah Dibayar':'Belum Dibayar'}</span><h4>${esc(r.description)}</h4><span class="tiny muted">${esc(r.category)}</span></div><span class="payment-badge ${r.paymentMode==='CASH_ATM'?'cash':'online'}">${r.paymentMode==='CASH_ATM'?'Cash / ATM':'Online'}</span></div><div class="routine-amount">${rupiah(r.amount)}</div><div class="routine-meta"><span>Jatuh tempo tanggal ${r.dueDay}</span><span>${esc(r.fromAccount||'-')}</span>${r.paid?`<span>Dibayar ${dateID(r.paidDate)}</span>`:''}</div><div class="routine-actions">${routineActions(r)}</div></article>`).join('')||'<article class="panel empty-routine">Tidak ada pengeluaran rutin pada filter ini.</article>';
    $('#routineTable').innerHTML=filtered.map(r=>`<tr class="${r.active?'':'inactive-row'}"><td><span class="status-badge ${r.paid?'paid':'unpaid'}">${r.paid?'Sudah Dibayar':'Belum Dibayar'}</span></td><td><strong>${esc(r.description)}</strong><div class="tiny muted">${esc(r.category)}</div></td><td><span class="payment-badge ${r.paymentMode==='CASH_ATM'?'cash':'online'}">${r.paymentMode==='CASH_ATM'?'Cash / ATM':'Online'}</span></td><td>Tgl ${r.dueDay}</td><td>${esc(r.fromAccount||'-')}</td><td class="align-right routine-table-amount">${rupiah(r.amount)}</td><td><div class="row-actions">${routineActions(r)}</div></td></tr>`).join('')||'<tr><td colspan="7">Tidak ada pengeluaran rutin pada filter ini.</td></tr>';
  }

  function fillSavingOptions(){
    const accts=(state.meta?.accounts||[]).filter(a=>a.book==='HOUSE'&&a.active);
    const opts=accts.map(a=>`<option value="${esc(a.name)}">${esc(a.name)} · ${esc(a.type)}</option>`).join('');
    if($('#savingFromAccount'))$('#savingFromAccount').innerHTML=opts;
    if($('#savingToAccount'))$('#savingToAccount').innerHTML=opts;
  }
  function savingActions(p){return `${p.active&&p.remaining>0?`<button class="mini-btn transfer" data-transfer-saving="${p.id}">Transfer</button>`:''}<button class="mini-btn" data-edit-saving="${p.id}">Edit</button>${state.user?.role==='ADMIN'?`<button class="mini-btn" data-delete-saving="${p.id}">Hapus</button>`:''}`;}
  function renderSavings(){
    const d=state.savings;if(!d||!$('#savingFundCards'))return;
    const pct=Math.min(100,Number(d.totalPercent||0));
    $('#savingFundCards').innerHTML=`
      <article class="saving-kpi primary"><span class="label">Sisa Dana Rumah Tangga</span><strong>${rupiah(d.baseAmount)}</strong><small>Pemasukan − pengeluaran bulan terpilih</small></article>
      <article class="saving-kpi"><span class="label">Target Saving</span><strong>${rupiah(d.targetTotal)}</strong><small>${Number(d.totalPercent||0).toLocaleString('id-ID')}% dari sisa dana</small></article>
      <article class="saving-kpi accent"><span class="label">Sudah Dipindahkan</span><strong>${rupiah(d.transferredTotal)}</strong><small>Transfer ke rekening saving bulan ini</small></article>
      <article class="saving-kpi"><span class="label">Masih Harus Ditransfer</span><strong>${rupiah(d.remainingTotal)}</strong><small>Sisa tidak dialokasikan ${rupiah(d.unallocated)}</small></article>`;
    $('#savingPercentBadge').innerHTML=`Total alokasi <b>${Number(d.totalPercent||0).toLocaleString('id-ID')}%</b>`;
    const plans=d.plans||[];
    $('#savingList').innerHTML=plans.map(p=>{const progress=p.target>0?Math.min(100,(p.transferred/p.target)*100):0;return `<div class="saving-row ${p.active?'':'inactive'}"><div><span class="saving-status ${p.remaining<=0&&p.target>0?'done':'pending'}">${p.remaining<=0&&p.target>0?'Terpenuhi':'Belum penuh'}</span><h4>${esc(p.name)}</h4><div class="tiny muted">${esc(p.fromAccount)} → ${esc(p.toAccount)}</div><div class="saving-progress"><span style="width:${progress}%"></span></div></div><div class="saving-pct">${Number(p.percent||0).toLocaleString('id-ID')}%</div><div class="saving-money"><small>Target</small><strong>${rupiah(p.target)}</strong></div><div class="saving-money"><small>Sudah / Sisa</small><strong>${rupiah(p.transferred)}</strong><small>Sisa ${rupiah(p.remaining)}</small></div><div class="saving-actions">${savingActions(p)}</div></div>`}).join('')||'<div class="saving-empty">Belum ada alokasi saving.</div>';
    const targets=plans.filter(p=>p.active&&p.percent>0);
    const accountMap={};targets.forEach(p=>{accountMap[p.toAccount]=(accountMap[p.toAccount]||0)+Number(p.remaining||0);});
    $('#savingAccountInfo').innerHTML=Object.entries(accountMap).map(([name,val])=>`<div class="saving-account-line"><b>${esc(name)}</b><br><span class="muted">Perlu ditransfer ${rupiah(val)}</span></div>`).join('')||'<div class="saving-account-line muted">Belum ada rekening tujuan aktif.</div>';
    if(typeof Chart!=='undefined'&&$('#savingChart')){if(state.charts.saving)state.charts.saving.destroy();const labels=targets.map(p=>p.name).concat(d.unallocated>0?['Sisa tidak dialokasikan']:[]);const values=targets.map(p=>p.target).concat(d.unallocated>0?[d.unallocated]:[]);const savingColors=getChartColors(labels);state.charts.saving=new Chart($('#savingChart'),{type:'doughnut',data:{labels,datasets:[{data:values,backgroundColor:savingColors,hoverBackgroundColor:savingColors,borderWidth:3,borderColor:'#fff',hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${rupiah(ctx.raw)}`}}},cutout:'64%'}});renderChartLegend($('#savingLegend'),labels,values,savingColors);}
  }
  function openSaving(p=null){
    $('#savingModalTitle').textContent=p?'Edit Alokasi Saving':'Tambah Alokasi Saving';$('#savingId').value=p?.id||'';$('#savingName').value=p?.name||'';$('#savingPercent').value=p?.percent??10;$('#savingActive').checked=p?!!p.active:true;$('#savingNote').value=p?.note||'';fillSavingOptions();$('#savingFromAccount').value=p?.fromAccount||'Rumah · Bank';$('#savingToAccount').value=p?.toAccount||'Rumah · Tabungan';$('#savingDialog').showModal();
  }
  async function saveSaving(){const d={id:$('#savingId').value,name:$('#savingName').value.trim(),percent:Number($('#savingPercent').value||0),fromAccount:$('#savingFromAccount').value,toAccount:$('#savingToAccount').value,active:$('#savingActive').checked,note:$('#savingNote').value.trim()};try{await api('saveSaving',d);$('#savingDialog').close();toast('Alokasi saving disimpan.');await refreshData();}catch(e){toast(e.message,'error');}}
  async function transferSaving(id){const p=(state.savings?.plans||[]).find(x=>x.id===id);if(!p)return;const suggested=Math.max(0,Number(p.remaining||0));if(!(suggested>0)){toast('Target saving ini sudah terpenuhi.');return;}const raw=prompt(`Nominal transfer untuk ${p.name}:`,String(Math.round(suggested)));if(raw===null)return;const amount=Number(String(raw).replace(/[^0-9.-]/g,''));if(!(amount>0)){toast('Nominal tidak valid.','error');return;}const per=currentPeriod(),month=per.month==='ALL'?currentMonth():Number(per.month);try{await api('transferSaving',{id,amount,month,year:Number(per.year)});toast('Transfer saving dicatat.');await refreshData();}catch(e){toast(e.message,'error');}}
  async function deleteSaving(id){if(!confirm('Hapus alokasi saving ini? Riwayat transfer yang sudah tercatat tidak ikut dihapus.'))return;try{await api('deleteSaving',{id});toast('Alokasi saving dihapus.');await refreshData();}catch(e){toast(e.message,'error');}}

  function renderCategories(){
    const table=$('#categoriesTable');if(!table)return;
    const cats=(state.meta?.categories||[]).filter(c=>(state.categoryBook==='ALL'||c.book===state.categoryBook)&&(state.categoryType==='ALL'||c.type===state.categoryType));
    $$('#categoryBookFilter [data-category-book]').forEach(b=>b.classList.toggle('active',b.dataset.categoryBook===state.categoryBook));
    if($('#categoryTypeFilter'))$('#categoryTypeFilter').value=state.categoryType;
    if($('#addCategoryBtn'))$('#addCategoryBtn').classList.toggle('hidden',state.user?.role!=='ADMIN');
    table.innerHTML=cats.map(c=>`<tr><td><span class="category-color-dot" style="background:${esc(c.color||colorForLabel(c.name,c.book,c.type))}"></span><code class="color-code">${esc(c.color||colorForLabel(c.name,c.book,c.type))}</code></td><td><strong>${esc(c.name)}</strong></td><td><span class="badge ${c.book}">${c.book==='HOUSE'?'Rumah':'Studio'}</span></td><td>${typeLabel(c.type)}</td><td><span class="category-status ${c.active?'active':'inactive'}">${c.active?'Aktif':'Nonaktif'}</span></td><td><div class="row-actions">${state.user?.role==='ADMIN'?`<button class="mini-btn" data-edit-category="${c.id}">Edit</button><button class="mini-btn danger" data-delete-category="${c.id}">Hapus</button>`:'-'}</div></td></tr>`).join('')||'<tr><td colspan="6">Belum ada kategori pada filter ini.</td></tr>';
  }
  function openCategory(c=null){
    if(state.user?.role!=='ADMIN'){toast('Hanya Administrator yang dapat mengubah kategori.','error');return;}
    $('#categoryModalTitle').textContent=c?'Edit Kategori':'Tambah Kategori';$('#categoryId').value=c?.id||'';$('#categoryBook').value=c?.book||'HOUSE';$('#categoryType').value=c?.type||'EXPENSE';$('#categoryName').value=c?.name||'';const color=c?.color||'#2563eb';$('#categoryColor').value=color;$('#categoryColorHex').value=color;$('#categoryActive').checked=c?!!c.active:true;$('#categoryDialog').showModal();
  }
  async function saveCategory(){
    const d={id:$('#categoryId').value,book:$('#categoryBook').value,type:$('#categoryType').value,name:$('#categoryName').value.trim(),color:$('#categoryColorHex').value.trim(),active:$('#categoryActive').checked};
    try{await api('saveCategory',d);$('#categoryDialog').close();toast('Kategori disimpan.');await refreshData();}catch(e){toast(e.message,'error');}
  }
  async function deleteCategory(id){
    const c=(state.meta?.categories||[]).find(x=>x.id===id);if(!c)return;
    if(!confirm(`Hapus kategori "${c.name}"?\n\nRiwayat transaksi lama tidak akan dihapus, tetapi kategori ini tidak lagi tersedia untuk transaksi baru.`))return;
    try{await api('deleteCategory',{id});toast('Kategori dihapus.');await refreshData();}catch(e){toast(e.message,'error');}
  }

  function fillTransactionOptions(){updateFormOptions();}
  function updateFormOptions(){const book=$('#txBook').value,type=$('#txType').value;const cats=(state.meta?.categories||[]).filter(c=>c.book===book&&(c.type===type||c.type==='ALL')&&c.active);$('#txCategory').innerHTML=cats.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')||'<option value="Lainnya">Lainnya</option>';const accts=(state.meta?.accounts||[]).filter(a=>a.book===book&&a.active);const opts='<option value="">— Tidak ada —</option>'+accts.map(a=>`<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');$('#txFromAccount').innerHTML=opts;$('#txToAccount').innerHTML=opts;$('#transactionRuleHint').textContent={INCOME:'Pemasukan: pilih Akun Tujuan.',EXPENSE:'Pengeluaran: pilih Akun Asal.',TRANSFER:'Transfer: pilih Akun Asal dan Akun Tujuan.',PRIVE:'Prive: pilih Akun Asal Studio.'}[type]||'';}
  function openTransaction(tx=null){$('#transactionModalTitle').textContent=tx?'Edit Transaksi':'Tambah Transaksi';$('#txId').value=tx?.id||'';$('#txDate').value=tx?.date||today();$('#txBook').value=tx?.book||(state.page==='studio'?'STUDIO':'HOUSE');$('#txType').value=tx?.type||'EXPENSE';updateFormOptions();if(tx){$('#txCategory').value=tx.category;$('#txDescription').value=tx.description||'';$('#txParty').value=tx.party||'';$('#txMethod').value=tx.method||'Transfer';$('#txFromAccount').value=tx.fromAccount||'';$('#txToAccount').value=tx.toAccount||'';$('#txAmount').value=tx.amount||'';$('#txNote').value=tx.note||'';}else{$('#txDescription').value='';$('#txParty').value='';$('#txAmount').value='';$('#txNote').value='';}$('#transactionDialog').showModal();}
  async function saveTransaction(){const tx={id:$('#txId').value,date:$('#txDate').value,book:$('#txBook').value,type:$('#txType').value,category:$('#txCategory').value,description:$('#txDescription').value.trim(),party:$('#txParty').value.trim(),fromAccount:$('#txFromAccount').value,toAccount:$('#txToAccount').value,amount:Number($('#txAmount').value||0),method:$('#txMethod').value,note:$('#txNote').value.trim()};const btn=$('#saveTransactionBtn');btn.disabled=true;try{await api(tx.id?'updateTransaction':'addTransaction',tx);$('#transactionDialog').close();toast('Transaksi disimpan.');await refreshData();}catch(e){toast(e.message,'error');}finally{btn.disabled=false;}}
  async function deleteTransaction(id){if(!confirm('Hapus transaksi ini?'))return;try{await api('deleteTransaction',{id});toast('Transaksi dihapus.');await refreshData();}catch(e){toast(e.message,'error');}}

  function fillRoutineOptions(){const cats=(state.meta?.categories||[]).filter(c=>c.book==='HOUSE'&&c.type==='EXPENSE'&&c.active);$('#routineCategory').innerHTML=cats.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');const accts=(state.meta?.accounts||[]).filter(a=>a.book==='HOUSE'&&a.active);$('#routineFromAccount').innerHTML=accts.map(a=>`<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');}
  function openRoutine(r=null){$('#routineModalTitle').textContent=r?'Edit Pengeluaran Rutin':'Tambah Pengeluaran Rutin';$('#routineId').value=r?.id||'';$('#routineDescription').value=r?.description||'';$('#routineCategory').value=r?.category||'Tagihan rumah';$('#routineAmount').value=r?.amount||'';$('#routinePaymentMode').value=r?.paymentMode||'ONLINE';$('#routineDueDay').value=r?.dueDay||1;$('#routineActive').checked=r?!!r.active:true;$('#routineNote').value=r?.note||'';const def=(r?.paymentMode||'ONLINE')==='CASH_ATM'?'Rumah · Tunai':'Rumah · Bank';$('#routineFromAccount').value=r?.fromAccount||def;$('#routineDialog').showModal();}
  async function saveRoutine(){const d={id:$('#routineId').value,description:$('#routineDescription').value.trim(),category:$('#routineCategory').value,amount:Number($('#routineAmount').value||0),paymentMode:$('#routinePaymentMode').value,dueDay:Number($('#routineDueDay').value||1),fromAccount:$('#routineFromAccount').value,active:$('#routineActive').checked,note:$('#routineNote').value.trim()};try{await api('saveRoutine',d);$('#routineDialog').close();toast('Pengeluaran rutin disimpan.');await refreshData();}catch(e){toast(e.message,'error');}}
  async function payRoutine(id){const p=currentPeriod(),month=p.month==='ALL'?currentMonth():Number(p.month);if(!confirm(`Tandai pengeluaran ini sudah dibayar untuk ${month}/${p.year}?`))return;try{await api('payRoutine',{id,month,year:Number(p.year)});toast('Pembayaran dicatat sebagai pengeluaran Rumah Tangga.');await refreshData();}catch(e){toast(e.message,'error');}}
  async function deleteRoutine(id){if(!confirm('Hapus pengeluaran rutin ini?'))return;try{await api('deleteRoutine',{id});toast('Pengeluaran rutin dihapus.');await refreshData();}catch(e){toast(e.message,'error');}}

  function switchPage(page){state.page=page;$$('.page').forEach(x=>x.classList.add('hidden'));$('#'+page+'Page').classList.remove('hidden');$$('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.page===page));const titles={overall:'Dashboard Keseluruhan',studio:'Dashboard AR Studio',house:'Dashboard Rumah Tangga',transactions:'Transaksi',routines:'Pengeluaran Rutin',savings:'Saving / Tabungan',accounts:'Akun & Saldo',categories:'Kategori',profile:'Profil & Pengaturan'};$('#pageTitle').textContent=titles[page]||'AR Family Finance';$('#pageEyebrow').textContent=page==='studio'?'AR STUDIO':page==='house'||page==='routines'||page==='savings'?'RUMAH TANGGA':page==='profile'?'AKUN':page==='categories'?'PENGATURAN':'RINGKASAN KEUANGAN';$('#financeFilters').classList.toggle('hidden',page==='profile'||page==='accounts'||page==='categories');$('#sidebar').classList.remove('open');if(['overall','studio','house'].includes(page))setTimeout(()=>renderDashboard(page==='overall'?'ALL':page==='studio'?'STUDIO':'HOUSE'),0);}

  // Crop foto profil
  const crop={img:null,scale:1,base:1,x:0,y:0,drag:false,lastX:0,lastY:0};
  function drawCrop(){const c=$('#cropCanvas'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);if(!crop.img)return;const s=crop.base*crop.scale,w=crop.img.width*s,h=crop.img.height*s;ctx.drawImage(crop.img,(c.width-w)/2+crop.x,(c.height-h)/2+crop.y,w,h);}
  function openPhoto(file){const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{crop.img=img;crop.base=Math.max(320/img.width,320/img.height);crop.scale=1;crop.x=0;crop.y=0;$('#cropZoom').value='1';drawCrop();$('#cropDialog').showModal();};img.src=reader.result;};reader.readAsDataURL(file);}
  function makePhotoData(){const src=$('#cropCanvas'),out=document.createElement('canvas');out.width=224;out.height=224;out.getContext('2d').drawImage(src,0,0,224,224);let q=.8,data=out.toDataURL('image/jpeg',q);while(data.length>45000&&q>.45){q-=.1;data=out.toDataURL('image/jpeg',q);}return data;}
  async function saveProfile(){const d={name:$('#profileName').value.trim(),username:$('#profileUsername').value.trim(),password:$('#profilePassword').value};if(state.pendingPhoto!==undefined)d.photo=state.pendingPhoto;try{const res=await api('updateProfile',d);state.user=res.user;state.pendingPhoto=undefined;$('#profilePassword').value='';applyUserVisuals();saveCache();toast('Profil disimpan.');}catch(e){toast(e.message,'error');}}

  $('#loginForm').addEventListener('submit',e=>{e.preventDefault();login($('#loginUsername').value.trim(),$('#loginPassword').value);});
  $('#logoutBtn').addEventListener('click',logout);$('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));$('#addTransactionBtn').addEventListener('click',()=>openTransaction());
  $$('.nav-link').forEach(b=>b.addEventListener('click',()=>switchPage(b.dataset.page)));document.body.addEventListener('click',e=>{const go=e.target.closest('[data-go]');if(go)switchPage(go.dataset.go);});
  $('#closeModalBtn').addEventListener('click',()=>$('#transactionDialog').close());$('#cancelModalBtn').addEventListener('click',()=>$('#transactionDialog').close());$('#transactionForm').addEventListener('submit',e=>{e.preventDefault();saveTransaction();});$('#txBook').addEventListener('change',updateFormOptions);$('#txType').addEventListener('change',updateFormOptions);
  ['monthFilter','yearFilter'].forEach(id=>$('#'+id).addEventListener('change',refreshData));['typeFilter','bookFilter'].forEach(id=>$('#'+id).addEventListener('change',renderTransactions));$('#transactionSearch').addEventListener('input',renderTransactions);
  $('#transactionsTable').addEventListener('click',e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit){const tx=state.transactions.find(x=>x.id===edit.dataset.edit);if(tx)openTransaction(tx);}if(del)deleteTransaction(del.dataset.delete);});
  $('#addRoutineBtn').addEventListener('click',()=>openRoutine());$('#closeRoutineBtn').addEventListener('click',()=>$('#routineDialog').close());$('#cancelRoutineBtn').addEventListener('click',()=>$('#routineDialog').close());$('#routineForm').addEventListener('submit',e=>{e.preventDefault();saveRoutine();});$('#routinePaymentMode').addEventListener('change',()=>{$('#routineFromAccount').value=$('#routinePaymentMode').value==='CASH_ATM'?'Rumah · Tunai':'Rumah · Bank';});
  function handleRoutineAction(e){const pay=e.target.closest('[data-pay-routine]'),edit=e.target.closest('[data-edit-routine]'),del=e.target.closest('[data-delete-routine]');if(pay)payRoutine(pay.dataset.payRoutine);if(edit){const r=state.routines.find(x=>x.id===edit.dataset.editRoutine);if(r)openRoutine(r);}if(del)deleteRoutine(del.dataset.deleteRoutine);}
  $('#routineGrid').addEventListener('click',handleRoutineAction);$('#routineTable').addEventListener('click',handleRoutineAction);
  $('#routineModeFilter').addEventListener('click',e=>{const b=e.target.closest('[data-routine-mode]');if(!b)return;state.routineMode=b.dataset.routineMode;localStorage.setItem('arRoutineMode',state.routineMode);renderRoutines();});
  $('#routineViewToggle').addEventListener('click',e=>{const b=e.target.closest('[data-routine-view]');if(!b)return;state.routineView=b.dataset.routineView;localStorage.setItem('arRoutineView',state.routineView);renderRoutines();});
  $('#addSavingBtn').addEventListener('click',()=>openSaving());$('#closeSavingBtn').addEventListener('click',()=>$('#savingDialog').close());$('#cancelSavingBtn').addEventListener('click',()=>$('#savingDialog').close());$('#savingForm').addEventListener('submit',e=>{e.preventDefault();saveSaving();});
  $('#savingList').addEventListener('click',e=>{const tr=e.target.closest('[data-transfer-saving]'),ed=e.target.closest('[data-edit-saving]'),del=e.target.closest('[data-delete-saving]');if(tr)transferSaving(tr.dataset.transferSaving);if(ed){const p=(state.savings?.plans||[]).find(x=>x.id===ed.dataset.editSaving);if(p)openSaving(p);}if(del)deleteSaving(del.dataset.deleteSaving);});
  $('#addCategoryBtn').addEventListener('click',()=>openCategory());
  $('#closeCategoryBtn').addEventListener('click',()=>$('#categoryDialog').close());$('#cancelCategoryBtn').addEventListener('click',()=>$('#categoryDialog').close());$('#categoryForm').addEventListener('submit',e=>{e.preventDefault();saveCategory();});
  $('#categoryColor').addEventListener('input',e=>$('#categoryColorHex').value=e.target.value.toLowerCase());$('#categoryColorHex').addEventListener('input',e=>{const v=e.target.value.trim();if(/^#[0-9a-f]{6}$/i.test(v))$('#categoryColor').value=v;});
  $('#categoryBookFilter').addEventListener('click',e=>{const b=e.target.closest('[data-category-book]');if(!b)return;state.categoryBook=b.dataset.categoryBook;renderCategories();});$('#categoryTypeFilter').addEventListener('change',e=>{state.categoryType=e.target.value;renderCategories();});
  $('#categoriesTable').addEventListener('click',e=>{const ed=e.target.closest('[data-edit-category]'),del=e.target.closest('[data-delete-category]');if(ed){const c=(state.meta?.categories||[]).find(x=>x.id===ed.dataset.editCategory);if(c)openCategory(c);}if(del)deleteCategory(del.dataset.deleteCategory);});
  $('#profileForm').addEventListener('submit',e=>{e.preventDefault();saveProfile();});$('#changePhotoBtn').addEventListener('click',()=>$('#photoInput').click());$('#photoInput').addEventListener('change',e=>{if(e.target.files?.[0])openPhoto(e.target.files[0]);e.target.value='';});$('#closeCropBtn').addEventListener('click',()=>$('#cropDialog').close());$('#cancelCropBtn').addEventListener('click',()=>$('#cropDialog').close());$('#cropZoom').addEventListener('input',e=>{crop.scale=Number(e.target.value);drawCrop();});
  const cc=$('#cropCanvas');cc.addEventListener('pointerdown',e=>{crop.drag=true;crop.lastX=e.clientX;crop.lastY=e.clientY;cc.setPointerCapture(e.pointerId);});cc.addEventListener('pointermove',e=>{if(!crop.drag)return;crop.x+=e.clientX-crop.lastX;crop.y+=e.clientY-crop.lastY;crop.lastX=e.clientX;crop.lastY=e.clientY;drawCrop();});cc.addEventListener('pointerup',()=>crop.drag=false);$('#saveCropBtn').addEventListener('click',()=>{state.pendingPhoto=makePhotoData();const pp=$('#profilePhotoPreview');pp.textContent='';pp.style.backgroundImage=`url(${state.pendingPhoto})`;$('#cropDialog').close();toast('Crop siap. Klik Simpan Profil.');});

  (async()=>{
    if(!state.token){showLogin();return;}
    const cached=loadCache();
    if(cached){state.user=cached.user;state.meta=cached.meta;state.dashboards=cached.dashboards||{};state.transactions=cached.transactions||[];state.routines=cached.routines||[];state.savings=cached.savings||null;fillFilters(cached);showApp();renderAll();}
    try{const data=await api('initialData',{book:'ALL',month:cached?.month||currentMonth(),year:cached?.year||currentYear()});applyData(data);fillFilters(cached||{month:currentMonth(),year:currentYear()});showApp();switchPage(state.page);}catch(e){localStorage.removeItem(TOKEN_KEY);state.token='';showLogin();toast('Silakan login kembali.','error');}
  })();
})();

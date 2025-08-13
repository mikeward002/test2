
/* QuietPath • Funeral Cost Calculator (separate JS)
   - Mobile bottom dock (total only)
   - "See more options" collapsed by default
   - CSV/Print buttons in the itemized footer
   - No header/footer or nav code included
*/
(function(){
  // ----- State multipliers -----
  const STATE_MULT={"California":1.2,"New York":1.2,"Massachusetts":1.2,"Connecticut":1.2,"New Jersey":1.2,"District of Columbia":1.2,"Washington":1.2,"Oregon":1.2,"Hawaii":1.2,"Alaska":1.2,"Maryland":1.2,"Alabama":0.8,"Arkansas":0.8,"Mississippi":0.8,"Oklahoma":0.8,"Kentucky":0.8,"West Virginia":0.8,"Louisiana":0.8,"Tennessee":0.8,"Missouri":0.8,"New Mexico":0.8,"South Carolina":0.8,"Idaho":0.8};

  const ALL_STATES = ["National average"].concat("Alabama,Alaska,Arizona,Arkansas,California,Colorado,Connecticut,Delaware,District of Columbia,Florida,Georgia,Hawaii,Idaho,Illinois,Indiana,Iowa,Kansas,Kentucky,Louisiana,Maine,Maryland,Massachusetts,Michigan,Minnesota,Mississippi,Missouri,Montana,Nebraska,Nevada,New Hampshire,New Jersey,New Mexico,New York,North Carolina,North Dakota,Ohio,Oklahoma,Oregon,Pennsylvania,Rhode Island,South Carolina,South Dakota,Tennessee,Texas,Utah,Vermont,Virginia,Washington,Wisconsin,Wyoming".split(","));

  const GROUPS=["funeral","transport","ceremony","burial","cremation"];

  const OPTIONAL_ORDER = {ceremony:["flowers","programs","obituary","honorarium","catering"],burial:["liner","headstone","plot","opening","vault"],funeral:["refrigeration","presentation"],transport:[],cremation:[]};

  const ITEMS=[
    {id:"basic_services",label:"Basic services of funeral director and staff",base:2300,group:"funeral",applies:"both"},
    {id:"transfer",label:"Transfer of remains",base:350,group:"transport",applies:"both"},
    {id:"embalming",label:"Embalming",base:750,group:"funeral",applies:"burial"},
    {id:"viewing",label:"Viewing / visitation",base:450,group:"ceremony",applies:"both"},
    {id:"ceremony",label:"Funeral ceremony / memorial",base:500,group:"ceremony",applies:"both"},
    {id:"hearse",label:"Hearse",base:350,group:"transport",applies:"burial"},
    {id:"service_car",label:"Service car / van",base:150,group:"transport",applies:"both"},
    {id:"metal_casket",label:"Metal casket",base:2500,group:"burial",applies:"burial"},
    {id:"vault",label:"Vault",base:1500,group:"burial",applies:"burial",isCemetery:true},
    {id:"plot",label:"Cemetery plot",base:2000,group:"burial",applies:"both",isCemetery:true},
    {id:"opening",label:"Opening / closing grave",base:1200,group:"burial",applies:"both",isCemetery:true},
    {id:"headstone",label:"Headstone / marker",base:2000,group:"burial",applies:"both",isCemetery:true},
    {id:"cremation_fee",label:"Cremation fee",base:350,group:"cremation",applies:"cremation"},
    {id:"urn",label:"Urn",base:250,group:"cremation",applies:"cremation"},
    {id:"flowers",label:"Flowers",base:150,group:"ceremony",applies:"both",optional:true,enabled:false},
    {id:"programs",label:"Printed programs / memorial cards",base:180,group:"ceremony",applies:"both",optional:true,enabled:false},
    {id:"obituary",label:"Obituary / announcement fees",base:100,group:"ceremony",applies:"both",optional:true,enabled:false},
    {id:"honorarium",label:"Clergy / celebrant honorarium",base:200,group:"ceremony",applies:"both",optional:true,enabled:false},
    {id:"catering",label:"Family gathering / catering",base:300,group:"ceremony",applies:"both",optional:true,enabled:false},
    {id:"liner",label:"Grave liner (if not using vault)",base:900,group:"burial",applies:"burial",optional:true,enabled:false},
    {id:"presentation",label:"Presentation prep (dressing/cosmetics)",base:200,group:"funeral",applies:"burial",optional:true,enabled:false},
    {id:"refrigeration",label:"Refrigeration (per day)",base:100,group:"funeral",applies:"both",optional:true,enabled:false,qtyFactor:true,qty:1}
  ];

  const stateSelect=document.getElementById("stateSelect");
  const itemsToggle=document.getElementById("itemsToggle");
  const itemsSection=document.getElementById("itemsSection");
  const summaryEl=document.getElementById("summary");
  const grandEl=document.getElementById("grandTotal");
  const dockTotal=document.getElementById("dockTotalAmt");

  const bodies={funeral:document.getElementById("bodyFuneral"),transport:document.getElementById("bodyTransport"),ceremony:document.getElementById("bodyCeremony"),burial:document.getElementById("bodyBurial"),cremation:document.getElementById("bodyCremation")};
  const subEls={funeral:document.getElementById("subFuneral"),transport:document.getElementById("subTransport"),ceremony:document.getElementById("subCeremony"),burial:document.getElementById("subBurial"),cremation:document.getElementById("subCremation")};
  const moreLines={funeral:document.getElementById("moreFuneral"),transport:document.getElementById("moreTransport"),ceremony:document.getElementById("moreCeremony"),burial:document.getElementById("moreBurial"),cremation:document.getElementById("moreCremation")};
  const moreOpen={funeral:false,transport:false,ceremony:false,burial:false,cremation:false};

  let scenario="cremation",serviceLevel="mem",cemeteryOn=false,openCasket=false,multiplier=1.0;
  const itemState=new Map();

  function setPressed(el,on){ if(!el)return; el.setAttribute("aria-pressed", on?"true":"false"); }

  function defaultEnabled(it){
    const applies=it.applies==="both"||it.applies===scenario;
    if(!applies)return false;
    if(it.isCemetery&&!cemeteryOn)return false;
    if(it.id==="viewing") return serviceLevel==="full";
    if(it.id==="ceremony") return (serviceLevel==="full"||serviceLevel==="mem");
    if(it.id==="service_car") return serviceLevel==="full";
    if(it.id==="hearse") return scenario==="burial";
    if(it.id==="embalming"){ if(scenario==="cremation")return false; if(serviceLevel!=="full")return false; return openCasket; }
    if(it.id==="presentation") return serviceLevel==="full"&&openCasket&&scenario==="burial";
    if(it.id==="refrigeration"){ const emb=(scenario==="burial"&&serviceLevel==="full"&&openCasket); return !emb&&(serviceLevel!=="none"); }
    if(it.optional&&it.enabled===false)return false;
    return true;
  }
  function initDefaults(){
    itemState.clear();
    ITEMS.forEach(it=>itemState.set(it.id,{
      enabled:defaultEnabled(it),
      amount:it.base,
      qty:it.qtyFactor?(it.qty||1):1
    }));
  }

  const fmtUSD=n=>Number(n).toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:0});

  function buildStateSelect(){
    if(!stateSelect) return;
    stateSelect.innerHTML="";
    ALL_STATES.forEach(s=>{
      const o=document.createElement("option");o.value=s;o.textContent=s;stateSelect.appendChild(o);
    });
    stateSelect.value="National average"; multiplier=1.0;
    stateSelect.addEventListener("change",()=>{
      const s=stateSelect.value; multiplier=(s==="National average")?1.0:(STATE_MULT[s]||1.0); renderAll();
    });
  }

  function groupSubtotal(group){
    let sum=0;
    ITEMS.forEach(it=>{
      if(it.group!==group) return;
      const st=itemState.get(it.id);
      const applies=it.applies==="both"||it.applies===scenario; if(!applies) return;
      if(it.isCemetery&&!cemeteryOn) return;
      if(!st.enabled) return;
      const qty=it.qtyFactor?(st.qty||1):1;
      sum+=(Number(st.amount)||0)*qty*multiplier;
    });
    return sum;
  }

  function renderSummary(){
    summaryEl.innerHTML="";
    GROUPS.forEach(g=>{
      const val=groupSubtotal(g);
      if(val<=0) return;
      const div=document.createElement("div"); div.className="bucket";
      const name=document.createElement("span"); name.className="name";
      name.textContent=(g==="funeral"?"Funeral home services":g==="transport"?"Transportation":g==="ceremony"?"Viewing & ceremony":g==="burial"?"Burial & cemetery":"Cremation");
      const amt=document.createElement("span"); amt.className="amt"; amt.textContent=fmtUSD(val);
      div.appendChild(name); div.appendChild(amt); summaryEl.appendChild(div);
    });
    const total=grandTotal();
    grandEl.textContent=fmtUSD(total);
    if(dockTotal) dockTotal.textContent=fmtUSD(total);
  }

  function grandTotal(){ return GROUPS.reduce((acc,g)=>acc+groupSubtotal(g),0); }

  function makeRow(it,isDisabled){
    const st=itemState.get(it.id);
    const row=document.createElement("tr"); if(isDisabled) row.classList.add("row-disabled");
    const tdItem=document.createElement("td"); tdItem.className="col-item"; tdItem.textContent=it.label + (it.qtyFactor && st.qty>1 ? ` × ${st.qty}` : "");
    const tdAmt=document.createElement("td"); tdAmt.className="col-amt"; const span=document.createElement("span"); span.className="amount";
    const line=(st.amount||0)*(it.qtyFactor?(st.qty||1):1); span.textContent=fmtUSD(line); tdAmt.appendChild(span);
    const tdAct=document.createElement("td"); tdAct.className="col-act"; const wrap=document.createElement("div");

    if(!isDisabled){
      const edit=document.createElement("button"); edit.className="btn inline"; edit.textContent="Edit";
      edit.addEventListener("click",()=>{
        tdAmt.innerHTML="";
        const w=document.createElement("div"); w.className="amount editing";
        const input=document.createElement("input"); input.type="number"; input.inputMode="numeric"; input.pattern="[0-9]*"; input.min="0"; input.step="50"; input.value=st.amount; w.appendChild(input);
        if(it.qtyFactor){ const q=document.createElement("input"); q.type="number"; q.inputMode="numeric"; q.pattern="[0-9]*"; q.min="1"; q.step="1"; q.value=st.qty||1; q.style.width="70px"; q.setAttribute("aria-label","Quantity"); w.appendChild(q);
          q.addEventListener("blur",()=>{ st.qty=Math.max(1,Number(q.value)||1); renderAll();}); q.addEventListener("keydown",e=>{if(e.key==="Enter"){q.blur();}}); }
        tdAmt.appendChild(w); input.focus();
        const commit=()=>{ st.amount=Number(input.value)||0; renderAll(); }; input.addEventListener("blur",commit); input.addEventListener("keydown",e=>{if(e.key==="Enter"){input.blur();}});
      });

      const sep=document.createElement("span"); sep.textContent=" | "; sep.className="muted";
      const remove=document.createElement("button"); remove.className="btn inline"; remove.textContent="Remove";
      remove.addEventListener("click",()=>{ st.enabled=false; renderAll(); });
      wrap.appendChild(edit); wrap.appendChild(sep); wrap.appendChild(remove);
    } else {
      const add=document.createElement("button"); add.className="btn inline"; add.textContent="Add";
      add.addEventListener("click",()=>{ st.enabled=true; renderAll(); });
      wrap.appendChild(add);
    }

    tdAct.appendChild(wrap);
    row.appendChild(tdItem); row.appendChild(tdAmt); row.appendChild(tdAct);
    return row;
  }

  function renderGroup(group){
    const tbody=bodies[group]; if(!tbody) return; tbody.innerHTML="";
    const enabled=[], disabled=[];
    ITEMS.forEach(it=>{
      if(it.group!==group) return;
      const applies=it.applies==="both"||it.applies===scenario; 
      if(!applies){ disabled.push(it); return; }
      if(it.isCemetery && !cemeteryOn){ disabled.push(it); return; }
      const st=itemState.get(it.id);
      (st.enabled ? enabled : disabled).push(it);
    });

    enabled.forEach(it => tbody.appendChild(makeRow(it, false)));

    if(moreOpen[group]){
      const order = OPTIONAL_ORDER[group]||[];
      disabled.sort((a,b)=> (order.indexOf(a.id)+1 || 999) - (order.indexOf(b.id)+1 || 999));
      disabled.forEach(it => tbody.appendChild(makeRow(it, true)));
    }

    const count = disabled.length;
    const line = moreLines[group];
    if(line){
      if(count>0){
        line.style.display="";
        const btn=line.querySelector("button");
        btn.textContent = (moreOpen[group] ? "Hide extra items" : `See more options (${count})`);
        btn.onclick = ()=>{ moreOpen[group]=!moreOpen[group]; renderAll(); };
      } else {
        line.style.display="none";
      }
    }

    if(subEls[group]) subEls[group].textContent = fmtUSD(groupSubtotal(group));
    const groupEl = document.getElementById("grp"+group.charAt(0).toUpperCase()+group.slice(1));
    if(groupEl) groupEl.style.display = (enabled.length>0 || (moreOpen[group] && disabled.length>0)) ? "" : "none";
  }

  function renderAll(){ GROUPS.forEach(renderGroup); renderSummary(); }

  // Button wiring
  const btnBurial=document.getElementById("opt-burial"),
        btnCrem=document.getElementById("opt-cremation"),
        svcFull=document.getElementById("svc-full"),
        svcMem=document.getElementById("svc-mem"),
        svcNone=document.getElementById("svc-none"),
        openYes=document.getElementById("open-yes"),
        openNo=document.getElementById("open-no"),
        rowOpen=document.getElementById("row-open-casket"),
        cemOnBtn=document.getElementById("cem-on"),
        cemOffBtn=document.getElementById("cem-off");

  function updateRules(){
    if(rowOpen) rowOpen.style.display=(serviceLevel==="full"&&scenario==="burial")?"":"none";
    ITEMS.forEach(it=>{ const st=itemState.get(it.id); st.enabled=defaultEnabled(it); if(it.id==="refrigeration"&&st.enabled&&(!st.qty||st.qty<1)) st.qty=1; });
    renderAll();
  }

  btnBurial?.addEventListener("click",()=>{scenario="burial";setPressed(btnBurial,true);setPressed(btnCrem,false);updateRules();});
  btnCrem?.addEventListener("click",()=>{scenario="cremation";setPressed(btnBurial,false);setPressed(btnCrem,true);updateRules();});
  svcFull?.addEventListener("click",()=>{serviceLevel="full";setPressed(svcFull,true);setPressed(svcMem,false);setPressed(svcNone,false);updateRules();});
  svcMem?.addEventListener("click",()=>{serviceLevel="mem";setPressed(svcFull,false);setPressed(svcMem,true);setPressed(svcNone,false);updateRules();});
  svcNone?.addEventListener("click",()=>{serviceLevel="none";setPressed(svcFull,false);setPressed(svcMem,false);setPressed(svcNone,true);updateRules();});
  openYes?.addEventListener("click",()=>{openCasket=true;setPressed(openYes,true);setPressed(openNo,false);updateRules();});
  openNo?.addEventListener("click",()=>{openCasket=false;setPressed(openYes,false);setPressed(openNo,true);updateRules();});
  cemOnBtn?.addEventListener("click",()=>{cemeteryOn=true;setPressed(cemOnBtn,true);setPressed(cemOffBtn,false);updateRules();});
  cemOffBtn?.addEventListener("click",()=>{cemeteryOn=false;setPressed(cemOnBtn,false);setPressed(cemOffBtn,true);updateRules();});

  // Items show/hide
  itemsToggle?.addEventListener("click",(e)=>{
    e.preventDefault();
    const hidden=itemsSection.style.display==="none";
    itemsSection.style.display=hidden?"":"none";
    itemsToggle.textContent=hidden?"Hide itemized costs":"Show itemized costs";
  });

  // CSV / Print
  document.getElementById("btnPrint")?.addEventListener("click",()=>window.print());
  document.getElementById("btnCSV")?.addEventListener("click",()=>{
    const lines=[["Group","Item","Amount","Qty","Included","Adjusted line total (USD)"]];
    ITEMS.forEach(it=>{
      const st=itemState.get(it.id); if(!st)return;
      const applies=it.applies==="both"||it.applies===scenario; if(!applies)return;
      if(it.isCemetery&&!cemeteryOn)return;
      const qty=it.qtyFactor?(st.qty||1):1;
      const line=(Number(st.amount)||0)*qty*multiplier;
      lines.push([it.group,it.label,(Number(st.amount)||0).toFixed(0),qty,st.enabled?"Yes":"No",line.toFixed(0)]);
    });
    lines.push(["","","","","Grand total",grandTotal().toFixed(0)]);
    const csv=lines.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="quietpath-funeral-estimate.csv"; a.click(); URL.revokeObjectURL(url);
  });

  // Reset
  document.getElementById("btnReset")?.addEventListener("click",()=>{
    scenario="cremation";serviceLevel="mem";cemeteryOn=false;openCasket=false;multiplier=1.0;
    setPressed(btnBurial,false);setPressed(btnCrem,true);setPressed(svcFull,false);setPressed(svcMem,true);setPressed(svcNone,false);
    setPressed(openYes,false);setPressed(openNo,true);setPressed(cemOnBtn,false);setPressed(cemOffBtn,true);
    if(stateSelect) stateSelect.value="National average"; initDefaults(); renderAll();
    if(itemsSection && itemsSection.style.display!=="none"){itemsToggle.click();}
    window.scrollTo({top:0,behavior:"smooth"});
  });

  function renderAll(){ GROUPS.forEach(renderGroup); renderSummary(); }
  function grandTotal(){ return GROUPS.reduce((acc,g)=>acc+groupSubtotal(g),0); }

  function boot(){
    buildStateSelect();
    initDefaults();
    renderAll();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // helpers after boot
  function buildStateSelect(){
    if(!stateSelect) return;
    stateSelect.innerHTML="";
    ALL_STATES.forEach(s=>{
      const o=document.createElement("option");o.value=s;o.textContent=s;stateSelect.appendChild(o);
    });
    stateSelect.value="National average"; multiplier=1.0;
    stateSelect.addEventListener("change",()=>{
      const s=stateSelect.value; multiplier=(s==="National average")?1.0:(STATE_MULT[s]||1.0); renderAll();
    });
  }
})();

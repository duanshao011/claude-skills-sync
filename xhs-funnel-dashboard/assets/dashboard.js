/* 小红书全链路投放看板 · 五模块渲染 */
(function () {
  "use strict";
  const DATA = JSON.parse(document.getElementById("payload").textContent);
  const C = { bg:"#ffffff", panel:"#ffffff", border:"#e3e7ec", grid:"#eceff3",
    text:"#1f2933", muted:"#5f6b7a", dim:"#9aa5b1", accent:"#0d9488",
    hold:"#0d9488", seed:"#2563eb", stop:"#dc2626", watch:"#94a3b8" };
  const QUAD = {
    "加大投/稳住":{cls:"hold",col:C.hold}, "重点追投":{cls:"seed",col:C.seed},
    "止损":{cls:"stop",col:C.stop}, "观察":{cls:"watch",col:C.watch} };

  // ---------- 格式化 ----------
  const nf = n => (n==null||isNaN(n)) ? "—" : Number(n).toLocaleString("en-US");
  const money = n => (n==null||isNaN(n)) ? "—" : "¥"+Math.round(n).toLocaleString("en-US");
  const pct = n => (n==null||isNaN(n)) ? "—" : (n*100).toFixed(1)+"%";
  const f2 = n => (n==null||isNaN(n)) ? "—" : Number(n).toFixed(2);
  const sec = n => (n==null||isNaN(n)) ? "—" : Math.round(n)+"s";
  const FMT = { money, int:nf, pct, roi:f2, float:f2, sec };

  // ---------- 明细表列定义 ----------
  const COLGROUPS = {
    quality:[
      ["play_5s","5s播放率","pct"],["read_3s","3s阅读率","pct"],["avg_view_time","浏览时长","sec"],
      ["finish_rate","完播率","pct"],["interact_rate","互动率","pct"],
      ["body_cta_ctr","正文CTR","pct"],["comment_cta_ctr","评论CTR","pct"],["natural_ratio","自然占比","pct"]],
    funnel:[
      ["read_uv_funnel","带货阅读UV","int"],["visit_uv","进店UV","int"],["visit_rate","进店率","pct"],
      ["cart_uv","加购UV","int"],["cart_rate","加购率","pct"],
      ["deal_uv","成交UV","int"],["deal_rate","成交率","pct"],
      ["new_visit_ratio","新客占比","pct"],["search_visit_ratio","搜索进店占比","pct"]],
    eff:[
      ["total_amount","合作费","money"],["spend","薯条消耗","money"],["total_cost","总成本","money"],
      ["gmv","GMV","money"],["roi","ROI","roi"],
      ["visit_cost","进店成本","money"],["deal_cost","成交成本","money"],["read_price","阅读单价","money"]]
  };
  const TIERSET = new Set(Object.keys(DATA.waterlines||{}));

  // ---------- 通用 ECharts 深色配置 ----------
  function axisStyle(){return{
    axisLine:{lineStyle:{color:C.border}}, axisTick:{show:false},
    axisLabel:{color:C.muted}, splitLine:{lineStyle:{color:C.grid}},
    nameTextStyle:{color:C.muted}};}

  // ========== 模块1：KPI ==========
  function renderKPI(){
    const s = DATA.summary, m = DATA.meta, qc = s.quadrant_counts||{};
    const roi = s.overall_roi==null ? "—" : f2(s.overall_roi);
    document.getElementById("kpis").innerHTML = `
      <div class="kpi"><div class="k-label">总投入</div><div class="k-val">${money(s.total_cost)}</div>
        <div class="k-sub">达人合作费 + 薯条消耗</div></div>
      <div class="kpi"><div class="k-label">总成交 GMV</div><div class="k-val">${money(s.total_gmv)}</div>
        <div class="k-sub">星河归因 ${m.attr_period||30} 天</div></div>
      <div class="kpi accent"><div class="k-label">整体 ROI</div><div class="k-val">${roi}</div>
        <div class="k-sub">GMV / 总投入</div></div>
      <div class="kpi"><div class="k-label">分析笔记数</div><div class="k-val">${nf(s.note_count)}</div>
        <div class="k-sub">已投薯条 ${nf(s.invested_count)} 篇</div></div>
      <div class="kpi"><div class="k-label">四象限分布</div>
        <div class="quad-mini" style="margin-top:14px">
          <span class="qm-seed">🎯重点追投 ${qc["重点追投"]||0}</span>
          <span class="qm-hold">加大投 ${qc["加大投/稳住"]||0}</span>
          <span class="qm-stop">止损 ${qc["止损"]||0}</span>
          <span class="qm-watch">观察 ${qc["观察"]||0}</span></div></div>`;
  }

  // ========== 模块2：四象限散点 ==========
  function renderQuadrant(){
    const groups = {};
    DATA.notes.forEach(n=>{
      (groups[n.quadrant]=groups[n.quadrant]||[]).push(n);
    });
    const gmvMax = Math.max(1,...DATA.notes.map(n=>n.gmv||0));
    const series = Object.keys(QUAD).map(q=>({
      name:q, type:"scatter",
      symbolSize:d=> 8 + 26*Math.sqrt((d[2]||0)/gmvMax),
      itemStyle:{color:QUAD[q].col, opacity:.82, borderColor:"rgba(0,0,0,.3)"},
      emphasis:{focus:"series", itemStyle:{opacity:1, borderColor:"#fff", borderWidth:1}},
      data:(groups[q]||[]).map(n=>[n.spend||0, n.conv_score||0, n.gmv||0, n.roi, n.visit_uv, n.deal_uv, n.creator, n.title, q])
    }));
    const ch = echarts.init(document.getElementById("quadChart"));
    ch.setOption({
      backgroundColor:"transparent",
      legend:{top:6, textStyle:{color:C.muted}, inactiveColor:"#3a4150"},
      grid:{left:64, right:30, top:46, bottom:54},
      tooltip:{backgroundColor:"#0b0f16", borderColor:C.border, textStyle:{color:C.text},
        formatter:p=>{const d=p.data; const q=QUAD[d[8]];
          return `<div class="tt"><b>${d[6]}</b><br><span class="lbl">${d[7]||""}</span><br>
            <div class="row"><span class="lbl">象限</span><span class="q" style="color:${q.col}">${d[8]}</span></div>
            <div class="row"><span class="lbl">薯条消耗</span><span>${money(d[0])}</span></div>
            <div class="row"><span class="lbl">GMV</span><span>${money(d[2])}</span></div>
            <div class="row"><span class="lbl">ROI</span><span>${f2(d[3])}</span></div>
            <div class="row"><span class="lbl">进店/成交UV</span><span>${nf(d[4])} / ${nf(d[5])}</span></div></div>`;}},
      xAxis:Object.assign({type:"value", name:"薯条消耗 ¥（越右投得越多 · 贴左轴=未投）",
        nameLocation:"middle", nameGap:34, scale:true,
        axisLabel:{color:C.muted, formatter:v=>v>=1000?(v/1000)+"k":v}}, axisStyle()),
      yAxis:Object.assign({type:"value", name:"转化综合分（进店率·成交率·ROI 百分位）",
        nameLocation:"middle", nameGap:44, min:0, max:1}, axisStyle()),
      series:series.concat([{type:"line", markLine:{silent:true, symbol:"none",
        lineStyle:{color:"#3a4150", type:"dashed"},
        data:[{yAxis:0.5}, {xAxis:DATA.summary.x_split}],
        label:{color:C.dim, formatter:p=>p.value===0.5?"转化分0.5":"已投中位"}}, data:[]}])
    });
    window.addEventListener("resize",()=>ch.resize());
  }

  // ========== 模块3：明细表 ==========
  let curGroup="eff", sortKey="roi", sortDir=-1, fQuad="", fInvest="", fKw="";
  function fixedCols(){return[["creator","达人","lft"],["title","标题","lft"],["quadrant","象限","lft"]];}
  function visibleNotes(){
    return DATA.notes.filter(n=>{
      if(fQuad && n.quadrant!==fQuad) return false;
      if(fInvest==="yes" && !n.is_invested) return false;
      if(fInvest==="no" && n.is_invested) return false;
      if(fKw){const k=fKw.toLowerCase();
        if(!String(n.creator||"").toLowerCase().includes(k) && !String(n.title||"").toLowerCase().includes(k)) return false;}
      return true;
    });
  }
  function renderTable(){
    const grp = COLGROUPS[curGroup];
    const rows = visibleNotes().slice().sort((a,b)=>{
      let x=a[sortKey], y=b[sortKey];
      x=(x==null||isNaN(x))?-Infinity:x; y=(y==null||isNaN(y))?-Infinity:y;
      if(typeof a[sortKey]==="string"){return String(a[sortKey]).localeCompare(String(b[sortKey]))*sortDir;}
      return (x-y)*sortDir;
    });
    const ar = k => sortKey===k ? `<span class="ar">${sortDir<0?"▼":"▲"}</span>` : "";
    let head = "<tr>";
    fixedCols().forEach(([k,l])=>head+=`<th class="lft" data-k="${k}">${l}${ar(k)}</th>`);
    grp.forEach(([k,l])=>head+=`<th data-k="${k}">${l}${ar(k)}</th>`);
    head+="</tr>";
    let body="";
    rows.forEach(n=>{
      const q=QUAD[n.quadrant];
      body+="<tr>";
      body+=`<td class="lft cell-creator">${n.creator||"—"}</td>`;
      body+=`<td class="lft cell-title" title="${(n.title||"").replace(/"/g,'')}">${n.title||"—"}</td>`;
      body+=`<td class="lft"><span class="tag tag-${q.cls}">${n.quadrant}</span></td>`;
      grp.forEach(([k,l,fmt])=>{
        const v=n[k]; const tier=TIERSET.has(k)?(n.tiers&&n.tiers[k]||"na"):"";
        let cls=tier;
        let disp=FMT[fmt]?FMT[fmt](v):v;
        if(k==="roi"){cls=(v!=null&&v>=1)?"roi-pos":(v>0?"":"roi-neg");}
        body+=`<td class="${cls}">${disp}</td>`;
      });
      body+="</tr>";
    });
    document.getElementById("tblHead").innerHTML=head;
    document.getElementById("tblBody").innerHTML=body;
    document.getElementById("tblCnt").textContent=`${rows.length} 篇`;
    document.querySelectorAll("#tblHead th").forEach(th=>th.onclick=()=>{
      const k=th.dataset.k;
      if(sortKey===k) sortDir*=-1; else {sortKey=k; sortDir=-1;}
      renderTable();
    });
  }
  function initTableControls(){
    document.querySelectorAll("[data-grp]").forEach(b=>b.onclick=()=>{
      document.querySelectorAll("[data-grp]").forEach(x=>x.classList.remove("on"));
      b.classList.add("on"); curGroup=b.dataset.grp;
      const first=COLGROUPS[curGroup][0][0]; sortKey=first; sortDir=-1; renderTable();
    });
    document.getElementById("fQuad").onchange=e=>{fQuad=e.target.value;renderTable();};
    document.getElementById("fInvest").onchange=e=>{fInvest=e.target.value;renderTable();};
    document.getElementById("fKw").oninput=e=>{fKw=e.target.value;renderTable();};
  }

  // ========== 模块4：趋势折线 ==========
  let trendChart;
  function renderTrends(){
    const sel=document.getElementById("trendSel");
    const withTrend=DATA.notes.filter(n=>DATA.trends[n.note_id]&&DATA.trends[n.note_id].length)
      .sort((a,b)=>(b.gmv||0)-(a.gmv||0));
    sel.innerHTML=withTrend.map(n=>`<option value="${n.note_id}">${n.creator||"?"} · ${(n.title||"").slice(0,22)}</option>`).join("");
    trendChart=echarts.init(document.getElementById("trendChart"));
    if(withTrend.length){drawTrend(withTrend[0].note_id);}
    sel.onchange=e=>drawTrend(e.target.value);
    window.addEventListener("resize",()=>trendChart.resize());
  }
  function drawTrend(nid){
    const arr=DATA.trends[nid]||[]; const note=DATA.notes.find(n=>n.note_id===nid)||{};
    const dates=arr.map(r=>String(r[0]));
    const mk=(name,idx,col)=>({name,type:"line",smooth:true,symbol:"circle",symbolSize:5,
      lineStyle:{width:2,color:col},itemStyle:{color:col},data:arr.map(r=>r[idx])});
    trendChart.setOption({
      backgroundColor:"transparent",
      title:{text:`${note.creator||""} · ${(note.title||"").slice(0,30)}`,left:14,top:8,
        textStyle:{color:C.muted,fontSize:12,fontWeight:400}},
      legend:{top:8,right:14,textStyle:{color:C.muted}},
      grid:{left:52,right:30,top:48,bottom:40},
      tooltip:{trigger:"axis",backgroundColor:"#0b0f16",borderColor:C.border,textStyle:{color:C.text}},
      xAxis:Object.assign({type:"category",data:dates,boundaryGap:false},axisStyle()),
      yAxis:Object.assign({type:"value"},axisStyle()),
      series:[mk("进店UV",1,C.seed),mk("加购UV",2,C.accent),mk("成交UV",3,"#f59e0b")]
    },true);
  }

  // ========== 模块5：复用洞察 ==========
  function renderInsights(){
    const ins=DATA.insights||{};
    const wrap=document.getElementById("insWrap");
    if(ins.note || !(ins.conclusions||[]).length){
      wrap.innerHTML=`<div class="muted-box">${ins.note||"本期暂无足够高ROI样本提取共性。"}<br>
        建议导出<b>窗口对齐</b>的同期三表后再看复用洞察。</div>`;
      return;
    }
    let concl=`<div class="concl">`;
    (ins.conclusions||[]).forEach(c=>{concl+=`<div class="concl-card">
      <div class="c-dim">${c.dim}</div><div class="c-text">${c.text}</div><div class="c-act">${c.action}</div></div>`;});
    concl+=`</div>`;
    let cr=`<div class="panel" style="padding:14px"><div style="color:var(--muted);font-size:12px;margin-bottom:10px">
      高 ROI 且稳定的达人（成交≥2篇 · 波动越小越稳）</div><table class="creators-tbl"><thead><tr>
      <th class="lft">达人</th><th>成交篇数</th><th>ROI中位</th><th>波动(cv)</th></tr></thead><tbody>`;
    (ins.stable_creators||[]).forEach(s=>{cr+=`<tr><td class="lft cell-creator">${s.creator}</td>
      <td>${s.note_count}</td><td class="roi-pos">${f2(s.roi_median)}</td><td>${s.cv==null?"—":s.cv}</td></tr>`;});
    cr+=`</tbody></table>`;
    if((ins.stable_creators||[]).length===0) cr+=`<div style="color:var(--dim);font-size:12px;padding:8px">暂无单达人多篇成交样本</div>`;
    cr+=`</div>`;
    wrap.innerHTML=`<div class="ins-grid"><div>${concl}</div><div>${cr}</div></div>`;
  }

  // ---------- 启动 ----------
  function setMeta(){
    const m=DATA.meta||{};
    const align = m.align_ok
      ? `<span class="align-ok">● 窗口对齐</span>`
      : `<span class="align-warn">▲ ${m.align_msg||"窗口疑似未对齐"}</span>`;
    document.getElementById("sub").innerHTML=
      `数据周期 <b>${m.period||"—"}</b> · 口径 <b>${m.flow_type||"全部流量"}/${m.attr_period||30}天归因</b> · ${align}`;
  }
  setMeta(); renderKPI(); renderQuadrant(); initTableControls(); renderTable(); renderTrends(); renderInsights();
})();

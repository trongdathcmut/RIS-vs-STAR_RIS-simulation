'use strict';

const $ = id => document.getElementById(id);

const defaults = {
  n:256, fc_ghz:3, pt_dbm:30, bs_gain_dbi:10, blockage_db:40,
  obstacle:true, efficiency:0.9, split:0.5, mode:'ES',
  phase:'optimized', steer_deg:0, bits:0, seed:42
};

const defaultGeometry = {
  surface:[60,20,5],
  users:{R:[40,-10,1.5], T:[90,-10,1.5]},
  obstacles:[{min:[18,-12,0], max:[24,5,14]}]
};

const colors = {R:'#7659D2', T:'#EB9B2B', in:'#0898A6'};
const names = {
  NONE:'Không bề mặt', RIS:'RIS', ES:'STAR-RIS / ES',
  MS:'STAR-RIS / MS', TS:'STAR-RIS / TS'
};

let result = null;
let sceneGeometry = clone(defaultGeometry);
let requested = 0;
let timer;
let selectedElement = 0;
let animate = true;
let showBeamOverlay = true;
let topView = false;
let angle = -0.45;
let tilt = 0.62;
let zoom = 1;

let projection = null;
let projectionState = null;
let hitTargets = [];
let hoverTarget = null;
let orbitDrag = null;
let objectDrag = null;
let selectedObstacle = null;

function clone(v){
  return JSON.parse(JSON.stringify(v));
}

function config(){
  const c = {...defaults};
  for(const key of Object.keys(c)){
    const el = $(key);
    if(el){
      c[key] = el.type === 'checkbox'
        ? el.checked
        : el.tagName === 'SELECT' && key !== 'bits'
          ? el.value
          : Number(el.value);
    }
  }
  c.geometry = clone(sceneGeometry);
  return c;
}

function updateLabels(){
  const c = config();
  for(const [key,unit] of Object.entries({
    n:'', fc_ghz:' GHz', pt_dbm:' dBm', blockage_db:' dB'
  })){
    $(key+'-val').textContent = c[key] + unit;
  }
  $('efficiency-val').textContent = Math.round(c.efficiency*100)+'%';
  $('split-val').textContent = Math.round(c.split*100)+'%';
  $('steer_deg-val').textContent = (c.steer_deg>0?'+':'')+c.steer_deg+'°';
  $('steer-controls').hidden = c.phase !== 'steered';
  $('split').disabled = ['NONE','RIS'].includes(c.mode);
  $('blockage_db').disabled = !c.obstacle;
  syncPresetButtons();
  document.querySelectorAll('[data-n]').forEach(b=>b.classList.toggle('active', Number(b.dataset.n) === c.n));

  $('split-hint').textContent =
    c.mode === 'ES' ? `ES: βR = ${c.split.toFixed(2)} · βT = ${(1-c.split).toFixed(2)}`
    : c.mode === 'MS' ? `MS: ${Math.floor(c.n*c.split+0.5)} phần tử R · ${c.n-Math.floor(c.n*c.split+0.5)} phần tử T`
    : c.mode === 'TS' ? `TS: ${(100*c.split).toFixed(0)}% thời gian R · ${(100*(1-c.split)).toFixed(0)}% thời gian T`
    : 'Tỷ lệ chỉ áp dụng cho STAR-RIS.';
}

async function compute(){
  const seq = ++requested;
  const c = config();
  $('status').textContent = 'Đang tính bằng Python…';
  $('status').className = '';
  $('export').disabled = true;

  try{
    const response = await fetch('/api/simulate',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(c)
    });
    const data = await response.json();

    if(seq !== requested) return;
    if(!response.ok) throw Error(data.error || 'Không thể tính toán');

    result = data;

    // Python returns the normalized geometry. Keep the local scene in sync.
    sceneGeometry = {
      surface:clone(data.geometry.surface),
      users:clone(data.geometry.users),
      obstacles:clone(data.geometry.obstacles || [])
    };

    renderResults();
    $('status').textContent = `${c.n} phần tử · λ = ${(data.wavelength_m*100).toFixed(2)} cm`;
    $('export').disabled = false;
  }catch(error){
    if(seq === requested){
      $('status').textContent = 'Lỗi: ' + error.message + '. Kiểm tra Python server.';
      $('status').className = 'error';
    }
  }
}

function queue(delay=180){
  updateLabels();
  requested++;
  $('export').disabled = true;
  clearTimeout(timer);
  timer = setTimeout(compute, delay);
}

function fmt(v){
  return v === null ? '−∞' : v.toFixed(2);
}

function currentMode(){
  // Read the dropdown directly so the scene changes immediately,
  // without waiting for the next Python response.
  return $('mode') ? $('mode').value : (result?.config?.mode || 'ES');
}

function visibleSides(mode=currentMode()){
  // RIS is reflection-only: UE-T must disappear completely from the scene.
  return mode === 'RIS' ? ['R'] : ['R','T'];
}

function routeChoice(side, mode=currentMode()){
  if(!result) return 'direct';
  const c = result.config;
  if(mode === 'NONE') return 'direct';
  if(mode === 'RIS' && side === 'T') return 'hidden';

  const d = result.selected[side];
  if(d.duty === 0 || !d.weights.some(v => v>0)) return 'direct';
  const direct = Number.isFinite(d.direct_dbm) ? d.direct_dbm : -Infinity;
  const surface = Number.isFinite(d.surface_only_dbm) ? d.surface_only_dbm : -Infinity;

  // Compare the received power of the two candidate routes.
  // Only the stronger route is highlighted in the 3D scene.
  return surface > direct ? 'surface' : 'direct';
}

function routeText(side, mode=currentMode()){
  const choice = routeChoice(side, mode);
  const d = result.selected[side];
  if(choice === 'surface') return `TỐI ƯU: BS → ${mode === 'RIS' ? 'RIS' : 'STAR-RIS'} → UE`;
  if(choice === 'direct') return d.direct_blocked ? 'TỐI ƯU: TRỰC TIẾP' : 'TỐI ƯU: LOS';
  return '';
}

function renderResults(){
  const c = result.config;

  const tOption = document.querySelector('#side option[value="T"]');
  if(tOption) tOption.hidden = c.mode === 'RIS';
  const beamTOption = document.querySelector('#beam-side option[value="T"]');
  if(beamTOption) beamTOption.hidden = c.mode === 'RIS';
  if(c.mode === 'RIS' && $('side').value === 'T') $('side').value = 'R';
  $('beam-side').value = $('side').value;

  const tMetric = $('power-t').closest('article');
  if(tMetric) tMetric.style.display = c.mode === 'RIS' ? 'none' : '';
  // V5 places KPI cards in a vertical results rail.

  for(const s of ['R','T']){
    const d = result.selected[s];
    $('power-'+s.toLowerCase()).textContent = fmt(d.power_dbm);
    $('gain-'+s.toLowerCase()).textContent =
      `${d.gain_db>=0?'+':''}${d.gain_db.toFixed(2)} dB so với không bề mặt`;
  }

  $('scene-mode').textContent = names[c.mode];
  $('sweep-label').textContent = names[c.mode];

  renderDashboardDetails();
  renderBars();
  renderPhases();
  drawChart();
  drawPhasor();
  drawBeamCharts();
}

// V5 view helpers use exactly the same calculation results returned from Python.
function renderDashboardDetails(){
  if(!result) return;
  const c = result.config;
  $('fact-mode').textContent = names[c.mode];
  $('fact-n').textContent = `${c.n} phần tử`;
  $('fact-fc').textContent = `${c.fc_ghz} GHz`;
  $('fact-lambda').textContent = `${(result.wavelength_m * 100).toFixed(2)} cm`;
  $('fact-split').textContent = ['ES','MS','TS'].includes(c.mode)
    ? `${Math.round(c.split * 100)}% / ${Math.round((1-c.split) * 100)}%`
    : 'Không áp dụng';
  $('route-t-row').hidden = c.mode === 'RIS';
  for(const side of ['R','T']){
    const d = result.selected[side];
    const route = routeChoice(side,c.mode);
    const label = route === 'surface'
      ? `BS → ${c.mode === 'RIS' ? 'RIS' : 'STAR-RIS'} → UE-${side}`
      : d.direct_blocked ? `BS → UE-${side} (bị che)` : `BS → UE-${side} (LOS)`;
    $('route-'+side.toLowerCase()).textContent = label;
  }
}

function syncPresetButtons(){
  if(!$('scenario-buttons')) return;
  const mode = $('mode').value;
  const obstacle = $('obstacle').checked;
  const chosen = mode === 'NONE' ? (obstacle?'NLOS':'LOS')
    : mode === 'RIS' && obstacle ? 'RIS'
    : ['ES','MS','TS'].includes(mode) && obstacle ? 'STAR' : '';
  document.querySelectorAll('[data-scenario]').forEach(b=>{
    const active = b.dataset.scenario === chosen;
    b.classList.toggle('selected',active);
    b.setAttribute('aria-pressed',String(active));
  });
}

function renderBars(){
  const rows = result.comparison;
  const vals = rows.flatMap(r => [r.R.power_dbm,r.T.power_dbm]);
  const lo = Math.floor((Math.min(...vals)-8)/10)*10;
  const hi = Math.ceil((Math.max(...vals)+2)/10)*10;
  const labels = {
    LOS:'LOS', DIRECT:result.config.obstacle?'Vật cản':'Trực tiếp',
    RIS:'RIS', ES:'STAR ES', MS:'STAR MS', TS:'STAR TS'
  };

  $('bars').replaceChildren();

  for(const row of rows){
    const el = document.createElement('div');
    el.className = 'bar-row';

    const name = document.createElement('div');
    name.className = 'bar-name';
    name.textContent = labels[row.case];
    el.append(name);

    const tracks = document.createElement('div');
    for(const side of visibleSides(result.config.mode)){
      const track = document.createElement('div');
      track.className = 'bar-track';

      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = ((row[side].power_dbm-lo)/(hi-lo)*100)+'%';
      fill.style.background = colors[side];

      const value = document.createElement('span');
      value.className = 'bar-value';
      value.textContent = side+' '+fmt(row[side].power_dbm);

      track.append(fill,value);
      tracks.append(track);
    }
    el.append(tracks);
    $('bars').append(el);
  }

  const axis = document.createElement('div');
  axis.className = 'bar-labels';
  axis.innerHTML = `<span>${lo} dBm</span><span>${hi} dBm</span>`;
  $('bars').append(axis);
}

function phaseColor(v){
  return `hsl(${v},75%,65%)`;
}

function renderPhases(){
  const data = result.selected[$('side').value];
  const n = result.config.n;
  selectedElement = Math.min(selectedElement,n-1);

  const cols = Math.ceil(Math.sqrt(n));
  $('phase-grid').style.gridTemplateColumns = `repeat(${cols},1fr)`;
  $('phase-grid').style.gridTemplateRows = `repeat(${Math.ceil(n/cols)},1fr)`;

  const frag = document.createDocumentFragment();
  data.phi_deg.forEach((phi,i)=>{
    const b = document.createElement('button');
    b.style.background = phaseColor(phi);
    if(data.weights[i] === 0) b.className = 'inactive';
    b.title = `Phần tử ${i+1}: ${phi.toFixed(2)}°`;
    b.setAttribute('aria-label',b.title);
    b.onclick = ()=>{
      selectedElement = i;
      elementInfo();
    };
    frag.append(b);
  });

  $('phase-grid').replaceChildren(frag);
  elementInfo();
}

function elementInfo(){
  const d = result.selected[$('side').value];
  const i = selectedElement;
  $('element-info').textContent =
    `Phần tử ${i+1}: φ = ${d.phi_deg[i].toFixed(2)}° · √β = ${d.weights[i].toFixed(3)} · √(ηβ) = ${(Math.sqrt(result.config.efficiency)*d.weights[i]).toFixed(3)}${d.weights[i]===0?' · Không phục vụ UE này':''}`;
}

function canvasContext(id){
  const canvas = $(id);
  const box = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  if(
    canvas.width !== Math.round(box.width*ratio) ||
    canvas.height !== Math.round(box.height*ratio)
  ){
    canvas.width = Math.round(box.width*ratio);
    canvas.height = Math.round(box.height*ratio);
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,box.width,box.height);
  return {ctx,w:box.width,h:box.height};
}

function drawChart(){
  if(!result) return;
  const {ctx,w,h} = canvasContext('chart');
  const pad = {l:47,r:16,t:15,b:36};
  const series = result.sweep;

  const sides = visibleSides(result.config.mode);
  let values = series.flatMap(r => sides.flatMap(side => [
    r[side].power_dbm, r[side].direct_dbm
  ]));
  let min = Math.floor((Math.min(...values)-3)/10)*10;
  let max = Math.ceil((Math.max(...values)+3)/10)*10;
  if(max === min) max = min+10;

  const x = n => pad.l + Math.log2(n)/10*(w-pad.l-pad.r);
  const y = v => h-pad.b-(v-min)/(max-min)*(h-pad.b-pad.t);

  ctx.font = '12px Segoe UI';
  ctx.lineWidth = 1;

  for(let i=0;i<=4;i++){
    const v = min+(max-min)*i/4;
    ctx.strokeStyle = '#DCE6EF';
    ctx.beginPath();
    ctx.moveTo(pad.l,y(v));
    ctx.lineTo(w-pad.r,y(v));
    ctx.stroke();
    ctx.fillStyle = '#6B8297';
    ctx.fillText(v.toFixed(0),5,y(v)+4);
  }

  for(const n of [1,4,16,64,256,1024]){
    ctx.fillStyle = '#6B8297';
    ctx.textAlign = 'center';
    ctx.fillText(n,x(n),h-14);
  }
  ctx.textAlign = 'left';

  for(const side of sides){
    ctx.strokeStyle = colors[side];
    ctx.setLineDash([4,5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(1),y(series[0][side].direct_dbm));
    ctx.lineTo(x(1024),y(series[0][side].direct_dbm));
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((r,i) =>
      i ? ctx.lineTo(x(r.n),y(r[side].power_dbm))
        : ctx.moveTo(x(r.n),y(r[side].power_dbm))
    );
    ctx.stroke();

    for(const r of series){
      ctx.beginPath();
      ctx.arc(x(r.n),y(r[side].power_dbm),r.n===result.config.n?4:2,0,Math.PI*2);
      ctx.fillStyle = colors[side];
      ctx.fill();
    }
  }
}

function drawPhasor(){
  if(!result) return;
  const {ctx,w,h} = canvasContext('phasor');
  const d = result.selected[$('side').value];

  const max = Math.max(
    ...d.before_re.map((v,i)=>Math.hypot(v,d.before_im[i])),
    1e-30
  );
  const r = Math.min(h*.37,w*.35);
  const cx = w/2;
  const cy = h/2;

  ctx.strokeStyle = '#CEDBE7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.moveTo(cx-r-15,cy);
  ctx.lineTo(cx+r+15,cy);
  ctx.moveTo(cx,cy-r-15);
  ctx.lineTo(cx,cy+r+15);
  ctx.stroke();

  ctx.fillStyle = '#6B8297';
  ctx.font = '12px Segoe UI';
  ctx.fillText('Re',cx+r+7,cy+17);
  ctx.fillText('Im',cx+8,cy-r-6);

  const stride = Math.max(1,Math.ceil(d.phi_deg.length/64));

  for(const kind of ['before','after']){
    ctx.strokeStyle = kind === 'before' ? '#7C91A555' : colors[$('side').value];
    ctx.lineWidth = kind === 'before' ? 1 : 1.4;

    for(let i=0;i<d.phi_deg.length;i+=stride){
      const ex = cx+d[kind+'_re'][i]/max*r;
      const ey = cy-d[kind+'_im'][i]/max*r;
      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.lineTo(ex,ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex,ey,2,0,Math.PI*2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
  }

  if(d.weights.every(v=>v===0) || result.config.efficiency === 0){
    ctx.fillStyle = '#71869C';
    ctx.textAlign = 'center';
    ctx.fillText('Nhánh bề mặt không đóng góp công suất',cx,h-4);
    ctx.textAlign = 'left';
  }
}

function currentBeam(){
  if(!result) return null;
  // Suppress old data while an updated mode is pending in Python.
  if(result.config.mode !== currentMode()) return null;
  const data = result.selected[$('side').value];
  return data ? data.beam : null;
}

function beamToRadius(db,rad){
  // Use dB-to-visual-radius mapping to make main and side lobes legible.
  return rad * Math.max(0.025, (Math.max(-38,db)+38)/38);
}

function drawBeamCharts(){
  const canvasP = $('beam-polar');
  const canvasC = $('beam-pattern');
  if(!canvasP || !canvasC) return;
  const {ctx:p,w:pw,h:ph} = canvasContext('beam-polar');
  const {ctx:q,w:qw,h:qh} = canvasContext('beam-pattern');
  const side = $('side').value;
  $('beam-active-label').textContent = `Mặt cắt theo UE-${side}`;
  $('beam-side').value = side;
  const summary = $('beam-summary');
  const b = currentBeam();

  if(!b || !b.available){
    const reason = b?.reason || 'Chờ Python tính beam…';
    for(const [ctx,w,h] of [[p,pw,ph],[q,qw,qh]]){
      ctx.fillStyle = '#71869C';
      ctx.font = '14px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText('Chưa có beam từ RIS',w/2,h/2);
      ctx.textAlign = 'left';
    }
    summary.textContent = reason;
    return;
  }

  const color = colors[side];
  const angles = b.angles_deg;
  const dbs = b.relative_db;

  // Polar shape: 0 deg points horizontally to the right for both local normals.
  const cx = Math.max(25,pw*.22);
  const radius = Math.min(ph*.39,pw*.64);
  const cy = ph*.52;
  for(const v of [-30,-20,-10,0]){
    const rr = beamToRadius(v,radius);
    p.strokeStyle = '#D5E1EA';
    p.lineWidth = 1;
    p.beginPath();
    p.arc(cx,cy,rr,-Math.PI/2,Math.PI/2);
    p.stroke();
    p.font = '11px Segoe UI';
    p.fillStyle = '#6C839B';
    p.fillText(v+' dB',cx+rr+3,cy-5);
  }

  const polar = (theta,r) => [
    cx+Math.cos(theta*Math.PI/180)*r,
    cy-Math.sin(theta*Math.PI/180)*r
  ];

  for(const a of [-60,-30,0,30,60]){
    const end = polar(a,radius+3);
    p.strokeStyle = '#E0E9F0';
    p.beginPath();
    p.moveTo(cx,cy);
    p.lineTo(...end);
    p.stroke();
    const pos = polar(a,radius+14);
    p.fillStyle = '#6C839B';
    p.font = '11px Segoe UI';
    p.fillText(a+'°',pos[0]-9,pos[1]+4);
  }

  // Actual Python-computed array-factor envelope: NOT a fixed decorative cone.
  p.beginPath();
  p.moveTo(cx,cy);
  angles.forEach((a,i)=>p.lineTo(...polar(a,beamToRadius(dbs[i],radius))));
  p.closePath();
  p.fillStyle = side==='R'?'#7659D240':'#EB9B2B40';
  p.strokeStyle = color;
  p.lineWidth = 1.9;
  p.fill();
  p.stroke();

  function beamReferenceLine(theta,color,style=[]){
    if(theta < -80 || theta > 80) return;
    p.beginPath();
    p.moveTo(cx,cy);
    p.lineTo(...polar(theta,radius+2));
    p.strokeStyle = color;
    p.lineWidth = 1.6;
    p.setLineDash(style);
    p.stroke();
    p.setLineDash([]);
  }
  beamReferenceLine(b.ue_angle_deg,'#365E79',[4,4]);
  beamReferenceLine(b.peak_angle_deg,color);

  p.fillStyle = '#71869C';
  p.font = '11px Segoe UI';
  p.fillText('— Đỉnh beam',8,ph-29);
  p.fillText('┄ Hướng UE',8,ph-11);

  // Cartesian slice from -80 to +80 degrees, 0 dB referenced to THIS beam peak.
  const pad = {l:47,r:16,t:15,b:42};
  const x = a => pad.l + (a+80)/160*(qw-pad.l-pad.r);
  const y = db => pad.t + (0-Math.max(-40,db))/40*(qh-pad.t-pad.b);
  q.font='11px Segoe UI';
  q.lineWidth=1;
  for(const db of [-40,-30,-20,-10,0]){
    q.strokeStyle='#DDE7F0';
    q.beginPath();
    q.moveTo(pad.l,y(db));
    q.lineTo(qw-pad.r,y(db));
    q.stroke();
    q.fillStyle='#6C839B';
    q.fillText(db+' dB',4,y(db)+4);
  }
  for(const a of [-80,-40,0,40,80]){
    q.strokeStyle='#E5EDF4';
    q.beginPath();
    q.moveTo(x(a),pad.t);
    q.lineTo(x(a),qh-pad.b);
    q.stroke();
    q.fillStyle='#6C839B';
    q.textAlign='center';
    q.fillText(a+'°',x(a),qh-24);
  }
  q.textAlign='left';
  q.fillText('Góc phương vị θ',pad.l+4,qh-7);

  q.beginPath();
  angles.forEach((a,i)=>i?q.lineTo(x(a),y(dbs[i])):q.moveTo(x(a),y(dbs[i])));
  q.strokeStyle = color;
  q.lineWidth = 2.1;
  q.stroke();

  // Mark the actual UE direction even when it is outside the chart.
  if(Math.abs(b.ue_angle_deg)<=80){
    q.beginPath();
    q.moveTo(x(b.ue_angle_deg),pad.t);
    q.lineTo(x(b.ue_angle_deg),qh-pad.b);
    q.setLineDash([4,4]);
    q.strokeStyle = '#5B7288';
    q.lineWidth = 1.3;
    q.stroke();
    q.setLineDash([]);
  }

  q.fillStyle=color;
  q.beginPath();
  q.arc(x(b.peak_angle_deg),y(0),4,0,Math.PI*2);
  q.fill();

  const diff=Math.abs(b.peak_angle_deg-b.ue_angle_deg);
  const c = result.config;
  const desc = c.phase === 'optimized'
    ? 'Căn pha theo kênh đến UE: tín hiệu qua các phần tử cộng đồng pha tại UE.'
    : c.phase === 'steered'
    ? `Pha được lập trình theo góc lái ${c.steer_deg>=0?'+':''}${c.steer_deg}°. Đổi thanh góc lái để quan sát beam quay.`
    : c.phase === 'random'
    ? 'Pha ngẫu nhiên: có thể xuất hiện nhiều thùy phụ, không nhất thiết chĩa vào UE.'
    : 'Pha 0° không đồng nghĩa beam vuông góc RIS: pha sóng tới từ BS vẫn ảnh hưởng hướng beam.';

  const within = diff <= 6;
  summary.innerHTML =
    `<strong>Đỉnh beam: ${b.peak_angle_deg.toFixed(0)}°</strong> · UE ở ${b.ue_angle_deg.toFixed(1)}° `+
    `· Lệch ${diff.toFixed(1)}° <span class="beam-hint">`+
    `Mức cộng trường tại hướng UE: ${b.coherent_at_ue_db.toFixed(1)} dB so với cộng đồng pha lý tưởng. `+
    `${within?'Beam đang hướng gần UE.':'Beam đang lệch hướng UE.'} ${desc}</span>`;
}

function addHitTarget(type, point, radius, extra={}){
  const q = projection(point);
  hitTargets.push({type, sx:q[0], sy:q[1], radius, ...extra});
}

function targetAt(x,y){
  let best = null;
  let bestDistance = Infinity;

  for(const target of hitTargets){
    const d = Math.hypot(x-target.sx,y-target.sy);
    if(d <= target.radius && d < bestDistance){
      best = target;
      bestDistance = d;
    }
  }
  return best;
}

function sameTarget(a,b){
  if(!a || !b) return false;
  return a.type === b.type && a.side === b.side && a.index === b.index;
}

function clamp(v,lo,hi){
  return Math.max(lo,Math.min(hi,v));
}

function movePointXY(point,dx,dy){
  point[0] = clamp(point[0]+dx,-20,120);
  point[1] = clamp(point[1]+dy,-50,60);
}

function screenDeltaToWorld(dxScreen,dyScreen){
  if(!projectionState) return [0,0];

  const {rot,elev,scale} = projectionState;
  const u = dxScreen / scale;
  const sinElev = Math.max(0.12,Math.sin(elev));
  const v = dyScreen / (sinElev*scale);

  const dx = u*Math.cos(rot) + v*Math.sin(rot);
  const dy = -u*Math.sin(rot) + v*Math.cos(rot);
  return [dx,dy];
}

function drawScene(time){
  const {ctx,w,h} = canvasContext('scene');

  const bg = ctx.createRadialGradient(
    w/2,h/2,10,w/2,h/2,Math.max(w,h)*.65
  );
  bg.addColorStop(0,'#FCFEFF');
  bg.addColorStop(1,'#E9F1F8');
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,w,h);

  const rot = topView ? 0 : angle;
  const elev = topView ? 1.48 : tilt;
  const scale = Math.min(w/130,h/75)*zoom;

  projectionState = {rot,elev,scale,w,h};

  projection = p => {
    const x = p[0]-47;
    const y = p[1]-5;
    const z = p[2];
    return [
      w/2+(x*Math.cos(rot)-y*Math.sin(rot))*scale,
      h*.59+(x*Math.sin(rot)+y*Math.cos(rot))*Math.sin(elev)*scale-z*Math.cos(elev)*scale
    ];
  };

  const project = projection;
  hitTargets = [];

  function path(points,color,width=1,dash=[]){
    ctx.beginPath();
    points.forEach((p,i)=>{
      const q = project(p);
      i ? ctx.lineTo(...q) : ctx.moveTo(...q);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function polygon(points,fill,stroke){
    const q = points.map(project);
    ctx.beginPath();
    q.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if(stroke){
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function label(text,p,color='#3F637D',dy=0){
    const q = project(p);
    ctx.font = (w<500?'11':'13')+'px Segoe UI';
    ctx.textAlign = 'center';
    const len = ctx.measureText(text).width;
    ctx.fillStyle = '#FFFFFFEA';
    ctx.fillRect(q[0]-len/2-6,q[1]+dy-13,len+12,21);
    ctx.fillStyle = color;
    ctx.fillText(text,q[0],q[1]+dy+2);
    ctx.textAlign = 'left';
  }

  function selectionRing(target,color){
    if(!target) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3,4]);
    ctx.beginPath();
    ctx.arc(target.sx,target.sy,target.radius+5,0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  for(let x=-10;x<=110;x+=10){
    path([[x,-30,0],[x,40,0]],'#D8E4ED',.75);
  }
  for(let y=-30;y<=40;y+=10){
    path([[-10,y,0],[110,y,0]],'#D8E4ED',.75);
  }

  path([[sceneGeometry.surface[0],-30,0],[sceneGeometry.surface[0],40,0]],'#94AAB9',1,[4,6]);
  if(w>=500){
    if(currentMode()!=='NONE') label('PHÍA PHẢN XẠ',[sceneGeometry.surface[0]-23,36,0],'#7659D2');
    if(currentMode()!=='RIS' && currentMode()!=='NONE') label('PHÍA TRUYỀN QUA',[sceneGeometry.surface[0]+27,36,0],'#C08325');
  }

  if(!result){
    requestAnimationFrame(drawScene);
    return;
  }

  const g = sceneGeometry;
  const c = result.config;
  const displayMode = currentMode();
  const bs = result.geometry.bs;
  const s = g.surface;
  const ur = g.users.R;
  const ut = g.users.T;

  function ray(a,b,color,highlight=true){
    // The losing route stays faint so the alternative is still visible,
    // while only the selected/optimal route glows and animates.
    path([a,b],highlight?color:color+'24',highlight?2.35:.85,[5,5]);

    if(highlight && animate){
      for(let i=0;i<3;i++){
        const t = ((time/2600+i/3)%1);
        const pos = a.map((v,j)=>v+(b[j]-v)*t);
        const q = project(pos);
        ctx.beginPath();
        ctx.arc(...q,3,0,Math.PI*2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 11;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  const sides = visibleSides(displayMode);
  const choices = Object.fromEntries(sides.map(side => [side,routeChoice(side, displayMode)]));

  // Beam envelope is drawn from the Python array factor. Only winning
  // surface routes get a luminous filled lobe; losing ones stay almost invisible.
  if(showBeamOverlay && displayMode !== 'NONE' && result.config.mode === displayMode){
    for(const side of sides){
      const beam = result.selected[side]?.beam;
      if(!beam?.available) continue;
      const preferred = choices[side] === 'surface';
      const factor = preferred ? 1 : .12;
      const distance = Math.hypot(
        g.users[side][0]-s[0],g.users[side][1]-s[1]
      );
      const maxLength = Math.max(15,Math.min(31,distance*.72));
      const normal = side==='R' ? -1 : 1;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(...project(s));
      for(let i=0;i<beam.angles_deg.length;i++){
        const az = beam.angles_deg[i] * Math.PI / 180;
        const db = beam.relative_db[i];
        const strength = Math.max(.06,(Math.max(-35,db)+35)/35);
        const r = maxLength*strength;
        const dest = [
          s[0]+normal*Math.cos(az)*r,
          s[1]+Math.sin(az)*r,
          s[2]
        ];
        ctx.lineTo(...project(dest));
      }
      ctx.closePath();
      ctx.fillStyle = side==='R'?'#c5a5ff':'#f6be68';
      ctx.globalAlpha = preferred ? .14 : .012;
      if(preferred){
        ctx.shadowColor = colors[side];
        ctx.shadowBlur = 17;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = preferred ? .58 : .06;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colors[side];
      ctx.stroke();
      ctx.restore();
    }
  }

  // Direct route: only glow when it is the stronger candidate.
  for(const side of sides){
    const ue = side === 'R' ? ur : ut;
    const blocked = !!result.selected[side].direct_blocked;
    const selected = choices[side] === 'direct';
    ray(bs,ue,blocked?'#DA6D72':'#6797CA',selected);
  }

  if(displayMode !== 'NONE'){
    // BS → surface is shared. It glows if at least one visible UE chooses the surface route.
    const surfaceSelected = sides.some(side => choices[side] === 'surface');
    const inBlocked = !!result.selected.R.bs_surface_blocked;
    ray(bs,s,inBlocked?'#DA6D72':colors.in,surfaceSelected);

    for(const side of sides){
      const ue = side === 'R' ? ur : ut;
      const blocked = !!result.selected[side].surface_user_blocked;
      const selected = choices[side] === 'surface';
      ray(s,ue,blocked?'#DA6D72':colors[side],selected);
    }
  }

  // Draw every obstacle using the original visual style.
  if(c.obstacle){
    g.obstacles.forEach((wall,index)=>{
      const [x,y,z] = wall.min;
      const [X,Y,Z] = wall.max;

      polygon([[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],'#AEB9C8E8','#8B9BAD');
      polygon([[X,y,z],[X,Y,z],[X,Y,Z],[X,y,Z]],'#9AAABCED','#8293A4');
      polygon([[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]],'#D0DAE5EC','#A5B5C6');

      const center = [(x+X)/2,(y+Y)/2,(z+Z)/2];
      label(
        w<500 ? `Vật cản ${index+1}` : `Vật cản ${index+1} · ${c.blockage_db} dB`,
        [center[0],center[1],Z+3],
        '#8E5667'
      );
      addHitTarget('obstacle',center,34,{index});
    });
  }

  // Antenna tower: unchanged.
  const b0 = [bs[0],bs[1],0];
  const btop = [bs[0],bs[1],bs[2]+8];
  path([[bs[0]-2,bs[1],0],btop,[bs[0]+2,bs[1],0]],'#168DA1',2);

  for(let z=2;z<14;z+=3){
    const t = 2*(1-z/16);
    path([[bs[0]-t,bs[1],z],[bs[0]+t,bs[1],z+2]],'#168DA1',1);
  }

  const bq = project(btop);
  ctx.strokeStyle = colors.in;
  ctx.lineWidth = 2;
  for(const direction of [-1,1]){
    for(const r of [9,16]){
      ctx.beginPath();
      ctx.arc(
        bq[0],bq[1]-3,r,
        direction===1?-.7:Math.PI-.7,
        direction===1?.7:Math.PI+.7
      );
      ctx.stroke();
    }
  }
  label(w<500?'BS':'BS · ăng-ten',b0,colors.in,23);

  // Surface rendering: same look, but anchored to the moved surface coordinates.
  if(displayMode !== 'NONE'){
    const data = result.selected[$('side').value];
    const cols = Math.ceil(Math.sqrt(c.n));
    const rows = Math.ceil(c.n/cols);
    const size = 17;
    const baseZ = Math.max(0,s[2]-5);

    polygon([
      [s[0],s[1]-size/2,baseZ],
      [s[0],s[1]+size/2,baseZ],
      [s[0],s[1]+size/2,baseZ+size],
      [s[0],s[1]-size/2,baseZ+size]
    ],'#E7F4F6','#5E91A2');

    for(let i=0;i<c.n;i++){
      const row = Math.floor(i/cols);
      const col = i%cols;
      const y0 = s[1]-size/2+col*size/cols;
      const z0 = baseZ+row*size/rows;
      const gap = .08;

      polygon([
        [s[0],y0+gap,z0+gap],
        [s[0],y0+size/cols-gap,z0+gap],
        [s[0],y0+size/cols-gap,z0+size/rows-gap],
        [s[0],y0+gap,z0+size/rows-gap]
      ],data.weights[i]===0?'#D6DEE8':phaseColor(data.phi_deg[i]));
    }

    label(
      w<500?(displayMode==='RIS'?'RIS':'STAR-RIS'):`${displayMode==='RIS'?'RIS':'STAR-RIS'} · ${c.n} phần tử`,
      [s[0],s[1],baseZ+20],
      colors.in
    );

    if(w>=500){
      label('Bề mặt hiển thị phóng đại',[s[0],s[1],baseZ-1],'#6F8799',21);
    }

    addHitTarget('surface',[s[0],s[1],baseZ+size/2],38);
  }

  for(const side of sides){
    const p = g.users[side];
    const q = project(p);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = colors[side];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(q[0]-8,q[1]-20,16,29,3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors[side]+'44';
    ctx.fillRect(q[0]-5,q[1]-15,10,16);
    ctx.beginPath();
    ctx.arc(q[0],q[1]+5,1.2,0,Math.PI*2);
    ctx.fillStyle = colors[side];
    ctx.fill();

    label(
      w<500?`UE-${side}`:`UE-${side} · ${fmt(result.selected[side].power_dbm)} dBm`,
      p,colors[side],31
    );

    if(w>=500){
      const choice = routeChoice(side, displayMode);
      const routeColor = choice === 'surface' ? colors[side] : '#4C85B0';
      label(routeText(side, displayMode),p,routeColor,55);
    }

    addHitTarget('ue',p,27,{side});
  }

  const currentTarget = objectDrag ? objectDrag.target : hoverTarget;
  if(currentTarget){
    const actual = hitTargets.find(t=>sameTarget(t,currentTarget));
    selectionRing(actual,'#0898A6');
  }

  requestAnimationFrame(drawScene);
}

function download(name,data,type){
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([data],{type}));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

function applyModeVisibilityImmediately(){
  const mode = currentMode();
  const tOption = document.querySelector('#side option[value="T"]');
  if(tOption) tOption.hidden = mode === 'RIS';
  const beamTOption = document.querySelector('#beam-side option[value="T"]');
  if(beamTOption) beamTOption.hidden = mode === 'RIS';
  if(mode === 'RIS' && $('side').value === 'T') $('side').value = 'R';
  $('beam-side').value = $('side').value;

  const tMetric = $('power-t')?.closest('article');
  if(tMetric) tMetric.style.display = mode === 'RIS' ? 'none' : '';

  const tRoute = $('route-t-row');
  if(tRoute) tRoute.hidden = mode === 'RIS';
}

$('mode').addEventListener('input', applyModeVisibilityImmediately);

for(const key of Object.keys(defaults)){
  const el = $(key);
  if(el) el.addEventListener('input',queue);
}

document.querySelectorAll('[data-n]').forEach(b=>{
  b.onclick = ()=>{
    $('n').value = b.dataset.n;
    queue();
  };
});

$('beam-side').onchange = ()=>{
  $('side').value = $('beam-side').value;
  $('side').dispatchEvent(new Event('change'));
};

$('side').onchange = ()=>{
  if(result){
    renderPhases();
    drawPhasor();
    drawBeamCharts();
  }
};

$('reset').onclick = ()=>{
  for(const [key,value] of Object.entries(defaults)){
    const el = $(key);
    if(el){
      if(el.type === 'checkbox') el.checked = value;
      else el.value = value;
    }
  }

  sceneGeometry = clone(defaultGeometry);
  angle = -.45;
  tilt = .62;
  zoom = 1;
  topView = false;
  selectedElement = 0;
  selectedObstacle = null;
  showBeamOverlay = true;
  $('beam-overlay').textContent = 'Ẩn beam';
  $('beam-overlay').setAttribute('aria-pressed','true');
  $('side').value = 'R';
  $('beam-side').value = 'R';
  $('view').textContent = 'Góc nhìn trên';
  queue(0);
};

$('view').onclick = ()=>{
  topView = !topView;
  $('view').textContent = topView ? 'Góc nhìn 3D' : 'Góc nhìn trên';
};

$('beam-overlay').onclick = ()=>{
  showBeamOverlay = !showBeamOverlay;
  $('beam-overlay').textContent = showBeamOverlay ? 'Ẩn beam' : 'Hiện beam';
  $('beam-overlay').setAttribute('aria-pressed',showBeamOverlay?'true':'false');
};

$('motion').onclick = ()=>{
  animate = !animate;
  $('motion').textContent = animate ? 'Dừng sóng' : 'Chạy sóng';
};

$('add-obstacle').onclick = ()=>{
  if(sceneGeometry.obstacles.length >= 12){
    $('status').textContent = 'Tối đa 12 vật cản.';
    return;
  }

  const i = sceneGeometry.obstacles.length;
  const x = 32 + (i%4)*9;
  const y = -2 + Math.floor(i/4)*10;

  sceneGeometry.obstacles.push({
    min:[x,y,0],
    max:[x+6,y+10,12]
  });

  $('obstacle').checked = true;
  selectedObstacle = sceneGeometry.obstacles.length-1;
  queue(0);
};

$('export').onclick = ()=>{
  if(!result) return;
  download(
    'ris_star_ris_result.json',
    JSON.stringify(result,null,2),
    'application/json'
  );
};

$('png').onclick = ()=>{
  $('scene').toBlob(blob=>{
    if(blob){
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ris_star_ris_scene.png';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
    }
  });
};

function pointerPosition(e){
  const rect = $('scene').getBoundingClientRect();
  return [e.clientX-rect.left,e.clientY-rect.top];
}

$('scene').onpointerdown = e=>{
  const [x,y] = pointerPosition(e);
  const target = targetAt(x,y);

  $('scene').setPointerCapture(e.pointerId);

  if(target){
    objectDrag = {
      target:{...target},
      lastX:e.clientX,
      lastY:e.clientY
    };
    selectedObstacle = target.type === 'obstacle' ? target.index : selectedObstacle;
    $('scene').style.cursor = 'grabbing';
  }else{
    orbitDrag = [e.clientX,e.clientY];
    $('scene').style.cursor = 'grabbing';
  }
};

$('scene').onpointermove = e=>{
  if(objectDrag){
    const dsx = e.clientX-objectDrag.lastX;
    const dsy = e.clientY-objectDrag.lastY;
    const [dx,dy] = screenDeltaToWorld(dsx,dsy);
    const target = objectDrag.target;

    if(target.type === 'ue'){
      movePointXY(sceneGeometry.users[target.side],dx,dy);
    }else if(target.type === 'surface'){
      movePointXY(sceneGeometry.surface,dx,dy);
    }else if(target.type === 'obstacle'){
      const wall = sceneGeometry.obstacles[target.index];
      if(wall){
        for(const p of [wall.min,wall.max]){
          p[0] += dx;
          p[1] += dy;
        }

        // Keep entire obstacle within the scene bounds.
        const shiftX =
          wall.min[0] < -20 ? -20-wall.min[0]
          : wall.max[0] > 120 ? 120-wall.max[0] : 0;
        const shiftY =
          wall.min[1] < -50 ? -50-wall.min[1]
          : wall.max[1] > 60 ? 60-wall.max[1] : 0;

        if(shiftX || shiftY){
          for(const p of [wall.min,wall.max]){
            p[0] += shiftX;
            p[1] += shiftY;
          }
        }
      }
    }

    objectDrag.lastX = e.clientX;
    objectDrag.lastY = e.clientY;

    // Debounced Python recomputation. The scene moves immediately;
    // results update shortly after the user pauses dragging.
    queue(140);
    return;
  }

  if(orbitDrag){
    angle += (e.clientX-orbitDrag[0])*.007;
    tilt = Math.max(.15,Math.min(1.4,tilt+(e.clientY-orbitDrag[1])*.006));
    orbitDrag = [e.clientX,e.clientY];
    return;
  }

  const [x,y] = pointerPosition(e);
  hoverTarget = targetAt(x,y);

  if(hoverTarget){
    $('scene').style.cursor = 'grab';
  }else{
    $('scene').style.cursor = 'move';
  }
};

function finishPointer(){
  const movedObject = !!objectDrag;
  objectDrag = null;
  orbitDrag = null;
  hoverTarget = null;
  $('scene').style.cursor = 'move';

  if(movedObject){
    clearTimeout(timer);
    compute();
  }
}

$('scene').onpointerup = finishPointer;
$('scene').onpointercancel = finishPointer;
$('scene').onpointerleave = ()=>{
  if(!objectDrag && !orbitDrag){
    hoverTarget = null;
    $('scene').style.cursor = 'move';
  }
};

$('scene').addEventListener('wheel',e=>{
  e.preventDefault();
  zoom = Math.max(.65,Math.min(1.6,zoom-e.deltaY*.001));
},{passive:false});

window.addEventListener('resize',()=>{
  drawChart();
  drawPhasor();
  drawBeamCharts();
});

// Quick scenarios: only set existing model inputs; no new propagation math.
const scenarioValues = {
  LOS:  {mode:'NONE',obstacle:false},
  NLOS: {mode:'NONE',obstacle:true},
  RIS:  {mode:'RIS',obstacle:true},
  STAR: {mode:'ES',obstacle:true}
};
document.querySelectorAll('[data-scenario]').forEach(button=>{
  button.addEventListener('click',()=>{
    const scenario = scenarioValues[button.dataset.scenario];
    $('mode').value = scenario.mode;
    $('obstacle').checked = scenario.obstacle;
    applyModeVisibilityImmediately();
    queue(0);
  });
});

$('remove-obstacle').addEventListener('click',()=>{
  if(!sceneGeometry.obstacles.length){
    $('status').textContent='Không có vật cản để xóa.';
    return;
  }
  const index = Number.isInteger(selectedObstacle) && selectedObstacle >= 0 && selectedObstacle < sceneGeometry.obstacles.length
    ? selectedObstacle : sceneGeometry.obstacles.length-1;
  sceneGeometry.obstacles.splice(index,1);
  selectedObstacle = null;
  queue(0);
});

$('presentation').addEventListener('click',()=>{
  const active = document.body.classList.toggle('presentation-mode');
  $('presentation').setAttribute('aria-pressed',String(active));
  $('presentation').innerHTML = active ? '▣ <span>Thoát trình chiếu</span>' : '⛶ <span>Trình chiếu</span>';
  window.scrollTo({top:0,behavior:'smooth'});
  setTimeout(()=>{drawChart();drawPhasor();drawBeamCharts();},90);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && document.body.classList.contains('presentation-mode')) $('presentation').click();
});

applyModeVisibilityImmediately();
updateLabels();
compute();
requestAnimationFrame(drawScene);

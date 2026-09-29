const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const port = Number(process.env.PORT || 4004);
const facilities = [
  { id: 'PHC-01', name: 'Kendrapara Central', area: 'Kendrapara', status: 'Connected', hours: 120, lat: 20.50, lon: 86.42 },
  { id: 'PHC-02', name: 'Pattamundai', area: 'Pattamundai', status: 'Connected', hours: 96, lat: 20.58, lon: 86.56 },
  { id: 'PHC-03', name: 'Aul', area: 'Aul', status: 'Connected', hours: 72, lat: 20.67, lon: 86.65 },
  { id: 'PHC-04', name: 'Rajnagar', area: 'Rajnagar', status: 'Watch', hours: 58, lat: 20.48, lon: 86.73 },
  { id: 'PHC-05', name: 'Mahakalpara', area: 'Mahakalpara', status: 'Connected', hours: 88, lat: 20.43, lon: 86.57 },
  { id: 'PHC-06', name: 'Derabish', area: 'Derabish', status: 'Connected', hours: 110, lat: 20.48, lon: 86.35 },
  { id: 'PHC-07', name: 'Marshaghai', area: 'Marshaghai', status: 'Connected', hours: 82, lat: 20.33, lon: 86.44 },
  { id: 'PHC-08', name: 'Garadpur', area: 'Garadpur', status: 'Connected', hours: 104, lat: 20.57, lon: 86.46 },
  { id: 'PHC-09', name: 'Gopalpur', area: 'Gopalpur', status: 'Connected', hours: 70, lat: 20.62, lon: 86.78 },
  { id: 'PHC-10', name: 'Jamboo', area: 'Jamboo', status: 'Connected', hours: 64, lat: 20.35, lon: 86.69 }
];
const medicines = [
  { id: 'MED-001', name: 'ORS sachets', category: 'Essential', unit: 'sachets', controlled: false },
  { id: 'MED-002', name: 'Paracetamol 500 mg', category: 'Essential', unit: 'tablets', controlled: false },
  { id: 'MED-003', name: 'Amoxicillin 500 mg', category: 'Antibiotic', unit: 'capsules', controlled: false },
  { id: 'MED-004', name: 'Insulin 40 IU', category: 'Cold chain', unit: 'vials', controlled: true },
  { id: 'MED-005', name: 'Oxytocin 10 IU', category: 'Maternal health', unit: 'ampoules', controlled: true },
  { id: 'MED-006', name: 'Zinc 20 mg', category: 'Essential', unit: 'tablets', controlled: false }
];
const stock = [];
for (const f of facilities) for (const m of medicines) {
  const base = f.id === 'PHC-04' ? [3, 4, 2, 8, 12, 5][medicines.indexOf(m)] : 10 + ((Number(f.id.slice(-2)) * 7 + medicines.indexOf(m) * 11) % 30);
  stock.push({ facilityId: f.id, medicineId: m.id, onHand: base * 10, dailyUse: f.id === 'PHC-04' ? [24, 20, 8, 1, 2, 10][medicines.indexOf(m)] : 3 + ((Number(f.id.slice(-2)) + medicines.indexOf(m)) % 7), safetyDays: 4 });
}
let floodActive = false;
let transfers = [];
let logs = [];
function hashEntry(previousHash, event) { return crypto.createHash('sha256').update(previousHash + JSON.stringify(event)).digest('hex'); }
function audit(action, transferId, detail) {
  const event = { id: `AUD-${String(logs.length + 1).padStart(4, '0')}`, at: new Date().toISOString(), action, transferId, detail, previousHash: logs.at(-1)?.hash || 'GENESIS' };
  event.hash = hashEntry(event.previousHash, event); logs.push(event);
}
function calculate() {
  return facilities.map(f => {
    const atRisk = floodActive && f.id === 'PHC-04';
    const lines = stock.filter(s => s.facilityId === f.id).map(s => {
      const med = medicines.find(m => m.id === s.medicineId);
      const days = +(s.onHand / s.dailyUse).toFixed(1);
      return { ...s, medicine: med.name, unit: med.unit, controlled: med.controlled, days, shortage: atRisk && days < f.hours / 24 };
    });
    return { ...f, status: atRisk ? 'At risk' : f.id === 'PHC-04' ? 'Watch' : f.status, isolationHours: atRisk ? f.hours : null, lines };
  });
}
function proposals() {
  const all = calculate(), target = all.find(f => f.id === 'PHC-04');
  if (!floodActive) return [];
  const out = [];
  for (const line of target.lines.filter(x => x.shortage)) {
    const donor = all.filter(f => f.id !== target.id).map(f => ({ facility: f, line: f.lines.find(l => l.medicineId === line.medicineId) }))
      .filter(x => x.line && x.line.onHand - x.line.dailyUse * x.line.safetyDays >= line.dailyUse * 2)
      .sort((a,b) => a.facility.hours - b.facility.hours)[0];
    if (!donor) { out.push({ id: `TR-${Date.now()}-${line.medicineId}`, targetId: target.id, target: target.name, medicine: line.medicine, quantity: 0, unit: line.unit, status: 'NO_DONOR_ESCALATE', explanation: `No donor has safe surplus for ${line.medicine}. Escalate for district-level action.` }); continue; }
    const qty = Math.min(Math.ceil(line.dailyUse * (target.isolationHours / 24 + 2) - line.onHand), donor.line.onHand - donor.line.dailyUse * donor.line.safetyDays);
    if (qty <= 0) continue;
    out.push({ id: `TR-${Date.now()}-${line.medicineId}`, targetId: target.id, target: target.name, donorId: donor.facility.id, donor: donor.facility.name, medicineId: line.medicineId, medicine: line.medicine, quantity: qty, unit: line.unit, route: `${donor.facility.area} → Rajnagar`, hoursToIsolation: target.isolationHours, controlled: line.controlled, status: line.controlled ? 'PENDING_CMO' : 'AUTO_STAGED', explanation: `${target.name} has ${line.days} days of ${line.medicine}; access may close in ${target.isolationHours} hours. ${donor.facility.name} can safely provide ${qty} ${line.unit}.` });
  }
  return out;
}
function verifyAudit() { let prev = 'GENESIS'; for (const e of logs) { const copy = { ...e }; delete copy.hash; if (e.previousHash !== prev || hashEntry(prev, copy) !== e.hash) return false; prev = e.hash; } return true; }
function send(res, code, data, type='application/json') { res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*' }); res.end(type === 'application/json' ? JSON.stringify(data) : data); }
async function body(req) { let s=''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin':'*', 'access-control-allow-methods':'GET,POST', 'access-control-allow-headers':'content-type' }); return res.end(); }
  if (url.pathname === '/api/overview') return send(res,200,{ facilities:calculate(), medicines, transfers, audit:logs, floodActive, auditValid:verifyAudit(), summary:{ atRisk:calculate().filter(f=>f.status==='At risk').length, pending:transfers.filter(t=>t.status==='PENDING_CMO').length, staged:transfers.filter(t=>t.status==='AUTO_STAGED').length, escalations:transfers.filter(t=>t.status==='NO_DONOR_ESCALATE').length } });
  if (url.pathname === '/api/flood' && req.method === 'POST') { const b=await body(req); floodActive=!!b.active; audit('FLOOD_BULLETIN',null,{active:floodActive, zone:'Rajnagar'}); return send(res,200,{floodActive}); }
  if (url.pathname === '/api/propose' && req.method === 'POST') { const items=proposals(); for(const t of items){ transfers.unshift(t); audit('TRANSFER_PROPOSED',t.id,{status:t.status,target:t.target,medicine:t.medicine,quantity:t.quantity}); } return send(res,200,{items}); }
  const decide=url.pathname.match(/^\/api\/transfers\/([^/]+)\/decision$/);
  if (decide && req.method==='POST') { const b=await body(req), t=transfers.find(x=>x.id===decide[1]); if(!t) return send(res,404,{error:'Transfer not found'}); if(t.status!=='PENDING_CMO') return send(res,409,{error:'Only pending transfers require a CMO decision'}); if(!['APPROVED','REJECTED'].includes(b.decision)) return send(res,400,{error:'Decision must be APPROVED or REJECTED'}); t.status=b.decision; t.decidedBy=b.decidedBy||'District CMO'; t.decidedAt=new Date().toISOString(); audit('TRANSFER_'+b.decision,t.id,{decidedBy:t.decidedBy}); return send(res,200,t); }
  if (url.pathname === '/api/audit/verify') return send(res,200,{valid:verifyAudit(),entries:logs.length});
  if (url.pathname.startsWith('/api/')) return send(res,404,{error:'Not found'});
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); const target=path.join(__dirname,'public',file); if(!target.startsWith(path.join(__dirname,'public'))) return send(res,403,'Forbidden','text/plain');
  fs.readFile(target,(err,data)=>err?send(res,404,'Not found','text/plain'):send(res,200,data,file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html'));
});
server.listen(port,()=>console.log(`PHC Rebalancing demo listening at http://localhost:${port}`));

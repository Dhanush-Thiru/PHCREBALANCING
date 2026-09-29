const cds = require('@sap/cds');
const crypto = require('node:crypto');

const { SELECT, INSERT, UPDATE } = cds;
const FALLBACK = items => items.map(x => `${x.targetName} has ${x.daysOnHand} days of ${x.medicineName}; road access may close in ${x.hoursToIsolation} hours. ${x.quantity} ${x.unit} are proposed from ${x.donorName}.`).join(' ');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(previousHash, payload) {
  return crypto.createHash('sha256').update(`${previousHash}\n${canonical(payload)}`).digest('hex');
}

module.exports = cds.service.impl(async function () {
  const db = await cds.connect.to('db');
  const { Facilities, Medicines, Stocks, RoadSegments, FloodBulletins, Transfers, AuditLogs } = cds.entities('phc.rebalancing');
  const logEvent = async (tx, action, transferId, details, actor) => {
    const [last] = await tx.run(SELECT.from(AuditLogs).orderBy({ sequence: 'desc' }).limit(1));
    const previousHash = last?.hash || 'GENESIS';
    const payload = { sequence: (last?.sequence || 0) + 1, action, transferId: transferId || null, actor: actor || 'anonymous', details: canonical(details), previousHash };
    await tx.run(INSERT.into(AuditLogs).entries({ ...payload, eventId: crypto.randomUUID(), hash: digest(previousHash, payload) }));
  };
  const explain = async items => {
    if (!items.length) return [];
    try {
      const model = process.env.AI_MODEL_NAME;
      const resourceGroup = process.env.AI_RESOURCE_GROUP || 'default';
      if (!model) throw new Error('AI_MODEL_NAME is not configured');
      const { OrchestrationClient } = await import('@sap-ai-sdk/orchestration');
      const client = new OrchestrationClient({
        promptTemplating: { model: { name: model, params: { temperature: 0 } } }
      }, { resourceGroup });
      return await Promise.all(items.map(async item => {
        const response = await client.chatCompletion({ messages: [
          { role: 'system', content: 'Explain one proposed public health medicine transfer in plain, concise language. Only restate the provided facts. Never change or infer quantities, routes, risks, approvals, or medical advice. If there is no donor, say district escalation is needed.' },
          { role: 'user', content: JSON.stringify(item) }
        ] });
        return response.getContent() || FALLBACK([item]);
      }));
    } catch (error) {
      cds.log('ai').warn('AI explanation unavailable; using deterministic text:', error.message);
      return items.map(item => FALLBACK([item]));
    }
  };

  this.on('setFlood', async req => {
    const tx = cds.tx(req), actor = req.user.id;
    const [bulletin] = await tx.run(SELECT.from(FloodBulletins).where({ ID: 'KENDRAPARA-DEMO' }));
    if (!bulletin) return req.reject(404, 'Demo flood bulletin not found.');
    if (bulletin.active === req.data.active) return bulletin;
    const now = new Date().toISOString();
    const revision = Number(bulletin.revision || 0) + 1;
    await tx.run(UPDATE(FloodBulletins).set({ active: req.data.active, issuedAt: now, issuedBy: actor, revision }).where({ ID: bulletin.ID }));
    await logEvent(tx, 'FLOOD_BULLETIN_CHANGED', null, { active: req.data.active, revision, targetFacility: bulletin.targetFacility_ID, isolationHours: bulletin.isolationHours }, actor);
    return { ...bulletin, active: req.data.active, issuedAt: now, issuedBy: actor, revision };
  });

  this.on('proposeTransfers', async req => {
    const tx = cds.tx(req), actor = req.user.id;
    const [bulletin] = await tx.run(SELECT.from(FloodBulletins).where({ ID: 'KENDRAPARA-DEMO' }));
    if (!bulletin?.active) return req.reject(409, 'Activate a flood bulletin before generating proposals.');
    const prior = await tx.run(SELECT.from(Transfers).where({ target_ID: bulletin.targetFacility_ID, bulletinRevision: bulletin.revision }));
    if (prior.length) return prior;
    const [target] = await tx.run(SELECT.from(Facilities).where({ ID: bulletin.targetFacility_ID }));
    const targetStocks = await tx.run(SELECT.from(Stocks).where({ facility_ID: target.ID }));
    const medicines = await tx.run(SELECT.from(Medicines));
    const facilities = await tx.run(SELECT.from(Facilities).where({ ID: { '!=': target.ID } }));
    const donorStocks = await tx.run(SELECT.from(Stocks).where({ facility_ID: { '!=': target.ID } }));
    const roads = await tx.run(SELECT.from(RoadSegments).where({ toFacility_ID: target.ID, isOpen: true }));
    const lines = [];
    for (const ts of targetStocks) {
      const med = medicines.find(m => m.ID === ts.medicine_ID);
      if (!med || Number(ts.dailyUse) <= 0) continue;
      const daysOnHand = Number((ts.onHand / ts.dailyUse).toFixed(1));
      if (daysOnHand >= bulletin.isolationHours / 24) continue;
      const candidates = donorStocks.filter(ds => ds.medicine_ID === med.ID).map(ds => {
        const facility = facilities.find(f => f.ID === ds.facility_ID);
        const road = roads.find(r => r.fromFacility_ID === facility?.ID);
        const surplus = ds.onHand - ds.dailyUse * ds.safetyDays;
        return { stock: ds, facility, road, surplus };
      }).filter(d => d.facility && d.road && d.surplus > 0).sort((a,b) => a.road.hours - b.road.hours || b.surplus - a.surplus);
      const donor = candidates[0];
      const required = Math.max(0, Math.ceil(ts.dailyUse * (bulletin.isolationHours / 24 + Number(ts.safetyDays)) - ts.onHand));
      const quantity = donor ? Math.min(required, Math.floor(donor.surplus)) : 0;
      const status = !donor || quantity < 1 ? 'NO_DONOR_ESCALATE' : med.controlled ? 'PENDING_CMO' : 'AUTO_STAGED';
      lines.push({ target: target.ID, targetName: target.name, donor: donor?.facility.ID || null, donorName: donor?.facility.name || null, medicine: med.ID, medicineName: med.name, quantity, unit: med.unit, route: donor ? `${donor.facility.area} → ${target.area} (${donor.road.hours} h)` : null, daysOnHand, hoursToIsolation: bulletin.isolationHours, controlled: med.controlled, status });
    }
    const explanations = await explain(lines);
    const created = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const id = crypto.randomUUID();
      const row = { ID: id, target_ID: line.target, donor_ID: line.donor, medicine_ID: line.medicine, quantity: line.quantity, unit: line.unit, route: line.route, daysOnHand: line.daysOnHand, hoursToIsolation: line.hoursToIsolation, bulletinRevision: bulletin.revision, controlled: line.controlled, status: line.status, explanation: explanations[i] };
      await tx.run(INSERT.into(Transfers).entries(row));
      await logEvent(tx, 'TRANSFER_PROPOSED', id, { status: line.status, medicine: line.medicineName, quantity: line.quantity, donor: line.donor, target: line.target }, actor);
      created.push(row);
    }
    return created;
  });

  this.on('decide', async req => {
    const tx = cds.tx(req), actor = req.user.id;
    const { transferId, decision, reason } = req.data;
    if (!['APPROVED','REJECTED'].includes(decision)) return req.reject(400, 'Decision must be APPROVED or REJECTED.');
    const [transfer] = await tx.run(SELECT.from(Transfers).where({ ID: transferId }));
    if (!transfer) return req.reject(404, 'Transfer not found.');
    if (transfer.status !== 'PENDING_CMO' || !transfer.controlled) return req.reject(409, 'Only pending controlled-medicine proposals can be decided here.');
    const decidedAt = new Date().toISOString();
    await tx.run(UPDATE(Transfers).set({ status: decision, decidedBy: actor, decidedAt, rejectionReason: decision === 'REJECTED' ? (reason || 'Rejected by CMO') : null }).where({ ID: transferId }));
    await logEvent(tx, `TRANSFER_${decision}`, transferId, { reason: reason || null }, actor);
    return { ...transfer, status: decision, decidedBy: actor, decidedAt, rejectionReason: decision === 'REJECTED' ? (reason || 'Rejected by CMO') : null };
  });

  this.on('verifyAudit', async req => {
    const rows = await db.run(SELECT.from(AuditLogs).orderBy('sequence asc'));
    let previousHash = 'GENESIS';
    for (const row of rows) {
      let details;
      try { details = JSON.parse(row.details); } catch { return { valid: false, entries: rows.length, lastHash: row.hash }; }
      const payload = { sequence: row.sequence, action: row.action, transferId: row.transferId || null, actor: row.actor || 'anonymous', details: canonical(details), previousHash };
      if (row.previousHash !== previousHash || digest(previousHash, payload) !== row.hash) return { valid: false, entries: rows.length, lastHash: row.hash };
      previousHash = row.hash;
    }
    return { valid: true, entries: rows.length, lastHash: previousHash };
  });
});

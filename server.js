const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const port = Number(process.env.PORT || 4004);

/* =========================================================
   LOAD FACILITIES FROM CAP CSV
   ========================================================= */

const facilitiesFile = path.join(
  __dirname,
  'cap',
  'db',
  'data',
  'phc.rebalancing-Facilities.csv'
);

function loadFacilities() {
  const csv = fs.readFileSync(facilitiesFile, 'utf8').trim();

  const lines = csv.split(/\r?\n/);

  const headers = lines[0].split(';');

  return lines
    .slice(1)
    .filter(Boolean)
    .map(line => {
      const values = line.split(';');

      const row = {};

      headers.forEach((header, index) => {
        row[header] = values[index];
      });

      return {
        id: row.ID,
        name: row.name,
        area: row.area,
        status: 'Connected',
        hours: Number(row.isolationHours || 0),
        lat: Number(row.latitude),
        lon: Number(row.longitude),
        vulnerable: row.vulnerable === 'true',
        isolationHours: Number(row.isolationHours || 0)
      };
    });
}

const facilities = loadFacilities();

console.log(`Loaded ${facilities.length} facilities from CAP CSV`);


/* =========================================================
   MEDICINES
   ========================================================= */

const medicines = [
  {
    id: 'MED-001',
    name: 'ORS sachets',
    category: 'Essential',
    unit: 'sachets',
    controlled: false
  },
  {
    id: 'MED-002',
    name: 'Paracetamol 500 mg',
    category: 'Essential',
    unit: 'tablets',
    controlled: false
  },
  {
    id: 'MED-003',
    name: 'Amoxicillin 500 mg',
    category: 'Antibiotic',
    unit: 'capsules',
    controlled: false
  },
  {
    id: 'MED-004',
    name: 'Insulin 40 IU',
    category: 'Cold chain',
    unit: 'vials',
    controlled: true
  },
  {
    id: 'MED-005',
    name: 'Oxytocin 10 IU',
    category: 'Maternal health',
    unit: 'ampoules',
    controlled: true
  },
  {
    id: 'MED-006',
    name: 'Zinc 20 mg',
    category: 'Essential',
    unit: 'tablets',
    controlled: false
  }
];


/* =========================================================
   STOCK
   ========================================================= */

const stock = [];

for (const f of facilities) {
  for (const m of medicines) {

    const facilityNumber =
      Number(String(f.id).match(/\d+$/)?.[0] || 1);

    const medicineIndex = medicines.indexOf(m);

    const isRajnagar = f.id === 'PHC-04';

    const base = isRajnagar
      ? [3, 4, 2, 8, 12, 5][medicineIndex]
      : 10 + (
          (
            facilityNumber * 7 +
            medicineIndex * 11
          ) % 30
        );

    const dailyUse = isRajnagar
      ? [24, 20, 8, 1, 2, 10][medicineIndex]
      : 3 + (
          (facilityNumber + medicineIndex) % 7
        );

    stock.push({
      facilityId: f.id,
      medicineId: m.id,
      onHand: base * 10,
      dailyUse,
      safetyDays: 4
    });
  }
}


/* =========================================================
   APPLICATION STATE
   ========================================================= */

let floodActive = false;

let transfers = [];

let logs = [];


/* =========================================================
   AUDIT / HASHING
   ========================================================= */

function hashEntry(previousHash, event) {
  return crypto
    .createHash('sha256')
    .update(previousHash + JSON.stringify(event))
    .digest('hex');
}

function audit(action, transferId, detail) {

  const event = {
    id: `AUD-${String(logs.length + 1).padStart(4, '0')}`,
    at: new Date().toISOString(),
    action,
    transferId,
    detail,
    previousHash: logs.at(-1)?.hash || 'GENESIS'
  };

  event.hash = hashEntry(
    event.previousHash,
    event
  );

  logs.push(event);
}


/* =========================================================
   CALCULATE FACILITY STATUS AND STOCK
   ========================================================= */

function calculate() {

  return facilities.map(f => {

    const atRisk =
      floodActive &&
      f.id === 'PHC-04';

    const lines = stock
      .filter(s => s.facilityId === f.id)
      .map(s => {

        const med = medicines.find(
          m => m.id === s.medicineId
        );

        const days = +(
          s.onHand / s.dailyUse
        ).toFixed(1);

        return {
          ...s,
          medicine: med.name,
          unit: med.unit,
          controlled: med.controlled,
          days,
          shortage:
            atRisk &&
            days < f.hours / 24
        };
      });

    return {
      ...f,

      status:
        atRisk
          ? 'At risk'
          : f.id === 'PHC-04'
            ? 'Watch'
            : f.status,

      isolationHours:
        atRisk
          ? f.hours
          : null,

      lines
    };
  });
}


/* =========================================================
   TRANSFER PROPOSALS
   ========================================================= */

function proposals() {

  const all = calculate();

  const target = all.find(
    f => f.id === 'PHC-04'
  );

  if (!floodActive) {
    return [];
  }

  if (!target) {
    return [];
  }

  const out = [];

  for (
    const line of target.lines.filter(
      x => x.shortage
    )
  ) {

    const donor = all
      .filter(
        f => f.id !== target.id
      )
      .map(f => ({
        facility: f,
        line: f.lines.find(
          l => l.medicineId === line.medicineId
        )
      }))
      .filter(x =>
        x.line &&
        x.line.onHand -
          x.line.dailyUse * x.line.safetyDays
          >= line.dailyUse * 2
      )
      .sort(
        (a, b) =>
          a.facility.hours -
          b.facility.hours
      )[0];

    if (!donor) {

      out.push({
        id: `TR-${Date.now()}-${line.medicineId}`,
        targetId: target.id,
        target: target.name,
        medicine: line.medicine,
        quantity: 0,
        unit: line.unit,
        status: 'NO_DONOR_ESCALATE',
        explanation:
          `No donor has safe surplus for ${line.medicine}. ` +
          `Escalate for district-level action.`
      });

      continue;
    }

    const qty = Math.min(
      Math.ceil(
        line.dailyUse *
        (target.isolationHours / 24 + 2) -
        line.onHand
      ),

      donor.line.onHand -
      donor.line.dailyUse *
      donor.line.safetyDays
    );

    if (qty <= 0) {
      continue;
    }

    out.push({

      id:
        `TR-${Date.now()}-${line.medicineId}`,

      targetId:
        target.id,

      target:
        target.name,

      donorId:
        donor.facility.id,

      donor:
        donor.facility.name,

      medicineId:
        line.medicineId,

      medicine:
        line.medicine,

      quantity:
        qty,

      unit:
        line.unit,

      route:
        `${donor.facility.area} → Rajnagar`,

      hoursToIsolation:
        target.isolationHours,

      controlled:
        line.controlled,

      status:
        line.controlled
          ? 'PENDING_CMO'
          : 'AUTO_STAGED',

      explanation:
        `${target.name} has ${line.days} days of ` +
        `${line.medicine}; access may close in ` +
        `${target.isolationHours} hours. ` +
        `${donor.facility.name} can safely provide ` +
        `${qty} ${line.unit}.`
    });
  }

  return out;
}


/* =========================================================
   VERIFY AUDIT CHAIN
   ========================================================= */

function verifyAudit() {

  let previousHash = 'GENESIS';

  for (const e of logs) {

    const copy = {
      ...e
    };

    delete copy.hash;

    if (
      e.previousHash !== previousHash ||
      hashEntry(
        previousHash,
        copy
      ) !== e.hash
    ) {
      return false;
    }

    previousHash = e.hash;
  }

  return true;
}


/* =========================================================
   HTTP RESPONSE HELPER
   ========================================================= */

function send(
  res,
  code,
  data,
  type = 'application/json'
) {

  res.writeHead(
    code,
    {
      'content-type': type,
      'access-control-allow-origin': '*'
    }
  );

  res.end(
    type === 'application/json'
      ? JSON.stringify(data)
      : data
  );
}


/* =========================================================
   REQUEST BODY
   ========================================================= */

async function body(req) {

  let s = '';

  for await (const c of req) {
    s += c;
  }

  return s
    ? JSON.parse(s)
    : {};
}


/* =========================================================
   HTTP SERVER
   ========================================================= */

const server = http.createServer(
  async (req, res) => {

    const url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );


    /* -----------------------------------------------------
       CORS
       ----------------------------------------------------- */

    if (req.method === 'OPTIONS') {

      res.writeHead(
        204,
        {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST',
          'access-control-allow-headers': 'content-type'
        }
      );

      return res.end();
    }


    /* -----------------------------------------------------
       OVERVIEW
       ----------------------------------------------------- */

    if (
      url.pathname === '/api/overview'
    ) {

      const calculated =
        calculate();

      return send(
        res,
        200,
        {
          facilities: calculated,

          medicines,

          transfers,

          audit: logs,

          floodActive,

          auditValid:
            verifyAudit(),

          summary: {

            atRisk:
              calculated.filter(
                f => f.status === 'At risk'
              ).length,

            pending:
              transfers.filter(
                t =>
                  t.status === 'PENDING_CMO'
              ).length,

            staged:
              transfers.filter(
                t =>
                  t.status === 'AUTO_STAGED'
              ).length,

            escalations:
              transfers.filter(
                t =>
                  t.status ===
                  'NO_DONOR_ESCALATE'
              ).length
          }
        }
      );
    }


    /* -----------------------------------------------------
       FLOOD
       ----------------------------------------------------- */

    if (
      url.pathname === '/api/flood' &&
      req.method === 'POST'
    ) {

      const b = await body(req);

      floodActive = !!b.active;

      audit(
        'FLOOD_BULLETIN',
        null,
        {
          active: floodActive,
          zone: 'Rajnagar'
        }
      );

      return send(
        res,
        200,
        {
          floodActive
        }
      );
    }


    /* -----------------------------------------------------
       PROPOSE TRANSFERS
       ----------------------------------------------------- */

    if (
      url.pathname === '/api/propose' &&
      req.method === 'POST'
    ) {

      const items = proposals();

      for (const t of items) {

        transfers.unshift(t);

        audit(
          'TRANSFER_PROPOSED',
          t.id,
          {
            status: t.status,
            target: t.target,
            medicine: t.medicine,
            quantity: t.quantity
          }
        );
      }

      return send(
        res,
        200,
        {
          items
        }
      );
    }


    /* -----------------------------------------------------
       TRANSFER DECISION
       ----------------------------------------------------- */

    const decide =
      url.pathname.match(
        /^\/api\/transfers\/([^/]+)\/decision$/
      );

    if (
      decide &&
      req.method === 'POST'
    ) {

      const b = await body(req);

      const t = transfers.find(
        x => x.id === decide[1]
      );

      if (!t) {

        return send(
          res,
          404,
          {
            error: 'Transfer not found'
          }
        );
      }

      if (
        t.status !== 'PENDING_CMO'
      ) {

        return send(
          res,
          409,
          {
            error:
              'Only pending transfers require a CMO decision'
          }
        );
      }

      if (
        ![
          'APPROVED',
          'REJECTED'
        ].includes(b.decision)
      ) {

        return send(
          res,
          400,
          {
            error:
              'Decision must be APPROVED or REJECTED'
          }
        );
      }

      t.status =
        b.decision;

      t.decidedBy =
        b.decidedBy ||
        'District CMO';

      t.decidedAt =
        new Date().toISOString();

      audit(
        `TRANSFER_${b.decision}`,
        t.id,
        {
          decidedBy:
            t.decidedBy
        }
      );

      return send(
        res,
        200,
        t
      );
    }


    /* -----------------------------------------------------
       AUDIT VERIFY
       ----------------------------------------------------- */

    if (
      url.pathname ===
      '/api/audit/verify'
    ) {

      return send(
        res,
        200,
        {
          valid:
            verifyAudit(),

          entries:
            logs.length
        }
      );
    }


    /* -----------------------------------------------------
       UNKNOWN API
       ----------------------------------------------------- */

    if (
      url.pathname.startsWith('/api/')
    ) {

      return send(
        res,
        404,
        {
          error: 'Not found'
        }
      );
    }


    /* -----------------------------------------------------
       STATIC FRONTEND FILES
       ----------------------------------------------------- */

    const file =
      url.pathname === '/'
        ? 'index.html'
        : url.pathname.slice(1);

    const publicDir =
      path.join(
        __dirname,
        'public'
      );

    const target =
      path.join(
        publicDir,
        file
      );

    if (
      !target.startsWith(publicDir)
    ) {

      return send(
        res,
        403,
        'Forbidden',
        'text/plain'
      );
    }

    fs.readFile(
      target,
      (err, data) => {

        if (err) {

          return send(
            res,
            404,
            'Not found',
            'text/plain'
          );
        }

        let type =
          'text/html';

        if (
          file.endsWith('.css')
        ) {
          type = 'text/css';
        }
        else if (
          file.endsWith('.js')
        ) {
          type = 'text/javascript';
        }

        send(
          res,
          200,
          data,
          type
        );
      }
    );
  }
);


/* =========================================================
   START SERVER
   ========================================================= */

server.listen(
  port,
  () => {
    console.log(
      `PHC Rebalancing demo listening at http://localhost:${port}`
    );
  }
);
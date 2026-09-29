namespace phc.rebalancing;

using { cuid, managed } from '@sap/cds/common';

entity Facilities : managed {
  key ID             : String(12);
      name           : String(100) not null;
      district       : String(80) not null;
      area           : String(80) not null;
      latitude       : Decimal(9,6);
      longitude      : Decimal(9,6);
      vulnerable     : Boolean default false;
      isolationHours : Integer;
      stocks         : Composition of many Stocks on stocks.facility = $self;
}

entity Medicines : managed {
  key ID        : String(16);
      name      : String(100) not null;
      unit      : String(24) not null;
      category  : String(50);
      controlled: Boolean default false;
      stocks    : Composition of many Stocks on stocks.medicine = $self;
}

entity Stocks : managed {
  key facility : Association to Facilities;
  key medicine : Association to Medicines;
      onHand    : Integer not null;
      dailyUse  : Decimal(10,2) not null;
      safetyDays: Decimal(5,2) default 4;
}

entity RoadSegments : managed {
  key ID          : String(20);
      fromFacility : Association to Facilities;
      toFacility   : Association to Facilities;
      hours        : Integer;
      isOpen       : Boolean default true;
      floodZone    : String(80);
}

entity FloodBulletins : managed {
  key ID             : String(30);
      district       : String(80) not null;
      targetFacility : Association to Facilities;
      active         : Boolean default false;
      isolationHours : Integer default 58;
      revision       : Integer default 0;
      issuedAt       : Timestamp;
      issuedBy       : String(120);
}

entity Transfers : cuid, managed {
      target        : Association to Facilities not null;
      donor         : Association to Facilities;
      medicine      : Association to Medicines not null;
      quantity      : Integer not null;
      unit          : String(24) not null;
      route         : String(300);
      daysOnHand    : Decimal(8,2);
      hoursToIsolation : Integer;
      bulletinRevision : Integer;
      controlled    : Boolean default false;
      status        : String(24) not null;
      explanation   : LargeString;
      decidedBy     : String(120);
      decidedAt     : Timestamp;
      rejectionReason : String(500);
      executedAt    : Timestamp;
}

entity AuditLogs : managed {
  key sequence  : Integer;
      eventId    : UUID not null;
      action     : String(50) not null;
      transferId : UUID;
      actor      : String(120);
      details    : LargeString;
      previousHash : String(64) not null;
      hash       : String(64) not null;
}

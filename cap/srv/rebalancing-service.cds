using { phc.rebalancing as db } from '../db/schema';

service RebalancingService {
  @readonly @restrict: [{ grant: 'READ', to: ['PHC_MEDICAL_OFFICER','CMO'] }] entity Facilities as projection on db.Facilities;
  @readonly @restrict: [{ grant: 'READ', to: ['PHC_MEDICAL_OFFICER','CMO'] }] entity Medicines as projection on db.Medicines;
  @readonly @restrict: [{ grant: 'READ', to: ['PHC_MEDICAL_OFFICER','CMO'] }] entity Stocks as projection on db.Stocks;
  @readonly @restrict: [{ grant: 'READ', to: ['PHC_MEDICAL_OFFICER','CMO'] }] entity RoadSegments as projection on db.RoadSegments;
  @readonly @restrict: [{ grant: 'READ', to: ['PHC_MEDICAL_OFFICER','CMO'] }] entity FloodBulletins as projection on db.FloodBulletins;
  @readonly @restrict: [{ grant: 'READ', to: ['PHC_MEDICAL_OFFICER','CMO'] }] entity Transfers as projection on db.Transfers;
  @readonly @restrict: [{ grant: 'READ', to: ['PHC_MEDICAL_OFFICER','CMO'] }] entity AuditLogs as projection on db.AuditLogs;

  @requires: 'PHC_MEDICAL_OFFICER'
  action setFlood(active: Boolean) returns FloodBulletins;
  @requires: 'PHC_MEDICAL_OFFICER'
  action proposeTransfers() returns many Transfers;
  @requires: 'CMO'
  action decide(transferId: UUID, decision: String(10), reason: String(500)) returns Transfers;
  @requires: ['PHC_MEDICAL_OFFICER','CMO']
  action verifyAudit() returns AuditVerification;

  type AuditVerification {
    valid: Boolean;
    entries: Integer;
    lastHash: String(64);
  }
}

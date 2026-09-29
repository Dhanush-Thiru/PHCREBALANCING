sap.ui.define(['sap/ui/core/UIComponent','sap/ui/model/json/JSONModel','sap/m/MessageBox'], (UIComponent, JSONModel, MessageBox) => {
  'use strict';
  return UIComponent.extend('phc.rebalancing.Component', {
    metadata: { manifest: 'json' },
    init() {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({ facilities: [], stocks: [], transfers: [], audit: [], bulletin: { active: false }, summary: {}, busy: true }));
      this.loadDashboard();
    },
    async request(path, options = {}) {
      const response = await fetch(`/odata/v4/rebalancing/${path}`, { credentials: 'include', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.error?.message || data.message || `HTTP ${response.status}`);
      return data;
    },
    async postAction(name, payload) {
      const tokenResponse = await fetch('/odata/v4/rebalancing/', { credentials: 'include', headers: { 'x-csrf-token': 'Fetch' } });
      const csrf = tokenResponse.headers.get('x-csrf-token');
      if (!tokenResponse.ok || !csrf) throw new Error('Could not obtain an SAP session security token. Sign in again and retry.');
      return this.request(name, { method: 'POST', body: JSON.stringify(payload || {}), headers: { 'x-csrf-token': csrf } });
    },
    async loadDashboard() {
      const model = this.getModel(); model.setProperty('/busy', true);
      try {
        const [facilities, stocks, transfers, audit, bulletins] = await Promise.all([
          this.request('Facilities?$select=ID,name,district,area,vulnerable,isolationHours&$orderby=ID'),
          this.request('Stocks?$select=facility_ID,medicine_ID,onHand,dailyUse,safetyDays'),
          this.request('Transfers?$select=ID,target_ID,donor_ID,medicine_ID,quantity,unit,route,daysOnHand,hoursToIsolation,controlled,status,explanation,decidedBy,decidedAt,rejectionReason,createdAt&$orderby=createdAt%20desc'),
          this.request('AuditLogs?$select=sequence,action,transferId,actor,details,previousHash,hash,createdAt&$orderby=sequence%20desc&$top=20'),
          this.request('FloodBulletins?$select=ID,active,isolationHours,targetFacility_ID')
        ]);
        const transferRows = transfers.value || [];
        model.setProperty('/facilities', facilities.value || []); model.setProperty('/stocks', stocks.value || []); model.setProperty('/transfers', transferRows); model.setProperty('/audit', audit.value || []); model.setProperty('/bulletin', (bulletins.value || [])[0] || { active: false, isolationHours: 58 });
        model.setProperty('/summary', {
          facilityCount: (facilities.value || []).length,
          atRisk: (bulletins.value || [])[0]?.active ? 1 : 0,
          pending: transferRows.filter(t => t.status === 'PENDING_CMO').length,
          staged: transferRows.filter(t => t.status === 'AUTO_STAGED').length
        });
      } catch (error) { MessageBox.error(`Could not load PHC data. ${error.message}`); }
      finally { model.setProperty('/busy', false); }
    }
  });
});

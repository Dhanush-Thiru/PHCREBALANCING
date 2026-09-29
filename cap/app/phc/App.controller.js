sap.ui.define(['sap/ui/core/mvc/Controller','sap/m/MessageToast','sap/m/MessageBox'], (Controller, MessageToast, MessageBox) => {
  'use strict';
  return Controller.extend('phc.rebalancing.AppController', {
    getComponent() { return this.getOwnerComponent(); },
    async onRefresh() { await this.getComponent().loadDashboard(); MessageToast.show('PHC data refreshed from CAP.'); },
    async onToggleFlood() {
      const active = !this.getView().getModel().getProperty('/bulletin/active');
      try { await this.getComponent().postAction('setFlood', { active }); await this.getComponent().loadDashboard(); MessageToast.show(active ? 'Flood bulletin activated.' : 'Flood bulletin cleared.'); }
      catch (error) { MessageBox.error(error.message); }
    },
    async onPropose() {
      try { const result = await this.getComponent().postAction('proposeTransfers', {}); await this.getComponent().loadDashboard(); MessageToast.show(`${(result.value || []).length} transfer proposal(s) created.`); }
      catch (error) { MessageBox.error(error.message); }
    },
    async onApprove(event) { await this.decide(event, 'APPROVED'); },
    async onReject(event) {
      const rejectAction = 'Reject';
      MessageBox.confirm('Reject this controlled medicine transfer?', {
        title: 'Reject transfer', actions: [rejectAction, MessageBox.Action.CANCEL], emphasizedAction: rejectAction,
        onClose: async action => { if (action === rejectAction) await this.decide(event, 'REJECTED', 'Rejected by District CMO'); }
      });
    },
    async decide(event, decision, reason) {
      const row = event.getSource().getBindingContext().getObject();
      try { await this.getComponent().postAction('decide', { transferId: row.ID, decision, reason: reason || '' }); await this.getComponent().loadDashboard(); MessageToast.show(`Transfer ${decision.toLowerCase()}.`); }
      catch (error) { MessageBox.error(error.message); }
    },
    async onVerify() {
      try { const result = await this.getComponent().postAction('verifyAudit', {}); MessageBox.show(`Hash chain ${result.valid ? 'verified' : 'FAILED'} across ${result.entries} audit event(s).`, { icon: result.valid ? MessageBox.Icon.SUCCESS : MessageBox.Icon.ERROR, title: 'Audit verification' }); }
      catch (error) { MessageBox.error(error.message); }
    }
  });
});

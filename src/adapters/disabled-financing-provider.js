'use strict';
class DisabledFinancingProvider { async startApplication(){ throw disabled(); } async verifyCallback(){ throw disabled(); } async getFinancingStatus(){ throw disabled(); } }
function disabled(){ const e=new Error('Financing provider is disabled'); e.code='PROVIDER_DISABLED'; return e; }
module.exports={DisabledFinancingProvider};

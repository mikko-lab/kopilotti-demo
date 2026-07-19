'use strict';
class DisabledPaymentProvider { async startPayment(){ throw disabled(); } async verifyCallback(){ throw disabled(); } async getPaymentStatus(){ throw disabled(); } }
function disabled(){ const e=new Error('Payment provider is disabled'); e.code='PROVIDER_DISABLED'; return e; }
module.exports={DisabledPaymentProvider};

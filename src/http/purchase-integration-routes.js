'use strict';
const express=require('express');
const {ApplicationError}=require('../application/errors');
const {publicPurchaseSession}=require('../security/public-condition-report-view');
const {asyncRoute}=require('./http-response');
function createPurchaseIntegrationRouter(service,{demo=false,integrationSecret}={}){
 const r=express.Router();
 r.post('/callbacks/:kind',asyncRoute(async(req,res)=>{if(!integrationSecret||req.get('Authorization')!==`Bearer ${integrationSecret}`)throw new ApplicationError('UNAUTHORIZED','Integration authentication required',401);const kind=parseKind(req.params.kind);const session=await service.handleProviderCallback({kind,payload:req.body,headers:req.headers,actorId:`${kind.toLowerCase()}-integration`,correlationId:correlation(req)});res.json(publicPurchaseSession(session));}));
 if(demo)r.post('/demo/:kind/:sessionId/confirm',asyncRoute(async(req,res)=>{const kind=parseKind(req.params.kind);const current=await service.get({tenantId:'demo-dealership',sessionId:req.params.sessionId});const session=await service.handleProviderCallback({kind,payload:{sessionId:current.id,providerReference:current.providerReference,status:'CONFIRMED',idempotencyKey:req.body?.idempotencyKey,simulated:true},headers:{},actorId:'simulated-demo-provider',correlationId:correlation(req)});res.json(publicPurchaseSession({...session,simulated:true}));}));
 return r;
}
function parseKind(v){const k=String(v).toUpperCase();if(!['PAYMENT','FINANCING'].includes(k))throw new ApplicationError('INVALID_PROVIDER','Unknown provider',400);return k;}
function correlation(req){const v=req.get('X-Correlation-Id');if(!v)throw new ApplicationError('CORRELATION_ID_REQUIRED','Correlation identifier required',400);return v;}
module.exports={createPurchaseIntegrationRouter};

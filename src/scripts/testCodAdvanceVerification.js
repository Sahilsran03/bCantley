import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { createCodAdvanceVerificationHandler, createCodAdvanceInitiationHandler } from "../controllers/order.controller.js";
import { createRazorpayWebhookHandler } from "../controllers/webhook.controller.js";
import { settleCapturedPayment } from "../services/payment-settlement.service.js";
import { validateFetchedRazorpayPayment } from "../services/razorpay.service.js";

const saved = [env.razorpayKeySecret, env.razorpayWebhookSecret];
env.razorpayKeySecret = "isolated-cod-secret"; env.razorpayWebhookSecret = "isolated-cod-webhook";
const copy = (v) => structuredClone(v);
const matches = (row, query) => Object.entries(query).every(([k,v]) => {
  if(k === "$or") return v.some(q => matches(row,q));
  if(v?.$in) return v.$in.includes(row[k]);
  if(v?.$type) return typeof row[k] === v.$type && row[k] !== v.$ne;
  return String(row[k] ?? "") === String(v ?? "");
});
const expr = (v,row) => {
  if(typeof v === "string" && v.startsWith("$")) return row[v.slice(1)];
  if(v?.$subtract) { assert.equal(v.$subtract.length,2,"MongoDB subtract arity"); return expr(v.$subtract[0],row)-expr(v.$subtract[1],row); }
  if(v?.$max) return Math.max(...v.$max.map(x => expr(x,row)));
  if(v?.$gt) return expr(v.$gt[0],row)>expr(v.$gt[1],row);
  if(v?.$cond) return expr(v.$cond[0],row)?expr(v.$cond[1],row):expr(v.$cond[2],row);
  return v;
};
const invoke = (handler,req) => new Promise((resolve,reject) => handler(req,{
  status(code) { this.code=code; return this; }, json(data) { resolve({code:this.code,data}); }
},reject));
const harness = (amount=100) => {
  const state={order:{_id:"order-test",user:"user-test",paymentMethod:"COD",orderStatus:"Pending",paymentStatus:"Pending",
    totalAmount:400,onlineAdvanceRequired:amount,onlineAmountPaid:0,remainingCodDue:400,potentialCodAmount:400,codAmountCollected:0,codAdvancePayment:null},
    payment:{_id:"payment-test",user:"user-test",order:"order-test",purpose:"COD_ADVANCE",provider:"razorpay",providerOrderId:"provider-order",
      providerPaymentId:null,status:"Pending",amount,currency:"INR"},writes:0,creates:0,pipeline:null};
  const query = get => ({select(){return this;},sort(){return this;},then(a,b){return Promise.resolve().then(get).then(a,b);}});
  const PaymentModel={
    findOne:q=>query(()=>matches(state.payment,q)?copy(state.payment):null),
    find:q=>query(()=>matches(state.payment,q)?[copy(state.payment)]:[]),
    async findOneAndUpdate(q,u){if(!matches(state.payment,q))return null;Object.assign(state.payment,u);return copy(state.payment);}
  };
  const OrderModel={
    findOne:q=>query(()=>matches(state.order,q)?copy(state.order):null),
    findById:async()=>copy(state.order),
    async findOneAndUpdate(q,pipeline){
      if(!matches(state.order,q))return null;
      state.pipeline=copy(pipeline);let next=copy(state.order);
      for(const stage of pipeline)next={...next,...Object.fromEntries(Object.entries(stage.$set).map(([k,v])=>[k,expr(v,next)]))};
      state.order=next;state.writes++;return copy(next);
    }
  };
  const settle=input=>settleCapturedPayment({payment:input.payment||state.payment,providerPaymentId:input.providerPaymentId,
    providerSignature:input.providerSignature,OrderModel,PaymentModel});
  const fetchCaptured=async({providerPaymentId,payment})=>validateFetchedRazorpayPayment({providerPaymentId,payment,
    providerPayment:{id:"provider-payment",order_id:"provider-order",status:"captured",amount:amount*100,currency:"INR"}});
  const verification=createCodAdvanceVerificationHandler({OrderModel,PaymentModel,fetchCaptured,settle});
  const initiation=createCodAdvanceInitiationHandler({OrderModel,PaymentModel,fetchCaptured,settle,
    createClient:()=>({orders:{create:()=>{state.creates++;assert.fail("No second provider order");}}})});
  const body={razorpay_order_id:"provider-order",razorpay_payment_id:"provider-payment",
    razorpay_signature:crypto.createHmac("sha256",env.razorpayKeySecret).update("provider-order|provider-payment").digest("hex")};
  const request={params:{id:"order-test"},user:{_id:"user-test"},body};
  const webhookHandler=createRazorpayWebhookHandler({PaymentModel,fetchCaptured,settle,
    WebhookEventModel:{create:async data=>({...data,async save(){}})}});
  const webhook=()=>{
    const raw=Buffer.from(JSON.stringify({event:"payment.captured",payload:{payment:{entity:{id:"provider-payment",order_id:"provider-order"}}}}));
    const signature=crypto.createHmac("sha256",env.razorpayWebhookSecret).update(raw).digest("hex");
    return invoke(webhookHandler,{body:raw,get:k=>k==="X-Razorpay-Signature"?signature:"event-test"});
  };
  return {state,webhook,verify:(changes={})=>invoke(verification,{...request,body:{...body,...changes}}),initiate:()=>invoke(initiation,request)};
};
try {
  for(const amount of [100,400]){
    const h=harness(amount);assert.equal((await h.initiate()).data.status,"PAYMENT_INITIATED");
    assert.equal((await h.verify()).data.status,"PAYMENT_CONFIRMED");
    assert.equal(h.state.order.paymentStatus,amount===400?"Paid":"AdvancePaid");
    assert.equal(h.state.order.onlineAmountPaid,amount);assert.equal(h.state.order.remainingCodDue,400-amount);
    assert.equal(h.state.order.potentialCodAmount,400-amount);assert.equal(h.state.order.codAdvancePayment,h.state.payment._id);
    assert.equal((await h.verify()).code,200);assert.equal((await h.webhook()).code,200);
    assert.equal(h.state.writes,1);assert.equal(h.state.creates,0);
    await assert.rejects(h.verify({razorpay_signature:"invalid"}),/signature/);
  }
  const first=harness();await first.webhook();assert.equal((await first.verify()).data.status,"PAYMENT_CONFIRMED");assert.equal(first.state.writes,1);
  const race=harness();await Promise.all([race.webhook(),race.verify()]);assert.equal(race.state.writes,1);
  const lost=harness();await lost.verify();assert.equal((await lost.verify()).data.status,"PAYMENT_CONFIRMED");assert.equal(lost.state.writes,1);
  const interrupted=harness();interrupted.state.payment.providerPaymentId="provider-payment";
  assert.equal((await interrupted.initiate()).data.status,"PAYMENT_CONFIRMED");assert.equal(interrupted.state.writes,1);assert.equal(interrupted.state.creates,0);
  await assert.rejects(interrupted.initiate(),/already been paid/);
  for(const change of [{razorpay_signature:"bad"},{razorpay_order_id:"wrong"},{razorpay_payment_id:"wrong"}]){
    const invalid=harness();await assert.rejects(invalid.verify(change));assert.equal(invalid.state.writes,0);
  }
  const other=harness();other.state.order.codAdvancePayment="another-payment";
  await assert.rejects(other.verify(),/already been settled/);assert.equal(other.state.writes,0);
  console.log("Actual COD initiation/verification/webhook handlers passed: partial/full, both event orderings, race, duplicates, invalid signatures/IDs, exact attribution and recovery without a second charge.");
  if(process.argv.includes("--mongo-readonly")){
    const connection=mongoose.createConnection(env.mongoUri,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000});
    try {
      await connection.asPromise();
      for(const amount of [100,400]){
        const h=harness(amount);await h.verify();
        const [row]=await connection.db.aggregate([{$documents:[{totalAmount:400,codAmountCollected:0}]},...h.state.pipeline]).toArray();
        assert.equal(row.remainingCodDue,400-amount);assert.equal(row.paymentStatus,amount===400?"Paid":"AdvancePaid");
      }
      console.log("Actual MongoDB production-pipeline evaluation passed for literal partial/full advances; no records written.");
    }finally{await connection.close();}
  }
}finally{[env.razorpayKeySecret,env.razorpayWebhookSecret]=saved;}

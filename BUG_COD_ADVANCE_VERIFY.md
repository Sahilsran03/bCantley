# COD advance verification HTTP 500: targeted fix

1. **Exact cause.** settleCapturedCodAdvancePayment built remainingCodDue and potentialCodAmount with $subtract: ["$totalAmount", amount, "$codAmountCollected"]. MongoDB $subtract accepts exactly two arguments. A read-only literal aggregation reproduced MongoServerError code 16020: "Expression $subtract takes exactly 2 arguments. 3 were passed in." This expression is executed after provider capture validation and payment-ID binding, before the Order update. The exception is not an AppError, so error middleware returns HTTP 500. No original terminal log file was available; the actual MongoDB error and matching persisted interruption state were independently verified.

2. **Files changed.**
   - backend/src/services/payment-settlement.service.js: two nested binary subtractions; COD method/currency/amount guards.
   - backend/src/controllers/order.controller.js: signature checked even on Captured replay; provider-bound pending attempt reconciles before any popup initiation response; injectable existing COD handlers for regression coverage.
   - backend/src/scripts/testCodAdvanceSettlementInvariant.js: validate the actual aggregation expression, not just equivalent JavaScript arithmetic; fixture includes schema-required currency.
   - backend/src/scripts/testCodAdvanceVerification.js: new actual-handler tests and optional literal-only MongoDB pipeline evaluation.
   - frontend/src/components/CodAdvancePayment.jsx: same-callback verification retry, authoritative status refresh, uncertain-state lock, duplicate/dismissal guard, and handling PAYMENT_CONFIRMED from reconciliation without opening Razorpay.
   - frontend/src/scripts/testCodAdvanceRecoveryBrowser.mjs: new isolated mocked browser regression.
   - backend/BUG_COD_ADVANCE_VERIFY.md: this report.
   Unrelated working-tree changes were preserved.

3. **Provider capture.** Read-only Razorpay fetches confirmed both latest inspected COD payments are captured, INR, with exact matching provider payment/order IDs and amounts. Each is an INR 9 advance. Their internal Payment IDs are 6a9c2c310d9141dcda375968 and 6a9b7612a4923af4ed06b8f5. Provider IDs, signatures, credentials, and full payloads were not logged.

4. **Webhook settlement.** At inspection both local Payment records remained Pending with providerPaymentId set. Their Orders had onlineAmountPaid=0, remainingCodDue=177, paymentStatus=Pending, and codAdvancePayment=null. Therefore neither was successfully settled locally. No failed webhook event was found in the inspected collection. This does not establish whether a webhook was delivered; it establishes that webhook-first successful settlement was not the stored state.

5. **Second popup.** After verification fails, the existing frontend sets confirmationUncertain, which excludes Pay online advance from canPay. That local guard explains the blocked second popup. It was not weakened. Previously a generic successful Order GET could clear uncertainty even while the Order was Pending; recovery now does not treat a Pending GET as proof that another charge is safe.

6. **Verification fix.** remaining/potential COD now evaluate max(0, (total - advance) - collected) using nested two-argument expressions. Signature verification runs before the already-Captured branch as well. Lookup remains exact by customer, Order, Razorpay provider, COD_ADVANCE purpose and callback providerOrderId; provider payment ID and amount/currency validation remain enforced. Settlement attaches the exact internal Payment ID, not another equal-amount Payment.

7. **Webhook-first after fix.** Both entry points use the same settlement service. An already-settled exact payment returns PAYMENT_CONFIRMED on a valid frontend callback without another Order financial write. Verify-first followed by webhook, duplicate verify, and concurrent-style webhook/verify are covered. Conflicting attribution remains rejected; invalid signatures are rejected even after settlement.

8. **Duplicate-payment protection and recovery.** The compare-and-set and unique provider-payment indexes remain unchanged. Synchronous UI locking ignores duplicate callbacks; dismissal cannot override verification. After a verification error the callback stays only in component memory and Refresh payment status retries the same verification endpoint, then reloads authoritative Order state. A webhook-paid refresh updates the success message. After reload, a pending attempt that already has a providerPaymentId is fetched and reconciled by the existing initiation route; it returns PAYMENT_CONFIRMED without another Razorpay popup or provider Order creation. A fetch/reconciliation failure does not reopen that bound payment. New charges, manual database corrections, captures, and refunds were not performed during this task.

9. **Partial advance result.** INR 400 Order / INR 100 advance: onlineAmountPaid=100, remainingCodDue=300, potentialCodAmount=300, paymentStatus=AdvancePaid, exact codAdvancePayment. Verified both in handler tests and actual MongoDB evaluation of the production pipeline against literal documents.

10. **Full advance result.** INR 400 Order / INR 400 advance: onlineAmountPaid=400, remainingCodDue=0, potentialCodAmount=0, paymentStatus=Paid. Same verification levels as partial advance.

11. **Tests/results.**
   Backend passed: testCodAdvanceVerification (also --mongo-readonly), testCodAdvanceSettlementInvariant, testPurposeAwareSettlement, testRazorpayWebhook, testRazorpaySettlement, testRazorpayOrderCreation, testPaymentSchemas, testFullOnlinePayment, testFullOnlineAnalytics, testOnlineInventoryReservation, testCodCollection, testCodCustomerMessaging, testWalletCheckout, testWalletCancellation.
   Frontend passed: testCodAdvanceRecoveryBrowser.mjs, testOnlinePayment.mjs, testRazorpayLoader.mjs. The browser harness retains Online recovery and COD no/partial/full-advance regressions and tests verification HTTP 500, same-payment recovery, duplicate callback, dismissal during verification, and no second popup.
   Backend syntax passed 166 JavaScript files. Frontend npm.cmd run build passed 851 modules, with existing React Router use-client warnings.
   Backend repository git diff --check retains only pre-existing app.js:107 and email.service.js:73 whitespace. Scoped/full changed-file checks and frontend repository checks pass.
   MongoDB testing used literal $documents aggregation only: no collections or financial records were written, no indexes created. Model concurrency remains mocked, not a real concurrent financial settlement test. Razorpay was accessed only with read-only fetches of existing payment status; browser provider calls were mocked.

The two previously captured payments were inspected but not manually settled by this task. The corrected normal verification/reconciliation flow can settle them without a second charge. No .env, secrets, Razorpay TEST MODE, indexes, Online state machine, Wallet logic, or unrelated payment architecture was changed.
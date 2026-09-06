# Payment methods Part 3C

Implemented authenticated full Online Razorpay initiation and verification for persisted Part 3B Orders. Stop here: frontend integration is Part 3D; Online refunds are deferred.

## Files changed

- src/controllers/online-payment.controller.js (new): thin authenticated-request adapters; initiation never reads request body amounts.
- src/services/online-payment.service.js (new): eligibility, authoritative amount, active attempt reuse, provider creation, signature/provider verification and purpose dispatcher integration.
- src/routes/order.routes.js: two Online POST routes behind existing protect middleware. COD handlers/routes unchanged.
- src/models/Payment.js: purpose-specific onlineAttemptKey and partial unique index, preserving both existing COD attempt and providerPaymentId indexes.
- src/services/razorpay.service.js: shared provider Order builder; existing COD builder delegates with COD_ADVANCE. Existing paise, signature and fetched-payment validation reused.
- src/services/payment-settlement.service.js: cancelled Online Order guard, atomic non-cancelled condition, amount/currency guard, and exact-state potentialCodAmount check. COD settlement unchanged.
- src/controllers/webhook.controller.js: injectable wrapper around the existing handler for actual handler tests. Production uses the existing lookup/validation/dispatcher architecture.
- src/services/financial-analytics.service.js: method-aware pending Online financial classification and captured receipts attributed by purpose to the exact Order payment link.
- src/scripts/testFullOnlinePayment.js and src/scripts/testFullOnlineAnalytics.js (new).
- PART_3C.md (new): this report.

## Endpoints and contract

POST /api/orders/:id/payments/online requires the authenticated owner, an ONLINE Order, non-Cancelled status, Pending payment, Reserved inventory, valid future reservation expiry, and positive whole-INR totalAmount convertible safely to paise. COD/advance/received fields must be zero; onlinePayment must be absent. Conflicting captured FULL_ONLINE Payments reject initiation. Paid Orders return 409 without another provider call.

The charge comes exclusively from persisted Order.totalAmount. The exact FULL_ONLINE Payment stores that INR amount, user, Order, razorpay provider and INR currency. The shared helper converts the amount to paise for Razorpay. Request body/query/metadata/preview amounts have no authority.

Success follows COD response style: success, PAYMENT_INITIATED, public keyId, razorpayOrderId, paymentId, amount (INR), currency and cantleyOrderId. Provider requests use paise. No secret is returned.

POST /api/orders/:id/payments/online/verify accepts only string razorpay_payment_id, razorpay_order_id and razorpay_signature fields. Other fields are rejected. Ownership, ONLINE method, cancellation and exact persisted FULL_ONLINE attribution are checked. Payment amount must equal persisted Order.totalAmount and currency must be INR. Provider payment identity cannot change once assigned. The existing timing-safe signature check runs before provider fetch; fetched payment must be captured with the exact payment ID, provider Order ID, amount in paise and currency.

Verification calls settleCapturedPayment; the controller never directly writes financial fields. Success returns PAYMENT_CONFIRMED, Order/Payment IDs, paymentMethod, paymentStatus, inventoryStatus, onlineAmountPaid and remainingCodDue.

## Attempts, dismissal and failure

A deterministic full-online:<orderId> onlineAttemptKey has a new partial unique index. Repeated and concurrent initiation reuse the same valid provider Order or report initialization in progress. It is separate from advanceAttemptKey, so COD behavior/indexes remain intact. The Online key is retained after capture; Order state blocks further initiation.

Popup dismissal has no backend transition: Order remains Pending/Reserved. A failed individual provider payment can reuse the same provider Order while the reservation is valid. This task does not introduce a payment.failed webhook transition. Verification network errors do not mark the Order Failed or release inventory.

A definitive provider Order-creation rejection (4xx excluding timeout/rate-limit uncertainty) marks the Payment Failed and frees its attempt key for retry. Timeout/5xx/uncertain creation keeps the unique claim: automatic creation of a second provider Order is blocked. An unresolved crash/timeout, malformed provider response or failure to persist a created provider ID requires reconciliation. No distributed transaction with Razorpay is claimed.

## Expiry, cancellation and settlement races

Initiation lazily checks expiry before claiming/calling/reusing a provider Order and rechecks after provider creation. Expired inventory invokes the existing idempotent release service and returns 409 requiring fresh checkout. No scheduler or mutating GET path was added. If expiry/cancellation happens during the external call, a provider Order may already exist, but no payable response is returned and settlement remains guarded.

Successful settlement remains transactional: ONLINE / Paid / Committed; onlineAmountPaid equals totalAmount; remainingCodDue and potentialCodAmount are zero; onlinePayment points to the exact captured FULL_ONLINE Payment. Payment records exact providerPaymentId and capturedAt. soldCount increments once; reserved stock is not decremented again.

Both verification and webhook call the same purpose dispatcher. Webhook-first/browser-second and browser-first/webhook-second tests converge to one financial mutation and one sales increment. Exact repeats preserve capturedAt.

Part 3A's race policy is preserved: a capture may commit inventory still Reserved, including when the timestamp elapsed but release has not won. Once release wins, settlement returns a reconciliation conflict without marking Paid. If settlement wins, release is a no-op. Cancellation is checked before settlement and in the atomic Order update. A cancelled captured-payment webhook is recorded Failed for reconciliation; no refund call is made.

ProviderPaymentId retains its unique provider/payment index across both purposes and all Orders. Wrong user, Order, purpose, amount, currency, provider IDs, signature, cancellation, released inventory and duplicate provider-payment identity are covered by focused tests.

## Analytics and email

Online Received and date-based receipts now include captured COD_ADVANCE and FULL_ONLINE Payments only when their ID matches the corresponding Order.codAdvancePayment or Order.onlinePayment. Unattributed captured records are excluded pending reconciliation. Gross Money Received sums those receipts and COD Collected once. COD collection stays separate. Pending Online Orders with zero receipts/zero COD due are valid unpaid orders; Online COD Outstanding is zero and settled Online Orders count as fully paid. No net-revenue label or analytics redesign was introduced.

The Part 3B Online reservation email already says awaiting payment/unpaid; it is retained. No COD wording is sent by the new Online endpoints and COD templates were not changed. No payment-success email or template redesign was added.

## Verification

17 scripts passed:

- testFullOnlinePayment.js
- testFullOnlineAnalytics.js
- testPurposeAwareSettlement.js
- testOnlineInventoryReservation.js
- testMethodAwareCheckoutPreview.js
- testOnlineCheckoutTransaction.js
- testOnlineCheckoutRetry.js
- testOnlineCheckoutAuthority.js
- testCodAdvanceSettlementInvariant.js
- testRazorpaySettlement.js
- testCodCollection.js
- testRazorpayWebhook.js
- testFinancialAnalytics.js
- testOrderTrackingStatus.js
- testRazorpayOrderCreation.js
- testPaymentSchemas.js
- testCodCustomerMessaging.js

The new payment test executes actual Online services, signature checks, purpose settlement, reservation release and webhook handler using mocked provider/database operations and a transaction rollback harness. It includes overlapping initiation and both settlement orderings, failed/dismissed retry, network uncertainty, capture/release outcomes, cancellation, malicious input and unique provider identity. Route-stack checks confirm customer authentication and both unchanged COD routes. Analytics tests evaluate receipt selection/attribution against mixed COD/Online records.

No live MongoDB concurrency/transaction test or real Razorpay integration was run. The existing webhook regression additionally exercises an isolated loopback HTTP server. No real charge, database mutation, refund, package installation or secret output occurred.

npm run check passed for 155 backend JavaScript files. Repository-wide git diff --check reports only known pre-existing whitespace in src/app.js:107 and src/services/email.service.js:73. The scoped Part 3C diff check passes; an additional full-file scan includes all new/untracked files and also passes.

## Remaining work and scope confirmation

The new onlineAttemptKey unique index must exist before enabling the endpoints in a deployed environment; existing providerPaymentId uniqueness and MongoDB transaction support are also required. No index migration or database operation was run here. Live provider/sandbox integration, distributed concurrency and operational reconciliation of uncertain provider creation remain unverified.

Online refund API/workflows are deferred. Order.onlinePayment provides exact captured FULL_ONLINE attribution for that future work. Frontend Online selector/payment UI is Part 3D. No Wallet payment endpoint or implementation was added; unrelated existing wallet/reward code was preserved.

Frontend, .env, secrets and Razorpay TEST MODE are unchanged. No request amount is trusted. No payment selector was added. Existing COD advance, full-advance Paid invariant, collection and messaging regressions pass. Unrelated working-tree changes remain intact. Stopped after Part 3C.

# Payment methods Part 3B

Part 3B stops at an unpaid Online Order with reserved inventory. Neither checkout endpoint calls Razorpay or creates a FULL_ONLINE Payment.

## Files completed in this pass

- src/controllers/order.controller.js: Online inventory validation, shared total calculation, durable replay fingerprint, retry/expiry checks, transactional cart version increment, and unpaid reservation email.
- src/models/Order.js: optional checkoutRequestFingerprint for Online replay after CheckoutAttempt TTL cleanup.
- src/validators/order.validator.js: strict payment method allowlist.
- src/services/checkout-preview.service.js: informational Online COD eligibility includes products and zone.
- src/services/email.service.js: separate unpaid Online reservation template; COD template unchanged.
- src/scripts/testMethodAwareCheckoutPreview.js and testOnlineCheckoutTransaction.js: extended existing Part 3B coverage.
- src/scripts/testOnlineCheckoutRetry.js and testOnlineCheckoutAuthority.js: new behavioral tests.
- PART_3B.md: API contract and verification notes.

The workspace already contained the main Part 3B transaction and preview implementation, session support in pricing/shipping, and Part 3A inventory lifecycle. Those changes were audited and retained. Other existing working-tree changes were preserved.

## API contract

Both authenticated POST /api/orders/checkout-preview and POST /api/orders/checkout accept only the exact strings COD and ONLINE. Omission defaults to COD because the existing frontend preview omits paymentMethod. Explicit null, blank strings, whitespace-padded strings, booleans, numbers, arrays, objects, unknown methods and WALLET return HTTP 400. Online is never converted to COD.

COD preview fields and advance calculations remain unchanged. Zone and product COD exclusions still reject COD. Online requires serviceable domestic shipping but ignores COD exclusions for checkout eligibility. Unknown Indian postal codes retain the existing shipping service's standard/manual-confirmation fallback; international delivery remains unavailable.

Online preview returns paymentMethod ONLINE, authoritative totalAmount and shippingFee, onlineAmountRequired equal to totalAmount, zero onlineAdvanceRequired/onlineAmountPaid/codDueAfterAdvance/remainingCodDue/potentialCodAmount, currentUnpaidBalance equal to totalAmount, and estimatedDeliveryDate. isCODAvailable is informational and reflects both zone and product eligibility. No financial input from the client is retained by checkout validation. Online creation uses the same preview total calculation and existing pricing/coupon/offer services.

## Transaction and initial state

Online checkout uses one MongoDB session.withTransaction boundary for: existing-order lookup; CheckoutAttempt creation; cart reload/population and version validation; Product and variant reads; authoritative prices, offers and coupon validation; shipping-zone/serviceability lookup; sequential variant stock reservation; Order creation; cart clearing and version increment; coupon usage increment; and CheckoutAttempt completion. All relevant database reads/writes receive the session. Errors abort all changes. No nontransactional Online fallback exists.

The created Order is ONLINE / Pending / Reserved, with server inventoryReservedAt and expiry exactly 20 minutes later. onlineAmountPaid, onlineAdvanceRequired, remainingCodDue, potentialCodAmount, codAmountCollected and advanceAmount are zero. onlinePayment is null. remainingAmount is the full authoritative total. No money has been received.

Stock is tracked on Product variants; the existing model has no top-level product stock. Products without variants retain existing untracked-stock behavior. Online validates positive integer quantities, unique variant resolution and combined quantities across cart lines before reservation. Creation never increments soldCount; Part 2B/3A FULL_ONLINE settlement performs Reserved to Committed and increments sales. Existing COD stock/sales behavior remains unchanged.

The Order retains purchased items, resolved options, design data, authoritative prices, discounts and shipping address. Cart items/coupon are cleared and its version increments only with successful commit. A future Part 3C payment retry attaches to the persisted Order and does not need a rebuilt cart. After expiry a fresh checkout/reservation is required; no cart restoration or payment UI is introduced here.

Notifications occur after commit. Online email explicitly says awaiting payment/unpaid, with no COD collection claim. COD notification behavior is retained.

## Idempotency and expiry

The existing UUID Idempotency-Key and unique user/key indexes remain. A repeated fingerprint returns the authoritative Order without reserving stock or consuming the coupon again. A changed fingerprint returns HTTP 409. Online Orders additionally retain checkoutRequestFingerprint so CheckoutAttempt's seven-day TTL cannot defeat replay. An older Order missing this fingerprint after attempt cleanup fails closed with a conflict; no duplicate reservation is created.

Pending + Reserved + unexpired orders are reused. Missing/invalid expiry returns HTTP 409. Expired reservations invoke the Part 3A release service, then return HTTP 409 requiring fresh checkout. Released reservations cannot be reused or resurrected. A concurrent successful Paid + Committed settlement is returned without releasing stock. The completed-attempt fallback applies the same expiry validation. COD replay remains unchanged.

CheckoutAttempt creation and Completed bookkeeping commit together with the Online Order. Aborted transactions leave no new Processing/Completed attempt, so a genuine failure can retry the same key. Coupon usage increments once at order creation within the transaction, as in the existing architecture. Expiry does not redesign or refund coupon usage.

## Verification

15 scripts passed:

- testMethodAwareCheckoutPreview.js
- testOnlineCheckoutTransaction.js
- testOnlineCheckoutRetry.js
- testOnlineCheckoutAuthority.js
- testPaymentSchemas.js (Part 2A schemas)
- testCodAdvanceSettlementInvariant.js (settlement invariants)
- testPurposeAwareSettlement.js (Part 2B)
- testOnlineInventoryReservation.js (Part 3A)
- testRazorpaySettlement.js
- testCodCollection.js
- testRazorpayWebhook.js
- testOrderTrackingStatus.js
- testFinancialAnalytics.js
- testRazorpayOrderCreation.js
- testCodCustomerMessaging.js

Focused tests cover COD eligibility/advance regression, Online with COD-disabled products/zones, strict input allowlisting, ignored forged financial fields, current Product prices and variants, coupon limits, shipping, aggregate stock, successful pending state, unchanged soldCount, transaction session propagation, stock/order/coupon failure rollback, cart version conflicts, same-key replay, replay after attempt cleanup, recoverable failure, expired/released reservations and settlement races.

Tests use pure assertions and mocked database models/transaction rollback. The webhook test additionally uses an isolated loopback HTTP server. No live MongoDB transaction/concurrency or payment-provider integration was run. Deployment must provide MongoDB transaction support (replica set or sharded cluster) and the existing unique indexes. No database or provider operations were executed by this task.

npm run check passed for 151 backend JavaScript files. Repository-wide git diff --check reports pre-existing whitespace in src/app.js:107 and src/services/email.service.js:73. Scoped tracked-file checking retains only the same pre-existing email whitespace. Newly added test files and documentation have no trailing whitespace.

Route audit: order routes expose checkout, checkout-preview and existing COD advance initiation/verification only. There is no full Online initiation/verification or Wallet payment endpoint. Existing foundation FULL_ONLINE settlement code remains available internally but checkout does not create a Payment or providerOrderId.

Frontend, .env, Razorpay TEST MODE and secrets were not changed; no secrets were exposed and no packages installed. No Wallet implementation or payment selector was added. Part 3C payment initiation/verification, scheduler and frontend work remain outside this task.

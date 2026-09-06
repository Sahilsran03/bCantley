# Part 4B: Full Wallet checkout backend

1. **Files changed** (backend-relative):
   - `src/models/Order.js`
   - `src/validators/order.validator.js`
   - `src/controllers/order.controller.js`
   - `src/controllers/analytics.controller.js`
   - `src/controllers/return.controller.js` (Wallet cancellation guard only)
   - `src/services/checkout-preview.service.js`
   - `src/services/financial-analytics.service.js`
   - `src/services/order-status.service.js`
   - `src/services/email.service.js`
   - `src/scripts/auditOrderFinancials.js` (populate Wallet posting for classification; not executed)
   - New `src/scripts/testWalletCheckout.js`
   - New `src/scripts/testWalletPreviewAuthority.js`
   - New `src/scripts/testWalletAnalytics.js`
   - `src/scripts/testMethodAwareCheckoutPreview.js`
   - `src/scripts/testFullOnlineAnalytics.js`
   - `src/scripts/testFinancialAnalytics.js`
   - `src/scripts/testCodCustomerMessaging.js`
   - `PART_4B.md`

2. **Order schema:** paymentMethod strictly allows COD, ONLINE, WALLET. Existing defaults and legacy Orders remain valid. Payment.purpose remains COD_ADVANCE/FULL_ONLINE and was not changed.

3. **Exact attribution:** optional Order.walletPayment references WalletTransaction and has a lookup index. A pre-generated Order ObjectId is passed to the shared wallet debit, and its returned transaction ID is attached to that same Order, all before one transaction commit. Neither onlinePayment nor codAdvancePayment is reused.

4. **Preview contract:** authenticated POST /api/orders/checkout-preview accepts WALLET plus the existing allowlisted address/coupon/Cart-version inputs. It reloads Cart and Products, checks variants and cumulative stock, uses shared authoritative pricing/coupon and shipping services, and separately loads User.walletBalance from the database. It returns paymentMethod, totalAmount, shippingFee, walletBalance, walletAmountRequired, isWalletSufficient, walletBalanceAfterPayment, delivery estimate, preview:true and zero Online/COD components. Preview performs no persistent writes.

5. **Sufficient balance:** for total INR 400 and balance INR 1000, required=400, sufficient=true, balanceAfterPayment=600. The figures are informational; checkout recalculates and performs a conditional debit again.

6. **Insufficient balance:** for total INR 400 and balance INR 250, sufficient=false and balanceAfterPayment=null. Actual insufficient checkout returns 409 without a partial debit or other committed writes. The Part 4A positive safe whole-INR convention remains: fractional/malformed balances and non-positive or non-whole totals cannot fund a posting. Existing valid whole-INR legacy balances work without a historical ledger migration.

7. **Transaction boundary:** Online and Wallet share createTransactionalCheckout for authoritative Cart version, Product/variant reads, pricing, coupon, shipping, item allocation, inventory, Order, Cart and CheckoutAttempt operations. Wallet uses immediate payment/commit; Online retains its pending reservation behavior. Every financial/inventory/Cart/coupon/attempt write joins one MongoDB session/transaction. Notifications/email run after commit and are skipped on idempotent replay.

8. **debitWallet:** calls the unchanged Part 4A service with exact user, final total, ORDER_PAYMENT, Order ObjectId, wallet-order-payment:<orderId> and the active checkout session. No checkout code directly changes User.walletBalance. Ledger insertion and balance deduction abort together with the remaining transaction on failure.

9. **Financial state:** Wallet Order is Paid with walletPayment; onlineAmountPaid, onlineAdvanceRequired, remainingCodDue, potentialCodAmount, codAmountCollected, advanceAmount and remainingAmount are zero. onlinePayment is null and codAdvancePayment retains its null default. Order status starts Pending for fulfillment. The checkout response is HTTP 201 with the authoritative Order; Wallet COD display due is zero. There is no payment popup payload or second payment endpoint.

10. **Inventory/soldCount:** inventoryStatus=Committed immediately. No Reserved state or 20-minute expiry is created for Wallet. Existing exact variant stock reductions and soldCount increments run sequentially in the checkout transaction. Aborted writes roll back; replays do not decrement or increment again. Existing Product architecture tracks stock on variants; products without variants retain existing checkout semantics.

11. **Idempotency:** the existing user/key CheckoutAttempt unique index and durable user/checkoutIdempotencyKey Order unique index protect checkout retries. Fingerprints bind method, Cart version, address, coupon and notes; changed requests conflict. Completed attempts resolve to the same authoritative Order, including after the seven-day attempt TTL cleanup via the Order key. Wallet's deterministic per-Order key independently protects its posting. An aborted transaction leaves no successful attempt and permits retry with the same key.

12. **Concurrent wallet protection:** the Part 4A conditional debit requires sufficient current balance and contends on the exact User document. Two different INR 400 checkouts cannot both debit INR 500. Shared Cart writes/version checks provide additional protection but are not the wallet balance safety mechanism. Tests isolate wallet contention using separate simulated authoritative carts. Real MongoDB write conflicts/retries have not been exercised here.

13. **Cart:** loaded and version-checked inside the transaction; successful checkout clears items/coupon and increments version. Failure restores contents, coupon and version. Stale expected versions reject before payment. Replay works after Cart clearing.

14. **Coupon:** unchanged shared pricing/rules determine discounts. Usage increments in the same transaction after Order/Cart writes and only once on success. Coupon bookkeeping failure rolls back wallet, stock, sales, Order, Cart and attempt. No duplicate pricing formulas were added.

15. **COD independence:** Wallet checks normal shipping serviceability/international restrictions; it does not require zone.isCODAvailable or product.codAvailable. Tests cover both disabled together with a successful preview and checkout. COD restrictions remain unchanged.

16. **Analytics:** Wallet Received is derived from POSTED/DEBIT/ORDER_PAYMENT WalletTransaction records joined to the exact Order.walletPayment, matching user and total, with paymentMethod=WALLET. Reward credits, refunds, reversals and unrelated debits do not count as sales receipts. Gross Money Received adds Online Received + COD Collected + Wallet Received once, without adding Order totals a second time. Wallet uses posting createdAt for receipt date grouping. Paid-order classification populates and validates the exact debit; Wallet contributes zero COD outstanding and counts Fully Paid. Unpopulated/mismatched Wallet attribution is incomplete rather than guessed from total. Dashboard API exposes walletReceived; frontend labels/UI are deferred. Gross receipts are not net revenue, cash inflow from wallet funding, or refund-adjusted revenue.

17. **Email:** minimal Wallet branch in the existing confirmation template says Payment method: Wallet and Payment status: Paid. It contains no COD due, Razorpay or advance instructions. Existing COD and Online templates/behavior remain.

18. **Cancellation/refund limitation:** full Wallet refunds are deliberately not implemented. Wallet cancellation requests and cancellation status transitions return a clear 409 before any request/status/stock change, avoiding an incorrect NotRequired refund request or unpaid Online release. Existing Online reservation release only matches ONLINE. No wallet refund is claimed or performed. Future cancellation must atomically restore eligible inventory and credit/reverse the exact walletPayment, with authorization and once-only refund attribution. General existing return/refund processing is not Wallet-aware and must not be treated as a completed wallet refund workflow; only the cancellation safety guard was added to return.controller.js.

19. **Security:** financial values supplied in body or stale authenticated user data are ignored; User balance is read server-side and authoritative Product/Cart pricing is reused. Checkout validators allow only existing checkout inputs and the strict method enum. No arbitrary ledger, debit, credit or reversal endpoint was added. Existing route authentication and server user ownership remain. Wallet checkout has no Razorpay calls, Payment.create, FULL_ONLINE record or provider IDs. Existing provider services reject non-ONLINE/non-COD methods before provider use.

20. **Tests run:** testWalletFoundation; testWalletCheckout; testWalletPreviewAuthority; testWalletAnalytics; testReviewSecurity; testFullOnlinePayment; testFullOnlineAnalytics; testPurposeAwareSettlement; testOnlineInventoryReservation; testMethodAwareCheckoutPreview; testOnlineCheckoutTransaction; testOnlineCheckoutRetry; testOnlineCheckoutAuthority; testCodAdvanceSettlementInvariant; testRazorpaySettlement; testCodCollection; testRazorpayWebhook; testFinancialAnalytics; testOrderTrackingStatus; testRazorpayOrderCreation; testPaymentSchemas; testCodCustomerMessaging. Also npm run check and repository/scoped whitespace checks.

21. **Results:** all 22 scripts passed after updating intentional contract expectations. Prior WALLET-invalid tests now assert WALLET acceptance and reject WALLET+ONLINE while retaining the other invalid cases. Existing analytics assertions retain prior Online/COD totals with explicit zero-wallet mocks/new fields. The COD preview source-boundary assertion follows the renamed shared checkout function and retains all forbidden-write assertions. New tests cover actual preview handler with actual pricing/shipping helpers and mocked models, INR 1000->600 checkout, exact before/after and references, successful/TTL retries, conflicting fingerprints, legacy spending, stale Cart version, failure then same-key recovery, insufficient balance, preview/commit race, duplicate and competing calls, stock/Order/sales/coupon/Cart/attempt rollback, cancellation guards, email and receipt attribution. MongoDB transactions/concurrency and aggregation are simulated; no real database, real contention or live provider charge tests were run. Backend syntax check passes 163 files. Repository diff check retains known app.js:107 and email.service.js:73 whitespace; scoped checks retain only that pre-existing email line, with no new whitespace issues.

22. **Known unrelated failure:** the previously reported testReturnsRefunds fixture lacks authoritative refundableLineAmountPaise. It was not rerun or repaired in Part 4B. The refund service and fixture remain untouched. The only return controller edit is the required Wallet cancellation safety guard.

23. **Indexes/deployment:** new nonunique Order.walletPayment lookup index. Preserve/verify Part 4A WalletTransaction unique user/idempotencyKey, partial reward uniqueness, reversalOf uniqueness and chronology/reference indexes; preserve CheckoutAttempt user/key uniqueness and TTL; preserve Order user/checkoutIdempotencyKey partial uniqueness and Part 3C Payment.onlineAttemptKey uniqueness. Model declarations are not proof of deployed indexes: inspect/build/verify before enabling Wallet traffic. A transaction-capable MongoDB replica set/sharded deployment is required. No index creation, syncIndexes, migration, package installation or database audit was run. Real replica-set rollback/contention validation remains a deployment check.

24. **Remaining Wallet work:** authorized full/partial cancellation/refund integration and refund accounting using exact walletPayment; frontend Wallet selector, balance display and success flow; customer history/read API; legacy baseline reconciliation; real database contention/retry checks and production index verification. Split payments remain unsupported. Positive whole-INR postings remain the deliberate Part 4A limitation; zero-total checkout and fractional Wallet use need a separately defined policy.

25. **Scope confirmation:** frontend untouched; .env/secrets untouched; Razorpay TEST MODE unchanged; no secrets exposed; no Razorpay used or Payment record created for Wallet; no split payments; Wallet selector not added; existing Online and COD behavior preserved by regressions. Unrelated working-tree changes preserved. Stop after Part 4B.

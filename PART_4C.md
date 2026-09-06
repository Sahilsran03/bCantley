# Part 4C: Wallet cancellation and restoration

## 1. Files and scope

The workspace already contained the Part 4C cancellation implementation and integrations at the start of this session. They were audited and retained. This session changed:
- src/services/wallet-cancellation.service.js: reject malformed debit/refund references and inconsistent request ownership, amounts, and cancellation evidence on replay.
- src/services/financial-analytics.service.js: refund aggregation verifies the original debit, currency, paise amount, and idempotency linkage.
- src/scripts/testWalletCancellation.js: malformed replay and remaining-amount tests.
- src/scripts/testWalletAnalytics.js: refund evidence predicates, refund-only dates, cancelled classification, and gross/net tests.
- PART_4C.md: this report.

Existing Part 4C integration files reviewed: src/models/RefundTransaction.js, src/services/order-status.service.js, src/controllers/order.controller.js, src/controllers/return.controller.js, src/services/return-refund.service.js, src/controllers/analytics.controller.js, and the Wallet/financial regression scripts. Order, WalletTransaction, ReturnRequest, wallet service, routes, validators, inventory checkout, and email service were inspected. Unrelated working-tree edits were preserved.

## 2. Existing cancellation architecture

Authenticated customers can request cancellation only for their own Orders through POST /api/returns with type CANCEL. Cancellation eligibility is Pending, Design Review, or Approved, before Printing. Requests require admin approval; they do not themselves cancel fulfillment.

Admin routes use protect plus authorizeRoles("admin"). PUT /api/admin/orders/:id/status reaches transitionOrderStatus. PUT /api/admin/returns/:id/status processes approval/rejection. The canonical lifecycle uses compare-and-set for ordinary transitions and rejects backward moves and changes from terminal states.

Existing non-Wallet cancellation restores matching variant stock after the lifecycle update. Unpaid ONLINE reservations use releaseOnlineInventoryReservation and Released. Existing accepted-order cancellation does not reverse soldCount. Its status and restock are not one shared transaction; this task does not redesign that non-Wallet behavior.

An existing non-Wallet customer CANCEL approval/rejection limitation was found: the controller's Approved/Rejected branch requires a RETURN snapshot, so legacy CANCEL requests hit manual reconciliation and its later cancellation-approval branch is unreachable. Wallet now has its own central service delegation before that branch. COD/ONLINE behavior was preserved, including this limitation, rather than silently repairing unrelated architecture.

## 3–5. Refund architecture, original debit, and amount source

WalletTransaction remains the immutable balance-movement authority. Order.walletPayment identifies the exact POSTED ORDER_PAYMENT DEBIT. The original debit is never deleted or rewritten.

Cancellation requires WALLET, historically Paid, exact payment ID, same user and Order, INR, positive safe whole-INR amount, consistent before/after balances, and amount equal to the persisted Order total. Mixed payment components and conflicting payment/reward/refund/reversal references are rejected. No frontend refund amount or financial attribution is consumed.

Refund amount equals the verified debit amount minus verified prior ORDER_REFUND credits. Every prior credit must match Completed WALLET RefundTransaction evidence, exact original payment, transaction ID, key, amount/paise, currency, user, and consistent balances. Reversals, over-refunds, orphan evidence, and malformed history require manual reconciliation.

RefundTransaction links Order, optional cancellation request, original walletPayment, and exact compensating walletTransaction. Its WALLET method has no provider payment, provider refund ID, or manual payment fields. Multiple future refund records are possible; only CANCELLATION is unique per Order. No Order.walletRefund singleton was added. Future partial-refund evidence is accounted for, but no partial-refund API is enabled.

## 6–8. Transaction, inventory, and soldCount

finalizeWalletCancellation uses a single MongoDB session.withTransaction for all authoritative reads and writes:
- centralized creditWallet adds the remaining amount to User.walletBalance and posts ORDER_REFUND CREDIT with before/after balances;
- RefundTransaction stores exact workflow evidence;
- each original variant is matched by SKU or the existing option fields and restocked;
- Order lifecycle, inventory/refund status, tracking history, and active cancellation request/history updates are saved.

Missing products, ambiguous/missing variants, and invalid quantities/stocks fail closed. Non-variant products follow existing checkout semantics, which did not deduct variant stock. Final inventoryStatus is Restocked, never Released. soldCount remains unchanged consistently with existing COD/ONLINE cancellation: it records gross accepted sales rather than retained sales. No Wallet-only metric correction was introduced.

## 9–11. Final states and customer/admin behavior

Final invariant:
- orderStatus = Cancelled
- paymentStatus = Paid (historical payment fact; enum unchanged)
- inventoryStatus = Restocked
- refundStatus = Refunded
- original ORDER_PAYMENT DEBIT plus attributed ORDER_REFUND CREDIT(s) totaling that debit.

Customer request creation stores Pending/Pending and history transactionally, without moving money or inventory. Approval sets the request Approved with refundStatus Processed, authoritative approved/refunded amounts, and completion timestamps. Rejection sets Rejected/NotRequired and leaves the Order and balance active/unchanged.

Both direct admin cancellation and customer-request approval converge on finalizeWalletCancellation. Late cancellation remains prohibited. Malformed Wallet Orders fail toward reconciliation instead of receiving guessed credits.

## 12–14. Idempotency, balance, and refund evidence

Deterministic key: wallet-order-refund:<orderId>:cancellation. Wallet's unique user/idempotencyKey index and conditional current User balance update protect postings. RefundTransaction also uniquely identifies the key, walletTransaction, and per-Order CANCELLATION evidence. Order and inventory writes participate in the same transaction; competing writers conflict and MongoDB's transaction helper retries eligible transient errors.

A successful replay validates terminal Order, complete ledger/evidence totals, exact request ownership/linkage, and request amount/status before returning changed:false. It does not refund, restock, or append terminal history again. Disagreeing active/terminal state requires reconciliation. Database uniqueness prevents duplicate final credits even if an unusual conflict surfaces as an error requiring retry.

The credit adds to the current balance: 600 + 400 = 1000; with a later reward, 700 + 400 = 1100. It never restores a stale absolute snapshot.

WalletTransaction = authoritative balance movement. RefundTransaction = workflow/evidence and original-debit linkage, not a fake Razorpay refund. Customer refund summaries retain the existing safe projection; admin responses include a small walletRefund amount/status confirmation. No new public arbitrary-credit endpoint exists.

## 15. Analytics

Wallet Received counts attributed POSTED ORDER_PAYMENT DEBITs on their posting dates.
Wallet Refunded counts attributed POSTED ORDER_REFUND CREDITs, joined to Completed WALLET refund evidence and the exact original ORDER_PAYMENT debit, on refund posting dates.
Net Wallet Received = Wallet Received - Wallet Refunded; a refund-only period can be negative.
Gross Money Received remains historical Online Received + COD Collected + Wallet Received. It is not retained money, refund-adjusted revenue, or Net Revenue.
Cancelled Order Value includes cancelled totals; cancelled Orders do not count Fully Paid.
Order-level gross receipts remain historical. No total-plus-debit double counting occurs. Reward credits and reversals are excluded from sales/refund receipt purposes.
Dashboard and date-series API fields expose walletRefunded and netWalletReceived; frontend is deferred.

## 16. Messaging

Existing in-app cancellation notifications say the Order was cancelled and the exact amount restored to Wallet. They run only after finalize returns from commit and only when changed:true. No cancellation email existed to amend; the email service was inspected and unchanged. No Wallet message claims a bank/Razorpay refund or settlement delay.

Notification delivery is not a transactional outbox. As with existing admin status handling, a notification failure after commit can surface an API error; a cancellation retry verifies the existing result without moving money again. Durable delivery is separate work.

## 17–19. Failure safety, malformed Orders, and returns

Tests inject ledger credit, inventory save, Order save, refund evidence, request save, and pre-commit failures. The simulated transaction restores balance, ledger, inventory, Order, evidence, and requests together. Original missing/mismatched debit, wrong direction/purpose/status/user/Order/amount, inconsistent refunded state, or contradictory references rejects without a guessed credit.

Wallet item returns are explicitly blocked at eligibility, approval/receipt, refund-state synchronization, and manual/provider refund recording. They require later Wallet-aware return implementation/manual reconciliation. No unrelated returns fixture or refund allocation logic was repaired.

## 20–23. Verification and results

23 scripts passed:
testWalletFoundation, testWalletCheckout, testWalletPreviewAuthority, testWalletCancellation, testWalletAnalytics, testReviewSecurity, testFullOnlinePayment, testFullOnlineAnalytics, testPurposeAwareSettlement, testOnlineInventoryReservation, testMethodAwareCheckoutPreview, testOnlineCheckoutTransaction, testOnlineCheckoutRetry, testOnlineCheckoutAuthority, testCodAdvanceSettlementInvariant, testRazorpaySettlement, testCodCollection, testRazorpayWebhook, testFinancialAnalytics, testOrderTrackingStatus, testRazorpayOrderCreation, testPaymentSchemas, testCodCustomerMessaging.

Coverage includes credit/debit/reversal/rewards, insufficient and competing balances, authoritative preview/checkout, Cart/coupon/inventory rollback, request/approval/rejection, duplicate/concurrent-style finalization, current-balance addition, exact remaining refund, malformed replay evidence, and COD/ONLINE isolation. Online initiation/verification/settlement/reservation/webhook and COD settlement/collection regressions pass.

testReturnsRefunds still fails at line 34: its old fixture lacks authoritative refundableLineAmountPaise. This is the known post-discount allocation failure; the fixture and unrelated return production logic were not changed.

node src/scripts/checkSyntax.js passed all 165 backend JavaScript files.
git diff --check retains only the documented pre-existing src/app.js:107 and src/services/email.service.js:73 trailing whitespace. Scoped changed-file whitespace checks pass.

Tests use actual services with model/transaction mocks; webhook coverage includes local HTTP with a mocked provider. Real MongoDB rollback, write contention, commit ambiguity, and aggregation execution were not exercised. No live database, migration, provider charge/refund, or external email was run.

## 24. Deployment and indexes

Requires transaction-capable MongoDB (replica set or supported sharded deployment).
Verify/build the Part 4C RefundTransaction unique walletTransaction partial index and unique (order, walletRefundKind) partial index for method WALLET/kind CANCELLATION. Preserve its existing unique idempotencyKey and providerRefundId indexes.
Preserve WalletTransaction unique (user, idempotencyKey), reward uniqueness, reversalOf uniqueness, and order/chronology indexes. No new WalletTransaction index is needed.
Preserve Order.walletPayment lookup and existing checkout/payment indexes.
No destructive migration, syncIndexes, index build, or historical rewrite was run. Schema declarations do not prove deployed indexes.

Properly attributed historical Part 4B Wallet Orders need no backfill. Missing or inconsistent history requires manual reconciliation, never synthetic debit history. Verify deployed indexes and real replica-set concurrent cancellation/rollback before enabling traffic.

## 25–26. Remaining work and confirmations

Remaining Wallet work: item returns and partial-refund workflows, frontend selector/balance/success/history experience, legacy baseline reconciliation, real database integration tests and index verification. Full cancellation is the only enabled new lifecycle here.

Frontend untouched by this session; .env and secrets untouched; Razorpay TEST MODE unchanged; no Razorpay used for Wallet refunds; no arbitrary public wallet credit; no split payments; Wallet selector remains unexposed by this task; Online and COD behavior preserved by regressions, with existing limitations stated above. No packages installed. Unrelated changes preserved.

Stop after Part 4C.
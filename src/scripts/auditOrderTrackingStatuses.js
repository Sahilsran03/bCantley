import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import Order from "../models/Order.js";
import { CANONICAL_ORDER_STATUSES } from "../services/order-status.service.js";

mongoose.set("autoIndex", false);
await connectDatabase();

const activeStatuses = CANONICAL_ORDER_STATUSES.filter((status) => status !== "Cancelled");
const fulfillmentMapping = {
  Pending: "NotStarted",
  "Design Review": "DesignReview",
  Approved: "Approved",
  Printing: "Printing",
  "Quality Check": "QualityCheck",
  Packing: "Packed",
  Shipped: "Shipped",
  Delivered: "Delivered"
};

try {
  const orders = await Order.find()
    .select("orderNumber orderStatus trackingHistory shippedAt deliveredAt fulfillmentStatus")
    .lean();
  const report = [];

  for (const order of orders) {
    const history = order.trackingHistory || [];
    const latest = history.at(-1);
    const reasons = [];

    if (!history.length) reasons.push("Missing tracking history");
    if (history.some((event) => !CANONICAL_ORDER_STATUSES.includes(event.status))) {
      reasons.push("Contains noncanonical tracking status");
    }
    if (order.orderStatus === "Delivered" && latest?.status !== "Delivered") {
      reasons.push("Delivered Order does not end with Delivered history");
    }
    if (latest?.status === "Delivered" && order.orderStatus !== "Delivered") {
      reasons.push("Delivered history does not match canonical Order status");
    }
    const firstCancellationIndex = history.findIndex((event) => event.status === "Cancelled");
    if (
      order.orderStatus === "Cancelled" &&
      firstCancellationIndex >= 0 &&
      history.slice(firstCancellationIndex + 1).some((event) => activeStatuses.includes(event.status))
    ) {
      reasons.push("Cancelled Order has later active/non-cancellation history");
    }
    if (order.shippedAt && !history.some((event) => event.status === "Shipped")) {
      reasons.push("shippedAt exists without Shipped history");
    }
    if (!order.shippedAt && activeStatuses.indexOf(order.orderStatus) >= activeStatuses.indexOf("Shipped")) {
      reasons.push("Shipped-or-later Order is missing shippedAt");
    }
    if (Boolean(order.deliveredAt) !== (order.orderStatus === "Delivered")) {
      reasons.push("deliveredAt is inconsistent with canonical status");
    }
    const expectedFulfillment = fulfillmentMapping[order.orderStatus];
    if (expectedFulfillment && order.fulfillmentStatus !== expectedFulfillment) {
      reasons.push(`fulfillmentStatus is stale (expected ${expectedFulfillment})`);
    }
    if (history.some((event, index) => index > 0 && event.status === history[index - 1].status)) {
      reasons.push("Contains consecutive duplicate status events");
    }

    if (reasons.length) {
      report.push({
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        latestTrackingStatus: latest?.status || null,
        shippedAt: order.shippedAt,
        deliveredAt: order.deliveredAt,
        fulfillmentStatus: order.fulfillmentStatus,
        mismatchReason: reasons,
        suggestedManualAction: "Review this Order in Admin and reconcile its canonical status, timeline, and timestamps manually."
      });
    }
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, count: report.length, report }, null, 2));
} finally {
  await mongoose.disconnect();
}

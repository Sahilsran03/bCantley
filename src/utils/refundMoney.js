import crypto from "node:crypto";
import { AppError } from "./appError.js";

const decimalPattern = /^\d+(?:\.\d{1,2})?$/;

export const inrToPaise = (value, label = "Amount", { allowZero = true } = {}) => {
  const normalized = String(value ?? "").trim();
  if (!decimalPattern.test(normalized)) throw new AppError(`${label} must use at most 2 decimal places.`, 400);
  const numeric = Number(normalized);
  const paise = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(paise) || paise < (allowZero ? 0 : 1)) throw new AppError(`${label} is invalid.`, 400);
  return paise;
};

export const paiseToInr = (paise) => Number((Number(paise) / 100).toFixed(2));

export const allocateRefundableMerchandise = ({ orderItems, merchandisePayable }) => {
  const targetPaise = inrToPaise(merchandisePayable, "Refundable merchandise total");
  const weights = orderItems.map((item) => inrToPaise(Number(item.finalPrice) * Number(item.quantity), "Order line value"));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (!totalWeight) {
    if (targetPaise !== 0) throw new AppError("Refundable merchandise allocation is invalid.", 500);
    return orderItems.map((item) => ({ ...item, refundableLineAmountPaise: 0, refundableUnitBasePaise: 0, refundableUnitRemainderPaise: 0 }));
  }
  const raw = weights.map((weight, index) => ({ index, floor: Math.floor((targetPaise * weight) / totalWeight), remainder: (targetPaise * weight) % totalWeight }));
  let residual = targetPaise - raw.reduce((sum, entry) => sum + entry.floor, 0);
  raw.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < residual; index += 1) raw[index].floor += 1;
  raw.sort((a, b) => a.index - b.index);
  return orderItems.map((item, index) => {
    const linePaise = raw[index].floor;
    const quantity = Number(item.quantity);
    return { ...item, refundableLineAmountPaise: linePaise, refundableUnitBasePaise: Math.floor(linePaise / quantity), refundableUnitRemainderPaise: linePaise % quantity };
  });
};

export const quantityEntitlementPaise = ({ lineAmountPaise, originalQuantity, startQuantity = 0, quantity }) => {
  const line = Number(lineAmountPaise);
  const totalQuantity = Number(originalQuantity);
  const start = Number(startQuantity);
  const count = Number(quantity);
  if (![line, totalQuantity, start, count].every(Number.isSafeInteger) || line < 0 || totalQuantity < 1 || start < 0 || count < 0 || start + count > totalQuantity) throw new AppError("Return quantity entitlement is invalid.", 409);
  return Math.floor((line * (start + count)) / totalQuantity) - Math.floor((line * start) / totalQuantity);
};

export const buildRefundOperationFingerprint = (operation) => crypto.createHash("sha256").update(JSON.stringify({
  returnRequest: String(operation.returnRequest), order: String(operation.order), method: operation.method,
  amountPaise: operation.amountPaise, payment: operation.payment ? String(operation.payment) : null,
  providerRefundId: operation.providerRefundId || null, manualMethod: operation.manualMethod || null,
  manualReference: operation.manualReference || null
})).digest("hex");

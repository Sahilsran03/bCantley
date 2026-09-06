import { asyncHandler } from "../utils/asyncHandler.js";
import { createOnlinePaymentService } from "../services/online-payment.service.js";

const service = createOnlinePaymentService();
export const createOnlinePayment = asyncHandler(async (req, res) => {
  res.status(200).json(await service.initiate({ orderId: req.params.id, userId: req.user._id }));
});
export const verifyOnlinePayment = asyncHandler(async (req, res) => {
  res.status(200).json(await service.verify({ orderId: req.params.id, userId: req.user._id, body: req.body }));
});

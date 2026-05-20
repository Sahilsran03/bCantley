import Offer from "../models/Offer.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getActiveOffers } from "../services/pricing.service.js";
import { createAudienceNotifications } from "../services/notification.service.js";
import { validateOfferInput } from "../validators/offer.validator.js";

export const listActiveOffers = asyncHandler(async (req, res) => {
  const offers = await getActiveOffers();

  res.status(200).json({
    success: true,
    count: offers.length,
    offers
  });
});

export const listAdminOffers = asyncHandler(async (req, res) => {
  const offers = await Offer.find().populate("targetProduct", "name").populate("targetCategory", "name").sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: offers.length,
    offers
  });
});

export const createOffer = asyncHandler(async (req, res) => {
  const payload = validateOfferInput(req.body);
  const offer = await Offer.create(payload);
  if (offer.isActive) {
    await createAudienceNotifications({
      audience: "CUSTOMERS",
      title: "New Cantley offer",
      message: offer.title,
      type: "OFFER",
      link: "/shop"
    });
  }

  res.status(201).json({
    success: true,
    offer
  });
});

export const updateOffer = asyncHandler(async (req, res) => {
  const payload = validateOfferInput(req.body, true);
  const offer = await Offer.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });

  if (!offer) throw new AppError("Offer not found.", 404);

  res.status(200).json({
    success: true,
    offer
  });
});

export const deleteOffer = asyncHandler(async (req, res) => {
  const offer = await Offer.findByIdAndDelete(req.params.id);

  if (!offer) throw new AppError("Offer not found.", 404);

  res.status(200).json({
    success: true,
    message: "Offer deleted."
  });
});

export const toggleOfferActive = asyncHandler(async (req, res) => {
  const offer = await Offer.findById(req.params.id);

  if (!offer) throw new AppError("Offer not found.", 404);

  offer.isActive = !offer.isActive;
  await offer.save();
  if (offer.isActive) {
    await createAudienceNotifications({
      audience: "CUSTOMERS",
      title: "Cantley offer is live",
      message: offer.title,
      type: "OFFER",
      link: "/shop"
    });
  }

  res.status(200).json({
    success: true,
    offer
  });
});

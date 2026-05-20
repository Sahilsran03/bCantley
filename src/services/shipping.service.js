import ShippingZone from "../models/ShippingZone.js";
import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();

export const getEstimatedDeliveryDate = (estimatedDays = 5) => {
  const date = new Date();
  date.setDate(date.getDate() + Number(estimatedDays || 5));
  return date;
};

export const checkShippingByPostalCode = async (postalCode, country = "India") => {
  const cleanPostalCode = text(postalCode);
  const cleanCountry = text(country) || "India";

  if (!cleanPostalCode) {
    throw new AppError("Postal code is required.", 400);
  }

  if (cleanCountry.toLowerCase() !== "india") {
    return {
      isServiceable: false,
      isInternational: true,
      message: "Contact WhatsApp for international shipping.",
      shippingFee: 0,
      estimatedDays: null,
      isCODAvailable: false,
      estimatedDeliveryDate: null
    };
  }

  const zone = await ShippingZone.findOne({ country: /^india$/i, postalCode: cleanPostalCode });

  if (!zone) {
    return {
      isServiceable: true,
      isInternational: false,
      message: "Standard India shipping will be manually confirmed by Cantley.",
      shippingFee: 0,
      estimatedDays: 5,
      isCODAvailable: true,
      estimatedDeliveryDate: getEstimatedDeliveryDate(5)
    };
  }

  return {
    isServiceable: true,
    isInternational: false,
    message: zone.isCODAvailable ? "COD is available for this postal code." : "COD is not available for this postal code.",
    shippingFee: zone.shippingFee,
    estimatedDays: zone.estimatedDays,
    isCODAvailable: zone.isCODAvailable,
    estimatedDeliveryDate: getEstimatedDeliveryDate(zone.estimatedDays),
    zone
  };
};

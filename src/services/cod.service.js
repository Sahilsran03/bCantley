import { AppError } from "../utils/appError.js";

const roundMoney = (value) => Math.max(0, Math.round(Number(value || 0)));

export const calculateCodTerms = ({ orderItems, totalAmount }) => {
  const codIneligibleItem = orderItems.find((item) => item.codAvailable === false);

  if (codIneligibleItem) {
    throw new AppError(`${codIneligibleItem.name} is not available for COD.`, 400);
  }

  const finalOrderAmount = roundMoney(totalAmount);
  const configuredAdvanceAmount = roundMoney(
    orderItems.reduce(
      (sum, item) => sum + Number(item.codAdvanceAmount || 0) * Number(item.quantity || 0),
      0
    )
  );
  const onlineAdvanceRequired = Math.min(finalOrderAmount, configuredAdvanceAmount);
  const onlineAmountPaid = 0;
  const codAmountCollected = 0;
  const remainingCodDue = Math.max(0, finalOrderAmount - onlineAmountPaid - codAmountCollected);
  const potentialCodAmount = remainingCodDue;

  return {
    onlineAdvanceRequired,
    onlineAmountPaid,
    codAmountCollected,
    remainingCodDue,
    potentialCodAmount
  };
};

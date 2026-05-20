import Order from "../models/Order.js";
import Reward from "../models/Reward.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validateAddress, validateUserProfile } from "../validators/user.validator.js";

const profileResponse = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  avatar: user.avatar || "",
  gender: user.gender || "",
  dateOfBirth: user.dateOfBirth,
  addresses: user.addresses || [],
  walletBalance: user.walletBalance || 0,
  loyaltyRank: user.loyaltyRank || "Member",
  role: user.role
});

const findAddress = (user, addressId) => {
  const address = user.addresses.id(addressId);
  if (!address) throw new AppError("Address not found.", 404);
  return address;
};

const applyDefaultAddress = (user, addressId) => {
  user.addresses.forEach((address) => {
    address.isDefault = address._id.toString() === addressId.toString();
  });
};

export const getUserProfile = asyncHandler(async (req, res) => {
  const [totalOrders, rewardsSummary, recentOrders] = await Promise.all([
    Order.countDocuments({ user: req.user._id }),
    Reward.aggregate([
      { $match: { user: req.user._id } },
      { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]),
    Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(5)
  ]);

  res.status(200).json({
    success: true,
    user: profileResponse(req.user),
    stats: { totalOrders, rewardsSummary, recentOrders }
  });
});

export const updateUserProfile = asyncHandler(async (req, res) => {
  const payload = validateUserProfile(req.body);
  Object.entries(payload).forEach(([key, value]) => {
    req.user[key] = value;
  });
  await req.user.save();
  res.status(200).json({ success: true, user: profileResponse(req.user) });
});

export const addAddress = asyncHandler(async (req, res) => {
  const address = validateAddress(req.body);
  if (!req.user.addresses.length || address.isDefault) {
    req.user.addresses.forEach((item) => { item.isDefault = false; });
    address.isDefault = true;
  }
  req.user.addresses.push(address);
  await req.user.save();
  res.status(201).json({ success: true, addresses: req.user.addresses });
});

export const updateAddress = asyncHandler(async (req, res) => {
  const payload = validateAddress(req.body);
  const address = findAddress(req.user, req.params.addressId);
  Object.assign(address, payload);
  if (payload.isDefault) applyDefaultAddress(req.user, address._id);
  await req.user.save();
  res.status(200).json({ success: true, addresses: req.user.addresses });
});

export const deleteAddress = asyncHandler(async (req, res) => {
  const address = findAddress(req.user, req.params.addressId);
  const wasDefault = address.isDefault;
  address.deleteOne();
  if (wasDefault && req.user.addresses[0]) req.user.addresses[0].isDefault = true;
  await req.user.save();
  res.status(200).json({ success: true, addresses: req.user.addresses });
});

export const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = findAddress(req.user, req.params.addressId);
  applyDefaultAddress(req.user, address._id);
  await req.user.save();
  res.status(200).json({ success: true, addresses: req.user.addresses });
});

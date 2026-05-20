import Notification from "../models/Notification.js";
import User from "../models/User.js";

export const createNotification = async ({ user, title, message, type = "SYSTEM", link = "" }) => {
  if (!user) return null;
  return Notification.create({ user, title, message, type, link });
};

export const createAudienceNotifications = async ({ audience = "ALL", title, message, type = "SYSTEM", link = "" }) => {
  const filter = {};
  if (audience === "CUSTOMERS") filter.role = "customer";
  if (audience === "ADMINS") filter.role = "admin";

  const users = await User.find(filter).select("_id").lean();
  if (!users.length) return { count: 0 };

  await Notification.insertMany(users.map((item) => ({ user: item._id, title, message, type, link })));
  return { count: users.length };
};

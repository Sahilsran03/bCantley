import Announcement from "../models/Announcement.js";
import Notification from "../models/Notification.js";
import { createAudienceNotifications } from "../services/notification.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validateAnnouncementInput } from "../validators/announcement.validator.js";

const activeWindowFilter = () => {
  const now = new Date();
  return {
    isActive: true,
    $and: [
      { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
      { $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }] }
    ]
  };
};

export const listMyNotifications = asyncHandler(async (req, res) => {
  const type = String(req.query.type || "").trim();
  const filter = { user: req.user._id };
  if (type) filter.type = type;

  const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(100);
  const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });

  res.status(200).json({ success: true, unreadCount, notifications });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { isRead: true },
    { new: true }
  );
  if (!notification) throw new AppError("Notification not found.", 404);
  res.status(200).json({ success: true, notification });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
  res.status(200).json({ success: true, message: "Notifications marked as read." });
});

export const listAdminNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find().populate("user", "name email role").sort({ createdAt: -1 }).limit(200);
  res.status(200).json({ success: true, count: notifications.length, notifications });
});

export const listActiveAnnouncements = asyncHandler(async (req, res) => {
  const audience = req.user?.role === "admin" ? ["ALL", "ADMINS"] : ["ALL", "CUSTOMERS"];
  const announcements = await Announcement.find({ ...activeWindowFilter(), targetAudience: { $in: audience } }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: announcements.length, announcements });
});

export const listAdminAnnouncements = asyncHandler(async (req, res) => {
  const announcements = await Announcement.find().sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: announcements.length, announcements });
});

export const createAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.create(validateAnnouncementInput(req.body));
  res.status(201).json({ success: true, announcement });
});

export const updateAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.findByIdAndUpdate(req.params.id, validateAnnouncementInput(req.body, true), {
    new: true,
    runValidators: true
  });
  if (!announcement) throw new AppError("Announcement not found.", 404);
  res.status(200).json({ success: true, announcement });
});

export const deleteAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.findByIdAndDelete(req.params.id);
  if (!announcement) throw new AppError("Announcement not found.", 404);
  res.status(200).json({ success: true, message: "Announcement deleted." });
});

export const sendManualAnnouncement = asyncHandler(async (req, res) => {
  const payload = validateAnnouncementInput(req.body);
  const announcement = await Announcement.create(payload);
  const result = await createAudienceNotifications({
    audience: payload.targetAudience,
    title: payload.title,
    message: payload.message,
    type: "SYSTEM",
    link: payload.buttonLink
  });
  res.status(201).json({ success: true, announcement, sentCount: result.count });
});

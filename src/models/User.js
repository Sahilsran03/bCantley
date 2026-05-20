import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, trim: true, default: "" },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true, default: "India" },
    postalCode: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20
    },
    password: {
      type: String,
      required: true,
      select: false
    },
    role: {
      type: String,
      enum: ["customer", "admin"],
      default: "customer"
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    refreshToken: {
      type: String,
      default: null,
      select: false
    },
    adminTwoFactorOtp: {
      type: String,
      default: null,
      select: false
    },
    adminTwoFactorOtpExpiry: {
      type: Date,
      default: null,
      select: false
    },
    adminTwoFactorRequestToken: {
      type: String,
      default: null,
      select: false
    },
    adminTwoFactorAttempts: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      select: false
    },
    passwordResetToken: {
      type: String,
      default: null,
      select: false
    },
    passwordResetExpiry: {
      type: Date,
      default: null,
      select: false
    },
    avatar: { type: mongoose.Schema.Types.Mixed, default: "" },
    gender: { type: String, trim: true, default: "" },
    dateOfBirth: { type: Date, default: null },
    addresses: { type: [addressSchema], default: [] },
    walletBalance: {
      type: Number,
      default: 0,
      min: 0
    },
    loyaltyRank: {
      type: String,
      default: "Member"
    }
  },
  {
    timestamps: true
  }
);

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.refreshToken;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model("User", userSchema);

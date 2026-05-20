import { Router } from "express";
import {
  createReelReward,
  createStoryReward,
  createWearEarnReward,
  getMyRewards
} from "../controllers/reward.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { handleMulterError, rewardProofUpload } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

router.post("/story", rewardProofUpload, handleMulterError, createStoryReward);
router.post("/reel", rewardProofUpload, handleMulterError, createReelReward);
router.post("/wear-earn", rewardProofUpload, handleMulterError, createWearEarnReward);
router.get("/my-rewards", getMyRewards);

export default router;

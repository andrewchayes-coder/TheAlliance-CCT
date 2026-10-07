import { Router, type IRouter } from "express";
import healthRouter from "./health";
import devEmailRouter from "./dev-email";
import authRouter from "./auth";
import meRouter from "./me";
import { csrfGuard, requireVerifiedUser } from "../auth/session";

const router: IRouter = Router();

router.use(healthRouter);
if (process.env.NODE_ENV === 'development') {
  router.use(devEmailRouter);
}
router.use('/auth', authRouter);

// Keep all present and future resource routes BELOW this verification gate.
router.use(requireVerifiedUser, csrfGuard);
router.use(meRouter);

export default router;

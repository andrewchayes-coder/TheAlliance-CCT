import { Router, type IRouter } from "express";
import healthRouter from "./health";
import devEmailRouter from "./dev-email";
import authRouter from "./auth";
import meRouter from "./me";
import adminRouter from "./admin";
import { csrfGuard } from "../auth/session";
import { apiAccessPolicy } from "../auth/access-policy";

const router: IRouter = Router();

router.use(apiAccessPolicy);
router.use(healthRouter);
if (process.env.NODE_ENV === 'development') {
  router.use(devEmailRouter);
}
router.use('/auth', authRouter);

router.use(csrfGuard);
router.use(meRouter);
router.use('/admin', adminRouter);

export default router;

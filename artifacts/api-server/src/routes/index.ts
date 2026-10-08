import { Router, type IRouter } from "express";
import healthRouter from "./health";
import devEmailRouter from "./dev-email";
import authRouter from "./auth";
import meRouter from "./me";
import adminRouter from "./admin";
import onboardingRouter from "./onboarding";
import volunteerRouter from "./volunteer";
import adminRosterRouter from "./admin-roster";
import adminWorkflowRouter from "./admin-volunteer-workflow";
import adminScheduleRouter from "./admin-schedule";
import adminCoordinatorRouter from "./admin-coordinator";
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
router.use(onboardingRouter);
router.use('/volunteer', volunteerRouter);
router.use('/admin', adminRouter);
router.use('/admin', adminRosterRouter);
router.use('/admin', adminWorkflowRouter);
router.use('/admin', adminScheduleRouter);
router.use('/admin', adminCoordinatorRouter);

export default router;

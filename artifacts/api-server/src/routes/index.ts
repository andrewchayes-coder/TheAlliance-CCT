import { Router, type IRouter } from "express";
import healthRouter from "./health";
import devEmailRouter from "./dev-email";

const router: IRouter = Router();

router.use(healthRouter);
if (process.env.NODE_ENV === 'development') {
  router.use(devEmailRouter);
}

export default router;

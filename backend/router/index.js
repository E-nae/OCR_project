import express from 'express';
import verifyImg from './refund/verify.js';
import status from './refund/status.js';

const router = express.Router();

router.use('/apply/verification', verifyImg);
router.use('/apply/status', status);

export default router;

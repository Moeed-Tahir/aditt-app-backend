const express = require('express');
const router = express.Router();
const subscriptionController = require('../../controllers/v1/subscriptionControllers');
const jwtMiddleware = require('../../middlewares/authMiddleware');

router.post('/subscription/createPlan', subscriptionController.createPlan);
router.post('/subscription/fetchAllPlans', subscriptionController.fetchAllPlans);
router.post('/subscription/createCustomerAndSetupIntent', subscriptionController.createCustomerAndSetupIntent);
router.post('/subscription/subscribeCustomer', subscriptionController.subscribeCustomer);
router.post('/payouts/payout', subscriptionController.payout);
router.post('/payouts/confirmPayout', subscriptionController.confirmPayout);

module.exports = router;
const express = require('express');
const router = express.Router();
const subscriptionController = require('../../controllers/v1/subscriptionControllers');
const jwtMiddleware = require('../../middlewares/authMiddleware');

router.post('/subscription/setupStripePaymentSheet', jwtMiddleware, subscriptionController.setupStripePaymentSheet);

module.exports = router;
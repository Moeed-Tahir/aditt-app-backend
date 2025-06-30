const express = require('express');
const router = express.Router();
const subscriptionController = require('../../controllers/v1/subscriptionControllers');
const jwtMiddleware = require('../../middlewares/authMiddleware');

router.post('/subscription/createSubscription',jwtMiddleware,subscriptionController.createSubscription);

module.exports = router;
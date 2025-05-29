const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const authController = require('../../controllers/v1/authControllers');

// Use bodyParser.raw() for Stripe webhook
router.post('/webhook', 
    bodyParser.raw({ type: 'application/json' }), // Instead of express.raw()
    authController.stripeWebhookHandler
);

module.exports = router;
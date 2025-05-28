const express = require('express');
const router = express.Router();
const authController = require('../../controllers/v1/authControllers');

router.post('/webhook', 
  express.raw({ type: 'application/json' }), 
  authController.stripeWebhookHandler
);


module.exports = router;
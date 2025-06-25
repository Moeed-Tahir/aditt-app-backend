const express = require('express');
const router = express.Router();
const contactController = require('../../controllers/v1/contactController');
const jwtMiddleware = require('../../middlewares/authMiddleware');

router.post('/contact/contactUS', jwtMiddleware, contactController.contactUS);

module.exports = router;
const express = require('express');
const router = express.Router();
const authController = require('../../controllers/v1/authControllers');
const jwtMiddleware = require('../../middlewares/authMiddleware');

router.post('/stripe/handleVerificationReturn', authController.handleVerificationReturn);
router.post('/signup/initiate', authController.initiateSignup);
router.post('/signup/verify-signup-otp', jwtMiddleware, authController.verifySignupOtp);
router.post('/signin/verify-signin-otp', authController.verifySigninOtp);
router.post('/signin', authController.signin);
router.post('/signup/personal-info', jwtMiddleware, authController.savePersonalInfo);
router.post('/signup/verify-identity', jwtMiddleware, authController.initiateIdentityVerification);
router.post('/user/updateProfile', jwtMiddleware, authController.updateProfile);
router.get('/verification-success', authController.handleVerificationSuccess);
router.post('/deleteUserProfile', jwtMiddleware, authController.deleteUserProfile);
router.post("/verify-email", authController.verifyEmail);
router.post("/verify-otp", authController.verifyOTP);
router.post("/resend-otp", authController.resendOTP);
router.post("/forget-password", authController.forgetPassword); 
router.post('/create-password', authController.createPassword);
router.post('/verify-password', authController.verifyPassword);
router.post('/enable-face-id', authController.userFaceIdEnabled);
router.post('/save-email-to-notify', jwtMiddleware, authController.saveEmailToNotify);
router.post('/resend-otp-via-email', authController.resendEmailOTP);
router.post('/get-verification-status', jwtMiddleware, authController.getVerificationStatus);
router.post('/get-user-profile-status', jwtMiddleware, authController.getUserStatus);
router.post('/get-all-referred-users', jwtMiddleware, authController.getAllReferedUsers);

module.exports = router;
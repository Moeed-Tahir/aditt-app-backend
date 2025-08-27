const User = require('../../models/ConsumerUser.model');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { generateOTP, sendOTPViaEmail, sendOTPViaMessage } = require('../../services/otpService.js');
const { MongoClient } = require('mongodb');
// Edit
const { default: Stripe } = require('stripe');
const { sendFlaggedIdentityEmail, sendRejectedIdentityEmail, sendApprovedIdentityEmail } = require('../../services/emailService.js');
const { generateReferralCode } = require("../../services/referralCodeService.js");

dotenv.config();

const initiateSignup = async (req, res) => {
   try {
      const { fullName, email, referralCode } = req.body;

      if (!fullName || !email) {
         return res.status(400).json({
            success: false,
            message: 'Name and email are required'
         });
      }

      let referrer;
      if (referralCode) {
         referrer = await User.findOne({ referralCode });
         if (!referrer) {
            return res.status(400).json({
               success: false,
               message: 'Invalid referral code'
            });
         }
      }

      const existingUser = await User.findOne({ email });
      
      if (existingUser && existingUser.identityVerificationStatus === 'rejected') {
         await User.findByIdAndDelete(existingUser._id);
         
         const otp = generateOTP();
         const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
         
         const user = new User({
            fullName, 
            email,
            otp,
            otpExpires,
            referrer: referrer ? referrer._id : null,
            referralCode: generateReferralCode()
         });
         
         await user.save();
         
         const token = jwt.sign({ userId: user._id }, process.env.SECRET_KEY, {
            expiresIn: '7d'
         });

         await sendOTPViaEmail(email, otp);

         return res.status(200).json({
            success: true,
            message: 'OTP sent successfully',
            userId: user._id,
            token,
         });
      }
      
      if (existingUser?.isOtpVerified) {
         return res.status(400).json({
            success: false,
            message: 'This email is already registered and verified'
         });
      }
      else if (existingUser && existingUser.isOtpVerified === false) {
         const token = jwt.sign({ userId: existingUser._id }, process.env.SECRET_KEY, {
            expiresIn: '7d'
         });
         const otp = generateOTP();
         const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
         existingUser.otp = otp;
         existingUser.otpExpires = otpExpires;
         await existingUser.save();
         await sendOTPViaEmail(email, otp);
         return res.status(201).json({
            success: false,
            message: 'This email is already registered but not verified, OTP sent',
            user: existingUser,
            token,
         });
      }

      const otp = generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      const user = new User({
         fullName, 
         email,
         otp,
         otpExpires,
         referrer: referrer ? referrer._id : null,
         referralCode: generateReferralCode()
      });
      
      await user.save();

      const token = jwt.sign({ userId: user._id }, process.env.SECRET_KEY, {
         expiresIn: '7d'
      });

      await sendOTPViaEmail(email, otp);

      res.status(200).json({
         success: true,
         message: 'OTP sent successfully',
         userId: user._id,
         token,
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during signup initiation',
         error: error.message
      });
   }
};

const resendEmailOTP = async (req, res) => {
   try {
      const { userId, email } = req.body;

      if (!userId || !email) {
         return res.status(400).json({
            success: false,
            message: 'User ID and email are required'
         });
      }

      const user = await User.findOne({ _id: userId, email });
      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }
      if (user.isOtpVerified) {
         return res.status(400).json({
            success: false,
            message: 'OTP already verified. Please sign in.'
         });
      }
      const otp = generateOTP();
      user.otp = otp;
      user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();

      await sendOTPViaEmail(email, otp);

      res.status(200).json({
         success: true,
         message: 'OTP resent successfully',
         otp: otp,
         userId: user._id
      });


   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during OTP resend',
         error: error.message
      });
   }
}

const verifySignupOtp = async (req, res) => {
   try {
      const { userId, otp } = req.body;

      if (!userId || !otp) {
         return res.status(400).json({
            success: false,
            message: 'UserId and OTP are required'
         });
      }

      const user = await User.findOne({ _id: userId });
      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found. Please start registration again.'
         });
      }

      if (user.otp !== otp || user.otpExpires < new Date()) {
         return res.status(400).json({
            success: false,
            message: 'Invalid or expired OTP'
         });
      }

      user.isOtpVerified = true;
      await user.save();

      res.status(200).json({
         success: true,
         message: 'User verified successfully',
         user: user,
         nextStep: '/complete-profile'
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during OTP verification',
         error: error.message
      });
   }
};

const savePersonalInfo = async (req, res) => {
   try {
      const { userId, dateOfBirth, gender, zipCode, location } = req.body;

      if (!userId || !dateOfBirth || !gender || !zipCode) {
         return res.status(400).json({
            success: false,
            message: 'All personal information fields are required'
         });
      }

      const user = await User.findOne({ _id: userId, isOtpVerified: true });
      if (!user) {
         return res.status(403).json({
            success: false,
            message: 'Please complete verification first'
         });
      }

      let status = 'active';
      client = await MongoClient.connect(process.env.MONGO_URI);
      const db = client.db();

      const waitlistLimit = await db.collection('admindashboards').findOne();
      // console.log("waitlistLimit", waitlistLimit);
      if (waitlistLimit) {
         const totalUsers = await db.collection('consumerusers').countDocuments();
         if (totalUsers >= waitlistLimit.userLimit) {
            status = 'waitlist';
         }
      }

      // Fix date parsing to handle DD/MM/YYYY format consistently
      const [day, month, year] = dateOfBirth.split('/').map(Number);
      user.dateOfBirth = new Date(Date.UTC(year, month - 1, day));

      user.gender = gender;
      user.zipCode = zipCode;
      user.location = location;
      // user.email = email;
      user.status = status;
      await user.save();

      if (user.referrer) {
         const referrer = await User.findOne({ _id: user.referrer });
         if (referrer) {
            referrer.referralCount = (referrer.referralCount || 0) + 1;
            if (referrer.referralCount >= 2) {
               // Upgrade referrer to premium
               referrer.subscriptionPlan = "Premium";
            }
            await referrer.save();
         }
      }


      res.status(200).json({
         success: true,
         message: 'Personal information saved successfully',
         userId: user._id,
         token: user.token,
         user,
         nextStep: '/identity-verification'
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error saving personal information',
         error: error.message
      });
   }
};

const handleVerificationSuccess = async (req, res) => {
   try {
      const { userId } = req.query;

      if (!userId) {
         return res.status(400).json({
            success: false,
            message: 'User ID is required'
         });
      }

      const user = await User.findOne({ _id: userId });

      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      if (!user.isVerified) {
         return res.status(403).json({
            success: false,
            message: 'Verification not completed yet. Please try again later.'
         });
      }

      res.status(200).json({
         success: true,
         message: 'Verification completed successfully. You can now proceed to the dashboard.',
         user: {
            id: user._id,
            isVerified: user.isVerified,
            verificationStatus: user.verificationStatus
         }
      });

   } catch (error) {
      console.error('Verification success handler error:', error);
      res.status(500).json({
         success: false,
         message: 'Server error during verification success handling',
         error: error.message
      });
   }
};

const initiateIdentityVerification = async (req, res) => {
   try {
      let { userId } = req.body;

      if (!userId) {
         return res.status(400).json({ success: false, message: 'User ID is required' });
      }

      const user = await User.findOne({ _id: userId, isOtpVerified: true });

      if (!user) {
         return res.status(403).json({
            success: false,
            message: 'Please complete OTP verification first'
         });
      }

      user.isVerified = true;
      await user.save();

      let stripeCustomer;

      if (user.stripeCustomerId) {
         try {
            stripeCustomer = await stripe.customers.retrieve(user.stripeCustomerId);
         } catch (error) {
            if (error.code === 'resource_missing') {
               stripeCustomer = await stripe.customers.create({
                  name: `${user.firstName} ${user.lastName}`,
                  phone: user.phone,
                  email: user.email,
                  metadata: {
                     userId: user._id.toString()
                  }
               });
               user.stripeCustomerId = stripeCustomer.id;
               await user.save();
            } else {
               throw error;
            }
         }
      } else {
         stripeCustomer = await stripe.customers.create({
            name: `${user.firstName} ${user.lastName}`,
            phone: user.phone,
            email: user.email,
            metadata: {
               userId: user._id.toString()
            }
         });

         user.stripeCustomerId = stripeCustomer.id;
         await user.save();
      }


      const session = await stripe.identity.verificationSessions.create({
         type: 'document',
         metadata: {
            userId: user._id.toString()
         },
         return_url: `https://aditt.app/`,
         options: {
            document: {
               allowed_types: ['driving_license', 'passport', 'id_card'],
               require_live_capture: true,
               require_matching_selfie: true,
            }
         }
      });

      res.status(200).json({
         success: true,
         message: 'Stripe identity verification session created',
         userId: user._id,
         token: user.token,
         verificationUrl: session.url,
         sessionId: session.id
      });

   } catch (error) {
      console.error('Identity verification error:', error);
      res.status(500).json({
         success: false,
         message: 'Server error during identity verification',
         error: error.message
      });
   }
};

const stripeWebhookHandler = async (req, res) => {
   const sig = req.headers['stripe-signature'];

   if (!sig) {
      console.error('⚠️  No Stripe signature found');
      return res.status(400).send('No Stripe signature found');
   }

   let event;

   try {
      event = stripe.webhooks.constructEvent(
         req.body,
         sig,
         process.env.STRIPE_WEBHOOK_SECRET
      );
      console.log('✅ Webhook signature verified successfully');
   } catch (err) {
      console.error('❌ Error in webhook verification:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
   }

   if (event.type.startsWith('identity.verification_session.')) {
      console.log(`🆔 Processing verification event: ${event.type}`);
      const session = event.data.object;
      const userId = session.metadata?.userId;

      if (!userId) {
         console.error('❌ Missing user ID in metadata');
         return res.status(400).send('Missing user ID');
      }

      console.log(`👤 Processing verification for user ID: ${userId}`);

      try {
         const user = await User.findById(userId);
         if (!user) {
            console.error(`❌ User ${userId} not found`);
            return res.status(404).send('User not found');
         }

         console.log(`✅ User found: ${user.fullName} (${user.email})`);

         const stripeRestricted = new Stripe(process.env.RESTRICTED_KEY, {
            apiVersion: '2025-07-30.basil'
         });

         if (!user.verificationSessionId) {
            user.verificationSessionId = session.id;
            await user.save();
            console.log(`💾 Saved verification session ID: ${session.id}`);
         }

         if (event.type === 'identity.verification_session.created') {
            console.log('🆕 New verification session created, setting status to "unknown"');
            
            await User.findByIdAndUpdate(userId, {
               identityVerificationStatus: 'unknown',
               identityVerificationMessage: 'Verification process started. Please upload your documents.',
               verificationSessionId: session.id
            });
            
            console.log(`✅ Set initial status to 'unknown' for user ${userId}`);
            return res.json({ received: true });
         }

         const statusMap = {
            'identity.verification_session.verified': 'verified',
            'identity.verification_session.canceled': 'canceled',
            'identity.verification_session.processing': 'processing',
            'identity.verification_session.requires_input': 'requires_input',
            'identity.verification_session.redacted': 'redacted',
         };

         const status = statusMap[event.type] || 'unknown';

         if (event.type === 'identity.verification_session.requires_input') {
            if (session.last_error && (
                session.last_error.code === 'document_unverified_other' ||
                session.last_error.code === 'document_document_missing_back' ||
                session.last_error.code === 'document_document_missing_front' ||
                session.last_error.code === 'document_document_corrupt' ||
                session.last_error.code === 'document_document_expired' ||
                session.last_error.code === 'document_document_failed_copy' ||
                session.last_error.code === 'document_document_failed_greyscale' ||
                session.last_error.code === 'document_document_failed_other' ||
                session.last_error.code === 'document_document_not_readable' ||
                session.last_error.code === 'document_document_not_uploaded' ||
                session.last_error.code === 'document_document_type_not_supported'
            )) {
               console.log('📄 Documents uploaded but incomplete or unverified');
               
               const verificationStatus = 'unknown';
               const verificationMessage = 'Documents uploaded but verification could not be completed. Please ensure all documents are clear, complete, and valid.';

               await User.findByIdAndUpdate(userId, {
                  identityVerificationStatus: verificationStatus,
                  identityVerificationMessage: verificationMessage,
                  verificationSessionId: session.id
               });

               await sendIncompleteDocumentEmail(user.email, user.fullName, session.last_error?.code);

               console.log(`✅ Set status to 'unknown' for user ${userId} due to incomplete documents`);
               
               console.log(`✅ Successfully processed incomplete documents for user ${userId}`);
               return res.json({ received: true });
            }
         }

         if (status === 'verified') {
            const verificationSession = await stripeRestricted.identity.verificationSessions.retrieve(
               session.id,
               { expand: ['verified_outputs.dob'] }
            );

            if (verificationSession.verified_outputs) {
               const outputs = verificationSession.verified_outputs;

               const stripeFullName = [outputs.first_name, outputs.last_name]
                  .filter(Boolean)
                  .join(' ')
                  .trim();

               const userFullName = user.fullName.trim();

               const nameMatch = stripeFullName.toLowerCase() === userFullName.toLowerCase();

               let dobMatch = true;
               if (outputs.dob && user.dateOfBirth) {
                  const verifiedDOB = new Date(Date.UTC(
                     outputs.dob.year,
                     outputs.dob.month - 1,
                     outputs.dob.day
                  ));

                  let userDOB;
                  if (typeof user.dateOfBirth === 'string') {
                     userDOB = new Date(user.dateOfBirth);
                  } else if (user.dateOfBirth instanceof Date) {
                     userDOB = user.dateOfBirth;
                  } else {
                     console.error('❌ Invalid date format in user.dateOfBirth');
                     dobMatch = false;
                  }

                  if (userDOB) {
                     dobMatch = verifiedDOB.getUTCFullYear() === userDOB.getUTCFullYear() &&
                        verifiedDOB.getUTCMonth() === userDOB.getUTCMonth() &&
                        verifiedDOB.getUTCDate() === userDOB.getUTCDate();
                  }
               }

               let verificationStatus;
               let verificationMessage;

               const duplicateUser = await User.findOne({
                  _id: { $ne: userId },
                  $or: [
                     { 
                        'verifiedData.verificationId': { $exists: true },
                        'verifiedData.fullName': { $regex: new RegExp(`^${stripeFullName}$`, 'i') },
                        'verifiedData.dob': user.dateOfBirth
                     },
                     {
                        'verifiedData.verificationId': { $exists: true },
                        fullName: { $regex: new RegExp(`^${stripeFullName}$`, 'i') },
                        dateOfBirth: user.dateOfBirth
                     }
                  ]
               });

               if (duplicateUser) {
                  console.log(`⚠️ Potential duplicate found: User ${duplicateUser._id}`);
                  verificationStatus = 'pendingApproval';
                  verificationMessage = 'Your account is pending admin approval due to potential duplicate verification';
                  
                  await sendFlaggedIdentityEmail(user.email, user.fullName);
               } 
               else if (!nameMatch || !dobMatch) {
                  verificationStatus = 'rejected';
                  
                  if (!nameMatch && !dobMatch) {
                     verificationMessage = 'Verification rejected: Name and date of birth do not match our records.';
                  } else if (!nameMatch) {
                     verificationMessage = 'Verification rejected: Name does not match our records.';
                  } else {
                     verificationMessage = 'Verification rejected: Date of birth does not match our records.';
                  }
                  
                  await sendRejectedIdentityEmail(user.email, user.fullName);
               } 
               else {
                  verificationStatus = 'verified';
                  verificationMessage = 'Your identity has been successfully verified';
                  await sendApprovedIdentityEmail(user.email, user.fullName);
               }

               const verifiedData = {
                  firstName: outputs.first_name,
                  lastName: outputs.last_name,
                  fullName: stripeFullName,
                  dob: outputs.dob ? new Date(Date.UTC(
                     outputs.dob.year,
                     outputs.dob.month - 1,
                     outputs.dob.day
                  )) : null,
                  address: outputs.address ? {
                     line1: outputs.address.line1,
                     line2: outputs.address.line2,
                     city: outputs.address.city,
                     state: outputs.address.state,
                     postalCode: outputs.address.postal_code,
                     country: outputs.address.country
                  } : null,
                  verificationId: session.id
               };

               const updateData = {
                  identityVerificationStatus: verificationStatus,
                  identityVerificationMessage: verificationMessage,
                  isVerified: verificationStatus === 'verified',
                  verifiedData,
                  verificationSessionId: session.id
               };

               await User.findByIdAndUpdate(userId, updateData);
            }

         } else if (status === 'processing') {
            console.log('🔄 Verification is processing');
            
            const verificationStatus = 'processing';
            const verificationMessage = 'Your verification is being processed';

            console.log(`💾 Updating user with status: ${verificationStatus}`);
            await User.findByIdAndUpdate(userId, {
               identityVerificationStatus: verificationStatus,
               identityVerificationMessage: verificationMessage,
               verificationSessionId: session.id
            });
            console.log(`✅ User updated successfully with status: ${verificationStatus}`);

         } else {
            console.log(`📊 Handling status: ${status}`);
            
            const statusMessages = {
               'canceled': {
                  status: 'unknown',
                  message: 'Verification was canceled. You can start a new verification when ready.',
                  instructions: 'You can start a new verification when ready',
                  canRetry: true
               },
               'requires_input': {
                  status: 'unknown',
                  message: 'Additional information required to complete verification.',
                  actionRequired: true
               },
               'redacted': {
                  status: 'unknown',
                  message: 'Verification data has been redacted. Please start a new verification process.',
                  canRetry: true
               }
            };

            const statusInfo = statusMessages[status] || {
               status: 'unknown',
               message: `Verification status: ${status}.`
            };

            await User.findByIdAndUpdate(userId, {
               identityVerificationStatus: statusInfo.status,
               identityVerificationMessage: statusInfo.message,
               verificationSessionId: session.id
            });
         }

         console.log(`✅ Successfully processed verification for user ${userId}`);

      } catch (err) {
         console.error(`❌ Error processing verification for user ${userId}:`, err);

         await User.findByIdAndUpdate(userId, {
            identityVerificationStatus: 'unknown',
            identityVerificationMessage: 'An error occurred during verification processing.'
         });
         
         return res.status(500).send('Error processing verification');
      }
   } else {
      console.log(`ℹ️  Ignoring non-verification event: ${event.type}`);
   }

   console.log('✅ Webhook processing completed successfully');
   res.json({ received: true });
};

const handleVerificationReturn = async (req, res) => {
   try {
      const { session_id } = req.body;

      if (!session_id) {
         return res.status(400).json({ success: false, message: 'Session ID is required' });
      }

      const stripeRestricted = new Stripe(process.env.RESTRICTED_KEY, {
         apiVersion: '2025-07-30.basil'
      });

      const verificationSession = await stripeRestricted.identity.verificationSessions.retrieve(
         session_id,
         {
            expand: ['verified_outputs.dob']
         }
      );

      const dob = verificationSession.verified_outputs?.dob;
      if (dob) {
         const formattedDOB = new Date(dob.year, dob.month - 1, dob.day);
         console.log("Formatted DOB:", formattedDOB.toISOString().split('T')[0]);
      } else {
         console.log("DOB not found in verified outputs");
      }

      const userId = verificationSession.metadata?.userId;
      const status = verificationSession.status;

      if (status !== 'verified' || !userId) {
         return res.status(400).json({
            success: false,
            message: 'Verification not completed or userId missing',
            status
         });
      }

      const outputs = verificationSession.verified_outputs;
      console.log("outputs", outputs);

      if (!outputs || !outputs.first_name || !outputs.last_name) {
         return res.status(400).json({
            success: false,
            message: 'Verified outputs incomplete',
         });
      }

      const report = await stripeRestricted.identity.verificationReports.retrieve(
         verificationSession.last_verification_report
      );

      console.log("report", report);


      if (report.document?.status !== 'verified') {
         return res.status(400).json({
            success: false,
            message: 'Document verification not successful',
         });
      }

      const verifiedData = {
         firstName: outputs.first_name,
         lastName: outputs.last_name,
         fullName: `${outputs.first_name} ${outputs.last_name}`,
         dob: outputs.dob ? new Date(
            outputs.dob.year,
            outputs.dob.month - 1,
            outputs.dob.day
         ) : null,
         address: outputs.address ? {
            line1: outputs.address.line1,
            line2: outputs.address.line2,
            city: outputs.address.city,
            state: outputs.address.state,
            postalCode: outputs.address.postal_code,
            country: outputs.address.country
         } : null,
         verificationId: verificationSession.id,
         verifiedAt: new Date()
      };

      await User.findByIdAndUpdate(userId, {
         isVerified: true,
         identityVerificationStatus: 'verified',
         verifiedData,
         lastVerified: new Date()
      });

      res.redirect(`https://aditt.app/verification-success?userId=${userId}`);

   } catch (error) {
      console.error('Verification return error:', error);

      let errorMessage = 'Verification failed';
      if (error.type === 'StripePermissionError') {
         errorMessage = 'Authentication error with verification service';
      } else if (error.code === 'account_invalid') {
         errorMessage = 'Verification service configuration error';
      }

      res.redirect(`https://aditt.app/verification-failed?error=${encodeURIComponent(errorMessage)}`);
   }
};

const signin = async (req, res) => {
   try {
      const { email, password } = req.body;

      if (!email || !password) {
         return res.status(400).json({
            success: false,
            message: 'Email and password are required'
         });
      }

      const user = await User.findOne({ email });

      if (!user) {
         return res.status(400).json({
            success: false,
            message: 'User not found'
         });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
         return res.status(400).json({
            success: false,
            message: 'Invalid password'
         });
      }

      if (user.status === 'waitlist') {
         return res.status(400).json({
            success: false,
            message: 'You are on the waitlist. Please wait for your turn.'
         });
      }


      // const otp = generateOTP();

      // const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      // user.otp = otp;
      // user.otpExpires = otpExpires;
      // user.isOtpVerified = false;

      // await user.save();

      // await sendOTPViaEmail(email, otp);

      const token = jwt.sign(
         { userId: user._id },
         process.env.SECRET_KEY,
         { expiresIn: '7d' }
      );

      const { otp: _, otpExpires: __, ...safeUserData } = user.toObject();

      return res.status(200).json({
         success: true,
         message: 'User sign in successfully',
         userId: user._id,
         token: token,
         // otp: otp,
         user: safeUserData
      });

   } catch (error) {
      return res.status(500).json({
         success: false,
         message: 'Server error during sign in',
         error: error.message
      });
   }
};

const verifySigninOtp = async (req, res) => {
   try {
      const { userId, otp } = req.body;

      if (!userId || !otp) {
         return res.status(400).json({
            success: false,
            message: 'user ID and OTP are required'
         });
      }

      const user = await User.findOne({ _id: userId });

      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found. Please start registration again.'
         });
      }

      if (user.otp !== otp || user.otpExpires < new Date()) {
         return res.status(400).json({
            success: false,
            message: 'Invalid or expired OTP'
         });
      }


      user.isOtpVerified = true;
      user.otp = "Not Present";
      user.otpExpires = null;
      await user.save();

      const token = jwt.sign({ userId: user._id }, process.env.SECRET_KEY, {
         expiresIn: '7d'
      });


      res.status(200).json({
         success: true,
         message: 'Email verified successfully',
         token,
         user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            // phone: user.phone,
            dateOfBirth: user.dateOfBirth,
            gender: user.gender,
            zipCode: user.zipCode
         }
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during OTP verification',
         error: error.message
      });
   }
};

const updateProfile = async (req, res) => {
   try {
      const { userId, fullName, dateOfBirth, gender, zipCode, location } = req.body;

      if (!userId) {
         return res.status(400).json({
            success: false,
            message: 'User ID is required'
         });
      }

      const updateData = {
         ...(fullName && { fullName }),
         // ...(email && { email }),
         ...(dateOfBirth && { dateOfBirth }),
         ...(gender && { gender }),
         ...(zipCode && { zipCode }),
         ...(location && { location })
      };

      const updatedUser = await mongoose.model('ConsumerUser').findByIdAndUpdate(
         userId,
         updateData,
         { new: true }
      );

      if (!updatedUser) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      res.status(200).json({
         success: true,
         message: 'Profile updated successfully',
         user: updatedUser
      });

   } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({
         success: false,
         message: 'Internal server error',
         error: error.message
      });
   }
};

const deleteUserProfile = async (req, res) => {
   try {
      const { userId, email } = req.body;

      if (!userId && !email) {
         return res.status(400).json({
            success: false,
            message: 'Either User ID or email is required.'
         });
      }

      const deletedUser = await User.findOneAndDelete({ _id: userId, email });

      if (!deletedUser) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      res.status(200).json({
         success: true,
         message: 'User deleted successfully',
         user: deletedUser
      });

   } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({
         success: false,
         message: 'Internal server error',
         error: error.message
      });
   }
};

const verifyEmail = async (req, res) => {
   try {
      const { email } = req.body;

      const existingUser = await User.findOne({ email });

      if (existingUser) {
         const otp = generateOTP();
         existingUser.otp = otp;
         existingUser.otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
         existingUser.isOtpVerified = false; // Reset OTP verification status
         await existingUser.save();


         await sendOTPViaEmail(email, otp);


         const token = jwt.sign(
            { userId: existingUser._id },
            process.env.SECRET_KEY,
            { expiresIn: '1h' }
         );

         res.status(200).json({
            message: "OTP sent to your email",
            requiresOtp: true,
            email: email,
            token: token,
            userId: existingUser._id
         });
      }
      else {
         console.error("User not found");
         return res.status(404).json({ message: "User not found" });
      }

   } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
   }
};

const verifyOTP = async (req, res) => {
   try {
      const { email, otp } = req.body;

      const user = await User.findOne({ email, otp, isOtpVerified: false });

      if (!user) {
         return res.status(400).json({
            message: "Invalid or expired OTP",
            requiresResend: true
         });
      }

      if (user.otp !== otp) {
         return res.status(400).json({
            message: "Invalid OTP",
            requiresResend: true
         });
      }

      if (user.otpExpires < Date.now()) {
         return res.status(400).json({
            message: "OTP has expired",
            requiresResend: true
         });
      }

      user.isOtpVerified = true;
      user.otp = null; // Clear OTP after verification
      user.otpExpires = null; // Clear OTP expiration date
      await user.save()

      const token = jwt.sign(
         { userId: user._id },
         process.env.SECRET_KEY,
         { expiresIn: '1h' }
      );

      const { password: _, ...userData } = user.toObject();
      res.status(200).json({
         message: "OTP verified successfully",
         user: userData,
         token: token,
      });

   } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
   }
};

const resendOTP = async (req, res) => {
   try {
      const { email } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
         return res.status(400).json({
            message: "User not found",
            requiresResend: false
         });
      }

      const otp = generateOTP();

      user.otp = otp;
      user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
      user.isOtpVerified = false;
      await user.save();

      await sendOTPViaEmail(email, otp);

      res.status(200).json({
         message: "New OTP sent to your email",
         success: true,
         email: email
      });

   } catch (error) {
      console.error("Error in resendOTP:", error);
      res.status(500).json({
         message: "Internal Server Error",
         success: false
      });
   }
};

const createPassword = async (req, res) => {
   try {
      const { userId, password } = req.body;

      if (!userId || !password) {
         return res.status(400).json({
            success: false,
            message: 'User ID and password are required'
         });
      }

      const user = await User.findOne({ _id: userId });

      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      user.password = await bcrypt.hash(password, 10);
      await user.save();

      res.status(200).json({
         success: true,
         message: 'Password created successfully',
         user: user
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during pin creation',
         error: error.message
      });
   }
}

const forgetPassword = async (req, res) => {
   try {
      const { email, password } = req.body;

      if (!email || !password) {
         return res.status(400).json({
            success: false,
            message: 'Email and password are required'
         });
      }

      const user = await User.findOne({ email });

      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      user.password = await bcrypt.hash(password, 10);
      await user.save();

      res.status(200).json({
         message: "Password reset successfully",
         success: true,
         email: email
      });

   } catch (error) {
      console.error("Error in forgetPassword:", error);
      res.status(500).json({
         message: "Internal Server Error",
         success: false
      });
   }
}

const verifyPassword = async (req, res) => {
   try {
      const { userId, password } = req.body;

      if (!userId || !password) {
         return res.status(400).json({
            success: false,
            message: 'User ID and password are required'
         });
      }

      const user = await User.findOne({ _id: userId });

      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
         return res.status(400).json({
            success: false,
            message: 'Invalid password'
         });
      }

      res.status(200).json({
         success: true,
         message: 'Password verified successfully',
         user: user
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during password verification',
         error: error.message
      });
   }
}

const userFaceIdEnabled = async (req, res) => {
   try {
      const { userId, isFaceIdEnabled } = req.body;

      if (!userId || typeof isFaceIdEnabled !== 'boolean') {
         return res.status(400).json({
            success: false,
            message: 'Please provide valid userId and isFaceIdEnabled (boolean)'
         });
      }

      if (!mongoose.Types.ObjectId.isValid(userId)) {
         return res.status(400).json({
            success: false,
            message: 'Invalid user ID format'
         });
      }

      const updatedUser = await User.findByIdAndUpdate(
         userId,
         { $set: { faceIdEnabled: isFaceIdEnabled } },
         { new: true }
      );


      if (!updatedUser) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      res.status(200).json({
         success: true,
         message: 'Face ID status updated successfully',
         data: {
            faceIdEnabled: updatedUser.faceIdEnabled
         }
      });

   } catch (error) {
      console.error("Error in userFaceIdEnabled:", error);
      res.status(500).json({
         success: false,
         message: 'Internal server error',
         error: error.message
      });
   }
};

const saveEmailToNotify = async (req, res) => {
   try {
      const { userId, email } = req.body;

      if (!userId || !email) {
         return res.status(400).json({
            success: false,
            message: 'User ID and email are required'
         });
      }

      const user = await User.findOne({ _id: userId });

      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      user.email = email;
      await user.save();

      res.status(200).json({
         success: true,
         message: 'Email to notify saved successfully',
         userId: user._id,
         user
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during saving email to notify',
         error: error.message
      });
   }
}

const getVerificationStatus = async (req, res) => {
   try {
      const { userId } = req.body;

      if (!userId) {
         return res.status(400).json({
            success: false,
            message: 'User ID is required'
         });
      }

      const user = await User.findById(userId);

      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      res.status(200).json({
         success: true,
         message: 'Verification status retrieved successfully',
         data: {
            identityVerificationStatus: user.identityVerificationStatus,
         }
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during getting verification status',
         error: error.message
      });
   }
}

const getUserStatus = async (req, res) => {
   try {
      const { userId } = req.body;

      if (!userId) {
         return res.status(400).json({
            success: false,
            message: "User ID is required"
         });
      }

      const user = await User.findOne({ _id: userId }).select('status');

      if (!user) {
         return res.status(404).json({
            success: false,
            message: "User not found"
         });
      }

      return res.status(200).json({
         success: true,
         status: user.status
      });

   } catch (error) {
      console.error("Error getting user status:", error);
      if (error instanceof mongoose.Error.CastError) {
         return res.status(400).json({
            success: false,
            message: "Invalid User ID format"
         });
      }
      return res.status(500).json({
         success: false,
         message: "Internal server error",
         error: error.message
      });
   }
}

const getAllReferedUsers = async (req, res) => {
   try {
      const { userId } = req.body;

      if (!userId) {
         return res.status(400).json({
            success: false,
            message: 'User ID is required'
         });
      }

      const user = await User.findById(userId);

      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found'
         });
      }

      const referredUsers = await User.find({ referrer: userId });

      res.status(200).json({
         success: true,
         message: 'Referred users retrieved successfully',
         data: referredUsers,
         userStatus: user.subscriptionPlan
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during getting referred users',
         error: error.message
      });
   }
};

module.exports = { handleVerificationReturn, initiateSignup, stripeWebhookHandler, verifySignupOtp, initiateIdentityVerification, savePersonalInfo, signin, verifySigninOtp, handleVerificationSuccess, updateProfile, verifyEmail, verifyOTP, resendOTP, deleteUserProfile, createPassword, verifyPassword, userFaceIdEnabled, saveEmailToNotify, resendEmailOTP, getVerificationStatus, getAllReferedUsers, getUserStatus, forgetPassword };
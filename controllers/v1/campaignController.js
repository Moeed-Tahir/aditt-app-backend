const { MongoClient } = require('mongodb');
const { getUserDemographics, getAgeGroup } = require('../../utils/userUtils');
const { ObjectId } = require('mongodb');
const dotenv = require("dotenv");
const TransactionHistory = require('../../models/TransactionHistory.model');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
dotenv.config();

exports.getAllSortedCampaigns = async (req, res) => {
    let client;
    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        const { gender, userId } = req.body;
        const { page = 1 } = req.query;
        const itemsPerPage = 3;
        const pageNum = Math.max(1, parseInt(page));

        if (!gender || !['Male', 'Female'].includes(gender)) {
            return res.status(400).json({ error: "Please provide a valid gender (Male or Female)" });
        }

        const otherGender = gender === 'Male' ? 'Female' : 'Male';

        const viewedCampaigns = await db.collection('usercampaignviews')
            .find({ userId: new ObjectId(userId) })
            .project({ campaignId: 1, _id: 0 })
            .toArray();

        const viewedCampaignIds = viewedCampaigns.map(c => new ObjectId(c.campaignId));

        const baseMatch = {
            $and: [
                { genderType: gender },
                { status: "Active" },
                { _id: { $nin: viewedCampaignIds } }
            ]
        };

        const projection = {
            _id: { $toString: '$_id' },
            websiteLink: 1,
            brandName: '$brandName',
            campaignVideo: '$campaignVideoUrl',
            brandLogo: '$companyLogo',
            gender: '$genderType',
            status: {
                $literal: false
            },
            questions: {
                quizQuestion: {
                    $mergeObjects: [
                        '$quizQuestion',
                        { _id: { $toString: '$quizQuestion._id' } }
                    ]
                },
                surveyQuestion1: {
                    $ifNull: [
                        {
                            $mergeObjects: [
                                '$surveyQuestion1',
                                { _id: { $toString: '$surveyQuestion1._id' } }
                            ]
                        },
                        null
                    ]
                },
                surveyQuestion2: {
                    $ifNull: [
                        {
                            $mergeObjects: [
                                '$surveyQuestion2',
                                { _id: { $toString: '$surveyQuestion2._id' } }
                            ]
                        },
                        null
                    ]
                }
            }
        };

        const mainPipeline = [
            { $match: baseMatch },
            { $sort: { createdAt: -1 } },
            { $skip: (pageNum - 1) * itemsPerPage },
            { $limit: itemsPerPage },
            { $project: projection }
        ];

        const [campaigns, totalCount] = await Promise.all([
            db.collection('campaigns').aggregate(mainPipeline).toArray(),
            db.collection('campaigns').countDocuments(baseMatch)
        ]);

        const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));

        if (campaigns.length < itemsPerPage && totalPages <= pageNum) {
            const remainingItems = itemsPerPage - campaigns.length;

            const secondaryMatch = {
                $and: [
                    { genderType: otherGender },
                    { status: "Active" },
                    { _id: { $nin: viewedCampaignIds } }
                ]
            };

            const secondaryResults = await db.collection('campaigns')
                .aggregate([
                    { $match: secondaryMatch },
                    { $sort: { createdAt: -1 } },
                    { $limit: remainingItems },
                    { $project: projection }
                ])
                .toArray();

            campaigns.push(...secondaryResults);
        }

        res.status(200).json({
            campaigns,
            currentPage: pageNum,
            totalPages
        });

    } catch (error) {
        console.error("Error in getAllSortedCampaigns:", error);
        res.status(500).json({
            error: "Internal server error",
            details: error.message
        });
    } finally {
        if (client) {
            await client.close();
        }
    }
};

exports.submitQuizQuestionResponse = async (req, res) => {
    const { campaignId, userId, watchTime } = req.body;
    let { questionResponse } = req.body;

    if (!campaignId || questionResponse === undefined || !userId) {
        return res.status(400).json({
            error: "Campaign ID, question response, and user ID are required"
        });
    }

    if (!ObjectId.isValid(campaignId) || !ObjectId.isValid(userId)) {
        return res.status(400).json({ error: "Invalid ID format" });
    }

    questionResponse = parseInt(questionResponse);
    if (![1, 2, 3, 4].includes(questionResponse)) {
        return res.status(400).json({ error: "Invalid question response (must be 1-4)" });
    }

    let client;
    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        const existingView = await db.collection('usercampaignviews').findOne({
            userId: new ObjectId(userId),
            campaignId: new ObjectId(campaignId)
        });

        if (existingView) {
            return res.status(400).json({
                error: "You've already earned reward from this video",
                alreadyCompleted: true
            });
        }

        const { age, gender } = await getUserDemographics(userId);
        const ageGroup = getAgeGroup(age);
        const normalizedGender = gender.toLowerCase();

        const validGenders = ['male', 'female', 'other'];
        if (!validGenders.includes(normalizedGender)) {
            return res.status(400).json({ error: "Invalid gender value" });
        }

        const campaign = await db.collection('campaigns').findOne(
            { _id: new ObjectId(campaignId) },
            {
                projection: {
                    "quizQuestion": 1,
                    "campaignVideoUrl": 1,
                    "engagements": 1,
                    "videoWatchTime": 1
                }
            }
        );

        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        const quizQuestion = campaign.quizQuestion;
        if (!quizQuestion || !quizQuestion.optionStats) {
            return res.status(400).json({ error: "No quiz question found for this campaign" });
        }

        const user = await db.collection('consumerusers').findOne(
            { _id: new ObjectId(userId) },
            { projection: { subscriptionPlan: 1, totalBalance: 1, remainingBalance: 1 } }
        );

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const optionKey = `option${questionResponse}`;
        const selectedOptionText = quizQuestion[optionKey];
        const correctOptionText = quizQuestion.answer;
        const isCorrect = selectedOptionText === correctOptionText;

        let correctAnswerNumber = null;
        if (quizQuestion.option1 === correctOptionText) correctAnswerNumber = 1;
        else if (quizQuestion.option2 === correctOptionText) correctAnswerNumber = 2;
        else if (quizQuestion.option3 === correctOptionText) correctAnswerNumber = 3;
        else if (quizQuestion.option4 === correctOptionText) correctAnswerNumber = 4;

        const totalResponses =
            (quizQuestion.optionStats.option1?.totalCount || 0) +
            (quizQuestion.optionStats.option2?.totalCount || 0) +
            (quizQuestion.optionStats.option3?.totalCount || 0) +
            (quizQuestion.optionStats.option4?.totalCount || 0);

        const updateQuery = {
            $inc: {
                [`quizQuestion.optionStats.${optionKey}.totalCount`]: 1,
                [`quizQuestion.optionStats.${optionKey}.demographics.${ageGroup}.${normalizedGender}`]: 1,
                "engagements.totalCount": 1
            }
        };

        let updatePromises = [];

        if (isCorrect) {
            updatePromises.push(
                db.collection('campaigns').updateOne(
                    { _id: new ObjectId(campaignId) },
                    updateQuery
                ),
                db.collection('usercampaignviews').insertOne({
                    userId: new ObjectId(userId),
                    campaignId: new ObjectId(campaignId),
                    createdAt: new Date()
                })
            );
        }

        let rewardDetails = null;
        if (watchTime && isCorrect) {
            const watchTimeSeconds = parseInt(watchTime);
            if (isNaN(watchTimeSeconds)) {
                return res.status(400).json({ error: "Invalid watch time value" });
            }

            // Cap watch time at 30 seconds
            const cappedWatchTime = Math.min(watchTimeSeconds, 30);
            if (cappedWatchTime <= 0) {
                return res.status(400).json({ error: "Watch time must be positive" });
            }

            // Update video watch time tracking
            const existingWatchTimeEntry = campaign.videoWatchTime?.find(entry => entry.seconds === cappedWatchTime);

            if (existingWatchTimeEntry) {
                updatePromises.push(
                    db.collection('campaigns').updateOne(
                        { _id: new ObjectId(campaignId), "videoWatchTime.seconds": cappedWatchTime },
                        { $inc: { "videoWatchTime.$.count": 1 } }
                    )
                );
            } else {
                updatePromises.push(
                    db.collection('campaigns').updateOne(
                        { _id: new ObjectId(campaignId) },
                        { $push: { videoWatchTime: { seconds: cappedWatchTime, count: 1 } } }
                    )
                );
            }

            const subscriptionPlan = user.subscriptionPlan || "Free";
            let earnedAmount = 0;
            
            if (subscriptionPlan === "Premium") {
                // Premium users earn $0.01 per second
                earnedAmount = cappedWatchTime * 0.01;
            } else {
                // Free users earn $0.01 per 3 seconds
                earnedAmount = (cappedWatchTime / 3) * 0.01;
            }
            
            // Round to 2 decimal places to avoid floating point precision issues
            earnedAmount = Math.round(earnedAmount * 100) / 100;

            if (earnedAmount > 0) {
                const transaction = new TransactionHistory({
                    userId: userId,
                    amount: earnedAmount,
                    type: 'earning'
                });

                // Update user balance with decimal values
                const newTotalBalance = user.totalBalance + earnedAmount;
                const newRemainingBalance = user.remainingBalance + earnedAmount;
                
                updatePromises.push(
                    db.collection('consumerusers').updateOne(
                        { _id: new ObjectId(userId) },
                        {
                            $set: {
                                totalBalance: parseFloat(newTotalBalance.toFixed(2)),
                                remainingBalance: parseFloat(newRemainingBalance.toFixed(2))
                            }
                        }
                    ),
                    transaction.save()
                );

                rewardDetails = {
                    earnedAmount: parseFloat(earnedAmount.toFixed(2)),
                    totalBalance: parseFloat(newTotalBalance.toFixed(2)),
                    remainingBalance: parseFloat(newRemainingBalance.toFixed(2)),
                    message: `You earned $${earnedAmount.toFixed(2)} for watching ${cappedWatchTime} seconds (${subscriptionPlan} plan)`
                };
            }
        }

        if (campaign.campaignVideoUrl) {
            updatePromises.push(
                db.collection('videowatchusers').updateOne(
                    { userId, videoUrl: campaign.campaignVideoUrl },
                    { $set: { userId, videoUrl: campaign.campaignVideoUrl } },
                    { upsert: true }
                )
            );
        }

        await Promise.all(updatePromises);

        const updatedCampaign = await db.collection('campaigns').findOne(
            { _id: new ObjectId(campaignId) },
            { projection: { [`quizQuestion.optionStats.${optionKey}.totalCount`]: 1 } }
        );

        const selectedOptionCount = updatedCampaign.quizQuestion.optionStats[optionKey].totalCount;
        const newTotalResponses = totalResponses + 1;
        const percentage = Math.round((selectedOptionCount / newTotalResponses) * 100);

        res.status(200).json({
            message: "Question response recorded successfully",
            percentage: `${percentage}% of people selected this option`,
            isCorrect,
            rewardDetails,
            correctAnswerNumber
        });

    } catch (error) {
        console.error("Error submitting quiz question response:", error);

        if (error.message.includes('User not found')) {
            return res.status(404).json({ error: error.message });
        }
        if (error.message.includes('Invalid user ID format')) {
            return res.status(400).json({ error: error.message });
        }

        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) {
            await client.close();
        }
    }
};

exports.submitSurveyResponses = async (req, res) => {
    const { userId, campaignId, surveyResponse1, surveyResponse2 } = req.body;

    if (!campaignId || !userId) {
        return res.status(400).json({ error: "Campaign ID and user ID are required" });
    }

    if (!ObjectId.isValid(campaignId) || !ObjectId.isValid(userId)) {
        return res.status(400).json({ error: "Invalid ID format" });
    }

    if (surveyResponse1 === undefined && surveyResponse2 === undefined) {
        return res.status(400).json({ error: "At least one survey response is required" });
    }

    if (surveyResponse1 !== undefined && ![1, 2, 3, 4].includes(parseInt(surveyResponse1))) {
        return res.status(400).json({ error: "Survey response 1 must be between 1 and 4" });
    }

    if (surveyResponse2 !== undefined && ![1, 2, 3, 4].includes(parseInt(surveyResponse2))) {
        return res.status(400).json({ error: "Survey response 2 must be between 1 and 4" });
    }

    let client;
    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        const user = await db.collection('consumerusers').findOne(
            { _id: new ObjectId(userId) },
            { projection: { totalBalance: 1, remainingBalance: 1 } }
        );

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const campaign = await db.collection('campaigns').findOne(
            { _id: new ObjectId(campaignId) },
            { projection: { surveyQuestion1: 1, surveyQuestion2: 1 } }
        );

        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        const response = {
            message: "Congratulations! You've earned reward for completing the survey",
            results: {},
            balanceDetails: {
                totalBalance: user.totalBalance,
                remainingBalance: user.remainingBalance,
            }
        };

        const updates = {};

        if (surveyResponse1 !== undefined) {
            if (!campaign.surveyQuestion1) {
                return res.status(400).json({ error: "This campaign doesn't have survey question 1" });
            }

            updates.$inc = updates.$inc || {};
            updates.$inc[`surveyQuestion1.optionStats.option${surveyResponse1}.totalCount`] = 1;

            const totalResponses = [1, 2, 3, 4].reduce((sum, opt) => {
                return sum + (campaign.surveyQuestion1.optionStats?.[`option${opt}`]?.totalCount || 0);
            }, 0);

            const selectedOptionCount = campaign.surveyQuestion1.optionStats?.[`option${surveyResponse1}`]?.totalCount || 0;
            const percentage = totalResponses > 0
                ? Math.round(((selectedOptionCount + 1) / (totalResponses + 1)) * 100)
                : 100;

            response.results.surveyQuestion1 = {
                percentage: `${percentage}% of people selected this option`
            };
        }

        if (surveyResponse2 !== undefined) {
            if (!campaign.surveyQuestion2) {
                return res.status(400).json({ error: "This campaign doesn't have survey question 2" });
            }

            updates.$inc = updates.$inc || {};
            updates.$inc[`surveyQuestion2.optionStats.option${surveyResponse2}.totalCount`] = 1;

            const totalResponses = [1, 2, 3, 4].reduce((sum, opt) => {
                return sum + (campaign.surveyQuestion2.optionStats?.[`option${opt}`]?.totalCount || 0);
            }, 0);

            const selectedOptionCount = campaign.surveyQuestion2.optionStats?.[`option${surveyResponse2}`]?.totalCount || 0;
            const percentage = totalResponses > 0
                ? Math.round(((selectedOptionCount + 1) / (totalResponses + 1)) * 100)
                : 100;

            response.results.surveyQuestion2 = {
                percentage: `${percentage}% of people selected this option`
            };
        }

        if (Object.keys(updates).length > 0) {
            await db.collection('campaigns').updateOne(
                { _id: new ObjectId(campaignId) },
                updates
            );
        }

        res.status(200).json(response);

    } catch (error) {
        console.error("Error submitting survey responses:", error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) {
            await client.close();
        }
    }
};

exports.recordCampaignClick = async (req, res) => {
    let client;
    try {
        const { userId, campaignId } = req.body;

        if (!userId || !campaignId) {
            return res.status(400).json({ error: 'userId and campaignId are required' });
        }

        if (!ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID format' });
        }

        if (!ObjectId.isValid(campaignId)) {
            return res.status(400).json({ error: 'Invalid campaign ID format' });
        }

        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        const user = await db.collection('consumerusers').findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(campaignId) });
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (campaign.status === 'Completed') {
            return res.status(200).json({
                message: 'Campaign already completed',
                data: campaign
            });
        }

        const today = new Date();

        const currentEngagement = campaign.engagements?.totalCount || 0;
        const engagementGoal = campaign.engagements?.totalEngagementValue || 0;

        if (currentEngagement >= engagementGoal) {
            return res.status(200).json({
                message: 'Campaign engagement limit reached',
                data: campaign
            });
        }

        const newEngagementCount = currentEngagement + 1;
        const willComplete = newEngagementCount >= engagementGoal;

        const updateOperations = {
            $inc: {
                'engagements.totalCount': 1,
                'clickCount.totalCount': 1
            },
            $set: {
                updatedAt: new Date()
            }
        };

        const engagementDailyIndex = campaign.engagements.dailyCounts?.findIndex(d =>
            d.date.toISOString() === today.toISOString()
        );

        if (engagementDailyIndex >= 0) {
            updateOperations.$inc[`engagements.dailyCounts.${engagementDailyIndex}.count`] = 1;
        } else {
            updateOperations.$push = {
                'engagements.dailyCounts': { date: today, count: 1 }
            };
        }

        const clickDailyIndex = campaign.clickCount.dailyCounts?.findIndex(d =>
            d.date.toISOString() === today.toISOString()
        );

        if (clickDailyIndex >= 0) {
            updateOperations.$inc[`clickCount.dailyCounts.${clickDailyIndex}.count`] = 1;
        } else if (!updateOperations.$push) {
            updateOperations.$push = {
                'clickCount.dailyCounts': { date: today, count: 1 }
            };
        } else {
            updateOperations.$push['clickCount.dailyCounts'] = { date: today, count: 1 };
        }

        if (willComplete) {
            updateOperations.$set.status = 'Completed';
        }

        const updateResult = await db.collection('campaigns').findOneAndUpdate(
            {
                _id: new ObjectId(campaignId),
                'engagements.totalCount': { $lt: engagementGoal }
            },
            updateOperations,
            { returnDocument: 'after', returnOriginal: false }
        );

        if (!updateResult) {
            const currentCampaign = await db.collection('campaigns').findOne({ _id: new ObjectId(campaignId) });
            return res.status(200).json({
                message: 'Campaign engagement limit reached',
                data: currentCampaign
            });
        }

        if (willComplete && updateResult.status === 'Completed') {
            try {
                const businessUser = await db.collection('users').findOne({
                    userId: campaign.userId
                });

                if (businessUser?.businessEmail) {
                    const transporter = nodemailer.createTransport({
                        service: 'gmail',
                        auth: {
                            user: process.env.EMAIL_USER,
                            pass: process.env.EMAIL_PASSWORD
                        }
                    });

                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: businessUser.businessEmail,
                        subject: `Campaign Completed: ${campaign.campaignTitle}`,
                        html: `
                            <p>Hello ${businessUser.name || 'Business User'},</p>
                            <p>Your campaign <strong>"${campaign.campaignTitle}"</strong> has successfully reached its engagement goal!</p>
                            <p><strong>Engagement Details:</strong></p>
                            <ul>
                                <li>Target: ${engagementGoal} engagements</li>
                                <li>Achieved: ${newEngagementCount} engagements</li>
                                <li>Completion Date: ${new Date().toLocaleDateString()}</li>
                            </ul>
                            <p>Thank you for using our platform!</p>
                            <p>Best regards,<br>Your Marketing Team</p>
                        `
                    });
                    console.log('Completion email sent to:', businessUser.businessEmail);
                }
            } catch (emailError) {
                console.error('Error sending completion email:', emailError);
            }
        }

        return res.status(200).json({
            message: willComplete ? 'Campaign completed successfully' : 'Engagement recorded',
            data: updateResult
        });

    } catch (error) {
        console.error('Error in recordCampaignClick:', error);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    } finally {
        if (client) {
            try {
                await client.close();
            } catch (closeError) {
                console.error('Error closing MongoDB connection:', closeError);
            }
        }
    }
};

exports.paymentDeduct = async (req, res) => {
    let client;
    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        const campaign = await db.collection('campaigns').findOne({
            status: 'Active',
        });

        if (!campaign) {
            return res.status(404).json({ success: false, message: 'Campaign not found or not active' });
        }

        if (!campaign.cardDetail || !campaign.cardDetail.paymentMethodId) {
            return res.status(400).json({
                success: false,
                message: 'No payment method associated with this campaign'
            });
        }

        const todayDate = new Date().toISOString().slice(0, 10);
        const todayEngagement = campaign.engagements?.dailyCounts?.find(item => {
            const itemDate = new Date(item.date).toISOString().slice(0, 10);
            return itemDate === todayDate;
        });

        const engagementsToday = todayEngagement?.count || 0;

        if (engagementsToday <= 0) {
            return res.json({
                success: true,
                message: 'No engagements to charge for today',
                campaignId: campaign._id,
                engagementsToday: 0,
            });
        }

        if (campaign.campaignBudget < engagementsToday) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient campaign budget',
                requiredAmount: engagementsToday,
                remainingBudget: campaign.campaignBudget,
            });
        }

        let customerId = campaign.cardDetail.customerId;
        const paymentMethodId = campaign.cardDetail.paymentMethodId;

        if (!customerId) {
            try {
                const customer = await stripe.customers.create({
                    payment_method: paymentMethodId,
                    invoice_settings: {
                        default_payment_method: paymentMethodId
                    }
                });
                customerId = customer.id;

                await db.collection('campaigns').updateOne(
                    { _id: campaign._id },
                    { $set: { 'cardDetail.customerId': customerId } }
                );
            } catch (attachError) {
                console.error('Failed to attach PaymentMethod to Customer:', attachError);
                return res.status(400).json({
                    success: false,
                    message: 'Payment method cannot be reused. Please update card details.',
                    error: attachError.message
                });
            }
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: engagementsToday * 100,
            currency: 'usd',
            customer: customerId,
            payment_method: paymentMethodId,
            confirm: true,
            description: `Charge for ${engagementsToday} engagements on ${campaign.campaignTitle}`,
            metadata: {
                campaignId: campaign._id.toString(),
                userId: campaign.userId,
            },
            off_session: true,
        });

        await db.collection('campaigns').updateOne(
            { _id: campaign._id },
            {
                $inc: { campaignBudget: -engagementsToday },
                $push: {
                    paymentHistory: {
                        date: new Date(),
                        amount: engagementsToday,
                        status: 'success',
                        stripeChargeId: paymentIntent.id,
                    },
                },
            }
        );

        res.json({
            success: true,
            message: 'Payment processed successfully',
            paymentIntentId: paymentIntent.id,
            remainingBudget: campaign.campaignBudget - engagementsToday,
        });

    } catch (error) {
        console.error('Payment error:', error);

        if (error.type === 'StripeCardError') {
            return res.status(400).json({
                success: false,
                message: 'Payment failed due to card issue',
                error: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: 'Payment failed',
            error: error.message
        });
    } finally {
        if (client) client.close();
    }
};
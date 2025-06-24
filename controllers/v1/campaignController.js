const { MongoClient } = require('mongodb');
const { getUserDemographics, getAgeGroup } = require('../../utils/userUtils');
const { ObjectId } = require('mongodb');
const dotenv = require("dotenv");
dotenv.config();


exports.getAllSortedCampaigns = async (req, res) => {
    let client;
    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        const { gender } = req.body;
        const { page = 1 } = req.query;
        const itemsPerPage = 10;
        const pageNum = Math.max(1, parseInt(page));

        if (!gender || !['male', 'female'].includes(gender)) {
            return res.status(400).json({ error: "Please provide a valid gender (male or female)" });
        }

        const totalCount = await db.collection('campaigns').countDocuments({ genderType: gender });
        const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));

        if (pageNum > totalPages) {
            return res.status(400).json({
                error: `Requested page ${pageNum} exceeds total pages ${totalPages}`,
                totalPages,
                maxValidPage: totalPages
            });
        }

        const skip = (pageNum - 1) * itemsPerPage;
        const otherGender = gender === 'male' ? 'female' : 'male';

        const pipeline = [
            { $match: { genderType: gender } },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: itemsPerPage },
            {
                $project: {
                    _id: { $toString: '$_id' },
                    websiteLink: 1,
                    brandName: '$campaignTitle',
                    campaignVideo: '$campaignVideoUrl',
                    brandLogo: '$companyLogo',
                    gender: '$genderType',
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
                }
            }
        ];

        let campaigns = await db.collection('campaigns')
            .aggregate(pipeline)
            .toArray();

        if (campaigns.length < itemsPerPage) {
            const remainingItems = itemsPerPage - campaigns.length;
            const secondaryPipeline = [
                { $match: { genderType: otherGender } },
                { $sort: { createdAt: -1 } },
                { $limit: remainingItems },
                { $project: pipeline[4].$project }
            ];

            const secondaryResults = await db.collection('campaigns')
                .aggregate(secondaryPipeline)
                .toArray();

            campaigns = campaigns.concat(secondaryResults);
        }

        res.status(200).json({
            campaigns,
            currentPage: pageNum,
            totalPages
        });

    } catch (error) {
        console.error("Error fetching campaigns:", error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) {
            await client.close();
        }
    }
};

exports.submitQuizQuestionResponse = async (req, res) => {
    const { campaignId, questionResponse, userId } = req.body;

    if (!campaignId || !questionResponse || !userId) {
        return res.status(400).json({
            error: "Campaign ID, question response, and user ID are required"
        });
    }

    if (!ObjectId.isValid(campaignId) || !ObjectId.isValid(userId)) {
        return res.status(400).json({ error: "Invalid ID format" });
    }

    let client;
    try {
        const { age, gender } = await getUserDemographics(userId);
        const ageGroup = getAgeGroup(age);

        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        const campaign = await db.collection('campaigns').findOne(
            { _id: new ObjectId(campaignId) },
            { projection: { "quizQuestion.optionStats": 1 } }
        );

        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        const quizQuestion = campaign.quizQuestion;
        if (!quizQuestion || !quizQuestion.optionStats) {
            return res.status(400).json({ error: "No quiz question found for this campaign" });
        }

        const optionStats = quizQuestion.optionStats;
        const totalResponses =
            (optionStats.option1?.totalCount || 0) +
            (optionStats.option2?.totalCount || 0) +
            (optionStats.option3?.totalCount || 0) +
            (optionStats.option4?.totalCount || 0);

        if (![1, 2, 3, 4].includes(parseInt(questionResponse))) {
            return res.status(400).json({ error: "Invalid question response (must be 1-4)" });
        }

        const updateQuery = {
            $inc: {
                [`quizQuestion.optionStats.option${questionResponse}.totalCount`]: 1,
                [`quizQuestion.optionStats.option${questionResponse}.demographics.${ageGroup}.${gender}`]: 1
            }
        };

        const result = await db.collection('campaigns').updateOne(
            { _id: new ObjectId(campaignId) },
            updateQuery
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ error: "Campaign not found or update failed" });
        }

        const selectedOptionCount = optionStats[`option${questionResponse}`]?.totalCount || 0;
        const percentage = totalResponses > 0
            ? Math.round(((selectedOptionCount + 1) / (totalResponses + 1)) * 100)
            : 100;

        res.status(200).json({
            message: "Question response recorded successfully",
            percentage: `${percentage}% of people selected this option`,
            isCorrect: quizQuestion.answer === `option${questionResponse}`
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
    const { userId, campaignId, surveyResponse1, surveyResponse2, watchTime } = req.body;

    if (!campaignId || !userId) {
        return res.status(400).json({ error: "Campaign ID and user ID are required" });
    }

    if (!ObjectId.isValid(campaignId) || !ObjectId.isValid(userId)) {
        return res.status(400).json({ error: "Invalid ID format" });
    }

    if (surveyResponse1 === undefined && surveyResponse2 === undefined && !watchTime) {
        return res.status(400).json({ error: "At least one survey response or watch time is required" });
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
            { projection: { subscriptionPlan: 1, totalBalance: 1, remainingBalance: 1 } }
        );

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const { age, gender } = await getUserDemographics(userId);
        const ageGroup = getAgeGroup(age);

        const campaign = await db.collection('campaigns').findOne(
            { _id: new ObjectId(campaignId) },
            { projection: { surveyQuestion1: 1, surveyQuestion2: 1 } }
        );

        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        const updates = {};
        const response = {
            message: "Survey response(s) recorded successfully",
            results: {},
            rewardDetails: {}
        };

        if (surveyResponse1 !== undefined) {
            if (!campaign.surveyQuestion1) {
                return res.status(400).json({ error: "This campaign doesn't have survey question 1" });
            }

            const totalResponses = [1, 2, 3, 4].reduce((sum, opt) => {
                return sum + (campaign.surveyQuestion1.optionStats?.[`option${opt}`]?.totalCount || 0);
            }, 0);

            updates.$inc = updates.$inc || {};
            updates.$inc[`surveyQuestion1.optionStats.option${surveyResponse1}.totalCount`] = 1;

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

            const totalResponses = [1, 2, 3, 4].reduce((sum, opt) => {
                return sum + (campaign.surveyQuestion2.optionStats?.[`option${opt}`]?.totalCount || 0);
            }, 0);

            updates.$inc = updates.$inc || {};
            updates.$inc[`surveyQuestion2.optionStats.option${surveyResponse2}.totalCount`] = 1;

            const selectedOptionCount = campaign.surveyQuestion2.optionStats?.[`option${surveyResponse2}`]?.totalCount || 0;
            const percentage = totalResponses > 0
                ? Math.round(((selectedOptionCount + 1) / (totalResponses + 1)) * 100)
                : 100;

            response.results.surveyQuestion2 = {
                percentage: `${percentage}% of people selected this option`
            };
        }

        if (watchTime) {
            const watchTimeSeconds = parseInt(watchTime);
            if (isNaN(watchTimeSeconds) || watchTimeSeconds <= 0) {
                return res.status(400).json({ error: "Invalid watch time value" });
            }

            let earnedCents = 0;
            const subscriptionPlan = user.subscriptionPlan || "Free";

            if (subscriptionPlan === "Premium") {
                earnedCents = Math.floor(watchTimeSeconds);
            } else {
                earnedCents = Math.floor(watchTimeSeconds / 3);
            }

            if (earnedCents > 0) {
                const newTotalBalance = user.totalBalance + earnedCents;
                const newRemainingBalance = user.remainingBalance + earnedCents;

                await db.collection('consumerusers').updateOne(
                    { _id: new ObjectId(userId) },
                    {
                        $inc: {
                            totalBalance: earnedCents,
                            remainingBalance: earnedCents
                        }
                    }
                );

                response.rewardDetails = {
                    earnedCents,
                    totalBalance: newTotalBalance,
                    remainingBalance: newRemainingBalance,
                    message: `You earned ${earnedCents} cent(s) for watching ${watchTimeSeconds} seconds (${subscriptionPlan} plan)`
                };
            } else {
                response.rewardDetails = {
                    earnedCents: 0,
                    totalBalance: user.totalBalance,
                    remainingBalance: user.remainingBalance,
                    message: `Watch time of ${watchTimeSeconds} seconds didn't earn any cents yet (${subscriptionPlan} plan)`
                };
            }
        }

        if (Object.keys(updates).length > 0) {
            const result = await db.collection('campaigns').updateOne(
                { _id: new ObjectId(campaignId) },
                updates
            );

            if (result.modifiedCount === 0) {
                return res.status(404).json({ error: "Campaign not found or update failed" });
            }
        }

        res.status(200).json(response);

    } catch (error) {
        console.error("Error submitting survey responses:", error);

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


exports.recordCampaignClick = async (req, res) => {
    let client;
    try {
        const { userId, campaignId } = req.body;

        if (!userId || !campaignId) {
            return res.status(400).json({ error: 'userId and campaignId are required' });
        }

        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        if (!ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID format' });
        }

        const user = await db.collection('consumerusers').findOne(
            { _id: new ObjectId(userId) }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!ObjectId.isValid(campaignId)) {
            return res.status(400).json({ error: 'Invalid campaign ID format' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const updateResult = await db.collection('campaigns').findOneAndUpdate(
            { _id: new ObjectId(campaignId) },
            [
                {
                    $set: {
                        'engagements.totalCount': { $add: ['$engagements.totalCount', 1] },
                        'clickCount.totalCount': { $add: ['$clickCount.totalCount', 1] },
                        'clickCount.dailyCounts': {
                            $cond: [
                                { 
                                    $gt: [
                                        {
                                            $size: {
                                                $filter: {
                                                    input: '$clickCount.dailyCounts',
                                                    as: 'daily',
                                                    cond: { $eq: ['$$daily.date', today] }
                                                }
                                            }
                                        },
                                        0
                                    ]
                                },
                                {
                                    $map: {
                                        input: '$clickCount.dailyCounts',
                                        as: 'daily',
                                        in: {
                                            $cond: [
                                                { $eq: ['$$daily.date', today] },
                                                {
                                                    date: '$$daily.date',
                                                    count: { $add: ['$$daily.count', 1] }
                                                },
                                                '$$daily'
                                            ]
                                        }
                                    }
                                },
                                {
                                    $concatArrays: [
                                        '$clickCount.dailyCounts',
                                        [{ date: today, count: 1 }]
                                    ]
                                }
                            ]
                        }
                    }
                }
            ],
            { 
                returnDocument: 'after'
            }
        );

        console.log("updateResult",updateResult);

        if (!updateResult) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        return res.status(200).json({ 
            message: 'Campaign engagement updated successfully',
            // data: updateResult
        });

    } catch (error) {
        console.error('Error in recordCampaignClick:', error);
        return res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (client) {
            await client.close();
        }
    }
};
const { MongoClient } = require('mongodb');
const { getUserDemographics, getAgeGroup } = require('../../utils/userUtils');
const { ObjectId } = require('mongodb');
const dotenv = require("dotenv");
const VideoWatchUsers = require('../../models/VideoWatchUser.model');

dotenv.config();
exports.getAllSortedCampaigns = async (req, res) => {
    let client;
    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        const { gender, userId } = req.body;
        const { page = 1 } = req.query;
        const itemsPerPage = 10;
        const pageNum = Math.max(1, parseInt(page));

        if (!gender || !['male', 'female'].includes(gender)) {
            return res.status(400).json({ error: "Please provide a valid gender (male or female)" });
        }

        const otherGender = gender === 'male' ? 'female' : 'male';

        const watchedVideosLookup = {
            $lookup: {
                from: 'videowatchusers',
                let: { campaignVideoUrl: "$campaignVideoUrl" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$userId", userId] },
                                    { $eq: ["$videoUrl", "$$campaignVideoUrl"] }
                                ]
                            }
                        }
                    }
                ],
                as: "watchedVideos"
            }
        };

        const mainPipeline = [
            { $match: { genderType: gender } },
            watchedVideosLookup,
            { $match: { watchedVideos: { $size: 0 } } },
            { $sort: { createdAt: -1 } },
            { $skip: (pageNum - 1) * itemsPerPage },
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

        const countPipeline = [
            { $match: { genderType: gender } },
            watchedVideosLookup,
            { $match: { watchedVideos: { $size: 0 } } },
            { $count: "total" }
        ];

        const [campaigns, countResult] = await Promise.all([
            db.collection('campaigns').aggregate(mainPipeline).toArray(),
            db.collection('campaigns').aggregate(countPipeline).next()
        ]);

        const totalCount = countResult?.total || 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));

        if (campaigns.length < itemsPerPage && totalPages <= pageNum) {
            const remainingItems = itemsPerPage - campaigns.length;
            
            const secondaryPipeline = [
                { $match: { genderType: otherGender } },
                watchedVideosLookup,
                { $match: { watchedVideos: { $size: 0 } } },
                { $sort: { createdAt: -1 } },
                { $limit: remainingItems },
                {
                    $project: {
                        _id: { $toString: '$_id' },
                        websiteLink: 1,
                        brandName: '$campaignTitle',
                        campaignVideo: '$campaignVideoUrl',
                        brandLogo: '$companyLogo',
                        gender: '$genderType',
                        questions: mainPipeline[6].$project.questions
                    }
                }
            ];

            const secondaryResults = await db.collection('campaigns')
                .aggregate(secondaryPipeline)
                .toArray();

            campaigns.push(...secondaryResults);
        }

        res.status(200).json({
            campaigns,
            currentPage: pageNum,
            totalPages
        });

    } catch (error) {
        console.error("Error fetching campaigns:", error);
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

        const [user, campaign, demographics] = await Promise.all([
            db.collection('consumerusers').findOne(
                { _id: new ObjectId(userId) },
                { projection: { subscriptionPlan: 1, totalBalance: 1, remainingBalance: 1 } }
            ),
            db.collection('campaigns').findOne(
                { _id: new ObjectId(campaignId) },
                { projection: { surveyQuestion1: 1, surveyQuestion2: 1, campaignVideoUrl: 1 } }
            ),
            getUserDemographics(userId).catch(() => ({})) 
        ]);

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        const response = {
            message: "Survey response(s) recorded successfully",
            results: {},
            rewardDetails: {}
        };

        const updatePromises = [];
        const updates = {};

        if ((surveyResponse1 !== undefined || surveyResponse2 !== undefined) && campaign.campaignVideoUrl) {
            try {
                await db.collection('videowatchusers').updateOne(
                    { userId: userId, videoUrl: campaign.campaignVideoUrl },
                    { $set: { userId: userId, videoUrl: campaign.campaignVideoUrl } },
                    { upsert: true }
                );
            } catch (error) {
                console.error("Error saving video watch record:", error);
            }
        }

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

        let earnedCents = 0;
        if (watchTime) {
            const watchTimeSeconds = parseInt(watchTime);
            if (isNaN(watchTimeSeconds) || watchTimeSeconds <= 0) {
                return res.status(400).json({ error: "Invalid watch time value" });
            }

            const subscriptionPlan = user.subscriptionPlan || "Free";
            earnedCents = subscriptionPlan === "Premium" 
                ? Math.floor(watchTimeSeconds)
                : Math.floor(watchTimeSeconds / 3);

            if (earnedCents > 0) {
                updatePromises.push(
                    db.collection('consumerusers').updateOne(
                        { _id: new ObjectId(userId) },
                        {
                            $inc: {
                                totalBalance: earnedCents,
                                remainingBalance: earnedCents
                            }
                        }
                    )
                );

                response.rewardDetails = {
                    earnedCents,
                    totalBalance: user.totalBalance + earnedCents,
                    remainingBalance: user.remainingBalance + earnedCents,
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
            updatePromises.push(
                db.collection('campaigns').updateOne(
                    { _id: new ObjectId(campaignId) },
                    updates
                )
            );
        }

        if (updatePromises.length > 0) {
            const results = await Promise.all(updatePromises);
            const campaignUpdateResult = results.find(r => r?.modifiedCount !== undefined);
            
            if (campaignUpdateResult && campaignUpdateResult.modifiedCount === 0) {
                return res.status(404).json({ error: "Campaign update failed" });
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
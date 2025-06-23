const { connectDB } = require('../../config/connectDB');
const { MongoClient } = require('mongodb');
const { getUserDemographics, getAgeGroup } = require('../../utils/userUtils');
// controllers/campaignController.js
const { ObjectId } = require('mongodb'); // Add ObjectId import

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

        const totalCount = await db.collection('compaigns').countDocuments({ genderType: gender });
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

        let campaigns = await db.collection('compaigns')
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

            const secondaryResults = await db.collection('compaigns')
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

    // Validate ObjectId formats
    if (!ObjectId.isValid(campaignId) || !ObjectId.isValid(userId)) {
        return res.status(400).json({ error: "Invalid ID format" });
    }

    let client;
    try {
        // Get user demographics
        const { age, gender } = await getUserDemographics(userId);
        const ageGroup = getAgeGroup(age);

        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        // Get the current question to calculate percentages
        const campaign = await db.collection('compaigns').findOne(
            { _id: new ObjectId(campaignId) },
            { projection: { "quizQuestion": 1 } }
        );

        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        const quizQuestion = campaign.quizQuestion;
        if (!quizQuestion) {
            return res.status(400).json({ error: "No quiz question found for this campaign" });
        }

        // Calculate total responses
        const totalResponses = 
            (quizQuestion.option1?.totalCount || 0) +
            (quizQuestion.option2?.totalCount || 0) +
            (quizQuestion.option3?.totalCount || 0) +
            (quizQuestion.option4?.totalCount || 0);

        // Update response count and demographic stats
        const updateQuery = {
            $inc: {
                [`quizQuestion.option${questionResponse}.totalCount`]: 1,
                [`quizQuestion.demographicStats.ageGroups.${ageGroup}.${gender}`]: 1
            }
        };

        const result = await db.collection('compaigns').updateOne(
            { _id: new ObjectId(campaignId) },
            updateQuery
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ error: "Campaign not found or update failed" });
        }

        // Calculate percentage
        const selectedOptionCount = quizQuestion[`option${questionResponse}`]?.totalCount || 0;
        const percentage = totalResponses > 0 
            ? Math.round(((selectedOptionCount + 1) / (totalResponses + 1)) * 100)
            : 100;

        res.status(200).json({ 
            message: "Question response recorded successfully",
            percentage: `${percentage}% of people selected this option`
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


exports.submitSurveyQuestion1Response = async (req, res) => {
    const { campaignId, surveyResponse } = req.body;
    const userId = req.user._id;

    if (!campaignId || !surveyResponse) {
        return res.status(400).json({ error: "Campaign ID and survey response are required" });
    }

    let client;
    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        // First, check if the campaign has survey question 1
        const campaign = await db.collection('compaigns').findOne(
            { _id: new MongoClient.ObjectId(campaignId) },
            { projection: { "surveyQuestion1": 1 } }
        );

        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        if (!campaign.surveyQuestion1) {
            return res.status(400).json({ error: "This campaign doesn't have survey question 1" });
        }

        // Calculate total responses for percentage calculation
        const surveyQuestion = campaign.surveyQuestion1;
        const totalResponses =
            (surveyQuestion.option1?.totalCount || 0) +
            (surveyQuestion.option2?.totalCount || 0) +
            (surveyQuestion.option3?.totalCount || 0) +
            (surveyQuestion.option4?.totalCount || 0);

        // Update the survey response count
        const updateQuery = {
            $inc: {
                [`surveyQuestion1.option${surveyResponse}.totalCount`]: 1
            }
        };

        const result = await db.collection('compaigns').updateOne(
            { _id: new MongoClient.ObjectId(campaignId) },
            updateQuery
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ error: "Campaign not found or update failed" });
        }

        // Calculate percentage for the selected option
        const selectedOptionCount = surveyQuestion[`option${surveyResponse}`]?.totalCount || 0;
        const percentage = totalResponses > 0
            ? Math.round(((selectedOptionCount + 1) / (totalResponses + 1)) * 100)
            : 100;

        res.status(200).json({
            message: "Survey question 1 response recorded successfully",
            percentage: `${percentage}% of people selected this option`
        });

    } catch (error) {
        console.error("Error submitting survey question 1 response:", error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) {
            await client.close();
        }
    }
};

exports.submitSurveyQuestion2Response = async (req, res) => {
    const { campaignId, surveyResponse } = req.body;
    const userId = req.user._id;

    if (!campaignId || !surveyResponse) {
        return res.status(400).json({ error: "Campaign ID and survey response are required" });
    }

    let client;
    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();

        // First, check if the campaign has survey question 2
        const campaign = await db.collection('compaigns').findOne(
            { _id: new MongoClient.ObjectId(campaignId) },
            { projection: { "surveyQuestion2": 1 } }
        );

        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found" });
        }

        if (!campaign.surveyQuestion2) {
            return res.status(400).json({ error: "This campaign doesn't have survey question 2" });
        }

        // Calculate total responses for percentage calculation
        const surveyQuestion = campaign.surveyQuestion2;
        const totalResponses =
            (surveyQuestion.option1?.totalCount || 0) +
            (surveyQuestion.option2?.totalCount || 0) +
            (surveyQuestion.option3?.totalCount || 0) +
            (surveyQuestion.option4?.totalCount || 0);

        // Update the survey response count
        const updateQuery = {
            $inc: {
                [`surveyQuestion2.option${surveyResponse}.totalCount`]: 1
            }
        };

        const result = await db.collection('compaigns').updateOne(
            { _id: new MongoClient.ObjectId(campaignId) },
            updateQuery
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ error: "Campaign not found or update failed" });
        }

        // Calculate percentage for the selected option
        const selectedOptionCount = surveyQuestion[`option${surveyResponse}`]?.totalCount || 0;
        const percentage = totalResponses > 0
            ? Math.round(((selectedOptionCount + 1) / (totalResponses + 1)) * 100)
            : 100;

        res.status(200).json({
            message: "Survey question 2 response recorded successfully",
            percentage: `${percentage}% of people selected this option`
        });

    } catch (error) {
        console.error("Error submitting survey question 2 response:", error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) {
            await client.close();
        }
    }
};
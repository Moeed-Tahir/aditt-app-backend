const { connectDB } = require('../../config/connectDB');
const { MongoClient } = require('mongodb');

exports.getAllSortedCampaigns = async (req, res) => {
    let client;
    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();
        
        const { gender, page = 1 } = req.body;
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
            { $project: {
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
            }}
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
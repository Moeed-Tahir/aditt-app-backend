const { MongoClient } = require('mongodb');
const { ObjectId } = require('mongodb');

async function getUserDemographics(userId) {
    let client;

    try {
        client = await MongoClient.connect(process.env.MONGO_URI);
        const db = client.db();
        
        if (!ObjectId.isValid(userId)) {
            throw new Error('Invalid user ID format');
        }

        const user = await db.collection('consumerusers').findOne(
            { _id: new ObjectId(userId) },
            { projection: { age: 1, gender: 1 } }
        );
        
        if (!user) {
            throw new Error('User not found');
        }
        
        return {
            age: user.age,
            gender: user.gender || 'other'
        };
    } finally {
        if (client) {
            await client.close();
        }
    }
}

function getAgeGroup(age) {
    if (age >= 18 && age <= 24) return 'age18_24';
    if (age >= 25 && age <= 33) return 'age25_33';
    if (age >= 35 && age <= 44) return 'age35_44';
    if (age >= 45) return 'age45Plus';
    return 'age18_24';
}

module.exports = { getUserDemographics, getAgeGroup };
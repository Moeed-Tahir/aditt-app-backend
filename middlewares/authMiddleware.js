const jwt = require('jsonwebtoken');
const secret_Key = process.env.SECRET_KEY;

const authenticateJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, secret_Key);

      req.user = decoded;

      next();
    } catch (error) {
      console.error(`Error authenticating JWT: ${error.message}`);
      res.status(401).json({ status: 'failed', message: 'Unauthorized' });
    }
  } else {
    res.status(401).json({ status: 'failed', message: 'No token provided' });
  }
};

module.exports = authenticateJWT;

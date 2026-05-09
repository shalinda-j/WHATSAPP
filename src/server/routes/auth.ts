import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Admin from '../../models/Admin';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { strictRateLimit } from '../middleware/rateLimit';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

// SECURITY FIX: No hardcoded test admin - application requires proper MongoDB setup
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in environment');
}

// Check if MongoDB is available
const isMongoDBAvailable = () => {
  try {
    return mongoose.connection.readyState === 1;
  } catch {
    return false;
  }
};

// First time setup - Check if any admin exists
router.get('/setup-check', async (req, res) => {
  try {
    if (!isMongoDBAvailable()) {
      // SECURITY FIX: Return error instead of fallback to test admin
      return res.status(503).json({
        needsSetup: false,
        error: 'Database unavailable. Please ensure MongoDB is connected before using authentication.'
      });
    }
    const adminCount = await Admin.countDocuments();
    res.json({ needsSetup: adminCount === 0 });
  } catch (err: any) {
    console.error('Error in /setup-check:', err);
    res.status(500).json({ error: 'Failed to check setup status' });
  }
});

// Setup first admin
// SECURITY FIX: Add rate limiting to prevent brute force
router.post('/setup', strictRateLimit, async (req, res) => {
  try {
    const adminCount = await Admin.countDocuments();
    if (adminCount > 0) {
      return res.status(403).json({ message: 'Setup already completed' });
    }

    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = new Admin({
      username,
      passwordHash: hashedPassword,
      role: 'superadmin',
    });

    await newAdmin.save();
    res.json({ message: 'Admin created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// SECURITY FIX: Add rate limiting to prevent brute force attacks
router.post('/login', strictRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;

    // SECURITY FIX: Require MongoDB for authentication
    if (!isMongoDBAvailable()) {
      return res.status(503).json({
        message: 'Authentication service unavailable. Database connection required.',
        error: 'MONGODB_UNAVAILABLE'
      });
    }

    const admin = await Admin.findOne({ username });

    if (!admin) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, admin.passwordHash);
    if (!validPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role },
      JWT_SECRET!,
      { expiresIn: '24h' },
    );
    res.json({ token });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authenticateToken, (req: AuthRequest, res) => {
  res.json(req.user);
});

export default router;

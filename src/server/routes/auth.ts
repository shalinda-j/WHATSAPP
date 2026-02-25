import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
// import Admin from '../../models/Admin';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_change_in_prod';

// Simple in-memory admin for testing when MongoDB is not available
const TEST_ADMIN = {
  username: 'admin',
  passwordHash: '$2b$10$rQZ8kHWKQGYXkYQjQZz7/.yJ9rJjGKjQJ9rJjGKjQJ9rJjGKjQJ9', // 'admin123'
  role: 'superadmin',
  _id: 'test_admin_id'
};

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
      // Use test admin when MongoDB is not available
      return res.json({ needsSetup: false });
    }
    const adminCount = await Admin.countDocuments();
    res.json({ needsSetup: adminCount === 0 });
  } catch (err: any) {
    console.error('Error in /setup-check:', err);
    // Fallback to test admin
    res.json({ needsSetup: false });
  }
});

// Setup first admin
router.post('/setup', async (req, res) => {
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

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!isMongoDBAvailable()) {
      // Use test admin when MongoDB is not available
      if (username === TEST_ADMIN.username && password === 'admin123') {
        const token = jwt.sign(
          { id: TEST_ADMIN._id, username: TEST_ADMIN.username, role: TEST_ADMIN.role },
          JWT_SECRET,
          { expiresIn: '24h' },
        );
        return res.json({ token });
      } else {
        return res.status(400).json({ message: 'Invalid credentials' });
      }
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
      JWT_SECRET,
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

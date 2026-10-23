import express from 'express';
import { registerOwner, loginUser, sendPhoneOtp, verifyPhoneOtp } from '../services/authService.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { store } from '../db/store.js';

const router = express.Router();

/**
 * POST /api/auth/register
 * Register Business Owner & Organization
 */
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, businessName, subscriptionTier } = req.body;
    const result = await registerOwner({
      name,
      phone,
      password,
      businessName,
      subscriptionTier
    });

    res.status(201).json({
      status: 'success',
      message: 'Business registered successfully',
      data: result
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/auth/login
 * Log in via phone number and password
 */
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const result = await loginUser({ phone, password });

    res.json({
      status: 'success',
      message: 'Logged in successfully',
      data: result
    });
  } catch (err) {
    res.status(401).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/auth/otp/send
 * Request Phone OTP via Supabase Native Phone Auth
 */
router.post('/otp/send', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const result = await sendPhoneOtp(phone);
    res.json(result);
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/auth/otp/verify
 * Verify Phone OTP and log in
 */
router.post('/otp/verify', async (req, res) => {
  try {
    const { phone, token } = req.body;
    if (!phone || !token) return res.status(400).json({ error: 'phone and token are required' });
    const result = await verifyPhoneOtp(phone, token);
    res.json({
      status: 'success',
      message: 'Phone verified and authenticated',
      data: result
    });
  } catch (err) {
    res.status(401).json({ status: 'error', error: err.message });
  }
});

/**
 * GET /api/auth/me
 * Get current session profile & tenant info
 */
router.get('/me', authMiddleware, (req, res) => {
  const currentBots = store.getBotsByOrg(req.org.id);
  const currentMembers = store.getUsersByOrg(req.org.id);

  res.json({
    status: 'success',
    data: {
      user: req.user,
      org: {
        ...req.org,
        stats: {
          current_bots: currentBots.length,
          max_bots: req.org.max_bots,
          current_members: currentMembers.length,
          max_members: req.org.max_members
        }
      }
    }
  });
});

export default router;

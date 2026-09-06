import User from '../models/User.js';
import Survey from '../models/Survey.js';
import BuyingRequirement from '../models/BuyingRequirement.js';
import MarketPrice from '../models/MarketPrice.js';
import logger from '../utils/logger.js';
import Farm from '../models/Farm.js';

export const getDashboardStats = async (req, res) => {
  try {
    const stats = {
      totalUsers: await User.countDocuments({ active: true }),
      totalFarmers: await User.countDocuments({ role: 'farmer', active: true }),
      totalTraders: await User.countDocuments({ role: 'trader', active: true }),
      totalSurveyors: await User.countDocuments({ role: 'surveyor', active: true }),
      totalSurveys: await Survey.countDocuments(),
      completedSurveys: await Survey.countDocuments({ status: 'verified' }),
    };

    const recentSurveys = await Survey.find()
      .populate('farmerId', 'name email')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      stats,
      recentSurveys,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getUserManagement = async (req, res) => {
  try {
    const { role, province, district, municipality, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const filter = {};
    if (role) filter.role = role;
    if (province) filter['address.province'] = province;
    if (district) filter['address.district'] = district;
    if (municipality) filter['address.municipality'] = municipality;

    // Officers see only their own coverage district, whatever the query asks
    // for — this endpoint backs the officer dashboard's "profiles in your
    // coverage area" list as well as its farmer/trader counts. Mirrors the
    // scoping in reportController and surveyController so every officer-facing
    // list agrees on who they can see. A missing coverage district means the
    // account is malformed: scope to nothing rather than to everything.
    if (req.user.role === 'surveyor') {
      const coverageDistrict = req.user.coverageArea?.district;
      filter['address.district'] = coverageDistrict || { $in: [] };
    }

    const users = await User.find(filter)
      .select('-password')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(filter);

    const enrichedUsers = await Promise.all(
      users.map(async (u) => {
        if (u.role !== 'farmer') return u.toObject();

        const latestSurvey = await Survey.findOne({ farmerId: u._id }).sort({ createdAt: -1 });

        return {
          ...u.toObject(),
          location: latestSurvey
            ? {
                province: latestSurvey.province,
                district: latestSurvey.district,
                municipality: latestSurvey.municipality,
              }
            : null,
          surveyStatus: latestSurvey ? latestSurvey.status : 'none',
        };
      })
    );

    res.json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      users: enrichedUsers,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let details = {};

    if (user.role === 'farmer') {
      const farms = await Farm.find({ userId: user._id }).sort({ createdAt: -1 });
      const surveys = await Survey.find({ farmerId: user._id }).sort({ createdAt: -1 });
      details = { farms, surveys };
    } else if (user.role === 'trader') {
      const requirements = await BuyingRequirement.find({ traderId: user._id }).sort({ createdAt: -1 });
      details = { requirements };
    }

    res.json({ success: true, user, details });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.active = !user.active;
    await user.save();

    logger.info(`User status toggled: ${user.email}`);

    res.json({
      success: true,
      message: 'User status updated',
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
export const createStaffAccount = async (req, res) => {
  try {
    const { name, email, phone, password, role, address, coverageArea } = req.body;

    // role is already restricted to ['admin', 'surveyor'] by validateStaffCreation
    if (role === 'surveyor' && !coverageArea?.district) {
      return res.status(400).json({
        success: false,
        message: 'Coverage area (at least district) is required for officer accounts',
      });
    }

    let user = await User.findOne({ $or: [{ email }, { phone }] });

    if (user) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists',
      });
    }

    user = await User.create({
      name,
      email,
      phone,
      password,
      role,
      address,
      coverageArea: role === 'surveyor' ? coverageArea : undefined,
      verified: true,
    });

    logger.info(`Staff account created: ${user.email} (${user.role}) by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: `${role === 'surveyor' ? 'Officer' : 'Admin'} account created successfully`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error(`Staff account creation error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getAnalyticsReport = async (req, res) => {
  try {
    const surveyStats = await Survey.aggregate([
      {
        $group: {
          _id: null,
          totalSurveys: { $sum: 1 },
          avgProduction: { $avg: '$totalProductionKg' },
          avgEarnings: { $avg: '$totalEarnings2082' },
          avgSatisfaction: { $avg: '$satisfactionLevel' },
        },
      },
    ]);

    const priceStats = await MarketPrice.aggregate([
      {
        $group: {
          _id: '$district',
          avgWholesale: { $avg: '$wholesalePricePerKg' },
          avgRetail: { $avg: '$retailPricePerKg' },
        },
      },
    ]);

    res.json({
      success: true,
      surveyStats: surveyStats[0] || {},
      priceStats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export default {
  getDashboardStats,
  getUserManagement,
  toggleUserStatus,
  getAnalyticsReport,
  getUserDetails,
  createStaffAccount,
};
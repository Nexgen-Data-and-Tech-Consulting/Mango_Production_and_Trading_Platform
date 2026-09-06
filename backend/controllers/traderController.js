import BuyingRequirement from '../models/BuyingRequirement.js';
import User from '../models/User.js';
import Survey from '../models/Survey.js';
import MarketPrice from '../models/MarketPrice.js';
import logger from '../utils/logger.js';

// How far a trader's offered price may sit from the officer's reference
// (wholesale) price for that variety/district, depending on the quality
// they're buying: fair quality is worth less than the reference, premium
// is worth more, good sits close to it either way.
const QUALITY_PRICE_OFFSET = {
  fair: { min: -10, max: -1 },
  good: { min: -5, max: 5 },
  premium: { min: 1, max: 10 },
};

export const createBuyingRequirement = async (req, res) => {
  try {
    if (req.user.role !== 'trader' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only traders can create buying requirements',
      });
    }

    const { variety, quality, location, budget } = req.body;

    if (location?.district && variety) {
      const referencePrice = await MarketPrice.findOne({ district: location.district, variety }).sort({ date: -1 });

      if (referencePrice) {
        const offset = QUALITY_PRICE_OFFSET[quality] || QUALITY_PRICE_OFFSET.good;
        const base = referencePrice.wholesalePricePerKg;
        const allowedMin = base + offset.min;
        const allowedMax = base + offset.max;

        // Compare explicitly rather than relying on `budget?.x < n`: with budget
        // omitted both operands are undefined, every comparison is false, and the
        // band is bypassed entirely.
        const minOffered = budget?.minPricePerKg;
        const maxOffered = budget?.maxPricePerKg;
        const bandMessage = `For ${quality} quality ${variety} in ${location.district}, your price must be between Rs. ${allowedMin} and Rs. ${allowedMax}/kg (officer reference price: Rs. ${base}/kg).`;

        if (!Number.isFinite(minOffered) || !Number.isFinite(maxOffered)) {
          return res.status(400).json({
            success: false,
            message: `A minimum and maximum price per kg is required. ${bandMessage}`,
          });
        }

        if (minOffered < allowedMin || maxOffered > allowedMax) {
          return res.status(400).json({
            success: false,
            message: bandMessage,
          });
        }
      }
    }

    const requirement = await BuyingRequirement.create({
      ...req.body,
      traderId: req.user.id,
    });

    logger.info(`Buying requirement created: ${requirement._id}`);

    res.status(201).json({
      success: true,
      message: 'Buying requirement posted successfully',
      requirement,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getBuyingRequirements = async (req, res) => {
  try {
    const { status, variety, province, district, municipality, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const filter = { status: { $ne: 'cancelled' } };
    if (status) filter.status = status;
    if (variety) filter.variety = variety;
    if (province) filter['location.province'] = province;
    if (district) filter['location.district'] = district;
    if (municipality) filter['location.municipality'] = municipality;

    // Requirements past their deadline are no longer live opportunities, so
    // once browsing the open/default set, exclude anything whose date has
    // passed rather than relying on a scheduled job to flip their status.
    if (!status || status === 'open') {
      filter.requiredByDate = { $gte: new Date() };
    }

    const requirements = await BuyingRequirement.find(filter)
      .select('-responses')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await BuyingRequirement.countDocuments(filter);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      requirements,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// A farmer's own request history — every requirement they've responded to,
// with only their own response attached (never anyone else's).
export const getMyResponses = async (req, res) => {
  try {
    const requirements = await BuyingRequirement.find({ 'responses.farmerId': req.user.id })
      .sort({ updatedAt: -1 })
      .lean();

    const requests = requirements.map((r) => {
      const response = r.responses.find((res) => res.farmerId.toString() === req.user.id);
      return {
        _id: r._id,
        variety: r.variety,
        quantityMT: r.quantityMT,
        budget: r.budget,
        location: r.location,
        requiredByDate: r.requiredByDate,
        requirementStatus: r.status,
        response,
      };
    });

    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyRequirements = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const filter = { traderId: req.user.id };
    if (status) filter.status = status;

    const requirements = await BuyingRequirement.find(filter)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await BuyingRequirement.countDocuments(filter);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      requirements,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getBuyingRequirementById = async (req, res) => {
  try {
    const requirement = await BuyingRequirement.findByIdAndUpdate(
      req.params.id,
      { $inc: { viewCount: 1 } },
      { new: true }
    ).lean();

    if (!requirement) {
      return res.status(404).json({ success: false, message: 'Buying requirement not found' });
    }

    const isOwnerTrader = req.user.role === 'trader' && requirement.traderId.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (isOwnerTrader || isAdmin) {
      // Rejected applicants never surface to the trader. While still open,
      // show the pending applicants to decide between; once a farmer is
      // accepted the deal has moved forward, so only that farmer is shown
      // (with contact info and a production snapshot) instead of the list.
      const visible = requirement.status === 'open'
        ? requirement.responses.filter((r) => r.status === 'pending')
        : requirement.responses.filter((r) => r.status === 'accepted');

      requirement.responses = await Promise.all(
        visible.map(async (r) => {
          if (r.status !== 'accepted') return r;
          const [farmer, latestSurvey] = await Promise.all([
            User.findById(r.farmerId).select('phone email'),
            Survey.findOne({ farmerId: r.farmerId }).sort({ createdAt: -1 }),
          ]);
          return {
            ...r,
            farmerPhone: farmer?.phone,
            farmerEmail: farmer?.email,
            farmerStats: {
              recentProduction: latestSurvey?.totalProductionKg || 0,
              recentEarnings: latestSurvey?.totalEarnings2082 || 0,
            },
          };
        })
      );
      return res.json({ success: true, requirement });
    }

    if (req.user.role === 'farmer') {
      // A farmer only ever sees their own request, never anyone else's
      const ownResponse = requirement.responses.find(
        (r) => r.farmerId.toString() === req.user.id
      );
      return res.json({
        success: true,
        requirement: { ...requirement, responses: ownResponse ? [ownResponse] : [] },
      });
    }

    return res.json({ success: true, requirement: { ...requirement, responses: [] } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const addResponse = async (req, res) => {
  try {
    if (req.user.role !== 'farmer' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only farmers can respond',
      });
    }

    const requirement = await BuyingRequirement.findById(req.params.id);

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found',
      });
    }

    if (requirement.requiredByDate && requirement.requiredByDate < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'This requirement has passed its deadline and can no longer accept requests',
      });
    }

    const user = await User.findById(req.user.id);

    const response = {
      farmerId: req.user.id,
      farmerName: user.name,
      ...req.body,
    };

    requirement.responses.push(response);
    requirement.responseCount = requirement.responses.length;

    await requirement.save();

    logger.info(`Response added to requirement: ${requirement._id}`);

    res.json({
      success: true,
      message: 'Response submitted successfully',
      requirement,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getFarmerDirectory = async (req, res) => {
  try {
    const { district, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const filter = { role: 'farmer', active: true };
    if (district) filter['address.district'] = district;

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { name: searchRegex },
        { 'address.municipality': searchRegex },
        { 'address.tole': searchRegex },
      ];
    }

    const farmers = await User.find(filter)
      .select('-password')
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    const farmersWithData = await Promise.all(
      farmers.map(async (farmer) => {
        const survey = await Survey.findOne({ farmerId: farmer._id }).sort({
          createdAt: -1,
        });
        return {
          ...farmer.toObject(),
          recentProduction: survey?.totalProductionKg,
          recentEarnings: survey?.totalEarnings2082,
        };
      })
    );

    res.json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: farmersWithData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getFarmerProfile = async (req, res) => {
  try {
    const farmer = await User.findOne({
      _id: req.params.id,
      role: 'farmer',
    }).select('-password');

    if (!farmer) {
      return res.status(404).json({
        success: false,
        message: 'Farmer not found',
      });
    }

    const surveys = await Survey.find({ farmerId: farmer._id }).sort({ createdAt: -1 });
    const latestSurvey = surveys[0];

    res.json({
      success: true,
      data: {
        farmer,
        statistics: {
          recentProduction: latestSurvey?.totalProductionKg || 0,
          recentEarnings: latestSurvey?.totalEarnings2082 || 0,
          totalSurveys: surveys.length,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateResponseStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const requirement = await BuyingRequirement.findById(req.params.id);

    if (!requirement) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    if (requirement.traderId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to manage this requirement' });
    }

    const response = requirement.responses.id(req.params.responseId);
    if (!response) {
      return res.status(404).json({ success: false, message: 'Response not found' });
    }

    response.status = status;
    if (status === 'accepted') {
      requirement.status = 'in-progress';
      // The order is going to this farmer — every other still-pending
      // applicant is no longer in the running, so decline them too instead
      // of leaving them stuck on "pending" indefinitely.
      requirement.responses.forEach((r) => {
        if (r._id.toString() !== response._id.toString() && r.status === 'pending') {
          r.status = 'rejected';
        }
      });
    }

    await requirement.save();

    res.json({
      success: true,
      message: `Response ${status}`,
      requirement,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateRequirementStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['in-progress', 'completed', 'cancelled'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${allowedStatuses.join(', ')}`,
      });
    }

    const requirement = await BuyingRequirement.findById(req.params.id);
    if (!requirement) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    if (requirement.traderId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to manage this requirement' });
    }

    requirement.status = status;
    await requirement.save();

    res.json({ success: true, message: `Requirement marked as ${status}`, requirement });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  createBuyingRequirement,
  getBuyingRequirements,
  getMyResponses,
  getMyRequirements,
  getBuyingRequirementById,
  addResponse,
  updateResponseStatus,
  updateRequirementStatus,
  getFarmerDirectory,
  getFarmerProfile,
};
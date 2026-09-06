import mongoose from 'mongoose';

const buyingRequirementSchema = new mongoose.Schema(
  {
    traderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    variety: { type: String, required: true },
    quantityMT: { type: Number, required: true, min: 0.1 },
    quantityKg: Number,

    quality: {
      type: String,
      enum: ['premium', 'good', 'fair'],
      default: 'good',
    },
    location: {
      province: String,
      district: String,
      municipality: String,
      ward: Number,
    },

    budget: {
      minPricePerKg: Number,
      maxPricePerKg: Number,
      negotiable: { type: Boolean, default: true },
    },

    requiredByDate: Date,

    contact: {
      phone: String,
      email: String,
    },

    responses: [
      {
        farmerId: mongoose.Schema.Types.ObjectId,
        farmerName: String,
        availableQuantityKg: Number,
        proposedPricePerKg: Number,
        message: String,
        status: {
          type: String,
          enum: ['pending', 'accepted', 'rejected'],
          default: 'pending',
        },
        respondedAt: { type: Date, default: Date.now },
      },
    ],

    status: {
      type: String,
      enum: ['open', 'in-progress', 'completed', 'cancelled'],
      default: 'open',
    },

    responseCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Declared via schema.index(): the `indexes` schema option does not exist and
// was silently ignored, so none of these were ever created.
// getMyRequirements filters { traderId, status? } and sorts createdAt desc.
buyingRequirementSchema.index({ traderId: 1, status: 1, createdAt: -1 });
// getBuyingRequirements filters { status, variety? } and sorts createdAt desc.
buyingRequirementSchema.index({ status: 1, variety: 1, createdAt: -1 });

// No next() needed
buyingRequirementSchema.pre('save', async function () {
  this.quantityKg = this.quantityMT * 1000;
});

export default mongoose.model('BuyingRequirement', buyingRequirementSchema);
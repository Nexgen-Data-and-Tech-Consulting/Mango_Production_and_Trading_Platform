import mongoose from 'mongoose';

const marketPriceSchema = new mongoose.Schema(
  {
    // Scoped to the setting officer's coverage area, the same location
    // model used everywhere else (reports, surveys, buying requirements),
    // rather than a fixed list of named wholesale markets disconnected
    // from where anyone actually is.
    province: String,
    district: { type: String, required: true },
    municipality: String,

    variety: { type: String, required: true },
    date: { type: Date, default: Date.now },

    wholesalePricePerKg: { type: Number, required: true, min: 0 },
    retailPricePerKg: { type: Number, required: true, min: 0 },
    avgPrice: Number,

    quality: {
      type: String,
      enum: ['premium', 'good', 'fair', 'poor'],
      default: 'good',
    },
    supply: {
      type: String,
      enum: ['abundant', 'normal', 'scarce'],
      default: 'normal',
    },

    setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Mongoose has no `indexes` schema option — declaring them there is silently
// ignored. The hot path is "latest price for a district + variety".
marketPriceSchema.index({ district: 1, variety: 1, date: -1 });

// No next() needed
marketPriceSchema.pre('save', async function () {
  this.avgPrice = (this.wholesalePricePerKg + this.retailPricePerKg) / 2;
});

export default mongoose.model('MarketPrice', marketPriceSchema);
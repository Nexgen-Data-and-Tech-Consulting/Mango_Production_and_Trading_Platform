import fs from 'fs';
import Report from '../models/Report.js';
import { uploadToCloudinary } from '../config/cloudinary.js';
import logger from '../utils/logger.js';

export const uploadReportImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const imageUrl = await uploadToCloudinary(req.file.path);

    fs.unlink(req.file.path, (err) => {
      if (err) logger.error(`Failed to delete temp upload file: ${err.message}`);
    });

    res.json({ success: true, imageUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createReport = async (req, res) => {
  try {
    const { message, imageUrl } = req.body;

    if (!message?.trim() && !imageUrl) {
      return res.status(400).json({
        success: false,
        message: 'A message or photo is required',
      });
    }

    if (!req.user.address?.district) {
      return res.status(400).json({
        success: false,
        message: 'Your account has no district on file — update your address before reporting a problem',
      });
    }

    const report = await Report.create({
      reporterId: req.user.id,
      reporterName: req.user.name,
      reporterRole: req.user.role,
      province: req.user.address.province,
      district: req.user.address.district,
      message: message?.trim() || undefined,
      imageUrl,
    });

    logger.info(`Report created: ${report._id} (${report.district})`);

    res.status(201).json({
      success: true,
      message: 'Report submitted successfully',
      report,
    });
  } catch (error) {
    logger.error(`Report creation error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyReports = async (req, res) => {
  try {
    const reports = await Report.find({ reporterId: req.user.id })
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Officers see only reports from their own district. Admins can see everything
// (read-only oversight), optionally narrowed with ?district=.
export const getReports = async (req, res) => {
  try {
    const { status, district, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.user.role === 'surveyor') {
      if (!req.user.coverageArea?.district) {
        return res.json({ success: true, total: 0, page: 1, pages: 0, reports: [] });
      }
      filter.district = req.user.coverageArea.district;
    } else if (district) {
      filter.district = district;
    }

    if (status) filter.status = status;

    const reports = await Report.find(filter)
      .populate('resolvedBy', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Report.countDocuments(filter);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      reports,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const resolveReport = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    // An officer can only resolve reports within their assigned coverage area
    if (report.district !== req.user.coverageArea?.district) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to resolve reports outside your coverage area',
      });
    }

    report.status = 'resolved';
    report.resolvedBy = req.user.id;
    report.resolvedAt = new Date();
    if (req.body.officerNotes) report.officerNotes = req.body.officerNotes;

    await report.save();

    // getReports serves resolvedBy populated, and the client splices this
    // response straight into that list. Without the same populate the row
    // re-renders as "Resolved by undefined".
    await report.populate('resolvedBy', 'name email');

    logger.info(`Report resolved: ${report._id} by ${req.user.email}`);

    res.json({ success: true, message: 'Report marked resolved', report });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export default { createReport, getMyReports, getReports, resolveReport, uploadReportImage };
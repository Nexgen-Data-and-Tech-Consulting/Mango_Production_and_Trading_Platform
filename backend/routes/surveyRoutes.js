import express from 'express';
import {
  createSurvey,
  getSurveys,
  getMySurveyYears,
  getSurveyById,
  updateSurvey,
  deleteSurvey,
  verifySurvey,
  getSurveyStats,
  getCensusSummary,
  exportCensusCsv,
  getTreeAgeReference,
  previewExpectedProduction,
} from '../controllers/surveyController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validateSurveyData, handleValidationErrors } from '../utils/validators.js';

const router = express.Router();

// validateSurveyData mirrors the Survey schema's own required/min/max rules,
// so a bad payload comes back as a 400 naming the field instead of a 500
// carrying a raw Mongoose ValidationError.
router.post('/', protect, validateSurveyData, handleValidationErrors, createSurvey);
router.get('/', protect, getSurveys);

// Literal paths must be declared before '/:id', or Express matches them as ids.
router.get('/stats', protect, getSurveyStats);
router.get('/my-years', protect, getMySurveyYears);
router.get('/tree-age-reference', protect, getTreeAgeReference);
router.post('/expected-production', protect, previewExpectedProduction);

// Annual census — officer and admin only.
router.get('/census', protect, authorize('surveyor', 'admin'), getCensusSummary);
router.get('/census/export', protect, authorize('surveyor', 'admin'), exportCensusCsv);

router.get('/:id', protect, getSurveyById);
router.put('/:id', protect, authorize('farmer', 'surveyor', 'admin'), updateSurvey);
router.delete('/:id', protect, authorize('farmer', 'surveyor', 'admin'), deleteSurvey);
router.patch('/:id/verify', protect, authorize('surveyor'), verifySurvey);

export default router;

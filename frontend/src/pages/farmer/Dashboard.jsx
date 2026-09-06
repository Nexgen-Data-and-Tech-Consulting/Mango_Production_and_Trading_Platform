import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { FiArrowRight, FiMapPin, FiClipboard } from 'react-icons/fi';
import api from '../../services/api';
import PageBanner from '../../components/PageBanner';
import { checkSurveyStatus } from '../../store/surveySlice';
import { calculateExpectedProduction, formatKg } from '../../utils/treeAgeYield';
import '../../styles/dashboard.css';
import '../../styles/census.css';

export default function FarmerDashboard() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const { hasCurrentYear, currentYearBS, years } = useSelector((state) => state.survey);

  const [farms, setFarms] = useState([]);
  const [marketPrices, setMarketPrices] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFarm, setSelectedFarm] = useState(null);

  useEffect(() => {
    fetchDashboardData();
    if (hasCurrentYear === null) dispatch(checkSurveyStatus());
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [farmsRes, marketRes, reqRes] = await Promise.allSettled([
        api.get('/farms'),
        api.get('/market/latest', { params: { district: user?.address?.district } }),
        api.get('/traders/requirements', { params: { status: 'open', limit: 4 } }),
      ]);

      if (farmsRes.status === 'fulfilled') setFarms(farmsRes.value.data.farms || []);
      if (marketRes.status === 'fulfilled') setMarketPrices((marketRes.value.data.data || []).slice(0, 4));
      if (reqRes.status === 'fulfilled') setRequirements(reqRes.value.data.requirements || []);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="dashboard-container">Loading...</div>;

  return (
    <div className="dashboard-container">
      <PageBanner
        variant="farmer"
        eyebrow="Farmer dashboard"
        title={`Welcome back, ${user?.name}`}
        subtitle="Manage your orchards, submit production surveys, and respond to trader requirements."
      />

      {hasCurrentYear === false && (
        <div className="status status--reminder">
          <span>
            <FiClipboard />{' '}
            {years?.length > 0
              ? `Your ${currentYearBS} BS survey is due. Your last one was for ${years[0].year} BS.`
              : `You haven't submitted a production survey yet. It helps traders find you.`}
          </span>
          <button className="btn-primary" onClick={() => navigate('/farmer/survey')}>
            {years?.length > 0 ? `File ${currentYearBS} survey` : 'Complete survey'}
          </button>
        </div>
      )}

      {/* Census history — one row per year on file. */}
      {years?.length > 0 && (
        <div className="dashboard-section">
          <div className="dashboard-section-head">
            <h2>Your Census Records</h2>
          </div>
          <div className="tree-age-tags">
            {years.map((y) => (
              <span key={y.year} className={`census-year-chip census-year-chip--${y.status}`}>
                {y.year} BS · {y.status}
              </span>
            ))}
          </div>

          {/* A rejected record is correctable: the officer said what to fix,
              and PUT /surveys/:id puts it back in their queue. Without this the
              farmer only has "File survey", which 409s on the one-per-year rule. */}
          {years
            .filter((y) => y.status === 'rejected' && y.id)
            .map((y) => (
              <div className="status status--reminder" key={`fix-${y.id}`}>
                <span>
                  <FiClipboard /> Your {y.year} BS survey was sent back
                  {y.verificationNotes ? `: ${y.verificationNotes}` : '.'}
                </span>
                <button
                  className="btn-primary"
                  onClick={() => navigate(`/farmer/survey/${y.id}/edit`)}
                >
                  Correct and resubmit
                </button>
              </div>
            ))}
        </div>
      )}

      {/* ---------- Market price snapshot ---------- */}
      <div className="dashboard-section">
        <div className="dashboard-section-head">
          <h2>Market Prices</h2>
          <button className="view-all-link" onClick={() => navigate('/farmer/market')}>
            View all <FiArrowRight />
          </button>
        </div>

        {marketPrices.length === 0 ? (
          <p className="empty-message-small">No market prices published yet.</p>
        ) : (
          <div className="snapshot-grid">
            {marketPrices.map((price) => (
              <div
                key={`${price.district}-${price.variety}`}
                className="snapshot-card"
                onClick={() => navigate('/farmer/market')}
              >
                <div className="snapshot-card__top">
                  <h3>{price.variety}</h3>
                  <span className={`supply-badge ${price.supply}`}>{price.supply}</span>
                </div>
                <p className="snapshot-card__variety">{price.district}</p>
                <div className="snapshot-card__price">
                  Rs. {price.wholesalePricePerKg}
                  <span>/kg wholesale</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- Buying requirements snapshot ---------- */}
      <div className="dashboard-section">
        <div className="dashboard-section-head">
          <h2>Buying Requirements</h2>
          <button className="view-all-link" onClick={() => navigate('/trader/requirements')}>
            View all <FiArrowRight />
          </button>
        </div>

        {requirements.length === 0 ? (
          <p className="empty-message-small">No open buying requirements right now.</p>
        ) : (
          <div className="snapshot-grid">
            {requirements.map((req) => (
              <div
                key={req._id}
                className="snapshot-card"
                onClick={() => navigate('/trader/requirements')}
              >
                <div className="snapshot-card__top">
                  <h3>{req.variety}</h3>
                  <span className="quality-badge good">{req.quantityMT} MT</span>
                </div>
                <p className="snapshot-card__variety">
                  <FiMapPin size={12} /> {req.location?.district}
                </p>
                <div className="snapshot-card__price">
                  Rs. {req.budget?.minPricePerKg}-{req.budget?.maxPricePerKg}
                  <span>/kg budget</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- Farms ---------- */}
      <div className="dashboard-section">
        <div className="dashboard-section-head">
          <h2>Your Farms ({farms.length})</h2>
        </div>

        {farms.length === 0 ? (
          <p className="empty-message-small">You haven't registered any farms yet.</p>
        ) : (
          <div className="snapshot-grid">
            {farms.map((farm) => (
              <div key={farm._id} className="snapshot-card" onClick={() => setSelectedFarm(farm)}>
                <h3>{farm.farmName}</h3>
                <p className="snapshot-card__variety">
                  {farm.orchardAreaKatha ? `${farm.orchardAreaKatha} katha` : 'Area not set'} • {farm.totalTreeCount || 0} trees
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- Farm details modal ---------- */}
      {selectedFarm && (
        <div className="modal-overlay" onClick={() => setSelectedFarm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedFarm.farmName}</h2>
              <button className="close-btn" onClick={() => setSelectedFarm(null)}>×</button>
            </div>

            {selectedFarm.description && <p className="detail-note">{selectedFarm.description}</p>}

            <h3 className="detail-heading">Location</h3>
            <div className="detail-grid">
              <div><span className="detail-label">Province</span><span>{selectedFarm.location?.province || 'N/A'}</span></div>
              <div><span className="detail-label">District</span><span>{selectedFarm.location?.district || 'N/A'}</span></div>
              <div><span className="detail-label">Municipality</span><span>{selectedFarm.location?.municipality || 'N/A'}</span></div>
              <div><span className="detail-label">Ward</span><span>{selectedFarm.location?.ward || 'N/A'}</span></div>
              <div><span className="detail-label">Tole</span><span>{selectedFarm.location?.tole || 'N/A'}</span></div>
            </div>

            <h3 className="detail-heading">Orchard</h3>
            <div className="detail-grid">
              <div><span className="detail-label">Area</span><span>{selectedFarm.orchardAreaKatha || 0} katha ({selectedFarm.orchardAreaHectare || 0} ha)</span></div>
              <div><span className="detail-label">Total Trees</span><span>{selectedFarm.totalTreeCount || 0}</span></div>
              <div><span className="detail-label">Bearing Trees</span><span>{selectedFarm.bearingTreeCount || 0}</span></div>
              <div><span className="detail-label">Soil Type</span><span style={{ textTransform: 'capitalize' }}>{selectedFarm.soilType}</span></div>
              <div><span className="detail-label">Terrain</span><span style={{ textTransform: 'capitalize' }}>{selectedFarm.terrain}</span></div>
              <div><span className="detail-label">Irrigation</span><span style={{ textTransform: 'capitalize' }}>{selectedFarm.irrigationSystem}</span></div>
            </div>

            {selectedFarm.varieties?.length > 0 && (
              <>
                <h3 className="detail-heading">Varieties</h3>
                <div className="tree-age-tags">
                  {selectedFarm.varieties.map((v, i) => (
                    <span key={i} className="tree-age-tag">{v.name}: {v.percentage}%</span>
                  ))}
                </div>
              </>
            )}

            {selectedFarm.treeAgeDistribution && Object.values(selectedFarm.treeAgeDistribution).some((v) => v > 0) && (
              <>
                <h3 className="detail-heading">Tree Age Distribution</h3>
                {(() => {
                  const expected = calculateExpectedProduction(selectedFarm.treeAgeDistribution);
                  return (
                    <>
                      <table className="yield-table">
                        <thead>
                          <tr>
                            <th>Age</th>
                            <th>Trees</th>
                            <th>Per tree</th>
                            <th>Typical total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expected.perBracket
                            .filter((b) => b.trees > 0)
                            .map((b) => (
                              <tr key={b.key}>
                                <td>{b.label}</td>
                                <td>{b.trees}</td>
                                <td>{b.kgPerTree === 0 ? '—' : `${b.kgPerTree} kg`}</td>
                                <td>{b.expectedKg === 0 ? '—' : formatKg(b.expectedKg)}</td>
                              </tr>
                            ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={3}>Expected annual production</td>
                            <td>{formatKg(expected.expectedKg)}</td>
                          </tr>
                        </tfoot>
                      </table>
                      <p className="empty-message-small">
                        Reference figures from standard mango production tables for trees of
                        these ages. Actual harvest varies with weather, irrigation and care.
                      </p>
                    </>
                  );
                })()}
              </>
            )}

            {(selectedFarm.lastHarvestDate || selectedFarm.lastHarvestQuantityKg) && (
              <>
                <h3 className="detail-heading">Last Harvest</h3>
                <div className="detail-grid">
                  <div><span className="detail-label">Date</span><span>{selectedFarm.lastHarvestDate ? new Date(selectedFarm.lastHarvestDate).toLocaleDateString() : 'N/A'}</span></div>
                  <div><span className="detail-label">Quantity</span><span>{selectedFarm.lastHarvestQuantityKg || 0} kg</span></div>
                  <div><span className="detail-label">Revenue</span><span>Rs. {selectedFarm.lastHarvestRevenuNPR || 0}</span></div>
                </div>
              </>
            )}

            {selectedFarm.certifications?.length > 0 && (
              <>
                <h3 className="detail-heading">Certifications</h3>
                <div className="tree-age-tags">
                  {selectedFarm.certifications.map((c, i) => (
                    <span key={i} className="tree-age-tag">{c}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

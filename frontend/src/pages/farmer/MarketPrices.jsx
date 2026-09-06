import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../../services/api';
import { getProvinces, getDistricts } from '../../utils/nepalLocations';
import '../../styles/market.css';

export default function MarketPrices() {
  const { user } = useSelector((state) => state.auth);

  // Officers set one price per district + variety + day, so district is the
  // finest granularity prices actually have. A municipality filter matched only
  // the covering officer's own municipality and hid prices that did apply here.
  const [filters, setFilters] = useState({
    province: user?.address?.province || '',
    district: user?.address?.district || '',
  });
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);

  const [trendVariety, setTrendVariety] = useState('');
  const [priceHistory, setPriceHistory] = useState([]);

  useEffect(() => {
    fetchPrices();
  }, [filters]);

  useEffect(() => {
    if (!trendVariety || !filters.district) {
      setPriceHistory([]);
      return;
    }
    api.get('/market/trends', { params: { district: filters.district, variety: trendVariety, days: 30 } })
      .then(({ data }) => setPriceHistory(data.data.priceData))
      .catch(() => setPriceHistory([]));
  }, [trendVariety, filters.district]);

  const fetchPrices = async () => {
    setLoading(true);
    try {
      const response = await api.get('/market/latest', { params: filters });
      setPrices(response.data.data);
      if (response.data.data.length > 0 && !response.data.data.some((p) => p.variety === trendVariety)) {
        setTrendVariety(response.data.data[0].variety);
      }
    } catch (error) {
      console.error('Error fetching prices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    const updated = { ...filters, [name]: value };
    if (name === 'province') {
      updated.district = '';
    }
    setFilters(updated);
  };

  return (
    <div className="market-container">
      <div className="market-header">
        <h1>Market Prices</h1>
        <p>Officer-published mango prices for your area.</p>
      </div>

      <div className="market-filters">
        <div className="filter-group">
          <label>Province:</label>
          <select name="province" value={filters.province} onChange={handleFilterChange}>
            <option value="">All provinces</option>
            {getProvinces().map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>District:</label>
          <select name="district" value={filters.district} onChange={handleFilterChange} disabled={!filters.province}>
            <option value="">All districts</option>
            {getDistricts(filters.province).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="loading">Loading prices...</p>
      ) : prices.length === 0 ? (
        <p className="empty-message">
          {filters.district ? `No prices published for ${filters.district} yet.` : 'Select a province and district to see prices.'}
        </p>
      ) : (
        <>
          {/* Price Cards */}
          <div className="price-cards">
            {prices.map((price) => (
              <div
                key={`${price.district}-${price.variety}`}
                className="price-card"
                onClick={() => setTrendVariety(price.variety)}
                style={{ cursor: 'pointer' }}
              >
                <h3>{price.variety}</h3>
                <div className="price-info">
                  <div className="price-row">
                    <span>Wholesale:</span>
                    <strong>Rs. {price.wholesalePricePerKg}/kg</strong>
                  </div>
                  <div className="price-row">
                    <span>Retail:</span>
                    <strong>Rs. {price.retailPricePerKg}/kg</strong>
                  </div>
                  <div className="price-row">
                    <span>Average:</span>
                    <strong>Rs. {price.avgPrice?.toFixed(2)}/kg</strong>
                  </div>
                </div>
                <div className="supply-info">
                  <span className={`supply-badge ${price.supply}`}>{price.supply.toUpperCase()}</span>
                  <span className={`quality-badge ${price.quality}`}>{price.quality}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Price Trend Chart */}
          {priceHistory.length > 0 && (
            <div className="chart-section">
              <h2>30-Day Price Trend: {trendVariety}</h2>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={priceHistory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(date) => new Date(date).toLocaleDateString()}
                    formatter={(value) => `Rs. ${value.toFixed(2)}`}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="wholesale" stroke="#8884d8" name="Wholesale Price" />
                  <Line type="monotone" dataKey="retail" stroke="#82ca9d" name="Retail Price" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

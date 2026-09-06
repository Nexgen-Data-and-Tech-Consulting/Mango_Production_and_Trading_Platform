import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { getCurrentUser } from './store/authSlice';
import Sidebar from './components/Sidebar';
import { checkSurveyStatus } from './store/surveySlice';

// Pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Home from './pages/Home';

// Farmer Pages
import FarmerDashboard from './pages/farmer/Dashboard';
import SurveyForm from './pages/farmer/SurveyForm';
import MarketPrices from './pages/farmer/MarketPrices';
import AddFarm from './pages/farmer/AddFarm';
import ChatBox from './pages/community/ChatBox';
import ReportProblem from './pages/community/ReportProblem';
import MyRequests from './pages/farmer/MyRequests';

// Trader Pages
import TraderDashboard from './pages/trader/Dashboard';
import BuyingRequirements from './pages/trader/BuyingRequirements';
import CreateRequirement from './pages/trader/CreateRequirement';
import RequirementDetail from './pages/trader/RequirementDetail';

// Admin Pages
import AdminDashboard from './pages/admin/Dashboard';
import AdminCensus from './pages/admin/Census';
import CreateOfficer from './pages/admin/CreateOfficer';
// Officer Pages
import OfficerDashboard from './pages/officer/Dashboard';
import PendingSurveys from './pages/officer/PendingSurveys';
import OfficerCensus from './pages/officer/Census';
import OfficerReports from './pages/officer/Reports';
import OfficerMarketPrices from './pages/officer/MarketPrices';

// Protected Route Component
const ProtectedRoute = ({ children, requiredRole }) => {
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const { hasCurrentYear } = useSelector((state) => state.survey);

  useEffect(() => {
    if (user?.role === 'farmer' && hasCurrentYear === null) {
      dispatch(checkSurveyStatus());
    }
  }, [user, hasCurrentYear, dispatch]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && !requiredRole.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">{children}</main>
    </div>
  );
};

// Root route modified to ALWAYS return <Home />
const RootRoute = () => {
  return <Home />;
};

function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      dispatch(getCurrentUser());
    }
  }, [dispatch]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Auth Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Farmer Routes */}
        <Route
          path="/farmer/dashboard"
          element={
            <ProtectedRoute requiredRole={['farmer']}>
              <FarmerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/survey"
          element={
            <ProtectedRoute requiredRole={['farmer']}>
              <SurveyForm />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/survey/:id/edit"
          element={
            <ProtectedRoute requiredRole={['farmer']}>
              <SurveyForm />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/farms/new"
          element={
            <ProtectedRoute requiredRole={['farmer']}>
              <AddFarm />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/market"
          element={
            <ProtectedRoute requiredRole={['farmer']}>
              <MarketPrices />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/community"
          element={
            <ProtectedRoute requiredRole={['farmer']}>
              <ChatBox />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/report"
          element={
            <ProtectedRoute requiredRole={['farmer']}>
              <ReportProblem />
            </ProtectedRoute>
          }
        />
        <Route
          path="/farmer/requests"
          element={
            <ProtectedRoute requiredRole={['farmer']}>
              <MyRequests />
            </ProtectedRoute>
          }
        />

        {/* Trader Routes */}
        <Route
          path="/trader/dashboard"
          element={
            <ProtectedRoute requiredRole={['trader']}>
              <TraderDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trader/requirements"
          element={
            <ProtectedRoute requiredRole={['trader', 'farmer']}>
              <BuyingRequirements />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trader/requirements/create"
          element={
            <ProtectedRoute requiredRole={['trader']}>
              <CreateRequirement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trader/requirements/:id"
          element={
            <ProtectedRoute requiredRole={['trader', 'farmer']}>
              <RequirementDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trader/report"
          element={
            <ProtectedRoute requiredRole={['trader']}>
              <ReportProblem />
            </ProtectedRoute>
          }
        />

        {/* Officer Routes */}
        <Route
          path="/officer/dashboard"
          element={
            <ProtectedRoute requiredRole={['surveyor']}>
              <OfficerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/officer/surveys"
          element={
            <ProtectedRoute requiredRole={['surveyor']}>
              <PendingSurveys />
            </ProtectedRoute>
          }
        />
        <Route
          path="/officer/census"
          element={
            <ProtectedRoute requiredRole={['surveyor']}>
              <OfficerCensus />
            </ProtectedRoute>
          }
        />
        <Route
          path="/officer/reports"
          element={
            <ProtectedRoute requiredRole={['surveyor']}>
              <OfficerReports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/officer/market"
          element={
            <ProtectedRoute requiredRole={['surveyor']}>
              <OfficerMarketPrices />
            </ProtectedRoute>
          }
        />

        {/* Admin Routes */}
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute requiredRole={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/census"
          element={
            <ProtectedRoute requiredRole={['admin']}>
              <AdminCensus />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/officers/new"
          element={
            <ProtectedRoute requiredRole={['admin']}>
              <CreateOfficer />
            </ProtectedRoute>
          }
        />

        {/* Default Routes */}
        <Route path="/" element={<RootRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
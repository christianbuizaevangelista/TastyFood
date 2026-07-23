import { Routes, Route, Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { canAccessPath, canAccessFinance, canAccessMarketing, canAccessHr, firstAccessiblePath } from './lib/nav';
import Layout from './components/Layout';
import FinanceLayout from './components/FinanceLayout';
import MarketingLayout from './components/MarketingLayout';
import HrLayout from './components/HrLayout';
import { Spinner } from './components/ui';

import Login from './pages/Login';
import SetPassword from './pages/SetPassword';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import PurchaseOrders from './pages/PurchaseOrders';
import POS from './pages/POS';
import SalesReport from './pages/SalesReport';
import Kpi from './pages/Kpi';
import Crm from './pages/Crm';
import Products from './pages/Products';
import Account from './pages/Account';
import Structure from './pages/Structure';
import Mana from './pages/Mana';
import Materials from './pages/Materials';
import Customers from './pages/Customers';
import Referrals from './pages/Referrals';
import { Reports, Journal, ChartOfAccounts } from './pages/Accounting';
import DistributorFinancials from './pages/DistributorFinancials';
import FinanceDashboard from './pages/FinanceDashboard';
import AgingReport from './pages/AgingReport';
import Budget from './pages/Budget';
import ResellerSale from './pages/ResellerSale';
import FacebookAds from './pages/FacebookAds';
import AdManager from './pages/AdManager';
import LeadFunnels from './pages/LeadFunnels';
import Applications from './pages/Applications';
import LandingPage from './pages/LandingPage';
import Join from './pages/Join';
import Apply from './pages/Apply';
import ApplyStatus from './pages/ApplyStatus';
import Track from './pages/Track';
import Shop from './pages/Shop';
import ShopOrder from './pages/ShopOrder';
import ShopOrders from './pages/ShopOrders';
import ShopSettings from './pages/ShopSettings';
import Concerns from './pages/Concerns';
import { HrDashboard, Employees, Attendance, Leave, Payroll } from './pages/Hr';
import Users from './pages/Users';

// Guards a route by the user's role + permissions (path matched against NAV).
function Protected({ children, path }: { children: ReactNode; path: string }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessPath(user, path)) {
    const home = firstAccessiblePath(user);
    return <Navigate to={home === path ? '/account' : home} replace />;
  }
  return <Layout>{children}</Layout>;
}

// The root is the front door for two different people. A signed-in distributor
// wants their dashboard; everyone else — someone who saw an ad, or who lost the
// email holding their application link — should meet the public landing page
// rather than a login screen they cannot get past. Waiting on `loading` first
// keeps either audience from seeing the wrong page flash by.
function Root() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Join />;
  return <Protected path="/"><Dashboard /></Protected>;
}

// Guards the separate Finance & Accounting workspace (Principal + accounting access).
function FinanceProtected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessFinance(user)) return <Navigate to={firstAccessiblePath(user)} replace />;
  return <FinanceLayout>{children}</FinanceLayout>;
}

// Guards the separate Marketing System workspace (Principal + marketing access).
function MarketingProtected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessMarketing(user)) return <Navigate to={firstAccessiblePath(user)} replace />;
  return <MarketingLayout>{children}</MarketingLayout>;
}

// Guards the separate HR System workspace (Principal + hr access).
function HrProtected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessHr(user)) return <Navigate to={firstAccessiblePath(user)} replace />;
  return <HrLayout>{children}</HrLayout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/set-password" element={<SetPassword />} />
      {/* Public recruitment landing page — no login, this is where ads point. */}
      <Route path="/join" element={<Join />} />
      <Route path="/apply" element={<Apply />} />
      <Route path="/apply/status/:token" element={<ApplyStatus />} />
      <Route path="/track" element={<Track />} />
      <Route path="/shop" element={<Shop />} />
      <Route path="/shop/order/:code" element={<ShopOrder />} />
      <Route path="/home" element={<Home />} />
      <Route path="/" element={<Root />} />
      <Route path="/inventory" element={<Protected path="/inventory"><Inventory /></Protected>} />
      <Route path="/purchase-orders" element={<Protected path="/purchase-orders"><PurchaseOrders /></Protected>} />
      <Route path="/pos" element={<Protected path="/pos"><POS /></Protected>} />
      <Route path="/sales" element={<Protected path="/sales"><SalesReport /></Protected>} />
      <Route path="/kpi" element={<Protected path="/kpi"><Kpi /></Protected>} />
      <Route path="/crm" element={<Protected path="/crm"><Crm /></Protected>} />
      <Route path="/products" element={<Protected path="/products"><Products /></Protected>} />
      <Route path="/structure" element={<Protected path="/structure"><Structure /></Protected>} />
      <Route path="/mana" element={<Protected path="/mana"><Mana /></Protected>} />
      <Route path="/materials" element={<Protected path="/materials"><Materials /></Protected>} />
      <Route path="/sell" element={<Protected path="/sell"><ResellerSale /></Protected>} />
      <Route path="/customers" element={<Protected path="/customers"><Customers /></Protected>} />
      <Route path="/referrals" element={<Protected path="/referrals"><Referrals /></Protected>} />
      <Route path="/online-shop" element={<Protected path="/online-shop"><ShopOrders /></Protected>} />
      <Route path="/finance" element={<FinanceProtected><FinanceDashboard /></FinanceProtected>} />
      <Route path="/finance/reports" element={<FinanceProtected><Reports /></FinanceProtected>} />
      <Route path="/finance/budget" element={<FinanceProtected><Budget /></FinanceProtected>} />
      <Route path="/finance/journal" element={<FinanceProtected><Journal /></FinanceProtected>} />
      <Route path="/finance/distributors" element={<FinanceProtected><DistributorFinancials /></FinanceProtected>} />
      <Route path="/finance/aging" element={<FinanceProtected><AgingReport /></FinanceProtected>} />
      <Route path="/finance/accounts" element={<FinanceProtected><ChartOfAccounts /></FinanceProtected>} />
      <Route path="/marketing" element={<Navigate to="/marketing/facebook-ads" replace />} />
      <Route path="/marketing/facebook-ads" element={<MarketingProtected><FacebookAds /></MarketingProtected>} />
      <Route path="/marketing/ad-manager" element={<MarketingProtected><AdManager /></MarketingProtected>} />
      <Route path="/marketing/lead-funnels" element={<MarketingProtected><LeadFunnels /></MarketingProtected>} />
      <Route path="/marketing/applications" element={<MarketingProtected><Applications /></MarketingProtected>} />
      <Route path="/marketing/shop" element={<MarketingProtected><ShopSettings /></MarketingProtected>} />
      <Route path="/marketing/landing-page" element={<MarketingProtected><LandingPage /></MarketingProtected>} />
      <Route path="/hr" element={<HrProtected><HrDashboard /></HrProtected>} />
      <Route path="/hr/employees" element={<HrProtected><Employees /></HrProtected>} />
      <Route path="/hr/attendance" element={<HrProtected><Attendance /></HrProtected>} />
      <Route path="/hr/leave" element={<HrProtected><Leave /></HrProtected>} />
      <Route path="/hr/payroll" element={<HrProtected><Payroll /></HrProtected>} />
      <Route path="/users" element={<Protected path="/users"><Users /></Protected>} />
      <Route path="/concerns" element={<Protected path="/concerns"><Concerns /></Protected>} />
      <Route path="/account" element={<Protected path="/account"><Account /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

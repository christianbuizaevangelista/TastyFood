import { Routes, Route, Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { canAccessPath, canAccessFinance, firstAccessiblePath } from './lib/nav';
import Layout from './components/Layout';
import FinanceLayout from './components/FinanceLayout';
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
import RetailDistributors from './pages/RetailDistributors';
import ResellerSale from './pages/ResellerSale';
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

// Guards the separate Finance & Accounting workspace (Principal + accounting access).
function FinanceProtected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessFinance(user)) return <Navigate to={firstAccessiblePath(user)} replace />;
  return <FinanceLayout>{children}</FinanceLayout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/set-password" element={<SetPassword />} />
      <Route path="/home" element={<Home />} />
      <Route path="/" element={<Protected path="/"><Dashboard /></Protected>} />
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
      <Route path="/finance" element={<FinanceProtected><Reports /></FinanceProtected>} />
      <Route path="/finance/journal" element={<FinanceProtected><Journal /></FinanceProtected>} />
      <Route path="/finance/retail" element={<FinanceProtected><RetailDistributors /></FinanceProtected>} />
      <Route path="/finance/accounts" element={<FinanceProtected><ChartOfAccounts /></FinanceProtected>} />
      <Route path="/users" element={<Protected path="/users"><Users /></Protected>} />
      <Route path="/account" element={<Protected path="/account"><Account /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

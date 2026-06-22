import { Routes, Route, Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { Role } from './types';
import Layout from './components/Layout';
import { Spinner } from './components/ui';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import PurchaseOrders from './pages/PurchaseOrders';
import POS from './pages/POS';
import SalesReport from './pages/SalesReport';
import Kpi from './pages/Kpi';
import Crm from './pages/Crm';
import Approvals from './pages/Approvals';
import Products from './pages/Products';
import Account from './pages/Account';
import Structure from './pages/Structure';
import Mana from './pages/Mana';

function Protected({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/inventory" element={<Protected><Inventory /></Protected>} />
      <Route path="/purchase-orders" element={<Protected><PurchaseOrders /></Protected>} />
      <Route
        path="/pos"
        element={
          <Protected roles={['PROVINCIAL', 'CITY', 'RESELLER']}>
            <POS />
          </Protected>
        }
      />
      <Route path="/sales" element={<Protected><SalesReport /></Protected>} />
      <Route
        path="/kpi"
        element={
          <Protected roles={['PRINCIPAL', 'PROVINCIAL', 'CITY']}>
            <Kpi />
          </Protected>
        }
      />
      <Route
        path="/crm"
        element={
          <Protected roles={['PRINCIPAL', 'PROVINCIAL', 'CITY']}>
            <Crm />
          </Protected>
        }
      />
      <Route
        path="/approvals"
        element={
          <Protected roles={['PRINCIPAL', 'PROVINCIAL']}>
            <Approvals />
          </Protected>
        }
      />
      <Route
        path="/products"
        element={
          <Protected roles={['PRINCIPAL']}>
            <Products />
          </Protected>
        }
      />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/structure" element={<Protected><Structure /></Protected>} />
      <Route path="/mana" element={<Protected><Mana /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

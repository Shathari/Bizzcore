import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./components/Toast";
import { RequireAuth } from "./components/RequireAuth";
import { FullScreenSpinner } from "./components/FullScreenSpinner";
import { SuperAdminShell } from "./components/SuperAdminShell";
import { TenantShell } from "./components/TenantShell";
import Landing from "./pages/Landing";
import Privacy from "./pages/Privacy";
import DataDeletion from "./pages/DataDeletion";
import Terms from "./pages/Terms";
import Security from "./pages/Security";
import Status from "./pages/Status";
import ConsentPage from "./pages/public/ConsentPage";
import Login from "./pages/tenant/Login";
import ForgotPassword from "./pages/tenant/ForgotPassword";
import ResetPassword from "./pages/tenant/ResetPassword";
import ChangePassword from "./pages/tenant/ChangePassword";
import Home from "./pages/tenant/Home";
import Customers from "./pages/tenant/Customers";
import BookingRequests from "./pages/tenant/BookingRequests";
import Communication from "./pages/tenant/Communication";
import Website from "./pages/tenant/Website";
import SocialMedia from "./pages/tenant/SocialMedia";
import AIAssistant from "./pages/tenant/AIAssistant";
import ContentResearchLab from "./pages/tenant/ContentResearchLab";
import Subscription from "./pages/tenant/Subscription";
import Settings from "./pages/tenant/Settings";
import Businesses from "./pages/super-admin/Businesses";
import AddBusiness from "./pages/super-admin/AddBusiness";
import BusinessDetail from "./pages/super-admin/BusinessDetail";
import AuditLog from "./pages/super-admin/AuditLog";
import FeatureCatalog from "./pages/super-admin/FeatureCatalog";
import CustomDevelopmentQueue from "./pages/super-admin/CustomDevelopmentQueue";
import Plans from "./pages/super-admin/Plans";
import PlanDetail from "./pages/super-admin/PlanDetail";

// Catch-all for unmatched paths — sends a logged-in user back to their own
// area (never the public landing page they've already passed) and an
// unauthenticated visitor to the landing page (which itself offers sign-in).
function NotFoundRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/" replace />;
  return <Navigate to={user.role === "SUPER_ADMIN" ? "/super-admin" : "/dashboard"} replace />;
}

function TenantHome() {
  const { user } = useAuth();
  return user?.role === "EMPLOYEE" ? <Navigate to="/dashboard/customers" replace /> : <Home />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/data-deletion" element={<DataDeletion />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/security" element={<Security />} />
            <Route path="/status" element={<Status />} />
            <Route path="/consent/:token" element={<ConsentPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/change-password" element={<ChangePassword />} />

            <Route
              path="/super-admin"
              element={
                <RequireAuth role="SUPER_ADMIN">
                  <SuperAdminShell />
                </RequireAuth>
              }
            >
              <Route index element={<Businesses />} />
              <Route path="new" element={<AddBusiness />} />
              <Route path="businesses/:id" element={<BusinessDetail />} />
              <Route path="businesses/:id/feature-catalog" element={<FeatureCatalog />} />
              <Route path="plans" element={<Plans />} />
              <Route path="plans/:id" element={<PlanDetail />} />
              <Route path="custom-development" element={<CustomDevelopmentQueue />} />
              <Route path="audit-log" element={<AuditLog />} />
            </Route>

            <Route
              path="/dashboard"
              element={
                <RequireAuth role={["ADMIN", "EMPLOYEE"]}>
                  <TenantShell />
                </RequireAuth>
              }
            >
              <Route index element={<TenantHome />} />
              <Route path="customers" element={<Customers />} />
              <Route element={<RequireAuth role="ADMIN"><Outlet /></RequireAuth>}>
              <Route path="booking-requests" element={<BookingRequests />} />
              <Route path="communication" element={<Communication />} />
              <Route path="website" element={<Website />} />
              <Route path="social-media" element={<SocialMedia />} />
              <Route path="ai-assistant" element={<AIAssistant />} />
              <Route path="content-research-lab" element={<ContentResearchLab />} />
              <Route path="subscription" element={<Subscription />} />
              <Route path="settings" element={<Settings />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFoundRedirect />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

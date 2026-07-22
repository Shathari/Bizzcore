import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { FullScreenSpinner } from "../../components/FullScreenSpinner";
import { AuthLayout } from "../../components/AuthLayout";
import { SignInForm } from "../../components/SignInForm";

// Bare sign-in page — still the redirect target RequireAuth sends an
// unauthenticated visitor to from any protected route (see
// components/RequireAuth.tsx). The public marketing landing page
// (pages/Landing.tsx) embeds the same SignInForm directly as its "central
// login box," for a visitor who lands on "/" first instead.
export default function Login() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || !user) return;
    if (user.mustChangePassword) {
      navigate("/change-password", { replace: true });
    } else if (user.role === "SUPER_ADMIN") {
      navigate("/super-admin", { replace: true, state: { welcome: true } });
    } else {
      navigate("/dashboard", { replace: true, state: { welcome: true, businessName: user.businessName } });
    }
  }, [user, authLoading, navigate]);

  if (authLoading || user) {
    return <FullScreenSpinner />;
  }

  return (
    <AuthLayout>
      <SignInForm />
    </AuthLayout>
  );
}

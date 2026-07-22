import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="flex items-center justify-end border-b border-neutral-200 bg-white px-8 py-4">
      <div className="flex items-center gap-4">
        {user?.logoUrl ? (
          <img src={user.logoUrl} alt="" className="h-9 w-9 rounded-full object-cover border border-neutral-200" />
        ) : (
          user?.businessName && (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-maroon/10 font-serif text-sm text-maroon">
              {user.businessName.charAt(0).toUpperCase()}
            </div>
          )
        )}
        <div className="text-right">
          <p className="text-sm font-medium text-neutral-800">{user?.name}</p>
          <p className="text-xs text-neutral-500">{user?.businessName}</p>
        </div>
        <button
          onClick={() => logout().then(() => navigate("/login"))}
          className="text-neutral-400 hover:text-maroon"
          aria-label="Sign out"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}

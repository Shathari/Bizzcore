import axios from "axios";

// withCredentials so the httpOnly session cookie is sent on every request —
// this app never stores or reads the JWT itself, the cookie does the work.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  withCredentials: true,
});

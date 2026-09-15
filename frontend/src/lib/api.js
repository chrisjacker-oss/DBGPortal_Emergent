import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const api = axios.create({ baseURL: API, withCredentials: true });

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") {
    if (detail.includes("<") && detail.includes(">")) return "Service temporarily unavailable. Please try again shortly.";
    return detail;
  }
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export const currency = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n || 0));

export function carrierInfo(raw) {
  const t = String(raw || "").replace(/\s+/g, "").toUpperCase();
  if (!t) return null;
  if (t.startsWith("1Z")) return { carrier: "UPS", url: `https://www.ups.com/track?tracknum=${t}` };
  if (/^\d+$/.test(t)) {
    if (t.length >= 20 || ["94", "93", "92", "91"].includes(t.slice(0, 2)) || t.startsWith("420"))
      return { carrier: "USPS", url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}` };
    if (t.length === 10) return { carrier: "DHL", url: `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${t}` };
    if (t.length === 12 || t.length === 15) return { carrier: "FedEx", url: `https://www.fedex.com/fedextrack/?trknbr=${t}` };
  }
  return { carrier: "Track", url: `https://www.google.com/search?q=${encodeURIComponent(t)}` };
}

export default api;

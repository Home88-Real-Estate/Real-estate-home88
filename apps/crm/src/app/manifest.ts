import type { MetadataRoute } from "next";

import { CRM_BASE_PATH } from "@/lib/paths";

/**
 * Makes the CRM installable ("Προσθήκη στην αρχική οθόνη"). The app opens on
 * the dashboard and stays inside the CRM's base path; the shortcuts are the
 * actions an agent starts from a phone.
 */
export default function manifest(): MetadataRoute.Manifest {
  const base = CRM_BASE_PATH;
  return {
    id: `${base}/`,
    name: "HOME88 CRM",
    short_name: "HOME88",
    description: "Ακίνητα, πελάτες, ραντεβού και φωνητική καταχώριση ακινήτων του γραφείου HOME88.",
    lang: "el",
    dir: "ltr",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#f6f9fc",
    theme_color: "#062b46",
    icons: [
      { src: `${base}/pwa/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/pwa/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/pwa/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Νέο ακίνητο", short_name: "Νέο ακίνητο", url: `${base}/properties/new/assistant`, icons: [{ src: `${base}/pwa/icon-192.png`, sizes: "192x192" }] },
      { name: "Εκτός σύνδεσης", short_name: "Εκτός σύνδεσης", url: `${base}/offline` },
      { name: "Ημερολόγιο", url: `${base}/calendar` },
    ],
  };
}

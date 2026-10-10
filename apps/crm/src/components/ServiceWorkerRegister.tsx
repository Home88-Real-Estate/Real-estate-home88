"use client";

import { useEffect } from "react";

import { CRM_BASE_PATH } from "@/lib/paths";

/**
 * Registers the CRM's service worker (installable app, offline page, cached build files). Production builds
 * only, unless NEXT_PUBLIC_SW_DEV=1: in development its cached files would hide code changes.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW_DEV !== "1") return;
    navigator.serviceWorker.register(`${CRM_BASE_PATH}/sw.js`, { scope: `${CRM_BASE_PATH}/` }).catch(() => undefined);
  }, []);
  return null;
}

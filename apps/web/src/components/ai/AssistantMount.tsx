"use client";

import dynamic from "next/dynamic";

/** Loaded after hydration, so the chat adds nothing to the first paint of any page. */
const AssistantWidget = dynamic(() => import("./AssistantWidget"), { ssr: false });

export function AssistantMount() {
  return <AssistantWidget />;
}

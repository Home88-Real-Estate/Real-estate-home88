import type { Metadata } from "next";
import { settingsSection } from "@home88/domain";

import { SectionPage } from "@/components/settings/SectionPage";

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  return { title: settingsSection(section)?.title ?? "Ρυθμίσεις" };
}

export default async function SettingsSectionRoute({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <SectionPage sectionKey={section} />;
}

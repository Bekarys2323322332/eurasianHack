/**
 * Job page (/jobs/<id>). The server renders the current state once, then the
 * JobStatus component keeps it up to date in the browser.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JobStatus from "../../_components/JobStatus";
import styles from "../../_components/ui.module.css";
import { getJobView } from "../../_lib/jobView";
import { getPublicBaseUrl } from "../../../shared/publicUrl";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = getJobView((await params).id);
  return { title: view?.stepFile?.title ? `${view.stepFile.title} video` : "Your product video" };
}

export default async function JobPage({ params }: Props) {
  const view = getJobView((await params).id);
  if (!view) notFound();
  return (
    <main className={styles.page}>
      <Link href="/" className={styles.brand}>
        eurasianHack
      </Link>
      {/* PUBLIC_BASE_URL is read on the server and passed down for share links. */}
      <JobStatus initial={view} publicBaseUrl={getPublicBaseUrl()} />
    </main>
  );
}

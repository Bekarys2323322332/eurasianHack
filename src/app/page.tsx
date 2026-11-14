/**
 * Home page: one headline, one form, a short "How it works" strip and a small
 * gallery of finished videos. Rendered on the server on every request so the
 * gallery is always current.
 */
import Link from "next/link";
import JobForm from "./_components/JobForm";
import styles from "./_components/ui.module.css";
import { getJobView } from "./_lib/jobView";
import { resumePendingJobs } from "./_lib/pipeline";
import { listJobs } from "../shared/jobs";

export const dynamic = "force-dynamic";

/** The newest finished videos that have a picture to show. */
function galleryItems() {
  // Opening the home page after a restart also restarts any waiting jobs.
  resumePendingJobs();
  return listJobs({ status: "done", limit: 12 })
    .map((job) => getJobView(job.id))
    .filter((view) => view !== null && (view.videos.landscape ?? view.videos.vertical) !== null)
    .slice(0, 6);
}

const HOW_IT_WORKS = [
  { title: "Paste a link", text: "Any web page that opens without signing in." },
  { title: "We explore it", text: "An AI visitor clicks through it like a first-time user." },
  { title: "You get a video", text: "A short narrated video you can download and share." },
];

export default function Home() {
  const items = galleryItems();
  return (
    <main className={styles.page}>
      <Link href="/" className={styles.brand}>
        eurasianHack
      </Link>

      <section className={styles.hero}>
        <h1 className={styles.headline}>Paste a link. Get a video of your product in action.</h1>
        <p className={styles.subhead}>An AI visitor uses your product and films what it does. No setup needed.</p>
        <JobForm />
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" className={styles.sectionTitle}>
          How it works
        </h2>
        <ol className={styles.how}>
          {HOW_IT_WORKS.map((item, index) => (
            <li key={item.title} className={styles.howItem}>
              <span className={styles.howNumber}>{index + 1}</span>
              <span className={styles.howTitle}>{item.title}</span>
              <span className={styles.howText}>{item.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="gallery-title">
        <h2 id="gallery-title" className={styles.sectionTitle}>
          Recent videos
        </h2>
        {items.length === 0 ? (
          <p className={styles.galleryEmpty}>Finished videos will appear here. Make the first one above.</p>
        ) : (
          <ul className={styles.gallery}>
            {items.map((view) => {
              const title = view!.stepFile?.title || new URL(view!.job.url).hostname;
              return (
                <li key={view!.job.id}>
                  <Link href={`/jobs/${view!.job.id}`} className={styles.galleryItem}>
                    {view!.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- served by our own file route
                      <img className={styles.thumb} src={view!.thumbnail} alt={`First scene of the ${title} video`} />
                    ) : (
                      <div className={styles.thumb} aria-hidden="true" />
                    )}
                    <span className={styles.galleryTitle}>{title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

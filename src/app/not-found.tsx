/** Shown for unknown pages and for job links that do not exist. */
import Link from "next/link";
import styles from "./_components/ui.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.pageTitle}>We could not find that page</h1>
        <p className={styles.lead}>The link may be mistyped, or the video was made on a different computer.</p>
        <Link href="/" className={styles.primary}>
          Make a new video
        </Link>
      </section>
    </main>
  );
}

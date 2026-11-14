import styles from "./page.module.css";

/** Placeholder home page. The real home page is built in Prompt C. */
export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Agent-made product videos</h1>
      <p className={styles.status}>Skeleton is live</p>
    </main>
  );
}

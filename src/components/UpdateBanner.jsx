import styles from './UpdateBanner.module.css'

/** Shown when a newer build has been deployed while this tab was still open (a plain SPA doesn't pick up new code on its own). */
export default function UpdateBanner() {
  return (
    <div className={styles.banner}>
      <span>A newer version of this app is ready.</span>
      <button type="button" className={styles.btn} onClick={() => window.location.reload()}>Reload now</button>
    </div>
  )
}

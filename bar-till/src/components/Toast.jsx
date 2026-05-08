import styles from './Toast.module.css'

export default function Toast({ msg, visible }) {
  return (
    <div className={`${styles.toast} ${visible ? styles.show : ''}`}>
      {msg}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import styles from './StaffLog.module.css'

function onlyDigits4(value) {
  return (value || '').replace(/\D/g, '').slice(0, 4)
}

function isToday(d) {
  const now = new Date()
  const v = new Date(d)
  return v.getDate() === now.getDate() && v.getMonth() === now.getMonth() && v.getFullYear() === now.getFullYear()
}

function timeLabel(d) {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function StaffLog({
  staff,
  setStaff,
  currentlyIn,
  setCurrentlyIn,
  attendanceLog,
  clockInStaff,
  clockOutStaff,
  saveShiftLogForToday,
  currentStaff,
}) {
  const [selectedStaff, setSelectedStaff] = useState('')
  const [adminOpen, setAdminOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [msg, setMsg] = useState('')

  const staffList = useMemo(
    () => (staff || [])
      .map(s => (typeof s === 'string' ? { name: s, pin: '0000', role: 'staff' } : s))
      .filter(s => s && s.name),
    [staff]
  )
  const staffNames = useMemo(() => staffList.map(s => s.name), [staffList])
  const isManager = currentStaff === 'Manager'

  const [pinEdits, setPinEdits] = useState({})
  useEffect(() => {
    setPinEdits(Object.fromEntries(staffList.map(s => [s.name, s.pin || '0000'])))
  }, [staffList])

  const inNames = useMemo(() => new Set((currentlyIn || []).map(x => x.staffName)), [currentlyIn])

  const availableToClockIn = useMemo(
    () => staffNames.filter(name => !inNames.has(name)),
    [staffNames, inNames]
  )

  const todaysLog = useMemo(
    () => (attendanceLog || []).filter(e => isToday(e.time)).sort((a, b) => new Date(b.time) - new Date(a.time)),
    [attendanceLog],
  )

  const shiftSaved =
    todaysLog.length > 0 && todaysLog.every(e => e.saved === true)

  const addStaff = () => {
    const n = (newName || '').trim()
    const p = onlyDigits4(newPin)
    if (!n) return setMsg('Enter a name')
    if (p.length !== 4) return setMsg('PIN must be 4 digits')
    if (staffNames.some(name => name.toLowerCase() === n.toLowerCase())) return setMsg('Name already exists')
    setStaff(prev => [...(Array.isArray(prev) ? prev : []), { name: n, pin: p, role: 'staff' }])
    setNewName('')
    setNewPin('')
    setMsg('Staff member added')
  }

  const savePin = (name) => {
    const p = onlyDigits4(pinEdits[name] || '')
    if (p.length !== 4) return setMsg('PIN must be 4 digits')
    setStaff(prev => (Array.isArray(prev) ? prev : []).map(s => (s?.name === name ? { ...s, pin: p } : s)))
    setMsg('PIN updated')
  }

  const removeStaff = (name) => {
    setStaff(prev => (Array.isArray(prev) ? prev : []).filter(s => s?.name !== name))
    setCurrentlyIn(prev => (Array.isArray(prev) ? prev : []).filter(row => row.staffName !== name))
    setMsg('Staff member removed')
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <section className={styles.card}>
          <div className={styles.adminTopRow}>
            <h3 className={styles.title}>Staff admin</h3>
            {isManager && (
              <button className={styles.adminBtn} onClick={() => setAdminOpen(v => !v)}>
                {adminOpen ? 'Close admin' : 'Admin'}
              </button>
            )}
          </div>
          {adminOpen && isManager && (
            <div className={styles.adminPanel}>
              {msg && <div className={styles.adminMsg}>{msg}</div>}
              <div className={styles.adminSection}>
                <div className={styles.sectionLabel}>Add staff member</div>
                <div className={styles.adminAddRow}>
                  <input
                    className={styles.input}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Name"
                    autoComplete="off"
                  />
                  <input
                    className={styles.input}
                    value={newPin}
                    onChange={(e) => setNewPin(onlyDigits4(e.target.value))}
                    placeholder="4-digit PIN"
                    inputMode="numeric"
                    autoComplete="off"
                    type="password"
                  />
                  <button className={styles.clockInBtn} onClick={addStaff}>Add</button>
                </div>
              </div>

              <div className={styles.adminSection}>
                <div className={styles.sectionLabel}>Existing staff</div>
                <div className={styles.staffEditorList}>
                  {staffList.map(s => (
                    <div className={styles.staffEditRow} key={s.name}>
                      <div className={styles.staffEditName}>{s.name}</div>
                      <input
                        className={styles.input}
                        value={pinEdits[s.name] ?? ''}
                        onChange={(e) => {
                          const next = onlyDigits4(e.target.value)
                          setPinEdits(prev => ({ ...prev, [s.name]: next }))
                        }}
                        inputMode="numeric"
                        autoComplete="off"
                        type="password"
                      />
                      <button className={styles.clockInBtn} onClick={() => savePin(s.name)}>Save PIN</button>
                      <button className={styles.clockOutBtn} onClick={() => removeStaff(s.name)}>Remove</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h3 className={styles.title}>Who's in</h3>
          {(currentlyIn || []).length === 0 ? (
            <div className={styles.empty}>No staff currently clocked in.</div>
          ) : (
            <div className={styles.list}>
              {currentlyIn.map(row => (
                <div className={styles.row} key={row.staffName}>
                  <div>
                    <div className={styles.name}>{row.staffName}</div>
                    <div className={styles.meta}>Clocked in at {timeLabel(row.clockInTime)}</div>
                  </div>
                  <button className={styles.clockOutBtn} onClick={() => clockOutStaff(row.staffName)}>
                    Clock out
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.clockInArea}>
            <select
              className={styles.select}
              value={selectedStaff}
              onChange={(e) => setSelectedStaff(e.target.value)}
            >
              <option value="">Select staff member</option>
              {availableToClockIn.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button
              className={styles.clockInBtn}
              onClick={() => {
                if (!selectedStaff) return
                clockInStaff(selectedStaff)
                setSelectedStaff('')
              }}
              disabled={!selectedStaff}
            >
              Clock in
            </button>
          </div>
        </section>

        <section className={styles.card}>
          <h3 className={styles.title}>Today's log</h3>
          {shiftSaved && (
            <div className={styles.shiftSavedBanner}>Shift saved ✓</div>
          )}
          {todaysLog.length === 0 ? (
            <div className={styles.empty}>No attendance entries yet today.</div>
          ) : (
            <div className={styles.logList}>
              {todaysLog.map(entry => (
                <div className={styles.logRow} key={entry.id}>
                  <span className={styles.logName}>{entry.staffName}</span>
                  <span className={entry.action === 'clock_in' ? styles.badgeIn : styles.badgeOut}>
                    {entry.action === 'clock_in' ? 'Clocked in' : 'Clocked out'}
                  </span>
                  <span className={styles.logTime}>{timeLabel(entry.time)}</span>
                </div>
              ))}
            </div>
          )}
          <div className={styles.saveShiftWrap}>
            <button type="button" className={styles.saveShiftBtn} onClick={saveShiftLogForToday}>
              Save shift log
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

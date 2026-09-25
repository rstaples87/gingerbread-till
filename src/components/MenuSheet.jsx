import { useMemo } from 'react'
import { MENU_ART, MENU_LOGO_SRC, itemPriceText, headingText } from '../menuDoc'
import styles from './MenuSheet.module.css'

const ROW_ALIGN = { middle: 'center', bottom: 'end' }
const lines = (s) => String(s ?? '').split('\n')

function Diet({ codes, style }) {
  if (!codes?.length) return null
  if (style === 'muted') return <span className={styles.dietMuted}> ({codes.join(' ')})</span>
  return (
    <>
      {' '}
      {codes.map(c => (
        <span key={c} className={c === 'V' ? styles.dietV : c === 'VG' ? styles.dietVG : styles.dietOther}>{c} </span>
      ))}
    </>
  )
}

const ptStyle = (pt) => (Number(pt) > 0 ? { fontSize: `${Number(pt)}pt` } : undefined)

function Item({ item, block, doc, productById }) {
  const sz = ptStyle(item.fontSize)
  if (item.kind === 'heading') return <div className={styles.subheading} style={sz}>{item.name}</div>
  if (item.kind === 'note') return <div className={styles.noteLine} style={sz}>{lines(item.desc).map((l, i) => <div key={i}>{l}</div>)}</div>
  const price = itemPriceText(item, productById, doc.priceFormat)
  const right = block.priceLayout === 'right'
  const nameEl = <span className={item.plain ? styles.namePlain : styles.name}>{item.name}</span>
  return (
    <div className={`${styles.item} ${item.plain && !item.desc ? styles.itemCompact : ''}`} style={sz}>
      {right ? (
        <div className={styles.nameRow}>
          <span>{nameEl}<Diet codes={item.diet} style={doc.dietaryStyle} /></span>
          {price && <span className={styles.priceRight}>{price}</span>}
        </div>
      ) : (
        <div>{nameEl}{price && <span className={item.plain ? styles.namePlain : styles.name}> - {price}</span>}<Diet codes={item.diet} style={doc.dietaryStyle} /></div>
      )}
      {item.desc && <div className={styles.desc}>{lines(item.desc).map((l, i) => <div key={i}>{l}</div>)}</div>}
    </div>
  )
}

function Block({ block, doc, productById }) {
  if (block.type === 'logo') {
    return <div className={styles.center}><img className={styles.logoImg} style={{ width: `${block.width ?? 100}%` }} src={MENU_LOGO_SRC} alt="The Haywain" /></div>
  }
  if (block.type === 'image') {
    const art = MENU_ART[block.art]
    if (!art) return null
    const c = art.crop
    return (
      <div className={styles.center}>
        <div className={styles.artFrame} style={{ width: `${block.width ?? 100}%`, aspectRatio: c ? `${c.w} / ${c.h}` : `${art.w} / ${art.h}` }}>
          <img
            src={art.src}
            alt=""
            className={styles.artImg}
            style={c
              ? { width: `${(art.w / c.w) * 100}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%` }
              : { width: '100%', left: 0, top: 0 }}
          />
        </div>
      </div>
    )
  }
  const cls = [styles.block, block.boxed ? styles.boxed : '', block.align === 'center' ? styles.center : ''].filter(Boolean).join(' ')
  if (block.type === 'text') {
    return <div className={cls} style={ptStyle(block.fontSize)}><div className={block.bold ? styles.name : ''}>{lines(block.text).map((l, i) => <div key={i}>{l}</div>)}</div></div>
  }
  const hp = headingText(block, productById, doc.priceFormat)
  const title = block.title ? `${block.title}${hp ? ` - ${hp}` : ''}` : ''
  if (block.sideTitle) {
    return (
      <div className={styles.sideBlock} style={ptStyle(block.fontSize)}>
        <div className={styles.sideTitle}>{block.title}</div>
        <div className={`${styles.sideBody} ${styles.center}`}>
          {lines(block.note).filter(Boolean).map((l, i) => <div key={i} className={styles.noteLine}>{l}</div>)}
          {(block.items ?? []).map(it => <Item key={it.id} item={it} block={block} doc={doc} productById={productById} />)}
        </div>
      </div>
    )
  }
  return (
    <div className={cls} style={ptStyle(block.fontSize)}>
      {title && <div className={styles.title}>{title}</div>}
      {block.note && <div className={styles.noteLine}>{lines(block.note).map((l, i) => <div key={i}>{l}</div>)}</div>}
      <div className={block.itemColumns === 2 ? styles.twoCol : undefined}>
        {(block.items ?? []).map(it => <Item key={it.id} item={it} block={block} doc={doc} productById={productById} />)}
      </div>
    </div>
  )
}

/** One printable menu at true paper size (A4). Used for the on-screen preview (scaled) and for printing. */
export default function MenuSheet({ doc, products, sheetRef }) {
  const productById = useMemo(() => new Map((products ?? []).map(p => [Number(p.id), p])), [products])
  const h = doc.header ?? {}
  const landscape = doc.orientation === 'landscape'
  const logo = h.logo && h.logo !== 'none'
  const titleLines = lines(h.title).filter(Boolean)
  const textLines = lines(h.text).filter(Boolean)
  const logoEl = logo ? <img className={styles.headerLogo} src={MENU_LOGO_SRC} alt="The Haywain" /> : null
  const textEl = textLines.length > 0 ? <div className={styles.headerText}>{textLines.map((l, i) => <div key={i}>{l}</div>)}</div> : null
  const sideBySide = (h.logo === 'left' || h.logo === 'right') || (!logo && textEl)

  return (
    <div
      ref={sheetRef}
      className={`${styles.sheet} ${landscape ? styles.landscape : styles.portrait}`}
      style={{ '--fs': `${doc.fontSize || 10.5}pt` }}
    >
      {titleLines.length > 0 && (
        <div className={h.titleStyle === 'hand' ? styles.titleHand : styles.titlePlain}>
          {titleLines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      {sideBySide ? (
        <div className={styles.headerRow}>
          {h.logo === 'right' ? <>{textEl || <div />}{logoEl}</> : <>{logoEl || <div />}{textEl}</>}
        </div>
      ) : (logo || textEl) ? (
        <div className={styles.headerCenter}>{logoEl}{textEl}</div>
      ) : null}

      {(doc.rows ?? []).map(row => (
        <div key={row.id} className={styles.row} style={{ '--cols': row.cols.length, ...(row.widths ? { gridTemplateColumns: row.widths } : {}), ...(ROW_ALIGN[row.valign] ? { alignItems: ROW_ALIGN[row.valign] } : {}) }}>
          {row.cols.map((col, ci) => (
            <div key={ci} className={styles.col}>
              {col.map(b => <Block key={b.id} block={b} doc={doc} productById={productById} />)}
            </div>
          ))}
        </div>
      ))}

      {doc.footer && <div className={styles.footer}>{lines(doc.footer).map((l, i) => <div key={i}>{l}</div>)}</div>}
    </div>
  )
}

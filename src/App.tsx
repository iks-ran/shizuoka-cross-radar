import { useEffect, useMemo, useState } from 'react'
import { loadStaticData, type StaticData } from './data'
import { formationAtStation } from './domain/classification'
import { searchUpcomingTrains, stationName } from './domain/search'
import {
  formatUpdatedAt,
  getTokyoTime,
  isLatestStale,
  isTokyoWeekend,
} from './domain/time'
import { detectLocale, intlLocale, translate, type MessageKey } from './i18n'
import type { FormationSummary, Locale, SearchResult, Station } from './types'

const LANGUAGE_STORAGE_KEY = 'shizuoka-cross-seat-radar-language'

const initialLocale = (): Locale => {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return stored === 'ja' || stored === 'en' || stored === 'zh-CN' ? stored : detectLocale()
}

const seatMessage: Record<FormationSummary['status'], MessageKey> = {
  full_convertible: 'fullConvertible',
  partial_cross: 'partialCross',
  box_fixed: 'boxFixed',
  all_longitudinal: 'allLongitudinal',
  unknown: 'unknown',
}

const stopTime = (clock: string | null, dayOffset: number): string =>
  clock === null ? '—' : `${clock}${dayOffset > 0 ? ` (+${dayOffset})` : ''}`

interface TrainCardProps {
  result: SearchResult
  summary: FormationSummary
  stations: Station[]
  locale: Locale
  data: StaticData
  stale: boolean
}

function TrainCard({ result, summary, stations, locale, data, stale }: TrainCardProps) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values)
  const trainDestination = stationName(stations, result.service.destinationStationId, locale)
  const arrivalStation = stationName(stations, result.arrivalStop.stationId, locale)
  const originStation = stationName(stations, result.originStop.stationId, locale)
  const formationLabel = summary.currentUnits.length > 0 ? summary.currentUnits.join(' + ') : summary.rawFormation || '—'
  const statusText = t(seatMessage[summary.status])

  return (
    <article className="train-card">
      <div className="time-row">
        <time className="departure-time" dateTime={result.originStop.departure ?? undefined}>
          {stopTime(result.originStop.departure, result.originStop.dayOffset)}
        </time>
        <span className="time-arrow" aria-hidden="true">→</span>
        <time className="arrival-time" dateTime={result.arrivalStop.arrival ?? undefined}>
          {stopTime(result.arrivalStop.arrival, result.arrivalStop.dayOffset)}
        </time>
      </div>

      <div className="service-row">
        <strong>{result.service.trainNumber}</strong>
        <span aria-hidden="true">·</span>
        <span>{t('forDestination', { station: trainDestination })}</span>
      </div>

      {result.transferRequired && (
        <p className="transfer-note">
          <span aria-hidden="true">↳</span> {t('transferRequired', { station: arrivalStation })}
        </p>
      )}

      <div className={`seat-status status-${summary.status}`}>
        <span className="status-mark" aria-hidden="true" />
        <div>
          <h3>{statusText}</h3>
          <p>
            {summary.crossSeatCarCount !== null && summary.totalCarCount !== null
              ? t('carCount', { cross: summary.crossSeatCarCount, total: summary.totalCarCount })
              : t('unknown')}
          </p>
        </div>
      </div>

      <div className="formation-row">
        <span>{t('formation', { station: originStation })}</span>
        <strong>{formationLabel}</strong>
      </div>

      <div className="freshness-row">
        <span>{t('updated', { time: data.latest ? formatUpdatedAt(data.latest.updatedAt, intlLocale(locale)) : '—' })}</span>
        {data.latest?.source.isMock && <span className="mini-badge">{t('fixture')}</span>}
        {stale && <span className="stale-badge">{t('stale')}</span>}
      </div>
    </article>
  )
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [data, setData] = useState<StaticData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [origin, setOrigin] = useState('hamamatsu')
  const [destination, setDestination] = useState('shizuoka')
  const [departureTime, setDepartureTime] = useState(getTokyoTime)
  const [visibleCount, setVisibleCount] = useState(5)
  const [nowTick, setNowTick] = useState(() => new Date())
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values)

  useEffect(() => {
    let active = true
    loadStaticData()
      .then((loaded) => {
        if (active) setData(loaded)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
    document.documentElement.lang = locale
    document.title = t('title')
  }, [locale]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => setVisibleCount(5), [origin, destination, departureTime])

  const sameStation = origin === destination
  const results = useMemo(
    () =>
      data && !sameStation
        ? searchUpcomingTrains(data.timetable, origin, destination, departureTime, isTokyoWeekend(nowTick))
        : [],
    [data, origin, destination, departureTime, sameStation, nowTick],
  )
  const stale = isLatestStale(data?.latest ?? null, nowTick)

  const swapStations = () => {
    setOrigin(destination)
    setDestination(origin)
  }

  if (loadError) {
    return (
      <main className="shell state-shell">
        <h1>{t('title')}</h1>
        <p role="alert">{t('dataError')}</p>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="shell state-shell">
        <div className="loading-dot" aria-hidden="true" />
        <p role="status">{t('loading')}</p>
      </main>
    )
  }

  const isDemo = data.timetable.isFixture || data.latest?.source.isMock

  return (
    <div className="page">
      <header className="site-header">
        <div>
          <p className="eyebrow">JR CENTRAL · CA</p>
          <h1>{t('title')}</h1>
          <p className="subtitle">{t('subtitle')}</p>
        </div>
        <nav className="language-switcher" aria-label="Language">
          {([
            ['ja', '日本語'],
            ['en', 'EN'],
            ['zh-CN', '简中'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={locale === value ? 'active' : ''}
              aria-pressed={locale === value}
              onClick={() => setLocale(value)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="shell">
        {isDemo && (
          <aside className="demo-banner" role="note">
            <span className="demo-icon" aria-hidden="true">!</span>
            <div>
              <strong>{t('demoTitle')}</strong>
              <p>{t('demoBody')}</p>
            </div>
          </aside>
        )}

        <section className="search-panel" aria-label={t('upcoming')}>
          <div className="station-fields">
            <label>
              <span>{t('departureStation')}</span>
              <select value={origin} onChange={(event) => setOrigin(event.target.value)}>
                {data.timetable.stations.map((station) => (
                  <option key={station.id} value={station.id}>
                    {stationName(data.timetable.stations, station.id, locale)}
                  </option>
                ))}
              </select>
            </label>

            <button className="swap-button" type="button" onClick={swapStations} aria-label={t('swap')} title={t('swap')}>
              <span aria-hidden="true">⇄</span>
            </button>

            <label>
              <span>{t('destinationStation')}</span>
              <select value={destination} onChange={(event) => setDestination(event.target.value)}>
                {data.timetable.stations.map((station) => (
                  <option key={station.id} value={station.id}>
                    {stationName(data.timetable.stations, station.id, locale)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="time-field">
            <label>
              <span>{t('departureTime')}</span>
              <input type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} />
            </label>
            <button type="button" onClick={() => setDepartureTime(getTokyoTime())}>{t('now')}</button>
          </div>
        </section>

        {data.latestLoadFailed && <p className="inline-warning" role="alert">{t('latestError')}</p>}

        <section className="results" aria-labelledby="results-title" aria-live="polite">
          <div className="results-heading">
            <h2 id="results-title">{t('upcoming')}</h2>
            {!sameStation && <span>{t('count', { count: results.length })}</span>}
          </div>

          {sameStation ? (
            <div className="empty-state">{t('sameStation')}</div>
          ) : results.length === 0 ? (
            <div className="empty-state">{t('noTrains')}</div>
          ) : (
            <div className="train-list">
              {results.slice(0, visibleCount).map((result) => (
                <TrainCard
                  key={result.service.id}
                  result={result}
                  summary={formationAtStation(
                    result.service,
                    origin,
                    data.timetable.stations,
                    data.latest,
                    data.formations.formations,
                  )}
                  stations={data.timetable.stations}
                  locale={locale}
                  data={data}
                  stale={stale}
                />
              ))}
            </div>
          )}

          {visibleCount < results.length && (
            <button className="show-more" type="button" onClick={() => setVisibleCount((count) => count + 5)}>
              {t('showMore')}
            </button>
          )}
        </section>

        <footer className="site-footer">
          <p>{t('firstLegNote')}</p>
          {data.latest && (
            <p>
              {data.latest.source.url ? (
                <a href={data.latest.source.url} target="_blank" rel="noreferrer">
                  {t('source', { source: data.latest.source.label })}
                </a>
              ) : (
                t('source', { source: data.latest.source.label })
              )}
            </p>
          )}
        </footer>
      </main>
    </div>
  )
}


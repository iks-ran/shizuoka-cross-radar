import { useEffect, useMemo, useState } from 'react'
import { loadStaticData, loadHistoryIndex, loadHistoricalData, type HistoryIndex, type StaticData } from './data'
import {
  DEFAULT_RESULT_VISIBILITY,
  formationAtStation,
  shouldDisplayRouteResult,
  type ResultVisibilitySettings,
} from './domain/classification'
import { createScheduledJourneyPlanner } from './domain/journey'
import { searchUpcomingTrains, stationName } from './domain/search'
import {
  formatUpdatedAt,
  getTokyoDate,
  getTokyoTime,
  isLatestStale,
  isTokyoWeekend,
  shiftServiceDate,
  nextScheduledCheck,
} from './domain/time'
import { detectLocale, intlLocale, translate, type MessageKey } from './i18n'
import type {
  FormationPrediction,
  FormationSummary,
  Locale,
  RouteMatchType,
  ScheduledJourney,
  SearchResult,
  Station,
  TrainService,
} from './types'

const LANGUAGE_STORAGE_KEY = 'shizuoka-cross-seat-radar-language'

const initialLocale = (): Locale => {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return stored === 'ja' || stored === 'en' || stored === 'zh-CN' ? stored : detectLocale()
}

const seatMessage: Record<FormationSummary['status'], MessageKey> = {
  full_convertible: 'fullConvertible',
  reclining: 'reclining',
  partial_cross: 'partialCross',
  box_fixed: 'boxFixed',
  all_longitudinal: 'allLongitudinal',
  unknown: 'unknown',
}

const routeMessage: Record<RouteMatchType, MessageKey> = {
  direct: 'routeDirect',
  first_leg: 'routeFirstLeg',
  intermediate_overlap: 'routeIntermediateOverlap',
}

const surchargeMessage = (service: TrainService): MessageKey | null =>
  service.trainType?.code === 'limited_express'
    ? 'limitedExpressNotice'
    : service.trainType?.code === 'home_liner'
      ? 'homeLinerNotice'
      : null

const stopTime = (clock: string | null, dayOffset: number): string =>
  clock === null ? '—' : `${clock}${dayOffset > 0 ? ` (+${dayOffset})` : ''}`

const formationLabel = (summary: FormationSummary): string =>
  summary.currentUnits.length > 0
    ? summary.currentUnits.join(' + ')
    : summary.plannedFamilies.length > 0
      ? summary.plannedFamilies.join(' + ')
      : summary.rawFormation || '—'

const predictionPercent = (prediction: FormationPrediction): number =>
  Math.round(prediction.crossSeatProbability * 100)

const predictionMessage = (prediction: FormationPrediction): MessageKey =>
  prediction.crossSeatProbability >= 0.7
    ? 'predictionLikelyCross'
    : prediction.crossSeatProbability <= 0.3
      ? 'predictionLikelyLongitudinal'
      : 'predictionUncertain'

function PredictionNote({ prediction, locale }: { prediction: FormationPrediction; locale: Locale }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values)
  return (
    <div className="prediction-note">
      <p className="prediction-headline">
        <span className="prediction-badge">{t('predicted')}</span>
        <strong>{t(predictionMessage(prediction), { percent: predictionPercent(prediction) })}</strong>
      </p>
      <p>
        {t('predictionBasis', {
          days: prediction.observedDays,
          from: prediction.trainingFrom,
          to: prediction.trainingTo,
          formation: prediction.likelyFamilies.join(' + '),
        })}
      </p>
    </div>
  )
}

interface TrainCardProps {
  result: SearchResult
  summary: FormationSummary
  stations: Station[]
  locale: Locale
  data: StaticData
  stale: boolean
  historical: boolean
  journey: ScheduledJourney | null
  journeyLegSummaries: FormationSummary[]
}

function TrainCard({
  result,
  summary,
  stations,
  locale,
  data,
  stale,
  historical,
  journey,
  journeyLegSummaries,
}: TrainCardProps) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values)
  const trainDestination = locale === 'zh-CN'
    ? result.service.destinationName.zhCN
    : result.service.destinationName[locale]
  const segmentStartStation = stationName(stations, result.segmentStartStop.stationId, locale)
  const segmentEndStation = stationName(stations, result.segmentEndStop.stationId, locale)
  const displayedFormation = formationLabel(summary)
  const statusText = t(seatMessage[summary.status])
  const surcharge = surchargeMessage(result.service)

  return (
    <article className="train-card">
      <div className="time-row">
        <time className="departure-time" dateTime={result.segmentStartStop.departure ?? undefined}>
          {stopTime(result.segmentStartStop.departure, result.segmentStartStop.dayOffset)}
        </time>
        <span className="time-arrow" aria-hidden="true">→</span>
        <time className="arrival-time" dateTime={result.segmentEndStop.arrival ?? undefined}>
          {stopTime(result.segmentEndStop.arrival, result.segmentEndStop.dayOffset)}
        </time>
      </div>

      <span className={`route-kind route-kind-${result.matchType}`}>{t(routeMessage[result.matchType])}</span>

      <div className="service-row">
        <strong>{result.service.trainNumber}</strong>
        <span aria-hidden="true">·</span>
        <span>{t('forDestination', { station: trainDestination })}</span>
        {surcharge && <span className="surcharge-badge">{t(surcharge)}</span>}
      </div>

      <p className="segment-note">
        {t('overlapSegment', { origin: segmentStartStation, destination: segmentEndStation })}
      </p>

      {result.matchType !== 'direct' && (
        <section className="complete-route" aria-label={t('fastestWholeRoute')}>
          <div className="complete-route-heading">
            <h3>{t('fastestWholeRoute')}</h3>
            <span>{t('scheduledRoute')}</span>
          </div>
          {journey ? (
            <>
              <ol className="journey-legs">
                {journey.legs.map((leg, index) => {
                  const fromStation = stationName(stations, leg.fromStop.stationId, locale)
                  const toStation = stationName(stations, leg.toStop.stationId, locale)
                  const featured = leg.service.id === journey.featuredServiceId
                  const legSummary = journeyLegSummaries[index]
                  const legStatus = legSummary?.status ?? 'unknown'
                  const legFormation = legSummary ? formationLabel(legSummary) : '—'
                  const legSurcharge = surchargeMessage(leg.service)
                  return (
                    <li className={featured ? 'featured-leg' : ''} key={`${leg.service.id}-${leg.fromStop.stationId}-${leg.toStop.stationId}-${index}`}>
                      <div className="journey-times">
                        <time>{stopTime(leg.fromStop.departure, leg.fromStop.dayOffset)}</time>
                        <span aria-hidden="true">→</span>
                        <time>{stopTime(leg.toStop.arrival, leg.toStop.dayOffset)}</time>
                      </div>
                      <div className="journey-detail">
                        <strong>{fromStation} → {toStation}</strong>
                        <span>{leg.service.trainNumber}</span>
                        {featured && <span className="featured-train-badge">{t('thisTrain')}</span>}
                        {legSurcharge && <span className="surcharge-badge">{t(legSurcharge)}</span>}
                        {featured && (
                          <span>{t('rideMinutes', { minutes: journey.featuredDurationMinutes })}</span>
                        )}
                      </div>
                      <div className={`journey-seat-category journey-seat-${legStatus}`}>
                        <span className="journey-seat-mark" aria-hidden="true" />
                        <span>{t(seatMessage[legStatus])}</span>
                        {legFormation !== '—' && <strong>{legFormation}</strong>}
                        {legSummary?.basis === 'planned' && (
                          <span className="journey-planned-badge">{t('planned')}</span>
                        )}
                        {legSummary?.prediction && (
                          <span className="journey-prediction-badge">
                            {t('predictionShort', { percent: predictionPercent(legSummary.prediction) })}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
              <p className="journey-summary">
                <strong>
                  {t('finalArrival', {
                    station: stationName(stations, journey.legs.at(-1)?.toStop.stationId ?? '', locale),
                    time: stopTime(
                      journey.legs.at(-1)?.toStop.arrival ?? null,
                      journey.legs.at(-1)?.toStop.dayOffset ?? 0,
                    ),
                  })}
                </strong>
                <span>{t('transfers', { count: journey.transferCount })}</span>
                <span>{t('totalMinutes', { minutes: journey.durationMinutes })}</span>
              </p>
            </>
          ) : (
            <p className="route-unavailable">{t('noCompleteRoute')}</p>
          )}
          <p className="journey-disclaimer">{t('journeyDisclaimer')}</p>
        </section>
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
          {summary.prediction && <PredictionNote prediction={summary.prediction} locale={locale} />}
        </div>
      </div>

      <div className="formation-row">
        <span>{t('formation', { station: segmentStartStation })}</span>
        <div className="formation-value">
          <strong>{displayedFormation}</strong>
          {summary.basis === 'planned' && <span className="planned-badge">{t('planned')}</span>}
        </div>
      </div>

      <div className="freshness-row">
        <span>
          {summary.basis === 'planned'
            ? t('plannedWarning')
            : t('updated', { time: data.latest ? formatUpdatedAt(data.latest.updatedAt, intlLocale(locale)) : '—' })}
        </span>
        {data.latest?.source.isMock && <span className="mini-badge">{t('fixture')}</span>}
        {historical && summary.basis !== 'planned' && <span className="mini-badge">{t('historicalObservation')}</span>}
        {summary.basis !== 'planned' && stale && <span className="stale-badge">{t('stale')}</span>}
      </div>
    </article>
  )
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [data, setData] = useState<StaticData | null>(null)
  const [baseData, setBaseData] = useState<StaticData | null>(null)
  const [history, setHistory] = useState<HistoryIndex | null>(null)
  const [chosenDate, setChosenDate] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [origin, setOrigin] = useState('hamamatsu')
  const [destination, setDestination] = useState('shizuoka')
  const [departureTime, setDepartureTime] = useState(getTokyoTime)
  const [resultVisibility, setResultVisibility] = useState<ResultVisibilitySettings>(() => ({
    ...DEFAULT_RESULT_VISIBILITY,
  }))
  const [visibleCount, setVisibleCount] = useState(5)
  const [nowTick, setNowTick] = useState(() => new Date())
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values)

  useEffect(() => {
    let active = true
    Promise.all([loadStaticData(), loadHistoryIndex()])
      .then(([loaded, index]) => {
        if (active) {
          setData(loaded)
          setBaseData(loaded)
          setHistory(index)
        }
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    return () => {
      active = false
    }
  }, [])

  const today = getTokyoDate(nowTick)
  const cutoff = shiftServiceDate(today, -29)
  const availableDates = [...new Set([
    ...(history?.dates.map((entry) => entry.serviceDate) ?? []),
    ...(!baseData?.timetable.isFixture && baseData?.timetable.serviceDate ? [baseData.timetable.serviceDate] : []),
  ])].filter((day) => day >= cutoff && day <= today).sort().reverse()
  const selectedDate = chosenDate ?? availableDates[0] ?? today
  const calendarDates = Array.from({ length: 30 }, (_, offset) => shiftServiceDate(today, -offset))
  const historical = !baseData?.timetable.isFixture && selectedDate < today
  const todayUnavailable = !baseData?.timetable.isFixture && !availableDates.includes(today)
  const yesterdayRelease = history?.dates.find((entry) => entry.serviceDate === shiftServiceDate(today, -1))?.firstObservedAt
  const availability = yesterdayRelease
    ? t('releaseEstimate', { time: getTokyoTime(new Date(yesterdayRelease)) })
    : t('nextCheck', { time: nextScheduledCheck(nowTick) })

  useEffect(() => {
    if (!baseData) return
    let active = true
    setHistoryError(false)
    setHistoryLoading(false)
    if (baseData.timetable.isFixture || baseData.timetable.serviceDate === selectedDate) {
      setData(baseData)
    } else {
      const entry = history?.dates.find((item) => item.serviceDate === selectedDate)
      if (entry) {
        setHistoryLoading(true)
        loadHistoricalData(entry, baseData)
          .then((loaded) => { if (active) setData(loaded) })
          .catch(() => { if (active) setHistoryError(true) })
          .finally(() => { if (active) setHistoryLoading(false) })
      }
    }
    return () => { active = false }
  }, [baseData, history, selectedDate])

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
    document.documentElement.lang = locale
    document.title = t('title')
  }, [locale]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(
    () => setVisibleCount(5),
    [origin, destination, departureTime, resultVisibility, selectedDate],
  )

  const sameStation = origin === destination
  const timetableStale = !data?.timetable.isFixture && (data?.timetable.serviceDate !== selectedDate || selectedDate < cutoff || selectedDate > today)
  const selectedWeekend = isTokyoWeekend(new Date(`${selectedDate}T12:00:00+09:00`))
  const alignedLatest =
    data && (data.timetable.isFixture || data.latest?.serviceDate === data.timetable.serviceDate)
      ? data.latest
      : null
  const results = useMemo(
    () => {
      if (!data || sameStation || timetableStale || historyLoading || historyError) return []
      // The archive model describes real diagrams, so fixture timetables get no estimate.
      const formationModel = data.timetable.isFixture ? null : data.formationModel
      const journeyPlanner = createScheduledJourneyPlanner(data.timetable, selectedWeekend)
      return searchUpcomingTrains(
        data.timetable,
        origin,
        destination,
        departureTime,
        selectedWeekend,
      )
        .map((result) => {
          const summary = formationAtStation(
            result.service,
            result.segmentStartStop.stationId,
            data.timetable.stations,
            alignedLatest,
            data.formations.formations,
            formationModel,
          )
          return { result, summary }
        })
        .filter(({ result, summary }) => {
          if (result.matchType === 'direct') {
            return shouldDisplayRouteResult(
              result.matchType,
              summary,
              null,
              resultVisibility,
            )
          }
          return (
            summary.status !== 'all_longitudinal' &&
            (summary.status !== 'unknown' || resultVisibility.showIndirectUnknown)
          )
        })
        .map(({ result, summary }) => {
          const journey = result.matchType === 'direct'
            ? null
            : journeyPlanner.findFastestIncluding(
                origin,
                destination,
                departureTime,
                result.service.id,
                result.segmentStartStop.stationId,
              )
          const journeyLegSummaries = journey?.legs.map((leg) =>
            formationAtStation(
              leg.service,
              leg.fromStop.stationId,
              data.timetable.stations,
              alignedLatest,
              data.formations.formations,
              formationModel,
            ),
          ) ?? []
          return { result, summary, journey, journeyLegSummaries }
        })
        .filter(
          ({ result, summary, journey }) =>
            result.matchType === 'direct' ||
            (
              journey !== null &&
              shouldDisplayRouteResult(
                result.matchType,
                summary,
                journey.featuredDurationMinutes,
                resultVisibility,
              )
            ),
        )
    },
    [
      data,
      origin,
      destination,
      departureTime,
      sameStation,
      nowTick,
      timetableStale,
      selectedWeekend,
      historyLoading,
      historyError,
      alignedLatest,
      resultVisibility,
    ],
  )
  const stale = !historical && isLatestStale(data?.latest ?? null, nowTick)

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

  const isDemo = data.timetable.isFixture || data.timetable.source.isMock || data.latest?.source.isMock
  return (
    <div className="page">
      <header className="site-header">
        <div className="header-copy">
          <p className="eyebrow">
            <span className="line-symbol" aria-hidden="true">CA</span>
            <span>{t('lineName')}</span>
            <span className="corridor-label">{t('corridorLabel')}</span>
          </p>
          <h1>{t('title')}</h1>
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
          <div className="history-date">
            <label htmlFor="schedule-date">{t('serviceDate')}</label>
            <select id="schedule-date" aria-describedby={!baseData?.timetable.isFixture ? 'history-coverage' : undefined} value={selectedDate} onChange={(event) => setChosenDate(event.target.value)}>
              <option value={today}>{today} · {t('today')}</option>
              {calendarDates.slice(1).map((day) => (
                <option key={day} value={day} disabled={!availableDates.includes(day)}>
                  {day}{availableDates.includes(day) ? '' : ` · ${t('historyMissing')}`}
                </option>
              ))}
            </select>
            {!baseData?.timetable.isFixture && <small id="history-coverage">{t('historyCoverage', { count: availableDates.length })}</small>}
          </div>
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

          <fieldset className="result-filters">
            <legend>{t('resultFilters')}</legend>
            <p>{t('resultFiltersHint')}</p>
            <div className="filter-grid">
              <label className="filter-option">
                <input
                  type="checkbox"
                  checked={resultVisibility.showDirectLongitudinal}
                  onChange={(event) => setResultVisibility((current) => ({
                    ...current,
                    showDirectLongitudinal: event.target.checked,
                  }))}
                />
                <span>{t('showDirectLongitudinal')}</span>
              </label>
              <label className="filter-option">
                <input
                  type="checkbox"
                  checked={resultVisibility.showDirectUnknown}
                  onChange={(event) => setResultVisibility((current) => ({
                    ...current,
                    showDirectUnknown: event.target.checked,
                  }))}
                />
                <span>{t('showDirectUnknown')}</span>
              </label>
              <label className="filter-option">
                <input
                  type="checkbox"
                  checked={resultVisibility.showIndirectUnknown}
                  onChange={(event) => setResultVisibility((current) => ({
                    ...current,
                    showIndirectUnknown: event.target.checked,
                  }))}
                />
                <span>{t('showIndirectUnknown')}</span>
              </label>
              <label className="filter-option">
                <input
                  type="checkbox"
                  checked={resultVisibility.requireMinimumIndirectMinutes}
                  onChange={(event) => setResultVisibility((current) => ({
                    ...current,
                    requireMinimumIndirectMinutes: event.target.checked,
                  }))}
                />
                <span>{t('requireMinimumIndirectRide')}</span>
              </label>
            </div>
            <label className="minimum-ride-input">
              <span>{t('minimumRideMinutes')}</span>
              <input
                type="number"
                min="0"
                step="1"
                value={resultVisibility.minimumIndirectMinutes}
                disabled={!resultVisibility.requireMinimumIndirectMinutes}
                onChange={(event) => setResultVisibility((current) => ({
                  ...current,
                  minimumIndirectMinutes: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                }))}
              />
              <span>{t('minutesShort')}</span>
            </label>
          </fieldset>
        </section>

        {data.latestLoadFailed && <p className="inline-warning" role="alert">{t('latestError')}</p>}
        {todayUnavailable && <aside className="inline-warning" role="status"><p>{t('timetableStale')}</p><p>{availability}</p></aside>}
        {historical && <aside className="inline-warning" role="note">{t('historyBanner', { date: selectedDate })}</aside>}

        <section className="results" aria-labelledby="results-title" aria-live="polite">
          <div className="results-heading">
            <h2 id="results-title">{t(historical ? 'historicalTrains' : 'upcoming')}</h2>
            {!sameStation && <span>{t('count', { count: results.length })}</span>}
          </div>

          {historyError ? (
            <div className="empty-state" role="alert">{t('historyError')}</div>
          ) : historyLoading ? (
            <div className="empty-state">{t('loading')}</div>
          ) : timetableStale ? (
            <div className="empty-state">{t('dateUnavailable')}</div>
          ) : sameStation ? (
            <div className="empty-state">{t('sameStation')}</div>
          ) : results.length === 0 ? (
            <div className="empty-state">{t('noTrains')}</div>
          ) : (
            <div className="train-list">
              {results.slice(0, visibleCount).map(({ result, summary, journey, journeyLegSummaries }) => (
                <TrainCard
                  key={result.service.id}
                  result={result}
                  summary={summary}
                  stations={data.timetable.stations}
                  locale={locale}
                  data={data}
                  stale={stale}
                  historical={historical}
                  journey={journey}
                  journeyLegSummaries={journeyLegSummaries}
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
          <p className="independent-note">{t('independentNotice')}</p>
          <p>{t('firstLegNote')}</p>
          {data.formationModel && !data.timetable.isFixture && <p>{t('predictionNote')}</p>}
          {data.timetable.services.some((service) => service.trainType) && <p>{t('surchargeNote')}</p>}
          <p>
            {data.timetable.source.url ? (
              <a href={data.timetable.source.url} target="_blank" rel="noreferrer">
                {t('timetableSource', { source: data.timetable.source.label })}
              </a>
            ) : (
              t('timetableSource', { source: data.timetable.source.label })
            )}
          </p>
          {data.latest && (
            <p>
              {data.latest.source.url ? (
                <a href={data.latest.source.url} target="_blank" rel="noreferrer">
                  {t('formationSource', { source: data.latest.source.label })}
                </a>
              ) : (
                t('formationSource', { source: data.latest.source.label })
              )}
            </p>
          )}
        </footer>
      </main>
    </div>
  )
}

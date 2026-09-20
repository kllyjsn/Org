import type { MapPresence, MapState } from '../../types';
import type { SaveState } from './helpers';

export default function MapHeader(props: {
  mapName: string;
  setMapName: (name: string) => void;
  saveName: () => void;
  readOnly: boolean;
  domain: string;
  meta: MapState['meta'] | null;
  researchDue: boolean;
  openDeepResearch: () => void;
  saveState: SaveState;
  presence: MapPresence[];
}) {
  const {
    mapName,
    setMapName,
    saveName,
    readOnly,
    domain,
    meta,
    researchDue,
    openDeepResearch,
    saveState,
    presence,
  } = props;

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white/85 px-3 py-2 backdrop-blur sm:gap-3 sm:px-4">
      <h1 className="sr-only">{mapName || 'Account map'}</h1>
      <input
        aria-label="Map name"
        className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-slate-900 outline-none hover:border-slate-300 focus:border-[#5b4cf0] sm:w-56 sm:flex-none"
        value={mapName}
        onChange={(e) => setMapName(e.target.value)}
        onBlur={saveName}
        disabled={readOnly}
      />
      <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-500 sm:inline">
        {domain}
      </span>
      {meta?.provider && (
        <span className="hidden rounded-full bg-[#c9f04b] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-950 md:inline">
          {meta.tier} · {meta.provider}
        </span>
      )}
      {meta?.researchedAt && (
        <button
          onClick={() => {
            if (readOnly) return;
            openDeepResearch();
          }}
          disabled={readOnly}
          title={
            meta.nextRefreshAt
              ? `Next research check ${new Date(meta.nextRefreshAt).toLocaleDateString()}`
              : 'Refresh research'
          }
          className={`hidden rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide md:inline ${
            researchDue
              ? 'bg-amber-100 text-amber-800'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          {researchDue ? 'Refresh due' : 'Research current'}
        </button>
      )}
      <div className="hidden flex-1 sm:block" />
      <span
        role="status"
        className="hidden text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:inline"
      >
        {saveState === 'saving'
          ? 'Saving…'
          : saveState === 'dirty'
            ? 'Unsaved changes'
            : 'Saved'}
      </span>
      <div className="flex -space-x-1">
        {presence.slice(0, 4).map((person) => (
          <span
            key={person.id}
            title={`${person.name} is viewing`}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#5b4cf0] text-[10px] font-semibold text-white"
          >
            {person.name
              .split(' ')
              .map((part) => part[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </span>
        ))}
      </div>
    </header>
  );
}

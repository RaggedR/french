import { useState, useEffect, useRef } from 'react';
import type { DictionaryEntry, NounDeclension, VerbConjugation, AdjectiveForms } from '../types';

// ── Sample data for preview ─────────────────────────────────────────

const SAMPLE_ENTRIES: DictionaryEntry[] = [
  {
    stressedForm: 'вре́мя',
    pos: 'noun',
    gender: 'n',
    translations: ['time', 'period', 'season', 'tense'],
    declension: {
      sg: { nom: 'вре́мя', gen: 'вре́мени', dat: 'вре́мени', acc: 'вре́мя', inst: 'вре́менем', prep: 'вре́мени' },
      pl: { nom: 'времена́', gen: 'времён', dat: 'времена́м', acc: 'времена́', inst: 'времена́ми', prep: 'времена́х' },
    },
    example: { russian: 'У меня нет вре́мени.', english: "I don't have time." },
    context: 'Он провёл много времени в деревне.',
    contextTranslation: 'He spent a lot of time in the village.',
  },
  {
    stressedForm: 'говори́ть',
    pos: 'verb',
    aspect: 'imperfective',
    aspectPair: 'сказа́ть',
    translations: ['to speak', 'to talk', 'to say', 'to tell'],
    conjugation: {
      present: { sg1: 'говорю́', sg2: 'говори́шь', sg3: 'говори́т', pl1: 'говори́м', pl2: 'говори́те', pl3: 'говоря́т' },
      past: { m: 'говори́л', f: 'говори́ла', n: 'говори́ло', pl: 'говори́ли' },
      imperative: { sg: 'говори́', pl: 'говори́те' },
    },
    example: { russian: 'Она говори́т по-ру́сски.', english: 'She speaks Russian.' },
    context: 'Он говорил медленно и тихо.',
    contextTranslation: 'He spoke slowly and quietly.',
  },
  {
    stressedForm: 'краси́вый',
    pos: 'adjective',
    translations: ['beautiful', 'handsome', 'pretty', 'fine'],
    adjectiveForms: {
      long: { m: 'краси́вый', f: 'краси́вая', n: 'краси́вое', pl: 'краси́вые' },
      short: { m: 'краси́в', f: 'краси́ва', n: 'краси́во', pl: 'краси́вы' },
      comparative: 'краси́вее',
      superlative: 'краси́вейший',
    },
    example: { russian: 'Какой краси́вый го́род!', english: 'What a beautiful city!' },
    context: 'Это была красивая старая церковь.',
    contextTranslation: 'It was a beautiful old church.',
  },
];

// ── Helper: POS badge color ─────────────────────────────────────────

function posBadgeColor(pos: string): string {
  switch (pos) {
    case 'noun': return 'bg-blue-100 text-blue-700';
    case 'verb': return 'bg-green-100 text-green-700';
    case 'adjective': return 'bg-purple-100 text-purple-700';
    case 'adverb': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function genderLabel(g: string): string {
  switch (g) {
    case 'm': return 'masculine';
    case 'f': return 'feminine';
    case 'n': return 'neuter';
    default: return g;
  }
}

// ── Sub-components ──────────────────────────────────────────────────

function NounTable({ d }: { d: NounDeclension }) {
  const cases = ['Nom.', 'Gen.', 'Dat.', 'Acc.', 'Inst.', 'Prep.'] as const;
  const keys = ['nom', 'gen', 'dat', 'acc', 'inst', 'prep'] as const;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 uppercase tracking-wide">
          <th className="text-left py-1 pr-3 font-medium"></th>
          <th className="text-left py-1 pr-3 font-medium">Singular</th>
          <th className="text-left py-1 font-medium">Plural</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((label, i) => (
          <tr key={label} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
            <td className="py-1 pr-3 text-xs text-gray-400 font-medium">{label}</td>
            <td className="py-1 pr-3 text-gray-700">{d.sg[keys[i]]}</td>
            <td className="py-1 text-gray-700">{d.pl[keys[i]]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VerbTable({ c }: { c: VerbConjugation }) {
  const persons = [
    { label: 'я', key: 'sg1' as const },
    { label: 'ты', key: 'sg2' as const },
    { label: 'он/она', key: 'sg3' as const },
    { label: 'мы', key: 'pl1' as const },
    { label: 'вы', key: 'pl2' as const },
    { label: 'они', key: 'pl3' as const },
  ];

  return (
    <div className="space-y-3">
      {/* Present/Future tense */}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 uppercase tracking-wide">
            <th className="text-left py-1 font-medium" colSpan={2}>Present / Future</th>
          </tr>
        </thead>
        <tbody>
          {persons.map(({ label, key }, i) => (
            <tr key={key} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
              <td className="py-1 pr-3 text-xs text-gray-400 font-medium w-16">{label}</td>
              <td className="py-1 text-gray-700">{c.present[key]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Past tense */}
      <div className="text-sm">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">Past</p>
        <p className="text-gray-700">
          {c.past.m} / {c.past.f}{c.past.n ? ` / ${c.past.n}` : ''} / {c.past.pl}
        </p>
      </div>

      {/* Imperative */}
      <div className="text-sm">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">Imperative</p>
        <p className="text-gray-700">{c.imperative.sg} / {c.imperative.pl}</p>
      </div>
    </div>
  );
}

function AdjectiveTable({ a }: { a: AdjectiveForms }) {
  const genders = [
    { label: 'Masc.', key: 'm' as const },
    { label: 'Fem.', key: 'f' as const },
    { label: 'Neut.', key: 'n' as const },
    { label: 'Plural', key: 'pl' as const },
  ];

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 uppercase tracking-wide">
            <th className="text-left py-1 pr-3 font-medium"></th>
            <th className="text-left py-1 pr-3 font-medium">Long</th>
            <th className="text-left py-1 font-medium">Short</th>
          </tr>
        </thead>
        <tbody>
          {genders.map(({ label, key }, i) => (
            <tr key={key} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
              <td className="py-1 pr-3 text-xs text-gray-400 font-medium">{label}</td>
              <td className="py-1 pr-3 text-gray-700">{a.long[key]}</td>
              <td className="py-1 text-gray-700">{a.short[key]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(a.comparative || a.superlative) && (
        <div className="text-sm">
          {a.comparative && (
            <p className="text-gray-700">
              <span className="text-xs text-gray-400 font-medium mr-2">Comparative</span>
              {a.comparative}
            </p>
          )}
          {a.superlative && (
            <p className="text-gray-700 mt-1">
              <span className="text-xs text-gray-400 font-medium mr-2">Superlative</span>
              {a.superlative}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────

export function RichCardBack({ entry }: { entry: DictionaryEntry }) {
  const [grammarOpen, setGrammarOpen] = useState(true);

  return (
    <div className="space-y-4">
      {/* Header: stressed form + badges */}
      <div className="text-center">
        <p className="text-2xl font-medium text-gray-900 mb-2">{entry.stressedForm}</p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${posBadgeColor(entry.pos)}`}>
            {entry.pos}
          </span>
          {entry.gender && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {genderLabel(entry.gender)}
            </span>
          )}
          {entry.aspect && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {entry.aspect}
            </span>
          )}
          {entry.aspectPair && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
              pair: {entry.aspectPair}
            </span>
          )}
        </div>
      </div>

      {/* Translations */}
      <div className="text-center">
        <p className="text-lg text-gray-700">
          {entry.translations.join(' \u00B7 ')}
        </p>
      </div>

      {/* Grammar table (collapsible) */}
      {(entry.declension || entry.conjugation || entry.adjectiveForms) && (
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setGrammarOpen(!grammarOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-600"
          >
            <span>Grammar</span>
            <svg
              className={`w-4 h-4 transition-transform ${grammarOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {grammarOpen && (
            <div className="px-3 py-2">
              {entry.declension && <NounTable d={entry.declension} />}
              {entry.conjugation && <VerbTable c={entry.conjugation} />}
              {entry.adjectiveForms && <AdjectiveTable a={entry.adjectiveForms} />}
            </div>
          )}
        </div>
      )}

      {/* Example sentence (from dictionary) */}
      {entry.example && (
        <div className="bg-blue-50 rounded-lg px-3 py-2">
          <p className="text-xs text-blue-400 font-medium uppercase tracking-wide mb-1">Example</p>
          <p className="text-sm text-gray-800 italic">{entry.example.russian}</p>
          <p className="text-sm text-gray-500">{entry.example.english}</p>
        </div>
      )}

      {/* Context sentence (from transcript) */}
      {entry.context && (
        <div className="bg-gray-50 rounded-lg px-3 py-2">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">From transcript</p>
          <p className="text-sm text-gray-800 italic">{entry.context}</p>
          {entry.contextTranslation && (
            <p className="text-sm text-gray-500">{entry.contextTranslation}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Preview with real SRS queue behavior ────────────────────────────

interface QueueItem {
  entry: DictionaryEntry;
  dueAt: number;
}

interface ReviewState {
  queue: QueueItem[];
  current: QueueItem | null;
  showAnswer: boolean;
  reviewedCount: number;
  waitingSeconds: number | null;
}

function makeInitialState(): ReviewState {
  return {
    queue: SAMPLE_ENTRIES.slice(1).map(e => ({ entry: e, dueAt: 0 })),
    current: { entry: SAMPLE_ENTRIES[0], dueAt: 0 },
    showAnswer: false,
    reviewedCount: 0,
    waitingSeconds: null,
  };
}

// Pop the next ready card from a queue, returning the new state fields
function popNextFrom(queue: QueueItem[]): { current: QueueItem | null; queue: QueueItem[] } {
  const now = Date.now();
  const readyIdx = queue.findIndex(item => item.dueAt <= now);
  if (readyIdx !== -1) {
    const next = [...queue];
    const [item] = next.splice(readyIdx, 1);
    return { current: item, queue: next };
  }
  return { current: null, queue };
}

export function RichCardPreview() {
  const [state, setState] = useState<ReviewState>(makeInitialState);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { queue, current, showAnswer, reviewedCount, waitingSeconds } = state;
  const hasWaiting = current === null && queue.length > 0;

  // Timer for waiting cards — updates waitingSeconds countdown and pops ready cards
  useEffect(() => {
    if (!hasWaiting) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    // Check every second if a waiting card is ready, and update countdown
    timerRef.current = setInterval(() => {
      setState(prev => {
        const now = Date.now();
        const popped = popNextFrom(prev.queue);
        if (popped.current) {
          return { ...prev, current: popped.current, queue: popped.queue, showAnswer: false, waitingSeconds: null };
        }
        // Update countdown
        const nearestDue = Math.min(...prev.queue.map(i => i.dueAt));
        return { ...prev, waitingSeconds: Math.max(1, Math.ceil((nearestDue - now) / 1000)) };
      });
    }, 1000);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [hasWaiting, queue]);

  const handleRate = (label: string) => {
    setState(prev => {
      if (!prev.current) return prev;
      let newQueue = prev.queue;
      const now = Date.now();

      if (label === 'Again') {
        newQueue = [...newQueue, { entry: prev.current.entry, dueAt: now + 60_000 }];
      } else if (label === 'Hard') {
        newQueue = [...newQueue, { entry: prev.current.entry, dueAt: now + 300_000 }];
      }
      // Good / Easy — card just leaves

      const popped = popNextFrom(newQueue);
      // Compute initial waitingSeconds if entering waiting state
      let waitingSecs: number | null = null;
      if (!popped.current && popped.queue.length > 0) {
        const nearest = Math.min(...popped.queue.map(i => i.dueAt));
        waitingSecs = Math.max(1, Math.ceil((nearest - now) / 1000));
      }
      return {
        queue: popped.queue,
        current: popped.current,
        showAnswer: false,
        reviewedCount: prev.reviewedCount + 1,
        waitingSeconds: waitingSecs,
      };
    });
  };

  const handleReset = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setState(makeInitialState());
  };

  // Done state
  const isDone = !current && queue.length === 0;
  if (isDone && reviewedCount > 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">&#10003;</div>
        <p className="text-lg font-medium text-gray-900 mb-2">All caught up!</p>
        <p className="text-gray-500 mb-6">
          Reviewed {reviewedCount} card{reviewedCount !== 1 ? 's' : ''}.
        </p>
        <button onClick={handleReset} className="text-sm text-blue-600 hover:text-blue-800 transition-colors">
          Reset preview deck
        </button>
      </div>
    );
  }

  // Waiting for learning card
  if (hasWaiting && waitingSeconds !== null) {
    return (
      <div className="text-center py-12">
        <p className="text-lg font-medium text-gray-900 mb-2">Learning card coming up...</p>
        <p className="text-3xl font-mono text-blue-600 mb-4">
          {Math.floor(waitingSeconds / 60)}:{String(waitingSeconds % 60).padStart(2, '0')}
        </p>
        <p className="text-sm text-gray-500">Reviewed {reviewedCount} so far</p>
      </div>
    );
  }

  if (!current) return null;

  const bareWord = current.entry.stressedForm.replace(/\u0301/g, '');

  return (
    <div>
      {/* Progress */}
      <div className="text-xs text-gray-400 text-center mb-6">
        {reviewedCount} reviewed
        {queue.length > 0 && ` \u00B7 ${queue.length} remaining`}
      </div>

      {/* Front of card */}
      <div className="text-center mb-4">
        <p className="text-3xl font-medium text-gray-900 mb-3">{bareWord}</p>
        <button className="text-gray-400 hover:text-blue-600 transition-colors" title="Listen">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 mx-auto">
            <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
            <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" />
          </svg>
        </button>
      </div>

      {!showAnswer ? (
        <div className="text-center">
          <button
            onClick={() => setState(prev => ({ ...prev, showAnswer: true }))}
            className="px-8 py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            Show Answer
          </button>
          <p className="text-xs text-gray-400 mt-2">Space or Enter</p>
        </div>
      ) : (
        <div>
          <div className="border-t my-4" />
          <RichCardBack entry={current.entry} />

          <div className="grid grid-cols-4 gap-2 mt-6">
            {[
              { label: 'Again', time: '1m', color: 'bg-red-500 hover:bg-red-600' },
              { label: 'Hard', time: '5m', color: 'bg-orange-500 hover:bg-orange-600' },
              { label: 'Good', time: '1d', color: 'bg-green-500 hover:bg-green-600' },
              { label: 'Easy', time: '5d', color: 'bg-blue-500 hover:bg-blue-600' },
            ].map(({ label, time, color }) => (
              <button
                key={label}
                onClick={() => handleRate(label)}
                className={`${color} text-white rounded-lg py-3 px-2 transition-colors text-sm font-medium`}
              >
                <div>{label}</div>
                <div className="text-xs opacity-80 mt-0.5">{time}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 text-center mt-2">
            Keys: 1-4 or Space/Enter for Good
          </p>
        </div>
      )}
    </div>
  );
}
